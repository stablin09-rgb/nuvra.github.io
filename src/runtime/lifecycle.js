/**
 * lifecycle.js — Nuvra Foundation (Phase 0–1)
 *
 * Defines the explicit lifecycle states and transitions for every
 * module registered with the Core Runtime.
 *
 * Lifecycle states:
 *   UNREGISTERED → REGISTERED → INITIALIZING → READY → RUNNING → STOPPING → STOPPED → ERROR
 *
 * Rules:
 *  - Transitions are validated — invalid transitions throw
 *  - Every transition emits an event on the eventBus
 *  - A module in ERROR state can be reset to REGISTERED for retry
 *  - No module may skip states (e.g., UNREGISTERED → RUNNING is illegal)
 *
 * @module runtime/lifecycle
 */

'use strict';

import { eventBus } from './eventBus.js';

// ─── States ───────────────────────────────────────────────────────────────────
export const LifecycleState = Object.freeze({
  UNREGISTERED: 'UNREGISTERED',
  REGISTERED:   'REGISTERED',
  INITIALIZING: 'INITIALIZING',
  READY:        'READY',
  RUNNING:      'RUNNING',
  STOPPING:     'STOPPING',
  STOPPED:      'STOPPED',
  ERROR:        'ERROR',
});

// ─── Valid transitions ────────────────────────────────────────────────────────
const VALID_TRANSITIONS = new Map([
  [LifecycleState.UNREGISTERED, new Set([LifecycleState.REGISTERED])],
  [LifecycleState.REGISTERED,   new Set([LifecycleState.INITIALIZING, LifecycleState.ERROR])],
  [LifecycleState.INITIALIZING, new Set([LifecycleState.READY, LifecycleState.ERROR])],
  [LifecycleState.READY,        new Set([LifecycleState.RUNNING, LifecycleState.STOPPING, LifecycleState.ERROR])],
  [LifecycleState.RUNNING,      new Set([LifecycleState.STOPPING, LifecycleState.ERROR])],
  [LifecycleState.STOPPING,     new Set([LifecycleState.STOPPED, LifecycleState.ERROR])],
  [LifecycleState.STOPPED,      new Set([LifecycleState.REGISTERED])], // allow restart
  [LifecycleState.ERROR,        new Set([LifecycleState.REGISTERED])], // allow retry
]);

// ─── ModuleLifecycle ──────────────────────────────────────────────────────────
export class ModuleLifecycle {
  /**
   * @param {string} moduleId
   */
  constructor(moduleId) {
    if (!moduleId) throw new Error('ModuleLifecycle: moduleId is required');
    this.moduleId = moduleId;
    this._state   = LifecycleState.UNREGISTERED;
    this._history = [{ state: LifecycleState.UNREGISTERED, ts: Date.now() }];
    this._error   = null;
  }

  // ── Getters ──────────────────────────────────────────────────────────────────
  get state()   { return this._state; }
  get error()   { return this._error; }
  get history() { return [...this._history]; }

  get isReady()   { return this._state === LifecycleState.READY; }
  get isRunning() { return this._state === LifecycleState.RUNNING; }
  get isStopped() { return this._state === LifecycleState.STOPPED; }
  get isError()   { return this._state === LifecycleState.ERROR; }
  get isActive()  { return this._state === LifecycleState.READY || this._state === LifecycleState.RUNNING; }

  // ── Transitions ──────────────────────────────────────────────────────────────
  /**
   * Transition to a new state.
   * @param {string} newState
   * @param {*} [meta] - optional metadata for the event payload
   */
  transition(newState, meta = {}) {
    const allowed = VALID_TRANSITIONS.get(this._state);
    if (!allowed?.has(newState)) {
      throw new Error(
        `ModuleLifecycle[${this.moduleId}]: invalid transition ${this._state} → ${newState}`
      );
    }

    const prev = this._state;
    this._state = newState;
    if (newState !== LifecycleState.ERROR) this._error = null;

    const entry = { state: newState, prev, ts: Date.now(), ...meta };
    this._history.push(entry);

    eventBus.emit('lifecycle:transition', {
      moduleId: this.moduleId,
      from:     prev,
      to:       newState,
      ts:       entry.ts,
      meta,
    });

    return this;
  }

  // ── Convenience transition methods ───────────────────────────────────────────
  register()    { return this.transition(LifecycleState.REGISTERED); }
  initialize()  { return this.transition(LifecycleState.INITIALIZING); }
  ready()       { return this.transition(LifecycleState.READY); }
  run()         { return this.transition(LifecycleState.RUNNING); }
  stop()        { return this.transition(LifecycleState.STOPPING); }
  stopped()     { return this.transition(LifecycleState.STOPPED); }

  /**
   * Transition to ERROR state.
   * @param {Error|string} err
   */
  fail(err) {
    this._error = err instanceof Error ? err : new Error(String(err));
    return this.transition(LifecycleState.ERROR, { error: this._error.message });
  }

  /**
   * Reset from ERROR or STOPPED back to REGISTERED for retry.
   */
  reset() {
    return this.transition(LifecycleState.REGISTERED);
  }

  // ── Diagnostics ──────────────────────────────────────────────────────────────
  toJSON() {
    return {
      moduleId: this.moduleId,
      state:    this._state,
      error:    this._error?.message || null,
      history:  this._history,
    };
  }
}

export default ModuleLifecycle;


