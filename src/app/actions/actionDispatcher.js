/**
 * actionDispatcher.js — Nuvra Phase 3
 *
 * The Action Dispatcher.
 *
 * Executes declarative action chains from the AppSchema.
 * An action is a named sequence of steps. Each step is a declarative
 * operation (insert, update, set state, navigate, etc.).
 *
 * The dispatcher:
 *  - Boots from the actions array in the AppSchema
 *  - Executes steps in order, passing the result of each step to the next
 *  - Handles branching (condition steps)
 *  - Logs every execution for replay and debugging
 *  - Emits events on the app event bus for observability
 *  - Never uses eval() or inline JS
 *
 * @module app/actions/actionDispatcher
 */
'use strict';

import { ACTION_STEP_EXECUTORS } from './actionTypes.js';
import { generateId, now, deepClone } from '../../runtime/utils.js';

// ─── ActionDispatcher ─────────────────────────────────────────────────────────
export class ActionDispatcher {
  /**
   * @param {object} opts
   * @param {object[]} opts.actions  - Array of ActionSchema objects
   * @param {object}   opts.eventBus - AppEventBus instance
   */
  constructor({ actions, eventBus }) {
    this._actions  = new Map(); // actionId → ActionSchema
    this._eventBus = eventBus;
    this._log      = []; // execution log for replay
    this._rawActions = actions || [];
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  async boot() {
    for (const action of this._rawActions) {
      this._actions.set(action.id, action);
    }
  }

  // ── Dispatch ───────────────────────────────────────────────────────────────
  /**
   * Dispatch a named action.
   *
   * @param {string}     actionId - The action ID from the schema
   * @param {object}     payload  - The triggering payload (e.g., form data)
   * @param {AppContext} ctx      - The running app context
   * @returns {Promise<{ ok: boolean, result?: *, error?: string, log: object[] }>}
   */
  async dispatch(actionId, payload, ctx) {
    const action = this._actions.get(actionId);
    if (!action) {
      return { ok: false, error: `Unknown action: "${actionId}"`, log: [] };
    }

    const executionId = generateId('exec');
    const executionLog = [];

    this._eventBus.emit(`action:dispatched:${actionId}`, { actionId, payload, executionId });

    // Make payload accessible to step resolvers via context
    ctx._currentPayload = payload;

    let prevResult = { ok: true, result: payload };

    try {
      prevResult = await this._executeSteps(action.steps || [], ctx, prevResult, executionLog);
    } catch (err) {
      const entry = {
        executionId,
        actionId,
        ts:      now(),
        ok:      false,
        error:   err.message,
        log:     executionLog,
      };
      this._log.push(entry);
      this._eventBus.emit(`action:failed:${actionId}`, entry);
      return { ok: false, error: err.message, log: executionLog };
    } finally {
      ctx._currentPayload = null;
    }

    const entry = {
      executionId,
      actionId,
      ts:      now(),
      ok:      prevResult.ok,
      result:  prevResult.result,
      error:   prevResult.error,
      log:     executionLog,
    };
    this._log.push(entry);

    if (prevResult.ok) {
      this._eventBus.emit(`action:completed:${actionId}`, entry);
    } else {
      this._eventBus.emit(`action:failed:${actionId}`, entry);
    }

    return { ok: prevResult.ok, result: prevResult.result, error: prevResult.error, log: executionLog };
  }

  // ── Step Execution ─────────────────────────────────────────────────────────
  async _executeSteps(steps, ctx, initialPrev, log) {
    let prev = initialPrev;

    for (const step of steps) {
      const stepLog = {
        stepId:   step.id || generateId('step'),
        stepType: step.type,
        ts:       now(),
      };

      const executor = ACTION_STEP_EXECUTORS[step.type];
      if (!executor) {
        stepLog.ok    = false;
        stepLog.error = `Unknown step type: "${step.type}"`;
        log.push(stepLog);
        return { ok: false, error: stepLog.error };
      }

      let stepResult;
      try {
        stepResult = await executor(step, ctx, prev);
      } catch (err) {
        stepLog.ok    = false;
        stepLog.error = err.message;
        log.push(stepLog);
        return { ok: false, error: err.message };
      }

      stepLog.ok     = stepResult.ok;
      stepLog.result = stepResult.result;
      stepLog.error  = stepResult.error;
      log.push(stepLog);

      // Handle condition branching
      if (step.type === 'condition' && stepResult.ok) {
        const branch = stepResult.branch === 'then' ? step.then : step.else;
        if (Array.isArray(branch) && branch.length > 0) {
          const branchResult = await this._executeSteps(branch, ctx, stepResult, log);
          if (!branchResult.ok && step.haltOnError !== false) {
            return branchResult;
          }
          prev = branchResult;
          continue;
        }
      }

      // Halt on error unless step says otherwise
      if (!stepResult.ok && step.haltOnError !== false) {
        return stepResult;
      }

      prev = stepResult;
    }

    return prev;
  }

  // ── Replay ─────────────────────────────────────────────────────────────────
  /**
   * Get the full execution log for replay and debugging.
   * @returns {object[]}
   */
  getLog() {
    return deepClone(this._log);
  }

  /**
   * Replay a specific execution by ID.
   * Returns the logged execution entry without re-executing.
   * @param {string} executionId
   * @returns {object|null}
   */
  getExecution(executionId) {
    return this._log.find(e => e.executionId === executionId) || null;
  }

  // ── Destroy ────────────────────────────────────────────────────────────────
  destroy() {
    this._actions.clear();
    this._log = [];
  }
}

export default ActionDispatcher;
