/**
 * cloudStorage.js — Nuvra Phase 6
 *
 * Schema-aware cloud storage layer.
 *
 * Cloud is not a file dump — it's structured storage that understands:
 *  - Page schemas
 *  - App schemas
 *  - Data models
 *  - AI plans
 *  - Publish artifacts
 *  - Snapshots
 *
 * Every save is versioned. Every load validates the schema version.
 * Older schemas are migrated forward before use.
 *
 * @module cloud/storage/cloudStorage
 */
'use strict';

import { CloudSchemaType } from '../adapters/cloudContract.js';

// ─── Schema Version Registry ──────────────────────────────────────────────────
// Maps schema type → current version number
const CURRENT_SCHEMA_VERSIONS = {
  [CloudSchemaType.SITE_SCHEMA]:       2,
  [CloudSchemaType.APP_SCHEMA]:        3,
  [CloudSchemaType.AI_PLAN]:           1,
  [CloudSchemaType.DATA_MODEL]:        2,
  [CloudSchemaType.PUBLISH_ARTIFACT]:  1,
  [CloudSchemaType.SNAPSHOT]:          1,
};

// ─── Migration Registry ───────────────────────────────────────────────────────
// Maps schemaType → { fromVersion → migrationFn }
const MIGRATIONS = {
  [CloudSchemaType.SITE_SCHEMA]: {
    1: (data) => ({ ...data, _version: 2, _migratedFrom: 1, meta: data.meta || {} }),
  },
  [CloudSchemaType.APP_SCHEMA]: {
    1: (data) => ({ ...data, _version: 2, _migratedFrom: 1, permissions: data.permissions || {} }),
    2: (data) => ({ ...data, _version: 3, _migratedFrom: 2, dataModels: data.dataModels || data.collections || [] }),
  },
  [CloudSchemaType.DATA_MODEL]: {
    1: (data) => ({ ...data, _version: 2, _migratedFrom: 1, indexes: data.indexes || [] }),
  },
};

export class CloudStorage {
  /**
   * @param {object} params
   * @param {CloudProviderContract} params.adapter
   * @param {OwnershipManager}      params.ownershipManager
   * @param {object}                params.eventBus
   */
  constructor({ adapter, ownershipManager, eventBus }) {
    this._adapter          = adapter;
    this._ownershipManager = ownershipManager;
    this._eventBus         = eventBus;
    this._cache            = {};  // projectId:schemaType → { data, loadedAt }
    this._CACHE_TTL_MS     = 30_000; // 30 seconds
  }

  // ── Save ──────────────────────────────────────────────────────────────────────

  /**
   * Save a schema to cloud storage.
   * Validates ownership, stamps version, and archives the previous version.
   *
   * @param {string} projectId
   * @param {string} schemaType - CloudSchemaType
   * @param {object} data
   * @param {object} [options]
   * @param {string} [options.changeSummary]
   * @returns {Promise<CloudResult>}
   */
  async save(projectId, schemaType, data, options = {}) {
    // Zero-trust: verify permission
    if (!this._ownershipManager.canPerform(projectId, 'edit')) {
      return { ok: false, error: 'Insufficient permissions to save schema', code: 'storage/permission_denied' };
    }

    // Stamp with version and metadata
    const currentVersion = CURRENT_SCHEMA_VERSIONS[schemaType] || 1;
    const stamped = {
      ...data,
      _version:       currentVersion,
      _schemaType:    schemaType,
      _projectId:     projectId,
      _updatedAt:     Date.now(),
      _changeSummary: options.changeSummary || 'Updated',
    };

    const result = await this._adapter.saveSchema(projectId, schemaType, stamped);

    if (result.ok) {
      // Update cache
      this._setCache(projectId, schemaType, stamped);
      this._eventBus.emit('cloud:schema_saved', { projectId, schemaType, version: currentVersion });
    }

    return result;
  }

