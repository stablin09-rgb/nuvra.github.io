/**
 * actionTypes.js — Nuvra Phase 3
 *
 * Canonical action step type definitions.
 *
 * An Action is a named, declarative sequence of Steps.
 * Each Step has a type that determines what it does.
 * Steps are executed in order. Each step receives the result
 * of the previous step as its input.
 *
 * Step types:
 *
 *  Data operations:
 *    data.insert    — Insert a record into a collection
 *    data.update    — Update a record in a collection
 *    data.delete    — Delete a record from a collection
 *    data.query     — Query a collection and store results in state
 *
 *  State operations:
 *    state.set      — Set a state value
 *    state.reset    — Reset a state scope to defaults
 *    state.toggle   — Toggle a boolean state value
 *    state.increment — Increment a numeric state value
 *
 *  Navigation:
 *    navigate       — Navigate to a page
 *
 *  Control flow:
 *    condition      — Branch execution based on a condition
 *    validate       — Validate a form or data object, halt on failure
 *    delay          — Wait for N milliseconds
 *
 *  Events:
 *    emit           — Emit an app event
 *
 *  Notifications:
 *    notify         — Show a toast notification
 *
 * No inline JS. No eval. Ever.
 *
 * @module app/actions/actionTypes
 */
'use strict';

// ─── Step Executors ───────────────────────────────────────────────────────────
// Each executor is a pure async function:
//   execute(step, context, prevResult) → { ok, result, error }

export const ACTION_STEP_EXECUTORS = {

  // ── Data Operations ────────────────────────────────────────────────────────
  'data.insert': async (step, ctx, prev) => {
    const collectionId = step.collection;
    const record = _resolveParams(step.record, ctx, prev);
    const result = ctx.insert(collectionId, record);
    if (!result.ok) return { ok: false, error: result.error || 'Insert failed', errors: result.errors };
    return { ok: true, result: result.record };
  },

  'data.update': async (step, ctx, prev) => {
    const collectionId = step.collection;
    const recordId = _resolveValue(step.recordId, ctx, prev);
    const patch = _resolveParams(step.patch, ctx, prev);
    const result = ctx.update(collectionId, recordId, patch);
    if (!result.ok) return { ok: false, error: result.error || 'Update failed', errors: result.errors };
    return { ok: true, result: result.record };
  },

  'data.delete': async (step, ctx, prev) => {
    const collectionId = step.collection;
    const recordId = _resolveValue(step.recordId, ctx, prev);
    const result = ctx.delete(collectionId, recordId);
    if (!result.ok) return { ok: false, error: result.error || 'Delete failed' };
    return { ok: true, result: { recordId } };
  },

  'data.query': async (step, ctx, prev) => {
    const collectionId = step.collection;
    const query = _resolveParams(step.query || {}, ctx, prev);
    const records = ctx.query(collectionId, query);
    // Optionally store results in state
    if (step.storeIn) {
      ctx.setState(step.storeIn, records);
    }
    return { ok: true, result: records };
  },

  // ── State Operations ───────────────────────────────────────────────────────
  'state.set': async (step, ctx, prev) => {
    const path  = step.path;
    const value = _resolveValue(step.value, ctx, prev);
    ctx.setState(path, value);
    return { ok: true, result: { path, value } };
  },

  'state.reset': async (step, ctx, prev) => {
    ctx._state.reset(step.scope || 'page');
    return { ok: true, result: { scope: step.scope } };
  },

  'state.toggle': async (step, ctx, prev) => {
    const current = ctx.getState(step.path);
    ctx.setState(step.path, !current);
    return { ok: true, result: { path: step.path, value: !current } };
  },

  'state.increment': async (step, ctx, prev) => {
    const current = Number(ctx.getState(step.path)) || 0;
    const by = Number(_resolveValue(step.by ?? 1, ctx, prev));
    const next = current + by;
    ctx.setState(step.path, next);
    return { ok: true, result: { path: step.path, value: next } };
  },

  // ── Navigation ─────────────────────────────────────────────────────────────
  'navigate': async (step, ctx, prev) => {
    const pageId = _resolveValue(step.pageId, ctx, prev);
    ctx.emit('runtime:navigate', { pageId });
    return { ok: true, result: { pageId } };
  },

  // ── Control Flow ───────────────────────────────────────────────────────────
  'condition': async (step, ctx, prev) => {
    const conditionMet = _evaluateCondition(step.condition, ctx, prev);
    // Return which branch was taken — the dispatcher handles branching
    return { ok: true, result: { conditionMet }, branch: conditionMet ? 'then' : 'else' };
  },

  'validate': async (step, ctx, prev) => {
    const data = _resolveValue(step.data, ctx, prev);
    const rules = step.rules || {};
    const errors = {};
    let hasErrors = false;

    for (const [field, rule] of Object.entries(rules)) {
      const value = data?.[field];
      if (rule.required && (value === null || value === undefined || value === '')) {
        errors[field] = rule.message || `${field} is required`;
        hasErrors = true;
      }
    }

    if (hasErrors) {
      // Store errors in state if configured
      if (step.errorsPath) ctx.setState(step.errorsPath, errors);
      return { ok: false, error: 'Validation failed', errors };
    }
    return { ok: true, result: data };
  },

  'delay': async (step, ctx, prev) => {
    const ms = Number(step.ms) || 0;
    await new Promise(resolve => setTimeout(resolve, ms));
    return { ok: true, result: prev };
  },

  // ── Events ─────────────────────────────────────────────────────────────────
  'emit': async (step, ctx, prev) => {
    const event = step.event;
    const data  = _resolveParams(step.data || {}, ctx, prev);
    ctx.emit(event, data);
    return { ok: true, result: { event, data } };
  },

  // ── Notifications ──────────────────────────────────────────────────────────
  'notify': async (step, ctx, prev) => {
    const message = _resolveValue(step.message, ctx, prev);
    const type    = step.notificationType || 'info';
    const duration = step.duration || 3000;
    ctx.emit('runtime:notify', { message, type, duration });
    return { ok: true, result: { message, type } };
  },
};

