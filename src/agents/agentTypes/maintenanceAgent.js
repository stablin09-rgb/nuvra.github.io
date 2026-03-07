/**
 * Nuvra — maintenanceAgent.js (Phase 14)
 *
 * The Maintenance Agent fixes broken logic, updates outdated patterns,
 * resolves schema inconsistencies, and keeps the project healthy.
 *
 * Declared tools: project.read, memory.read, ai.generate,
 *                 project.write.page, project.write.data
 *
 * @module maintenanceAgent
 */
'use strict';

import { agentMemory, MEMORY_CATEGORY } from '../agentMemory.js';

// ─── Known issues to check for ────────────────────────────────────────────────
const HEALTH_CHECKS = [
  { id: 'missing_viewport',   check: html => !html.includes('viewport'),          message: 'Missing viewport meta tag' },
  { id: 'missing_lang',       check: html => !html.includes('lang='),             message: 'Missing lang attribute on <html>' },
  { id: 'empty_alt',          check: html => /<img(?![^>]*alt=)[^>]*>/i.test(html), message: 'Images missing alt attributes' },
  { id: 'inline_styles',      check: html => (html.match(/style="/g) || []).length > 10, message: 'Excessive inline styles (>10)' },
  { id: 'broken_links',       check: html => html.includes('href="#"') || html.includes('href=""'), message: 'Placeholder/broken links detected' },
  { id: 'console_logs',       check: html => html.includes('console.log('),       message: 'console.log() calls in production code' },
];

export function createMaintenanceAgent(plan, step) {
  return {
    execute: async ({ tools, context }) => {
      const { originalGoal } = context;

      // 1. Read all project pages
      const project = await tools['project.read']({ fields: ['pages', 'dataModels'] });
      const pages   = project?.pages || [];

      if (!pages.length) {
        return { success: true, output: 'No pages to maintain', agentType: 'maintenance', stepId: step.id };
      }

      // 2. Run health checks on all pages
      const issues = [];
      for (const page of pages) {
        for (const check of HEALTH_CHECKS) {
          if (check.check(page.html || '')) {
            issues.push({ pageId: page.id, pageName: page.name, ...check });
          }
        }
      }

      // 3. Use AI to diagnose and fix issues
      const issueList = issues.length
        ? issues.map(i => `- [${i.pageName}] ${i.message}`).join('\n')
        : 'No automated issues detected.';

      const generation = await tools['ai.generate']({
        systemPrompt: `You are the Nuvra Maintenance Agent. Diagnose and fix issues in a web project.

ISSUES DETECTED:
${issueList}

For each issue, provide a specific fix. Return JSON:
{
  "fixes": [
    { "pageId": "...", "pageName": "...", "issue": "...", "fix": "brief description", "htmlPatch": "..." }
  ],
  "summary": "Overall health assessment"
}`,
        userPrompt: `Goal: "${originalGoal || plan?.goal}"
Pages: ${pages.map(p => p.name).join(', ')}
Issues found: ${issues.length}`,
        maxTokens: 2000,
      });

      let fixData = null;
      if (generation?.content) {
        try {
          const match = generation.content.match(/\{[\s\S]*\}/);
          if (match) fixData = JSON.parse(match[0]);
        } catch { /* non-fatal */ }
      }

      // 4. Propose fixes for pages with issues
      const proposals = [];
      if (fixData?.fixes?.length) {
        for (const fix of fixData.fixes) {
          const page = pages.find(p => p.id === fix.pageId || p.name === fix.pageName);
          if (!page || !fix.htmlPatch) continue;

          const proposal = await tools['project.write.page']({
            name:   page.name,
            html:   fix.htmlPatch,
            css:    page.css,
            source: 'maintenance_agent',
            planId: plan?.id,
            stepId: step.id,
            diff:   [fix.fix],
          });
          proposals.push(proposal?.proposalId);
        }
      }

      // 5. Record maintenance action
      agentMemory.write({
        category: MEMORY_CATEGORY.DECISIONS,
        key:      `maintenance.health.${Date.now()}`,
        value:    fixData?.summary || `Fixed ${issues.length} issues`,
        source:   'maintenance',
      });

      return {
        agentType:    'maintenance',
        stepId:       step.id,
        issuesFound:  issues.length,
        fixesApplied: proposals.length,
        proposalIds:  proposals,
        tokensUsed:   generation?.tokensUsed || 0,
        output:       fixData?.summary || `Found ${issues.length} issues, proposed ${proposals.length} fixes`,
      };
    },
  };
}
