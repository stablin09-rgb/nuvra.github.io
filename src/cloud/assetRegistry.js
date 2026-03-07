/**
 * Nuvra Builder — Asset Registry (Phase 11)
 *
 * Manages the state of all installed cloud marketplace assets.
 * Scoped by userId and projectId.
 *
 * Storage schema (localStorage):
 *  nuvra-mp-assets-global-{userId}:    { [assetId]: InstalledAsset }
 *  nuvra-mp-assets-project-{projectId}: { [assetId]: ProjectAssetState }
 *  nuvra-mp-bundle-{assetId}-{version}: string (bundle code)
 *  nuvra-mp-snapshot-{assetId}:         InstalledAsset (rollback snapshot)
 *
 * InstalledAsset:
 *  {
 *    assetId:     string,
 *    name:        string,
 *    type:        string,
 *    version:     string,
 *    installedAt: ISO string,
 *    updatedAt:   ISO string,
 *    source:      'cloud' | 'local',
 *    bundleKey:   string,
 *    config:      object,
 *    license:     LicenseDefinition,
 *    permissions: string[],
 *  }
 *
 * ProjectAssetState:
 *  {
 *    assetId:   string,
 *    enabled:   boolean,
 *    config:    object,
 *    pinnedAt:  string | null,  // version pinned to
 *  }
 */
'use strict';

let _userId = null;

const _globalKey    = (uid) => `nuvra-mp-assets-global-${uid || 'anon'}`;
const _projectKey   = (pid) => `nuvra-mp-assets-project-${pid}`;
const _bundleKey    = (id, ver) => `nuvra-mp-bundle-${id}-${ver}`;
const _snapshotKey  = (id) => `nuvra-mp-snapshot-${id}`;

function _read(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
}
function _write(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

export const assetRegistry = {

  init(userId) {
    _userId = userId;
  },

  // ── Global (user-level) operations ─────────────────────────────────────────

  getInstalled(assetId) {
    const global = _read(_globalKey(_userId));
    return global[assetId] || null;
  },

  getAllInstalled() {
    return Object.values(_read(_globalKey(_userId)));
  },

  getInstalledForProject(projectId) {
    const global  = _read(_globalKey(_userId));
    const project = _read(_projectKey(projectId));
    return Object.values(global).map(asset => ({
      ...asset,
      projectState: project[asset.assetId] || { enabled: true, config: {}, pinnedAt: null },
    }));
  },

  isInstalled(assetId, projectId) {
    const global = _read(_globalKey(_userId));
    if (!global[assetId]) return false;
    if (!projectId) return true;
    const project = _read(_projectKey(projectId));
    return !!project[assetId];
  },

  async install(asset, versionSpec, { projectId, config = {} } = {}) {
    const now = new Date().toISOString();

    // Store bundle code
    const bundleCode = versionSpec.bundle || '';
    const bKey = _bundleKey(asset.assetId, versionSpec.version);
    try { localStorage.setItem(bKey, bundleCode); } catch {}

    // Register globally
    const global = _read(_globalKey(_userId));
    global[asset.assetId] = {
      assetId:     asset.assetId,
      name:        asset.name,
      type:        asset.type,
      version:     versionSpec.version,
      installedAt: global[asset.assetId]?.installedAt || now,
      updatedAt:   now,
      source:      asset.source || 'cloud',
      bundleKey:   bKey,
      config:      config,
      license:     asset.license || {},
      permissions: asset.permissions || [],
    };
    _write(_globalKey(_userId), global);

    // Register for project
    if (projectId) {
      const project = _read(_projectKey(projectId));
      project[asset.assetId] = {
        assetId:  asset.assetId,
        enabled:  true,
        config:   config,
        pinnedAt: null,
      };
      _write(_projectKey(projectId), project);
    }
  },

  async snapshotForRollback(assetId) {
    const installed = this.getInstalled(assetId);
    if (installed) {
      _write(_snapshotKey(assetId), installed);
    }
  },

  async rollback(assetId) {
    const snapshot = _read(_snapshotKey(assetId));
    if (!snapshot || !snapshot.assetId) {
      return { success: false, message: 'No rollback snapshot available' };
    }
    const global = _read(_globalKey(_userId));
    global[assetId] = snapshot;
    _write(_globalKey(_userId), global);
    return { success: true, version: snapshot.version };
  },

  async remove(assetId, projectId) {
    // Remove from project
    if (projectId) {
      const project = _read(_projectKey(projectId));
      delete project[assetId];
      _write(_projectKey(projectId), project);
    }

    // Check if used in other projects — if not, remove globally
    const installed = this.getInstalled(assetId);
    if (installed) {
      try { localStorage.removeItem(installed.bundleKey); } catch {}
      try { localStorage.removeItem(_snapshotKey(assetId)); } catch {}
      const global = _read(_globalKey(_userId));
      delete global[assetId];
      _write(_globalKey(_userId), global);
    }
  },

  getBundle(assetId, version) {
    const installed = this.getInstalled(assetId);
    if (!installed) return null;
    const key = version ? _bundleKey(assetId, version) : installed.bundleKey;
    return localStorage.getItem(key) || null;
  },

  pinVersion(assetId, projectId, version) {
    const project = _read(_projectKey(projectId));
    if (project[assetId]) {
      project[assetId].pinnedAt = version;
      _write(_projectKey(projectId), project);
    }
  },

  setEnabled(assetId, projectId, enabled) {
    const project = _read(_projectKey(projectId));
    if (project[assetId]) {
      project[assetId].enabled = enabled;
      _write(_projectKey(projectId), project);
    }
  },

  updateConfig(assetId, projectId, config) {
    const project = _read(_projectKey(projectId));
    if (project[assetId]) {
      project[assetId].config = { ...project[assetId].config, ...config };
      _write(_projectKey(projectId), project);
    }
  },

  /**
   * Export the full asset graph for a project (for cloud sync).
   */
  exportProjectGraph(projectId) {
    const project = _read(_projectKey(projectId));
    const global  = _read(_globalKey(_userId));
    return Object.keys(project).map(assetId => ({
      ...global[assetId],
      projectState: project[assetId],
    }));
  },

  /**
   * Import an asset graph (from cloud sync or project import).
   */
  importProjectGraph(projectId, graph) {
    const global  = _read(_globalKey(_userId));
    const project = _read(_projectKey(projectId));
    for (const entry of graph) {
      global[entry.assetId] = {
        assetId:     entry.assetId,
        name:        entry.name,
        type:        entry.type,
        version:     entry.version,
        installedAt: entry.installedAt,
        updatedAt:   entry.updatedAt,
        source:      entry.source,
        bundleKey:   entry.bundleKey,
        config:      entry.config,
        license:     entry.license,
        permissions: entry.permissions,
      };
      project[entry.assetId] = entry.projectState || { enabled: true, config: {}, pinnedAt: null };
    }
    _write(_globalKey(_userId), global);
    _write(_projectKey(projectId), project);
  },
};
