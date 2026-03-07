'use strict';

/**
 * billingDashboard.js — Nuvra Phase 7
 *
 * The Billing Dashboard Data Layer computes all data needed to render
 * the user-facing billing dashboard. It is a pure read layer — it never
 * modifies state or records usage.
 *
 * Provides:
 *  - Current period usage summary (all dimensions)
 *  - Month-to-date cost breakdown by provider and model
 *  - Projected end-of-month cost based on current burn rate
 *  - Per-project cost breakdown
 *  - Usage trend (daily buckets for the current month)
 *  - Entitlement status (% used per dimension)
 *  - Upgrade recommendations
 */

const { UsageLedger }        = require('../ledger/usageLedger');
const { Dimension }          = require('../ledger/usageDimensions');
const { getPlan, getAllPlans, isUpgrade } = require('../plans/planDefinitions');

class BillingDashboard {
  /**
   * @param {object} options
   * @param {UsageLedger}        options.ledger
   * @param {EntitlementManager} options.entitlementManager
   */
  constructor({ ledger, entitlementManager }) {
    this._ledger       = ledger;
    this._entitlements = entitlementManager;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Returns the complete billing dashboard data for a user.
   *
   * @param {object} params
   * @param {string} params.userId
   * @param {string} params.planId
   * @returns {object} Full dashboard data object
   */
  getDashboardData({ userId, planId }) {
    const { since, until } = UsageLedger.currentMonthWindow();
    const plan             = getPlan(planId);
    const daysInMonth      = this._getDaysInCurrentMonth();
    const dayOfMonth       = new Date().getDate();
    const daysRemaining    = daysInMonth - dayOfMonth;

    return {
      plan:             { id: planId, name: plan?.name || planId },
      period:           { since, until, daysInMonth, dayOfMonth, daysRemaining },
      usageSummary:     this._getUsageSummary(userId, planId, since, until),
      costBreakdown:    this._getCostBreakdown(userId, since, until),
      projections:      this._getProjections(userId, since, until, dayOfMonth, daysInMonth),
      dailyTrend:       this._getDailyTrend(userId, since),
      entitlementStatus: this._entitlements.getStatusReport({ userId, planId }),
      upgradeOptions:   this._getUpgradeOptions(userId, planId, since, until),
    };
  }

  /**
   * Returns a per-project cost breakdown for a user.
   * @param {string} userId
   * @param {string[]} projectIds
   * @returns {object[]}
   */
  getProjectCostBreakdown(userId, projectIds) {
    const { since, until } = UsageLedger.currentMonthWindow();
    return projectIds.map(projectId => {
      const cost = this._ledger.getProjectAICostUSD(projectId, since, until);
      const inputTokens  = this._ledger.aggregate({ dimension: Dimension.AI_TOKENS_INPUT,  projectId, since, until });
      const outputTokens = this._ledger.aggregate({ dimension: Dimension.AI_TOKENS_OUTPUT, projectId, since, until });
      return { projectId, costUSD: cost, inputTokens, outputTokens };
    });
  }

  /**
   * Returns a cost forecast for the next N days.
   * @param {string} userId
   * @param {number} [days=30]
   * @returns {object[]} Array of { date, projectedCostUSD }
   */
  getCostForecast(userId, days = 30) {
    const { since } = UsageLedger.currentMonthWindow();
    const dayOfMonth = new Date().getDate();
    const dailyRate  = this._getDailyBurnRate(userId, since, dayOfMonth);
    const forecast   = [];

    for (let i = 1; i <= days; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      forecast.push({
        date:             date.toISOString().slice(0, 10),
        projectedCostUSD: Math.round(dailyRate * i * 1_000_000) / 1_000_000,
      });
    }

    return forecast;
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  _getUsageSummary(userId, planId, since, until) {
    const plan = getPlan(planId);
    if (!plan) return {};

    const summary = {};
    for (const [dim, entitlement] of Object.entries(plan.entitlements)) {
      const quantity = this._ledger.aggregate({ dimension: dim, userId, since, until });
      const limit    = entitlement.limit;
      summary[dim] = {
        quantity,
        limit,
        unit:        this._getUnit(dim),
        pct:         limit === Infinity ? 0 : Math.min((quantity / limit) * 100, 100),
        resetWindow: entitlement.resetWindow,
      };
    }
    return summary;
  }

  _getCostBreakdown(userId, since, until) {
    const entries = this._ledger.query({ userId, dimension: Dimension.AI_COST_USD, since, until });
    const byProvider = {};

    for (const entry of entries) {
      const provider = entry.provider || 'unknown';
      const model    = entry.meta?.model || 'unknown';
      const key      = `${provider}:${model}`;
      if (!byProvider[key]) {
        byProvider[key] = { provider, model, totalCostUSD: 0, calls: 0 };
      }
      byProvider[key].totalCostUSD += entry.quantity;
      byProvider[key].calls        += 1;
    }

    return Object.values(byProvider).sort((a, b) => b.totalCostUSD - a.totalCostUSD);
  }

  _getProjections(userId, since, until, dayOfMonth, daysInMonth) {
    const mtdCost   = this._ledger.getAICostUSD(userId, since, until);
    const dailyRate = dayOfMonth > 0 ? mtdCost / dayOfMonth : 0;
    const projected = dailyRate * daysInMonth;

    return {
      mtdCostUSD:       Math.round(mtdCost    * 1_000_000) / 1_000_000,
      dailyRateUSD:     Math.round(dailyRate  * 1_000_000) / 1_000_000,
      projectedMonthUSD: Math.round(projected * 1_000_000) / 1_000_000,
    };
  }

  _getDailyTrend(userId, since) {
    const entries = this._ledger.query({ userId, dimension: Dimension.AI_COST_USD, since });
    const byDay   = {};

    for (const entry of entries) {
      const day = entry.recordedAt.slice(0, 10);
      byDay[day] = (byDay[day] || 0) + entry.quantity;
    }

    // Fill in zero-cost days
    const today    = new Date();
    const sinceDay = new Date(since);
    const trend    = [];
    for (let d = new Date(sinceDay); d <= today; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      trend.push({ date: key, costUSD: Math.round((byDay[key] || 0) * 1_000_000) / 1_000_000 });
    }

    return trend;
  }

  _getUpgradeOptions(userId, planId, since, until) {
    const allPlans = getAllPlans();
    const options  = [];

    for (const plan of allPlans) {
      if (!isUpgrade(planId, plan.id)) continue;
      const gains = [];

      // Check which dimensions would be unlocked or increased
      const currentPlan = getPlan(planId);
      for (const [dim, ent] of Object.entries(plan.entitlements)) {
        const currentEnt = currentPlan?.entitlements[dim];
        if (!currentEnt) continue;
        if (ent.limit === Infinity && currentEnt.limit !== Infinity) {
          gains.push({ dimension: dim, from: currentEnt.limit, to: 'Unlimited', unit: this._getUnit(dim) });
        } else if (ent.limit > currentEnt.limit) {
          gains.push({ dimension: dim, from: currentEnt.limit, to: ent.limit, unit: this._getUnit(dim) });
        }
      }

      if (gains.length > 0) {
        options.push({ planId: plan.id, planName: plan.name, priceUSD: plan.priceUSD, gains });
      }
    }

    return options;
  }

  _getDailyBurnRate(userId, since, dayOfMonth) {
    const mtdCost = this._ledger.getAICostUSD(userId, since, new Date().toISOString());
    return dayOfMonth > 0 ? mtdCost / dayOfMonth : 0;
  }

  _getDaysInCurrentMonth() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  }

  _getUnit(dimension) {
    const { getDimensionMeta } = require('../ledger/usageDimensions');
    const meta = getDimensionMeta(dimension);
    return meta ? meta.unit : 'units';
  }
}

module.exports = { BillingDashboard };
