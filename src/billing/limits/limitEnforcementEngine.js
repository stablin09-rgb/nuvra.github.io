'use strict';

/**
 * limitEnforcementEngine.js — Nuvra Phase 7
 *
 * The Limit Enforcement Engine is the gatekeeper for all billable actions.
 * It is called BEFORE any action that consumes a metered resource.
 *
 * Enforcement model:
 *  - HARD LIMIT:  Action is blocked immediately. AI refuses with a clear
 *                 explanation and an upgrade path. No silent failures.
 *  - SOFT LIMIT:  Action is allowed but a warning is shown. The user is
 *                 informed they are approaching their limit.
 *  - GRACE PERIOD: After a hard limit is hit, some plans allow a short
 *                  grace period before enforcement kicks in.
 *
 * Every enforcement decision is logged to the billing audit trail.
 */


// ─── Enforcement Codes ────────────────────────────────────────────────────────

import { EntitlementManager } from '../plans/entitlementManager.js';
import { Dimension } from '../ledger/usageDimensions.js';
import { getEntitlement } from '../plans/planDefinitions.js';
const EnforcementCode = Object.freeze({
  ALLOWED:              'ALLOWED',
  SOFT_WARNING:         'SOFT_WARNING',
  HARD_BLOCKED:         'HARD_BLOCKED',
  MODEL_BLOCKED:        'MODEL_BLOCKED',
  FEATURE_BLOCKED:      'FEATURE_BLOCKED',
  ABUSE_BLOCKED:        'ABUSE_BLOCKED',
  PLAN_SUSPENDED:       'PLAN_SUSPENDED',
});

// ─── LimitEnforcementEngine ───────────────────────────────────────────────────

