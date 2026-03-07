/**
 * appContext.js — Nuvra Phase 3
 *
 * AppContext is the execution context for a single running app instance.
 *
 * Every running app has exactly one AppContext. It is the single object
 * passed to every component, action, and data resolver during execution.
 * It carries references to the app's state engine, data engine, action
 * dispatcher, and the app schema itself.
 *
 * The context is immutable from the outside — it is created once by the
 * AppRuntime and passed by reference. Internal engines update their own
 * state, which is reflected through the context's accessor methods.
 *
 * Principles:
 *  - No global variables. Everything flows through the context.
 *  - Context is sandboxed — it has no reference to the editor or the
 *    foundation store. It is a clean execution environment.
 *  - Context is serializable (via snapshot()) for preview and undo.
 *
 * @module app/runtime/appContext
 */
'use strict';

import { generateId, now } from '../../runtime/utils.js';

// ─── AppContext ────────────────────────────────────────────────────────────────
export class AppContext {
  /**
   * @param {object} opts
   * @param {object}   opts.appSchema      - The AppSchema this context runs
   * @param {object}   opts.stateEngine    - AppStateEngine instance
   * @param {object}   opts.dataEngine     - DataEngine instance
   * @param {object}   opts.actionDispatcher - ActionDispatcher instance
   * @param {object}   opts.eventBus       - The app-scoped event bus
   * @param {string}   [opts.mode]         - 'editor' | 'preview' | 'publish'
   */
  constructor({ appSchema, stateEngine, dataEngine, actionDispatcher, eventBus, mode = 'preview' }) {
    this.id          = generateId('ctx');
    this.appSchema   = appSchema;
    this.appId       = appSchema.id;
    this.mode        = mode;
    this.createdAt   = now();

    // ── Engine references (private — accessed via methods only) ───────────────
    this._state      = stateEngine;
    this._data       = dataEngine;
    this._actions    = actionDispatcher;
    this._eventBus   = eventBus;

    // ── Execution log ─────────────────────────────────────────────────────────
    this._log        = [];
  }

  // ── State API ──────────────────────────────────────────────────────────────
  /**
   * Get a state value by path (e.g., 'global.user.name' or 'page.filters.status').
   * @param {string} path
   * @returns {*}
   */
  getState(path) {
    return this._state.get(path);
  }

  /**
   * Set a state value by path.
   * @param {string} path
   * @param {*} value
   */
  setState(path, value) {
    this._state.set(path, value);
  }

  /**
   * Subscribe to state changes at a given path.
   * @param {string} path
   * @param {Function} handler
   * @returns {Function} unsubscribe
   */
  onStateChange(path, handler) {
    return this._state.subscribe(path, handler);
  }

  // ── Data API ───────────────────────────────────────────────────────────────
  /**
   * Query a collection.
   * @param {string} collectionId
   * @param {object} [query]
   * @returns {object[]}
   */
  query(collectionId, query = {}) {
    return this._data.query(collectionId, query);
  }

  /**
   * Insert a record into a collection.
   * @param {string} collectionId
   * @param {object} record
   * @returns {{ ok: boolean, record?: object, error?: string }}
   */
  insert(collectionId, record) {
    return this._data.insert(collectionId, record);
  }

  /**
   * Update a record in a collection.
   * @param {string} collectionId
   * @param {string} recordId
   * @param {object} patch
   * @returns {{ ok: boolean, record?: object, error?: string }}
   */
  update(collectionId, recordId, patch) {
    return this._data.update(collectionId, recordId, patch);
  }

  /**
   * Delete a record from a collection.
   * @param {string} collectionId
   * @param {string} recordId
   * @returns {{ ok: boolean, error?: string }}
   */
  delete(collectionId, recordId) {
    return this._data.delete(collectionId, recordId);
  }

  // ── Action API ─────────────────────────────────────────────────────────────
  /**
   * Dispatch a named action with a payload.
   * @param {string} actionId
   * @param {object} [payload]
   * @returns {Promise<object>} result
   */
  async dispatch(actionId, payload = {}) {
    const entry = { ts: now(), actionId, payload };
    this._log.push(entry);
    return this._actions.dispatch(actionId, payload, this);
  }

  // ── Event API ──────────────────────────────────────────────────────────────
  /**
   * Emit an app-scoped event.
   * @param {string} event
   * @param {*} data
   */
  emit(event, data) {
    this._eventBus.emit(event, data);
  }

  /**
   * Subscribe to an app-scoped event.
   * @param {string} event
   * @param {Function} handler
   * @returns {Function} unsubscribe
   */
  on(event, handler) {
    return this._eventBus.on(event, handler);
  }

  // ── Snapshot API ───────────────────────────────────────────────────────────
  /**
   * Produce a serializable snapshot of the current app execution state.
   * Used for preview, undo, and export.
   * @returns {object}
   */
  snapshot() {
    return {
      contextId:  this.id,
      appId:      this.appId,
      mode:       this.mode,
      snapshotAt: now(),
      state:      this._state.snapshot(),
      data:       this._data.snapshot(),
      log:        [...this._log],
    };
  }

  /**
   * Restore context state from a snapshot.
   * @param {object} snap
   */
  restore(snap) {
    if (snap.state) this._state.restore(snap.state);
    if (snap.data)  this._data.restore(snap.data);
    this._log = snap.log ? [...snap.log] : [];
  }
}

export default AppContext;
