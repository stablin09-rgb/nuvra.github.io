'use strict';

/**
 * aiCostGovernance.js — Nuvra Phase 7
 *
 * The AI Cost Governance layer enforces multi-level budget controls on all
 * AI provider calls. It operates independently of the general
 * LimitEnforcementEngine to provide fine-grained, real-time cost control.
 *
 * Budget hierarchy (checked in order, most specific first):
 *  1. Per-session budget    (in-memory, resets on page reload)
 *  2. Per-project budget    (configurable per project)
 *  3. Per-provider budget   (configurable per AI provider)
 *  4. Per-month budget      (from plan entitlements, via LimitEnforcementEngine)
 *
 * AI must refuse requests when any budget is exceeded — politely and clearly.
 */

const { Dimension } = require('../ledger/usageDimensions');

// ─── Provider Pricing ─────────────────────────────────────────────────────────
// Prices in USD per 1,000 tokens. Updated as of early 2026.
// These are configurable — AI prices change weekly.

const PROVIDER_PRICING = {
  'openai': {
    'gpt-4o':      { inputPer1k: 0.005,  outputPer1k: 0.015  },
    'gpt-4o-mini': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
    'o1':          { inputPer1k: 0.015,  outputPer1k: 0.060  },
    'o1-mini':     { inputPer1k: 0.003,  outputPer1k: 0.012  },
  },
  'anthropic': {
    'claude-opus':    { inputPer1k: 0.015,  outputPer1k: 0.075  },
    'claude-sonnet':  { inputPer1k: 0.003,  outputPer1k: 0.015  },
    'claude-haiku':   { inputPer1k: 0.00025, outputPer1k: 0.00125 },
  },
  'google': {
    'gemini-pro':   { inputPer1k: 0.00125, outputPer1k: 0.005  },
    'gemini-flash': { inputPer1k: 0.000075, outputPer1k: 0.0003 },
  },
  'ollama': {
    '*': { inputPer1k: 0, outputPer1k: 0 }, // Local models are free
  },
};

// ─── AICostGovernance ─────────────────────────────────────────────────────────

