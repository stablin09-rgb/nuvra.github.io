'use strict';

/**
 * planDefinitions.js — Nuvra Phase 7
 *
 * Capability-based plan definitions. Plans define WHAT a user can do and
 * HOW MUCH they can do it — never just a boolean "can/cannot".
 *
 * Design principles:
 *  - Quantified: every entitlement has a numeric limit (Infinity = unlimited).
 *  - Explicit: every limit has a unit and a reset window.
 *  - Auditable: plan changes are versioned and logged.
 *  - Extensible: new dimensions can be added without breaking existing plans.
 */

const { Dimension } = require('../ledger/usageDimensions');

// ─── Plan IDs ─────────────────────────────────────────────────────────────────

const PlanId = Object.freeze({
  FREE:       'free',
  STARTER:    'starter',
  PRO:        'pro',
  TEAM:       'team',
  ENTERPRISE: 'enterprise',
});

// ─── Reset Windows ────────────────────────────────────────────────────────────

const ResetWindow = Object.freeze({
  MONTHLY:  'monthly',
  DAILY:    'daily',
  SESSION:  'session',
  LIFETIME: 'lifetime',
  NEVER:    'never',
});

// ─── Entitlement Factory ──────────────────────────────────────────────────────

/**
 * Creates an entitlement definition.
 * @param {number} limit         - Maximum allowed quantity (Infinity = unlimited)
 * @param {string} resetWindow   - When the counter resets
 * @param {string} [softLimit]   - Optional soft limit (triggers warning, not block)
 * @param {string} [gracePeriod] - Optional grace period in hours after hard limit
 */
function ent(limit, resetWindow, softLimit = null, gracePeriodHours = 0) {
  return Object.freeze({ limit, resetWindow, softLimit, gracePeriodHours });
}

// ─── Plan Definitions ─────────────────────────────────────────────────────────

