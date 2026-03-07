/**
 * Nuvra Builder — Marketplace Manager (Phase 10)
 *
 * The data and logic layer for the Extension Marketplace.
 * Handles catalog loading, search/filter, and delegates
 * install/update/remove operations to extensionLoader.js.
 *
 * DESIGN: The catalog is loaded from a local JSON file in Phase 10.
 * In Phase 11, this will fetch from the Nuvra cloud CDN.
 * The interface is identical — only the source changes.
 */
'use strict';

import { install, enable, disable, remove, update, rollback,
         hasRollbackSnapshot, getRollbackVersion }    from '../extensions/extensionLoader.js';
import { getInstalled, isInstalled,
         isEnabledForProject }                        from '../extensions/extensionRegistry.js';
import { activateProject }                            from '../extensions/extensionHost.js';

// ─── Catalog ──────────────────────────────────────────────────────────────────

let _catalog = null;
let _activeProjectId = null;

/**
 * Load the extension catalog.
 * In Phase 10: loads from the local catalog.json.
 * In Phase 11: will fetch from https://marketplace.nuvra.io/catalog.json
 * @returns {Promise<object[]>} Array of extension manifests
 */
export async function loadCatalog() {
  if (_catalog) return _catalog;

  try {
    // Dynamic import of the local catalog
    const mod = await import('./catalog.json', { assert: { type: 'json' } });
    _catalog = mod.default.extensions;
  } catch {
    // Fallback: fetch as a regular JSON file (for environments without import assertions)
    try {
      const res = await fetch('./src/marketplace/catalog.json');
      const data = await res.json();
      _catalog = data.extensions;
    } catch (err) {
      console.error('[Marketplace] Failed to load catalog:', err);
      _catalog = [];
    }
  }

  return _catalog;
}

/**
 * Set the active project ID (called when a project is opened).
 */
export function setActiveProject(projectId) {
  _activeProjectId = projectId;
}

// ─── Search & Filter ──────────────────────────────────────────────────────────

/**
 * Search and filter the catalog.
 * @param {object} options
 * @param {string}   [options.query]    - Full-text search
 * @param {string}   [options.type]     - Filter by type (template, block, integration, ai-pack)
 * @param {string}   [options.category] - Filter by category
 * @param {string}   [options.sort]     - 'name' | 'newest' | 'popular'
 * @returns {Promise<EnrichedExtension[]>}
 */
