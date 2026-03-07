/**
 * Nuvra Runtime Kernel (NRK) — kernel.js (Phase 16)
 *
 * The single execution authority for the entire Nuvra platform.
 * No component executes outside the kernel.
 *
 * The kernel provides:
 *  - A deterministic execution pipeline with explicit lifecycle hooks
 *  - Observable state via an event bus
 *  - Policy enforcement at every execution boundary
 *  - Structured execution contexts for every actor
 *  - Isolation mode selection based on risk profile
 *
 * Architecture:
 *
 *   Caller → kernel.execute(request) → ExecutionContext
 *     → Pre-flight checks (auth, policy, compliance, budget)
 *     → Isolation selection
 *     → Execution
 *     → Post-flight (audit, evidence, metrics)
 *     → Result
 *
 * @module runtime/kernel
 */
'use strict';

import { ExecutionContext, ACTOR, INTENT, ENVIRONMENT, RISK_LEVEL } from './executionContext.js';
import { IsolationManager, ISOLATION_MODE } from './isolationManager.js';

// ─── Kernel States ────────────────────────────────────────────────────────────
export const KERNEL_STATE = Object.freeze({
  BOOTING:   'booting',
  READY:     'ready',
  EXECUTING: 'executing',
  DEGRADED:  'degraded',  // Running but with reduced capabilities
  LOCKED:    'locked',    // Locked by compliance or security event
  SHUTDOWN:  'shutdown',
});

// ─── Execution Result ─────────────────────────────────────────────────────────
/**
 * @typedef {object} ExecutionResult
 * @property {boolean}  success       - Whether execution completed without error
 * @property {any}      value         - The return value of the executed function
 * @property {string}   contextId     - The ID of the execution context used
 * @property {number}   durationMs    - Wall-clock execution time
 * @property {string}   isolationMode - The isolation mode that was applied
 * @property {object}   [error]       - Error details if success is false
 * @property {object}   [gatekeeperDecision] - The AI Gatekeeper's decision (if applicable)
 * @property {string[]} [policyViolations]   - Any policy violations detected
 */

// ─── Kernel Configuration ─────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  maxConcurrentExecutions: 10,
  defaultTimeoutMs:        30_000,
  enableAIGatekeeper:      true,
  enableComplianceChecks:  true,
  enableEvidenceVault:     true,
  enableThreatModeling:    false, // Off by default for performance; on for enterprise
  strictMode:              false, // If true, blocks on any policy warning (not just violations)
};

// ─── Internal State ───────────────────────────────────────────────────────────
let _state              = KERNEL_STATE.BOOTING;
let _config             = { ...DEFAULT_CONFIG };
let _activeExecutions   = new Map();   // contextId → ExecutionContext
let _executionCount     = 0;
let _listeners          = [];          // Event bus listeners
let _hooks              = {};          // Lifecycle hooks: pre-flight, post-flight, error
let _services           = {};          // Injected services: gatekeeper, compliance, vault, etc.
const _isolationManager = new IsolationManager();

// ─── Kernel Initialization ────────────────────────────────────────────────────
/**
 * Boot the kernel with the platform's service registry.
 * Must be called once before any execution.
 *
 * @param {object} services - Platform services to inject
 * @param {object} [config]  - Optional config overrides
 */
export async function boot(services = {}, config = {}) {
  if (_state !== KERNEL_STATE.BOOTING && _state !== KERNEL_STATE.SHUTDOWN) {
    console.warn('[NRK] Kernel already booted. Call shutdown() first.');
    return;
  }

  _state   = KERNEL_STATE.BOOTING;
  _config  = { ...DEFAULT_CONFIG, ...config };
  _services = {
    gatekeeper:        services.gatekeeper        || null,
    complianceEngine:  services.complianceEngine  || null,
    evidenceVault:     services.evidenceVault      || null,
    auditLogger:       services.auditLogger        || null,
    policyEngine:      services.policyEngine       || null,
    threatModeler:     services.threatModeler      || null,
    permissionModel:   services.permissionModel    || null,
    billingManager:    services.billingManager     || null,
  };

  await _isolationManager.init(_config);

  _state = KERNEL_STATE.READY;
  _emit('kernel:ready', { config: _config });
  console.info('[NRK] Nuvra Runtime Kernel ready.');
}

