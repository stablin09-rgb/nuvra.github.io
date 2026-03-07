/**
 * Nuvra — goalInterpreter.js (Phase 14)
 *
 * The GoalInterpreter takes a high-level user goal and produces a structured,
 * multi-step execution plan that can be carried out by the agent system.
 *
 * It uses the LLM to:
 *   1. Classify the goal type (build, improve, deploy, maintain, etc.)
 *   2. Decompose it into ordered steps
 *   3. Assign the most appropriate agent type to each step
 *   4. Estimate complexity and risk for each step
 *
 * The output is a Plan object that the planExecutor can execute.
 *
 * @module goalInterpreter
 */
'use strict';

// ─── Plan schema ──────────────────────────────────────────────────────────────
/**
 * @typedef {object} PlanStep
 * @property {string}   id          - Unique step ID
 * @property {number}   order       - Execution order (1-based)
 * @property {string}   title       - Human-readable step title
 * @property {string}   description - Detailed description of what this step does
 * @property {string}   agentType   - Which agent type executes this step
 * @property {string[]} tools       - Tools this step requires
 * @property {string}   risk        - 'low' | 'medium' | 'high'
 * @property {boolean}  requiresApproval - Whether this step needs human approval
 * @property {string[]} [dependsOn] - Step IDs this step depends on
 * @property {object}   [context]   - Step-specific context data
 */

/**
 * @typedef {object} Plan
 * @property {string}     id          - Unique plan ID
 * @property {string}     goal        - The original user goal
 * @property {string}     goalType    - Classified goal type
 * @property {string}     summary     - One-sentence plan summary
 * @property {PlanStep[]} steps       - Ordered execution steps
 * @property {string}     createdAt   - ISO timestamp
 * @property {string}     status      - 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
 * @property {string}     projectId   - Project this plan is for
 */

// ─── Goal type classification ─────────────────────────────────────────────────
const GOAL_TYPES = {
  BUILD:       'build',       // Create something new
  IMPROVE:     'improve',     // Make existing content better
  DEPLOY:      'deploy',      // Publish to an environment
  MAINTAIN:    'maintain',    // Fix, update, or keep healthy
  MOBILE:      'mobile',      // Convert to or optimize for mobile
  EXPERIMENT:  'experiment',  // Run A/B tests or try variations
  ANALYZE:     'analyze',     // Understand performance or issues
};

// ─── Agent type → tool mapping ────────────────────────────────────────────────
const AGENT_TOOL_MAP = {
  planner:    ['project.read', 'memory.read', 'ai.generate'],
  builder:    ['project.read', 'memory.read', 'ai.generate', 'project.write.page', 'project.write.data'],
  design:     ['project.read', 'memory.read', 'pack.read', 'ai.generate', 'project.write.page'],
  growth:     ['project.read', 'memory.read', 'analytics.read', 'ai.generate', 'project.write.page'],
  maintenance:['project.read', 'memory.read', 'ai.generate', 'project.write.page', 'project.write.data'],
  deployment: ['project.read', 'hosting.read', 'hosting.deploy', 'hosting.rollback'],
};

// ─── GoalInterpreter class ────────────────────────────────────────────────────
class GoalInterpreter {
  constructor() {
    /** @type {function|null} LLM call function injected by agentManager */
    this._llmCall = null;
  }

  /**
   * Register the LLM call function.
   * @param {function} llmCall - async (messages) => string
   */
  registerLLM(llmCall) {
    this._llmCall = llmCall;
  }

