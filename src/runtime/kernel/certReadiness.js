/**
 * Nuvra Runtime Kernel — certReadiness.js (Phase 16)
 *
 * Certification Readiness Assessor. Uses the SOC 2 Mapper output to generate
 * a structured readiness report with a prioritized remediation roadmap.
 *
 * Outputs:
 *   - Readiness level (not-ready / in-progress / type1-ready / type2-ready)
 *   - Gap analysis with prioritized remediation steps
 *   - Estimated time to readiness
 *   - Evidence package checklist
 *   - Auditor-ready summary
 *
 * @module runtime/certReadiness
 */
'use strict';

import { evaluate as soc2Evaluate } from './soc2Mapper.js';

// ─── Readiness Levels ─────────────────────────────────────────────────────────
export const READINESS_LEVEL = Object.freeze({
  NOT_READY:   'not-ready',
  IN_PROGRESS: 'in-progress',
  TYPE1_READY: 'type1-ready',
  TYPE2_READY: 'type2-ready',
});

// ─── Remediation Effort Estimates ─────────────────────────────────────────────
const EFFORT_ESTIMATES = {
  'policyEngine':          { days: 1,  description: 'Enable policy engine in Admin Console' },
  'auditLogger':           { days: 0,  description: 'Audit logging is always active' },
  'complianceEngine':      { days: 1,  description: 'Run first compliance evaluation' },
  'aiGatekeeper':          { days: 1,  description: 'Enable AI gatekeeper in Runtime Console' },
  'authManager':           { days: 2,  description: 'Configure authentication provider' },
  'identityService':       { days: 3,  description: 'Configure SSO/SAML provider' },
  'dataClassifier':        { days: 1,  description: 'Enable data classification in compliance settings' },
  'observabilityService':  { days: 1,  description: 'Enable uptime monitoring in Deploy panel' },
  'supplyChainSecurity':   { days: 1,  description: 'Enable supply chain security in marketplace settings' },
  'explainabilityLedger':  { days: 0,  description: 'Explainability ledger is always active when AI gatekeeper is enabled' },
};

// ─── Assess Readiness ─────────────────────────────────────────────────────────
/**
 * Assess SOC 2 readiness and generate a remediation roadmap.
 * @param {object} systemState - Current state of all Nuvra systems
 * @returns {ReadinessReport}
 */
export function assess(systemState = {}) {
  const soc2Result = soc2Evaluate(systemState);

  const gaps = soc2Result.criteria
    .filter(c => !c.met)
    .flatMap(c => c.gaps.map(gap => ({
      criterionId:   c.id,
      criterionTitle: c.title,
      gap,
      category:      c.category,
      priority:      _gapPriority(c.category),
    })));

  gaps.sort((a, b) => a.priority - b.priority);

  const remediationSteps = _buildRemediationSteps(gaps);
  const estimatedDays    = remediationSteps.reduce((sum, s) => sum + s.estimatedDays, 0);

  const evidenceChecklist = _buildEvidenceChecklist(soc2Result);

  return {
    assessedAt:      new Date().toISOString(),
    readinessLevel:  soc2Result.readinessLevel,
    score:           soc2Result.score,
    totalCriteria:   soc2Result.total,
    metCriteria:     soc2Result.met,
    unmetCriteria:   soc2Result.unmet,
    byCategory:      soc2Result.byCategory,
    gaps,
    remediationSteps,
    estimatedDaysToType1: estimatedDays,
    estimatedDaysToType2: estimatedDays + 90, // Type II requires 6-12 months of evidence
    evidenceChecklist,
    auditorSummary:  _buildAuditorSummary(soc2Result),
  };
}

// ─── Private Helpers ──────────────────────────────────────────────────────────
function _gapPriority(category) {
  const priorities = { CC: 1, A: 2, C: 3, PI: 4, P: 5 };
  return priorities[category] || 99;
}

function _buildRemediationSteps(gaps) {
  const seen  = new Set();
  const steps = [];

  for (const gap of gaps) {
    // Extract the control name from the gap message
    const controlMatch = gap.gap.match(/^(\w+)/);
    const control = controlMatch ? controlMatch[1] : null;

    if (control && !seen.has(control)) {
      seen.add(control);
      const estimate = EFFORT_ESTIMATES[control];
      if (estimate) {
        steps.push({
          control,
          description:    estimate.description,
          estimatedDays:  estimate.days,
          affectedCriteria: [gap.criterionId],
          priority:       gap.priority,
        });
      }
    }
  }

  // Add any remaining gaps as generic steps
  for (const gap of gaps) {
    const alreadyCovered = steps.some(s => s.affectedCriteria.includes(gap.criterionId));
    if (!alreadyCovered) {
      steps.push({
        control:          gap.criterionId,
        description:      gap.gap,
        estimatedDays:    3,
        affectedCriteria: [gap.criterionId],
        priority:         gap.priority,
      });
    }
  }

  return steps.sort((a, b) => a.priority - b.priority);
}

function _buildEvidenceChecklist(soc2Result) {
  return [
    {
      item:        'Policy documentation',
      description: 'Export current policy configuration from Admin Console',
      available:   soc2Result.criteria.find(c => c.id === 'CC1.1')?.met || false,
    },
    {
      item:        'Audit log export',
      description: 'Export audit logs for the observation period',
      available:   soc2Result.criteria.find(c => c.id === 'CC7.1')?.met || false,
    },
    {
      item:        'AI decision log',
      description: 'Export explainability ledger for the observation period',
      available:   soc2Result.criteria.find(c => c.id === 'PI1.1')?.met || false,
    },
    {
      item:        'Compliance simulation report',
      description: 'Run and export the compliance simulation suite',
      available:   true,
    },
    {
      item:        'Access control matrix',
      description: 'Export role assignments and permission matrix from Admin Console',
      available:   soc2Result.criteria.find(c => c.id === 'CC6.1')?.met || false,
    },
    {
      item:        'Incident response log',
      description: 'Document any security incidents and responses',
      available:   false, // Requires manual documentation
    },
    {
      item:        'Vendor risk assessment',
      description: 'Export marketplace extension trust scores and integrity reports',
      available:   soc2Result.criteria.find(c => c.id === 'CC9.1')?.met || false,
    },
    {
      item:        'Deploy history',
      description: 'Export deployment history with rollback capability evidence',
      available:   soc2Result.criteria.find(c => c.id === 'A1.2')?.met || false,
    },
  ];
}

function _buildAuditorSummary(soc2Result) {
  const level = soc2Result.readinessLevel;
  const score = parseFloat(soc2Result.score);

  const levelDescriptions = {
    'not-ready':   'The system does not yet meet the minimum requirements for SOC 2 Type I readiness.',
    'in-progress': 'The system is making progress toward SOC 2 Type I readiness. Several controls require attention.',
    'type1-ready': 'The system meets the requirements for SOC 2 Type I readiness. A point-in-time audit can be initiated.',
    'type2-ready': 'The system meets the requirements for SOC 2 Type II readiness. An observation-period audit can be initiated.',
  };

  return {
    level,
    score,
    summary: levelDescriptions[level] || 'Unknown readiness level.',
    metCriteria:   soc2Result.met,
    totalCriteria: soc2Result.total,
    generatedAt:   new Date().toISOString(),
    generatedBy:   'Nuvra Runtime Kernel — certReadiness.js',
  };
}

export const certReadiness = { assess };
export default certReadiness;
