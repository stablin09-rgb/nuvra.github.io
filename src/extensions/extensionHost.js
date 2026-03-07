/**
 * Nuvra Builder — Extension Host (Phase 10)
 *
 * The central orchestrator for the extension runtime.
 * Manages all active sandboxes, routes API calls, and enforces permissions.
 *
 * RESPONSIBILITIES:
 *  1. Mount/unmount sandboxes for enabled extensions
 *  2. Route API calls from sandboxes to the correct API module
 *  3. Enforce permission boundaries on every call
 *  4. Dispatch editor/project events to all active sandboxes
 *  5. Provide the API dispatcher to each ExtensionSandbox
 *
 * LIFECYCLE:
 *  init(editor) → called once after editor initialisation
 *  activateProject(projectId) → called when a project is opened
 *  deactivateProject() → called when switching projects
 *  destroy() → called on app shutdown
 */
'use strict';

import { ExtensionSandbox }                      from './sandbox.js';
import { getEnabledForProject }                  from './extensionRegistry.js';
import { setEditor, dispatchEditorCall,
         cleanupExtension as cleanupEditorExt }  from './api/editorApi.js';
import { initDataApi, dispatchDataCall }         from './api/dataApi.js';
import { dispatchAICall, cleanupAIExtension }    from './api/aiApi.js';

// ─── State ────────────────────────────────────────────────────────────────────

/** Map<extensionId, ExtensionSandbox> */
const _activeSandboxes = new Map();

let _activeProjectId = null;
let _editor          = null;
let _generateFn      = null; // Reference to aiEngine.generatePage

// ─── Initialisation ───────────────────────────────────────────────────────────

/**
 * Initialise the host with the GrapesJS editor instance.
 * Call once after editor.init().
 * @param {object} editorInstance - GrapesJS editor
 * @param {Function} generateFn   - aiEngine.generatePage reference
 */
export function init(editorInstance, generateFn) {
  _editor     = editorInstance;
  _generateFn = generateFn;
  setEditor(editorInstance);
}

/**
 * Activate all enabled extensions for a project.
 * Mounts sandboxes for each enabled extension.
 * @param {string} projectId
 * @param {object} dataStoreFns - { getCollections, getSchema, query, insert, update, remove, addCollection }
 */
export async function activateProject(projectId, dataStoreFns) {
  // Deactivate previous project first
  await deactivateProject();

  _activeProjectId = projectId;

  // Initialise the data API with the new project context
  initDataApi(() => _activeProjectId, dataStoreFns);

  // Get all extensions enabled for this project
  const enabled = getEnabledForProject(projectId);

  for (const { installed, state } of enabled) {
    await _mountExtension(installed, state);
  }

  console.log(`[ExtensionHost] Activated ${_activeSandboxes.size} extension(s) for project ${projectId}`);
}

/**
 * Deactivate all active extensions (called when switching projects).
 */
export async function deactivateProject() {
  for (const [extensionId, sandbox] of _activeSandboxes) {
    sandbox.destroy();
    cleanupEditorExt(extensionId);
    cleanupAIExtension(extensionId);
  }
  _activeSandboxes.clear();
  _activeProjectId = null;
}

// ─── Extension Mounting ───────────────────────────────────────────────────────

/**
 * Mount a single extension sandbox.
 * @param {InstalledExtension} installed
 * @param {ProjectExtensionState} state
 */
async function _mountExtension(installed, state) {
  const { id: extensionId, bundleKey, approved } = installed;

  // Load the bundle code from localStorage
  const bundleCode = localStorage.getItem(bundleKey);
  if (!bundleCode) {
    console.warn(`[ExtensionHost] Bundle not found for extension "${extensionId}" (key: ${bundleKey})`);
    return;
  }

  // Create the API dispatcher for this extension
  const dispatcher = _createDispatcher(extensionId, approved);

  // Create and mount the sandbox
  const sandbox = new ExtensionSandbox(extensionId, bundleCode, dispatcher);
  try {
    await sandbox.mount();
    _activeSandboxes.set(extensionId, sandbox);
    console.log(`[ExtensionHost] Mounted extension: ${extensionId}`);
  } catch (err) {
    console.error(`[ExtensionHost] Failed to mount extension "${extensionId}":`, err);
  }
}

/**
 * Create the API dispatcher for a specific extension.
 * This is the only way the sandbox can communicate with the host.
 */
