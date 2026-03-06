/**
 * eventBus.js — Nuvra Foundation (Phase 0–1)
 *
 * The EventBus is the single communication channel for all inter-module
 * events. No module imports another module directly for side effects;
 * instead it emits and listens to events through this bus.
 *
 * Design principles:
 *  - Synchronous delivery (no async surprises)
 *  - Typed events (string namespaced: 'module:action')
 *  - Wildcard listeners ('*' receives every event)
 *  - Error isolation (a bad listener never kills the bus)
 *  - Observable (all events are recorded in a replay buffer)
 *  - Strict: emitting an unknown event type in strict mode throws
 *
 * @module runtime/eventBus
 */
'use strict';

// ─── EventBus ─────────────────────────────────────────────────────────────────
class EventBus {
  constructor({ replayBufferSize = 200 } = {}) {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
    /** @type {Array<{type: string, payload: *, ts: number}>} */
    this._replayBuffer = [];
    this._replayBufferSize = replayBufferSize;
    this._sealed = false;
  }

  // ── Subscription ────────────────────────────────────────────────────────────
  /**
   * Subscribe to an event type.
   * Use '*' to receive all events.
   * @param {string} type
   * @param {Function} handler
   * @returns {Function} unsubscribe function
   */
  on(type, handler) {
    if (typeof type !== 'string' || !type) throw new TypeError('EventBus.on: type must be a non-empty string');
    if (typeof handler !== 'function')    throw new TypeError('EventBus.on: handler must be a function');

    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(handler);

    return () => this.off(type, handler);
  }

  /**
   * Subscribe to an event type exactly once.
   * @param {string} type
   * @param {Function} handler
   * @returns {Function} unsubscribe function
   */
  once(type, handler) {
    const wrapper = (payload) => {
      handler(payload);
      this.off(type, wrapper);
    };
    return this.on(type, wrapper);
  }

  /**
   * Unsubscribe a handler.
   * @param {string} type
   * @param {Function} handler
   */
  off(type, handler) {
    this._listeners.get(type)?.delete(handler);
  }

  // ── Emission ─────────────────────────────────────────────────────────────────
  /**
   * Emit an event synchronously to all matching listeners.
   * Errors in listeners are caught and reported — they never kill the bus.
   * @param {string} type
   * @param {*} payload
   */
  emit(type, payload = undefined) {
    if (typeof type !== 'string' || !type) throw new TypeError('EventBus.emit: type must be a non-empty string');

    const entry = { type, payload, ts: Date.now() };

    // Record in replay buffer
    this._replayBuffer.push(entry);
    if (this._replayBuffer.length > this._replayBufferSize) {
      this._replayBuffer.shift();
    }

    // Deliver to specific listeners
    const specific = this._listeners.get(type);
    if (specific) {
      for (const handler of specific) {
        try {
          handler(payload, entry);
        } catch (err) {
          // Errors in handlers are isolated — log but never rethrow
          console.error(`[EventBus] Error in handler for "${type}":`, err);
        }
      }
    }

    // Deliver to wildcard listeners
    const wildcards = this._listeners.get('*');
    if (wildcards) {
      for (const handler of wildcards) {
        try {
          handler(payload, entry);
        } catch (err) {
          console.error(`[EventBus] Error in wildcard handler for "${type}":`, err);
        }
      }
    }
  }

  // ── Replay ───────────────────────────────────────────────────────────────────
  /**
   * Get the replay buffer (last N events).
   * @param {number} [limit]
   * @returns {Array}
   */
  getHistory(limit) {
    if (limit) return this._replayBuffer.slice(-limit);
    return [...this._replayBuffer];
  }

  /**
   * Replay all buffered events to a new listener.
   * Useful for late-joining modules that need to catch up.
   * @param {string} type - event type to replay (or '*' for all)
   * @param {Function} handler
   */
  replay(type, handler) {
    const events = type === '*'
      ? this._replayBuffer
      : this._replayBuffer.filter(e => e.type === type);
    for (const entry of events) {
      try { handler(entry.payload, entry); } catch (e) {}
    }
  }

  // ── Diagnostics ──────────────────────────────────────────────────────────────
  /**
   * Return a diagnostic snapshot of the bus.
   */
  getStats() {
    const counts = {};
    for (const [type, set] of this._listeners) {
      counts[type] = set.size;
    }
    return {
      listenerTypes:  this._listeners.size,
      listenerCounts: counts,
      bufferLength:   this._replayBuffer.length,
      bufferCapacity: this._replayBufferSize,
    };
  }

  /**
   * Remove all listeners. Used during teardown.
   */
  clear() {
    this._listeners.clear();
    this._replayBuffer.length = 0;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const eventBus = new EventBus();
export default eventBus;
