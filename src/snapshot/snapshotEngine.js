/**
 * snapshotEngine.js — Nuvra Phase 4
 *
 * The Snapshot Engine.
 *
 * Serializes the complete runtime state of an app into a portable,
 * deterministic snapshot. The snapshot is embedded in the published output
 * and used to boot the runtime in Preview Mode.
 *
 * A snapshot captures:
 *  - App state (global, page, derived)
 *  - Data collections (all records in all collections)
 *  - Schema reference (app ID + version)
 *  - Metadata (timestamp, build version, target)
 *
 * Snapshots enable:
 *  - Deterministic replay: the same snapshot always produces the same output
 *  - Undo/redo (future)
 *  - Time travel debugging (future)
 *  - Cloud sync (future)
 *  - Preview isolation: mutations in preview do not affect the editor
 *
 * @module snapshot/snapshotEngine
 */
'use strict';

// ─── Snapshot Types ────────────────────────────────────────────────────────────
export const SnapshotType = Object.freeze({
  FULL:    'full',    // All state + all data
  STATE:   'state',   // State only (no data)
  DATA:    'data',    // Data only (no state)
  PARTIAL: 'partial', // Specific collections/state paths
});

// ─── SnapshotEngine ────────────────────────────────────────────────────────────
export class SnapshotEngine {
  constructor() {
    this._name = 'SnapshotEngine';
    this._history = []; // Rolling snapshot history (for undo/redo)
    this._maxHistory = 50;
  }

  /**
   * Create a snapshot from an AppSchema and live runtime data.
   *
   * In Phase 4, the runtime data is provided by the AppRuntime's context.
   * In the editor (no live runtime), the snapshot is built from the schema's
   * seed data and default state values.
   *
   * @param {object} opts
   * @param {object}  opts.appSchema   - The AppSchema
   * @param {object}  [opts.stateData] - Live state { global, page }
   * @param {object}  [opts.collData]  - Live collection data { [collId]: Record[] }
   * @param {string}  [opts.type]      - SnapshotType (default: FULL)
   * @param {object}  [opts.meta]      - Additional metadata
   * @returns {object} Snapshot
   */
  create(opts = {}) {
    const { appSchema, stateData, collData, type = SnapshotType.FULL, meta = {} } = opts;

    if (!appSchema) {
      throw new Error('SnapshotEngine.create: appSchema is required');
    }

    const snapshot = {
      _type:      'NuvraSnapshot',
      _version:   1,
      snapshotType: type,
      appId:      appSchema.id,
      appVersion: appSchema.version || '1.0.0',
      createdAt:  Date.now(),
      meta,
    };

    // ── State ──────────────────────────────────────────────────────────────────
    if (type === SnapshotType.FULL || type === SnapshotType.STATE) {
      snapshot.state = this._captureState(appSchema, stateData);
    }

    // ── Data ───────────────────────────────────────────────────────────────────
    if (type === SnapshotType.FULL || type === SnapshotType.DATA) {
      snapshot.data = this._captureData(appSchema, collData);
    }

    // Add to history
    this._pushHistory(snapshot);

    return snapshot;
  }

  /**
   * Create a "clean" snapshot from schema defaults only.
   * Used when entering Preview Mode without a live runtime.
   *
   * @param {object} appSchema
   * @returns {object} Snapshot
   */
  createFromSchema(appSchema) {
    return this.create({
      appSchema,
      type: SnapshotType.FULL,
      meta: { source: 'schema_defaults' },
    });
  }

