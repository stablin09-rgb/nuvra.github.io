'use strict';
/**
 * extensionRegistry.js — Phase 8 compatibility shim
 * Provides the class-based ExtensionRegistry interface expected by Phase 8 imports.
 */

import * as p10Registry from '../extensionRegistry.js';

export class ExtensionRegistry {
  constructor({ eventBus, store } = {}) {
    this._eventBus = eventBus;
    this._store = store;
  }
  init() { return this; }
  start() { return this; }
  stop() {}
  wireEvents() {}
  getAllInstalled() { return p10Registry.getAllInstalled(); }
  getInstalled(id) { return p10Registry.getInstalled(id); }
  isInstalled(id) { return p10Registry.isInstalled(id); }
  getEnabledForProject(projectId) { return p10Registry.getEnabledForProject(projectId); }
}

export default ExtensionRegistry;
