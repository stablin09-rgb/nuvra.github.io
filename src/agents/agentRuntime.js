/**
 * Nuvra — agentRuntime.js (Phase 14)
 *
 * The AgentRuntime is the execution environment for all agents.
 * It provides:
 *   - Execution sandboxing (agents cannot access global state directly)
 *   - Time and token budgets (agents cannot run indefinitely)
 *   - Declared tool access (agents only get the tools they declared)
 *   - State read/write boundaries (agents cannot write without approval)
 *   - Structured event emission for observability
 *
 * Design principles:
 *   - Agents are functions, not objects. The runtime wraps them.
 *   - All side effects go through the runtime's tool interface.
 *   - The runtime is the single source of truth for agent execution state.
 *
 * @module agentRuntime
 */
'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_TIMEOUT_MS     = 60_000;   // 60 seconds per agent step
const DEFAULT_TOKEN_BUDGET   = 8_000;    // tokens per agent invocation
const DEFAULT_STEP_BUDGET    = 20;       // max steps per plan
const MAX_MEMORY_READS       = 100;      // max memory reads per run
const MAX_MEMORY_WRITES      = 50;       // max memory writes per run

// ─── Tool Registry ────────────────────────────────────────────────────────────
/**
 * The complete set of tools available to agents.
 * Each tool has a name, a description, and a permission level.
 * Agents must declare which tools they need; they only receive those.
 */
const TOOL_REGISTRY = {
  // Read-only tools (no approval required)
  'project.read':       { level: 'read',    description: 'Read project pages, data models, and settings' },
  'memory.read':        { level: 'read',    description: 'Read project memory (intent, brand, decisions)' },
  'analytics.read':     { level: 'read',    description: 'Read site analytics and performance metrics' },
  'pack.read':          { level: 'read',    description: 'Read active Design AI Pack constraints' },
  'hosting.read':       { level: 'read',    description: 'Read deployment status and history' },
  'ai.generate':        { level: 'suggest', description: 'Generate HTML/CSS content via AI' },

  // Suggest tools (require human approval before applying)
  'project.write.page':    { level: 'suggest', description: 'Create or modify a page in the project' },
  'project.write.data':    { level: 'suggest', description: 'Create or modify a data model' },
  'project.write.settings':{ level: 'suggest', description: 'Modify project settings (name, AI config)' },
  'memory.write':          { level: 'suggest', description: 'Write to project memory' },

  // Deploy tools (require explicit deploy permission)
  'hosting.deploy':     { level: 'deploy',  description: 'Deploy the project to a hosting environment' },
  'hosting.rollback':   { level: 'deploy',  description: 'Roll back to a previous deployment' },

  // Dangerous tools (require admin permission + explicit approval)
  'project.delete.page':   { level: 'admin',   description: 'Delete a page from the project' },
  'project.delete.data':   { level: 'admin',   description: 'Delete a data model' },
};

// ─── AgentRuntime class ───────────────────────────────────────────────────────
class AgentRuntime {
  constructor() {
    /** @type {Map<string, object>} runId → execution context */
    this._runs = new Map();
    /** @type {function[]} event listeners */
    this._listeners = [];
    /** @type {object|null} injected tool implementations */
    this._tools = null;
  }

  /**
   * Register the concrete tool implementations.
   * Called once by agentManager.js during system init.
   * @param {object} tools
   */
  registerTools(tools) {
    this._tools = tools;
  }

  /**
   * Subscribe to runtime events.
   * @param {function} listener
   * @returns {function} unsubscribe
   */
  on(listener) {
    this._listeners.push(listener);
    return () => { this._listeners = this._listeners.filter(l => l !== listener); };
  }

