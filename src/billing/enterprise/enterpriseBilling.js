'use strict';

/**
 * enterpriseBilling.js — Nuvra Phase 7
 *
 * Enterprise Readiness Layer for billing and usage governance.
 *
 * Provides:
 *  - Org-level billing (one invoice for many users)
 *  - Cost centers (allocate AI spend to departments/projects)
 *  - Usage exports (CSV, JSON for finance/compliance)
 *  - Invoice audit trail (every charge, credit, and adjustment)
 *  - Seat management (add/remove users from org billing)
 *  - Budget alerts (notify finance when org spend exceeds threshold)
 */

const { UsageLedger } = require('../ledger/usageLedger');
const { Dimension }   = require('../ledger/usageDimensions');

class EnterpriseBilling {
  /**
   * @param {object} options
   * @param {UsageLedger} options.ledger
   * @param {object}      [options.eventBus]
   * @param {object}      [options.logger]
   */
  constructor({ ledger, eventBus = null, logger = null }) {
    this._ledger    = ledger;
    this._eventBus  = eventBus;
    this._logger    = logger;

    // Org registry: orgId → { name, adminUserId, memberUserIds, costCenters, budgetAlerts }
    this._orgs = new Map();

    // Invoice audit trail: orgId → invoice[]
    this._invoices = new Map();
  }

  // ─── Org Management ──────────────────────────────────────────────────────────

  /**
   * Creates a new organisation.
   */
  createOrg({ orgId, name, adminUserId }) {
    if (this._orgs.has(orgId)) {
      throw new Error(`[EnterpriseBilling] Org "${orgId}" already exists`);
    }
    this._orgs.set(orgId, {
      id:            orgId,
      name,
      adminUserId,
      memberUserIds: new Set([adminUserId]),
      costCenters:   new Map(),
      budgetAlerts:  [],
      createdAt:     new Date().toISOString(),
    });
    return this._orgs.get(orgId);
  }

  /**
   * Adds a user to an organisation.
   */
  addMember(orgId, userId) {
    const org = this._requireOrg(orgId);
    org.memberUserIds.add(userId);
  }

  /**
   * Removes a user from an organisation.
   */
  removeMember(orgId, userId) {
    const org = this._requireOrg(orgId);
    if (userId === org.adminUserId) throw new Error('[EnterpriseBilling] Cannot remove org admin');
    org.memberUserIds.delete(userId);
  }

  /**
   * Returns all members of an organisation.
   */
  getMembers(orgId) {
    return Array.from(this._requireOrg(orgId).memberUserIds);
  }

  // ─── Cost Centers ────────────────────────────────────────────────────────────

  /**
   * Creates a cost center within an organisation.
   */
  createCostCenter(orgId, { centerId, name, monthlyBudgetUSD = null }) {
    const org = this._requireOrg(orgId);
    org.costCenters.set(centerId, {
      id:               centerId,
      name,
      monthlyBudgetUSD,
      assignedUserIds:  new Set(),
      assignedProjectIds: new Set(),
    });
  }

  /**
   * Assigns a user to a cost center.
   */
  assignUserToCostCenter(orgId, centerId, userId) {
    const center = this._requireCostCenter(orgId, centerId);
    center.assignedUserIds.add(userId);
  }

  /**
   * Assigns a project to a cost center.
   */
  assignProjectToCostCenter(orgId, centerId, projectId) {
    const center = this._requireCostCenter(orgId, centerId);
    center.assignedProjectIds.add(projectId);
  }

  /**
   * Returns the cost center usage report for the current month.
   */
  getCostCenterReport(orgId, centerId) {
    const center         = this._requireCostCenter(orgId, centerId);
    const { since, until } = UsageLedger.currentMonthWindow();

    let totalCostUSD    = 0;
    let totalInputTokens  = 0;
    let totalOutputTokens = 0;
    const byUser    = [];
    const byProject = [];

    for (const userId of center.assignedUserIds) {
      const cost = this._ledger.getAICostUSD(userId, since, until);
      const inp  = this._ledger.aggregate({ dimension: Dimension.AI_TOKENS_INPUT,  userId, since, until });
      const out  = this._ledger.aggregate({ dimension: Dimension.AI_TOKENS_OUTPUT, userId, since, until });
      totalCostUSD      += cost;
      totalInputTokens  += inp;
      totalOutputTokens += out;
      byUser.push({ userId, costUSD: cost, inputTokens: inp, outputTokens: out });
    }

    for (const projectId of center.assignedProjectIds) {
      const cost = this._ledger.getProjectAICostUSD(projectId, since, until);
      totalCostUSD += cost;
      byProject.push({ projectId, costUSD: cost });
    }

    const budgetPct = center.monthlyBudgetUSD
      ? Math.min((totalCostUSD / center.monthlyBudgetUSD) * 100, 100)
      : null;

    return {
      centerId,
      centerName:      center.name,
      period:          { since, until },
      totalCostUSD,
      totalInputTokens,
      totalOutputTokens,
      monthlyBudgetUSD: center.monthlyBudgetUSD,
      budgetPct,
      budgetStatus:    budgetPct === null ? 'no_budget' : budgetPct >= 100 ? 'exceeded' : budgetPct >= 80 ? 'warning' : 'ok',
      byUser,
      byProject,
    };
  }