const PLANS = Object.freeze({

  // ── Free Plan ──────────────────────────────────────────────────────────────
  [PlanId.FREE]: {
    id:          PlanId.FREE,
    name:        'Free',
    description: 'For individuals exploring Nuvra.',
    priceUSD:    0,
    entitlements: {
      [Dimension.AI_TOKENS_INPUT]:      ent(50_000,    ResetWindow.MONTHLY),
      [Dimension.AI_TOKENS_OUTPUT]:     ent(20_000,    ResetWindow.MONTHLY),
      [Dimension.AI_PLANS_EXECUTED]:    ent(5,         ResetWindow.MONTHLY),
      [Dimension.AI_COST_USD]:          ent(0.50,      ResetWindow.MONTHLY),
      [Dimension.PAGES_GENERATED]:      ent(10,        ResetWindow.MONTHLY),
      [Dimension.APPS_GENERATED]:       ent(1,         ResetWindow.MONTHLY),
      [Dimension.COMPONENTS_GENERATED]: ent(20,        ResetWindow.MONTHLY),
      [Dimension.PREVIEW_MINUTES]:      ent(60,        ResetWindow.MONTHLY),
      [Dimension.PUBLISH_BUILDS]:       ent(3,         ResetWindow.MONTHLY),
      [Dimension.MOBILE_BUILDS]:        ent(0,         ResetWindow.MONTHLY),
      [Dimension.STORAGE_BYTES]:        ent(100_000_000, ResetWindow.NEVER),   // 100 MB
      [Dimension.BANDWIDTH_BYTES]:      ent(1_000_000_000, ResetWindow.MONTHLY), // 1 GB
      [Dimension.COLLAB_SEATS]:         ent(1,         ResetWindow.NEVER),
    },
    allowedAIModels: ['gpt-4o-mini', 'gemini-flash'],
    features: {
      customDomains:    false,
      versionHistory:   false,
      prioritySupport:  false,
      apiAccess:        false,
      teamBilling:      false,
      ssoSaml:          false,
      auditLogs:        false,
    },
  },

  // ── Starter Plan ──────────────────────────────────────────────────────────
  [PlanId.STARTER]: {
    id:          PlanId.STARTER,
    name:        'Starter',
    description: 'For freelancers and solo builders.',
    priceUSD:    19,
    entitlements: {
      [Dimension.AI_TOKENS_INPUT]:      ent(500_000,   ResetWindow.MONTHLY, 400_000),
      [Dimension.AI_TOKENS_OUTPUT]:     ent(200_000,   ResetWindow.MONTHLY, 160_000),
      [Dimension.AI_PLANS_EXECUTED]:    ent(50,        ResetWindow.MONTHLY, 40),
      [Dimension.AI_COST_USD]:          ent(5.00,      ResetWindow.MONTHLY, 4.00),
      [Dimension.PAGES_GENERATED]:      ent(100,       ResetWindow.MONTHLY),
      [Dimension.APPS_GENERATED]:       ent(10,        ResetWindow.MONTHLY),
      [Dimension.COMPONENTS_GENERATED]: ent(Infinity,  ResetWindow.MONTHLY),
      [Dimension.PREVIEW_MINUTES]:      ent(Infinity,  ResetWindow.MONTHLY),
      [Dimension.PUBLISH_BUILDS]:       ent(50,        ResetWindow.MONTHLY),
      [Dimension.MOBILE_BUILDS]:        ent(2,         ResetWindow.MONTHLY),
      [Dimension.STORAGE_BYTES]:        ent(5_000_000_000, ResetWindow.NEVER),  // 5 GB
      [Dimension.BANDWIDTH_BYTES]:      ent(10_000_000_000, ResetWindow.MONTHLY), // 10 GB
      [Dimension.COLLAB_SEATS]:         ent(1,         ResetWindow.NEVER),
    },
    allowedAIModels: ['gpt-4o-mini', 'gpt-4o', 'gemini-flash', 'claude-haiku'],
    features: {
      customDomains:    true,
      versionHistory:   false,
      prioritySupport:  false,
      apiAccess:        false,
      teamBilling:      false,
      ssoSaml:          false,
      auditLogs:        false,
    },
  },

  // ── Pro Plan ───────────────────────────────────────────────────────────────
  [PlanId.PRO]: {
    id:          PlanId.PRO,
    name:        'Pro',
    description: 'For professional builders and small agencies.',
    priceUSD:    49,
    entitlements: {
      [Dimension.AI_TOKENS_INPUT]:      ent(2_000_000,  ResetWindow.MONTHLY, 1_600_000),
      [Dimension.AI_TOKENS_OUTPUT]:     ent(800_000,    ResetWindow.MONTHLY, 640_000),
      [Dimension.AI_PLANS_EXECUTED]:    ent(200,        ResetWindow.MONTHLY, 160),
      [Dimension.AI_COST_USD]:          ent(20.00,      ResetWindow.MONTHLY, 16.00),
      [Dimension.PAGES_GENERATED]:      ent(Infinity,   ResetWindow.MONTHLY),
      [Dimension.APPS_GENERATED]:       ent(Infinity,   ResetWindow.MONTHLY),
      [Dimension.COMPONENTS_GENERATED]: ent(Infinity,   ResetWindow.MONTHLY),
      [Dimension.PREVIEW_MINUTES]:      ent(Infinity,   ResetWindow.MONTHLY),
      [Dimension.PUBLISH_BUILDS]:       ent(Infinity,   ResetWindow.MONTHLY),
      [Dimension.MOBILE_BUILDS]:        ent(10,         ResetWindow.MONTHLY),
      [Dimension.STORAGE_BYTES]:        ent(50_000_000_000, ResetWindow.NEVER),  // 50 GB
      [Dimension.BANDWIDTH_BYTES]:      ent(100_000_000_000, ResetWindow.MONTHLY), // 100 GB
      [Dimension.COLLAB_SEATS]:         ent(3,          ResetWindow.NEVER),
    },
    allowedAIModels: ['gpt-4o-mini', 'gpt-4o', 'gemini-flash', 'gemini-pro', 'claude-haiku', 'claude-sonnet'],
    features: {
      customDomains:    true,
      versionHistory:   true,
      prioritySupport:  false,
      apiAccess:        true,
      teamBilling:      false,
      ssoSaml:          false,
      auditLogs:        true,
    },
  },

  // ── Team Plan ──────────────────────────────────────────────────────────────
  [PlanId.TEAM]: {
    id:          PlanId.TEAM,
    name:        'Team',
    description: 'For teams building together.',
    priceUSD:    99,
    entitlements: {
      [Dimension.AI_TOKENS_INPUT]:      ent(10_000_000, ResetWindow.MONTHLY, 8_000_000),
      [Dimension.AI_TOKENS_OUTPUT]:     ent(4_000_000,  ResetWindow.MONTHLY, 3_200_000),
      [Dimension.AI_PLANS_EXECUTED]:    ent(1000,       ResetWindow.MONTHLY, 800),
      [Dimension.AI_COST_USD]:          ent(100.00,     ResetWindow.MONTHLY, 80.00),
      [Dimension.PAGES_GENERATED]:      ent(Infinity,   ResetWindow.MONTHLY),
      [Dimension.APPS_GENERATED]:       ent(Infinity,   ResetWindow.MONTHLY),
      [Dimension.COMPONENTS_GENERATED]: ent(Infinity,   ResetWindow.MONTHLY),
      [Dimension.PREVIEW_MINUTES]:      ent(Infinity,   ResetWindow.MONTHLY),
      [Dimension.PUBLISH_BUILDS]:       ent(Infinity,   ResetWindow.MONTHLY),
      [Dimension.MOBILE_BUILDS]:        ent(50,         ResetWindow.MONTHLY),
      [Dimension.STORAGE_BYTES]:        ent(200_000_000_000, ResetWindow.NEVER), // 200 GB
      [Dimension.BANDWIDTH_BYTES]:      ent(Infinity,   ResetWindow.MONTHLY),
      [Dimension.COLLAB_SEATS]:         ent(10,         ResetWindow.NEVER),
    },
    allowedAIModels: ['gpt-4o-mini', 'gpt-4o', 'gemini-flash', 'gemini-pro', 'claude-haiku', 'claude-sonnet', 'claude-opus'],
    features: {
      customDomains:    true,
      versionHistory:   true,
      prioritySupport:  true,
      apiAccess:        true,
      teamBilling:      true,
      ssoSaml:          false,
      auditLogs:        true,
    },
  },

  // ── Enterprise Plan ────────────────────────────────────────────────────────
  [PlanId.ENTERPRISE]: {
    id:          PlanId.ENTERPRISE,
    name:        'Enterprise',
    description: 'Custom limits, SLAs, and compliance for large organisations.',
    priceUSD:    null, // Custom pricing
    entitlements: {
      [Dimension.AI_TOKENS_INPUT]:      ent(Infinity,  ResetWindow.MONTHLY),
      [Dimension.AI_TOKENS_OUTPUT]:     ent(Infinity,  ResetWindow.MONTHLY),
      [Dimension.AI_PLANS_EXECUTED]:    ent(Infinity,  ResetWindow.MONTHLY),
      [Dimension.AI_COST_USD]:          ent(Infinity,  ResetWindow.MONTHLY),
      [Dimension.PAGES_GENERATED]:      ent(Infinity,  ResetWindow.MONTHLY),
      [Dimension.APPS_GENERATED]:       ent(Infinity,  ResetWindow.MONTHLY),
      [Dimension.COMPONENTS_GENERATED]: ent(Infinity,  ResetWindow.MONTHLY),
      [Dimension.PREVIEW_MINUTES]:      ent(Infinity,  ResetWindow.MONTHLY),
      [Dimension.PUBLISH_BUILDS]:       ent(Infinity,  ResetWindow.MONTHLY),
      [Dimension.MOBILE_BUILDS]:        ent(Infinity,  ResetWindow.MONTHLY),
      [Dimension.STORAGE_BYTES]:        ent(Infinity,  ResetWindow.NEVER),
      [Dimension.BANDWIDTH_BYTES]:      ent(Infinity,  ResetWindow.MONTHLY),
      [Dimension.COLLAB_SEATS]:         ent(Infinity,  ResetWindow.NEVER),
    },
    allowedAIModels: ['*'], // All models
    features: {
      customDomains:    true,
      versionHistory:   true,
      prioritySupport:  true,
      apiAccess:        true,
      teamBilling:      true,
      ssoSaml:          true,
      auditLogs:        true,
    },
  },
});

