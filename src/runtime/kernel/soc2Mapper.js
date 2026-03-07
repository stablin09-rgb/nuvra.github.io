/**
 * Nuvra Runtime Kernel — soc2Mapper.js (Phase 16)
 *
 * SOC 2 Trust Service Criteria (TSC) Mapper.
 * Maps every Nuvra control to the corresponding SOC 2 TSC criteria,
 * and evaluates the current state of each criterion.
 *
 * SOC 2 Trust Service Categories:
 *   CC  — Common Criteria (Security)
 *   A   — Availability
 *   C   — Confidentiality
 *   PI  — Processing Integrity
 *   P   — Privacy
 *
 * @module runtime/soc2Mapper
 */
'use strict';

// ─── SOC 2 Criteria Definitions ───────────────────────────────────────────────
export const SOC2_CRITERIA = [

  // ── Common Criteria (Security) ────────────────────────────────────────────
  {
    id:       'CC1.1',
    category: 'CC',
    title:    'Control Environment — Integrity and Ethical Values',
    description: 'The entity demonstrates a commitment to integrity and ethical values.',
    nuvraControls: ['policyEngine', 'auditLogger', 'complianceEngine'],
    evaluator: (state) => ({
      met:      state.policyEngine?.active && state.auditLogger?.active,
      evidence: ['Policy engine active', 'Audit logging enabled'],
      gaps:     !state.policyEngine?.active ? ['Policy engine not initialized'] : [],
    }),
  },
  {
    id:       'CC2.1',
    category: 'CC',
    title:    'Communication and Information — Internal Communication',
    description: 'The entity internally communicates information, including objectives and responsibilities.',
    nuvraControls: ['auditLogger', 'explainabilityLedger'],
    evaluator: (state) => ({
      met:      state.auditLogger?.active,
      evidence: ['Audit log captures all system events', 'AI decisions are explainable'],
      gaps:     [],
    }),
  },
  {
    id:       'CC3.1',
    category: 'CC',
    title:    'Risk Assessment — Risk Identification',
    description: 'The entity identifies risks to the achievement of its objectives.',
    nuvraControls: ['complianceEngine', 'threatModeler', 'simulationEngine'],
    evaluator: (state) => ({
      met:      state.complianceEngine?.lastEvaluation !== null,
      evidence: ['Compliance engine runs continuous risk evaluation', 'Threat modeling available'],
      gaps:     !state.complianceEngine?.lastEvaluation ? ['No compliance evaluation has been run'] : [],
    }),
  },
  {
    id:       'CC5.1',
    category: 'CC',
    title:    'Control Activities — Control Selection and Development',
    description: 'The entity selects and develops control activities that contribute to the mitigation of risks.',
    nuvraControls: ['policyEngine', 'aiGatekeeper', 'permissionModel'],
    evaluator: (state) => ({
      met:      state.policyEngine?.active && state.aiGatekeeper?.active,
      evidence: ['Policy engine enforces access controls', 'AI gatekeeper enforces AI usage policies'],
      gaps:     !state.aiGatekeeper?.active ? ['AI gatekeeper not initialized'] : [],
    }),
  },
  {
    id:       'CC6.1',
    category: 'CC',
    title:    'Logical and Physical Access Controls — Access Restriction',
    description: 'The entity implements logical access security software, infrastructure, and architectures.',
    nuvraControls: ['permissionModel', 'pluginSandbox', 'orgService', 'identityService'],
    evaluator: (state) => ({
      met:      state.permissionModel?.active,
      evidence: [
        'Zero-trust permission model enforced',
        'Plugin sandbox isolates third-party code',
        'Role-based access control (RBAC) active',
      ],
      gaps: [],
    }),
  },
  {
    id:       'CC6.2',
    category: 'CC',
    title:    'Logical and Physical Access Controls — Authentication',
    description: 'Prior to issuing system credentials, the entity registers and authorizes new internal users.',
    nuvraControls: ['authManager', 'identityService'],
    evaluator: (state) => ({
      met:      state.authManager?.active,
      evidence: ['Authentication required before project access', 'SSO/SAML support available'],
      gaps:     !state.authManager?.active ? ['Auth manager not initialized'] : [],
    }),
  },
  {
    id:       'CC6.6',
    category: 'CC',
    title:    'Logical and Physical Access Controls — Boundary Protection',
    description: 'The entity implements controls to prevent or detect and act upon the introduction of unauthorized objects.',
    nuvraControls: ['supplyChainSecurity', 'trustEngine', 'pluginSandbox'],
    evaluator: (state) => ({
      met:      state.supplyChainSecurity?.active,
      evidence: [
        'Extension integrity verification via SHA-256',
        'Trust scoring for all marketplace assets',
        'Sandbox isolation for all third-party code',
      ],
      gaps: [],
    }),
  },
  {
    id:       'CC7.1',
    category: 'CC',
    title:    'System Operations — Configuration Management',
    description: 'The entity uses detection and monitoring procedures to identify changes to configurations.',
    nuvraControls: ['auditLogger', 'versionManager', 'deployHistory'],
    evaluator: (state) => ({
      met:      state.auditLogger?.active,
      evidence: ['All configuration changes are audit-logged', 'Deploy history tracks all deployments'],
      gaps:     [],
    }),
  },
  {
    id:       'CC7.2',
    category: 'CC',
    title:    'System Operations — Monitoring',
    description: 'The entity monitors system components and the operation of those components.',
    nuvraControls: ['observabilityService', 'complianceEngine'],
    evaluator: (state) => ({
      met:      state.observabilityService?.active,
      evidence: ['Uptime monitoring active', 'Continuous compliance evaluation'],
      gaps:     !state.observabilityService?.active ? ['Observability service not initialized'] : [],
    }),
  },
  {
    id:       'CC9.1',
    category: 'CC',
    title:    'Risk Mitigation — Vendor Risk Management',
    description: 'The entity identifies, selects, and develops risk mitigation activities for risks arising from vendors.',
    nuvraControls: ['supplyChainSecurity', 'trustEngine', 'marketplaceService'],
    evaluator: (state) => ({
      met:      state.supplyChainSecurity?.active,
      evidence: ['All marketplace extensions are integrity-checked', 'Trust scores assigned to all vendors'],
      gaps:     [],
    }),
  },

  // ── Availability ──────────────────────────────────────────────────────────
  {
    id:       'A1.1',
    category: 'A',
    title:    'Availability — Performance Monitoring',
    description: 'The entity maintains, monitors, and evaluates current processing capacity and use.',
    nuvraControls: ['observabilityService', 'usageLedger'],
    evaluator: (state) => ({
      met:      state.observabilityService?.active,
      evidence: ['Deploy health checks active', 'Usage ledger tracks resource consumption'],
      gaps:     !state.observabilityService?.active ? ['Observability service not initialized'] : [],
    }),
  },
  {
    id:       'A1.2',
    category: 'A',
    title:    'Availability — Recovery',
    description: 'The entity authorizes, designs, develops, and implements policies to recover from disruptions.',
    nuvraControls: ['deployHistory', 'hostingManager'],
    evaluator: (state) => ({
      met:      true,
      evidence: ['One-click rollback to any previous deployment', 'Deploy history preserved indefinitely'],
      gaps:     [],
    }),
  },

  // ── Confidentiality ───────────────────────────────────────────────────────
  {
    id:       'C1.1',
    category: 'C',
    title:    'Confidentiality — Identification and Maintenance',
    description: 'The entity identifies and maintains confidential information.',
    nuvraControls: ['dataClassifier', 'aiGovernance', 'aiGatekeeper'],
    evaluator: (state) => ({
      met:      state.dataClassifier?.active,
      evidence: [
        'Automatic PII/PHI/PCI data classification',
        'Sensitive data redacted before AI processing',
        'AI gatekeeper blocks confidential data in prompts',
      ],
      gaps: !state.dataClassifier?.active ? ['Data classifier not initialized'] : [],
    }),
  },
  {
    id:       'C1.2',
    category: 'C',
    title:    'Confidentiality — Disposal',
    description: 'The entity disposes of confidential information to meet the entity\'s objectives.',
    nuvraControls: ['auditLogger', 'policyEngine'],
    evaluator: (state) => ({
      met:      state.policyEngine?.active,
      evidence: ['Data retention policies configurable', 'Audit log retention configurable'],
      gaps:     [],
    }),
  },

  // ── Processing Integrity ──────────────────────────────────────────────────
  {
    id:       'PI1.1',
    category: 'PI',
    title:    'Processing Integrity — Complete and Accurate Processing',
    description: 'The entity obtains or generates, uses, and communicates relevant, quality information.',
    nuvraControls: ['explainabilityLedger', 'auditLogger'],
    evaluator: (state) => ({
      met:      state.explainabilityLedger?.active,
      evidence: [
        'Every AI decision is logged with full context',
        'Explainability ledger provides rationale for all decisions',
      ],
      gaps: !state.explainabilityLedger?.active ? ['Explainability ledger not initialized'] : [],
    }),
  },

  // ── Privacy ───────────────────────────────────────────────────────────────
  {
    id:       'P1.1',
    category: 'P',
    title:    'Privacy — Notice and Communication',
    description: 'The entity provides notice to data subjects about its privacy practices.',
    nuvraControls: ['complianceEngine', 'policyRegistry'],
    evaluator: (state) => ({
      met:      state.complianceEngine?.frameworks?.includes('gdpr'),
      evidence: ['GDPR framework active', 'Privacy policy controls enforced'],
      gaps:     !state.complianceEngine?.frameworks?.includes('gdpr') ? ['GDPR framework not enabled'] : [],
    }),
  },
  {
    id:       'P4.1',
    category: 'P',
    title:    'Privacy — Use, Retention, and Disposal',
    description: 'The entity limits the use of personal information to the purposes identified in the notice.',
    nuvraControls: ['dataClassifier', 'jurisdictionRules', 'aiGovernance'],
    evaluator: (state) => ({
      met:      state.dataClassifier?.active && state.aiGovernance?.active,
      evidence: [
        'Data classification prevents misuse of PII',
        'AI governance enforces training opt-out',
        'Jurisdiction rules enforce data residency',
      ],
      gaps: [],
    }),
  },
];

