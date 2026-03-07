/**
 * sessionManager.js — Nuvra Phase 6
 *
 * Device-aware session tracking and persistence.
 *
 * Tracks:
 *  - The current session (userId, deviceId, expiry)
 *  - Session history (for multi-device awareness)
 *  - Session invalidation (logout from all devices)
 *
 * @module auth/session/sessionManager
 */
'use strict';

const STORAGE_KEY_SESSION  = 'nuvra_session';
const STORAGE_KEY_DEVICE   = 'nuvra_device_id';
const SESSION_TTL_MS       = 7 * 24 * 60 * 60 * 1000; // 7 days

export class SessionManager {
  constructor() {
    this._session   = null;
    this._listeners = [];
    this._loadSession();
  }

  // ── Session Lifecycle ─────────────────────────────────────────────────────────

  /**
   * Create and persist a new session.
   * @param {object} params
   * @param {string} params.userId
   * @param {boolean} [params.persistent] - Whether to survive browser close
   * @returns {SessionRecord}
   */
  createSession({ userId, persistent = true }) {
    const session = {
      sessionId:    _generateId('sess'),
      userId,
      deviceId:     this.getDeviceId(),
      deviceName:   _getDeviceName(),
      issuedAt:     Date.now(),
      expiresAt:    Date.now() + SESSION_TTL_MS,
      isPersistent: persistent,
      lastActiveAt: Date.now(),
    };

    this._session = session;
    this._persistSession(session);
    this._emit('session:created', session);
    return session;
  }

  /**
   * Restore a session from a provider's session record.
   * @param {SessionRecord} session
   */
  restoreSession(session) {
    if (!session || !session.userId) return;
    this._session = { ...session, lastActiveAt: Date.now() };
    this._persistSession(this._session);
    this._emit('session:restored', this._session);
  }

  /**
   * Invalidate the current session.
   */
  clearSession() {
    const old = this._session;
    this._session = null;
    this._clearPersistedSession();
    this._emit('session:cleared', old);
  }

  /**
   * Touch the session (update lastActiveAt).
   */
  touch() {
    if (!this._session) return;
    this._session.lastActiveAt = Date.now();
    this._persistSession(this._session);
  }

  // ── Session Queries ───────────────────────────────────────────────────────────

  /**
   * Get the current session. Returns null if no active session.
   */
  getSession() {
    if (!this._session) return null;
    if (this._session.expiresAt < Date.now()) {
      this.clearSession();
      return null;
    }
    return this._session;
  }

  /**
   * Check if there is a valid active session.
   */
  isAuthenticated() {
    return this.getSession() !== null;
  }

  /**
   * Get the current user ID.
   */
  getUserId() {
    return this.getSession()?.userId || null;
  }

  /**
   * Get the stable device ID for this browser/device.
   */
  getDeviceId() {
    if (typeof localStorage === 'undefined') return 'server';
    let id = localStorage.getItem(STORAGE_KEY_DEVICE);
    if (!id) {
      id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem(STORAGE_KEY_DEVICE, id); } catch (_) {}
    }
    return id;
  }

  /**
   * Extend the session expiry (called on successful token refresh).
   */
  extendSession(newExpiresAt) {
    if (!this._session) return;
    this._session.expiresAt    = newExpiresAt || Date.now() + SESSION_TTL_MS;
    this._session.lastActiveAt = Date.now();
    this._persistSession(this._session);
    this._emit('session:extended', this._session);
  }

  /**
   * Get session metadata (safe to expose to UI).
   */
  getSessionInfo() {
    const s = this.getSession();
    if (!s) return null;
    return {
      deviceId:     s.deviceId,
      deviceName:   s.deviceName,
      issuedAt:     s.issuedAt,
      expiresAt:    s.expiresAt,
      lastActiveAt: s.lastActiveAt,
      isPersistent: s.isPersistent,
      timeUntilExpiry: Math.max(0, s.expiresAt - Date.now()),
    };
  }

  // ── Events ────────────────────────────────────────────────────────────────────

  subscribe(listener) {
    this._listeners.push(listener);
    return () => { this._listeners = this._listeners.filter(l => l !== listener); };
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  _loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SESSION);
      if (raw) {
        const session = JSON.parse(raw);
        if (session.expiresAt > Date.now()) {
          this._session = session;
        } else {
          this._clearPersistedSession();
        }
      }
    } catch (_) {}
  }

  _persistSession(session) {
    try {
      if (session.isPersistent) {
        localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
      } else {
        sessionStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
      }
    } catch (_) {}
  }

  _clearPersistedSession() {
    try {
      localStorage.removeItem(STORAGE_KEY_SESSION);
      sessionStorage.removeItem(STORAGE_KEY_SESSION);
    } catch (_) {}
  }

  _emit(event, data) {
    for (const l of this._listeners) {
      try { l(event, data); } catch (_) {}
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _generateId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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

export const sessionManager = new SessionManager();
export default sessionManager;
