/**
 * Nuvra Builder — Extension Data API (Phase 10)
 *
 * The scoped data API surface available to extensions.
 * Provides controlled access to project data collections and schemas.
 *
 * SECURITY: Extensions can only access collections in the active project.
 * Write operations require explicit user approval (data.write permission).
 */
'use strict';

import { hasPermission } from '../permissions.js';

// These will be set by extensionHost.js when a project is opened
let _getActiveProjectId = null;
let _dataStore          = null; // Reference to the project's dataStore module

/**
 * Initialise the data API with project context.
 * Called by extensionHost when a project is opened.
 */
export function initDataApi(getActiveProjectIdFn, dataStoreFns) {
  _getActiveProjectId = getActiveProjectIdFn;
  _dataStore          = dataStoreFns;
}

/**
 * Dispatch a data API call from an extension.
 */
export async function dispatchDataCall(method, args, extensionId, permissions) {
  _ensureInit();

  switch (method) {
    case 'data.getCollections': {
      _requirePermission(permissions, 'data.schema.read', method);
      return _dataStore.getCollections();
    }

    case 'data.getSchema': {
      _requirePermission(permissions, 'data.schema.read', method);
      const [name] = args;
      return _dataStore.getSchema(name);
    }

    case 'data.query': {
      _requirePermission(permissions, 'data.read', method);
      const [collectionName, query] = args;
      return _dataStore.query(collectionName, query || {});
    }

    case 'data.insert': {
      _requirePermission(permissions, 'data.write', method);
      const [collectionName, record] = args;
      _validateRecord(record);
      return _dataStore.insert(collectionName, record);
    }

    case 'data.update': {
      _requirePermission(permissions, 'data.write', method);
      const [collectionName, id, delta] = args;
      _validateRecord(delta);
      return _dataStore.update(collectionName, id, delta);
    }

    case 'data.remove': {
      _requirePermission(permissions, 'data.write', method);
      const [collectionName, id] = args;
      return _dataStore.remove(collectionName, id);
    }

    case 'data.addCollection': {
      _requirePermission(permissions, 'data.schema.write', method);
      const [schema] = args;
      _validateSchema(schema);
      return _dataStore.addCollection(schema);
    }

    default:
      throw new Error(`Unknown data API method: ${method}`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _ensureInit() {
  if (!_dataStore) throw new Error('Data API not initialised — no active project');
}

function _requirePermission(permissions, required, method) {
  if (!hasPermission(permissions, required)) {
    throw new Error(`Permission denied: "${required}" required for ${method}`);
  }
}

function _validateRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('Record must be a plain object');
  }
  const json = JSON.stringify(record);
  if (json.length > 1_000_000) throw new Error('Record too large (max 1MB)');
}

function _validateSchema(schema) {
  if (!schema || typeof schema !== 'object') throw new Error('Schema must be an object');
  if (!schema.name || typeof schema.name !== 'string') throw new Error('Schema must have a name');
  if (!Array.isArray(schema.fields)) throw new Error('Schema must have a fields array');
}