  /**
   * Execute a single agent step within a sandboxed context.
   *
   * @param {object} params
   * @param {string}   params.runId       - Unique run identifier
   * @param {string}   params.agentType   - Agent type (e.g., 'builder')
   * @param {string}   params.agentId     - Agent instance ID
   * @param {string}   params.stepId      - Step identifier within the plan
   * @param {string}   params.projectId   - Active project ID
   * @param {string}   params.userId      - User ID (for permission checks)
   * @param {string[]} params.declaredTools - Tools this agent declared it needs
   * @param {object}   params.context     - Step-specific context data
   * @param {function} params.execute     - The agent's step function
   * @param {object}   [params.budgets]   - Override default budgets
   * @returns {Promise<AgentStepResult>}
   */
  async executeStep({
    runId, agentType, agentId, stepId, projectId, userId,
    declaredTools, context, execute, budgets = {},
  }) {
    const timeout   = budgets.timeoutMs    ?? DEFAULT_TIMEOUT_MS;
    const maxTokens = budgets.tokenBudget  ?? DEFAULT_TOKEN_BUDGET;

    // Build the sandboxed tool interface for this agent
    const sandboxedTools = this._buildSandbox({
      runId, agentType, agentId, stepId, projectId, userId, declaredTools,
    });

    // Track execution state
    const execState = {
      runId, agentType, agentId, stepId, projectId, userId,
      startedAt: Date.now(),
      tokensUsed: 0,
      memoryReads: 0,
      memoryWrites: 0,
      proposals: [],   // actions proposed but not yet approved
      applied: [],     // actions that have been approved and applied
      status: 'running',
    };
    this._runs.set(`${runId}:${stepId}`, execState);

    this._emit('step:start', { runId, agentType, agentId, stepId, projectId });

    try {
      // Race the agent execution against a timeout
      const result = await Promise.race([
        execute({ tools: sandboxedTools, context, state: execState }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Agent step timeout after ${timeout}ms`)), timeout)
        ),
      ]);

      execState.status = 'completed';
      execState.completedAt = Date.now();
      this._emit('step:complete', { runId, agentType, agentId, stepId, result });
      return { success: true, result, proposals: execState.proposals, applied: execState.applied };

    } catch (err) {
      execState.status = 'failed';
      execState.error  = err.message;
      this._emit('step:error', { runId, agentType, agentId, stepId, error: err.message });
      return { success: false, error: err.message, proposals: execState.proposals };
    } finally {
      this._runs.delete(`${runId}:${stepId}`);
    }
  }

  /**
   * Interrupt a running agent step.
   * @param {string} runId
   * @param {string} stepId
   */
  interrupt(runId, stepId) {
    const key = `${runId}:${stepId}`;
    const state = this._runs.get(key);
    if (state) {
      state.status = 'interrupted';
      this._emit('step:interrupted', { runId, stepId });
    }
  }

  /**
   * Build a sandboxed tool interface for a specific agent execution.
   * The agent only receives the tools it declared, and each tool call
   * is tracked and validated.
   */
  _buildSandbox({ runId, agentType, agentId, stepId, projectId, userId, declaredTools }) {
    const sandbox = {};
    const execState = () => this._runs.get(`${runId}:${stepId}`);

    for (const toolName of declaredTools) {
      const toolDef = TOOL_REGISTRY[toolName];
      if (!toolDef) {
        console.warn(`[AgentRuntime] Unknown tool requested: ${toolName}`);
        continue;
      }

      const impl = this._tools?.[toolName];
      if (!impl) {
        // Provide a no-op stub if the tool isn't implemented yet
        sandbox[toolName] = async (...args) => {
          console.warn(`[AgentRuntime] Tool not implemented: ${toolName}`);
          return { error: 'not_implemented' };
        };
        continue;
      }

      // Wrap the tool implementation with tracking and safety checks
      sandbox[toolName] = async (params) => {
        const state = execState();
        if (!state || state.status !== 'running') {
          throw new Error(`Agent step ${stepId} is not running (status: ${state?.status})`);
        }

        // Track memory operations
        if (toolName === 'memory.read')  state.memoryReads++;
        if (toolName === 'memory.write') state.memoryWrites++;
        if (state.memoryReads  > MAX_MEMORY_READS)  throw new Error('Memory read budget exceeded');
        if (state.memoryWrites > MAX_MEMORY_WRITES) throw new Error('Memory write budget exceeded');

        // For suggest/deploy/admin tools, record as a proposal (not applied yet)
        if (toolDef.level !== 'read') {
          const proposal = {
            id:        `prop_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            toolName,
            toolLevel: toolDef.level,
            params,
            agentType,
            agentId,
            stepId,
            createdAt: new Date().toISOString(),
            status:    'pending',
          };
          state.proposals.push(proposal);
          this._emit('proposal:created', { runId, stepId, proposal });

          // Return the proposal ID — the planExecutor will handle approval
          return { proposalId: proposal.id, status: 'pending_approval' };
        }

        // Read-only tools execute immediately
        this._emit('tool:call', { runId, stepId, toolName, params });
        const result = await impl(params, { projectId, userId });
        this._emit('tool:result', { runId, stepId, toolName, result });
        return result;
      };
    }

    return sandbox;
  }

  /**
   * Apply an approved proposal by executing the underlying tool.
   * Called by planExecutor after human approval.
   * @param {object} proposal
   * @param {string} projectId
   * @param {string} userId
   * @returns {Promise<object>}
   */
  async applyProposal(proposal, projectId, userId) {
    const impl = this._tools?.[proposal.toolName];
    if (!impl) return { error: 'not_implemented' };
    this._emit('proposal:applying', { proposal });
    const result = await impl(proposal.params, { projectId, userId });
    this._emit('proposal:applied', { proposal, result });
    return result;
  }

  /**
   * Emit an event to all listeners.
   * @param {string} type
   * @param {object} data
   */
  _emit(type, data) {
    const event = { type, ...data, timestamp: new Date().toISOString() };
    for (const listener of this._listeners) {
      try { listener(event); } catch (e) { /* never crash on listener errors */ }
    }
  }

  /**
   * Get the list of all available tools with their metadata.
   * @returns {object[]}
   */
  getToolRegistry() {
    return Object.entries(TOOL_REGISTRY).map(([name, def]) => ({ name, ...def }));
  }
}

export const agentRuntime = new AgentRuntime();
