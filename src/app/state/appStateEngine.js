/**
 * appStateEngine.js — Nuvra Phase 3
 *
 * The App State Engine.
 *
 * Manages all state for a running Nuvra app. State is organized into
 * four explicit scopes:
 *
 *  - global:    App-wide state, persists across page navigation.
 *  - page:      Current page state, reset on navigation.
 *  - component: Per-component local state.
 *  - derived:   Computed/memoized values that react to other state changes.
 *
 * All state is:
 *  - Explicitly declared in the AppSchema's state section
 *  - Observable (subscribe to any path)
 *  - Serializable (snapshot/restore)
 *  - Resettable (to schema-defined defaults)
 *  - Snapshot-able (for preview & undo)
 *
 * No hidden mutation. State changes only through set().
 *
 * State paths use dot notation: 'global.user.name', 'page.filters.status'
 *
 * @module app/state/appStateEngine
 */
'use strict';

import { deepClone } from '../../runtime/utils.js';

// ─── Path Utilities ───────────────────────────────────────────────────────────
function getByPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setByPath(obj, path, value) {
  const parts = path.split('.');
  const result = deepClone(obj);
  let cur = result;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] === null || cur[p] === undefined || typeof cur[p] !== 'object') {
      cur[p] = {};
    }
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
  return result;
}

