/**
 * storageEngine.js — Nuvra Foundation (Phase 0–1)
 *
 * The local-first persistence layer.
 *
 * Responsibilities:
 *  - Save state snapshots to localStorage deterministically
 *  - Restore state cleanly on load
 *  - Handle corruption gracefully (fallback to empty state)
 *  - Emit save/load/error events on the eventBus
 *  - Support schema versioning via the versioning module
 *  - Keep a rolling backup (last N snapshots) for recovery
 *
 * This is NOT just localStorage.setItem().
 * It is a versioned, observable, corruption-resistant persistence system.
 *
 * @module persistence/storageEngine
 */
'use strict';

import { eventBus }         from '../runtime/eventBus.js';
import { safeJsonParse, safeJsonStringify, now } from '../runtime/utils.js';
import {
  CURRENT_SCHEMA_VERSION,
  runMigrations,
  getSnapshotVersion,
} from './versioning.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_NAMESPACE   = 'nuvra';
const BACKUP_SLOT_COUNT   = 3;
const SAVE_DEBOUNCE_MS    = 1000;

// ─── StorageEngine ────────────────────────────────────────────────────────────
class StorageEngine {
  /**
   * @param {object} [options]
   * @param {string} [options.namespace]    - localStorage key prefix
   * @param {number} [options.backupSlots]  - number of rolling backups
   * @param {Storage} [options.storage]     - injectable storage (default: localStorage)
   */
  constructor({
    namespace   = DEFAULT_NAMESPACE,
    backupSlots = BACKUP_SLOT_COUNT,
    storage     = null,
  } = {}) {
    this._ns          = namespace;
    this._backupSlots = backupSlots;
    this._storage     = storage || this._resolveStorage();
    this._saveTimer   = null;
    this._lastSavedAt = null;
    this._saveCount   = 0;
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Save a state snapshot immediately.
   * @param {object} state - the full store state
   * @returns {{ ok: boolean, error?: string }}
   */
  save(state) {
    if (!state || typeof state !== 'object') {
      return { ok: false, error: 'state must be an object' };
    }

    const snapshot = {
      _schemaVersion: CURRENT_SCHEMA_VERSION,
      _savedAt:       now(),
      _saveCount:     ++this._saveCount,
      state,
    };

    const serialized = safeJsonStringify(snapshot);
    if (!serialized) {
      const err = 'Failed to serialize state';
      eventBus.emit('persistence:error', { op: 'save', error: err });
      return { ok: false, error: err };
    }

    try {
      // Rotate backups before overwriting primary
      this._rotateBackups();

      this._storage.setItem(this._key('state'), serialized);
      this._lastSavedAt = snapshot._savedAt;

      eventBus.emit('persistence:saved', {
        savedAt:   this._lastSavedAt,
        saveCount: this._saveCount,
        bytes:     serialized.length,
      });

      return { ok: true };
    } catch (err) {
      const msg = err?.message || String(err);
      eventBus.emit('persistence:error', { op: 'save', error: msg });
      return { ok: false, error: msg };
    }
  }

  /**
   * Schedule a debounced save (avoids thrashing on rapid state changes).
   * @param {object} state
   * @param {number} [delay]
   */
  scheduleSave(state, delay = SAVE_DEBOUNCE_MS) {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(state), delay);
  }

