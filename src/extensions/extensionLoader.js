/**
 * Nuvra Builder — Extension Loader (Phase 10)
 *
 * The full lifecycle manager for extensions.
 * Handles: install, enable, disable, update, rollback, remove.
 *
 * INSTALL FLOW:
 *  1. Validate the manifest (schema, version compatibility, permissions)
 *  2. Show permission approval dialog for sensitive permissions
 *  3. Store the bundle code in localStorage (keyed by bundleKey)
 *  4. Register in the global registry
 *  5. Optionally enable for the current project
 *
 * UPDATE FLOW:
 *  1. Validate the new manifest
 *  2. Snapshot the old version (for rollback)
 *  3. Replace bundle and manifest in registry
 *  4. If the extension is active, re-mount the sandbox
 *
 * ROLLBACK FLOW:
 *  1. Restore the snapshot from the previous version
 *  2. Re-mount the sandbox with the old bundle
 *
 * REMOVE FLOW:
 *  1. Disable the extension in all projects
 *  2. Remove from global registry
 *  3. Delete the bundle from localStorage
 *  4. Delete extension-scoped storage
 */
'use strict';

import {
  registerInstalled,
  unregisterInstalled,
  getInstalled,
  isInstalled,
  enableForProject,
  disableForProject,
  removeFromAllProjects,
} from './extensionRegistry.js';

import {
  validatePermissions,
  getApprovalRequired,
  getPermissionsByCategory,
} from './permissions.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const NUVRA_VERSION        = '10.0.0';
const BUNDLE_KEY_PREFIX    = 'nuvra-ext-bundle-';
const SNAPSHOT_KEY_PREFIX  = 'nuvra-ext-snapshot-';

// ─── Manifest Validation ──────────────────────────────────────────────────────

/**
 * Validate an ExtensionManifest object.
 * @param {object} manifest
 * @throws {Error} if the manifest is invalid
 */
export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Manifest must be an object');
  }
  const required = ['id', 'name', 'version', 'author', 'type', 'permissions'];
  for (const field of required) {
    if (!manifest[field]) throw new Error(`Manifest missing required field: "${field}"`);
  }
  const validTypes = ['template', 'block', 'app-component', 'integration', 'ai-pack'];
  if (!validTypes.includes(manifest.type)) {
    throw new Error(`Invalid extension type: "${manifest.type}". Must be one of: ${validTypes.join(', ')}`);
  }
  if (!Array.isArray(manifest.permissions)) {
    throw new Error('Manifest permissions must be an array');
  }
  const { valid, unknown } = validatePermissions(manifest.permissions);
  if (!valid) {
    throw new Error(`Unknown permissions declared: ${unknown.join(', ')}`);
  }
  if (typeof manifest.id !== 'string' || !/^[a-z0-9-]+$/.test(manifest.id)) {
    throw new Error('Extension ID must be lowercase alphanumeric with hyphens only');
  }
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error('Extension version must be semver (e.g., 1.0.0)');
  }
}

/**
 * Check whether an extension is compatible with the current Nuvra version.
 * @param {object} manifest
 * @returns {{ compatible: boolean, reason: string | null }}
 */
export function checkCompatibility(manifest) {
  const minVersion = manifest.minNuvraVersion;
  if (!minVersion) return { compatible: true, reason: null };

  const [major] = NUVRA_VERSION.split('.').map(Number);
  const [reqMajor] = minVersion.split('.').map(Number);

  if (reqMajor > major) {
    return {
      compatible: false,
      reason: `Requires Nuvra v${minVersion} or higher (current: v${NUVRA_VERSION})`,
    };
  }
  return { compatible: true, reason: null };
}

// ─── Permission Approval ──────────────────────────────────────────────────────

/**
 * Show a permission approval dialog for sensitive permissions.
 * Returns a Promise that resolves with the approved permissions array,
 * or rejects if the user cancels.
 *
 * @param {object} manifest
 * @returns {Promise<string[]>} Approved permissions
 */