// ─── AppStateEngine ───────────────────────────────────────────────────────────
export class AppStateEngine {
  /**
   * @param {object} opts
   * @param {object}  opts.stateSchema - The state section of the AppSchema
   * @param {object}  opts.eventBus    - AppEventBus instance
   */
  constructor({ stateSchema, eventBus }) {
    this._schema    = stateSchema;
    this._eventBus  = eventBus;
    this._state     = { global: {}, page: {}, component: {}, derived: {} };
    this._defaults  = { global: {}, page: {}, component: {} };
    this._derived   = []; // { id, path, deps, compute }
    this._listeners = new Map(); // path → Set<handler>
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  async boot() {
    // Initialize global state from schema
    for (const def of (this._schema.global || [])) {
      this._state.global[def.id]   = deepClone(def.defaultValue ?? null);
      this._defaults.global[def.id] = deepClone(def.defaultValue ?? null);
    }

    // Initialize page state from schema
    for (const def of (this._schema.page || [])) {
      this._state.page[def.id]   = deepClone(def.defaultValue ?? null);
      this._defaults.page[def.id] = deepClone(def.defaultValue ?? null);
    }

    // Register derived state computations
    for (const def of (this._schema.derived || [])) {
      this._derived.push({
        id:      def.id,
        path:    `derived.${def.id}`,
        deps:    def.deps || [],
        compute: this._buildCompute(def.expression),
      });
      // Subscribe to all deps to recompute on change
      for (const dep of (def.deps || [])) {
        this.subscribe(dep, () => this._recompute(def.id));
      }
      // Initial computation
      this._recompute(def.id);
    }
  }

  // ── Get / Set ──────────────────────────────────────────────────────────────
  /**
   * Get a state value by path.
   * @param {string} path - e.g. 'global.user.name', 'page.filters.status'
   * @returns {*}
   */
  get(path) {
    return getByPath(this._state, path);
  }

  /**
   * Set a state value by path. Notifies all subscribers.
   * @param {string} path
   * @param {*} value
   */
  set(path, value) {
    const prev = getByPath(this._state, path);
    if (Object.is(prev, value)) return; // no-op if unchanged

    this._state = setByPath(this._state, path, value);

    // Notify path-specific subscribers
    this._notify(path, value, prev);

    // Emit on the app event bus
    this._eventBus.emit(`state:changed:${path}`, { path, value, prev });
  }

  // ── Subscribe ──────────────────────────────────────────────────────────────
  /**
   * Subscribe to changes at a specific state path.
   * @param {string} path
   * @param {Function} handler - called with (newValue, prevValue)
   * @returns {Function} unsubscribe
   */
  subscribe(path, handler) {
    if (!this._listeners.has(path)) {
      this._listeners.set(path, new Set());
    }
    this._listeners.get(path).add(handler);
    return () => this._listeners.get(path)?.delete(handler);
  }

  _notify(path, newVal, prevVal) {
    const handlers = this._listeners.get(path);
    if (handlers) {
      for (const h of handlers) {
        try { h(newVal, prevVal); } catch { /* isolate */ }
      }
    }
  }

  // ── Derived State ──────────────────────────────────────────────────────────
  _recompute(derivedId) {
    const def = this._derived.find(d => d.id === derivedId);
    if (!def) return;
    try {
      const value = def.compute(this);
      const path  = def.path;
      const prev  = getByPath(this._state, path);
      if (!Object.is(prev, value)) {
        this._state = setByPath(this._state, path, value);
        this._notify(path, value, prev);
      }
    } catch { /* derived computation errors are silent */ }
  }

  /**
   * Build a safe compute function from a declarative expression object.
   * Expression format: { type: 'filter', source: 'global.items', condition: { field: 'done', eq: true } }
   *
   * Supported expression types:
   *   filter  — filter an array by a condition
   *   count   — count items in an array (optionally filtered)
   *   sum     — sum a numeric field in an array
   *   map     — map an array to a field
   *   not     — boolean NOT of a state path
   *   eq      — equality check between two state paths or literals
   *
   * @param {object} expression
   * @returns {Function}
   */
  _buildCompute(expression) {
    if (!expression) return () => null;
    const { type } = expression;

    switch (type) {
      case 'filter': {
        const { source, condition } = expression;
        return (engine) => {
          const arr = engine.get(source);
          if (!Array.isArray(arr)) return [];
          return arr.filter(item => this._matchCondition(item, condition));
        };
      }
      case 'count': {
        const { source, condition } = expression;
        return (engine) => {
          const arr = engine.get(source);
          if (!Array.isArray(arr)) return 0;
          if (!condition) return arr.length;
          return arr.filter(item => this._matchCondition(item, condition)).length;
        };
      }
      case 'sum': {
        const { source, field } = expression;
        return (engine) => {
          const arr = engine.get(source);
          if (!Array.isArray(arr)) return 0;
          return arr.reduce((acc, item) => acc + (Number(item[field]) || 0), 0);
        };
      }
      case 'map': {
        const { source, field } = expression;
        return (engine) => {
          const arr = engine.get(source);
          if (!Array.isArray(arr)) return [];
          return arr.map(item => item[field]);
        };
      }
      case 'not': {
        const { source } = expression;
        return (engine) => !engine.get(source);
      }
      case 'eq': {
        const { left, right } = expression;
        return (engine) => {
          const l = left?.startsWith?.('state:') ? engine.get(left.slice(6)) : left;
          const r = right?.startsWith?.('state:') ? engine.get(right.slice(6)) : right;
          return l === r;
        };
      }
      default:
        return () => null;
    }
  }

  _matchCondition(item, condition) {
    if (!condition) return true;
    for (const [field, matcher] of Object.entries(condition)) {
      if (typeof matcher === 'object' && matcher !== null) {
        if ('eq'  in matcher && item[field] !== matcher.eq)  return false;
        if ('neq' in matcher && item[field] === matcher.neq) return false;
        if ('gt'  in matcher && !(item[field] > matcher.gt)) return false;
        if ('lt'  in matcher && !(item[field] < matcher.lt)) return false;
        if ('contains' in matcher && !String(item[field]).includes(matcher.contains)) return false;
      } else {
        if (item[field] !== matcher) return false;
      }
    }
    return true;
  }

  // ── Reset ──────────────────────────────────────────────────────────────────
  /**
   * Reset a scope to its schema-defined defaults.
   * @param {'global'|'page'|'component'} scope
   */
  reset(scope) {
    if (!this._defaults[scope]) return;
    this._state[scope] = deepClone(this._defaults[scope]);
    this._eventBus.emit(`state:reset:${scope}`, {});
  }

  // ── Snapshot / Restore ─────────────────────────────────────────────────────
  snapshot() {
    return deepClone(this._state);
  }

  restore(snap) {
    this._state = deepClone(snap);
    this._eventBus.emit('state:restored', {});
  }

  // ── Destroy ────────────────────────────────────────────────────────────────
  destroy() {
    this._listeners.clear();
    this._derived = [];
  }
}

export default AppStateEngine;