function _createDispatcher(extensionId, permissions) {
  return {
    async dispatch(method, args, callerExtensionId) {
      // Verify the caller is who they claim to be
      if (callerExtensionId !== extensionId) {
        throw new Error('Extension identity mismatch');
      }

      const category = method.split('.')[0];

      switch (category) {
        case 'editor':
          return dispatchEditorCall(method, args, extensionId, permissions);

        case 'data':
          return dispatchDataCall(method, args, extensionId, permissions);

        case 'ai':
          return dispatchAICall(method, args, extensionId, permissions, _generateFn);

        case 'project':
          return _dispatchProjectCall(method, args, extensionId, permissions);

        case 'storage':
          return _dispatchStorageCall(method, args, extensionId, permissions);

        case 'network':
          return _dispatchNetworkCall(method, args, extensionId, permissions);

        default:
          throw new Error(`Unknown API category: ${category}`);
      }
    },
  };
}

// ─── Project API Dispatcher ───────────────────────────────────────────────────

import { hasPermission } from './permissions.js';

async function _dispatchProjectCall(method, args, extensionId, permissions) {
  switch (method) {
    case 'project.getMeta': {
      if (!hasPermission(permissions, 'project.meta.read')) {
        throw new Error('Permission denied: project.meta.read required');
      }
      // Return safe project metadata (no internal keys)
      return {
        projectId: _activeProjectId,
        // Additional meta would come from projectManager
      };
    }

    case 'project.getPages': {
      if (!hasPermission(permissions, 'project.pages.read')) {
        throw new Error('Permission denied: project.pages.read required');
      }
      // Return page list from the editor
      if (!_editor) return [];
      return _editor.Pages.getAll().map(p => ({
        id:   p.getId(),
        name: p.get('name'),
      }));
    }

    case 'project.addPage': {
      if (!hasPermission(permissions, 'project.pages.add')) {
        throw new Error('Permission denied: project.pages.add required');
      }
      const [name, html] = args;
      if (!name || typeof name !== 'string') throw new Error('Page name required');
      if (_editor) {
        _editor.Pages.add({ name, component: html || '' });
      }
      return true;
    }

    default:
      throw new Error(`Unknown project API method: ${method}`);
  }
}

// ─── Storage API Dispatcher ───────────────────────────────────────────────────

function _dispatchStorageCall(method, args, extensionId, permissions) {
  if (!hasPermission(permissions, 'storage.extension')) {
    throw new Error('Permission denied: storage.extension required');
  }
  const PREFIX = `nuvra-ext-storage-${extensionId}-`;

  switch (method) {
    case 'storage.get': {
      const [key] = args;
      try { return JSON.parse(localStorage.getItem(PREFIX + key)); }
      catch { return null; }
    }
    case 'storage.set': {
      const [key, value] = args;
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    }
    case 'storage.remove': {
      const [key] = args;
      localStorage.removeItem(PREFIX + key);
      return true;
    }
    default:
      throw new Error(`Unknown storage API method: ${method}`);
  }
}

// ─── Network API Dispatcher ───────────────────────────────────────────────────

async function _dispatchNetworkCall(method, args, extensionId, permissions) {
  if (!hasPermission(permissions, 'network.fetch')) {
    throw new Error('Permission denied: network.fetch required');
  }

  if (method !== 'network.fetch') {
    throw new Error(`Unknown network API method: ${method}`);
  }

  const [url, options] = args;

  // Validate URL against the extension's declared allowed origins
  // (In Phase 10, we trust the permission approval; Phase 11 will add origin validation)
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    throw new Error('Network fetch: only HTTPS URLs are allowed');
  }

  const response = await fetch(url, {
    method:  options?.method  || 'GET',
    headers: options?.headers || {},
    body:    options?.body    || undefined,
  });

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  return {
    ok:     response.ok,
    status: response.status,
    body:   text,
    json:   contentType.includes('application/json') ? JSON.parse(text) : null,
  };
}

// ─── Event Broadcasting ───────────────────────────────────────────────────────

/**
 * Broadcast an event to all active sandboxes.
 * @param {string} event - e.g., 'project.changed', 'page.changed'
 * @param {object} data
 */
export function broadcastEvent(event, data) {
  for (const sandbox of _activeSandboxes.values()) {
    if (sandbox.isReady) {
      sandbox.dispatchEvent(event, data);
    }
  }
}

// ─── Status ───────────────────────────────────────────────────────────────────

/**
 * Get the count of active sandboxes.
 */
export function getActiveCount() {
  return _activeSandboxes.size;
}

/**
 * Get IDs of all active extensions.
 */
export function getActiveExtensionIds() {
  return Array.from(_activeSandboxes.keys());
}

/**
 * Destroy the host (called on app shutdown).
 */
export async function destroy() {
  await deactivateProject();
}
