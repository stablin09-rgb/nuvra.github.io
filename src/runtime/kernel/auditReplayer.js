/**
 * Nuvra Runtime Kernel — auditReplayer.js (Phase 16)
 *
 * The Audit Replayer. Takes historical audit log entries and replays them
 * against the CURRENT policy configuration to answer the question:
 *
 *   "If our current policies had been active in the past,
 *    would the same decisions have been made?"
 *
 * This is critical for:
 *   - Validating policy changes before deploying them
 *   - Demonstrating to auditors that policies are effective
 *   - Identifying policy regressions after updates
 *   - SOC 2 Type II evidence generation
 *
 * @module runtime/auditReplayer
 */
'use strict';

import { ExecutionContext } from './executionContext.js';

// ─── Replay Result ────────────────────────────────────────────────────────────
/**
 * @typedef {object} ReplayResult
 * @property {string}  entryId          - Original audit entry ID
 * @property {string}  originalDecision - Decision made at the time
 * @property {string}  replayDecision   - Decision made by current policy
 * @property {boolean} matches          - Whether the decisions match
 * @property {string}  [divergenceReason] - Why decisions diverged (if they did)
 * @property {number}  timestamp
 */

/**
 * @typedef {object} ReplayReport
 * @property {string}         id
 * @property {string}         runAt
 * @property {number}         total
 * @property {number}         matches
 * @property {number}         divergences
 * @property {number}         matchRate
 * @property {ReplayResult[]} results
 * @property {object[]}       divergenceAnalysis
 */

// ─── AuditReplayer Class ──────────────────────────────────────────────────────
export class AuditReplayer {
  constructor() {
    this._gatekeeper = null;
    this._vault      = null;
  }

  init(options = {}) {
    this._gatekeeper = options.gatekeeper || null;
    this._vault      = options.vault      || null;
  }

  /**
   * Replay a set of audit log entries against the current policy configuration.
   *
   * @param {object[]}  entries          - Audit log entries to replay
   * @param {object}    [options]
   * @param {function}  [options.onProgress] - Progress callback
   * @param {number}    [options.limit]       - Max entries to replay (default: 500)
   * @returns {Promise<ReplayReport>}
   */
  async replay(entries, options = {}) {
    if (!this._gatekeeper) throw new Error('[AuditReplayer] No gatekeeper configured.');

    const limit   = options.limit || 500;
    const toReplay = entries.slice(0, limit);
    const results  = [];

    for (const entry of toReplay) {
      const result = await this._replayEntry(entry);
      results.push(result);
      if (options.onProgress) options.onProgress(entry, result);
    }

    const report = this._buildReport(results);

    // Store in evidence vault
    if (this._vault) {
      await this._vault.record({ type: 'replay_report', ...report }).catch(() => {});
    }

    return report;
  }

  /**
   * Replay entries from the explainability ledger for a specific project.
   * @param {object} ledger     - ExplainabilityLedger instance
   * @param {object} [filters]  - Ledger query filters
   * @returns {Promise<ReplayReport>}
   */
  async replayFromLedger(ledger, filters = {}) {
    const entries = ledger.query({ ...filters, limit: 500 });
    return this.replay(entries);
  }

  /**
   * Replay entries from the audit log service.
   * @param {object} auditService - AuditService instance
   * @param {object} [filters]    - Audit query filters
   * @returns {Promise<ReplayReport>}
   */
  async replayFromAuditLog(auditService, filters = {}) {
    const entries = await auditService.query({ ...filters, limit: 500 });
    return this.replay(entries.entries || entries);
  }

  // ── Private ────────────────────────────────────────────────────────────────
  async _replayEntry(entry) {
    try {
      // Reconstruct the execution context from the audit entry
      const ctx = new ExecutionContext({
        actor:       entry.actor       || 'user',
        actorId:     entry.actorId     || 'unknown',
        intent:      entry.intent      || 'access',
        permissions: entry.permissions || [],
        compliance:  entry.compliance  || [],
        environment: entry.environment || 'prod',
        jurisdiction: entry.jurisdiction || 'global',
        riskLevel:   entry.riskLevel   || 'medium',
        projectId:   entry.projectId   || null,
        orgId:       entry.orgId       || null,
        meta:        entry.meta        || {},
      });

      // Reconstruct the request metadata
      const meta = {
        prompt:          entry.promptSummary || null,
        estimatedTokens: entry.estimatedCost || null,
        targetType:      entry.meta?.targetType || null,
        contextData:     entry.meta?.contextData || null,
      };

      // Re-evaluate with current policy
      const replayResult = await this._gatekeeper.evaluate(ctx, meta);

      const matches = replayResult.decision === entry.decision;

      return {
        entryId:          entry.id,
        originalDecision: entry.decision,
        replayDecision:   replayResult.decision,
        matches,
        divergenceReason: matches ? null : this._explainDivergence(entry, replayResult),
        originalRule:     entry.appliedRule,
        replayRule:       replayResult.appliedRule,
        timestamp:        Date.now(),
      };
    } catch (e) {
      return {
        entryId:          entry.id,
        originalDecision: entry.decision,
        replayDecision:   'error',
        matches:          false,
        divergenceReason: `Replay error: ${e.message}`,
        timestamp:        Date.now(),
      };
    }
  }

  _explainDivergence(original, replay) {
    if (original.decision === 'allow' && replay.decision !== 'allow') {
      return `Policy tightened: action that was previously allowed is now ${replay.decision} by rule "${replay.appliedRule}".`;
    }
    if (original.decision !== 'allow' && replay.decision === 'allow') {
      return `Policy relaxed: action that was previously ${original.decision} is now allowed. Verify this is intentional.`;
    }
    return `Decision changed from "${original.decision}" to "${replay.decision}". Applied rule changed from "${original.appliedRule}" to "${replay.appliedRule}".`;
  }

  _buildReport(results) {
    const matches     = results.filter(r => r.matches).length;
    const divergences = results.filter(r => !r.matches).length;

    // Group divergences by type
    const tightened = results.filter(r => !r.matches && r.originalDecision === 'allow' && r.replayDecision !== 'allow');
    const relaxed   = results.filter(r => !r.matches && r.originalDecision !== 'allow' && r.replayDecision === 'allow');

    return {
      id:         `replay-${Date.now().toString(36)}`,
      runAt:      new Date().toISOString(),
      total:      results.length,
      matches,
      divergences,
      matchRate:  results.length ? (matches / results.length * 100).toFixed(1) : 100,
      divergenceAnalysis: {
        tightened: tightened.length,
        relaxed:   relaxed.length,
        other:     divergences - tightened.length - relaxed.length,
      },
      overallStatus: relaxed.length > 0 ? 'warning' : divergences > 0 ? 'info' : 'pass',
      results,
    };
  }
}

export default AuditReplayer;
