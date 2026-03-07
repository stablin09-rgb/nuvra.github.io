/**
 * appRuntime.js — Nuvra Phase 3
 *
 * The Application Runtime.
 *
 * The AppRuntime is the execution authority for a single Nuvra app.
 * It boots from an AppSchema, wires all subsystems, and manages the
 * full lifecycle of the running application.
 *
 * It is completely sandboxed from the editor. The editor creates an
 * AppRuntime instance; the runtime has no reference back to the editor.
 *
 * Lifecycle:
 *   IDLE → BOOTING → RUNNING → STOPPING → IDLE
 *
 * Usage:
 *   const rt = new AppRuntime({ appSchema, mode: 'preview' });
 *   await rt.boot(mountEl);
 *   // ... app runs ...
 *   await rt.stop();
 *
 * @module app/runtime/appRuntime
 */
'use strict';

import { AppContext }       from './appContext.js';
import { AppStateEngine }   from '../state/appStateEngine.js';
import { DataEngine }       from '../data/dataEngine.js';
import { ActionDispatcher } from '../actions/actionDispatcher.js';
import { AppRenderer }      from './appRenderer.js';
import { AppEventBus }      from './appEventBus.js';
import { generateId, now }  from '../../runtime/utils.js';

// ─── Runtime States ───────────────────────────────────────────────────────────
export const RuntimeState = Object.freeze({
  IDLE:     'IDLE',
  BOOTING:  'BOOTING',
  RUNNING:  'RUNNING',
  STOPPING: 'STOPPING',
  ERROR:    'ERROR',
});

// ─── AppRuntime ───────────────────────────────────────────────────────────────
export class AppRuntime {
  /**
   * @param {object} opts
   * @param {object}  opts.appSchema  - The AppSchema to execute
   * @param {string}  [opts.mode]     - 'editor' | 'preview' | 'publish'
   * @param {object}  [opts.logger]   - Logger instance (from foundation)
   */
  constructor({ appSchema, mode = 'preview', logger = null }) {
    this.id         = generateId('rt');
    this.appSchema  = appSchema;
    this.mode       = mode;
    this._logger    = logger;
    this._state     = RuntimeState.IDLE;
    this._context   = null;
    this._renderer  = null;
    this._mountEl   = null;
    this._listeners = [];
  }

  // ── State ──────────────────────────────────────────────────────────────────
  get state() { return this._state; }
  get isRunning() { return this._state === RuntimeState.RUNNING; }
  get context() { return this._context; }

  _setState(s) {
    this._state = s;
    this._log('info', `AppRuntime state → ${s}`);
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  /**
   * Boot the runtime and mount the app into the given DOM element.
   * @param {HTMLElement} mountEl
   * @returns {Promise<void>}
   */
  async boot(mountEl) {
    if (this._state !== RuntimeState.IDLE) {
      throw new Error(`AppRuntime.boot() called in state ${this._state}. Must be IDLE.`);
    }
    this._setState(RuntimeState.BOOTING);
    this._mountEl = mountEl;

    try {
      // ── 1. Create app-scoped event bus ──────────────────────────────────────
      const eventBus = new AppEventBus();

      // ── 2. Boot state engine from schema ───────────────────────────────────
      const stateEngine = new AppStateEngine({
        stateSchema: this.appSchema.state || {},
        eventBus,
      });
      await stateEngine.boot();

      // ── 3. Boot data engine from schema ────────────────────────────────────
      const dataEngine = new DataEngine({
        collections: this.appSchema.collections || [],
        eventBus,
      });
      await dataEngine.boot();

      // ── 4. Boot action dispatcher from schema ──────────────────────────────
      const actionDispatcher = new ActionDispatcher({
        actions: this.appSchema.actions || [],
        eventBus,
      });
      await actionDispatcher.boot();

      // ── 5. Create the app context ───────────────────────────────────────────
      this._context = new AppContext({
        appSchema:        this.appSchema,
        stateEngine,
        dataEngine,
        actionDispatcher,
        eventBus,
        mode:             this.mode,
      });

      // ── 6. Boot the renderer ────────────────────────────────────────────────
      this._renderer = new AppRenderer({
        context:  this._context,
        mountEl,
        mode:     this.mode,
      });
      await this._renderer.boot();

      // ── 7. Run page-load actions ────────────────────────────────────────────
      const currentPage = this.appSchema.pages?.[0];
      if (currentPage?.onLoad) {
        for (const actionRef of currentPage.onLoad) {
          await this._context.dispatch(actionRef.actionId, actionRef.payload || {});
        }
      }

      this._setState(RuntimeState.RUNNING);
      eventBus.emit('runtime:ready', { runtimeId: this.id, appId: this.appSchema.id });
      this._log('info', `App "${this.appSchema.name}" running in ${this.mode} mode`);

    } catch (err) {
      this._setState(RuntimeState.ERROR);
      this._log('error', `Boot failed: ${err.message}`);
      throw err;
    }
  }

  // ── Stop ───────────────────────────────────────────────────────────────────
  /**
   * Stop the runtime and unmount the app.
   * @returns {Promise<void>}
   */
  async stop() {
    if (this._state !== RuntimeState.RUNNING && this._state !== RuntimeState.ERROR) return;
    this._setState(RuntimeState.STOPPING);

    try {
      this._renderer?.unmount();
      this._context?._state?.destroy?.();
      this._context?._data?.destroy?.();
      this._context?._actions?.destroy?.();
      this._context?._eventBus?.destroy?.();

      if (this._mountEl) this._mountEl.innerHTML = '';
      this._context  = null;
      this._renderer = null;
      this._setState(RuntimeState.IDLE);
    } catch (err) {
      this._log('error', `Stop error: ${err.message}`);
      this._setState(RuntimeState.IDLE);
    }
  }

  // ── Schema Hot-Reload ──────────────────────────────────────────────────────
  /**
   * Reload the app with a new or updated schema without a full stop/boot.
   * Used by the editor when the user makes schema changes.
   * @param {object} newSchema
   * @returns {Promise<void>}
   */
  async reload(newSchema) {
    const mountEl = this._mountEl;
    await this.stop();
    this.appSchema = newSchema;
    await this.boot(mountEl);
  }

  // ── Snapshot ───────────────────────────────────────────────────────────────
  /**
   * Capture a snapshot of the current runtime state.
   * @returns {object|null}
   */
  snapshot() {
    if (!this._context) return null;
    return this._context.snapshot();
  }

  /**
   * Restore runtime state from a snapshot.
   * @param {object} snap
   */
  restore(snap) {
    if (!this._context) throw new Error('Cannot restore: runtime not running');
    this._context.restore(snap);
    this._renderer?.renderAll();
  }

  // ── Internal ───────────────────────────────────────────────────────────────
  _log(level, message) {
    if (this._logger) {
      this._logger[level]?.('AppRuntime', message);
    }
  }
}

export default AppRuntime;