// ─── Plan Helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the plan definition for a given plan ID.
 * @param {string} planId
 * @returns {object|null}
 */
function getPlan(planId) {
  return PLANS[planId] || null;
}

/**
 * Returns all plan definitions as an array, ordered by price.
 * @returns {object[]}
 */
function getAllPlans() {
  return [PlanId.FREE, PlanId.STARTER, PlanId.PRO, PlanId.TEAM, PlanId.ENTERPRISE]
    .map(id => PLANS[id]);
}

/**
 * Returns the entitlement for a specific dimension on a plan.
 * @param {string} planId
 * @param {string} dimension
 * @returns {object|null}
 */
function getEntitlement(planId, dimension) {
  const plan = getPlan(planId);
  if (!plan) return null;
  return plan.entitlements[dimension] || null;
}

/**
 * Returns whether a given AI model is allowed on a plan.
 * @param {string} planId
 * @param {string} modelId
 * @returns {boolean}
 */
function isModelAllowed(planId, modelId) {
  const plan = getPlan(planId);
  if (!plan) return false;
  if (plan.allowedAIModels.includes('*')) return true;
  return plan.allowedAIModels.includes(modelId);
}

/**
 * Returns whether a plan is an upgrade from another.
 * @param {string} fromPlanId
 * @param {string} toPlanId
 * @returns {boolean}
 */
function isUpgrade(fromPlanId, toPlanId) {
  const order = [PlanId.FREE, PlanId.STARTER, PlanId.PRO, PlanId.TEAM, PlanId.ENTERPRISE];
  return order.indexOf(toPlanId) > order.indexOf(fromPlanId);
}

module.exports = {
  PlanId, ResetWindow, PLANS,
  getPlan, getAllPlans, getEntitlement, isModelAllowed, isUpgrade,
};
