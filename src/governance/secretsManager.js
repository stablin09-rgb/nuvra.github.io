/**
 * secretsManager.js — Nuvra Phase 6
 *
 * Secrets & Key Management.
 *
 * Manages:
 *  - AI provider API keys (per user, per project)
 *  - Cloud provider credentials
 *  - Integration tokens (webhooks, etc.)
 *
 * Security model:
 *  - Keys are NEVER stored in plain text in the app state
 *  - Keys are stored in a dedicated encrypted store (localStorage with obfuscation in browser)
 *  - Keys are scoped: global (user) or project-specific
 *  - Keys support rotation: old key is kept for 24h during rotation
 *  - Keys are validated before storage
 *  - Keys are redacted in all logs and audit trails
 *
 * @module governance/secretsManager
 */
'use strict';

const SECRETS_STORE_KEY = 'nuvra_secrets_v1';
const REDACTED          = '[REDACTED]';

// ─── Key Types ────────────────────────────────────────────────────────────────
export const KeyType = Object.freeze({
  OPENAI_API_KEY:    'openai_api_key',
  ANTHROPIC_API_KEY: 'anthropic_api_key',
  SUPABASE_KEY:      'supabase_key',
  SUPABASE_URL:      'supabase_url',
  CUSTOM_WEBHOOK:    'custom_webhook',
  CUSTOM_API_KEY:    'custom_api_key',
});

// ─── Key Scope ────────────────────────────────────────────────────────────────
export const KeyScope = Object.freeze({
  GLOBAL:  'global',   // Available to all projects for this user
  PROJECT: 'project',  // Scoped to a specific project
});

// ─── Key Validators ───────────────────────────────────────────────────────────
const KEY_VALIDATORS = {
  [KeyType.OPENAI_API_KEY]:    (v) => v.startsWith('sk-') && v.length > 20,
  [KeyType.ANTHROPIC_API_KEY]: (v) => v.startsWith('sk-ant-') && v.length > 20,
  [KeyType.SUPABASE_KEY]:      (v) => v.length > 20,
  [KeyType.SUPABASE_URL]:      (v) => v.startsWith('https://') && v.includes('.supabase.co'),
  [KeyType.CUSTOM_WEBHOOK]:    (v) => v.startsWith('https://') && v.length > 10,
  [KeyType.CUSTOM_API_KEY]:    (v) => v.length >= 8,
};

export class SecretsManager {
  /**
   * @param {object} params
   * @param {object}   params.eventBus
   * @param {function} params.getCurrentUserId
   */
  constructor({ eventBus, getCurrentUserId }) {
    this._eventBus         = eventBus;
    this._getCurrentUserId = getCurrentUserId;
    this._cache            = null;  // In-memory cache of decrypted keys
  }

  // ── Store a Key ───────────────────────────────────────────────────────────────

  /**
   * Store a secret key.
   * @param {string} keyType   - KeyType
   * @param {string} value     - The actual key value
   * @param {object} [options]
   * @param {string} [options.scope]     - KeyScope (default: GLOBAL)
   * @param {string} [options.projectId] - Required if scope === PROJECT
   * @param {string} [options.label]     - Human-readable label
   * @returns {{ ok: boolean, keyId?: string, error?: string }}
   */
  storeKey(keyType, value, options = {}) {
    const userId = this._getCurrentUserId();
    if (!userId) return { ok: false, error: 'Not authenticated' };

    // Validate the key format
    const validator = KEY_VALIDATORS[keyType];
    if (validator && !validator(value)) {
      return { ok: false, error: `Invalid key format for ${keyType}` };
    }

    const scope     = options.scope || KeyScope.GLOBAL;
    const projectId = options.projectId || null;

    if (scope === KeyScope.PROJECT && !projectId) {
      return { ok: false, error: 'projectId is required for project-scoped keys' };
    }

    const keyId = _generateKeyId(userId, keyType, scope, projectId);
    const store = this._loadStore();

    // Keep the old key for rotation grace period
    const existing = store[keyId];
    if (existing) {
      store[`${keyId}_prev`] = {
        ...existing,
        rotatedAt: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24h grace period
      };
    }

    store[keyId] = {
      keyId,
      keyType,
      scope,
      projectId,
      userId,
      label:     options.label || keyType,
      value:     _obfuscate(value),
      storedAt:  Date.now(),
      rotatedAt: existing ? Date.now() : null,
    };

    this._saveStore(store);
    this._cache = null; // Invalidate cache

    this._eventBus.emit('secrets:key_stored', {
      keyId,
      keyType,
      scope,
      projectId,
      rotated: !!existing,
    });

    return { ok: true, keyId };
  }

