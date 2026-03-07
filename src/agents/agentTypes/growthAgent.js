/**
 * Nuvra — growthAgent.js (Phase 14)
 *
 * The Growth Agent optimizes copy, CTAs, funnels, and conversion.
 * It reads analytics data to make evidence-based recommendations.
 *
 * Declared tools: project.read, memory.read, analytics.read, ai.generate, project.write.page
 *
 * @module growthAgent
 */
'use strict';

import { agentMemory, MEMORY_CATEGORY } from '../agentMemory.js';

export function createGrowthAgent(plan, step) {
  return {
    execute: async ({ tools, context }) => {
      const { originalGoal } = context;

      // 1. Read project and analytics
      const project   = await tools['project.read']({ fields: ['pages', 'settings'] });
      const analytics = await tools['analytics.read']({ metrics: ['bounceRate', 'conversionRate', 'topPages'] });
      const memory    = await tools['memory.read']({ categories: ['intent', 'brand'] });

      // 2. Identify the highest-impact page
      const targetPage = context.targetPage || project?.pages?.[0];
      if (!targetPage) {
        return { success: false, error: 'No pages found to optimize' };
      }

      // 3. Generate growth-optimized copy
      const analyticsContext = analytics
        ? `Bounce rate: ${analytics.bounceRate || 'unknown'}, Conversion rate: ${analytics.conversionRate || 'unknown'}`
        : 'No analytics data available.';

      const generation = await tools['ai.generate']({
        systemPrompt: `You are the Nuvra Growth Agent. Optimize a page for conversion and engagement.

FOCUS AREAS:
- Headlines and value propositions (clear, benefit-focused)
- CTA buttons (action-oriented, specific)
- Social proof elements (testimonials, numbers, logos)
- Trust signals (guarantees, security badges)
- Urgency and scarcity (where authentic)

RULES:
- Keep the same page structure
- Only change text content and CTA styling
- Make every word earn its place
- Return JSON: { "optimizedHtml": "...", "changes": ["list of changes"] }`,
        userPrompt: `Page: "${targetPage.name}"
Analytics: ${analyticsContext}
Brand voice: ${memory?.summary || 'Professional and clear'}
Goal: "${originalGoal || plan?.goal}"
Current HTML (first 2000 chars): ${(targetPage.html || '').slice(0, 2000)}`,
        maxTokens: 4000,
      });

      let growthData = null;
      if (generation?.content) {
        try {
          const match = generation.content.match(/\{[\s\S]*\}/);
          if (match) growthData = JSON.parse(match[0]);
        } catch { /* non-fatal */ }
      }

      if (!growthData) {
        return { success: false, error: 'Growth agent could not parse AI-generated optimizations' };
      }

      // 4. Record growth decisions
      if (growthData.changes?.length) {
        agentMemory.write({
          category: MEMORY_CATEGORY.DECISIONS,
          key:      `growth.optimizations.${Date.now()}`,
          value:    growthData.changes.join('; '),
          source:   'growth',
        });
      }

      // 5. Propose the update
      const proposal = await tools['project.write.page']({
        name:   targetPage.name,
        html:   growthData.optimizedHtml || targetPage.html,
        css:    targetPage.css,
        source: 'growth_agent',
        planId: plan?.id,
        stepId: step.id,
        diff:   growthData.changes,
      });

      return {
        agentType:  'growth',
        stepId:     step.id,
        proposalId: proposal?.proposalId,
        changes:    growthData.changes || [],
        tokensUsed: generation?.tokensUsed || 0,
        output:     `Optimized "${targetPage.name}" for growth: ${(growthData.changes || []).join(', ')}`,
      };
    },
  };
}
