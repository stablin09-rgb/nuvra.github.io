/**
 * localAuthProvider.js — Nuvra Phase 6
 *
 * Local (offline/mock) authentication provider.
 * Used when no cloud auth provider is configured, for testing,
 * and for offline-first development.
 *
 * Stores user records and sessions in localStorage.
 * Passwords are hashed with a simple PBKDF2-like approach (not production-grade
 * cryptography — this provider is for development and offline use only).
 *
 * @module auth/providers/localAuthProvider
 */
'use strict';

import { AuthProviderContract, AuthErrorCode, authOk, authError } from './authContract.js';

const STORAGE_KEY_USERS    = 'nuvra_local_auth_users';
const STORAGE_KEY_SESSION  = 'nuvra_local_auth_session';
const SESSION_TTL_MS       = 7 * 24 * 60 * 60 * 1000; // 7 days

export class LocalAuthProvider extends AuthProviderContract {
  constructor() {
    super();
    this._listeners = [];
    this._session   = null;
    this._loadSession();
  }

  get id()    { return 'local'; }
  get label() { return 'Local Auth (offline)'; }

  // ── Sign Up ──────────────────────────────────────────────────────────────────

  async signUp(email, password, metadata = {}) {
    if (!email || !password) return authError('Email and password are required', AuthErrorCode.INVALID_CREDENTIALS);
    if (password.length < 8)  return authError('Password must be at least 8 characters', AuthErrorCode.WEAK_PASSWORD);

    const users = this._getUsers();
    if (users[email]) return authError('Email already in use', AuthErrorCode.EMAIL_IN_USE);

    const user = {
      id:            _generateId('usr'),
      email,
      name:          metadata.name || null,
      avatarUrl:     null,
      role:          'owner',
      emailVerified: true, // Local auth auto-verifies
      metadata:      metadata || {},
      createdAt:     Date.now(),
      lastSeenAt:    Date.now(),
      _passwordHash: _hashPassword(password),
    };

    users[email] = user;
    this._saveUsers(users);

    const session = this._createSession(user.id);
    this._saveSession(session);
    this._emit('auth:signed_in', user);

    return authOk(_publicUser(user), session);
  }

  // ── Sign In ──────────────────────────────────────────────────────────────────

  async signInWithPassword(email, password) {
    if (!email || !password) return authError('Email and password are required', AuthErrorCode.INVALID_CREDENTIALS);

    const users = this._getUsers();
    const user  = users[email];

    if (!user) return authError('Invalid email or password', AuthErrorCode.INVALID_CREDENTIALS);
    if (user._passwordHash !== _hashPassword(password)) {
      return authError('Invalid email or password', AuthErrorCode.INVALID_CREDENTIALS);
    }

    user.lastSeenAt = Date.now();
    this._saveUsers(users);

    const session = this._createSession(user.id);
    this._saveSession(session);
    this._emit('auth:signed_in', _publicUser(user));

    return authOk(_publicUser(user), session);
  }

  async sendMagicLink(email, options = {}) {
    // In local mode, magic links are simulated — we just sign in directly
    // if the user exists, or create them if shouldCreateUser is true
    const users = this._getUsers();
    let user = users[email];

    if (!user) {
      if (options.shouldCreateUser === false) {
        return authError('User not found', AuthErrorCode.USER_NOT_FOUND);
      }
      // Auto-create user for magic link
      user = {
        id:            _generateId('usr'),
        email,
        name:          null,
        avatarUrl:     null,
        role:          'owner',
        emailVerified: true,
        metadata:      {},
        createdAt:     Date.now(),
        lastSeenAt:    Date.now(),
        _passwordHash: null,
      };
      users[email] = user;
      this._saveUsers(users);
    }

    // In local mode, immediately sign in (simulates clicking the magic link)
    const session = this._createSession(user.id);
    this._saveSession(session);
    this._emit('auth:signed_in', _publicUser(user));

    return authOk(_publicUser(user), session);
  }

  async signInWithOAuth(provider, options = {}) {
    // Local mode: create a mock OAuth user
    const email = `oauth_${provider}_user@local.nuvra`;
    const users = this._getUsers();
    let user = users[email];

    if (!user) {
      user = {
        id:            _generateId('usr'),
        email,
        name:          `${provider.charAt(0).toUpperCase() + provider.slice(1)} User`,
        avatarUrl:     null,
        role:          'owner',
        emailVerified: true,
        metadata:      { provider },
        createdAt:     Date.now(),
        lastSeenAt:    Date.now(),
        _passwordHash: null,
      };
      users[email] = user;
      this._saveUsers(users);
    }

    const session = this._createSession(user.id);
    this._saveSession(session);
    this._emit('auth:signed_in', _publicUser(user));

    return authOk(_publicUser(user), session);
  }