export async function searchCatalog({ query = '', type = '', category = '', sort = 'popular' } = {}) {
  const catalog = await loadCatalog();

  let results = catalog.map(ext => _enrich(ext));

  // Filter by type
  if (type) {
    results = results.filter(e => e.type === type);
  }

  // Filter by category
  if (category) {
    results = results.filter(e => e.category === category);
  }

  // Full-text search
  if (query.trim()) {
    const q = query.toLowerCase().trim();
    results = results.filter(e =>
      e.name.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q) ||
      (e.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }

  // Sort
  switch (sort) {
    case 'name':
      results.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'newest':
      results.sort((a, b) => b.version.localeCompare(a.version));
      break;
    case 'popular':
    default:
      // Installed extensions first, then alphabetical
      results.sort((a, b) => {
        if (a.isInstalled && !b.isInstalled) return -1;
        if (!a.isInstalled && b.isInstalled) return 1;
        return a.name.localeCompare(b.name);
      });
  }

  return results;
}

/**
 * Get all available categories from the catalog.
 * @returns {Promise<string[]>}
 */
export async function getCategories() {
  const catalog = await loadCatalog();
  return [...new Set(catalog.map(e => e.category))].sort();
}

/**
 * Get a single extension by ID, enriched with install state.
 * @param {string} extensionId
 * @returns {Promise<EnrichedExtension | null>}
 */
export async function getExtension(extensionId) {
  const catalog = await loadCatalog();
  const ext = catalog.find(e => e.id === extensionId);
  if (!ext) return null;
  return _enrich(ext);
}

// ─── Install / Enable / Disable / Remove ─────────────────────────────────────

/**
 * Install an extension from the catalog.
 * @param {string} extensionId
 * @param {object} [options]
 * @param {boolean} [options.enableAfterInstall=true]
 * @returns {Promise<{ extensionId: string, approved: string[] }>}
 */
export async function installFromCatalog(extensionId, options = {}) {
  const catalog = await loadCatalog();
  const ext = catalog.find(e => e.id === extensionId);
  if (!ext) throw new Error(`Extension "${extensionId}" not found in catalog`);

  const bundleCode = ext.bundle;
  if (!bundleCode) throw new Error(`Extension "${extensionId}" has no bundle code`);

  const result = await install(ext, bundleCode, {
    projectId: (options.enableAfterInstall !== false) ? _activeProjectId : undefined,
    skipApproval: options.skipApproval || false,
  });

  // If a project is active and we just installed, re-activate extensions
  if (_activeProjectId && options.enableAfterInstall !== false) {
    await _reactivateExtensions();
  }

  return result;
}

/**
 * Enable an installed extension for the active project.
 * @param {string} extensionId
 * @param {object} [config]
 */
export async function enableExtension(extensionId, config = {}) {
  if (!_activeProjectId) throw new Error('No active project');
  enable(_activeProjectId, extensionId, config);
  await _reactivateExtensions();
}

/**
 * Disable an extension for the active project.
 * @param {string} extensionId
 */
export async function disableExtension(extensionId) {
  if (!_activeProjectId) throw new Error('No active project');
  disable(_activeProjectId, extensionId);
  await _reactivateExtensions();
}

/**
 * Remove an extension completely.
 * @param {string} extensionId
 */
export async function removeExtension(extensionId) {
  remove(extensionId);
  if (_activeProjectId) {
    await _reactivateExtensions();
  }
}

/**
 * Update an extension to the latest catalog version.
 * @param {string} extensionId
 */
export async function updateExtension(extensionId) {
  const catalog = await loadCatalog();
  const ext = catalog.find(e => e.id === extensionId);
  if (!ext) throw new Error(`Extension "${extensionId}" not found in catalog`);

  const result = await update(ext, ext.bundle);

  if (_activeProjectId) {
    await _reactivateExtensions();
  }

  return result;
}

/**
 * Roll back an extension to its previous version.
 * @param {string} extensionId
 */
export async function rollbackExtension(extensionId) {
  const result = rollback(extensionId);
  if (_activeProjectId) {
    await _reactivateExtensions();
  }
  return result;
}

// ─── Installed Extensions ─────────────────────────────────────────────────────

/**
 * Get all installed extensions, enriched with catalog data and project state.
 * @returns {EnrichedExtension[]}
 */
export function getInstalledExtensions() {
  const installed = getInstalled();
  return installed.map(inst => {
    const catalogEntry = _catalog?.find(e => e.id === inst.id) || {};
    return {
      ...catalogEntry,
      ...inst,
      isInstalled:       true,
      isEnabledForProject: _activeProjectId ? isEnabledForProject(_activeProjectId, inst.id) : false,
      hasUpdate:         catalogEntry.version && catalogEntry.version !== inst.version,
      canRollback:       hasRollbackSnapshot(inst.id),
      rollbackVersion:   getRollbackVersion(inst.id),
    };
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Enrich a catalog entry with install state.
 */
function _enrich(ext) {
  const installed = isInstalled(ext.id) ? getInstalled().find(i => i.id === ext.id) : null;
  const catalogVersion = ext.version;
  const installedVersion = installed?.version;
  const hasUpdate = installed && installedVersion && catalogVersion !== installedVersion;

  return {
    ...ext,
    isInstalled:           Boolean(installed),
    isEnabledForProject:   _activeProjectId ? isEnabledForProject(_activeProjectId, ext.id) : false,
    hasUpdate,
    canRollback:           hasRollbackSnapshot(ext.id),
    rollbackVersion:       getRollbackVersion(ext.id),
    installedVersion,
  };
}

/**
 * Re-activate all extensions for the current project.
 * Called after any install/enable/disable/remove operation.
 */
async function _reactivateExtensions() {
  if (!_activeProjectId) return;
  // The extensionHost will handle the sandbox lifecycle
  // We pass an empty dataStore here — the real one is set by app.js
  await activateProject(_activeProjectId, _getDataStoreFns());
}

// This will be set by app.js after the data store is initialised
let _dataStoreFns = null;
export function setDataStoreFns(fns) { _dataStoreFns = fns; }
function _getDataStoreFns() { return _dataStoreFns || {}; }