  /**
   * Validate a snapshot against an AppSchema.
   *
   * @param {object} snapshot
   * @param {object} appSchema
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate(snapshot, appSchema) {
    const errors = [];

    if (!snapshot || typeof snapshot !== 'object') {
      return { valid: false, errors: ['Snapshot is not an object'] };
    }
    if (snapshot._type !== 'NuvraSnapshot') {
      errors.push('Invalid snapshot type: ' + snapshot._type);
    }
    if (snapshot.appId !== appSchema.id) {
      errors.push(`Snapshot appId "${snapshot.appId}" does not match schema appId "${appSchema.id}"`);
    }

    // Validate collections exist
    if (snapshot.data) {
      for (const collId of Object.keys(snapshot.data)) {
        const exists = appSchema.collections?.some(c => c.id === collId);
        if (!exists) {
          errors.push(`Snapshot contains data for unknown collection: "${collId}"`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Diff two snapshots. Returns a description of what changed.
   *
   * @param {object} snapshotA
   * @param {object} snapshotB
   * @returns {object} Diff result
   */
  diff(snapshotA, snapshotB) {
    const changes = { state: {}, data: {} };

    // State diff
    const stateA = snapshotA.state || {};
    const stateB = snapshotB.state || {};
    for (const scope of ['global', 'page']) {
      const scopeA = stateA[scope] || {};
      const scopeB = stateB[scope] || {};
      const allKeys = new Set([...Object.keys(scopeA), ...Object.keys(scopeB)]);
      for (const key of allKeys) {
        const a = JSON.stringify(scopeA[key]);
        const b = JSON.stringify(scopeB[key]);
        if (a !== b) {
          changes.state[`${scope}.${key}`] = { from: scopeA[key], to: scopeB[key] };
        }
      }
    }

    // Data diff
    const dataA = snapshotA.data || {};
    const dataB = snapshotB.data || {};
    const allColls = new Set([...Object.keys(dataA), ...Object.keys(dataB)]);
    for (const collId of allColls) {
      const recsA = _indexById(dataA[collId] || []);
      const recsB = _indexById(dataB[collId] || []);
      const allIds = new Set([...Object.keys(recsA), ...Object.keys(recsB)]);
      const added = [], removed = [], updated = [];
      for (const id of allIds) {
        if (!recsA[id]) { added.push(id); continue; }
        if (!recsB[id]) { removed.push(id); continue; }
        if (JSON.stringify(recsA[id]) !== JSON.stringify(recsB[id])) updated.push(id);
      }
      if (added.length || removed.length || updated.length) {
        changes.data[collId] = { added, removed, updated };
      }
    }

    return {
      hasChanges: Object.keys(changes.state).length > 0 || Object.keys(changes.data).length > 0,
      changes,
      fromCreatedAt: snapshotA.createdAt,
      toCreatedAt:   snapshotB.createdAt,
    };
  }

  /**
   * Get the snapshot history.
   * @returns {object[]}
   */
  getHistory() {
    return [...this._history];
  }

  /**
   * Restore a previous snapshot from history by index.
   * @param {number} index
   * @returns {object|null}
   */
  restoreFromHistory(index) {
    return this._history[index] ? _deepClone(this._history[index]) : null;
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  _captureState(appSchema, liveState) {
    const state = { global: {}, page: {} };

    // Global state
    for (const def of (appSchema.state?.global || [])) {
      state.global[def.id] = liveState?.global?.[def.id] !== undefined
        ? _deepClone(liveState.global[def.id])
        : _deepClone(def.defaultValue ?? null);
    }

    // Page state
    for (const def of (appSchema.state?.page || [])) {
      state.page[def.id] = liveState?.page?.[def.id] !== undefined
        ? _deepClone(liveState.page[def.id])
        : _deepClone(def.defaultValue ?? null);
    }

    return state;
  }

  _captureData(appSchema, liveData) {
    const data = {};

    for (const schema of (appSchema.collections || [])) {
      if (liveData?.[schema.id]) {
        // Use live data if available
        data[schema.id] = _deepClone(liveData[schema.id]);
      } else {
        // Fall back to seed data
        data[schema.id] = (schema.seedData || []).map(r => ({
          ...r,
          _id:        r._id || _generateId('rec'),
          _createdAt: r._createdAt || Date.now(),
          _updatedAt: r._updatedAt || Date.now(),
        }));
      }
    }

    return data;
  }

  _pushHistory(snapshot) {
    this._history.push(_deepClone(snapshot));
    if (this._history.length > this._maxHistory) {
      this._history.shift();
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; }
}

function _generateId(prefix) {
  return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 10);
}

function _indexById(records) {
  const idx = {};
  for (const r of records) { if (r._id) idx[r._id] = r; }
  return idx;
}

// ─── Singleton ─────────────────────────────────────────────────────────────────
export const snapshotEngine = new SnapshotEngine();
export default snapshotEngine;