// ─── Primary Execution Entry Point ────────────────────────────────────────────
/**
 * Execute a function within a governed, isolated, audited context.
 *
 * @param {object}   request
 * @param {Function} request.fn           - The function to execute
 * @param {string}   request.actor        - ACTOR constant
 * @param {string}   request.intent       - INTENT constant
 * @param {string}   [request.actorId]    - User/agent ID
 * @param {string[]} [request.permissions] - Required permissions
 * @param {string[]} [request.compliance] - Required compliance profiles
 * @param {string}   [request.environment] - ENVIRONMENT constant
 * @param {string}   [request.jurisdiction] - Jurisdiction code (e.g., 'eu', 'us')
 * @param {string}   [request.riskLevel]  - RISK_LEVEL constant (auto-computed if omitted)
 * @param {string}   [request.projectId]  - Active project ID
 * @param {string}   [request.orgId]      - Active org ID
 * @param {number}   [request.timeoutMs]  - Execution timeout override
 * @param {object}   [request.meta]       - Additional metadata for audit
 * @returns {Promise<ExecutionResult>}
 */
export async function execute(request) {
  if (_state === KERNEL_STATE.LOCKED) {
    return _buildErrorResult('KERNEL_LOCKED', 'The kernel is locked due to a compliance or security event. Contact your administrator.');
  }
  if (_state !== KERNEL_STATE.READY && _state !== KERNEL_STATE.EXECUTING) {
    return _buildErrorResult('KERNEL_NOT_READY', `Kernel is in state: ${_state}`);
  }
  if (_activeExecutions.size >= _config.maxConcurrentExecutions) {
    return _buildErrorResult('CONCURRENCY_LIMIT', 'Maximum concurrent executions reached.');
  }

  const startTime = Date.now();
  const ctx = new ExecutionContext({
    actor:       request.actor       || ACTOR.SYSTEM,
    actorId:     request.actorId     || 'anonymous',
    intent:      request.intent      || INTENT.ACCESS,
    permissions: request.permissions || [],
    compliance:  request.compliance  || [],
    environment: request.environment || ENVIRONMENT.DEV,
    jurisdiction: request.jurisdiction || 'global',
    riskLevel:   request.riskLevel   || _computeRiskLevel(request),
    projectId:   request.projectId   || null,
    orgId:       request.orgId       || null,
    meta:        request.meta        || {},
  });

  _activeExecutions.set(ctx.id, ctx);
  _state = KERNEL_STATE.EXECUTING;
  _emit('execution:start', { contextId: ctx.id, intent: ctx.intent, actor: ctx.actor });

  try {
    // ── 1. Pre-flight checks ────────────────────────────────────────────────
    const preflightResult = await _runPreflight(ctx, request);
    if (!preflightResult.allowed) {
      _activeExecutions.delete(ctx.id);
      _state = KERNEL_STATE.READY;
      const result = _buildBlockedResult(ctx, preflightResult, startTime);
      _emit('execution:blocked', { contextId: ctx.id, reason: preflightResult.reason });
      await _recordEvidence(ctx, result, 'blocked');
      return result;
    }

    // ── 2. Select isolation mode ────────────────────────────────────────────
    const isolationMode = _isolationManager.selectMode(ctx);
    ctx.setIsolationMode(isolationMode);

    // ── 3. Execute the function ─────────────────────────────────────────────
    const timeoutMs = request.timeoutMs || _config.defaultTimeoutMs;
    const value = await _executeWithTimeout(request.fn, ctx, timeoutMs);

    // ── 4. Post-flight ──────────────────────────────────────────────────────
    const result = {
      success:      true,
      value,
      contextId:    ctx.id,
      durationMs:   Date.now() - startTime,
      isolationMode,
      gatekeeperDecision: preflightResult.gatekeeperDecision || null,
    };

    _emit('execution:complete', { contextId: ctx.id, durationMs: result.durationMs });
    await _recordEvidence(ctx, result, 'success');
    await _auditLog(ctx, result);

    return result;

  } catch (err) {
    const result = {
      success:    false,
      value:      null,
      contextId:  ctx.id,
      durationMs: Date.now() - startTime,
      isolationMode: ctx.isolationMode || ISOLATION_MODE.SOFT,
      error:      { message: err.message, stack: err.stack },
    };
    _emit('execution:error', { contextId: ctx.id, error: err.message });
    await _recordEvidence(ctx, result, 'error');
    await _auditLog(ctx, result);
    return result;

  } finally {
    _activeExecutions.delete(ctx.id);
    if (_activeExecutions.size === 0) _state = KERNEL_STATE.READY;
  }
}

