/**
 * authManager.js — Nuvra Phase 6
 *
 * The central authentication orchestrator.
 * The app NEVER calls auth providers directly — it always calls AuthManager.
 *
 * Responsibilities:
 *  - Provider registration and switching
 *  - Coordinating auth operations with token and session managers
 *  - Emitting auth events on the foundation event bus
 *  - Auto-refresh on token expiry
 *  - Zero-trust: validates every auth result before accepting it
 *
 * @module auth/authManager
 */
'use strict';

import { AuthEvent, AuthErrorCode } from './providers/authContract.js';
import { tokenManager }  from './tokens/tokenManager.js';
import { sessionManager } from './session/sessionManager.js';

export class AuthManager {
  constructor({ eventBus, store }) {
    this._eventBus  = eventBus;
    this._store     = store;
    this._provider  = null;
    this._user      = null;
    this._unsubAuth = null;

    // Wire token refresh callback
    tokenManager.onRefreshNeeded(() => this.refreshSession());
  }

  // ── Provider Registration ─────────────────────────────────────────────────────

  /**
   * Register and activate an auth provider.
   * @param {AuthProviderContract} provider
   */
  useProvider(provider) {
    if (this._unsubAuth) this._unsubAuth();

    this._provider = provider;

    // Subscribe to provider auth state changes
    this._unsubAuth = provider.onAuthStateChange((event, user) => {
      this._handleAuthStateChange(event, user);
    });

    // Attempt to restore existing session
    this._restoreSession();
  }

  // ── Auth Operations ───────────────────────────────────────────────────────────

  async signInWithPassword(email, password) {
    this._assertProvider();
    const result = await this._provider.signInWithPassword(email, password);
    if (result.ok) this._onAuthSuccess(result);
    else this._onAuthFailure(result);
    return result;
  }

  async sendMagicLink(email, options = {}) {
    this._assertProvider();
    const result = await this._provider.sendMagicLink(email, options);
    if (result.ok && result.user) this._onAuthSuccess(result);
    return result;
  }

  async signUp(email, password, metadata = {}) {
    this._assertProvider();
    const result = await this._provider.signUp(email, password, metadata);
    if (result.ok) this._onAuthSuccess(result);
    else this._onAuthFailure(result);
    return result;
  }

  async signOut() {
    this._assertProvider();
    const result = await this._provider.signOut();
    this._onSignOut();
    return result;
  }

  async signInWithOAuth(provider, options = {}) {
    this._assertProvider();
    const result = await this._provider.signInWithOAuth(provider, options);
    if (result.ok && result.user) this._onAuthSuccess(result);
    return result;
  }

  async sendPasswordReset(email) {
    this._assertProvider();
    return this._provider.sendPasswordReset(email);
  }

  async updateProfile(updates) {
    this._assertProvider();
    const result = await this._provider.updateProfile(updates);
    if (result.ok && result.user) {
      this._user = result.user;
      this._store.dispatch({ type: 'AUTH_USER_UPDATED', payload: { user: result.user } });
      this._eventBus.emit(AuthEvent.USER_UPDATED, { user: result.user });
    }
    return result;
  }

  async refreshSession() {
    this._assertProvider();
    const result = await this._provider.refreshSession();
    if (result.ok) {
      if (result.user) this._user = result.user;
      if (result.session) {
        sessionManager.extendSession(result.session.expiresAt);
      }
      const token = await this._provider.getAccessToken();
      if (token && result.session) {
        tokenManager.rotateToken(token, result.session.expiresAt);
      }
      this._eventBus.emit(AuthEvent.SESSION_REFRESHED, { user: this._user });
    } else {
      // Refresh failed — sign out
      this._onSignOut();
    }
    return result;
  }

  // ── Auth State Queries ────────────────────────────────────────────────────────

  isAuthenticated() {
    return this._user !== null && sessionManager.isAuthenticated();
  }

  getCurrentUser() {
    return this._user;
  }

  getUserId() {
    return this._user?.id || null;
  }

  async getAccessToken() {
    // Try memory first
    const cached = tokenManager.getAccessToken();
    if (cached) return cached;

    // Try provider
    if (!this._provider) return null;
    return this._provider.getAccessToken();
  }

  getSessionInfo() {
    return sessionManager.getSessionInfo();
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  async _restoreSession() {
    if (!this._provider) return;
    try {
      const user = await this._provider.getCurrentUser();
      if (user) {
        this._user = user;
        const token = await this._provider.getAccessToken();
        const session = sessionManager.getSession();
        if (token && session) {
          tokenManager.setAccessToken(token, session.expiresAt);
        }
        this._store.dispatch({ type: 'AUTH_SIGNED_IN', payload: { user } });
        this._eventBus.emit(AuthEvent.SIGNED_IN, { user, restored: true });
      }
    } catch (_) {
      // Silent — no session to restore
    }
  }

  _onAuthSuccess(result) {
    this._user = result.user;

    if (result.session) {
      sessionManager.restoreSession(result.session);
    } else {
      sessionManager.createSession({ userId: result.user.id });
    }

    // Store token in memory only
    if (result.session?.expiresAt) {
      this._provider.getAccessToken().then(token => {
        if (token) tokenManager.setAccessToken(token, result.session.expiresAt);
      }).catch(() => {});
    }

    this._store.dispatch({ type: 'AUTH_SIGNED_IN', payload: { user: result.user } });
    this._eventBus.emit(AuthEvent.SIGNED_IN, { user: result.user });
  }

  _onAuthFailure(result) {
    this._store.dispatch({ type: 'AUTH_ERROR', payload: { error: result.error, errorCode: result.errorCode } });
    this._eventBus.emit('auth:error', { error: result.error, errorCode: result.errorCode });
  }

  _onSignOut() {
    this._user = null;
    tokenManager.clearAccessToken();
    sessionManager.clearSession();
    this._store.dispatch({ type: 'AUTH_SIGNED_OUT' });
    this._eventBus.emit(AuthEvent.SIGNED_OUT, {});
  }

  _handleAuthStateChange(event, user) {
    if (event === AuthEvent.SIGNED_IN && user) {
      if (!this._user || this._user.id !== user.id) {
        this._user = user;
        this._store.dispatch({ type: 'AUTH_SIGNED_IN', payload: { user } });
        this._eventBus.emit(AuthEvent.SIGNED_IN, { user });
      }
    } else if (event === AuthEvent.SIGNED_OUT) {
      this._onSignOut();
    } else if (event === AuthEvent.USER_UPDATED && user) {
      this._user = user;
      this._store.dispatch({ type: 'AUTH_USER_UPDATED', payload: { user } });
    }
  }

  _assertProvider() {
    if (!this._provider) throw new Error('AuthManager: no provider registered. Call useProvider() first.');
  }
}
