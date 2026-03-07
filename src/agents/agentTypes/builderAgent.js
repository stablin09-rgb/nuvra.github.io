/**
 * Nuvra — builderAgent.js (Phase 14)
 *
 * The Builder Agent creates and modifies pages, data models, and app logic.
 * It is the primary content-creation agent.
 *
 * Declared tools: project.read, memory.read, ai.generate,
 *                 project.write.page, project.write.data
 *
 * @module builderAgent
 */
'use strict';

import { agentMemory, MEMORY_CATEGORY } from '../agentMemory.js';

export function createBuilderAgent(plan, step) {
  return {
    execute: async ({ tools, context }) => {
      const { originalGoal } = context;

      // 1. Read project state
      const project = await tools['project.read']({ fields: ['pages', 'settings'] });
      const memory  = await tools['memory.read']({ categories: ['intent', 'brand', 'decisions'] });

      // 2. Generate page content with AI
      const generation = await tools['ai.generate']({
        systemPrompt: `You are the Nuvra Builder Agent. Generate complete, production-ready HTML/CSS
for a page based on the goal and project context.

RULES:
- Use semantic HTML5
- Use CSS custom properties for theming
- Make it responsive (mobile-first)
- Include realistic placeholder content (not "Lorem ipsum")
- Return a JSON object: { "pageName": "...", "html": "...", "css": "..." }`,
        userPrompt: `Goal: "${originalGoal || plan?.goal}"
Step: "${step.title}"
Existing pages: ${JSON.stringify(project?.pages?.map(p => p.name) || [])}
Brand context: ${memory?.summary || 'No brand context'}`,
        maxTokens: 4000,
      });

      // 3. Parse the generated content
      let pageData = null;
      if (generation?.content) {
        try {
          const match = generation.content.match(/\{[\s\S]*\}/);
          if (match) pageData = JSON.parse(match[0]);
        } catch { /* non-fatal */ }
      }

      if (!pageData) {
        return { success: false, error: 'Builder agent could not parse AI-generated content' };
      }

      // 4. Propose the page write (requires approval)
      const proposal = await tools['project.write.page']({
        name:    pageData.pageName || `Page ${Date.now()}`,
        html:    pageData.html || '',
        css:     pageData.css  || '',
        source:  'builder_agent',
        planId:  plan?.id,
        stepId:  step.id,
      });

      return {
        agentType:  'builder',
        stepId:     step.id,
        proposalId: proposal?.proposalId,
        pageName:   pageData.pageName,
        tokensUsed: generation?.tokensUsed || 0,
        output:     `Generated page: "${pageData.pageName}"`,
      };
    },
  };
}