// ─── Pre-flight Checks ────────────────────────────────────────────────────────
async function _runPreflight(ctx, request) {
  const checks = [];

  // 1. Permission check
  if (_services.permissionModel) {
    const permResult = await _services.permissionModel.check(ctx).catch(() => ({ allowed: true }));
    if (!permResult.allowed) {
      return { allowed: false, reason: permResult.reason || 'Permission denied.', stage: 'permission' };
    }
    checks.push({ stage: 'permission', passed: true });
  }

  // 2. Policy check
  if (_services.policyEngine && ctx.orgId) {
    const policyResult = await _services.policyEngine.evaluate(ctx.intent, {
      actor:   ctx.actorId,
      orgId:   ctx.orgId,
      context: ctx.toJSON(),
    }).catch(() => ({ allowed: true }));
    if (!policyResult.allowed) {
      return { allowed: false, reason: policyResult.reason || 'Policy violation.', stage: 'policy', appliedPolicy: policyResult.appliedPolicy };
    }
    checks.push({ stage: 'policy', passed: true });
  }

  // 3. AI Gatekeeper (for AI intents)
  let gatekeeperDecision = null;
  if (_config.enableAIGatekeeper && _services.gatekeeper && _isAIIntent(ctx.intent)) {
    gatekeeperDecision = await _services.gatekeeper.evaluate(ctx, request.meta || {}).catch(() => ({ decision: 'allow' }));
    if (gatekeeperDecision.decision === 'block') {
      return { allowed: false, reason: gatekeeperDecision.reason, stage: 'ai_gatekeeper', gatekeeperDecision };
    }
    if (gatekeeperDecision.decision === 'require_approval') {
      return { allowed: false, reason: 'This action requires human approval.', stage: 'ai_gatekeeper', requiresApproval: true, gatekeeperDecision };
    }
    checks.push({ stage: 'ai_gatekeeper', passed: true, decision: gatekeeperDecision.decision });
  }

  // 4. Billing / budget check
  if (_services.billingManager && _isAIIntent(ctx.intent)) {
    const billingResult = await _services.billingManager.check('ai.generations', 1).catch(() => ({ allowed: true }));
    if (!billingResult.allowed) {
      return { allowed: false, reason: 'AI usage limit reached. Please upgrade your plan.', stage: 'billing' };
    }
    checks.push({ stage: 'billing', passed: true });
  }

  // 5. Compliance check (for high-risk intents)
  if (_config.enableComplianceChecks && _services.complianceEngine && ctx.riskLevel === RISK_LEVEL.HIGH) {
    const compResult = await _services.complianceEngine.checkIntent(ctx.intent, ctx).catch(() => ({ compliant: true }));
    if (!compResult.compliant && _config.strictMode) {
      return { allowed: false, reason: 'Compliance check failed.', stage: 'compliance', violations: compResult.violations };
    }
    checks.push({ stage: 'compliance', passed: compResult.compliant });
  }

  return { allowed: true, checks, gatekeeperDecision };
}

