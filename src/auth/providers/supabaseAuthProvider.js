/**
 * supabaseAuthProvider.js — Nuvra Phase 6
 *
 * Supabase authentication provider.
 * Wraps the Supabase JS client's auth API into the AuthProviderContract.
 *
 * The app never calls Supabase directly — it always goes through the
 * AuthManager, which calls this provider. Swapping to Firebase or a
 * custom backend requires only replacing this file.
 *
 * @module auth/providers/supabaseAuthProvider
 */
'use strict';

import { AuthProviderContract, AuthErrorCode, authOk, authError } from './authContract.js';

export class SupabaseAuthProvider extends AuthProviderContract {
  /**
   * @param {object} config
   * @param {object} config.client - Initialized Supabase client
   * @param {string} [config.redirectUrl] - OAuth/magic link redirect URL
   */
  constructor({ client, redirectUrl = null }) {
    super();
    if (!client) throw new Error('SupabaseAuthProvider requires a Supabase client');
    this._client      = client;
    this._redirectUrl = redirectUrl || (typeof window !== 'undefined' ? window.location.origin : null);
    this._listeners   = [];
  }

  get id()    { return 'supabase'; }
  get label() { return 'Supabase Auth'; }

  // ── Sign In ──────────────────────────────────────────────────────────────────

  async signInWithPassword(email, password) {
    try {
      const { data, error } = await this._client.auth.signInWithPassword({ email, password });
      if (error) return authError(error.message, _mapSupabaseError(error));
      return authOk(_mapUser(data.user), _mapSession(data.session));
    } catch (err) {
      return authError(err.message, AuthErrorCode.NETWORK_ERROR);
    }
  }

  async sendMagicLink(email, options = {}) {
    try {
      const { error } = await this._client.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: options.redirectUrl || this._redirectUrl,
          shouldCreateUser: options.shouldCreateUser !== false,
        },
      });
      if (error) return authError(error.message, _mapSupabaseError(error));
      return authOk(null, null); // User will be set after they click the link
    } catch (err) {
      return authError(err.message, AuthErrorCode.NETWORK_ERROR);
    }
  }

  async signUp(email, password, metadata = {}) {
    try {
      const { data, error } = await this._client.auth.signUp({
        email,
        password,
        options: {
          data: metadata,
          emailRedirectTo: this._redirectUrl,
        },
      });
      if (error) return authError(error.message, _mapSupabaseError(error));
      return authOk(_mapUser(data.user), _mapSession(data.session));
    } catch (err) {
      return authError(err.message, AuthErrorCode.NETWORK_ERROR);
    }
  }

  async signOut() {
    try {
      const { error } = await this._client.auth.signOut();
      if (error) return authError(error.message, _mapSupabaseError(error));
      return authOk(null, null);
    } catch (err) {
      return authError(err.message, AuthErrorCode.NETWORK_ERROR);
    }
  }

  async signInWithOAuth(provider, options = {}) {
    try {
      const { data, error } = await this._client.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: options.redirectUrl || this._redirectUrl,
          scopes:     options.scopes,
        },
      });
      if (error) return authError(error.message, _mapSupabaseError(error));
      // OAuth redirects the browser — data.url is the redirect URL
      if (data?.url && typeof window !== 'undefined') {
        window.location.href = data.url;
      }
      return authOk(null, null);
    } catch (err) {
      return authError(err.message, AuthErrorCode.NETWORK_ERROR);
    }
  }

  // ── Session ──────────────────────────────────────────────────────────────────

  async getCurrentUser() {
    try {
      const { data: { user }, error } = await this._client.auth.getUser();
      if (error || !user) return null;
      return _mapUser(user);
    } catch (_) {
      return null;
    }
  }

  async refreshSession() {
    try {
      const { data, error } = await this._client.auth.refreshSession();
      if (error) return authError(error.message, _mapSupabaseError(error));
      return authOk(_mapUser(data.user), _mapSession(data.session));
    } catch (err) {
      return authError(err.message, AuthErrorCode.NETWORK_ERROR);
    }
  }

  async getAccessToken() {
    try {
      const { data: { session } } = await this._client.auth.getSession();
      return session?.access_token || null;
    } catch (_) {
      return null;
    }
  }

  // ── Profile ──────────────────────────────────────────────────────────────────

  async updateProfile(updates) {
    try {
      const { data, error } = await this._client.auth.updateUser({
        data: {
          name:      updates.name,
          avatarUrl: updates.avatarUrl,
          ...updates.metadata,
        },
      });
      if (error) return authError(error.message, _mapSupabaseError(error));
      return authOk(_mapUser(data.user));
    } catch (err) {
      return authError(err.message, AuthErrorCode.NETWORK_ERROR);
    }
  }

  async sendPasswordReset(email) {
    try {
      const { error } = await this._client.auth.resetPasswordForEmail(email, {
        redirectTo: this._redirectUrl,
      });
      if (error) return authError(error.message, _mapSupabaseError(error));
      return authOk(null);
    } catch (err) {
      return authError(err.message, AuthErrorCode.NETWORK_ERROR);
    }
  }

  // ── State Change Subscription ────────────────────────────────────────────────

  onAuthStateChange(listener) {
    const { data: { subscription } } = this._client.auth.onAuthStateChange((event, session) => {
      const user = session?.user ? _mapUser(session.user) : null;
      listener(_mapAuthEvent(event), user);
    });
    return () => subscription.unsubscribe();
  }
}