export function requestPermissionApproval(manifest) {
  return new Promise((resolve, reject) => {
    const sensitive = getApprovalRequired(manifest.permissions);
    if (sensitive.length === 0) {
      // No sensitive permissions — auto-approve all
      resolve(manifest.permissions);
      return;
    }

    // Build the approval dialog
    const overlay = document.createElement('div');
    overlay.className = 'nv-permission-overlay';
    overlay.innerHTML = `
      <div class="nv-permission-dialog">
        <div class="nv-permission-header">
          <span class="nv-permission-icon">🔐</span>
          <div>
            <h3 class="nv-permission-title">Install "${manifest.name}"?</h3>
            <p class="nv-permission-subtitle">v${manifest.version} by ${manifest.author}</p>
          </div>
        </div>
        <p class="nv-permission-intro">This extension requests the following permissions:</p>
        <ul class="nv-permission-list">
          ${sensitive.map(p => `
            <li class="nv-permission-item ${p.requiresApproval ? 'sensitive' : ''}">
              <span class="nv-perm-icon">${_permIcon(p.category)}</span>
              <div>
                <strong>${p.label}</strong>
                <small>${p.description}</small>
              </div>
            </li>
          `).join('')}
        </ul>
        <div class="nv-permission-actions">
          <button class="nuvra-btn" id="nv-perm-cancel">Cancel</button>
          <button class="nuvra-btn primary" id="nv-perm-approve">Install &amp; Approve</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#nv-perm-approve').addEventListener('click', () => {
      overlay.remove();
      resolve(manifest.permissions); // Approve all declared permissions
    });

    overlay.querySelector('#nv-perm-cancel').addEventListener('click', () => {
      overlay.remove();
      reject(new Error('Installation cancelled by user'));
    });
  });
}

function _permIcon(category) {
  const icons = {
    editor:  '✏️',
    data:    '🗄️',
    ai:      '🤖',
    network: '🌐',
    project: '📁',
    storage: '💾',
  };
  return icons[category] || '🔧';
}

// ─── Install ──────────────────────────────────────────────────────────────────

/**
 * Install an extension from a manifest and bundle code.
 *
 * @param {object} manifest    - The ExtensionManifest
 * @param {string} bundleCode  - The extension's JavaScript code
 * @param {object} [options]
 * @param {string} [options.projectId]     - If set, enable for this project after install
 * @param {boolean} [options.skipApproval] - Skip permission dialog (for testing)
 * @returns {Promise<{ extensionId: string, approved: string[] }>}
 */
export async function install(manifest, bundleCode, options = {}) {
  // 1. Validate
  validateManifest(manifest);
  const { compatible, reason } = checkCompatibility(manifest);
  if (!compatible) throw new Error(`Incompatible extension: ${reason}`);

  // 2. Check for existing installation
  if (isInstalled(manifest.id)) {
    throw new Error(`Extension "${manifest.id}" is already installed. Use update() to upgrade.`);
  }

  // 3. Request permission approval
  let approved;
  if (options.skipApproval) {
    approved = manifest.permissions;
  } else {
    approved = await requestPermissionApproval(manifest);
  }

  // 4. Store the bundle in localStorage
  const bundleKey = BUNDLE_KEY_PREFIX + manifest.id;
  localStorage.setItem(bundleKey, bundleCode);

  // 5. Register in the global registry
  registerInstalled(manifest, bundleKey, approved);

  // 6. Enable for the current project if requested
  if (options.projectId) {
    enableForProject(options.projectId, manifest.id, options.config || {});
  }

  return { extensionId: manifest.id, approved };
}

// ─── Enable / Disable ─────────────────────────────────────────────────────────

/**
 * Enable an installed extension for a specific project.
 * @param {string} projectId
 * @param {string} extensionId
 * @param {object} [config]
 */
export function enable(projectId, extensionId, config = {}) {
  if (!isInstalled(extensionId)) {
    throw new Error(`Extension "${extensionId}" is not installed`);
  }
  enableForProject(projectId, extensionId, config);
}

/**
 * Disable an extension for a specific project (does not uninstall).
 * @param {string} projectId
 * @param {string} extensionId
 */
export function disable(projectId, extensionId) {
  disableForProject(projectId, extensionId);
}

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * Update an installed extension to a new version.
 * Snapshots the old version for rollback.
 *
 * @param {object} newManifest
 * @param {string} newBundleCode
 * @returns {Promise<{ extensionId: string, previousVersion: string }>}
 */
export async function update(newManifest, newBundleCode) {
  validateManifest(newManifest);

  const existing = getInstalled(newManifest.id);
  if (!existing) {
    throw new Error(`Extension "${newManifest.id}" is not installed. Use install() first.`);
  }

  // Snapshot the current version for rollback
  const snapshotKey = SNAPSHOT_KEY_PREFIX + newManifest.id;
  const snapshot = {
    manifest:   existing.manifest,
    bundleCode: localStorage.getItem(existing.bundleKey),
    approved:   existing.approved,
    snapshotAt: new Date().toISOString(),
  };
  localStorage.setItem(snapshotKey, JSON.stringify(snapshot));

  // Request approval for any new permissions
  const newPerms = newManifest.permissions.filter(p => !existing.approved.includes(p));
  let approved = [...existing.approved];
  if (newPerms.length > 0) {
    const approvalManifest = { ...newManifest, permissions: newPerms };
    const newApproved = await requestPermissionApproval(approvalManifest);
    approved = [...new Set([...existing.approved, ...newApproved])];
  }

  // Replace the bundle
  localStorage.setItem(existing.bundleKey, newBundleCode);

  // Update the registry
  unregisterInstalled(newManifest.id);
  registerInstalled(newManifest, existing.bundleKey, approved);

  return { extensionId: newManifest.id, previousVersion: existing.version };
}

// ─── Rollback ─────────────────────────────────────────────────────────────────

/**
 * Roll back an extension to its previous version.
 * @param {string} extensionId
 * @returns {{ extensionId: string, rolledBackTo: string }}
 */
export function rollback(extensionId) {
  const snapshotKey = SNAPSHOT_KEY_PREFIX + extensionId;
  const snapshotJson = localStorage.getItem(snapshotKey);
  if (!snapshotJson) {
    throw new Error(`No rollback snapshot available for extension "${extensionId}"`);
  }

  const snapshot = JSON.parse(snapshotJson);
  const existing  = getInstalled(extensionId);
  if (!existing) throw new Error(`Extension "${extensionId}" is not installed`);

  // Restore the bundle
  localStorage.setItem(existing.bundleKey, snapshot.bundleCode);

  // Restore the registry entry
  unregisterInstalled(extensionId);
  registerInstalled(snapshot.manifest, existing.bundleKey, snapshot.approved);

  // Remove the snapshot (one rollback level only)
  localStorage.removeItem(snapshotKey);

  return { extensionId, rolledBackTo: snapshot.manifest.version };
}

// ─── Remove ───────────────────────────────────────────────────────────────────

/**
 * Completely remove an extension.
 * Disables it in all projects, removes the bundle, and clears storage.
 * @param {string} extensionId
 */
export function remove(extensionId) {
  const existing = getInstalled(extensionId);
  if (!existing) throw new Error(`Extension "${extensionId}" is not installed`);

  // Remove from all project states
  removeFromAllProjects(extensionId);

  // Remove the bundle from localStorage
  localStorage.removeItem(existing.bundleKey);

  // Remove the snapshot if any
  localStorage.removeItem(SNAPSHOT_KEY_PREFIX + extensionId);

  // Remove extension-scoped storage
  const storagePrefix = `nuvra-ext-storage-${extensionId}-`;
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(storagePrefix)) keysToRemove.push(key);
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));

  // Unregister from global registry
  unregisterInstalled(extensionId);
}

// ─── Snapshot Check ───────────────────────────────────────────────────────────

/**
 * Check whether a rollback snapshot exists for an extension.
 */
export function hasRollbackSnapshot(extensionId) {
  return Boolean(localStorage.getItem(SNAPSHOT_KEY_PREFIX + extensionId));
}

/**
 * Get the version of the rollback snapshot, if any.
 */
export function getRollbackVersion(extensionId) {
  const json = localStorage.getItem(SNAPSHOT_KEY_PREFIX + extensionId);
  if (!json) return null;
  try {
    return JSON.parse(json).manifest?.version || null;
  } catch {
    return null;
  }
}