class LimitEnforcementEngine {
  /**
   * @param {object} options
   * @param {EntitlementManager} options.entitlementManager
   * @param {object}             [options.eventBus]
   * @param {object}             [options.logger]
   */
  constructor({ entitlementManager, eventBus = null, logger = null }) {
    this._entitlements = entitlementManager;
    this._eventBus     = eventBus;
    this._logger       = logger;

    // Grace period tracking: userId → { dimension → graceExpiresAt }
    this._gracePeriods = new Map();

    // Suspended users (e.g., payment failure)
    this._suspendedUsers = new Set();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Enforces limits before a billable action.
   *
   * @param {object} params
   * @param {string} params.userId
   * @param {string} params.planId
   * @param {string} params.dimension
   * @param {number} [params.quantity=1]
   * @param {string} [params.projectId]
   * @param {string} [params.actionLabel]  - Human-readable action name for logging
   * @returns {object} Enforcement result
   */
  enforce({ userId, planId, dimension, quantity = 1, projectId = null, actionLabel = dimension }) {
    // 1. Check if user is suspended
    if (this._suspendedUsers.has(userId)) {
      return this._block({
        userId, planId, dimension, quantity,
        code:      EnforcementCode.PLAN_SUSPENDED,
        reason:    'Your account is suspended. Please update your billing information to continue.',
        upgradeTo: null,
      });
    }

    // 2. Check grace period
    if (this._isInGracePeriod(userId, dimension)) {
      return this._warn({
        userId, planId, dimension, quantity,
        code:   EnforcementCode.SOFT_WARNING,
        reason: 'You are in a grace period. Please upgrade your plan to avoid interruption.',
      });
    }

    // 3. Check entitlement
    const check = this._entitlements.check({ userId, planId, dimension, quantity, projectId });

    if (check.hardBlocked) {
      // Check if a grace period should be started
      const gracePeriodHours = this._getGracePeriodHours(planId, dimension);
      if (gracePeriodHours > 0 && !this._isInGracePeriod(userId, dimension)) {
        this._startGracePeriod(userId, dimension, gracePeriodHours);
        return this._warn({
          userId, planId, dimension, quantity,
          code:      EnforcementCode.SOFT_WARNING,
          reason:    `You have exceeded your ${dimension} limit. You have a ${gracePeriodHours}-hour grace period before actions are blocked.`,
          upgradeTo: check.upgradeTo,
          current:   check.current,
          limit:     check.limit,
        });
      }

      return this._block({
        userId, planId, dimension, quantity,
        code:      EnforcementCode.HARD_BLOCKED,
        reason:    check.reason,
        upgradeTo: check.upgradeTo,
        current:   check.current,
        limit:     check.limit,
      });
    }

    if (check.softWarning) {
      return this._warn({
        userId, planId, dimension, quantity,
        code:      EnforcementCode.SOFT_WARNING,
        reason:    check.reason,
        upgradeTo: check.upgradeTo,
        current:   check.current,
        limit:     check.limit,
      });
    }

    // Allowed
    this._log('debug', `[Enforcement] ALLOWED: ${actionLabel} for ${userId}`, { dimension, quantity });
    return { allowed: true, code: EnforcementCode.ALLOWED, reason: null, upgradeTo: null };
  }

  /**
   * Enforces an AI model restriction.
   */
  enforceModel({ userId, planId, modelId }) {
    const check = this._entitlements.checkModel({ planId, modelId });
    if (!check.allowed) {
      return this._block({
        userId, planId, dimension: 'model',
        code:      EnforcementCode.MODEL_BLOCKED,
        reason:    check.reason,
        upgradeTo: check.upgradeTo,
      });
    }
    return { allowed: true, code: EnforcementCode.ALLOWED };
  }

  /**
   * Enforces a feature flag restriction.
   */
  enforceFeature({ userId, planId, feature }) {
    const check = this._entitlements.checkFeature({ planId, feature });
    if (!check.allowed) {
      return this._block({
        userId, planId, dimension: feature,
        code:      EnforcementCode.FEATURE_BLOCKED,
        reason:    check.reason,
        upgradeTo: check.upgradeTo,
      });
    }
    return { allowed: true, code: EnforcementCode.ALLOWED };
  }

  /**
   * Suspends a user (e.g., on payment failure).
   */
  suspendUser(userId, reason = 'Payment failure') {
    this._suspendedUsers.add(userId);
    this._log('warn', `[Enforcement] User suspended: ${userId}`, { reason });
    if (this._eventBus) this._eventBus.emit('billing:user:suspended', { userId, reason });
  }

  /**
   * Reinstates a suspended user (e.g., on payment success).
   */
  reinstateUser(userId) {
    this._suspendedUsers.delete(userId);
    this._log('info', `[Enforcement] User reinstated: ${userId}`);
    if (this._eventBus) this._eventBus.emit('billing:user:reinstated', { userId });
  }

  /**
   * Checks if a user is currently suspended.
   */
  isSuspended(userId) {
    return this._suspendedUsers.has(userId);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  _block({ userId, planId, dimension, quantity = 0, code, reason, upgradeTo = null, current = 0, limit = 0 }) {
    this._log('warn', `[Enforcement] BLOCKED: ${code} for ${userId}`, { dimension, quantity, reason });

    if (this._eventBus) {
      this._eventBus.emit('billing:limit:blocked', {
        userId, planId, dimension, quantity, code, reason, upgradeTo, current, limit,
      });
    }

    return { allowed: false, code, reason, upgradeTo, current, limit };
  }

  _warn({ userId, planId, dimension, quantity = 0, code, reason, upgradeTo = null, current = 0, limit = 0 }) {
    this._log('info', `[Enforcement] WARNING: ${code} for ${userId}`, { dimension, quantity, reason });

    if (this._eventBus) {
      this._eventBus.emit('billing:limit:warning', {
        userId, planId, dimension, quantity, code, reason, upgradeTo, current, limit,
      });
    }

    return { allowed: true, code, reason, upgradeTo, current, limit };
  }

  _isInGracePeriod(userId, dimension) {
    const key = `${userId}:${dimension}`;
    const expiresAt = this._gracePeriods.get(key);
    if (!expiresAt) return false;
    if (Date.now() > expiresAt) {
      this._gracePeriods.delete(key);
      return false;
    }
    return true;
  }

  _startGracePeriod(userId, dimension, hours) {
    const key = `${userId}:${dimension}`;
    const expiresAt = Date.now() + hours * 60 * 60 * 1000;
    this._gracePeriods.set(key, expiresAt);
    this._log('info', `[Enforcement] Grace period started for ${userId}:${dimension}`, { hours });
  }

  _getGracePeriodHours(planId, dimension) {
    const ent = getEntitlement(planId, dimension);
    return ent ? (ent.gracePeriodHours || 0) : 0;
  }

  _log(level, message, data = {}) {
    if (this._logger && this._logger[level]) {
      this._logger[level](message, data);
    }
  }
}

export { LimitEnforcementEngine, EnforcementCode };