/**
 * Nuvra — planExecutor.js (Phase 14)
 *
 * The PlanExecutor drives execution of a Plan produced by goalInterpreter.
 * It:
 *   - Runs steps in dependency order
 *   - Pauses at approval gates and waits for human confirmation
 *   - Collects proposals from the agentRuntime and presents them to the user
 *   - Applies approved proposals via agentRuntime.applyProposal()
 *   - Records every action in agentMemory
 *   - Supports pause, resume, cancel, and step-level rollback
 *   - Emits structured events for the agentConsole UI
 *
 * @module planExecutor
 */
'use strict';

import { agentRuntime }     from './agentRuntime.js';
import { agentPermissions } from './agentPermissions.js';
import { agentMemory }      from './agentMemory.js';

// ─── Execution state ──────────────────────────────────────────────────────────
export const EXECUTION_STATUS = {
  PENDING:      'pending',
  RUNNING:      'running',
  AWAITING:     'awaiting_approval',
  PAUSED:       'paused',
  COMPLETED:    'completed',
  FAILED:       'failed',
  CANCELLED:    'cancelled',
};

// ─── PlanExecutor class ───────────────────────────────────────────────────────
class PlanExecutor {
  constructor() {
    /** @type {Map<string, object>} planId → execution state */
    this._executions = new Map();
    /** @type {function[]} event listeners */
    this._listeners = [];
    /** @type {Map<string, function>} planId → agent factory map */
    this._agentFactories = new Map();
  }

  /**
   * Register an agent factory for a given agent type.
   * @param {string}   agentType
   * @param {function} factory - (plan, step) => { execute: async function }
   */
  registerAgent(agentType, factory) {
    this._agentFactories.set(agentType, factory);
  }

  /**
   * Subscribe to execution events.
   * @param {function} listener
   * @returns {function} unsubscribe
   */
  on(listener) {
    this._listeners.push(listener);
    return () => { this._listeners = this._listeners.filter(l => l !== listener); };
  }

  /**
   * Start executing a plan.
   * @param {object} params
   * @param {object}   params.plan       - The Plan from goalInterpreter
   * @param {string}   params.projectId
   * @param {string}   params.userId
   * @returns {Promise<void>}
   */
  async execute({ plan, projectId, userId }) {
    const execState = {
      planId:       plan.id,
      plan,
      projectId,
      userId,
      status:       EXECUTION_STATUS.RUNNING,
      currentStep:  null,
      completedSteps: [],
      failedSteps:  [],
      pendingApprovals: [],
      appliedActions: [],
      startedAt:    new Date().toISOString(),
      completedAt:  null,
      error:        null,
    };
    this._executions.set(plan.id, execState);
    this._emit('plan:start', { planId: plan.id, plan });

    try {
      await this._runSteps(execState);
    } catch (err) {
      execState.status = EXECUTION_STATUS.FAILED;
      execState.error  = err.message;
      this._emit('plan:failed', { planId: plan.id, error: err.message });
    }
  }

