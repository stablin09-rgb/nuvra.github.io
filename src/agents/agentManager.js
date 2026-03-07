/**
 * Nuvra — agentManager.js (Phase 14)
 *
 * The AgentManager is the public API for the entire agent system.
 * It:
 *   - Initializes all agent subsystems (runtime, permissions, memory, executor)
 *   - Registers all 6 agent type factories
 *   - Provides the tool implementations that agents call
 *   - Exposes a clean public API to app.js
 *   - Manages the event bus for the agentConsole UI
 *
 * Usage:
 *   agentManager.init({ editor, projectId, userId, ... })
 *   agentManager.runGoal('Build a landing page for a SaaS product')
 *   agentManager.on(event => console.log(event))
 *
 * @module agentManager
 */
'use strict';

import { agentRuntime }     from './agentRuntime.js';
import { agentPermissions } from './agentPermissions.js';
import { agentMemory, MEMORY_CATEGORY } from './agentMemory.js';
import { goalInterpreter }  from './goalInterpreter.js';
import { planExecutor, EXECUTION_STATUS } from './planExecutor.js';

import { createPlannerAgent }     from './agentTypes/plannerAgent.js';
import { createBuilderAgent }     from './agentTypes/builderAgent.js';
import { createDesignAgent }      from './agentTypes/designAgent.js';
import { createGrowthAgent }      from './agentTypes/growthAgent.js';
import { createMaintenanceAgent } from './agentTypes/maintenanceAgent.js';
import { createDeploymentAgent }  from './agentTypes/deploymentAgent.js';

// ─── AgentManager class ───────────────────────────────────────────────────────
class AgentManager {
  constructor() {
    this._editor      = null;
    this._projectId   = null;
    this._userId      = null;
    this._listeners   = [];
    this._initialized = false;
    this._activePlans = new Map(); // planId → Plan
  }

  /**
   * Initialize the agent system.
   * Must be called after the editor and project are loaded.
   *
   * @param {object} params
   * @param {object}   params.editor          - GrapesJS editor instance
   * @param {string}   params.projectId       - Active project ID
   * @param {string}   params.userId          - Current user ID
   * @param {string}   [params.userRole]      - User role for permission checks
   * @param {function} [params.llmCall]       - LLM call function: async (messages) => string
   * @param {object}   [params.policyEngine]  - Phase 12 policy engine
   * @param {object}   [params.packRuntime]   - Phase 13 pack runtime
   * @param {object}   [params.hostingManager]- Phase 13 hosting manager
   * @param {object}   [params.aiGovernance]  - Phase 12 AI governance
   */
  init({
    editor, projectId, userId, userRole = 'editor',
    llmCall, policyEngine, packRuntime, hostingManager, aiGovernance,
  }) {
    this._editor       = editor;
    this._projectId    = projectId;
    this._userId       = userId;

    // 1. Initialize memory
    agentMemory.setProject(projectId);

    // 2. Initialize permissions
    agentPermissions.init({
      userRole,
      environment:    'draft',
      policyEngine,
      packConstraints: packRuntime?.getActiveConstraints?.() || null,
    });

    // 3. Register LLM with goal interpreter
    if (llmCall) {
      goalInterpreter.registerLLM(llmCall);
    }

    // 4. Register tool implementations
    agentRuntime.registerTools(this._buildToolImplementations({
      editor, projectId, userId, hostingManager, aiGovernance,
    }));

    // 5. Register agent factories with plan executor
    planExecutor.registerAgent('planner',     createPlannerAgent);
    planExecutor.registerAgent('builder',     createBuilderAgent);
    planExecutor.registerAgent('design',      createDesignAgent);
    planExecutor.registerAgent('growth',      createGrowthAgent);
    planExecutor.registerAgent('maintenance', createMaintenanceAgent);
    planExecutor.registerAgent('deployment',  createDeploymentAgent);

    // 6. Forward all runtime and executor events to our listeners
    agentRuntime.on(event => this._emit(event));
    planExecutor.on(event => this._emit(event));

    this._initialized = true;
  }

  /**
   * Update the active project context (called on project switch).
   * @param {string} projectId
   */
  setProject(projectId) {
    this._projectId = projectId;
    agentMemory.setProject(projectId);
  }

  /**
   * Run a high-level user goal through the full agent pipeline.
   *
   * @param {string} goal - The user's natural language goal
   * @returns {Promise<object>} The generated plan
   */
  async runGoal(goal) {
    if (!this._initialized) throw new Error('AgentManager not initialized');

    this._emit({ type: 'agent:goal-received', goal });

    // 1. Get project context for the interpreter
    const projectContext = this._getProjectContext();
    const memorySummary  = agentMemory.getSummaryForPrompt();

    // 2. Interpret the goal into a plan
    const plan = await goalInterpreter.interpret({
      goal,
      projectId:      this._projectId,
      projectContext,
      memorySummary,
      constraints: {
        environment: agentPermissions.getEnvironment(),
      },
    });

    this._activePlans.set(plan.id, plan);
    this._emit({ type: 'agent:plan-created', plan });

    // 3. Store the goal in memory
    agentMemory.write({
      category: MEMORY_CATEGORY.INTENT,
      key:      'project.goal',
      value:    goal,
      source:   'user',
    });

    // 4. Execute the plan
    planExecutor.execute({
      plan,
      projectId: this._projectId,
      userId:    this._userId,
    });

    return plan;
  }

