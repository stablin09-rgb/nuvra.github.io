/**
 * Nuvra — hostingManager.js (Phase 13)
 *
 * The central orchestrator for the one-click hosting engine.
 *
 * Responsibilities:
 *  - Provide a single `deploy()` entry point for one-click deployments
 *  - Coordinate the full deploy pipeline (build → hash → inject → bind → health-check)
 *  - Manage the HostingAdapter abstraction (provider-agnostic)
 *  - Assign and manage live URLs (Nuvra subdomains + custom domains)
 *  - Maintain deploy history and support instant rollback
 *  - Expose observability data (status, logs, traffic)
 *
 * Provider Adapters (swappable without changing user projects):
 *  - SupabaseAdapter  — default, uses Supabase Storage + Edge Functions
 *  - CloudflareAdapter — Cloudflare Pages (future)
 *  - VercelAdapter    — Vercel Edge (future)
 *  - CustomCDNAdapter — BYO CDN (future)
 *
 * @module hostingManager
 */
'use strict';

import { deployPipeline }       from './deployPipeline.js';
import { domainManager }        from './domainManager.js';
import { deployHistory }        from './deployHistory.js';
import { observabilityService } from './observabilityService.js';
import { SupabaseHostingAdapter } from './adapters/supabaseAdapter.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const NUVRA_SUBDOMAIN_BASE = 'nuvra.app';
const DEPLOY_STATUS = Object.freeze({
  IDLE:       'idle',
  BUILDING:   'building',
  UPLOADING:  'uploading',
  ACTIVATING: 'activating',
  LIVE:       'live',
  FAILED:     'failed',
  ROLLING_BACK: 'rolling_back',
});

// ─── HostingManager ───────────────────────────────────────────────────────────

class HostingManager {
  constructor() {
    this._adapter       = null;
    this._projectId     = null;
    this._getSnapshot   = null;
    this._getProjectMeta = null;
    this._status        = DEPLOY_STATUS.IDLE;
    this._listeners     = new Set();
    this._currentDeploy = null;
  }

  // ─── Initialization ─────────────────────────────────────────────────────────

  /**
   * Initialize the hosting manager for a project.
   *
   * @param {object} opts
   * @param {string}   opts.projectId
   * @param {Function} opts.getSnapshot    - Returns the current project state
   * @param {Function} opts.getProjectMeta - Returns { name, slug, cloudProjectId }
   * @param {string}   [opts.provider]     - 'supabase' | 'cloudflare' | 'vercel' | 'custom'
   */
  init({ projectId, getSnapshot, getProjectMeta, provider = 'supabase' }) {
    this._projectId      = projectId;
    this._getSnapshot    = getSnapshot;
    this._getProjectMeta = getProjectMeta;
    this._adapter        = this._createAdapter(provider);
    deployHistory.init(projectId);
    observabilityService.init(projectId);
    this._status = DEPLOY_STATUS.IDLE;
  }

  // ─── One-Click Deploy ────────────────────────────────────────────────────────

  /**
   * One-click deploy. The user's single action to go live.
   *
   * @param {object}   [opts]
   * @param {string}   [opts.environment]  - 'production' | 'preview'
   * @param {string}   [opts.region]       - 'auto' | 'us-east' | 'eu-west' | 'ap-southeast'
   * @param {Function} [opts.onProgress]   - (step: DeployStep) => void
   * @param {string[]} [opts.activePacks]  - IDs of active design packs to inject
   * @returns {Promise<DeployResult>}
   */
  async deploy({
    environment = 'production',
    region      = 'auto',
    onProgress  = null,
    activePacks = [],
  } = {}) {
    if (this._status === DEPLOY_STATUS.BUILDING ||
        this._status === DEPLOY_STATUS.UPLOADING ||
        this._status === DEPLOY_STATUS.ACTIVATING) {
      return { ok: false, error: new Error('A deploy is already in progress.') };
    }

    const deployId = _uuid();
    this._currentDeploy = deployId;

    const progress = (step, message, percent) => {
      this._status = step;
      this._emit('progress', { deployId, step, message, percent });
      onProgress && onProgress({ deployId, step, message, percent });
    };

    try {
      progress(DEPLOY_STATUS.BUILDING, 'Building site…', 5);

      // 1. Get current project state
      const snapshot    = this._getSnapshot();
      const projectMeta = this._getProjectMeta();

      // 2. Run the full deploy pipeline
      const bundle = await deployPipeline.run({
        snapshot,
        projectMeta,
        activePacks,
        onProgress: (pct, msg) => progress(DEPLOY_STATUS.BUILDING, msg, 5 + Math.round(pct * 0.5)),
      });

      progress(DEPLOY_STATUS.UPLOADING, 'Uploading to global CDN…', 55);

      // 3. Upload via the hosting adapter
      const uploadResult = await this._adapter.upload({
        bundle,
        projectId:   this._projectId,
        projectMeta,
        environment,
        region,
        deployId,
        onProgress: (pct, msg) => progress(DEPLOY_STATUS.UPLOADING, msg, 55 + Math.round(pct * 0.3)),
      });

      if (!uploadResult.ok) throw uploadResult.error;

      progress(DEPLOY_STATUS.ACTIVATING, 'Activating deployment…', 85);

      // 4. Activate the new deployment (atomic swap)
      const activateResult = await this._adapter.activate({
        deployId,
        projectId:   this._projectId,
        environment,
        uploadResult,
      });

      if (!activateResult.ok) throw activateResult.error;

      // 5. Health check
      progress(DEPLOY_STATUS.ACTIVATING, 'Running health check…', 92);
      const healthOk = await this._healthCheck(activateResult.liveUrl);

      // 6. Record in deploy history
      const deployRecord = {
        deployId,
        projectId:   this._projectId,
        environment,
        region:      uploadResult.region || region,
        liveUrl:     activateResult.liveUrl,
        previewUrl:  activateResult.previewUrl || null,
        versionId:   bundle.versionId,
        fileCount:   Object.keys(bundle.files).length,
        totalBytes:  bundle.totalBytes,
        activePacks,
        healthOk,
        deployedAt:  new Date().toISOString(),
        status:      'live',
      };

      deployHistory.record(deployRecord);

      // 7. Update domain routing
      await domainManager.bindDeployment({
        projectId:  this._projectId,
        deployId,
        liveUrl:    activateResult.liveUrl,
        environment,
      });

      // 8. Track observability event
      observabilityService.recordDeploy(deployRecord);

      this._status = DEPLOY_STATUS.LIVE;
      this._emit('deployed', deployRecord);

      return {
        ok:         true,
        deployId,
        liveUrl:    activateResult.liveUrl,
        previewUrl: activateResult.previewUrl || null,
        versionId:  bundle.versionId,
        healthOk,
        deployRecord,
      };

    } catch (err) {
      this._status = DEPLOY_STATUS.FAILED;
      this._emit('failed', { deployId, error: err });
      deployHistory.recordFailure({ deployId, projectId: this._projectId, error: err.message });
      return { ok: false, deployId, error: err };
    }
  }