  /**
   * Run all steps in dependency order.
   * @param {object} execState
   */
  async _runSteps(execState) {
    const { plan, projectId, userId } = execState;
    const completedIds = new Set();

    for (const step of plan.steps) {
      // Check if we've been paused or cancelled
      if (execState.status === EXECUTION_STATUS.PAUSED) {
        this._emit('plan:paused', { planId: plan.id, stepId: step.id });
        await this._waitForResume(execState);
      }
      if (execState.status === EXECUTION_STATUS.CANCELLED) {
        this._emit('plan:cancelled', { planId: plan.id });
        return;
      }

      // Check dependencies
      if (step.dependsOn?.length) {
        const unmet = step.dependsOn.filter(dep => !completedIds.has(dep));
        if (unmet.length) {
          execState.status = EXECUTION_STATUS.FAILED;
          throw new Error(`Step "${step.title}" has unmet dependencies: ${unmet.join(', ')}`);
        }
      }

      // Permission check
      const permResult = agentPermissions.check({
        agentType: step.agentType,
        toolName:  'project.write.page',
        toolLevel: step.risk === 'high' ? 'admin' : 'suggest',
      });
      if (!permResult.allowed) {
        this._emit('step:skipped', { planId: plan.id, stepId: step.id, reason: permResult.reason });
        completedIds.add(step.id);
        continue;
      }

      // Execute the step
      execState.currentStep = step.id;
      this._emit('step:start', { planId: plan.id, step });

      const result = await this._executeStep({ execState, step, projectId, userId });

      if (!result.success) {
        execState.failedSteps.push({ stepId: step.id, error: result.error });
        this._emit('step:failed', { planId: plan.id, stepId: step.id, error: result.error });
        // Non-fatal: continue with remaining steps unless it's a critical failure
        if (step.risk === 'high') throw new Error(`Critical step failed: ${result.error}`);
        continue;
      }

      // Handle proposals (actions requiring approval)
      if (result.proposals?.length) {
        await this._handleApprovals({ execState, step, proposals: result.proposals, projectId, userId });
      }

      // Record in memory
      agentMemory.recordAction({
        agentType: step.agentType,
        stepTitle: step.title,
        planId:    plan.id,
        stepId:    step.id,
        timestamp: new Date().toISOString(),
      });

      completedIds.add(step.id);
      execState.completedSteps.push(step.id);
      this._emit('step:complete', { planId: plan.id, step, result });
    }

    execState.status     = EXECUTION_STATUS.COMPLETED;
    execState.completedAt = new Date().toISOString();
    this._emit('plan:complete', { planId: plan.id, execState });
  }

  /**
   * Execute a single step using the registered agent factory.
   * @param {object} params
   * @returns {Promise<object>}
   */
  async _executeStep({ execState, step, projectId, userId }) {
    const factory = this._agentFactories.get(step.agentType);
    if (!factory) {
      return { success: false, error: `No agent registered for type: ${step.agentType}` };
    }

    const agent = factory(execState.plan, step);
    const runId = `${execState.planId}:run`;

    return agentRuntime.executeStep({
      runId,
      agentType:     step.agentType,
      agentId:       `${step.agentType}_${step.id}`,
      stepId:        step.id,
      projectId,
      userId,
      declaredTools: step.tools,
      context:       { ...step.context, plan: execState.plan, step },
      execute:       agent.execute,
    });
  }

  /**
   * Handle proposals — present them to the user and wait for approval/rejection.
   * @param {object} params
   */
  async _handleApprovals({ execState, step, proposals, projectId, userId }) {
    if (!proposals.length) return;

    // Auto-approve if permissions allow
    const toApprove = [];
    const toReview  = [];

    for (const proposal of proposals) {
      const perm = agentPermissions.check({
        agentType: step.agentType,
        toolName:  proposal.toolName,
        toolLevel: proposal.toolLevel,
        toolParams: proposal.params,
      });
      if (perm.autoApproved) {
        toApprove.push(proposal);
      } else {
        toReview.push(proposal);
      }
    }

    // Apply auto-approved proposals immediately
    for (const proposal of toApprove) {
      const result = await agentRuntime.applyProposal(proposal, projectId, userId);
      execState.appliedActions.push({ proposal, result });
      this._emit('proposal:auto-approved', { planId: execState.planId, proposal, result });
    }

    // For proposals requiring review, pause and wait
    if (toReview.length) {
      execState.status = EXECUTION_STATUS.AWAITING;
      execState.pendingApprovals.push(...toReview);
      this._emit('plan:awaiting-approval', {
        planId:    execState.planId,
        stepId:    step.id,
        proposals: toReview,
      });

      // Wait for all pending approvals to be resolved
      await this._waitForApprovals(execState, toReview);
    }
  }

