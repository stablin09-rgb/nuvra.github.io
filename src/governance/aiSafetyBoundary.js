/**
 * aiSafetyBoundary.js — Nuvra Phase 6
 *
 * AI Safety Boundaries — where Nuvra surpasses competitors.
 *
 * AI is sandboxed by:
 *  1. SCOPE    — project, page, schema, capability
 *  2. PERMISSIONS — read-only vs write, planning-only vs generation
 *  3. RATE & COST — hard caps, soft warnings, session budgets
 *
 * Every AI operation must pass through this boundary before execution.
 * The boundary is the single enforcement point — no AI call bypasses it.
 *
 * Zero-trust: AI never trusts user input.
 *             Client never trusts AI output.
 *
 * @module governance/aiSafetyBoundary
 */
'use strict';

// ─── AI Capability Levels ─────────────────────────────────────────────────────
export const AICapability = Object.freeze({
  READ_ONLY:        'read_only',        // Can read schemas, cannot modify
  PLANNING_ONLY:    'planning_only',    // Can plan (IntentSchema, SystemPlan), cannot write schemas
  GENERATION:       'generation',       // Can generate full AppSchema
  REGENERATION:     'regeneration',     // Can regenerate specific parts of existing schemas
  MUTATION:         'mutation',         // Can mutate live app data (highest privilege)
});

// ─── Capability Rank ──────────────────────────────────────────────────────────
const CAPABILITY_RANK = {
  [AICapability.READ_ONLY]:     1,
  [AICapability.PLANNING_ONLY]: 2,
  [AICapability.GENERATION]:    3,
  [AICapability.REGENERATION]:  4,
  [AICapability.MUTATION]:      5,
};

// ─── AI Scope ─────────────────────────────────────────────────────────────────
export const AIScope = Object.freeze({
  GLOBAL:   'global',   // Unrestricted (owner only)
  PROJECT:  'project',  // Scoped to a specific project
  PAGE:     'page',     // Scoped to a specific page
  SCHEMA:   'schema',   // Scoped to a specific schema type
  SECTION:  'section',  // Scoped to a specific section
});

// ─── Default Limits ───────────────────────────────────────────────────────────
const DEFAULT_LIMITS = {
  // Per-operation limits
  maxTokensPerCall:   8_000,    // HARD
  maxCostPerCall:     0.10,     // SOFT (USD)

  // Session limits
  maxTokensPerSession:  200_000, // SOFT
  maxCostPerSession:    5.00,    // HARD (USD)
  maxCallsPerSession:   100,     // SOFT

  // Project limits
  maxCallsPerProject:   500,     // SOFT (per day)
  maxTokensPerProject:  1_000_000, // SOFT (per day)
};

// ─── Boundary Decision ────────────────────────────────────────────────────────
function allow(reason)  { return { allowed: true,  reason, blocked: false }; }
function block(reason, code) { return { allowed: false, reason, blocked: true, code: code || 'ai/blocked' }; }
function warn(reason)   { return { allowed: true,  reason, warning: true }; }

export class AISafetyBoundary {
  /**
   * @param {object} params
   * @param {object}           params.store
   * @param {object}           params.eventBus
   * @param {OwnershipManager} params.ownershipManager
   * @param {function}         params.getCurrentUserId
   * @param {object}           [params.limits] - Override default limits
   */
  constructor({ store, eventBus, ownershipManager, getCurrentUserId, limits }) {
    this._store            = store;
    this._eventBus         = eventBus;
    this._ownershipManager = ownershipManager;
    this._getCurrentUserId = getCurrentUserId;
    this._limits           = { ...DEFAULT_LIMITS, ...(limits || {}) };
    this._sessionUsage     = { tokens: 0, cost: 0, calls: 0, startedAt: Date.now() };
    this._projectUsage     = {};  // projectId → { tokens, cost, calls, date }
    this._decisionLog      = [];  // All boundary decisions
  }