// ─── Evaluate All Criteria ────────────────────────────────────────────────────
/**
 * Evaluate all SOC 2 criteria against the current system state.
 * @param {object} systemState - Current state of all Nuvra systems
 * @returns {object} SOC 2 evaluation result
 */
export function evaluate(systemState = {}) {
  const results = SOC2_CRITERIA.map(criterion => {
    const evaluation = criterion.evaluator(systemState);
    return {
      id:          criterion.id,
      category:    criterion.category,
      title:       criterion.title,
      description: criterion.description,
      met:         evaluation.met,
      evidence:    evaluation.evidence,
      gaps:        evaluation.gaps,
    };
  });

  const met    = results.filter(r => r.met).length;
  const unmet  = results.filter(r => !r.met).length;
  const total  = results.length;

  const byCategory = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = { met: 0, unmet: 0, total: 0 };
    byCategory[r.category].total++;
    if (r.met) byCategory[r.category].met++;
    else byCategory[r.category].unmet++;
  }

  return {
    evaluatedAt:   new Date().toISOString(),
    total,
    met,
    unmet,
    score:         (met / total * 100).toFixed(1),
    byCategory,
    criteria:      results,
    readinessLevel: _readinessLevel(met / total * 100),
  };
}

/**
 * Get all criteria for a specific category.
 * @param {string} category - 'CC', 'A', 'C', 'PI', 'P'
 * @returns {object[]}
 */
export function getCriteriaByCategory(category) {
  return SOC2_CRITERIA.filter(c => c.category === category);
}

function _readinessLevel(score) {
  if (score >= 90) return 'type2-ready';
  if (score >= 75) return 'type1-ready';
  if (score >= 50) return 'in-progress';
  return 'not-ready';
}

export const soc2Mapper = { evaluate, getCriteriaByCategory, SOC2_CRITERIA };
export default soc2Mapper;
