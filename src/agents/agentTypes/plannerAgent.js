/**
 * Nuvra — plannerAgent.js (Phase 14)
 *
 * The Planner Agent decomposes complex goals, coordinates other agents,
 * and creates sub-plans for multi-phase work. It is the "meta-agent"
 * that orchestrates the rest.
 *
 * Declared tools: project.read, memory.read, ai.generate
 *
 * @module plannerAgent
 */
'use strict';

import { agentMemory, MEMORY_CATEGORY } from '../agentMemory.js';

export function createPlannerAgent(plan, step) {
  return {
    /**
     * Execute the planner step.
     * @param {object} params
     * @param {object} params.tools   - Sandboxed tool interface
     * @param {object} params.context - Step context
     */
    execute: async ({ tools, context }) => {
      const { originalGoal, plan: fullPlan } = context;

      // 1. Read current project state
      const project = await tools['project.read']({ fields: ['pages', 'dataModels', 'settings'] });

      // 2. Read project memory for context
      const memory = await tools['memory.read']({ categories: ['intent', 'brand', 'decisions'] });

      // 3. Analyze the goal with AI
      const analysis = await tools['ai.generate']({
        systemPrompt: `You are the Nuvra Planner Agent. Analyze the project state and the user's goal.
Return a JSON object with:
{
  "analysis": "Brief analysis of the current state",
  "gaps": ["List of things missing to achieve the goal"],
  "recommendations": ["Ordered list of specific actions to take"],
  "risks": ["Potential issues to watch for"]
}`,
        userPrompt: `Goal: "${originalGoal || fullPlan?.goal}"
Project pages: ${JSON.stringify(project?.pages?.map(p => p.name) || [])}
Memory context: ${memory?.summary || 'No memory yet'}`,
        maxTokens: 1000,
      });

      // 4. Store the analysis in memory
      if (analysis?.content) {
        try {
          const parsed = JSON.parse(analysis.content.match(/\{[\s\S]*\}/)?.[0] || '{}');
          if (parsed.analysis) {
            agentMemory.write({
              category: MEMORY_CATEGORY.DECISIONS,
              key:      `planner.analysis.${Date.now()}`,
              value:    parsed.analysis,
              source:   'planner',
            });
          }
        } catch { /* non-fatal */ }
      }

      return {
        agentType: 'planner',
        stepId:    step.id,
        output:    analysis?.content || 'Analysis complete',
        tokensUsed: analysis?.tokensUsed || 0,
      };
    },
  };
}