  /**
   * Load and restore state from storage.
   * Runs migrations if the schema version is outdated.
   * Falls back to null on corruption.
   * @returns {{ state: object|null, version: number, migrationsRun: number[], error?: string }}
   */
  load() {
    const raw = this._storage.getItem(this._key('state'));

    if (!raw) {
      eventBus.emit('persistence:loaded', { found: false });
      return { state: null, version: 0, migrationsRun: [] };
    }

    const parsed = safeJsonParse(raw);
    if (!parsed || typeof parsed !== 'object') {
      const err = 'Stored state is corrupted (invalid JSON)';
      eventBus.emit('persistence:error', { op: 'load', error: err });
      this._flagCorruption();
      return { state: null, version: 0, migrationsRun: [], error: err };
    }

    const storedVersion = getSnapshotVersion(parsed);

    // Run migrations if needed
    let snapshot = parsed;
    let migrationsRun = [];
    if (storedVersion < CURRENT_SCHEMA_VERSION) {
      const result = runMigrations(parsed, storedVersion);
      snapshot      = result.snapshot;
      migrationsRun = result.migrationsRun;
    }

    const state = snapshot.state || null;

    eventBus.emit('persistence:loaded', {
      found:         true,
      version:       storedVersion,
      migrationsRun,
      savedAt:       parsed._savedAt,
    });

    return { state, version: storedVersion, migrationsRun };
  }

  /**
   * Clear all persisted state (primary + backups).
   */
  clear() {
    try {
      this._storage.removeItem(this._key('state'));
      for (let i = 0; i < this._backupSlots; i++) {
        this._storage.removeItem(this._key(`backup_${i}`));
      }
      this._storage.removeItem(this._key('corruption_flag'));
      eventBus.emit('persistence:cleared', {});
    } catch (err) {
      eventBus.emit('persistence:error', { op: 'clear', error: err?.message });
    }
  }

  /**
   * Attempt to restore from the most recent backup.
   * @returns {{ state: object|null, slot: number|null }}
   */
  restoreFromBackup() {
    for (let i = 0; i < this._backupSlots; i++) {
      const raw = this._storage.getItem(this._key(`backup_${i}`));
      if (!raw) continue;
      const parsed = safeJsonParse(raw);
      if (parsed?.state) {
        eventBus.emit('persistence:restored_from_backup', { slot: i });
        return { state: parsed.state, slot: i };
      }
    }
    return { state: null, slot: null };
  }

  /**
   * Check if a corruption flag is set.
   * @returns {boolean}
   */
  isCorrupted() {
    return !!this._storage.getItem(this._key('corruption_flag'));
  }

  /**
   * Get storage diagnostics.
   * @returns {object}
   */
  getStats() {
    const primaryRaw = this._storage.getItem(this._key('state'));
    const backups    = [];
    for (let i = 0; i < this._backupSlots; i++) {
      const raw = this._storage.getItem(this._key(`backup_${i}`));
      backups.push(raw ? safeJsonParse(raw)?._savedAt || null : null);
    }
    return {
      namespace:    this._ns,
      hasState:     !!primaryRaw,
      primaryBytes: primaryRaw?.length || 0,
      lastSavedAt:  this._lastSavedAt,
      saveCount:    this._saveCount,
      isCorrupted:  this.isCorrupted(),
      backups,
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────────
  _key(suffix) {
    return `${this._ns}:${suffix}`;
  }

  _resolveStorage() {
    if (typeof localStorage !== 'undefined') return localStorage;
    // Node.js / test environment fallback
    const mem = new Map();
    return {
      getItem:    (k) => mem.get(k) ?? null,
      setItem:    (k, v) => mem.set(k, v),
      removeItem: (k) => mem.delete(k),
    };
  }

  _rotateBackups() {
    // Shift backup slots: backup_1 → backup_2, backup_0 → backup_1, primary → backup_0
    for (let i = this._backupSlots - 1; i > 0; i--) {
      const prev = this._storage.getItem(this._key(`backup_${i - 1}`));
      if (prev) {
        this._storage.setItem(this._key(`backup_${i}`), prev);
      }
    }
    const primary = this._storage.getItem(this._key('state'));
    if (primary) {
      this._storage.setItem(this._key('backup_0'), primary);
    }
  }

  _flagCorruption() {
    try {
      this._storage.setItem(this._key('corruption_flag'), String(now()));
    } catch {}
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const storageEngine = new StorageEngine();
export default storageEngine;