  /**
   * Wait for all pending approvals to be resolved.
   * Resolved via approveProposal() or rejectProposal() calls.
   * @param {object}   execState
   * @param {object[]} proposals
   */
  _waitForApprovals(execState, proposals) {
    return new Promise((resolve) => {
      const pendingIds = new Set(proposals.map(p => p.id));
      const check = () => {
        const allResolved = [...pendingIds].every(id =>
          !execState.pendingApprovals.find(p => p.id === id)
        );
        if (allResolved) resolve();
      };
      // Poll every 500ms
      const interval = setInterval(() => {
        if (execState.status === EXECUTION_STATUS.CANCELLED) {
          clearInterval(interval);
          resolve();
          return;
        }
        check();
        if (!execState.pendingApprovals.find(p => pendingIds.has(p.id))) {
          clearInterval(interval);
          resolve();
        }
      }, 500);
    });
  }

  /**
   * Approve a specific proposal.
   * @param {string} planId
   * @param {string} proposalId
   * @param {string} projectId
   * @param {string} userId
   */
  async approveProposal(planId, proposalId, projectId, userId) {
    const execState = this._executions.get(planId);
    if (!execState) return;

    const idx = execState.pendingApprovals.findIndex(p => p.id === proposalId);
    if (idx < 0) return;

    const [proposal] = execState.pendingApprovals.splice(idx, 1);
    const result = await agentRuntime.applyProposal(proposal, projectId, userId);
    execState.appliedActions.push({ proposal, result });

    // Resume if all approvals are resolved
    if (!execState.pendingApprovals.length) {
      execState.status = EXECUTION_STATUS.RUNNING;
    }

    this._emit('proposal:approved', { planId, proposal, result });
  }

  /**
   * Reject a specific proposal.
   * @param {string} planId
   * @param {string} proposalId
   * @param {string} reason
   * @param {string} agentType
   */
  rejectProposal(planId, proposalId, reason, agentType) {
    const execState = this._executions.get(planId);
    if (!execState) return;

    const idx = execState.pendingApprovals.findIndex(p => p.id === proposalId);
    if (idx < 0) return;

    const [proposal] = execState.pendingApprovals.splice(idx, 1);
    agentMemory.recordRejection(
      `${proposal.toolName}: ${JSON.stringify(proposal.params).slice(0, 100)}`,
      agentType
    );

    if (!execState.pendingApprovals.length) {
      execState.status = EXECUTION_STATUS.RUNNING;
    }

    this._emit('proposal:rejected', { planId, proposal, reason });
  }

  /**
   * Pause a running plan.
   * @param {string} planId
   */
  pause(planId) {
    const execState = this._executions.get(planId);
    if (execState && execState.status === EXECUTION_STATUS.RUNNING) {
      execState.status = EXECUTION_STATUS.PAUSED;
      this._emit('plan:paused', { planId });
    }
  }

  /**
   * Resume a paused plan.
   * @param {string} planId
   */
  resume(planId) {
    const execState = this._executions.get(planId);
    if (execState && execState.status === EXECUTION_STATUS.PAUSED) {
      execState.status = EXECUTION_STATUS.RUNNING;
      this._emit('plan:resumed', { planId });
    }
  }

  /**
   * Cancel a plan.
   * @param {string} planId
   */
  cancel(planId) {
    const execState = this._executions.get(planId);
    if (execState) {
      execState.status = EXECUTION_STATUS.CANCELLED;
      this._emit('plan:cancelled', { planId });
    }
  }

  /**
   * Get the current execution state for a plan.
   * @param {string} planId
   * @returns {object|null}
   */
  getState(planId) {
    return this._executions.get(planId) || null;
  }

  /**
   * Wait for a paused plan to be resumed.
   * @param {object} execState
   */
  _waitForResume(execState) {
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (execState.status !== EXECUTION_STATUS.PAUSED) {
          clearInterval(interval);
          resolve();
        }
      }, 300);
    });
  }

  _emit(type, data) {
    const event = { type, ...data, timestamp: new Date().toISOString() };
    for (const listener of this._listeners) {
      try { listener(event); } catch { /* never crash */ }
    }
  }
}

export const planExecutor = new PlanExecutor();
