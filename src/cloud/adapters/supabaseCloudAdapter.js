/**
 * supabaseCloudAdapter.js — Nuvra Phase 6
 *
 * Supabase cloud storage adapter.
 * Wraps Supabase database operations into the CloudProviderContract.
 *
 * Database schema (Supabase/Postgres):
 *
 *   nuvra_projects:
 *     id, owner_id, name, description, visibility, settings,
 *     created_at, updated_at, deleted_at
 *
 *   nuvra_schemas:
 *     id, project_id, schema_type, version, data (jsonb),
 *     created_at, updated_at, created_by
 *
 *   nuvra_schema_versions:
 *     id, project_id, schema_type, version, data (jsonb),
 *     created_at, created_by, change_summary
 *
 *   nuvra_sync_state:
 *     project_id, last_sync_at, last_push_at, last_pull_at,
 *     vector_clock (jsonb), device_id
 *
 * @module cloud/adapters/supabaseCloudAdapter
 */
'use strict';

import { CloudProviderContract, cloudOk, cloudError } from './cloudContract.js';

export class SupabaseCloudAdapter extends CloudProviderContract {
  /**
   * @param {object} config
   * @param {object} config.client - Initialized Supabase client
   * @param {function} config.getAccessToken - async () => string|null
   */
  constructor({ client, getAccessToken }) {
    super();
    this._client         = client;
    this._getAccessToken = getAccessToken;
  }

  get id()    { return 'supabase'; }
  get label() { return 'Supabase Cloud'; }

  // ── Projects ──────────────────────────────────────────────────────────────────

  async listProjects(userId) {
    try {
      const { data, error } = await this._client
        .from('nuvra_projects')
        .select('*')
        .eq('owner_id', userId)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false });

