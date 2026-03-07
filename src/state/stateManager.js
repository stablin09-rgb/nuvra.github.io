/**
 * Nuvra Builder — State Manager
 *
 * A lightweight reactive state system for Nuvra apps.
 * Manages three levels of state:
 *  - App-level:       global state shared across all pages
 *  - Page-level:      state scoped to a single page
 *  - Component-level: state scoped to a single component instance
 *
 * All state changes trigger subscriptions, enabling reactive UI updates.
 * State is serializable for project persistence.
 *
 * Usage:
 *   stateManager.setApp('user', { name: 'Alice' });
 *   stateManager.getApp('user');  // → { name: 'Alice' }
 *   stateManager.subscribeApp('user', (val) => console.log(val));
 */

'use strict';

// ─── State Store ──────────────────────────────────────────────────────────────

class StateStore {
  constructor(scope) {
    this._scope     = scope;
    this._state     = {};
    this._listeners = {}; // { key: Set<Function> }
  }

  /**
   * Get a state value by key.
   * @param {string} key
   * @param {*} [defaultValue]
   * @returns {*}
   */
  get(key, defaultValue = undefined) {
    return key in this._state ? this._state[key] : defaultValue;
  }

  /**
   * Set a state value and notify subscribers.
   * @param {string} key
   * @param {*} value
   */
  set(key, value) {
    const prev = this._state[key];
    this._state[key] = value;

    // Notify key-specific listeners
    const keyListeners = this._listeners[key];
    if (keyListeners) {
      keyListeners.forEach((fn) => {
        try { fn(value, prev); } catch (e) { console.error(`[StateManager:${this._scope}] Listener error:`, e); }
      });
    }

    // Notify wildcard listeners
    const wildcardListeners = this._listeners['*'];
    if (wildcardListeners) {
      wildcardListeners.forEach((fn) => {
        try { fn({ key, value, prev }); } catch (e) { /* ignore */ }
      });
    }
  }

  /**
   * Update a state value using a merge (for objects).
   * @param {string} key
   * @param {object} updates
   */
  merge(key, updates) {
    const current = this._state[key];
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      this.set(key, { ...current, ...updates });
    } else {
      this.set(key, updates);
    }
  }

  /**
   * Delete a state key.
   * @param {string} key
   */
  delete(key) {
    delete this._state[key];
    this._emit(key, undefined, this._state[key]);
  }

  /**
   * Subscribe to changes on a specific key (or '*' for all changes).
   * @param {string} key
   * @param {Function} callback  (newValue, prevValue) => void
   * @returns {Function} Unsubscribe function
   */
  subscribe(key, callback) {
    if (!this._listeners[key]) {
      this._listeners[key] = new Set();
    }
    this._listeners[key].add(callback);

    return () => {
      this._listeners[key]?.delete(callback);
    };
  }

  /**
   * Get all state as a plain object.
   * @returns {object}
   */
  getAll() {
    return { ...this._state };
  }

  /**
   * Replace all state (used for restore).
   * @param {object} snapshot
   */
  fromSnapshot(snapshot) {
    this._state = { ...(snapshot || {}) };
  }

  /**
   * Serialize to JSON.
   * @returns {object}
   */
  toJSON() {
    return { ...this._state };
  }

  _emit(key, value, prev) {
    const listeners = this._listeners[key];
    if (listeners) {
      listeners.forEach((fn) => {
        try { fn(value, prev); } catch (e) { /* ignore */ }
      });
    }
  }
}

// ─── State Manager ────────────────────────────────────────────────────────────

class StateManager {
  constructor() {
    this._app        = new StateStore('app');
    this._pages      = new Map();   // pageId → StateStore
    this._components = new Map();   // componentId → StateStore
  }

  // ── App-level state ────────────────────────────────────────────────────────

  /** @param {string} key  @param {*} [defaultValue] */
  getApp(key, defaultValue)    { return this._app.get(key, defaultValue); }

  /** @param {string} key  @param {*} value */
  setApp(key, value)           { this._app.set(key, value); }

  /** @param {string} key  @param {object} updates */
  mergeApp(key, updates)       { this._app.merge(key, updates); }

  /** @param {string} key  @param {Function} cb  @returns {Function} */
  subscribeApp(key, cb)        { return this._app.subscribe(key, cb); }

  /** @returns {object} */
  getAppState()                { return this._app.getAll(); }

  // ── Page-level state ───────────────────────────────────────────────────────

  _getPageStore(pageId) {
    if (!this._pages.has(pageId)) {
      this._pages.set(pageId, new StateStore(`page:${pageId}`));
    }
    return this._pages.get(pageId);
  }

  getPage(pageId, key, defaultValue)  { return this._getPageStore(pageId).get(key, defaultValue); }
  setPage(pageId, key, value)         { this._getPageStore(pageId).set(key, value); }
  mergePage(pageId, key, updates)     { this._getPageStore(pageId).merge(key, updates); }
  subscribePage(pageId, key, cb)      { return this._getPageStore(pageId).subscribe(key, cb); }
  getPageState(pageId)                { return this._getPageStore(pageId).getAll(); }

  /**
   * Clear all state for a page (called when a page is deleted).
   * @param {string} pageId
   */
  clearPage(pageId) {
    this._pages.delete(pageId);
  }

  // ── Component-level state ──────────────────────────────────────────────────

  _getComponentStore(componentId) {
    if (!this._components.has(componentId)) {
      this._components.set(componentId, new StateStore(`component:${componentId}`));
    }
    return this._components.get(componentId);
  }

  getComponent(componentId, key, defaultValue) { return this._getComponentStore(componentId).get(key, defaultValue); }
  setComponent(componentId, key, value)        { this._getComponentStore(componentId).set(key, value); }
  subscribeComponent(componentId, key, cb)     { return this._getComponentStore(componentId).subscribe(key, cb); }

  /**
   * Clear state for a component (called when a component is removed).
   * @param {string} componentId
   */
  clearComponent(componentId) {
    this._components.delete(componentId);
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  /**
   * Serialize all state to a plain JSON-compatible object.
   * @returns {object}
   */
  toJSON() {
    const pages = {};
    for (const [id, store] of this._pages) {
      pages[id] = store.toJSON();
    }
    return {
      app:   this._app.toJSON(),
      pages,
    };
  }

  /**
   * Restore state from a serialized snapshot.
   * @param {object} snapshot
   */
  fromJSON(snapshot) {
    if (!snapshot) return;
    this._app.fromSnapshot(snapshot.app || {});
    for (const [id, pageState] of Object.entries(snapshot.pages || {})) {
      this._getPageStore(id).fromSnapshot(pageState);
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const stateManager = new StateManager();
