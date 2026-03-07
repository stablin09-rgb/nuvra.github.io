/**
 * Nuvra — designAgent.js (Phase 14)
 *
 * The Design Agent improves layout, UX, accessibility, and visual design.
 * It respects active Design AI Pack constraints.
 *
 * Declared tools: project.read, memory.read, pack.read, ai.generate, project.write.page
 *
 * @module designAgent
 */
'use strict';

import { agentMemory, MEMORY_CATEGORY } from '../agentMemory.js';

export function createDesignAgent(plan, step) {
  return {
    execute: async ({ tools, context }) => {
      const { originalGoal } = context;

      // 1. Read project and pack constraints
      const project     = await tools['project.read']({ fields: ['pages'] });
      const packRules   = await tools['pack.read']({ fields: ['constraints', 'tokens'] });
      const memory      = await tools['memory.read']({ categories: ['brand', 'preferences'] });

      // 2. Pick the page to improve (first page, or specified in context)
      const targetPage = context.targetPage || project?.pages?.[0];
      if (!targetPage) {
        return { success: false, error: 'No pages found to improve' };
      }

      // 3. Generate design improvements
      const packContext = packRules?.constraints
        ? `Active Design Pack rules: ${JSON.stringify(packRules.constraints)}`
        : 'No active design pack.';

      const generation = await tools['ai.generate']({
        systemPrompt: `You are the Nuvra Design Agent. Improve the visual design and UX of a page.

${packContext}

RULES:
- Respect all active Design Pack constraints
- Improve accessibility (WCAG 2.1 AA minimum)
- Improve visual hierarchy and whitespace
- Do NOT change the page's core content or structure
- Return JSON: { "improvedHtml": "...", "improvedCss": "...", "changes": ["list of changes made"] }`,
        userPrompt: `Page to improve: "${targetPage.name}"
Current HTML (first 2000 chars): ${(targetPage.html || '').slice(0, 2000)}
Brand memory: ${memory?.summary || 'No brand context'}
Goal: "${originalGoal || plan?.goal}"`,
        maxTokens: 4000,
      });

      let designData = null;
      if (generation?.content) {
        try {
          const match = generation.content.match(/\{[\s\S]*\}/);
          if (match) designData = JSON.parse(match[0]);
        } catch { /* non-fatal */ }
      }

      if (!designData) {
        return { success: false, error: 'Design agent could not parse AI-generated improvements' };
      }

      // 4. Store design decisions in memory
      if (designData.changes?.length) {
        agentMemory.write({
          category: MEMORY_CATEGORY.DECISIONS,
          key:      `design.changes.${Date.now()}`,
          value:    designData.changes.join('; '),
          source:   'design',
        });
      }

      // 5. Propose the page update
      const proposal = await tools['project.write.page']({
        name:   targetPage.name,
        html:   designData.improvedHtml || targetPage.html,
        css:    designData.improvedCss  || targetPage.css,
        source: 'design_agent',
        planId: plan?.id,
        stepId: step.id,
        diff:   designData.changes,
      });

      return {
        agentType:  'design',
        stepId:     step.id,
        proposalId: proposal?.proposalId,
        changes:    designData.changes || [],
        tokensUsed: generation?.tokensUsed || 0,
        output:     `Improved design of "${targetPage.name}": ${(designData.changes || []).join(', ')}`,
      };
    },
  };
}