  // ── Sign Out ─────────────────────────────────────────────────────────────────

  async signOut() {
    this._session = null;
    this._clearSession();
    this._emit('auth:signed_out', null);
    return authOk(null, null);
  }

  // ── Session ──────────────────────────────────────────────────────────────────

  async getCurrentUser() {
    if (!this._session) return null;
    if (this._session.expiresAt < Date.now()) {
      await this.signOut();
      return null;
    }

    const users = this._getUsers();
    const user  = Object.values(users).find(u => u.id === this._session.userId);
    return user ? _publicUser(user) : null;
  }

  async refreshSession() {
    if (!this._session) return authError('No active session', AuthErrorCode.NOT_AUTHENTICATED);

    const user = await this.getCurrentUser();
    if (!user) return authError('Session expired', AuthErrorCode.SESSION_EXPIRED);

    this._session.expiresAt = Date.now() + SESSION_TTL_MS;
    this._session.issuedAt  = Date.now();
    this._saveSession(this._session);
    this._emit('auth:session_refreshed', user);

    return authOk(user, this._session);
  }

  async getAccessToken() {
    if (!this._session || this._session.expiresAt < Date.now()) return null;
    // Local tokens are just the session ID — not a real JWT
    return `local_token_${this._session.sessionId}`;
  }

  // ── Profile ──────────────────────────────────────────────────────────────────

  async updateProfile(updates) {
    const user = await this.getCurrentUser();
    if (!user) return authError('Not authenticated', AuthErrorCode.NOT_AUTHENTICATED);

    const users = this._getUsers();
    const stored = users[user.email];
    if (!stored) return authError('User not found', AuthErrorCode.USER_NOT_FOUND);

    if (updates.name)      stored.name      = updates.name;
    if (updates.avatarUrl) stored.avatarUrl = updates.avatarUrl;
    if (updates.metadata)  stored.metadata  = { ...stored.metadata, ...updates.metadata };

    this._saveUsers(users);
    this._emit('auth:user_updated', _publicUser(stored));

    return authOk(_publicUser(stored));
  }

  async sendPasswordReset(email) {
    // Local mode: just confirm it would work
    const users = this._getUsers();
    if (!users[email]) return authError('User not found', AuthErrorCode.USER_NOT_FOUND);
    return authOk(null);
  }

  // ── State Change Subscription ────────────────────────────────────────────────

  onAuthStateChange(listener) {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter(l => l !== listener);
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  _getUsers() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_USERS) || '{}');
    } catch (_) {
      return {};
    }
  }

  _saveUsers(users) {
    try {
      localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(users));
    } catch (_) {}
  }

  _createSession(userId) {
    return {
      sessionId:    _generateId('sess'),
      userId,
      deviceId:     _getDeviceId(),
      deviceName:   _getDeviceName(),
      issuedAt:     Date.now(),
      expiresAt:    Date.now() + SESSION_TTL_MS,
      isPersistent: true,
    };
  }

  _saveSession(session) {
    this._session = session;
    try {
      localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
    } catch (_) {}
  }

  _clearSession() {
    try {
      localStorage.removeItem(STORAGE_KEY_SESSION);
    } catch (_) {}
  }

  _loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SESSION);
      if (raw) this._session = JSON.parse(raw);
    } catch (_) {}
  }

  _emit(event, user) {
    for (const l of this._listeners) {
      try { l(event, user); } catch (_) {}
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _publicUser(user) {
  const { _passwordHash: _, ...pub } = user;
  return pub;
}

function _hashPassword(password) {
  // Simple deterministic hash for local dev — NOT production cryptography
  let hash = 0;
  const salted = 'nuvra_salt_' + password;
  for (let i = 0; i < salted.length; i++) {
    hash = ((hash << 5) - hash) + salted.charCodeAt(i);
    hash |= 0;
  }
  return 'local_' + Math.abs(hash).toString(36);
}

function _generateId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function _getDeviceId() {
  if (typeof localStorage === 'undefined') return 'server';
  let id = localStorage.getItem('nuvra_device_id');
  if (!id) {
    id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    try { localStorage.setItem('nuvra_device_id', id); } catch (_) {}
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
  return 'Browser';
}