// ─── Execute with Timeout ─────────────────────────────────────────────────────
function _executeWithTimeout(fn, ctx, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Execution timed out after ${timeoutMs}ms`)), timeoutMs);
    Promise.resolve(fn(ctx))
      .then(value => { clearTimeout(timer); resolve(value); })
      .catch(err  => { clearTimeout(timer); reject(err);   });
  });
}

// ─── Evidence Recording ───────────────────────────────────────────────────────
async function _recordEvidence(ctx, result, outcome) {
  if (!_config.enableEvidenceVault || !_services.evidenceVault) return;
  try {
    await _services.evidenceVault.record({
      contextId:    ctx.id,
      actor:        ctx.actor,
      actorId:      ctx.actorId,
      intent:       ctx.intent,
      environment:  ctx.environment,
      riskLevel:    ctx.riskLevel,
      isolationMode: ctx.isolationMode,
      projectId:    ctx.projectId,
      orgId:        ctx.orgId,
      outcome,
      durationMs:   result.durationMs,
      timestamp:    Date.now(),
      meta:         ctx.meta,
    });
  } catch (e) {
    console.warn('[NRK] Evidence vault recording failed:', e.message);
  }
}

// ─── Audit Logging ────────────────────────────────────────────────────────────
async function _auditLog(ctx, result) {
  if (!_services.auditLogger) return;
  try {
    await _services.auditLogger.log({
      action:   `kernel.execute.${ctx.intent}`,
      actor:    ctx.actorId,
      resource: ctx.projectId ? `project:${ctx.projectId}` : 'platform',
      severity: result.success ? 'info' : 'error',
      meta:     {
        contextId:    ctx.id,
        durationMs:   result.durationMs,
        isolationMode: ctx.isolationMode,
        riskLevel:    ctx.riskLevel,
        error:        result.error?.message,
      },
    });
  } catch (e) {
    console.warn('[NRK] Audit log failed:', e.message);
  }
}

// ─── Risk Level Computation ───────────────────────────────────────────────────
function _computeRiskLevel(request) {
  const highRiskIntents = [INTENT.DEPLOY, INTENT.MODIFY, INTENT.GENERATE];
  const medRiskIntents  = [INTENT.BUILD, INTENT.ACCESS];
  if (highRiskIntents.includes(request.intent)) return RISK_LEVEL.HIGH;
  if (medRiskIntents.includes(request.intent))  return RISK_LEVEL.MEDIUM;
  return RISK_LEVEL.LOW;
}

function _isAIIntent(intent) {
  return intent === INTENT.GENERATE || intent === INTENT.BUILD;
}

// ─── Kernel Control ───────────────────────────────────────────────────────────
/**
 * Lock the kernel. No new executions will be accepted.
 * Used by compliance or security events.
 */
export function lock(reason = 'Manual lock') {
  _state = KERNEL_STATE.LOCKED;
  _emit('kernel:locked', { reason });
  console.warn('[NRK] Kernel locked:', reason);
}

export function unlock() {
  if (_state === KERNEL_STATE.LOCKED) {
    _state = KERNEL_STATE.READY;
    _emit('kernel:unlocked', {});
    console.info('[NRK] Kernel unlocked.');
  }
}

export function shutdown() {
  _state = KERNEL_STATE.SHUTDOWN;
  _activeExecutions.clear();
  _emit('kernel:shutdown', {});
}

// ─── Status & Observability ───────────────────────────────────────────────────
export function getStatus() {
  return {
    state:              _state,
    activeExecutions:   _activeExecutions.size,
    totalExecutions:    _executionCount,
    config:             { ..._config },
    isolationModes:     _isolationManager.getAvailableModes(),
  };
}

export function getActiveContexts() {
  return Array.from(_activeExecutions.values()).map(ctx => ctx.toJSON());
}

// ─── Event Bus ────────────────────────────────────────────────────────────────
export function on(event, listener) {
  _listeners.push({ event, listener });
  return () => { _listeners = _listeners.filter(l => l.listener !== listener); };
}

function _emit(event, data) {
  _listeners
    .filter(l => l.event === event || l.event === '*')
    .forEach(l => { try { l.listener({ event, data, timestamp: Date.now() }); } catch (_) {} });
}

// ─── Result Builders ──────────────────────────────────────────────────────────
function _buildErrorResult(code, message) {
  return { success: false, value: null, contextId: null, durationMs: 0, isolationMode: null, error: { code, message } };
}

function _buildBlockedResult(ctx, preflightResult, startTime) {
  return {
    success:            false,
    value:              null,
    contextId:          ctx.id,
    durationMs:         Date.now() - startTime,
    isolationMode:      null,
    blocked:            true,
    blockStage:         preflightResult.stage,
    blockReason:        preflightResult.reason,
    requiresApproval:   preflightResult.requiresApproval || false,
    gatekeeperDecision: preflightResult.gatekeeperDecision || null,
    policyViolations:   preflightResult.violations || [],
  };
}

// ─── Singleton export ─────────────────────────────────────────────────────────
export const kernel = { boot, execute, lock, unlock, shutdown, getStatus, getActiveContexts, on };
export default kernel;