  // ── Primary Enforcement Gate ──────────────────────────────────────────────────

  /**
   * Check whether an AI operation is permitted.
   * This is the SINGLE enforcement point — all AI calls must pass through here.
   *
   * @param {object} request
   * @param {string}   request.projectId
   * @param {string}   request.capability   - AICapability
   * @param {string}   request.scope        - AIScope
   * @param {string}   [request.pageId]
   * @param {string}   [request.schemaType]
   * @param {number}   [request.estimatedTokens]
   * @param {number}   [request.estimatedCost]
   * @returns {{ allowed: boolean, reason: string, warning?: boolean, code?: string }}
   */
  checkPermission(request) {
    const { projectId, capability, estimatedTokens = 0, estimatedCost = 0 } = request;
    const userId = this._getCurrentUserId();

    // ── 1. Authentication check ───────────────────────────────────────────────
    if (!userId) {
      return this._log(request, block('User is not authenticated', 'ai/not_authenticated'));
    }

    // ── 2. Project ownership check ────────────────────────────────────────────
    if (projectId) {
      const canRead = this._ownershipManager.canPerform(projectId, 'read');
      if (!canRead) {
        return this._log(request, block('User does not have access to this project', 'ai/project_access_denied'));
      }

      // Write operations require edit permission
      if (CAPABILITY_RANK[capability] >= CAPABILITY_RANK[AICapability.GENERATION]) {
        const canEdit = this._ownershipManager.canPerform(projectId, 'edit');
        if (!canEdit) {
          return this._log(request, block('User does not have edit permission for AI generation', 'ai/edit_permission_required'));
        }
      }

      // Mutation requires admin permission
      if (capability === AICapability.MUTATION) {
        const canAdmin = this._ownershipManager.canPerform(projectId, 'admin');
        if (!canAdmin) {
          return this._log(request, block('AI mutation requires admin permission', 'ai/admin_permission_required'));
        }
      }
    }

    // ── 3. Hard token limit ───────────────────────────────────────────────────
    if (estimatedTokens > this._limits.maxTokensPerCall) {
      return this._log(request, block(
        `Request exceeds hard token limit: ${estimatedTokens} > ${this._limits.maxTokensPerCall}`,
        'ai/token_limit_exceeded'
      ));
    }

    // ── 4. Hard session cost limit ────────────────────────────────────────────
    if (this._sessionUsage.cost + estimatedCost > this._limits.maxCostPerSession) {
      return this._log(request, block(
        `Session cost limit exceeded: $${(this._sessionUsage.cost + estimatedCost).toFixed(4)} > $${this._limits.maxCostPerSession}`,
        'ai/session_cost_limit_exceeded'
      ));
    }

    // ── 5. Soft session token warning ─────────────────────────────────────────
    if (this._sessionUsage.tokens + estimatedTokens > this._limits.maxTokensPerSession) {
      return this._log(request, warn(
        `Session token soft limit approaching: ${this._sessionUsage.tokens + estimatedTokens} tokens`
      ));
    }

    // ── 6. Soft session call count warning ────────────────────────────────────
    if (this._sessionUsage.calls >= this._limits.maxCallsPerSession) {
      return this._log(request, warn(
        `Session call count soft limit reached: ${this._sessionUsage.calls} calls`
      ));
    }

    // ── 7. Project daily limits ───────────────────────────────────────────────
    if (projectId) {
      const projectUsage = this._getProjectUsage(projectId);
      if (projectUsage.calls >= this._limits.maxCallsPerProject) {
        return this._log(request, warn(
          `Project daily AI call limit reached: ${projectUsage.calls} calls`
        ));
      }
    }

    return this._log(request, allow('All safety checks passed'));
  }

