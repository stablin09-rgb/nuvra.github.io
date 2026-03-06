/**
 * coreRuntime.js — Nuvra Foundation (Phase 0–1)
 *
 * The Core Runtime is the single entry point for the entire application.
 * It owns the application lifecycle, coordinates module registration,
 * and enforces boot order.
 *
 * Nothing runs outside this runtime.
 *
 * Boot sequence:
 *   1. Runtime.init()         — prepare the runtime itself
 *   2. Runtime.register(mod)  — register all modules
 *   3. Runtime.start()        — initialize and start all modules in dependency order
 *   4. Runtime.shutdown()     — gracefully stop all modules in reverse order
 *
 * Module contract:
 *   A module is a plain object with:
 *     - id: string (unique)
 *     - deps: string[] (optional, module IDs this module depends on)
 *     - init(runtime): Promise<void> | void  — called during start
 *     - start(runtime): Promise<void> | void — called after all deps are ready
 *     - stop(runtime): Promise<void> | void  — called during shutdown
 *
 * @module runtime/coreRuntime
 */
'use strict';

import { eventBus }                from './eventBus.js';
import { ModuleLifecycle, LifecycleState } from './lifecycle.js';

// ─── CoreRuntime ──────────────────────────────────────────────────────────────
class CoreRuntime {
  constructor() {
    /** @type {Map<string, {module: object, lifecycle: ModuleLifecycle}>} */
    this._modules    = new Map();
    this._started    = false;
    this._shuttingDown = false;
    this._lifecycle  = new ModuleLifecycle('CoreRuntime');
    this._lifecycle.register();
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Initialize the runtime itself. Must be called before register/start.
   * @returns {CoreRuntime}
   */
  init() {
    if (this._lifecycle.state !== LifecycleState.REGISTERED) {
      throw new Error('CoreRuntime.init: already initialized');
    }
    this._lifecycle.initialize();
    this._lifecycle.ready();
    eventBus.emit('runtime:init', { ts: Date.now() });
    return this;
  }

  /**
   * Register a module with the runtime.
   * @param {object} mod - module object conforming to the module contract
   * @returns {CoreRuntime}
   */
  register(mod) {
    if (!this._lifecycle.isActive) {
      throw new Error('CoreRuntime.register: runtime must be initialized before registering modules');
    }
    if (!mod || typeof mod !== 'object') throw new TypeError('CoreRuntime.register: module must be an object');
    if (!mod.id || typeof mod.id !== 'string') throw new TypeError('CoreRuntime.register: module.id must be a non-empty string');
    if (this._modules.has(mod.id)) throw new Error(`CoreRuntime.register: module "${mod.id}" is already registered`);
    if (this._started) throw new Error(`CoreRuntime.register: cannot register modules after runtime has started`);

    const lifecycle = new ModuleLifecycle(mod.id);
    lifecycle.register();
    this._modules.set(mod.id, { module: mod, lifecycle });

    eventBus.emit('runtime:module:registered', { moduleId: mod.id });
    return this;
  }

  /**
   * Start all registered modules in dependency order.
   * @returns {Promise<void>}
   */
  async start() {
    if (this._started) throw new Error('CoreRuntime.start: already started');
    if (!this._lifecycle.isActive) throw new Error('CoreRuntime.start: runtime must be initialized first');

    this._started = true;
    this._lifecycle.run();
    eventBus.emit('runtime:starting', { moduleCount: this._modules.size });

    const order = this._resolveOrder();

    for (const moduleId of order) {
      const entry = this._modules.get(moduleId);
      if (!entry) continue;
      const { module: mod, lifecycle } = entry;

      try {
        lifecycle.initialize();
        if (typeof mod.init === 'function') {
          await mod.init(this);
        }
        lifecycle.ready();

        if (typeof mod.start === 'function') {
          lifecycle.run();
          await mod.start(this);
        }

        eventBus.emit('runtime:module:started', { moduleId });
      } catch (err) {
        lifecycle.fail(err);
        eventBus.emit('runtime:module:error', { moduleId, error: err.message });
        throw new Error(`CoreRuntime.start: module "${moduleId}" failed to start: ${err.message}`);
      }
    }

    eventBus.emit('runtime:started', { moduleCount: this._modules.size });
  }

  /**
   * Gracefully shut down all modules in reverse dependency order.
   * @returns {Promise<void>}
   */
  async shutdown() {
    if (this._shuttingDown) return;
    this._shuttingDown = true;

    eventBus.emit('runtime:stopping', {});

    const order = this._resolveOrder().reverse();

    for (const moduleId of order) {
      const entry = this._modules.get(moduleId);
      if (!entry) continue;
      const { module: mod, lifecycle } = entry;

      if (!lifecycle.isActive) continue;

      try {
        lifecycle.stop();
        if (typeof mod.stop === 'function') {
          await mod.stop(this);
        }
        lifecycle.stopped();
        eventBus.emit('runtime:module:stopped', { moduleId });
      } catch (err) {
        lifecycle.fail(err);
        eventBus.emit('runtime:module:error', { moduleId, error: err.message });
        // Continue shutting down other modules even if one fails
      }
    }

    this._lifecycle.stop();
    this._lifecycle.stopped();
    eventBus.emit('runtime:stopped', {});
  }

  // ── Module Access ─────────────────────────────────────────────────────────────
  /**
   * Get a registered module by ID.
   * @param {string} id
   * @returns {object}
   */
  get(id) {
    const entry = this._modules.get(id);
    if (!entry) throw new Error(`CoreRuntime.get: module "${id}" is not registered`);
    return entry.module;
  }

  /**
   * Check if a module is registered.
   * @param {string} id
   * @returns {boolean}
   */
  has(id) {
    return this._modules.has(id);
  }

  /**
   * Get the lifecycle state of a module.
   * @param {string} id
   * @returns {ModuleLifecycle}
   */
  getLifecycle(id) {
    const entry = this._modules.get(id);
    if (!entry) throw new Error(`CoreRuntime.getLifecycle: module "${id}" is not registered`);
    return entry.lifecycle;
  }

  // ── Diagnostics ──────────────────────────────────────────────────────────────
  /**
   * Return a diagnostic snapshot of the runtime.
   */
  getStatus() {
    const modules = {};
    for (const [id, { lifecycle }] of this._modules) {
      modules[id] = lifecycle.toJSON();
    }
    return {
      state:   this._lifecycle.state,
      started: this._started,
      modules,
      eventBus: eventBus.getStats(),
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────────
  /**
   * Topological sort of modules by their declared dependencies.
   * Throws if a circular dependency is detected.
   * @returns {string[]} ordered module IDs
   */
  _resolveOrder() {
    const visited  = new Set();
    const resolved = [];
    const visiting = new Set(); // cycle detection

    const visit = (id) => {
      if (resolved.includes(id)) return;
      if (visiting.has(id)) {
        throw new Error(`CoreRuntime: circular dependency detected involving "${id}"`);
      }
      visiting.add(id);

      const entry = this._modules.get(id);
      if (!entry) throw new Error(`CoreRuntime: module "${id}" is referenced as a dependency but is not registered`);

      for (const dep of (entry.module.deps || [])) {
        visit(dep);
      }

      visiting.delete(id);
      visited.add(id);
      resolved.push(id);
    };

    for (const id of this._modules.keys()) {
      visit(id);
    }

    return resolved;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const runtime = new CoreRuntime();
export default runtime;