// ─── Value Resolution ─────────────────────────────────────────────────────────
/**
 * Resolve a single value expression.
 * Expressions:
 *   "state:<path>"    → reads from app state
 *   "prev"            → the result of the previous step
 *   "prev.<field>"    → a field from the previous step result
 *   "payload.<field>" → a field from the action payload
 *   anything else     → returned as-is (literal)
 */
function _resolveValue(expr, ctx, prev) {
  if (typeof expr !== 'string') return expr;
  if (expr === 'prev') return prev?.result;
  if (expr.startsWith('prev.')) return _getPath(prev?.result, expr.slice(5));
  if (expr.startsWith('state:')) return ctx.getState(expr.slice(6));
  if (expr.startsWith('payload.')) return _getPath(ctx._currentPayload, expr.slice(8));
  return expr;
}

/**
 * Resolve all values in a params object.
 */
function _resolveParams(params, ctx, prev) {
  if (!params || typeof params !== 'object') return params;
  const result = {};
  for (const [k, v] of Object.entries(params)) {
    result[k] = _resolveValue(v, ctx, prev);
  }
  return result;
}

/**
 * Evaluate a condition expression.
 * Condition: { left: expr, op: 'eq'|'neq'|'gt'|'lt'|'truthy'|'falsy', right: expr }
 */
function _evaluateCondition(condition, ctx, prev) {
  if (!condition) return true;
  const left  = _resolveValue(condition.left,  ctx, prev);
  const right = _resolveValue(condition.right, ctx, prev);
  switch (condition.op) {
    case 'eq':     return left === right;
    case 'neq':    return left !== right;
    case 'gt':     return left > right;
    case 'gte':    return left >= right;
    case 'lt':     return left < right;
    case 'lte':    return left <= right;
    case 'truthy': return !!left;
    case 'falsy':  return !left;
    case 'in':     return Array.isArray(right) && right.includes(left);
    default:       return !!left;
  }
}

function _getPath(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((cur, p) => cur?.[p], obj);
}

export default ACTION_STEP_EXECUTORS;