      if (error) return cloudError(error.message, 'cloud/list_projects_failed');
      return cloudOk(data || []);
    } catch (err) {
      return cloudError(err.message, 'cloud/network_error');
    }
  }

  async getProject(projectId) {
    try {
      const { data, error } = await this._client
        .from('nuvra_projects')
        .select('*')
        .eq('id', projectId)
        .is('deleted_at', null)
        .single();

      if (error) return cloudError(error.message, 'cloud/project_not_found');
      return cloudOk(data);
    } catch (err) {
      return cloudError(err.message, 'cloud/network_error');
    }
  }

  async createProject(project) {
    try {
      const { data, error } = await this._client
        .from('nuvra_projects')
        .insert({
          id:          project.id,
          owner_id:    project.ownerId,
          name:        project.name,
          description: project.description || null,
          visibility:  project.visibility || 'private',
          settings:    project.settings || {},
        })
        .select()
        .single();

      if (error) return cloudError(error.message, 'cloud/create_project_failed');
      return cloudOk(data);
    } catch (err) {
      return cloudError(err.message, 'cloud/network_error');
    }
  }

  async updateProject(projectId, updates) {
    try {
      const { data, error } = await this._client
        .from('nuvra_projects')
        .update({
          name:        updates.name,
          description: updates.description,
          visibility:  updates.visibility,
          settings:    updates.settings,
          updated_at:  new Date().toISOString(),
        })
        .eq('id', projectId)
        .select()
        .single();

      if (error) return cloudError(error.message, 'cloud/update_project_failed');
      return cloudOk(data);
    } catch (err) {
      return cloudError(err.message, 'cloud/network_error');
    }
  }

  async deleteProject(projectId) {
    try {
      const { error } = await this._client
        .from('nuvra_projects')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', projectId);

      if (error) return cloudError(error.message, 'cloud/delete_project_failed');
      return cloudOk({ deleted: true });
    } catch (err) {
      return cloudError(err.message, 'cloud/network_error');
    }
  }

  // ── Schemas ───────────────────────────────────────────────────────────────────

  async getSchema(projectId, schemaType) {
    try {
      const { data, error } = await this._client
        .from('nuvra_schemas')
        .select('*')
        .eq('project_id', projectId)
        .eq('schema_type', schemaType)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code === 'PGRST116') return cloudOk(null); // Not found
      if (error) return cloudError(error.message, 'cloud/get_schema_failed');
      return cloudOk(data);
    } catch (err) {
      return cloudError(err.message, 'cloud/network_error');
    }
  }

  async saveSchema(projectId, schemaType, schemaData) {
    try {
      const now = new Date().toISOString();

      // Upsert the current schema
      const { data: current, error: upsertErr } = await this._client
        .from('nuvra_schemas')
        .upsert({
          project_id:  projectId,
          schema_type: schemaType,
          version:     (schemaData._version || 0) + 1,
          data:        schemaData,
          updated_at:  now,
        }, { onConflict: 'project_id,schema_type' })
        .select()
        .single();

      if (upsertErr) return cloudError(upsertErr.message, 'cloud/save_schema_failed');

      // Archive the version
      await this._client.from('nuvra_schema_versions').insert({
        project_id:     projectId,
        schema_type:    schemaType,
        version:        current.version,
        data:           schemaData,
        created_at:     now,
        change_summary: schemaData._changeSummary || 'Updated',
      });

      return cloudOk(current);
    } catch (err) {
      return cloudError(err.message, 'cloud/network_error');
    }
  }

  async listSchemaVersions(projectId, schemaType) {
    try {
      const { data, error } = await this._client
        .from('nuvra_schema_versions')
        .select('id, project_id, schema_type, version, created_at, change_summary')
        .eq('project_id', projectId)
        .eq('schema_type', schemaType)
        .order('version', { ascending: false })
        .limit(50);

      if (error) return cloudError(error.message, 'cloud/list_versions_failed');
      return cloudOk(data || []);
    } catch (err) {
      return cloudError(err.message, 'cloud/network_error');
    }
  }

  async getSchemaVersion(projectId, schemaType, version) {
    try {
      const { data, error } = await this._client
        .from('nuvra_schema_versions')
        .select('*')
        .eq('project_id', projectId)
        .eq('schema_type', schemaType)
        .eq('version', version)
        .single();

      if (error) return cloudError(error.message, 'cloud/version_not_found');
      return cloudOk(data);
    } catch (err) {
      return cloudError(err.message, 'cloud/network_error');
    }
  }

  // ── Sync ──────────────────────────────────────────────────────────────────────

  async getProjectSyncState(projectId) {
    try {
      const { data, error } = await this._client
        .from('nuvra_sync_state')
        .select('*')
        .eq('project_id', projectId)
        .single();

      if (error && error.code === 'PGRST116') return cloudOk(null);
      if (error) return cloudError(error.message, 'cloud/sync_state_failed');
      return cloudOk(data);
    } catch (err) {
      return cloudError(err.message, 'cloud/network_error');
    }
  }

  async pushChanges(projectId, changeset) {
    try {
      const now = new Date().toISOString();

      // Save each changed schema
      const results = [];
      for (const change of changeset.changes) {
        const result = await this.saveSchema(projectId, change.schemaType, change.data);
        results.push({ schemaType: change.schemaType, ok: result.ok, error: result.error });
      }

      // Update sync state
      await this._client.from('nuvra_sync_state').upsert({
        project_id:   projectId,
        last_sync_at: now,
        last_push_at: now,
        vector_clock: changeset.vectorClock,
        device_id:    changeset.deviceId,
      }, { onConflict: 'project_id' });

      return cloudOk({ pushed: results.length, results });
    } catch (err) {
      return cloudError(err.message, 'cloud/push_failed');
    }
  }

  async pullChanges(projectId, since) {
    try {
      const sinceIso = since ? new Date(since).toISOString() : new Date(0).toISOString();

      const { data, error } = await this._client
        .from('nuvra_schema_versions')
        .select('*')
        .eq('project_id', projectId)
        .gt('created_at', sinceIso)
        .order('created_at', { ascending: true });

      if (error) return cloudError(error.message, 'cloud/pull_failed');

      // Update sync state
      await this._client.from('nuvra_sync_state').upsert({
        project_id:    projectId,
        last_sync_at:  new Date().toISOString(),
        last_pull_at:  new Date().toISOString(),
      }, { onConflict: 'project_id' });

      return cloudOk({ changes: data || [], count: (data || []).length });
    } catch (err) {
      return cloudError(err.message, 'cloud/network_error');
    }
  }

  // ── Health ────────────────────────────────────────────────────────────────────

  async health() {
    try {
      const start = Date.now();
      const { error } = await this._client.from('nuvra_projects').select('id').limit(1);
      return {
        ok:        !error,
        latencyMs: Date.now() - start,
        provider:  this.id,
        error:     error?.message || null,
      };
    } catch (err) {
      return { ok: false, latencyMs: -1, provider: this.id, error: err.message };
    }
  }
}
