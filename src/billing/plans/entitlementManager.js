'use strict';

/**
 * entitlementManager.js — Nuvra Phase 7
 *
 * The EntitlementManager is the single authority for answering:
 * "Can this user do this action right now?"
 *
 * It combines:
 *  - The user's current plan (from the billing state)
 *  - The current usage (from the UsageLedger)
 *  - The plan's entitlements (from planDefinitions)
 *
 * It returns structured results that include:
 *  - Whether the action is allowed
 *  - Whether a soft limit warning should be shown
 *  - The reason for any denial
 *  - The upgrade path to unlock the action
 */

const { getPlan, getEntitlement, isModelAllowed, ResetWindow } = require('./planDefinitions');
const { Dimension }    = require('../ledger/usageDimensions');
const { UsageLedger }  = require('../ledger/usageLedger');

// ─── Check Result ─────────────────────────────────────────────────────────────

/**
 * Creates a structured entitlement check result.
 */
function result({ allowed, hardBlocked = false, softWarning = false, reason = null, code = null, upgradeTo = null, current = 0, limit = 0 }) {
  return Object.freeze({ allowed, hardBlocked, softWarning, reason, code, upgradeTo, current, limit });
}

// ─── EntitlementManager ───────────────────────────────────────────────────────

class EntitlementManager {
  /**
   * @param {object} options
   * @param {UsageLedger} options.ledger
   * @param {object}      [options.logger]
   */
  constructor({ ledger, logger = null }) {
    this._ledger = ledger;
    this._logger = logger;
  }

  // ─── Core Check ─────────────────────────────────────────────────────────────

  /**
   * Checks whether a user can perform an action that consumes a given dimension.
   *
   * @param {object} params
   * @param {string} params.userId
   * @param {string} params.planId
   * @param {string} params.dimension
   * @param {number} [params.quantity=1]   - How much of the dimension will be consumed
   * @param {string} [params.projectId]
   * @returns {object} Check result
   */
  check({ userId, planId, dimension, quantity = 1, projectId = null }) {
    const plan = getPlan(planId);
    if (!plan) {
      return result({ allowed: false, hardBlocked: true, reason: `Unknown plan: "${planId}"`, code: 'UNKNOWN_PLAN' });
    }

    const entitlement = getEntitlement(planId, dimension);
    if (!entitlement) {
      // Dimension not in plan = unlimited (future-proofing for new dimensions)
      return result({ allowed: true, current: 0, limit: Infinity });
    }

    const { limit, softLimit, gracePeriodHours } = entitlement;

    // Unlimited entitlement
    if (limit === Infinity) {
      return result({ allowed: true, current: 0, limit: Infinity });
    }

    // Get current usage for the reset window
    const { since, until } = this._getWindow(entitlement.resetWindow);
    const current = this._ledger.aggregate({ dimension, userId, projectId, since, until });

    // Hard limit check
    if (current + quantity > limit) {
      const upgradeTo = this._getUpgradePlan(planId, dimension, current + quantity);
      return result({
        allowed:      false,
        hardBlocked:  true,
        reason:       `${dimension} limit reached (${current}/${limit} ${this._getUnit(dimension)} used this ${entitlement.resetWindow} period).`,
        code:         'HARD_LIMIT_EXCEEDED',
        upgradeTo,
        current,
        limit,
      });
    }

    // Soft limit warning
    if (softLimit !== null && current + quantity > softLimit) {
      return result({
        allowed:      true,
        softWarning:  true,
        reason:       `Approaching ${dimension} limit (${current}/${limit} used). Consider upgrading.`,
        code:         'SOFT_LIMIT_WARNING',
        upgradeTo:    this._getUpgradePlan(planId, dimension, limit + 1),
        current,
        limit,
      });
    }

    return result({ allowed: true, current, limit });
  }

  /**
   * Checks whether a specific AI model is allowed on the user's plan.
   */
  checkModel({ planId, modelId }) {
    if (isModelAllowed(planId, modelId)) {
      return result({ allowed: true });
    }
    const upgradeTo = this._getUpgradePlanForModel(planId, modelId);
    return result({
      allowed:     false,
      hardBlocked: true,
      reason:      `Model "${modelId}" is not available on the ${planId} plan.`,
      code:        'MODEL_NOT_ALLOWED',
      upgradeTo,
    });
  }

