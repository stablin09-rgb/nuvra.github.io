/**
 * cloudContract.js — Nuvra Phase 6
 *
 * The canonical interface every cloud storage provider must implement.
 * Cloud storage is completely decoupled from any specific backend.
 *
 * Cloud is not a file dump — it's structured, schema-aware storage.
 *
 * @module cloud/adapters/cloudContract
 */
'use strict';

export class CloudProviderContract {
  get id()    { throw new Error('CloudProvider must implement id'); }
  get label() { throw new Error('CloudProvider must implement label'); }

  // ── Projects ──────────────────────────────────────────────────────────────────
  async listProjects(userId)                    { throw new Error('CloudProvider must implement listProjects'); }
  async getProject(projectId)                   { throw new Error('CloudProvider must implement getProject'); }
  async createProject(project)                  { throw new Error('CloudProvider must implement createProject'); }
  async updateProject(projectId, updates)       { throw new Error('CloudProvider must implement updateProject'); }
  async deleteProject(projectId)                { throw new Error('CloudProvider must implement deleteProject'); }

  // ── Schemas ───────────────────────────────────────────────────────────────────
  async getSchema(projectId, schemaType)        { throw new Error('CloudProvider must implement getSchema'); }
  async saveSchema(projectId, schemaType, data) { throw new Error('CloudProvider must implement saveSchema'); }
  async listSchemaVersions(projectId, type)     { throw new Error('CloudProvider must implement listSchemaVersions'); }
  async getSchemaVersion(projectId, type, ver)  { throw new Error('CloudProvider must implement getSchemaVersion'); }

  // ── Sync ──────────────────────────────────────────────────────────────────────
  async getProjectSyncState(projectId)          { throw new Error('CloudProvider must implement getProjectSyncState'); }
  async pushChanges(projectId, changeset)       { throw new Error('CloudProvider must implement pushChanges'); }
  async pullChanges(projectId, since)           { throw new Error('CloudProvider must implement pullChanges'); }

  // ── Health ────────────────────────────────────────────────────────────────────
  async health()                                { throw new Error('CloudProvider must implement health'); }
}

// ─── Cloud Result ─────────────────────────────────────────────────────────────
export function cloudOk(data)          { return { ok: true,  data,  error: null }; }
export function cloudError(error, code) { return { ok: false, data: null, error, code: code || 'cloud/error' }; }

// ─── Schema Types ─────────────────────────────────────────────────────────────
export const CloudSchemaType = Object.freeze({
  SITE_SCHEMA:   'site_schema',
  APP_SCHEMA:    'app_schema',
  AI_PLAN:       'ai_plan',
  DATA_MODEL:    'data_model',
  PUBLISH_ARTIFACT: 'publish_artifact',
  SNAPSHOT:      'snapshot',
});
