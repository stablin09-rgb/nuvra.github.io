/**
 * store.js — Nuvra Foundation (Phase 0–1)
 *
 * The Single State Authority.
 *
 * All application state lives here. Nothing else stores state.
 * State is read via selectors. State is changed via dispatch(action).
 * State changes are observable via subscribe().
 *
 * Design:
 *  - Redux-inspired but dependency-free
 *  - Synchronous dispatch (no async middleware — use thunks at call site)
 *  - Structural equality check on subscribe (no unnecessary re-renders)
 *  - Full state is serializable (JSON-safe)
 *  - Middleware support for logging, persistence, etc.
 *
 * @module state/store
 */
'use strict';

import { rootReducer }  from './reducers.js';
import { eventBus }     from '../runtime/eventBus.js';

// ─── Store ────────────────────────────────────────────────────────────────────
class Store {
  /**
   * @param {Function} reducer - root reducer (state, action) => state
   * @param {object}   [preloadedState] - initial state (e.g. from persistence)
   * @param {Function[]} [middlewares]
   */
  constructor(reducer, preloadedState = {}, middlewares = []) {
    if (typeof reducer !== 'function') throw new TypeError('Store: reducer must be a function');

    this._reducer      = reducer;
    this._state        = reducer(preloadedState, { type: '@@INIT' });
    this._listeners    = new Set();
    this._dispatching  = false;
    this._actionCount  = 0;

    // Build middleware chain
    this._dispatch = this._buildDispatch(middlewares);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Get the current state (read-only).
   * Use selectors to read specific slices.
   * @returns {object}
   */
  getState() {
    return this._state;
  }

  /**
   * Dispatch an action to update state.
   * @param {{ type: string, payload?: * }} action
   * @returns {object} the action
   */
  dispatch(action) {
    if (!action || typeof action.type !== 'string') {
      throw new TypeError('Store.dispatch: action must have a string "type" property');
    }
    return this._dispatch(action);
  }

  /**
   * Subscribe to state changes.
   * The listener is called with (newState, prevState, action) after every dispatch.
   * @param {Function} listener
   * @returns {Function} unsubscribe function
   */
  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Store.subscribe: listener must be a function');
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * Subscribe to a specific slice of state.
   * Listener is only called when the selected value changes (by reference).
   * @param {Function} selector - (state) => value
   * @param {Function} listener - (newValue, prevValue) => void
   * @returns {Function} unsubscribe function
   */
  watch(selector, listener) {
    if (typeof selector !== 'function') throw new TypeError('Store.watch: selector must be a function');
    if (typeof listener !== 'function') throw new TypeError('Store.watch: listener must be a function');

    let prev = selector(this._state);

    return this.subscribe((newState) => {
      const next = selector(newState);
      if (next !== prev) {
        const old = prev;
        prev = next;
        listener(next, old);
      }
    });
  }

  /**
   * Replace the reducer (used for hot-reloading or code-splitting).
   * @param {Function} nextReducer
   */
  replaceReducer(nextReducer) {
    if (typeof nextReducer !== 'function') throw new TypeError('Store.replaceReducer: must be a function');
    this._reducer = nextReducer;
    this.dispatch({ type: '@@REPLACE_REDUCER' });
  }

  /**
   * Serialize the current state to a plain JSON-safe object.
   * @returns {object}
   */
  serialize() {
    return JSON.parse(JSON.stringify(this._state));
  }

  /**
   * Hydrate state from a serialized snapshot.
   * Replaces the entire state — use only during boot from persistence.
   * @param {object} snapshot
   */
  hydrate(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') throw new TypeError('Store.hydrate: snapshot must be an object');
    this._state = this._reducer(snapshot, { type: '@@HYDRATE' });
    this._notifyListeners(this._state, {}, { type: '@@HYDRATE' });
    eventBus.emit('store:hydrated', {});
  }

  // ── Private ───────────────────────────────────────────────────────────────────
  _rawDispatch(action) {
    if (this._dispatching) {
      throw new Error('Store: dispatch called while another dispatch is in progress (reducer side-effect?)');
    }

    this._dispatching = true;
    const prev = this._state;
    let next;
    try {
      next = this._reducer(prev, action);
    } finally {
      this._dispatching = false;
    }

    this._state = next;
    this._actionCount++;

    this._notifyListeners(next, prev, action);

    eventBus.emit('store:dispatch', { type: action.type, actionCount: this._actionCount });

    return action;
  }

  _notifyListeners(newState, prevState, action) {
    for (const listener of this._listeners) {
      try {
        listener(newState, prevState, action);
      } catch (err) {
        console.error('[Store] Error in subscriber:', err);
      }
    }
  }

  _buildDispatch(middlewares) {
    if (!middlewares.length) return this._rawDispatch.bind(this);

    // Middleware API
    const api = {
      getState:  () => this._state,
      dispatch:  (action) => this._dispatch(action),
    };

    const chain = middlewares.map(mw => mw(api));
    return chain.reduceRight(
      (next, mw) => mw(next),
      this._rawDispatch.bind(this)
    );
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const store = new Store(rootReducer);
export default store;