  // ─── Usage Exports ───────────────────────────────────────────────────────────

  /**
   * Exports org usage as JSON for a given period.
   */
  exportUsageJSON(orgId, since, until) {
    const org     = this._requireOrg(orgId);
    const members = Array.from(org.memberUserIds);
    const entries = [];

    for (const userId of members) {
      const userEntries = this._ledger.query({ userId, since, until });
      entries.push(...userEntries);
    }

    return {
      orgId,
      orgName:   org.name,
      period:    { since, until },
      exportedAt: new Date().toISOString(),
      entryCount: entries.length,
      entries,
    };
  }

  /**
   * Exports org usage as CSV for a given period.
   */
  exportUsageCSV(orgId, since, until) {
    const data    = this.exportUsageJSON(orgId, since, until);
    const headers = ['id', 'dimension', 'quantity', 'userId', 'projectId', 'provider', 'recordedAt'];
    const rows    = data.entries.map(e =>
      headers.map(h => JSON.stringify(e[h] ?? '')).join(',')
    );
    return [headers.join(','), ...rows].join('\n');
  }

  // ─── Invoice Audit Trail ─────────────────────────────────────────────────────

  /**
   * Records an invoice event in the audit trail.
   */
  recordInvoiceEvent(orgId, event) {
    if (!this._invoices.has(orgId)) this._invoices.set(orgId, []);
    const entry = {
      ...event,
      id:         `inv_evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      recordedAt: new Date().toISOString(),
    };
    this._invoices.get(orgId).push(entry);
    return entry;
  }

  /**
   * Returns the invoice audit trail for an org.
   */
  getInvoiceAuditTrail(orgId) {
    return (this._invoices.get(orgId) || []).slice(); // Return a copy
  }

  // ─── Budget Alerts ───────────────────────────────────────────────────────────

  /**
   * Adds a budget alert for an org.
   * @param {string} orgId
   * @param {object} alert - { thresholdPct: number, notifyUserId: string }
   */
  addBudgetAlert(orgId, alert) {
    const org = this._requireOrg(orgId);
    org.budgetAlerts.push({ ...alert, id: `alert_${Date.now().toString(36)}` });
  }

  /**
   * Checks all budget alerts for an org and emits events for triggered ones.
   * Should be called after each usage recording.
   */
  checkBudgetAlerts(orgId, monthlyBudgetUSD) {
    const org = this._requireOrg(orgId);
    if (!monthlyBudgetUSD) return;

    const { since, until } = UsageLedger.currentMonthWindow();
    let totalCost = 0;
    for (const userId of org.memberUserIds) {
      totalCost += this._ledger.getAICostUSD(userId, since, until);
    }

    const pct = (totalCost / monthlyBudgetUSD) * 100;

    for (const alert of org.budgetAlerts) {
      if (pct >= alert.thresholdPct) {
        if (this._eventBus) {
          this._eventBus.emit('billing:enterprise:budget_alert', {
            orgId,
            thresholdPct:  alert.thresholdPct,
            currentPct:    pct,
            totalCostUSD:  totalCost,
            monthlyBudget: monthlyBudgetUSD,
            notifyUserId:  alert.notifyUserId,
          });
        }
      }
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  _requireOrg(orgId) {
    const org = this._orgs.get(orgId);
    if (!org) throw new Error(`[EnterpriseBilling] Org "${orgId}" not found`);
    return org;
  }

  _requireCostCenter(orgId, centerId) {
    const org    = this._requireOrg(orgId);
    const center = org.costCenters.get(centerId);
    if (!center) throw new Error(`[EnterpriseBilling] Cost center "${centerId}" not found in org "${orgId}"`);
    return center;
  }
}

module.exports = { EnterpriseBilling };
