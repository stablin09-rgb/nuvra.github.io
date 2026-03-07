/**
 * Nuvra Builder — Extension Registry (Phase 10)
 *
 * The central registry for all installed extensions.
 * Manages the lifecycle state of every extension across all projects.
 *
 * Storage schema (localStorage):
 *  nuvra-extensions-global:  { [extensionId]: InstalledExtension }
 *  nuvra-extensions-{projectId}: { [extensionId]: ProjectExtensionState }
 *
 * InstalledExtension:
 *  {
 *    id:          string,
 *    manifest:    ExtensionManifest,
 *    installedAt: ISO string,
 *    version:     string,
 *    source:      'local' | 'cloud',
 *    bundleKey:   string,  // localStorage key holding the bundle code
 *    approved:    string[] // permissions user has approved
 *  }
 *
 * ProjectExtensionState:
 *  {
 *    extensionId: string,
 *    enabled:     boolean,
 *    config:      object,  // integration-specific config (keys, endpoints)
 *    enabledAt:   ISO string | null
 *  }
 */
'use strict';

const GLOBAL_KEY  = 'nuvra-extensions-global';
const PROJECT_KEY = (projectId) => `nuvra-extensions-${projectId}`;

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function _readGlobal() {
  try {
    return JSON.parse(localStorage.getItem(GLOBAL_KEY) || '{}');
  } catch {
    return {};
  }
}

function _writeGlobal(data) {
  localStorage.setItem(GLOBAL_KEY, JSON.stringify(data));
}

function _readProject(projectId) {
  try {
    return JSON.parse(localStorage.getItem(PROJECT_KEY(projectId)) || '{}');
  } catch {
    return {};
  }
}

function _writeProject(projectId, data) {
  localStorage.setItem(PROJECT_KEY(projectId), JSON.stringify(data));
}

// ─── Registry API ─────────────────────────────────────────────────────────────

/**
 * Register an extension as installed globally.
 * Called by extensionLoader after a successful install.
 */
export function registerInstalled(manifest, bundleKey, approvedPermissions) {
  const global = _readGlobal();
  global[manifest.id] = {
    id:          manifest.id,
    manifest,
    installedAt: new Date().toISOString(),
    version:     manifest.version,
    source:      'local',
    bundleKey,
    approved:    approvedPermissions || [],
  };
  _writeGlobal(global);
}

/**
 * Remove an extension from the global registry.
 */
export function unregisterInstalled(extensionId) {
  const global = _readGlobal();
  delete global[extensionId];
  _writeGlobal(global);
}

/**
 * Get all globally installed extensions.
 * @returns {InstalledExtension[]}
 */
export function getAllInstalled() {
  return Object.values(_readGlobal());
}

/**
 * Get a single installed extension by ID.
 * @returns {InstalledExtension | null}
 */
export function getInstalled(extensionId) {
  return _readGlobal()[extensionId] || null;
}

/**
 * Check whether an extension is installed globally.
 */
export function isInstalled(extensionId) {
  return Boolean(_readGlobal()[extensionId]);
}

// ─── Project-Level State ──────────────────────────────────────────────────────

/**
 * Enable an extension for a specific project.
 * @param {string} projectId
 * @param {string} extensionId
 * @param {object} [config={}] - Integration-specific config
 */
export function enableForProject(projectId, extensionId, config = {}) {
  const proj = _readProject(projectId);
  proj[extensionId] = {
    extensionId,
    enabled:   true,
    config,
    enabledAt: new Date().toISOString(),
  };
  _writeProject(projectId, proj);
}

/**
 * Disable an extension for a specific project (does not uninstall).
 */
export function disableForProject(projectId, extensionId) {
  const proj = _readProject(projectId);
  if (proj[extensionId]) {
    proj[extensionId].enabled = false;
  }
  _writeProject(projectId, proj);
}

/**
 * Get all extensions enabled for a specific project.
 * Returns the full InstalledExtension merged with project state.
 * @returns {Array<{ installed: InstalledExtension, state: ProjectExtensionState }>}
 */
export function getEnabledForProject(projectId) {
  const global = _readGlobal();
  const proj   = _readProject(projectId);
  return Object.values(proj)
    .filter(s => s.enabled && global[s.extensionId])
    .map(state => ({
      installed: global[state.extensionId],
      state,
    }));
}

/**
 * Get the project-level state for a specific extension.
 */
export function getProjectState(projectId, extensionId) {
  return _readProject(projectId)[extensionId] || null;
}

/**
 * Check whether an extension is enabled for a specific project.
 */
export function isEnabledForProject(projectId, extensionId) {
  const state = _readProject(projectId)[extensionId];
  return Boolean(state?.enabled);
}

/**
 * Update the integration config for a project extension.
 */
export function updateProjectConfig(projectId, extensionId, config) {
  const proj = _readProject(projectId);
  if (proj[extensionId]) {
    proj[extensionId].config = { ...proj[extensionId].config, ...config };
    _writeProject(projectId, proj);
  }
}

/**
 * Remove all project-level state for an extension (called on global uninstall).
 * This iterates all known project keys — for local-first this is acceptable.
 */
export function removeFromAllProjects(extensionId) {
  // Scan all localStorage keys for project extension stores
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('nuvra-extensions-') && key !== GLOBAL_KEY) {
      try {
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        if (data[extensionId]) {
          delete data[extensionId];
          localStorage.setItem(key, JSON.stringify(data));
        }
      } catch { /* ignore */ }
    }
  }
}

/**
 * Get a summary of all installed extensions with their project-level state
 * for a given project. Used by the marketplace UI.
 * @returns {Array<{ installed: InstalledExtension, state: ProjectExtensionState | null }>}
 */
export function getMarketplaceState(projectId) {
  const global = _readGlobal();
  const proj   = _readProject(projectId);
  return Object.values(global).map(installed => ({
    installed,
    state: proj[installed.id] || null,
  }));
}
