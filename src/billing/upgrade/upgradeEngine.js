'use strict';

/**
 * upgradeEngine.js — Nuvra Phase 7
 *
 * The Upgrade/Downgrade & Proration Engine manages plan transitions.
 *
 * Rules:
 *  - Upgrades take effect immediately.
 *  - Downgrades take effect at the end of the current billing period.
 *  - Proration is calculated transparently and shown to the user before confirmation.
 *  - No silent charges. The user always sees the exact amount before any action.
 *  - Downgrading to a plan where current usage exceeds the new plan's limits
 *    is allowed, but the user is warned and shown which limits will be enforced
 *    at the start of the next billing period.
 */


// ─── Transition Types ─────────────────────────────────────────────────────────

import { getPlan, isUpgrade, getEntitlement } from '../plans/planDefinitions.js';
import { Dimension, getAllDimensions } from '../ledger/usageDimensions.js';
import { UsageLedger } from '../ledger/usageLedger.js';
import { getAllDimensions } from '../ledger/usageDimensions.js';
const TransitionType = Object.freeze({
  UPGRADE:   'upgrade',
  DOWNGRADE: 'downgrade',
  SAME_PLAN: 'same_plan',
});

// ─── UpgradeEngine ────────────────────────────────────────────────────────────

class UpgradeEngine {
  /**
   * @param {object} options
   * @param {object} options.billingProviderRegistry
   * @param {object} options.ledger
   * @param {object} [options.eventBus]
   * @param {object} [options.logger]
   */
  constructor({ billingProviderRegistry, ledger, eventBus = null, logger = null }) {
    this._providers = billingProviderRegistry;
    this._ledger    = ledger;
    this._eventBus  = eventBus;
    this._logger    = logger;

    // Pending downgrades: userId → { toPlanId, effectiveAt }
    this._pendingDowngrades = new Map();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Calculates a plan transition preview — shows the user exactly what will
   * happen before they confirm.
   *
   * @param {object} params
   * @param {string} params.userId
   * @param {string} params.fromPlanId
   * @param {string} params.toPlanId
   * @param {string} [params.currentPeriodEnd]  - ISO 8601 end of current billing period
   * @returns {object} Transition preview
   */
  previewTransition({ userId, fromPlanId, toPlanId, currentPeriodEnd = null }) {
    if (fromPlanId === toPlanId) {
      return { type: TransitionType.SAME_PLAN, message: 'You are already on this plan.' };
    }

    const type        = isUpgrade(fromPlanId, toPlanId) ? TransitionType.UPGRADE : TransitionType.DOWNGRADE;
    const fromPlan    = getPlan(fromPlanId);
    const toPlan      = getPlan(toPlanId);
    const proration   = this._calculateProration(fromPlan, toPlan, currentPeriodEnd);
    const limitChanges = this._getLimitChanges(fromPlanId, toPlanId);
    const warnings    = this._getDowngradeWarnings(userId, fromPlanId, toPlanId);

    return {
      type,
      fromPlan:     { id: fromPlanId, name: fromPlan?.name },
      toPlan:       { id: toPlanId,   name: toPlan?.name, priceUSD: toPlan?.priceUSD },
      effectiveAt:  type === TransitionType.UPGRADE ? 'immediately' : (currentPeriodEnd || 'end_of_period'),
      proration,
      limitChanges,
      warnings,
      requiresConfirmation: warnings.length > 0 || proration.chargeUSD > 0,
    };
  }

  /**
   * Executes a plan upgrade. Takes effect immediately.
   *
   * @param {object} params
   * @param {string} params.userId
   * @param {string} params.customerId
   * @param {string} params.fromPlanId
   * @param {string} params.toPlanId
   * @param {string} params.successUrl
   * @param {string} params.cancelUrl
   * @returns {Promise<object>} { ok, checkoutUrl?, newPlanId?, error? }
   */
  async executeUpgrade({ userId, customerId, fromPlanId, toPlanId, successUrl, cancelUrl }) {
    if (!isUpgrade(fromPlanId, toPlanId)) {
      return { ok: false, error: `"${toPlanId}" is not an upgrade from "${fromPlanId}"` };
    }

    const provider = this._providers.getActive();
    const result   = await provider.createCheckoutSession({ customerId, planId: toPlanId, successUrl, cancelUrl });

    if (result.ok) {
      this._log('info', `[UpgradeEngine] Upgrade initiated: ${userId} ${fromPlanId} → ${toPlanId}`);
      if (this._eventBus) {
        this._eventBus.emit('billing:upgrade:initiated', { userId, fromPlanId, toPlanId, checkoutUrl: result.checkoutUrl });
      }
    }

    return result;
  }

  /**
   * Schedules a plan downgrade for the end of the current billing period.
   *
   * @param {object} params
   * @param {string} params.userId
   * @param {string} params.subscriptionId
   * @param {string} params.fromPlanId
   * @param {string} params.toPlanId
   * @param {string} params.currentPeriodEnd
   * @returns {Promise<object>}
   */
  async scheduleDowngrade({ userId, subscriptionId, fromPlanId, toPlanId, currentPeriodEnd }) {
    if (isUpgrade(fromPlanId, toPlanId)) {
      return { ok: false, error: `"${toPlanId}" is not a downgrade from "${fromPlanId}"` };
    }

    // Schedule the downgrade
    this._pendingDowngrades.set(userId, {
      toPlanId,
      fromPlanId,
      effectiveAt: currentPeriodEnd,
      scheduledAt: new Date().toISOString(),
    });

    this._log('info', `[UpgradeEngine] Downgrade scheduled: ${userId} ${fromPlanId} → ${toPlanId} at ${currentPeriodEnd}`);
    if (this._eventBus) {
      this._eventBus.emit('billing:downgrade:scheduled', { userId, fromPlanId, toPlanId, effectiveAt: currentPeriodEnd });
    }

    return { ok: true, effectiveAt: currentPeriodEnd };
  }

  /**
   * Applies all pending downgrades that have passed their effective date.
   * Should be called on a daily schedule.
   * @returns {string[]} Array of userIds whose downgrades were applied
   */
  applyPendingDowngrades() {
    const now     = new Date().toISOString();
    const applied = [];

    for (const [userId, downgrade] of this._pendingDowngrades) {
      if (downgrade.effectiveAt <= now) {
        this._pendingDowngrades.delete(userId);
        applied.push(userId);
        if (this._eventBus) {
          this._eventBus.emit('billing:downgrade:applied', {
            userId,
            fromPlanId: downgrade.fromPlanId,
            toPlanId:   downgrade.toPlanId,
          });
        }
        this._log('info', `[UpgradeEngine] Downgrade applied: ${userId} → ${downgrade.toPlanId}`);
      }
    }

    return applied;
  }

  /**
   * Returns any pending downgrade for a user.
   */
  getPendingDowngrade(userId) {
    return this._pendingDowngrades.get(userId) || null;
  }

  /**
   * Cancels a pending downgrade.
   */
  cancelPendingDowngrade(userId) {
    const had = this._pendingDowngrades.has(userId);
    this._pendingDowngrades.delete(userId);
    return had;
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  _calculateProration(fromPlan, toPlan, currentPeriodEnd) {
    if (!currentPeriodEnd || !fromPlan || !toPlan) {
      return { chargeUSD: 0, creditUSD: 0, netUSD: 0, explanation: 'Proration not applicable.' };
    }

    const now          = new Date();
    const periodEnd    = new Date(currentPeriodEnd);
    const daysLeft     = Math.max(0, Math.ceil((periodEnd - now) / (1000 * 60 * 60 * 24)));
    const daysInMonth  = 30; // Simplified

    const fromDailyRate = (fromPlan.priceUSD || 0) / daysInMonth;
    const toDailyRate   = (toPlan.priceUSD   || 0) / daysInMonth;

    const creditUSD = Math.round(fromDailyRate * daysLeft * 100) / 100;
    const chargeUSD = Math.round(toDailyRate   * daysLeft * 100) / 100;
    const netUSD    = Math.round((chargeUSD - creditUSD) * 100) / 100;

    return {
      chargeUSD,
      creditUSD,
      netUSD,
      daysLeft,
      explanation: netUSD > 0
        ? `You will be charged $${netUSD.toFixed(2)} for the remaining ${daysLeft} days of your billing period.`
        : `You will receive a $${Math.abs(netUSD).toFixed(2)} credit applied to your next invoice.`,
    };
  }

  _getLimitChanges(fromPlanId, toPlanId) {
    const changes = [];

    for (const dim of getAllDimensions()) {
      const fromEnt = getEntitlement(fromPlanId, dim.id);
      const toEnt   = getEntitlement(toPlanId,   dim.id);
      if (!fromEnt || !toEnt) continue;
      if (fromEnt.limit === toEnt.limit) continue;

      changes.push({
        dimension: dim.id,
        label:     dim.label,
        unit:      dim.unit,
        from:      fromEnt.limit,
        to:        toEnt.limit,
        direction: toEnt.limit > fromEnt.limit || toEnt.limit === Infinity ? 'increase' : 'decrease',
      });
    }

    return changes;
  }

  _getDowngradeWarnings(userId, fromPlanId, toPlanId) {
    if (isUpgrade(fromPlanId, toPlanId)) return [];

    const { since, until }   = UsageLedger.currentMonthWindow();
    const warnings           = [];

    for (const dim of getAllDimensions()) {
      const toEnt = getEntitlement(toPlanId, dim.id);
      if (!toEnt || toEnt.limit === Infinity) continue;

      const currentUsage = this._ledger.aggregate({ dimension: dim.id, userId, since, until });
      if (currentUsage > toEnt.limit) {
        warnings.push({
          dimension: dim.id,
          label:     dim.label,
          current:   currentUsage,
          newLimit:  toEnt.limit,
          unit:      dim.unit,
          message:   `Your current ${dim.label} usage (${currentUsage} ${dim.unit}) exceeds the new plan's limit (${toEnt.limit} ${dim.unit}). This will be enforced at the start of your next billing period.`,
        });
      }
    }

    return warnings;
  }

  _log(level, message, data = {}) {
    if (this._logger && this._logger[level]) this._logger[level](message, data);
  }
}

export { UpgradeEngine, TransitionType };