/**
 * Nuvra Runtime Kernel — executionContext.js (Phase 16)
 *
 * Every execution in Nuvra runs inside a structured ExecutionContext.
 * Nothing executes without context.
 *
 * The context captures:
 *  - WHO is executing (actor, actorId)
 *  - WHAT they intend to do (intent)
 *  - WHAT they are allowed to do (permissions)
 *  - WHICH compliance profiles apply (compliance)
 *  - WHERE execution happens (environment, jurisdiction)
 *  - HOW risky the operation is (riskLevel)
 *
 * @module runtime/executionContext
 */
'use strict';

// ─── Actor Types ──────────────────────────────────────────────────────────────
export const ACTOR = Object.freeze({
  USER:    'user',
  AGENT:   'agent',
  SYSTEM:  'system',
  PLUGIN:  'plugin',
  WEBHOOK: 'webhook',
});

// ─── Intent Types ─────────────────────────────────────────────────────────────
export const INTENT = Object.freeze({
  BUILD:    'build',      // Create pages, components, data models
  GENERATE: 'generate',  // AI generation (pages, apps, sites)
  DEPLOY:   'deploy',    // Publish / deploy to hosting
  MODIFY:   'modify',    // Edit existing content or config
  ACCESS:   'access',    // Read-only data access
  ADMIN:    'admin',     // Administrative operations
  ANALYZE:  'analyze',   // Read + analyze (compliance, audit)
  EXECUTE:  'execute',   // Run agent plans
});

// ─── Environment Types ────────────────────────────────────────────────────────
export const ENVIRONMENT = Object.freeze({
  DEV:     'dev',
  PREVIEW: 'preview',
  PROD:    'prod',
  TEST:    'test',
});

// ─── Risk Levels ──────────────────────────────────────────────────────────────
export const RISK_LEVEL = Object.freeze({
  LOW:    'low',
  MEDIUM: 'medium',
  HIGH:   'high',
});

// ─── Context ID Generator ─────────────────────────────────────────────────────
function _generateContextId() {
  const ts  = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `ctx-${ts}-${rnd}`;
}

// ─── ExecutionContext Class ───────────────────────────────────────────────────
export class ExecutionContext {
  /**
   * @param {object} params
   * @param {string}   params.actor        - ACTOR constant
   * @param {string}   params.actorId      - Unique ID of the actor
   * @param {string}   params.intent       - INTENT constant
   * @param {string[]} params.permissions  - Declared permissions for this execution
   * @param {string[]} params.compliance   - Active compliance profiles (e.g., ['gdpr', 'hipaa'])
   * @param {string}   params.environment  - ENVIRONMENT constant
   * @param {string}   params.jurisdiction - Jurisdiction code (e.g., 'eu', 'us', 'global')
   * @param {string}   params.riskLevel    - RISK_LEVEL constant
   * @param {string}   [params.projectId]  - Active project ID
   * @param {string}   [params.orgId]      - Active org ID
   * @param {object}   [params.meta]       - Additional metadata
   */
  constructor(params) {
    this.id           = _generateContextId();
    this.createdAt    = Date.now();
    this.actor        = params.actor        || ACTOR.SYSTEM;
    this.actorId      = params.actorId      || 'anonymous';
    this.intent       = params.intent       || INTENT.ACCESS;
    this.permissions  = Array.isArray(params.permissions) ? [...params.permissions] : [];
    this.compliance   = Array.isArray(params.compliance)  ? [...params.compliance]  : [];
    this.environment  = params.environment  || ENVIRONMENT.DEV;
    this.jurisdiction = params.jurisdiction || 'global';
    this.riskLevel    = params.riskLevel    || RISK_LEVEL.LOW;
    this.projectId    = params.projectId    || null;
    this.orgId        = params.orgId        || null;
    this.meta         = params.meta         || {};
    this.isolationMode = null; // Set by IsolationManager after context creation
    this._log         = [];   // Internal execution log
  }