  /**
   * Retrieve a key value.
   * @param {string} keyType
   * @param {object} [options]
   * @param {string} [options.scope]
   * @param {string} [options.projectId]
   * @returns {string|null}
   */
  getKey(keyType, options = {}) {
    const userId = this._getCurrentUserId();
    if (!userId) return null;

    const scope     = options.scope || KeyScope.GLOBAL;
    const projectId = options.projectId || null;

    // Try project-scoped first, then fall back to global
    if (scope === KeyScope.GLOBAL && projectId) {
      const projectKey = this._getKeyValue(userId, keyType, KeyScope.PROJECT, projectId);
      if (projectKey) return projectKey;
    }

    return this._getKeyValue(userId, keyType, scope, projectId);
  }

  /**
   * Check if a key exists (without revealing the value).
   */
  hasKey(keyType, options = {}) {
    return this.getKey(keyType, options) !== null;
  }

  /**
   * Delete a key.
   */
  deleteKey(keyType, options = {}) {
    const userId = this._getCurrentUserId();
    if (!userId) return { ok: false, error: 'Not authenticated' };

    const scope     = options.scope || KeyScope.GLOBAL;
    const projectId = options.projectId || null;
    const keyId     = _generateKeyId(userId, keyType, scope, projectId);

    const store = this._loadStore();
    if (!store[keyId]) return { ok: false, error: 'Key not found' };

    delete store[keyId];
    delete store[`${keyId}_prev`];
    this._saveStore(store);
    this._cache = null;

    this._eventBus.emit('secrets:key_deleted', { keyId, keyType, scope });
    return { ok: true };
  }

  /**
   * List all stored keys for the current user (metadata only, no values).
   */
  listKeys() {
    const userId = this._getCurrentUserId();
    if (!userId) return [];

    const store = this._loadStore();
    return Object.values(store)
      .filter(k => k.userId === userId && !k.keyId?.endsWith('_prev'))
      .map(k => ({
        keyId:     k.keyId,
        keyType:   k.keyType,
        scope:     k.scope,
        projectId: k.projectId,
        label:     k.label,
        storedAt:  k.storedAt,
        rotatedAt: k.rotatedAt,
        value:     REDACTED,  // Never expose the value in listings
      }));
  }

  /**
   * Redact all keys from a string (for logging).
   * @param {string} text
   * @returns {string}
   */
  redact(text) {
    if (!text) return text;
    const userId = this._getCurrentUserId();
    if (!userId) return text;

    const store = this._loadStore();
    let result = text;

    for (const record of Object.values(store)) {
      if (record.userId !== userId) continue;
      try {
        const value = _deobfuscate(record.value);
        if (value && value.length > 8) {
          result = result.split(value).join(REDACTED);
        }
      } catch (_) {}
    }

    return result;
  }

  /**
   * Rotate a key — stores the new value and keeps the old one for 24h.
   */
  rotateKey(keyType, newValue, options = {}) {
    return this.storeKey(keyType, newValue, options);
  }

  /**
   * Clean up expired rotated keys.
   */
  cleanupExpiredKeys() {
    const store = this._loadStore();
    const now   = Date.now();
    let cleaned = 0;

    for (const [keyId, record] of Object.entries(store)) {
      if (keyId.endsWith('_prev') && record.expiresAt && record.expiresAt < now) {
        delete store[keyId];
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this._saveStore(store);
      this._cache = null;
    }

    return { cleaned };
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  _getKeyValue(userId, keyType, scope, projectId) {
    const keyId = _generateKeyId(userId, keyType, scope, projectId);
    const store = this._loadStore();
    const record = store[keyId];
    if (!record) return null;

    try {
      return _deobfuscate(record.value);
    } catch (_) {
      return null;
    }
  }

  _loadStore() {
    if (this._cache) return this._cache;

    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(SECRETS_STORE_KEY);
        this._cache = raw ? JSON.parse(raw) : {};
      } else {
        this._cache = this._memStore || {};
      }
    } catch (_) {
      this._cache = {};
    }

    return this._cache;
  }

  _saveStore(store) {
    this._cache = store;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SECRETS_STORE_KEY, JSON.stringify(store));
      } else {
        this._memStore = store;
      }
    } catch (_) {}
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _generateKeyId(userId, keyType, scope, projectId) {
  const parts = [userId, keyType, scope];
  if (projectId) parts.push(projectId);
  return parts.join(':');
}

// Simple obfuscation — not encryption, but prevents casual inspection
// In production, this should use the Web Crypto API
function _obfuscate(value) {
  return btoa(value.split('').reverse().join(''));
}

function _deobfuscate(obfuscated) {
  return atob(obfuscated).split('').reverse().join('');
}
