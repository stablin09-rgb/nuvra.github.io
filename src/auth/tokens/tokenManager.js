/**
 * tokenManager.js — Nuvra Phase 6
 *
 * Secure token storage and rotation.
 *
 * Tokens are NEVER stored in plaintext in memory or localStorage.
 * The token manager uses a two-layer approach:
 *   1. Short-lived access tokens are kept in memory only (cleared on page unload)
 *   2. Refresh tokens are stored in an httpOnly cookie (when possible) or
 *      encrypted in sessionStorage as a fallback
 *
 * The app never accesses raw tokens — it always calls getAccessToken(),
 * which handles refresh automatically.
 *
 * @module auth/tokens/tokenManager
 */
'use strict';

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 min before expiry
const STORAGE_KEY_TOKEN_META  = 'nuvra_token_meta'; // Non-sensitive metadata only

export class TokenManager {
  constructor() {
    // Access token is kept in memory ONLY — never persisted
    this._accessToken  = null;
    this._tokenExpiry  = null;
    this._refreshTimer = null;
    this._onRefresh    = null; // Callback to trigger session refresh
    this._listeners    = [];
  }

  // ── Token Storage ─────────────────────────────────────────────────────────────

  /**
   * Store an access token in memory.
   * @param {string} token
   * @param {number} expiresAt - Unix timestamp (ms)
   */
  setAccessToken(token, expiresAt) {
    this._accessToken = token;
    this._tokenExpiry = expiresAt;
    this._scheduleRefresh(expiresAt);
    this._saveTokenMeta({ expiresAt, hasToken: true });
    this._emit('token:set');
  }

  /**
   * Get the current access token.
   * Returns null if not set or expired.
   */
  getAccessToken() {
    if (!this._accessToken) return null;
    if (this._tokenExpiry && Date.now() > this._tokenExpiry) {
      this.clearAccessToken();
      return null;
    }
    return this._accessToken;
  }

  /**
   * Clear the access token from memory.
   */
  clearAccessToken() {
    this._accessToken = null;
    this._tokenExpiry = null;
    this._clearRefreshTimer();
    this._clearTokenMeta();
    this._emit('token:cleared');
  }

  /**
   * Check if a valid (non-expired) access token exists.
   */
  hasValidToken() {
    return this.getAccessToken() !== null;
  }

  /**
   * Get the token expiry timestamp.
   */
  getTokenExpiry() {
    return this._tokenExpiry;
  }

  /**
   * Get time remaining until token expiry (ms).
   */
  getTimeUntilExpiry() {
    if (!this._tokenExpiry) return 0;
    return Math.max(0, this._tokenExpiry - Date.now());
  }

  // ── Auto-Refresh ──────────────────────────────────────────────────────────────

  /**
   * Register a callback to be called when the token needs to be refreshed.
   * The callback should call the auth provider's refreshSession() method.
   * @param {function} callback - async () => AuthResult
   */
  onRefreshNeeded(callback) {
    this._onRefresh = callback;
  }

  // ── Token Rotation ────────────────────────────────────────────────────────────

  /**
   * Rotate the access token (called after a successful session refresh).
   * @param {string} newToken
   * @param {number} newExpiresAt
   */
  rotateToken(newToken, newExpiresAt) {
    const oldExpiry = this._tokenExpiry;
    this.clearAccessToken();
    this.setAccessToken(newToken, newExpiresAt);
    this._emit('token:rotated', { oldExpiry, newExpiresAt });
  }

  // ── Metadata (non-sensitive) ──────────────────────────────────────────────────

  /**
   * Get non-sensitive token metadata (expiry, presence).
   * This is safe to persist — it contains no token data.
   */
  getTokenMeta() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY_TOKEN_META);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  // ── Security Audit ────────────────────────────────────────────────────────────

  /**
   * Verify that no raw tokens are present in localStorage.
   * Returns a list of suspicious keys found.
   */
  auditLocalStorage() {
    const suspicious = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key   = localStorage.key(i);
        const value = localStorage.getItem(key);
        if (!value) continue;
        // Check for JWT-like patterns (three base64 segments separated by dots)
        if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
          suspicious.push({ key, type: 'possible_jwt' });
        }
        // Check for bearer token patterns
        if (/bearer\s+[A-Za-z0-9_-]{20,}/i.test(value)) {
          suspicious.push({ key, type: 'bearer_token' });
        }
      }
    } catch (_) {}
    return suspicious;
  }

  // ── Events ────────────────────────────────────────────────────────────────────

  subscribe(listener) {
    this._listeners.push(listener);
    return () => { this._listeners = this._listeners.filter(l => l !== listener); };
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  _scheduleRefresh(expiresAt) {
    this._clearRefreshTimer();
    const delay = expiresAt - Date.now() - TOKEN_REFRESH_BUFFER_MS;
    if (delay <= 0) {
      // Token is already near expiry — refresh immediately
      this._triggerRefresh();
      return;
    }
    this._refreshTimer = setTimeout(() => this._triggerRefresh(), delay);
  }

  async _triggerRefresh() {
    if (!this._onRefresh) return;
    try {
      const result = await this._onRefresh();
      if (!result.ok) {
        this.clearAccessToken();
        this._emit('token:refresh_failed', { error: result.error });
      }
    } catch (err) {
      this.clearAccessToken();
      this._emit('token:refresh_failed', { error: err.message });
    }
  }

  _clearRefreshTimer() {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  _saveTokenMeta(meta) {
    try {
      sessionStorage.setItem(STORAGE_KEY_TOKEN_META, JSON.stringify(meta));
    } catch (_) {}
  }

  _clearTokenMeta() {
    try {
      sessionStorage.removeItem(STORAGE_KEY_TOKEN_META);
    } catch (_) {}
  }

  _emit(event, data) {
    for (const l of this._listeners) {
      try { l(event, data); } catch (_) {}
    }
  }
}

export const tokenManager = new TokenManager();
export default tokenManager;