  // ── Permission Checks ──────────────────────────────────────────────────────
  hasPermission(permission) {
    return this.permissions.includes(permission) || this.permissions.includes('*');
  }

  requiresCompliance(framework) {
    return this.compliance.includes(framework);
  }

  isHighRisk() {
    return this.riskLevel === RISK_LEVEL.HIGH;
  }

  isProduction() {
    return this.environment === ENVIRONMENT.PROD;
  }

  isAgent() {
    return this.actor === ACTOR.AGENT;
  }

  isPlugin() {
    return this.actor === ACTOR.PLUGIN;
  }

  // ── Isolation Mode ─────────────────────────────────────────────────────────
  setIsolationMode(mode) {
    this.isolationMode = mode;
  }

  // ── Internal Logging ───────────────────────────────────────────────────────
  log(message, data = {}) {
    this._log.push({ timestamp: Date.now(), message, data });
  }

  getLogs() {
    return [...this._log];
  }

  // ── Serialization ──────────────────────────────────────────────────────────
  toJSON() {
    return {
      id:           this.id,
      createdAt:    this.createdAt,
      actor:        this.actor,
      actorId:      this.actorId,
      intent:       this.intent,
      permissions:  this.permissions,
      compliance:   this.compliance,
      environment:  this.environment,
      jurisdiction: this.jurisdiction,
      riskLevel:    this.riskLevel,
      projectId:    this.projectId,
      orgId:        this.orgId,
      isolationMode: this.isolationMode,
      meta:         this.meta,
    };
  }

  /**
   * Create an ExecutionContext from a plain object (e.g., from audit log replay).
   * @param {object} json
   * @returns {ExecutionContext}
   */
  static fromJSON(json) {
    const ctx = new ExecutionContext(json);
    ctx.id        = json.id        || ctx.id;
    ctx.createdAt = json.createdAt || ctx.createdAt;
    ctx.isolationMode = json.isolationMode || null;
    return ctx;
  }

  /**
   * Build a minimal system-level context for internal platform operations.
   */
  static system(intent, projectId = null) {
    return new ExecutionContext({
      actor:       ACTOR.SYSTEM,
      actorId:     'nuvra-system',
      intent,
      permissions: ['*'],
      environment: ENVIRONMENT.PROD,
      riskLevel:   RISK_LEVEL.LOW,
      projectId,
    });
  }

  /**
   * Build a user context from the current auth session.
   * @param {object} session - Auth session object
   * @param {string} intent  - INTENT constant
   * @param {object} [opts]  - Additional context options
   */
  static fromSession(session, intent, opts = {}) {
    return new ExecutionContext({
      actor:       ACTOR.USER,
      actorId:     session?.user?.id || 'anonymous',
      intent,
      permissions: session?.permissions || [],
      compliance:  opts.compliance  || [],
      environment: opts.environment || ENVIRONMENT.PROD,
      jurisdiction: opts.jurisdiction || 'global',
      riskLevel:   opts.riskLevel   || RISK_LEVEL.MEDIUM,
      projectId:   opts.projectId   || null,
      orgId:       opts.orgId       || null,
      meta:        opts.meta        || {},
    });
  }

  /**
   * Build an agent context.
   * @param {string} agentId   - The agent's unique ID
   * @param {string} agentType - The agent type (e.g., 'builder', 'planner')
   * @param {string} intent    - INTENT constant
   * @param {object} [opts]    - Additional context options
   */
  static forAgent(agentId, agentType, intent, opts = {}) {
    return new ExecutionContext({
      actor:       ACTOR.AGENT,
      actorId:     agentId,
      intent,
      permissions: opts.permissions || [],
      compliance:  opts.compliance  || [],
      environment: opts.environment || ENVIRONMENT.PROD,
      jurisdiction: opts.jurisdiction || 'global',
      riskLevel:   RISK_LEVEL.HIGH, // Agents are always high-risk
      projectId:   opts.projectId   || null,
      orgId:       opts.orgId       || null,
      meta:        { agentType, ...opts.meta },
    });
  }
}

export default ExecutionContext;
