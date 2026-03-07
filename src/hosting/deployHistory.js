/**
 * Nuvra — deployHistory.js (Phase 13)
 *
 * Maintains a versioned, persistent log of all deployments for a project.
 *
 * Features:
 *  - Append-only deploy records (never mutated, only status updated)
 *  - Rollback support: re-activate any previous deployment
 *  - Failure recording with error details
 *  - Persistent in localStorage, synced to cloud when available
 *  - Max 50 records per project (oldest are pruned)
 *
 * @module deployHistory
 */
'use strict';

const MAX_HISTORY     = 50;
const STORAGE_KEY     = (projectId) => `nuvra-deploy-history-${projectId}`;

// ─── DeployHistory ────────────────────────────────────────────────────────────

class DeployHistory {
  constructor() {
    this._projectId = null;
  }

  init(projectId) {
    this._projectId = projectId;
  }

  // ─── Record a successful deploy ──────────────────────────────────────────────

  /**
   * @param {object} deployRecord
   * @param {string} deployRecord.deployId
   * @param {string} deployRecord.projectId
   * @param {string} deployRecord.environment
   * @param {string} deployRecord.region
   * @param {string} deployRecord.liveUrl
   * @param {string} [deployRecord.previewUrl]
   * @param {string} deployRecord.versionId
   * @param {number} deployRecord.fileCount
   * @param {number} deployRecord.totalBytes
   * @param {string[]} deployRecord.activePacks
   * @param {boolean} deployRecord.healthOk
   * @param {string} deployRecord.deployedAt
   */
  record(deployRecord) {
    const history = this._load(deployRecord.projectId);

    // Mark all previous production deploys as superseded
    if (deployRecord.environment === 'production') {
      for (const d of history) {
        if (d.environment === 'production' && d.status === 'live') {
          d.status = 'superseded';
        }
      }
    }

    history.unshift({ ...deployRecord, status: 'live' });

    // Prune to max history
    if (history.length > MAX_HISTORY) history.splice(MAX_HISTORY);

    this._save(deployRecord.projectId, history);
    this._syncToCloud(deployRecord);
  }

  // ─── Record a failed deploy ──────────────────────────────────────────────────

  recordFailure({ deployId, projectId, error }) {
    const history = this._load(projectId);
    history.unshift({
      deployId,
      projectId,
      status:     'failed',
      error:      error,
      deployedAt: new Date().toISOString(),
    });
    if (history.length > MAX_HISTORY) history.splice(MAX_HISTORY);
    this._save(projectId, history);
  }

  // ─── Mark a deploy as rolled back ───────────────────────────────────────────

  markRolledBack(projectId, deployId) {
    const history = this._load(projectId);
    // Supersede the current live
    for (const d of history) {
      if (d.status === 'live') d.status = 'superseded';
    }
    // Re-activate the target
    const target = history.find(d => d.deployId === deployId);
    if (target) {
      target.status      = 'live';
      target.rolledBackAt = new Date().toISOString();
    }
    this._save(projectId, history);
  }

  // ─── Queries ─────────────────────────────────────────────────────────────────

  getAll(projectId) {
    return this._load(projectId);
  }

  getLatest(projectId) {
    const history = this._load(projectId);
    return history.find(d => d.status === 'live') || history[0] || null;
  }

  getById(projectId, deployId) {
    return this._load(projectId).find(d => d.deployId === deployId) || null;
  }

  getByEnvironment(projectId, environment) {
    return this._load(projectId).filter(d => d.environment === environment);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  _load(projectId) {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY(projectId)) || '[]');
    } catch { return []; }
  }

  _save(projectId, history) {
    try {
      localStorage.setItem(STORAGE_KEY(projectId), JSON.stringify(history));
    } catch { /* Storage full */ }
  }

  async _syncToCloud(record) {
    try {
      const { supabase } = await import('../cloud/cloud.js');
      if (!supabase) return;
      await supabase.from('nuvra_deploy_history').upsert({
        id:           record.deployId,
        project_id:   record.projectId,
        environment:  record.environment,
        region:       record.region,
        live_url:     record.liveUrl,
        preview_url:  record.previewUrl,
        version_id:   record.versionId,
        file_count:   record.fileCount,
        total_bytes:  record.totalBytes,
        active_packs: record.activePacks,
        health_ok:    record.healthOk,
        status:       record.status,
        deployed_at:  record.deployedAt,
      });
    } catch { /* Non-fatal */ }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const deployHistory = new DeployHistory();
