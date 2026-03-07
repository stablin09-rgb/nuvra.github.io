/**
 * Nuvra — deploymentAgent.js (Phase 14)
 *
 * The Deployment Agent manages deploys, rollbacks, and environment transitions.
 * It always requires explicit approval before executing a deploy.
 *
 * Declared tools: project.read, hosting.read, hosting.deploy, hosting.rollback
 *
 * @module deploymentAgent
 */
'use strict';

import { agentMemory, MEMORY_CATEGORY } from '../agentMemory.js';

export function createDeploymentAgent(plan, step) {
  return {
    execute: async ({ tools, context }) => {
      const { environment = 'staging', rollback = false, rollbackTo } = context;

      // 1. Read current hosting state
      const hostingState = await tools['hosting.read']({ fields: ['deployments', 'status', 'url'] });

      if (rollback) {
        // Rollback path
        const targetVersion = rollbackTo || hostingState?.deployments?.[1]?.id;
        if (!targetVersion) {
          return { success: false, error: 'No previous deployment found to roll back to' };
        }

        // Propose rollback (always requires approval)
        const proposal = await tools['hosting.rollback']({
          deploymentId: targetVersion,
          environment,
          reason:       `Agent-initiated rollback to ${targetVersion}`,
          planId:       plan?.id,
          stepId:       step.id,
        });

        return {
          agentType:  'deployment',
          stepId:     step.id,
          action:     'rollback',
          targetVersion,
          proposalId: proposal?.proposalId,
          output:     `Proposed rollback to deployment ${targetVersion}`,
        };
      }

      // 2. Pre-deployment validation
      const project = await tools['project.read']({ fields: ['pages', 'settings'] });
      const pageCount = project?.pages?.length || 0;

      if (pageCount === 0) {
        return { success: false, error: 'Cannot deploy: project has no pages' };
      }

      // 3. Propose the deploy (always requires approval for production)
      const proposal = await tools['hosting.deploy']({
        environment,
        message:  `Agent deploy: ${plan?.goal || step.title}`,
        planId:   plan?.id,
        stepId:   step.id,
      });

      // 4. Record deployment intent
      agentMemory.write({
        category: MEMORY_CATEGORY.ACTIONS,
        key:      `deployment.proposed.${Date.now()}`,
        value:    { environment, planId: plan?.id, proposalId: proposal?.proposalId },
        source:   'deployment',
      });

      return {
        agentType:   'deployment',
        stepId:      step.id,
        action:      'deploy',
        environment,
        proposalId:  proposal?.proposalId,
        currentUrl:  hostingState?.url,
        output:      `Proposed deployment to ${environment} (${pageCount} pages)`,
      };
    },
  };
}