  /**
   * Checks whether a feature flag is enabled on the user's plan.
   */
  checkFeature({ planId, feature }) {
    const plan = getPlan(planId);
    if (!plan) return result({ allowed: false, hardBlocked: true, reason: 'Unknown plan', code: 'UNKNOWN_PLAN' });

    if (plan.features[feature]) {
      return result({ allowed: true });
    }

    const upgradeTo = this._getUpgradePlanForFeature(planId, feature);
    return result({
      allowed:     false,
      hardBlocked: true,
      reason:      `Feature "${feature}" is not available on the ${plan.name} plan.`,
      code:        'FEATURE_NOT_AVAILABLE',
      upgradeTo,
    });
  }

  /**
   * Returns a full entitlement status report for a user.
   * Useful for the billing dashboard.
   */
  getStatusReport({ userId, planId }) {
    const plan = getPlan(planId);
    if (!plan) return null;

    const { since, until } = UsageLedger.currentMonthWindow();
    const report = { planId, planName: plan.name, dimensions: {} };

    for (const [dim, entitlement] of Object.entries(plan.entitlements)) {
      const { since: ws, until: wu } = this._getWindow(entitlement.resetWindow);
      const current = this._ledger.aggregate({ dimension: dim, userId, since: ws, until: wu });
      const pct     = entitlement.limit === Infinity ? 0 : (current / entitlement.limit) * 100;

      report.dimensions[dim] = {
        current,
        limit:       entitlement.limit,
        resetWindow: entitlement.resetWindow,
        pct:         Math.min(pct, 100),
        status:      pct >= 100 ? 'exceeded' : pct >= 80 ? 'warning' : 'ok',
      };
    }

    return report;
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  _getWindow(resetWindow) {
    if (resetWindow === ResetWindow.MONTHLY)  return UsageLedger.currentMonthWindow();
    if (resetWindow === ResetWindow.DAILY)    return UsageLedger.currentDayWindow();
    if (resetWindow === ResetWindow.NEVER)    return { since: '1970-01-01T00:00:00.000Z', until: new Date(9999, 0).toISOString() };
    if (resetWindow === ResetWindow.LIFETIME) return { since: '1970-01-01T00:00:00.000Z', until: new Date(9999, 0).toISOString() };
    return UsageLedger.currentMonthWindow();
  }

  _getUnit(dimension) {
    const { getDimensionMeta } = require('../ledger/usageDimensions');
    const meta = getDimensionMeta(dimension);
    return meta ? meta.unit : 'units';
  }

  _getUpgradePlan(fromPlanId, dimension, neededQuantity) {
    const { getAllPlans } = require('./planDefinitions');
    const order = ['free', 'starter', 'pro', 'team', 'enterprise'];
    const fromIdx = order.indexOf(fromPlanId);

    for (let i = fromIdx + 1; i < order.length; i++) {
      const plan = getPlan(order[i]);
      if (!plan) continue;
      const ent = plan.entitlements[dimension];
      if (!ent) continue;
      if (ent.limit === Infinity || ent.limit >= neededQuantity) return order[i];
    }
    return 'enterprise';
  }

  _getUpgradePlanForModel(fromPlanId, modelId) {
    const order = ['free', 'starter', 'pro', 'team', 'enterprise'];
    const fromIdx = order.indexOf(fromPlanId);
    for (let i = fromIdx + 1; i < order.length; i++) {
      if (isModelAllowed(order[i], modelId)) return order[i];
    }
    return 'enterprise';
  }

  _getUpgradePlanForFeature(fromPlanId, feature) {
    const order = ['free', 'starter', 'pro', 'team', 'enterprise'];
    const fromIdx = order.indexOf(fromPlanId);
    for (let i = fromIdx + 1; i < order.length; i++) {
      const plan = getPlan(order[i]);
      if (plan && plan.features[feature]) return order[i];
    }
    return 'enterprise';
  }
}

export { EntitlementManager };
export default EntitlementManager;