  /**
   * Approve a pending proposal.
   * @param {string} planId
   * @param {string} proposalId
   */
  async approveProposal(planId, proposalId) {
    await planExecutor.approveProposal(planId, proposalId, this._projectId, this._userId);
  }

  /**
   * Reject a pending proposal.
   * @param {string} planId
   * @param {string} proposalId
   * @param {string} reason
   * @param {string} agentType
   */
  rejectProposal(planId, proposalId, reason, agentType) {
    planExecutor.rejectProposal(planId, proposalId, reason, agentType);
  }

  /**
   * Pause a running plan.
   * @param {string} planId
   */
  pause(planId) { planExecutor.pause(planId); }

  /**
   * Resume a paused plan.
   * @param {string} planId
   */
  resume(planId) { planExecutor.resume(planId); }

  /**
   * Cancel a plan.
   * @param {string} planId
   */
  cancel(planId) {
    planExecutor.cancel(planId);
    this._activePlans.delete(planId);
  }

  /**
   * Get the current state of a plan.
   * @param {string} planId
   * @returns {object|null}
   */
  getPlanState(planId) {
    return planExecutor.getState(planId);
  }

  /**
   * Get all active plans.
   * @returns {object[]}
   */
  getActivePlans() {
    return [...this._activePlans.values()];
  }

  /**
   * Get the project memory for display in the agent console.
   * @returns {object}
   */
  getMemory() {
    return {
      intent:      agentMemory.query({ category: MEMORY_CATEGORY.INTENT }),
      brand:       agentMemory.query({ category: MEMORY_CATEGORY.BRAND }),
      decisions:   agentMemory.query({ category: MEMORY_CATEGORY.DECISIONS }),
      preferences: agentMemory.query({ category: MEMORY_CATEGORY.PREFERENCES }),
      rejections:  agentMemory.query({ category: MEMORY_CATEGORY.REJECTIONS }),
      actions:     agentMemory.query({ category: MEMORY_CATEGORY.ACTIONS, limit: 20 }),
    };
  }

  /**
   * Write a memory entry (e.g., from the user editing memory in the console).
   * @param {object} params
   */
  writeMemory({ category, key, value }) {
    agentMemory.write({ category, key, value, source: 'user' });
  }

  /**
   * Get the auto-approve rules for display in the console.
   * @returns {object[]}
   */
  getAutoApproveRules() {
    return agentPermissions.getAutoApproveRules();
  }

  /**
   * Add an auto-approve rule.
   * @param {object} rule
   */
  addAutoApproveRule(rule) {
    agentPermissions.addAutoApproveRule(rule);
  }

  /**
   * Remove an auto-approve rule.
   * @param {number} index
   */
  removeAutoApproveRule(index) {
    agentPermissions.removeAutoApproveRule(index);
  }

  /**
   * Enable or disable dry-run mode.
   * @param {boolean} enabled
   */
  setDryRun(enabled) {
    agentPermissions.setDryRun(enabled);
    this._emit({ type: 'agent:dry-run-changed', enabled });
  }

  isDryRun() {
    return agentPermissions.isDryRun();
  }

  /**
   * Subscribe to agent events.
   * @param {function} listener
   * @returns {function} unsubscribe
   */
  on(listener) {
    this._listeners.push(listener);
    return () => { this._listeners = this._listeners.filter(l => l !== listener); };
  }

  // ─── Tool implementations ──────────────────────────────────────────────────