  /**
   * Interpret a user goal and produce a structured execution plan.
   *
   * @param {object} params
   * @param {string}   params.goal        - The user's high-level goal
   * @param {string}   params.projectId   - Active project ID
   * @param {object}   params.projectContext - Current project state summary
   * @param {string}   params.memorySummary  - Formatted memory summary from agentMemory
   * @param {object}   [params.constraints]  - Active pack constraints, policies, etc.
   * @returns {Promise<Plan>}
   */
  async interpret({ goal, projectId, projectContext, memorySummary, constraints = {} }) {
    const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // If no LLM is available, use rule-based fallback
    if (!this._llmCall) {
      return this._ruleBasedPlan({ planId, goal, projectId });
    }

    const systemPrompt = this._buildSystemPrompt(constraints);
    const userMessage  = this._buildUserMessage({ goal, projectContext, memorySummary });

    let rawPlan;
    try {
      const response = await this._llmCall([
        { role: 'system',    content: systemPrompt },
        { role: 'user',      content: userMessage  },
      ]);
      rawPlan = this._parseLLMResponse(response);
    } catch (err) {
      console.warn('[GoalInterpreter] LLM call failed, using rule-based fallback:', err.message);
      return this._ruleBasedPlan({ planId, goal, projectId });
    }

    // Validate and enrich the LLM-generated plan
    return this._buildPlan({ planId, goal, projectId, rawPlan });
  }

  // ─── Prompt construction ───────────────────────────────────────────────────

  _buildSystemPrompt(constraints) {
    return `You are the Nuvra Goal Interpreter. Your job is to decompose a user's high-level goal into a structured, multi-step execution plan for an autonomous agent system.

AGENT TYPES AVAILABLE:
- planner: Decomposes goals, creates sub-plans, coordinates other agents
- builder: Creates and modifies pages, data models, and app logic
- design: Improves layout, UX, accessibility, and visual design
- growth: Optimizes copy, CTAs, funnels, and conversion
- maintenance: Fixes broken logic, updates dependencies, resolves schema issues
- deployment: Manages deploys, rollbacks, and environments

RULES:
1. Each step must have exactly ONE agent type
2. Steps must be ordered (no circular dependencies)
3. Risk levels: low (read-only or minor changes), medium (content changes), high (structural changes or deploys)
4. Steps with risk=high ALWAYS require approval
5. Maximum 10 steps per plan
6. Be specific — vague steps are not allowed

${constraints.packName ? `ACTIVE DESIGN PACK: ${constraints.packName} — all design steps must respect its rules.` : ''}
${constraints.environment === 'production' ? 'ENVIRONMENT: Production — deployment steps require explicit approval.' : ''}

OUTPUT FORMAT (JSON only, no markdown):
{
  "goalType": "build|improve|deploy|maintain|mobile|experiment|analyze",
  "summary": "One sentence describing the plan",
  "steps": [
    {
      "order": 1,
      "title": "Short title",
      "description": "Detailed description of what this step does and why",
      "agentType": "builder",
      "risk": "low|medium|high",
      "requiresApproval": false,
      "context": {}
    }
  ]
}`;
  }

  _buildUserMessage({ goal, projectContext, memorySummary }) {
    let msg = `USER GOAL: "${goal}"\n\n`;
    if (projectContext) {
      msg += `CURRENT PROJECT STATE:\n${JSON.stringify(projectContext, null, 2)}\n\n`;
    }
    if (memorySummary) {
      msg += `PROJECT MEMORY:\n${memorySummary}\n\n`;
    }
    msg += 'Generate the execution plan as JSON.';
    return msg;
  }

  // ─── Response parsing ──────────────────────────────────────────────────────

  _parseLLMResponse(response) {
    // Extract JSON from the response (handle markdown code blocks)
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ||
                      response.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch ? jsonMatch[1] : response;
    return JSON.parse(jsonStr.trim());
  }

  // ─── Plan construction ─────────────────────────────────────────────────────

  _buildPlan({ planId, goal, projectId, rawPlan }) {
    const steps = (rawPlan.steps || []).map((step, idx) => ({
      id:              `step_${planId}_${idx + 1}`,
      order:           step.order || idx + 1,
      title:           step.title || `Step ${idx + 1}`,
      description:     step.description || '',
      agentType:       step.agentType || 'builder',
      tools:           AGENT_TOOL_MAP[step.agentType] || AGENT_TOOL_MAP.builder,
      risk:            step.risk || 'medium',
      requiresApproval: step.requiresApproval || step.risk === 'high',
      dependsOn:       step.dependsOn || (idx > 0 ? [`step_${planId}_${idx}`] : []),
      context:         step.context || {},
    }));

    return {
      id:        planId,
      goal,
      goalType:  rawPlan.goalType || GOAL_TYPES.BUILD,
      summary:   rawPlan.summary || `Execute: ${goal}`,
      steps:     steps.sort((a, b) => a.order - b.order),
      createdAt: new Date().toISOString(),
      status:    'pending',
      projectId,
    };
  }