// ─── Mapping Helpers ──────────────────────────────────────────────────────────

function _mapUser(raw) {
  if (!raw) return null;
  return {
    id:            raw.id,
    email:         raw.email,
    name:          raw.user_metadata?.name || raw.user_metadata?.full_name || null,
    avatarUrl:     raw.user_metadata?.avatar_url || null,
    role:          raw.user_metadata?.role || 'owner',
    emailVerified: raw.email_confirmed_at != null,
    metadata:      raw.user_metadata || {},
    createdAt:     raw.created_at ? new Date(raw.created_at).getTime() : Date.now(),
    lastSeenAt:    raw.last_sign_in_at ? new Date(raw.last_sign_in_at).getTime() : Date.now(),
  };
}

function _mapSession(raw) {
  if (!raw) return null;
  return {
    sessionId:    raw.access_token?.slice(-16) || _randomId(),
    userId:       raw.user?.id || null,
    deviceId:     _getDeviceId(),
    deviceName:   _getDeviceName(),
    issuedAt:     Date.now(),
    expiresAt:    raw.expires_at ? raw.expires_at * 1000 : Date.now() + 3600_000,
    isPersistent: true,
  };
}

function _mapSupabaseError(error) {
  const msg = error?.message?.toLowerCase() || '';
  if (msg.includes('invalid login') || msg.includes('invalid credentials')) return AuthErrorCode.INVALID_CREDENTIALS;
  if (msg.includes('email not confirmed'))  return AuthErrorCode.EMAIL_NOT_VERIFIED;
  if (msg.includes('user not found'))       return AuthErrorCode.USER_NOT_FOUND;
  if (msg.includes('already registered'))   return AuthErrorCode.EMAIL_IN_USE;
  if (msg.includes('password'))             return AuthErrorCode.WEAK_PASSWORD;
  if (msg.includes('rate limit'))           return AuthErrorCode.RATE_LIMITED;
  if (msg.includes('expired'))              return AuthErrorCode.SESSION_EXPIRED;
  return AuthErrorCode.PROVIDER_ERROR;
}

function _mapAuthEvent(supabaseEvent) {
  const map = {
    SIGNED_IN:           'auth:signed_in',
    SIGNED_OUT:          'auth:signed_out',
    TOKEN_REFRESHED:     'auth:session_refreshed',
    USER_UPDATED:        'auth:user_updated',
    PASSWORD_RECOVERY:   'auth:password_reset',
  };
  return map[supabaseEvent] || supabaseEvent;
}

function _getDeviceId() {
  if (typeof localStorage === 'undefined') return 'server';
  let id = localStorage.getItem('nuvra_device_id');
  if (!id) {
    id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('nuvra_device_id', id);
  }
  return id;
}

function _getDeviceName() {
  if (typeof navigator === 'undefined') return 'Unknown Device';
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua))  return 'iPhone';
  if (/iPad/.test(ua))    return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua))     return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Linux/.test(ua))   return 'Linux';
  return 'Browser';
}

function _randomId() {
  return Math.random().toString(36).slice(2, 18);
}