  /**
   * Load a schema from cloud storage.
   * Validates, migrates if needed, and caches the result.
   *
   * @param {string} projectId
   * @param {string} schemaType
   * @param {object} [options]
   * @param {boolean} [options.forceRefresh] - Skip cache
   * @returns {Promise<CloudResult>}
   */
  async load(projectId, schemaType, options = {}) {
    // Zero-trust: verify permission
    if (!this._ownershipManager.canPerform(projectId, 'read')) {
      return { ok: false, error: 'Insufficient permissions to read schema', code: 'storage/permission_denied' };
    }

    // Check cache
    if (!options.forceRefresh) {
      const cached = this._getCache(projectId, schemaType);
      if (cached) return { ok: true, data: cached, fromCache: true };
    }

    const result = await this._adapter.getSchema(projectId, schemaType);
    if (!result.ok) return result;
    if (!result.data) return { ok: true, data: null };

    // Migrate if needed
    const migrated = this._migrate(schemaType, result.data);

    // Cache the result
    this._setCache(projectId, schemaType, migrated);

    return { ok: true, data: migrated, fromCache: false };
  }

  /**
   * List all schema versions for a project/type.
   */
  async listVersions(projectId, schemaType) {
    if (!this._ownershipManager.canPerform(projectId, 'read')) {
      return { ok: false, error: 'Insufficient permissions', code: 'storage/permission_denied' };
    }
    return this._adapter.listSchemaVersions(projectId, schemaType);
  }

  /**
   * Restore a specific version of a schema.
   */
  async restoreVersion(projectId, schemaType, version) {
    if (!this._ownershipManager.canPerform(projectId, 'edit')) {
      return { ok: false, error: 'Insufficient permissions', code: 'storage/permission_denied' };
    }

    const result = await this._adapter.getSchemaVersion(projectId, schemaType, version);
    if (!result.ok) return result;

    // Save the restored version as the current version
    return this.save(projectId, schemaType, result.data.data, {
      changeSummary: `Restored from version ${version}`,
    });
  }

  // ── Bulk Operations ───────────────────────────────────────────────────────────

  /**
   * Save all schemas for a project in one operation.
   * @param {string} projectId
   * @param {object} schemas - { [schemaType]: data }
   */
  async saveAll(projectId, schemas) {
    const results = {};
    for (const [schemaType, data] of Object.entries(schemas)) {
      results[schemaType] = await this.save(projectId, schemaType, data);
    }
    return { ok: Object.values(results).every(r => r.ok), results };
  }

  /**
   * Load all schemas for a project.
   * @param {string} projectId
   * @param {string[]} [schemaTypes] - Defaults to all known types
   */
  async loadAll(projectId, schemaTypes) {
    const types = schemaTypes || Object.values(CloudSchemaType);
    const results = {};
    for (const schemaType of types) {
      results[schemaType] = await this.load(projectId, schemaType);
    }
    return { ok: true, results };
  }

  // ── Cache ─────────────────────────────────────────────────────────────────────

  invalidateCache(projectId, schemaType) {
    const key = `${projectId}:${schemaType}`;
    delete this._cache[key];
  }

  invalidateProjectCache(projectId) {
    for (const key of Object.keys(this._cache)) {
      if (key.startsWith(`${projectId}:`)) delete this._cache[key];
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  _migrate(schemaType, data) {
    const targetVersion = CURRENT_SCHEMA_VERSIONS[schemaType] || 1;
    const migrations    = MIGRATIONS[schemaType] || {};
    let current = data;
    let version = current._version || 1;

    while (version < targetVersion) {
      const migrateFn = migrations[version];
      if (!migrateFn) break;
      current = migrateFn(current);
      version = current._version || version + 1;
    }

    return current;
  }

  _getCache(projectId, schemaType) {
    const key    = `${projectId}:${schemaType}`;
    const cached = this._cache[key];
    if (!cached) return null;
    if (Date.now() - cached.loadedAt > this._CACHE_TTL_MS) {
      delete this._cache[key];
      return null;
    }
    return cached.data;
  }

  _setCache(projectId, schemaType, data) {
    this._cache[`${projectId}:${schemaType}`] = { data, loadedAt: Date.now() };
  }
}
