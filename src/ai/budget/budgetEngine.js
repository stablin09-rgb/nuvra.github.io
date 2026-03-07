/**
 * budgetEngine.js — Nuvra Phase 5
 *
 * Prompt Budget & Cost Governance Engine.
 *
 * Tracks tokens per request, cost per provider, applies hard and soft limits,
 * prevents runaway prompts, and reports usage per session.
 *
 * Design principles:
 *  - Hard limits block execution before the call is made
 *  - Soft limits emit warnings but allow the call to proceed
 *  - All limits are configurable per session and per operation type
 *  - Usage is always visible — no hidden costs
 *
 * @module ai/budget/budgetEngine
 */
'use strict';

// ─── Limit Types ──────────────────────────────────────────────────────────────
export const LimitType = Object.freeze({
  HARD: 'hard',  // Blocks the call
  SOFT: 'soft',  // Warns but allows
});

// ─── Budget Scope ─────────────────────────────────────────────────────────────
export const BudgetScope = Object.freeze({
  SESSION:   'session',    // Current editing session
  OPERATION: 'operation',  // Single generation operation
  DAILY:     'daily',      // Per-day (future: persisted)
});

// ─── Default Limits ───────────────────────────────────────────────────────────
const DEFAULT_LIMITS = {
  // Per single operation (one AI call)
  operation: {
    tokens: { type: LimitType.HARD, value: 8_000  },  // Max tokens per call
    cost:   { type: LimitType.SOFT, value: 0.05   },  // $0.05 soft warning
  },
  // Per session (sum of all calls)
  session: {
    tokens: { type: LimitType.SOFT, value: 100_000 }, // 100k tokens soft warning
    cost:   { type: LimitType.HARD, value: 1.00    }, // $1.00 hard stop
    calls:  { type: LimitType.SOFT, value: 50       }, // 50 calls soft warning
  },
};

// ─── BudgetEngine ─────────────────────────────────────────────────────────────
class BudgetEngine {
  constructor() {
    this._limits    = _deepClone(DEFAULT_LIMITS);
    this._session   = _newSession();
    this._history   = [];   // All completed operations
    this._listeners = [];
  }

  // ── Configuration ────────────────────────────────────────────────────────────

  /**
   * Configure budget limits.
   * @param {object} limits - Partial limits object (merged with defaults)
   */
  configure(limits = {}) {
    this._limits = _deepMerge(this._limits, limits);
    this._emit('budget:configured', { limits: this._limits });
  }

  /**
   * Reset the current session (start fresh).
   */
  resetSession() {
    const prev = { ...this._session };
    this._session = _newSession();
    this._emit('budget:session_reset', { prev });
  }

  // ── Pre-call Check ───────────────────────────────────────────────────────────

  /**
   * Check whether a call is allowed given the current budget state.
   * Must be called BEFORE making an AI provider call.
   *
   * @param {object} estimate
   * @param {number}   estimate.inputTokens   - Estimated input tokens
   * @param {number}   estimate.outputTokens  - Estimated max output tokens
   * @param {object}   estimate.provider      - Provider instance (for cost estimation)
   * @param {string}   [estimate.operationType] - e.g., 'intent', 'planning', 'assembly'
   * @returns {{ allowed: boolean, warnings: string[], blocked: string|null }}
   */
  check(estimate) {
    const { inputTokens = 0, outputTokens = 0, provider } = estimate;
    const totalTokens = inputTokens + outputTokens;
    const estimatedCost = provider ? provider.estimateCost({ input: inputTokens, output: outputTokens }) : 0;

    const warnings = [];
    let blocked = null;

    // ── Operation-level checks ──────────────────────────────────────────────
    const opTokenLimit = this._limits.operation?.tokens;
    if (opTokenLimit && totalTokens > opTokenLimit.value) {
      const msg = `Operation token estimate (${totalTokens}) exceeds ${opTokenLimit.type} limit (${opTokenLimit.value})`;
      if (opTokenLimit.type === LimitType.HARD) {
        blocked = msg;
      } else {
        warnings.push(msg);
      }
    }

    const opCostLimit = this._limits.operation?.cost;
    if (opCostLimit && estimatedCost > opCostLimit.value) {
      const msg = `Operation cost estimate ($${estimatedCost.toFixed(4)}) exceeds ${opCostLimit.type} limit ($${opCostLimit.value})`;
      if (opCostLimit.type === LimitType.HARD) {
        blocked = blocked || msg;
      } else {
        warnings.push(msg);
      }
    }

    // ── Session-level checks ────────────────────────────────────────────────
    const sessTokenLimit = this._limits.session?.tokens;
    if (sessTokenLimit) {
      const projected = this._session.totalTokens + totalTokens;
      if (projected > sessTokenLimit.value) {
        const msg = `Session token projection (${projected}) exceeds ${sessTokenLimit.type} limit (${sessTokenLimit.value})`;
        if (sessTokenLimit.type === LimitType.HARD) {
          blocked = blocked || msg;
        } else {
          warnings.push(msg);
        }
      }
    }

    const sessCostLimit = this._limits.session?.cost;
    if (sessCostLimit) {
      const projected = this._session.totalCost + estimatedCost;
      if (projected > sessCostLimit.value) {
        const msg = `Session cost projection ($${projected.toFixed(4)}) exceeds ${sessCostLimit.type} limit ($${sessCostLimit.value})`;
        if (sessCostLimit.type === LimitType.HARD) {
          blocked = blocked || msg;
        } else {
          warnings.push(msg);
        }
      }
    }

    const sessCallLimit = this._limits.session?.calls;
    if (sessCallLimit) {
      const projected = this._session.callCount + 1;
      if (projected > sessCallLimit.value) {
        const msg = `Session call count (${projected}) exceeds ${sessCallLimit.type} limit (${sessCallLimit.value})`;
        if (sessCallLimit.type === LimitType.HARD) {
          blocked = blocked || msg;
        } else {
          warnings.push(msg);
        }
      }
    }

    if (warnings.length > 0) {
      this._emit('budget:warning', { warnings, estimate });
    }
    if (blocked) {
      this._emit('budget:blocked', { reason: blocked, estimate });
    }

    return { allowed: !blocked, warnings, blocked };
  }