  // ─── Rule-based fallback ───────────────────────────────────────────────────

  _ruleBasedPlan({ planId, goal, projectId }) {
    const lower = goal.toLowerCase();

    // Classify the goal
    let goalType = GOAL_TYPES.BUILD;
    if (lower.includes('improv') || lower.includes('better') || lower.includes('optim')) goalType = GOAL_TYPES.IMPROVE;
    else if (lower.includes('deploy') || lower.includes('launch') || lower.includes('publish')) goalType = GOAL_TYPES.DEPLOY;
    else if (lower.includes('fix') || lower.includes('maintain') || lower.includes('update')) goalType = GOAL_TYPES.MAINTAIN;
    else if (lower.includes('mobile') || lower.includes('app') || lower.includes('android') || lower.includes('ios')) goalType = GOAL_TYPES.MOBILE;

    // Generate a sensible default plan based on goal type
    const stepTemplates = {
      [GOAL_TYPES.BUILD]: [
        { title: 'Analyze goal and create plan',    agentType: 'planner',    risk: 'low',    requiresApproval: false },
        { title: 'Generate initial page structure', agentType: 'builder',    risk: 'medium', requiresApproval: true  },
        { title: 'Apply design system',             agentType: 'design',     risk: 'low',    requiresApproval: false },
        { title: 'Review and refine content',       agentType: 'growth',     risk: 'low',    requiresApproval: true  },
      ],
      [GOAL_TYPES.IMPROVE]: [
        { title: 'Analyze current performance',     agentType: 'planner',    risk: 'low',    requiresApproval: false },
        { title: 'Identify improvement areas',      agentType: 'growth',     risk: 'low',    requiresApproval: false },
        { title: 'Apply improvements',              agentType: 'design',     risk: 'medium', requiresApproval: true  },
      ],
      [GOAL_TYPES.DEPLOY]: [
        { title: 'Validate project for deployment', agentType: 'maintenance', risk: 'low',   requiresApproval: false },
        { title: 'Deploy to environment',           agentType: 'deployment',  risk: 'high',  requiresApproval: true  },
      ],
      [GOAL_TYPES.MAINTAIN]: [
        { title: 'Diagnose issues',                 agentType: 'maintenance', risk: 'low',   requiresApproval: false },
        { title: 'Apply fixes',                     agentType: 'maintenance', risk: 'medium',requiresApproval: true  },
      ],
      [GOAL_TYPES.MOBILE]: [
        { title: 'Analyze mobile readiness',        agentType: 'planner',    risk: 'low',    requiresApproval: false },
        { title: 'Optimize layout for mobile',      agentType: 'design',     risk: 'medium', requiresApproval: true  },
        { title: 'Generate mobile build config',    agentType: 'builder',    risk: 'medium', requiresApproval: true  },
      ],
    };

    const templates = stepTemplates[goalType] || stepTemplates[GOAL_TYPES.BUILD];
    const steps = templates.map((t, idx) => ({
      id:              `step_${planId}_${idx + 1}`,
      order:           idx + 1,
      title:           t.title,
      description:     `${t.title} for goal: "${goal}"`,
      agentType:       t.agentType,
      tools:           AGENT_TOOL_MAP[t.agentType] || AGENT_TOOL_MAP.builder,
      risk:            t.risk,
      requiresApproval: t.requiresApproval,
      dependsOn:       idx > 0 ? [`step_${planId}_${idx}`] : [],
      context:         { originalGoal: goal },
    }));

    return {
      id:        planId,
      goal,
      goalType,
      summary:   `Rule-based plan for: ${goal}`,
      steps,
      createdAt: new Date().toISOString(),
      status:    'pending',
      projectId,
    };
  }
}

export const goalInterpreter = new GoalInterpreter();