class AICostGovernance {
  /**
   * @param {object} options
   * @param {object} options.ledger              - UsageLedger instance
   * @param {object} [options.eventBus]
   * @param {object} [options.logger]
   * @param {object} [options.sessionBudgets]    - Default session budgets by plan
   * @param {object} [options.projectBudgets]    - Per-project budget overrides
   * @param {object} [options.providerBudgets]   - Per-provider monthly caps
   * @param {object} [options.pricing]           - Override default provider pricing
   */
  constructor({
    ledger,
    eventBus        = null,
    logger          = null,
    sessionBudgets  = {},
    projectBudgets  = {},
    providerBudgets = {},
    pricing         = {},
  }) {
    this._ledger          = ledger;
    this._eventBus        = eventBus;
    this._logger          = logger;
    this._projectBudgets  = new Map(Object.entries(projectBudgets));
    this._providerBudgets = new Map(Object.entries(providerBudgets));
    this._pricing         = { ...PROVIDER_PRICING, ...pricing };

    // Session budgets: userId → { spent: number, limit: number, calls: number }
    this._sessions = new Map();
    this._defaultSessionBudgets = {
      free:       { limit: 0.25,  maxCalls: 10  },
      starter:    { limit: 1.00,  maxCalls: 50  },
      pro:        { limit: 5.00,  maxCalls: 200 },
      team:       { limit: 20.00, maxCalls: 500 },
      enterprise: { limit: Infinity, maxCalls: Infinity },
      ...sessionBudgets,
    };
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Estimates the cost of an AI call before it is made.
   *
   * @param {object} params
   * @param {string} params.provider
   * @param {string} params.model
   * @param {number} params.estimatedInputTokens
   * @param {number} params.estimatedOutputTokens
   * @returns {number} Estimated cost in USD
   */
  estimateCost({ provider, model, estimatedInputTokens = 0, estimatedOutputTokens = 0 }) {
    const pricing = this._getPricing(provider, model);
    const inputCost  = (estimatedInputTokens  / 1000) * pricing.inputPer1k;
    const outputCost = (estimatedOutputTokens / 1000) * pricing.outputPer1k;
    return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000; // Round to 6 decimal places
  }

  /**
   * Checks all budget levels before an AI call.
   *
   * @param {object} params
   * @param {string} params.userId
   * @param {string} params.planId
   * @param {string} params.provider
   * @param {string} params.model
   * @param {string} [params.projectId]
   * @param {number} [params.estimatedInputTokens]
   * @param {number} [params.estimatedOutputTokens]
   * @returns {object} { allowed, reason, code, estimatedCost, budgetLevel }
   */
  checkBudgets({ userId, planId, provider, model, projectId = null, estimatedInputTokens = 500, estimatedOutputTokens = 1000 }) {
    const estimatedCost = this.estimateCost({ provider, model, estimatedInputTokens, estimatedOutputTokens });

    // 1. Session budget check
    const sessionCheck = this._checkSessionBudget(userId, planId, estimatedCost);
    if (!sessionCheck.allowed) return { ...sessionCheck, estimatedCost, budgetLevel: 'session' };

    // 2. Project budget check
    if (projectId) {
      const projectCheck = this._checkProjectBudget(projectId, estimatedCost);
      if (!projectCheck.allowed) return { ...projectCheck, estimatedCost, budgetLevel: 'project' };
    }

    // 3. Provider budget check
    const providerCheck = this._checkProviderBudget(userId, provider, estimatedCost);
    if (!providerCheck.allowed) return { ...providerCheck, estimatedCost, budgetLevel: 'provider' };

    return {
      allowed:       true,
      estimatedCost,
      budgetLevel:   null,
      sessionSpent:  this._getSession(userId, planId).spent,
      sessionLimit:  this._getSessionLimit(planId),
    };
  }

  /**
   * Records actual AI usage after a successful call.
   *
   * @param {object} params
   * @param {string} params.userId
   * @param {string} params.planId
   * @param {string} params.provider
   * @param {string} params.model
   * @param {string} [params.projectId]
   * @param {number} params.actualInputTokens
   * @param {number} params.actualOutputTokens
   * @returns {object} { actualCost, sessionSpent, sessionLimit }
   */
  recordUsage({ userId, planId, provider, model, projectId = null, actualInputTokens, actualOutputTokens }) {
    const actualCost = this.estimateCost({ provider, model, estimatedInputTokens: actualInputTokens, estimatedOutputTokens: actualOutputTokens });

    // Update session
    const session = this._getSession(userId, planId);
    session.spent += actualCost;
    session.calls += 1;

    // Record to ledger
    this._ledger.recordBatch([
      { dimension: Dimension.AI_TOKENS_INPUT,   quantity: actualInputTokens,  userId, projectId, provider },
      { dimension: Dimension.AI_TOKENS_OUTPUT,  quantity: actualOutputTokens, userId, projectId, provider },
      { dimension: Dimension.AI_COST_USD,       quantity: actualCost,         userId, projectId, provider, meta: { model } },
    ]);

    if (this._eventBus) {
      this._eventBus.emit('billing:ai:usage_recorded', {
        userId, provider, model, actualInputTokens, actualOutputTokens, actualCost,
      });
    }

    return { actualCost, sessionSpent: session.spent, sessionLimit: this._getSessionLimit(planId) };
  }

  /**
   * Resets the session budget for a user (e.g., on page reload or explicit reset).
   */
  resetSession(userId) {
    this._sessions.delete(userId);
  }

  /**
   * Sets a project-level AI budget cap.
   * @param {string} projectId
   * @param {number} monthlyLimitUSD
   */
  setProjectBudget(projectId, monthlyLimitUSD) {
    this._projectBudgets.set(projectId, monthlyLimitUSD);
  }

  /**
   * Sets a provider-level monthly budget cap for a user.
   * @param {string} userId
   * @param {string} provider
   * @param {number} monthlyLimitUSD
   */
  setProviderBudget(userId, provider, monthlyLimitUSD) {
    this._providerBudgets.set(`${userId}:${provider}`, monthlyLimitUSD);
  }

  /**
   * Returns the current session usage for a user.
   */
  getSessionUsage(userId, planId) {
    const session = this._getSession(userId, planId);
    const limit   = this._getSessionLimit(planId);
    return {
      spent:   session.spent,
      calls:   session.calls,
      limit,
      pct:     limit === Infinity ? 0 : Math.min((session.spent / limit) * 100, 100),
    };
  }

  /**
   * Returns the monthly AI cost for a user from the ledger.
   */
  getMonthlySpend(userId) {
    const { since, until } = require('../ledger/usageLedger').UsageLedger.currentMonthWindow();
    return this._ledger.getAICostUSD(userId, since, until);
  }

  /**
   * Returns the monthly AI cost for a project from the ledger.
   */
  getProjectMonthlySpend(projectId) {
    const { since, until } = require('../ledger/usageLedger').UsageLedger.currentMonthWindow();
    return this._ledger.getProjectAICostUSD(projectId, since, until);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  _getSession(userId, planId) {
    if (!this._sessions.has(userId)) {
      this._sessions.set(userId, { spent: 0, calls: 0, planId });
    }
    return this._sessions.get(userId);
  }

  _getSessionLimit(planId) {
    return this._defaultSessionBudgets[planId]?.limit ?? 1.00;
  }

  _getSessionCallLimit(planId) {
    return this._defaultSessionBudgets[planId]?.maxCalls ?? 50;
  }

  _checkSessionBudget(userId, planId, estimatedCost) {
    const session   = this._getSession(userId, planId);
    const limit     = this._getSessionLimit(planId);
    const callLimit = this._getSessionCallLimit(planId);

    if (limit !== Infinity && session.spent + estimatedCost > limit) {
      return {
        allowed: false,
        reason:  `Session AI budget exceeded ($${session.spent.toFixed(4)} of $${limit.toFixed(2)} used). Start a new session or upgrade your plan.`,
        code:    'SESSION_BUDGET_EXCEEDED',
      };
    }

    if (callLimit !== Infinity && session.calls >= callLimit) {
      return {
        allowed: false,
        reason:  `Session AI call limit reached (${session.calls}/${callLimit} calls). Start a new session or upgrade your plan.`,
        code:    'SESSION_CALL_LIMIT_EXCEEDED',
      };
    }

    return { allowed: true };
  }

  _checkProjectBudget(projectId, estimatedCost) {
    const limit = this._projectBudgets.get(projectId);
    if (limit === undefined) return { allowed: true };

    const { since, until } = require('../ledger/usageLedger').UsageLedger.currentMonthWindow();
    const spent = this._ledger.getProjectAICostUSD(projectId, since, until);

    if (spent + estimatedCost > limit) {
      return {
        allowed: false,
        reason:  `Project AI budget exceeded ($${spent.toFixed(4)} of $${limit.toFixed(2)} used this month).`,
        code:    'PROJECT_BUDGET_EXCEEDED',
      };
    }

    return { allowed: true };
  }

  _checkProviderBudget(userId, provider, estimatedCost) {
    const key   = `${userId}:${provider}`;
    const limit = this._providerBudgets.get(key);
    if (limit === undefined) return { allowed: true };

    const { since, until } = require('../ledger/usageLedger').UsageLedger.currentMonthWindow();
    const spent = this._ledger.aggregate({ dimension: Dimension.AI_COST_USD, userId, provider, since, until });

    if (spent + estimatedCost > limit) {
      return {
        allowed: false,
        reason:  `Monthly budget for provider "${provider}" exceeded ($${spent.toFixed(4)} of $${limit.toFixed(2)} used).`,
        code:    'PROVIDER_BUDGET_EXCEEDED',
      };
    }

    return { allowed: true };
  }

  _getPricing(provider, model) {
    const providerPricing = this._pricing[provider];
    if (!providerPricing) return { inputPer1k: 0.005, outputPer1k: 0.015 }; // Safe default
    return providerPricing[model] || providerPricing['*'] || { inputPer1k: 0.005, outputPer1k: 0.015 };
  }
}

module.exports = { AICostGovernance, PROVIDER_PRICING };