  // ─── Redeploy ────────────────────────────────────────────────────────────────

  /**
   * Redeploy the current project with the same settings as the last deploy.
   */
  async redeploy(opts = {}) {
    const last = deployHistory.getLatest(this._projectId);
    return this.deploy({
      environment: last?.environment || 'production',
      region:      last?.region      || 'auto',
      activePacks: last?.activePacks || [],
      ...opts,
    });
  }

  // ─── Rollback ────────────────────────────────────────────────────────────────

  /**
   * Roll back to a specific previous deployment.
   *
   * @param {string} deployId - The deployId to roll back to
   * @returns {Promise<RollbackResult>}
   */
  async rollback(deployId) {
    this._status = DEPLOY_STATUS.ROLLING_BACK;
    this._emit('progress', { step: DEPLOY_STATUS.ROLLING_BACK, message: 'Rolling back…', percent: 10 });

    try {
      const targetDeploy = deployHistory.getById(this._projectId, deployId);
      if (!targetDeploy) throw new Error(`Deploy ${deployId} not found in history.`);

      const result = await this._adapter.rollback({
        projectId:    this._projectId,
        targetDeploy,
      });

      if (!result.ok) throw result.error;

      deployHistory.markRolledBack(this._projectId, deployId);
      observabilityService.recordRollback({ projectId: this._projectId, deployId });

      this._status = DEPLOY_STATUS.LIVE;
      this._emit('rolled_back', { deployId, liveUrl: result.liveUrl });

      return { ok: true, liveUrl: result.liveUrl };

    } catch (err) {
      this._status = DEPLOY_STATUS.FAILED;
      return { ok: false, error: err };
    }
  }

  // ─── Status & Observability ──────────────────────────────────────────────────

  getStatus()              { return this._status; }
  getDeployHistory()       { return deployHistory.getAll(this._projectId); }
  getLatestDeploy()        { return deployHistory.getLatest(this._projectId); }
  getLiveUrl()             { return deployHistory.getLatest(this._projectId)?.liveUrl || null; }
  getObservabilityData()   { return observabilityService.getSnapshot(this._projectId); }

  // ─── Domain Management ───────────────────────────────────────────────────────

  async addCustomDomain(domain)    { return domainManager.addCustomDomain(this._projectId, domain); }
  async removeCustomDomain(domain) { return domainManager.removeCustomDomain(this._projectId, domain); }
  getCustomDomains()               { return domainManager.getCustomDomains(this._projectId); }

  // ─── Nuvra Subdomain ─────────────────────────────────────────────────────────

  /**
   * Get or generate the Nuvra subdomain for this project.
   * Format: {slug}.nuvra.app
   */
  getNuvraSubdomain() {
    const meta = this._getProjectMeta ? this._getProjectMeta() : {};
    const slug = meta.slug || this._projectId.slice(0, 8);
    return `https://${slug}.${NUVRA_SUBDOMAIN_BASE}`;
  }

  // ─── Event System ────────────────────────────────────────────────────────────

  on(event, fn)  { this._listeners.add({ event, fn }); return this; }
  off(event, fn) { this._listeners.forEach(l => { if (l.event === event && l.fn === fn) this._listeners.delete(l); }); }
  _emit(event, data) { this._listeners.forEach(l => { if (l.event === event) l.fn(data); }); }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  _createAdapter(provider) {
    switch (provider) {
      case 'supabase':   return new SupabaseHostingAdapter();
      // Future adapters:
      // case 'cloudflare': return new CloudflareHostingAdapter();
      // case 'vercel':     return new VercelHostingAdapter();
      // case 'custom':     return new CustomCDNAdapter();
      default:           return new SupabaseHostingAdapter();
    }
  }

  async _healthCheck(url) {
    if (!url) return false;
    try {
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10_000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function _uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const hostingManager = new HostingManager();
export { DEPLOY_STATUS };
