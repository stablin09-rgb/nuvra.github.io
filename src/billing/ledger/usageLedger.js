'use strict';

/**
 * usageLedger.js — Nuvra Phase 7
 *
 * The Usage Ledger is the single source of truth for all billable and
 * trackable activity in Nuvra. It is:
 *
 *  - Immutable: entries are never modified or deleted after recording.
 *  - Append-only: the only mutation is appending new entries.
 *  - Multi-dimensional: every entry carries dimension, quantity, user,
 *    project, and provider context.
 *  - Queryable: entries can be filtered and aggregated by any combination
 *    of dimensions, users, projects, providers, and time windows.
 *
 * The ledger is the foundation for:
 *  - Limit enforcement (LimitEnforcementEngine)
 *  - Cost governance (AICostGovernance)
 *  - Billing calculation (BillingEngine)
 *  - Dashboard display (BillingDashboard)
 *  - Abuse detection (AbuseDetector)
 */


// ─── Ledger Class ─────────────────────────────────────────────────────────────

import { createEntry, getDimensionMeta, Dimension } from './usageDimensions.js';
import { getAllDimensions } from './usageDimensions.js';
class UsageLedger {
  /**
   * @param {object} options
   * @param {object} [options.eventBus]  - Foundation EventBus for emitting events
   * @param {object} [options.logger]    - Foundation Logger
   */
  constructor({ eventBus = null, logger = null } = {}) {
    this._eventBus = eventBus;
    this._logger   = logger;

    // The ledger is a simple ordered array. In production this would be
    // persisted to an append-only database table (e.g., Supabase with
    // INSERT-only RLS policies).
    this._entries = [];

    // In-memory aggregate cache for fast limit checks.
    // Key: `${userId}:${dimension}:${windowKey}` → aggregated quantity
    this._aggregateCache = new Map();
    this._cacheDirty     = false;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Records a usage event. This is the only way to add data to the ledger.
   *
   * @param {object} params - See usageDimensions.createEntry for full spec
   * @returns {object} The recorded ledger entry
   */
  record(params) {
    const entry = createEntry(params);

    // Append to ledger (never modify existing entries)
    this._entries.push(entry);
    this._cacheDirty = true;

    if (this._logger) {
      this._logger.debug('[UsageLedger] Recorded', { id: entry.id, dimension: entry.dimension, quantity: entry.quantity });
    }

    if (this._eventBus) {
      this._eventBus.emit('billing:usage:recorded', { entry });
    }

    return entry;
  }

  /**
   * Records multiple usage events atomically (all or nothing).
   * @param {object[]} paramsArray
   * @returns {object[]} The recorded entries
   */
  recordBatch(paramsArray) {
    const entries = paramsArray.map(p => createEntry(p));
    this._entries.push(...entries);
    this._cacheDirty = true;

    if (this._eventBus) {
      this._eventBus.emit('billing:usage:batch_recorded', { count: entries.length });
    }

    return entries;
  }

  /**
   * Queries the ledger with optional filters.
   *
   * @param {object} filters
   * @param {string}   [filters.userId]
   * @param {string}   [filters.projectId]
   * @param {string}   [filters.provider]
   * @param {string|string[]} [filters.dimension]
   * @param {string}   [filters.since]   - ISO 8601 timestamp
   * @param {string}   [filters.until]   - ISO 8601 timestamp
   * @returns {object[]} Matching ledger entries (copies, not references)
   */
  query({ userId, projectId, provider, dimension, since, until } = {}) {
    const sinceMs = since ? new Date(since).getTime() : 0;
    const untilMs = until ? new Date(until).getTime() : Infinity;
    const dims    = dimension ? (Array.isArray(dimension) ? dimension : [dimension]) : null;

    return this._entries.filter(e => {
      const ts = new Date(e.recordedAt).getTime();
      if (userId    && e.userId    !== userId)    return false;
      if (projectId && e.projectId !== projectId) return false;
      if (provider  && e.provider  !== provider)  return false;
      if (dims      && !dims.includes(e.dimension)) return false;
      if (ts < sinceMs || ts > untilMs)            return false;
      return true;
    });
  }

  /**
   * Aggregates usage for a given dimension within a time window.
   *
   * @param {object} params
   * @param {string} params.dimension
   * @param {string} [params.userId]
   * @param {string} [params.projectId]
   * @param {string} [params.provider]
   * @param {string} [params.since]
   * @param {string} [params.until]
   * @returns {number} The aggregated quantity
   */
  aggregate({ dimension, userId, projectId, provider, since, until }) {
    const meta = getDimensionMeta(dimension);
    if (!meta) throw new Error(`[UsageLedger] Unknown dimension: "${dimension}"`);

    const entries = this.query({ userId, projectId, provider, dimension, since, until });

    if (meta.aggregation === 'count') {
      return entries.length;
    }
    if (meta.aggregation === 'sum') {
      return entries.reduce((acc, e) => acc + e.quantity, 0);
    }
    if (meta.aggregation === 'max') {
      return entries.length === 0 ? 0 : Math.max(...entries.map(e => e.quantity));
    }

    return entries.reduce((acc, e) => acc + e.quantity, 0);
  }

  /**
   * Returns a usage summary for a user within a billing period.
   *
   * @param {string} userId
   * @param {string} since  - Start of billing period (ISO 8601)
   * @param {string} until  - End of billing period (ISO 8601)
   * @returns {object} Summary keyed by dimension
   */
  getSummary(userId, since, until) {
    const summary = {};

    for (const dim of getAllDimensions()) {
      summary[dim.id] = {
        dimension: dim.id,
        label:     dim.label,
        unit:      dim.unit,
        quantity:  this.aggregate({ dimension: dim.id, userId, since, until }),
        billable:  dim.billable,
      };
    }

    return summary;
  }

  /**
   * Returns the total AI cost in USD for a user within a time window.
   */
  getAICostUSD(userId, since, until) {
    return this.aggregate({ dimension: Dimension.AI_COST_USD, userId, since, until });
  }

  /**
   * Returns the total AI cost for a specific project.
   */
  getProjectAICostUSD(projectId, since, until) {
    return this.aggregate({ dimension: Dimension.AI_COST_USD, projectId, since, until });
  }

  /**
   * Returns the number of entries in the ledger.
   */
  size() { return this._entries.length; }

  /**
   * Returns a read-only snapshot of all entries (for export/audit).
   * @returns {object[]}
   */
  export() {
    return this._entries.map(e => ({ ...e, meta: { ...e.meta } }));
  }

  /**
   * Returns entries since a given timestamp, suitable for incremental sync.
   * @param {string} since - ISO 8601 timestamp
   * @returns {object[]}
   */
  getEntriesSince(since) {
    return this.query({ since });
  }

  // ─── Billing Period Helpers ──────────────────────────────────────────────────

  /**
   * Returns ISO 8601 timestamps for the current calendar month.
   * @returns {{ since: string, until: string }}
   */
  static currentMonthWindow() {
    const now   = new Date();
    const since = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const until = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();
    return { since, until };
  }

  /**
   * Returns ISO 8601 timestamps for the current calendar day.
   * @returns {{ since: string, until: string }}
   */
  static currentDayWindow() {
    const now   = new Date();
    const since = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const until = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();
    return { since, until };
  }
}

export { UsageLedger };
export default UsageLedger;