  /**
   * Record the actual usage after an AI call completes.
   * @param {string} projectId
   * @param {number} tokensUsed
   * @param {number} costUsd
   */
  recordUsage(projectId, tokensUsed, costUsd) {
    this._sessionUsage.tokens += tokensUsed;
    this._sessionUsage.cost   += costUsd;
    this._sessionUsage.calls  += 1;

    if (projectId) {
      const usage = this._getProjectUsage(projectId);
      usage.tokens += tokensUsed;
      usage.cost   += costUsd;
      usage.calls  += 1;
      this._projectUsage[projectId] = usage;
    }

    this._store.dispatch({
      type: 'AI_USAGE_RECORDED',
      payload: { projectId, tokensUsed, costUsd, sessionUsage: { ...this._sessionUsage } },
    });

    this._eventBus.emit('ai:usage_recorded', { projectId, tokensUsed, costUsd });
  }

  // ── Scope Enforcement ─────────────────────────────────────────────────────────

  /**
   * Validate that an AI operation is within its declared scope.
   * Prevents cross-project contamination.
   *
   * @param {object} operation
   * @param {string} operation.projectId
   * @param {string} operation.scope
   * @param {string} [operation.pageId]
   * @param {string} [operation.schemaType]
   * @param {object} outputSchema - The AI's output schema
   * @returns {{ valid: boolean, violations: string[] }}
   */
  validateScope(operation, outputSchema) {
    const violations = [];

    // Check that the output schema's projectId matches the operation's projectId
    if (outputSchema._projectId && outputSchema._projectId !== operation.projectId) {
      violations.push(`Schema projectId mismatch: expected ${operation.projectId}, got ${outputSchema._projectId}`);
    }

    // Page-scoped operations must not modify other pages
    if (operation.scope === AIScope.PAGE && operation.pageId) {
      if (outputSchema.pages) {
        const modifiedPages = outputSchema.pages.filter(p => p.id !== operation.pageId);
        if (modifiedPages.length > 0) {
          violations.push(`Page-scoped AI operation modified pages outside its scope: ${modifiedPages.map(p => p.id).join(', ')}`);
        }
      }
    }

    // Schema-scoped operations must not modify other schema types
    if (operation.scope === AIScope.SCHEMA && operation.schemaType) {
      if (outputSchema._schemaType && outputSchema._schemaType !== operation.schemaType) {
        violations.push(`Schema-scoped AI operation produced wrong schema type: expected ${operation.schemaType}, got ${outputSchema._schemaType}`);
      }
    }

    if (violations.length > 0) {
      this._eventBus.emit('ai:scope_violation', { operation, violations });
    }

    return { valid: violations.length === 0, violations };
  }

  // ── Usage Queries ─────────────────────────────────────────────────────────────

  getSessionUsage() {
    return { ...this._sessionUsage };
  }

  getProjectUsage(projectId) {
    return { ...this._getProjectUsage(projectId) };
  }

  resetSessionUsage() {
    this._sessionUsage = { tokens: 0, cost: 0, calls: 0, startedAt: Date.now() };
    this._eventBus.emit('ai:session_reset', {});
  }

  getDecisionLog(limit = 100) {
    return this._decisionLog.slice(-limit);
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  _log(request, decision) {
    const entry = {
      id:         _generateId('dec'),
      timestamp:  Date.now(),
      request:    { projectId: request.projectId, capability: request.capability, scope: request.scope },
      decision,
    };
    this._decisionLog.push(entry);

    if (!decision.allowed) {
      this._eventBus.emit('ai:blocked', { request, reason: decision.reason, code: decision.code });
    } else if (decision.warning) {
      this._eventBus.emit('ai:warning', { request, reason: decision.reason });
    }

    return decision;
  }

  _getProjectUsage(projectId) {
    const today = new Date().toDateString();
    const existing = this._projectUsage[projectId];

    if (!existing || existing.date !== today) {
      this._projectUsage[projectId] = { tokens: 0, cost: 0, calls: 0, date: today };
    }

    return this._projectUsage[projectId];
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _generateId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
