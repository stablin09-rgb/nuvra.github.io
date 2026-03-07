/**
 * localCloudAdapter.js — Nuvra Phase 6
 *
 * Local (offline) cloud adapter.
 * Simulates cloud storage using localStorage/in-memory storage.
 * Used for offline development, testing, and as a fallback.
 *
 * @module cloud/adapters/localCloudAdapter
 */
'use strict';

import { CloudProviderContract, cloudOk, cloudError } from './cloudContract.js';

const STORAGE_PREFIX = 'nuvra_cloud_local_';

export class LocalCloudAdapter extends CloudProviderContract {
  constructor() {
    super();
    this._store = {}; // In-memory fallback
  }

  get id()    { return 'local'; }
  get label() { return 'Local Cloud (offline)'; }

  // ── Projects ──────────────────────────────────────────────────────────────────

  async listProjects(userId) {
    const all = this._getAll('projects');
    const projects = Object.values(all).filter(p => p.ownerId === userId && !p.deletedAt);
    return cloudOk(projects.sort((a, b) => b.updatedAt - a.updatedAt));
  }

  async getProject(projectId) {
    const all = this._getAll('projects');
    const project = all[projectId];
    if (!project || project.deletedAt) return cloudError('Project not found', 'cloud/project_not_found');
    return cloudOk(project);
  }

  async createProject(project) {
    const all = this._getAll('projects');
    const record = { ...project, createdAt: Date.now(), updatedAt: Date.now() };
    all[project.id] = record;
    this._saveAll('projects', all);
    return cloudOk(record);
  }

  async updateProject(projectId, updates) {
    const all = this._getAll('projects');
    if (!all[projectId]) return cloudError('Project not found', 'cloud/project_not_found');
    all[projectId] = { ...all[projectId], ...updates, updatedAt: Date.now() };
    this._saveAll('projects', all);
    return cloudOk(all[projectId]);
  }

  async deleteProject(projectId) {
    const all = this._getAll('projects');
    if (!all[projectId]) return cloudError('Project not found', 'cloud/project_not_found');
    all[projectId].deletedAt = Date.now();
    this._saveAll('projects', all);
    return cloudOk({ deleted: true });
  }

  // ── Schemas ───────────────────────────────────────────────────────────────────

  async getSchema(projectId, schemaType) {
    const key = `${projectId}:${schemaType}`;
    const all = this._getAll('schemas');
    return cloudOk(all[key] || null);
  }

  async saveSchema(projectId, schemaType, schemaData) {
    const key = `${projectId}:${schemaType}`;
    const all = this._getAll('schemas');
    const versions = this._getAll('schema_versions');

    const version = (all[key]?.version || 0) + 1;
    const record = { project_id: projectId, schema_type: schemaType, version, data: schemaData, updated_at: Date.now() };

    all[key] = record;
    this._saveAll('schemas', all);

    // Archive version
    const versionKey = `${key}:${version}`;
    versions[versionKey] = { ...record, created_at: Date.now(), change_summary: schemaData._changeSummary || 'Updated' };
    this._saveAll('schema_versions', versions);

    return cloudOk(record);
  }

  async listSchemaVersions(projectId, schemaType) {
    const prefix = `${projectId}:${schemaType}:`;
    const all = this._getAll('schema_versions');
    const versions = Object.entries(all)
      .filter(([k]) => k.startsWith(prefix))
      .map(([, v]) => ({ ...v, data: undefined })) // Omit data from list
      .sort((a, b) => b.version - a.version)
      .slice(0, 50);
    return cloudOk(versions);
  }

  async getSchemaVersion(projectId, schemaType, version) {
    const key = `${projectId}:${schemaType}:${version}`;
    const all = this._getAll('schema_versions');
    if (!all[key]) return cloudError('Version not found', 'cloud/version_not_found');
    return cloudOk(all[key]);
  }

  // ── Sync ──────────────────────────────────────────────────────────────────────

  async getProjectSyncState(projectId) {
    const all = this._getAll('sync_state');
    return cloudOk(all[projectId] || null);
  }

  async pushChanges(projectId, changeset) {
    const results = [];
    for (const change of changeset.changes) {
      const result = await this.saveSchema(projectId, change.schemaType, change.data);
      results.push({ schemaType: change.schemaType, ok: result.ok });
    }

    const syncStates = this._getAll('sync_state');
    syncStates[projectId] = {
      project_id:   projectId,
      last_sync_at: Date.now(),
      last_push_at: Date.now(),
      vector_clock: changeset.vectorClock,
      device_id:    changeset.deviceId,
    };
    this._saveAll('sync_state', syncStates);

    return cloudOk({ pushed: results.length, results });
  }

  async pullChanges(projectId, since) {
    const prefix = `${projectId}:`;
    const all = this._getAll('schema_versions');
    const changes = Object.values(all)
      .filter(v => v.project_id === projectId && v.created_at > (since || 0))
      .sort((a, b) => a.created_at - b.created_at);

    const syncStates = this._getAll('sync_state');
    if (syncStates[projectId]) {
      syncStates[projectId].last_pull_at = Date.now();
      syncStates[projectId].last_sync_at = Date.now();
      this._saveAll('sync_state', syncStates);
    }

    return cloudOk({ changes, count: changes.length });
  }

  // ── Health ────────────────────────────────────────────────────────────────────

  async health() {
    return { ok: true, latencyMs: 0, provider: this.id, error: null };
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  _getAll(collection) {
    try {
      const raw = (typeof localStorage !== 'undefined')
        ? localStorage.getItem(STORAGE_PREFIX + collection)
        : null;
      return raw ? JSON.parse(raw) : (this._store[collection] || {});
    } catch (_) {
      return this._store[collection] || {};
    }
  }

  _saveAll(collection, data) {
    this._store[collection] = data;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_PREFIX + collection, JSON.stringify(data));
      }
    } catch (_) {}
  }
}