  // ── Post-call Recording ──────────────────────────────────────────────────────

  /**
   * Record the result of a completed AI call.
   * Must be called AFTER every successful or failed call.
   *
   * @param {object} record
   * @param {string}   record.operationType - e.g., 'intent', 'planning', 'assembly'
   * @param {string}   record.providerId    - Provider ID
   * @param {object}   record.usage         - { input, output, total }
   * @param {number}   record.cost          - Actual cost in USD
   * @param {boolean}  record.ok            - Whether the call succeeded
   * @param {number}   record.latencyMs     - Round-trip latency
   */
  record(record) {
    const entry = {
      id:            _generateId('op'),
      ts:            Date.now(),
      operationType: record.operationType || 'unknown',
      providerId:    record.providerId    || 'unknown',
      usage:         record.usage         || { input: 0, output: 0, total: 0 },
      cost:          record.cost          || 0,
      ok:            record.ok            !== false,
      latencyMs:     record.latencyMs     || 0,
    };

    this._history.push(entry);

    // Update session totals
    this._session.callCount++;
    this._session.totalTokens += entry.usage.total;
    this._session.totalCost   += entry.cost;
    this._session.lastCallAt   = entry.ts;
    if (!entry.ok) this._session.failedCalls++;

    // Update per-provider breakdown
    const pb = this._session.byProvider[entry.providerId] || _newProviderBreakdown();
    pb.calls++;
    pb.tokens += entry.usage.total;
    pb.cost   += entry.cost;
    if (!entry.ok) pb.errors++;
    this._session.byProvider[entry.providerId] = pb;

    this._emit('budget:recorded', { entry, session: this.getSessionSummary() });
  }

  // ── Reporting ────────────────────────────────────────────────────────────────

  /**
   * Get the current session summary.
   * @returns {object}
   */
  getSessionSummary() {
    return {
      ...this._session,
      limits:    this._limits,
      startedAt: this._session.startedAt,
      duration:  Date.now() - this._session.startedAt,
    };
  }

  /**
   * Get the full call history.
   * @returns {object[]}
   */
  getHistory() {
    return [...this._history];
  }

  /**
   * Get per-operation-type breakdown.
   * @returns {object}
   */
  getBreakdown() {
    const byType = {};
    for (const entry of this._history) {
      const t = entry.operationType;
      if (!byType[t]) byType[t] = { calls: 0, tokens: 0, cost: 0, errors: 0 };
      byType[t].calls++;
      byType[t].tokens += entry.usage.total;
      byType[t].cost   += entry.cost;
      if (!entry.ok) byType[t].errors++;
    }
    return byType;
  }

  // ── Events ───────────────────────────────────────────────────────────────────

  subscribe(listener) {
    this._listeners.push(listener);
    return () => { this._listeners = this._listeners.filter(l => l !== listener); };
  }

  _emit(event, data) {
    for (const l of this._listeners) {
      try { l(event, data); } catch (_) {}
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _newSession() {
  return {
    startedAt:   Date.now(),
    callCount:   0,
    failedCalls: 0,
    totalTokens: 0,
    totalCost:   0,
    lastCallAt:  null,
    byProvider:  {},
  };
}

function _newProviderBreakdown() {
  return { calls: 0, tokens: 0, cost: 0, errors: 0 };
}

function _deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function _deepMerge(target, source) {
  const out = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      out[key] = _deepMerge(target[key] || {}, source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}

function _generateId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const budgetEngine = new BudgetEngine();
export default budgetEngine;