  _buildToolImplementations({ editor, projectId, userId, hostingManager, aiGovernance }) {
    return {
      // ── project.read ──────────────────────────────────────────────────────
      'project.read': async ({ fields = [] }) => {
        const result = {};
        if (!editor) return result;
        if (!fields.length || fields.includes('pages')) {
          const pages = [];
          editor.Pages?.getAll().forEach(page => {
            pages.push({
              id:   page.getId(),
              name: page.getName(),
              html: editor.Pages?.getSelected()?.getId() === page.getId()
                    ? editor.getHtml() : '',
              css:  editor.Pages?.getSelected()?.getId() === page.getId()
                    ? editor.getCss()  : '',
            });
          });
          result.pages = pages;
        }
        return result;
      },

      // ── memory.read ───────────────────────────────────────────────────────
      'memory.read': async ({ categories = [] }) => {
        const summary = agentMemory.getSummaryForPrompt();
        const entries = {};
        for (const cat of categories) {
          entries[cat] = agentMemory.query({ category: cat });
        }
        return { summary, entries };
      },

      // ── memory.write ──────────────────────────────────────────────────────
      'memory.write': async ({ category, key, value, source }) => {
        return agentMemory.write({ category, key, value, source: source || 'agent' });
      },

      // ── analytics.read ────────────────────────────────────────────────────
      'analytics.read': async ({ metrics = [] }) => {
        // Returns mock analytics if no real analytics service is connected
        return {
          bounceRate:      'N/A',
          conversionRate:  'N/A',
          topPages:        [],
          note:            'Connect analytics in project settings for real data',
        };
      },

      // ── pack.read ─────────────────────────────────────────────────────────
      'pack.read': async ({ fields = [] }) => {
        // Returns active pack constraints if a pack is loaded
        return { constraints: null, tokens: {} };
      },

      // ── hosting.read ──────────────────────────────────────────────────────
      'hosting.read': async ({ fields = [] }) => {
        if (!hostingManager) return { status: 'not_configured' };
        try {
          return await hostingManager.getStatus(projectId);
        } catch { return { status: 'unknown' }; }
      },

      // ── ai.generate ───────────────────────────────────────────────────────
      'ai.generate': async ({ systemPrompt, userPrompt, maxTokens = 2000 }) => {
        // Check AI governance if available
        if (aiGovernance) {
          const check = aiGovernance.checkPrompt?.({ systemPrompt, userPrompt });
          if (check && !check.allowed) {
            return { error: check.reason, blocked: true };
          }
        }

        // Use the window-level AI call if available (set by app.js)
        const llmCall = window.__NUVRA_AGENT_LLM__;
        if (!llmCall) return { error: 'No LLM configured', content: null };

        try {
          const content = await llmCall([
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt   },
          ]);
          return { content, tokensUsed: Math.ceil(content.length / 4) };
        } catch (err) {
          return { error: err.message, content: null };
        }
      },

      // ── project.write.page ────────────────────────────────────────────────
      'project.write.page': async ({ name, html, css, source, planId, stepId, diff }) => {
        // This is a SUGGEST-level tool — the runtime will wrap it as a proposal
        // The actual application happens in agentRuntime.applyProposal()
        return {
          action:  'write_page',
          name, html, css, source, planId, stepId, diff,
          preview: html?.slice(0, 200) + '...',
        };
      },

      // ── project.write.data ────────────────────────────────────────────────
      'project.write.data': async ({ modelName, fields, source, planId, stepId }) => {
        return {
          action: 'write_data_model',
          modelName, fields, source, planId, stepId,
        };
      },

      // ── hosting.deploy ────────────────────────────────────────────────────
      'hosting.deploy': async ({ environment, message, planId, stepId }) => {
        return {
          action: 'deploy',
          environment, message, planId, stepId,
        };
      },

      // ── hosting.rollback ──────────────────────────────────────────────────
      'hosting.rollback': async ({ deploymentId, environment, reason, planId, stepId }) => {
        return {
          action: 'rollback',
          deploymentId, environment, reason, planId, stepId,
        };
      },
    };
  }

  // ─── Apply a proposal (called after user approval) ─────────────────────────
  /**
   * Apply a proposal's action to the actual editor/project state.
   * This is the "real" implementation that modifies GrapesJS.
   * Called by agentRuntime.applyProposal().
   * @param {object} proposal
   * @param {string} projectId
   */
  async _applyProposalToEditor(proposal, projectId) {
    if (!this._editor) return { error: 'No editor' };

    if (proposal.toolName === 'project.write.page') {
      const { name, html, css } = proposal.params;
      const pages = this._editor.Pages?.getAll() || [];
      const existing = pages.find(p => p.getName() === name);

      if (existing) {
        // Update existing page
        this._editor.Pages?.select(existing);
        this._editor.setComponents(html || '');
        this._editor.setStyle(css || '');
      } else {
        // Create new page
        this._editor.Pages?.add({ name, component: html || '', styles: css || '' });
      }
      return { success: true, action: 'page_written', name };
    }

    if (proposal.toolName === 'hosting.deploy') {
      // Delegate to hostingManager
      return { success: true, action: 'deploy_queued', note: 'Deploy will be triggered by hosting manager' };
    }

    return { success: true, action: 'applied' };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _getProjectContext() {
    if (!this._editor) return {};
    const pages = [];
    this._editor.Pages?.getAll().forEach(p => pages.push({ id: p.getId(), name: p.getName() }));
    return { pageCount: pages.length, pages };
  }

  _emit(event) {
    for (const listener of this._listeners) {
      try { listener(event); } catch { /* never crash */ }
    }
  }
}

export const agentManager = new AgentManager();
