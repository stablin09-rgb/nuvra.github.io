/**
 * Nuvra — observabilityService.js (Phase 13)
 *
 * Provides real visibility into deployed projects without exposing raw infrastructure.
 *
 * Features:
 *  - Deploy event log (timestamped, structured)
 *  - Uptime status (last health check result + history)
 *  - Build log (step-by-step messages from the deploy pipeline)
 *  - Error summaries (grouped by type, with counts)
 *  - Basic traffic stats (page views, unique visitors — privacy-preserving)
 *
 * @module observabilityService
 */
'use strict';

const STORAGE_KEY   = (projectId) => `nuvra-observability-${projectId}`;
const MAX_LOG_LINES = 200;
const MAX_EVENTS    = 100;

// ─── ObservabilityService ─────────────────────────────────────────────────────

class ObservabilityService {
  constructor() {
    this._projectId = null;
    this._buildLog  = [];
  }

  init(projectId) {
    this._projectId = projectId;
    this._buildLog  = [];
  }

  // ─── Deploy Events ───────────────────────────────────────────────────────────

  recordDeploy(deployRecord) {
    const data = this._load(deployRecord.projectId);
    data.events.unshift({
      type:        'deploy',
      deployId:    deployRecord.deployId,
      environment: deployRecord.environment,
      status:      deployRecord.status,
      liveUrl:     deployRecord.liveUrl,
      versionId:   deployRecord.versionId,
      fileCount:   deployRecord.fileCount,
      totalBytes:  deployRecord.totalBytes,
      healthOk:    deployRecord.healthOk,
      timestamp:   deployRecord.deployedAt,
    });
    if (data.events.length > MAX_EVENTS) data.events.splice(MAX_EVENTS);

    // Update uptime record
    data.uptime = {
      lastChecked:  deployRecord.deployedAt,
      isUp:         deployRecord.healthOk,
      liveUrl:      deployRecord.liveUrl,
      uptimeHistory: [
        { timestamp: deployRecord.deployedAt, isUp: deployRecord.healthOk },
        ...(data.uptime?.uptimeHistory || []).slice(0, 99),
      ],
    };

    this._save(deployRecord.projectId, data);
  }

  recordRollback({ projectId, deployId }) {
    const data = this._load(projectId);
    data.events.unshift({
      type:      'rollback',
      deployId,
      timestamp: new Date().toISOString(),
    });
    if (data.events.length > MAX_EVENTS) data.events.splice(MAX_EVENTS);
    this._save(projectId, data);
  }

  // ─── Build Log ───────────────────────────────────────────────────────────────

  appendBuildLog(message, level = 'info') {
    const line = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };
    this._buildLog.push(line);
    if (this._buildLog.length > MAX_LOG_LINES) this._buildLog.shift();
  }

  getBuildLog() {
    return [...this._buildLog];
  }

  clearBuildLog() {
    this._buildLog = [];
  }

  // ─── Traffic Stats ───────────────────────────────────────────────────────────

  /**
   * Record a page view (privacy-preserving: no IP, no user tracking).
   * In production, this would be sent to an Edge Function.
   */
  recordPageView(projectId, pagePath) {
    const data = this._load(projectId);
    const today = new Date().toISOString().slice(0, 10);

    if (!data.traffic) data.traffic = {};
    if (!data.traffic[today]) data.traffic[today] = { views: 0, paths: {} };

    data.traffic[today].views++;
    data.traffic[today].paths[pagePath] = (data.traffic[today].paths[pagePath] || 0) + 1;

    // Keep only last 30 days
    const keys = Object.keys(data.traffic).sort().reverse();
    if (keys.length > 30) {
      for (const key of keys.slice(30)) delete data.traffic[key];
    }

    this._save(projectId, data);
  }

  // ─── Snapshot ────────────────────────────────────────────────────────────────

  /**
   * Get a complete observability snapshot for the UI.
   */
  getSnapshot(projectId) {
    const data = this._load(projectId);
    const events = data.events || [];
    const uptime = data.uptime || null;
    const traffic = data.traffic || {};

    // Compute traffic totals
    const trafficDays = Object.entries(traffic)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 7)
      .map(([date, stats]) => ({ date, views: stats.views }));

    const totalViews = trafficDays.reduce((sum, d) => sum + d.views, 0);

    // Error summary from events
    const errors = events.filter(e => e.type === 'error' || e.status === 'failed');

    return {
      uptime,
      events:      events.slice(0, 20),
      buildLog:    this._buildLog.slice(-50),
      traffic: {
        last7Days:  trafficDays,
        totalViews,
      },
      errors: {
        count:   errors.length,
        recent:  errors.slice(0, 5),
      },
    };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  _load(projectId) {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY(projectId)) || '{"events":[],"uptime":null,"traffic":{}}');
    } catch { return { events: [], uptime: null, traffic: {} }; }
  }

  _save(projectId, data) {
    try {
      localStorage.setItem(STORAGE_KEY(projectId), JSON.stringify(data));
    } catch { /* Storage full */ }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const observabilityService = new ObservabilityService();
