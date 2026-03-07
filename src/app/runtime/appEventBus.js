/**
 * appEventBus.js — Nuvra Phase 3
 *
 * App-scoped event bus.
 *
 * Completely isolated from the foundation EventBus. Events emitted here
 * do not leak into the editor and vice versa. This is the communication
 * backbone for all app-internal events:
 *
 *  - state:changed:<path>
 *  - data:changed:<collectionId>
 *  - action:dispatched:<actionId>
 *  - runtime:ready
 *  - component:event:<componentId>:<eventName>
 *
 * @module app/runtime/appEventBus
 */
'use strict';

export class AppEventBus {
  constructor() {
    this._listeners = new Map(); // event → Set<handler>
  }

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} handler
   * @returns {Function} unsubscribe
   */
  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  /**
   * Subscribe to an event once.
   * @param {string} event
   * @param {Function} handler
   * @returns {Function} unsubscribe
   */
  once(event, handler) {
    const wrapper = (data) => {
      handler(data);
      this.off(event, wrapper);
    };
    return this.on(event, wrapper);
  }

  /**
   * Unsubscribe from an event.
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    this._listeners.get(event)?.delete(handler);
  }

  /**
   * Emit an event.
   * @param {string} event
   * @param {*} data
   */
  emit(event, data) {
    const handlers = this._listeners.get(event);
    if (handlers) {
      for (const h of handlers) {
        try { h(data); } catch { /* isolate handler errors */ }
      }
    }
    // Also emit to wildcard listeners
    const wildcards = this._listeners.get('*');
    if (wildcards) {
      for (const h of wildcards) {
        try { h({ event, data }); } catch { /* isolate */ }
      }
    }
  }

  /**
   * Remove all listeners and clean up.
   */
  destroy() {
    this._listeners.clear();
  }
}

export default AppEventBus;
