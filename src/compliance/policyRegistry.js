/**
 * Nuvra — policyRegistry.js (Phase 15)
 *
 * The single source of truth for all regulatory framework definitions.
 * Policies are pure data — no hardcoded logic. The complianceEngine
 * interprets and enforces them.
 *
 * Each framework defines:
 *   - id, name, version, jurisdiction
 *   - rules: an array of PolicyRule objects
 *   - Each rule has: id, category, severity, description, check, remediation
 *
 * Severity levels: 'blocker' | 'critical' | 'warning' | 'info'
 * Check types:     'field' | 'collection' | 'page' | 'project' | 'agent' | 'deploy' | 'export'
 *
 * @module compliance/policyRegistry
 */
'use strict';

// ─── Policy Rule Severity ─────────────────────────────────────────────────────
export const SEVERITY = Object.freeze({
  BLOCKER:  'blocker',   // Blocks the action entirely
  CRITICAL: 'critical',  // Requires explicit human approval
  WARNING:  'warning',   // Warns but allows with acknowledgement
  INFO:     'info',      // Advisory only
});

// ─── Data Classes (used by rules) ────────────────────────────────────────────
export const DATA_CLASS = Object.freeze({
  PUBLIC:     'public',
  INTERNAL:   'internal',
  PERSONAL:   'personal',
  SENSITIVE:  'sensitive',
  REGULATED:  'regulated',  // health, financial, biometric
});

// ─── Regulatory Framework Definitions ────────────────────────────────────────

const GDPR = {
  id: 'gdpr',
  name: 'GDPR / UK GDPR',
  version: '2018',
  jurisdiction: ['EU', 'UK', 'EEA'],
  description: 'General Data Protection Regulation — EU and UK data privacy law.',
  rules: [
    {
      id: 'gdpr-001',
      category: 'data-collection',
      severity: SEVERITY.BLOCKER,
      description: 'Personal data fields must have a declared lawful basis for processing.',
      checkType: 'field',
      check: (field) => {
        if (field.dataClass === DATA_CLASS.PERSONAL || field.dataClass === DATA_CLASS.SENSITIVE) {
          return !!field.legalBasis;
        }
        return true;
      },
      remediation: 'Add a `legalBasis` property to the field definition (e.g., "consent", "contract", "legitimate_interest").',
      reference: 'GDPR Art. 6',
    },
    {
      id: 'gdpr-002',
      category: 'data-collection',
      severity: SEVERITY.BLOCKER,
      description: 'Special category data (health, biometric, etc.) requires explicit consent.',
      checkType: 'field',
      check: (field) => {
        if (field.dataClass === DATA_CLASS.REGULATED) {
          return field.legalBasis === 'explicit_consent' && field.consentMechanism;
        }
        return true;
      },
      remediation: 'Set `legalBasis: "explicit_consent"` and provide a `consentMechanism` (e.g., a reference to a consent form component).',
      reference: 'GDPR Art. 9',
    },
    {
      id: 'gdpr-003',
      category: 'data-residency',
      severity: SEVERITY.BLOCKER,
      description: 'Personal data cannot be transferred outside the EEA without adequate safeguards.',
      checkType: 'deploy',
      check: (deployConfig) => {
        const hasPersonalData = deployConfig.dataClasses?.includes(DATA_CLASS.PERSONAL);
        if (!hasPersonalData) return true;
        const allowedRegions = ['eu-west-1', 'eu-central-1', 'eu-north-1', 'eu-south-1', 'eu-west-2', 'eu-west-3'];
        const region = deployConfig.region;
        const hasAdequacyDecision = deployConfig.adequacyDecision;
        const hasSCCs = deployConfig.standardContractualClauses;
        return allowedRegions.includes(region) || hasAdequacyDecision || hasSCCs;
      },
      remediation: 'Deploy to an EU region, or configure `adequacyDecision: true` or `standardContractualClauses: true` in your deployment config.',
      reference: 'GDPR Art. 44-49',
    },
    {
      id: 'gdpr-004',
      category: 'data-retention',
      severity: SEVERITY.WARNING,
      description: 'Collections storing personal data should define a retention policy.',
      checkType: 'collection',
      check: (collection) => {
        const hasPersonalData = collection.fields?.some(f =>
          f.dataClass === DATA_CLASS.PERSONAL || f.dataClass === DATA_CLASS.SENSITIVE
        );
        if (!hasPersonalData) return true;
        return !!collection.retentionPolicy;
      },
      remediation: 'Add a `retentionPolicy` object to the collection definition with `duration` and `action` ("delete" or "anonymize").',
      reference: 'GDPR Art. 5(1)(e)',
    },
    {
      id: 'gdpr-005',
      category: 'user-rights',
      severity: SEVERITY.WARNING,
      description: 'Apps collecting personal data should provide a privacy policy page.',
      checkType: 'project',
      check: (project) => {
        const hasPersonalData = project.collections?.some(c =>
          c.fields?.some(f => f.dataClass === DATA_CLASS.PERSONAL)
        );
        if (!hasPersonalData) return true;
        return project.pages?.some(p =>
          p.name?.toLowerCase().includes('privacy') ||
          p.slug?.toLowerCase().includes('privacy')
        );
      },
      remediation: 'Create a page named "Privacy Policy" or with slug "privacy-policy".',
      reference: 'GDPR Art. 13-14',
    },
    {
      id: 'gdpr-006',
      category: 'consent',
      severity: SEVERITY.CRITICAL,
      description: 'Forms collecting personal data must include a consent checkbox.',
      checkType: 'page',
      check: (page) => {
        const hasPersonalInput = page.components?.some(c =>
          c.type === 'form' && c.fields?.some(f => f.dataClass === DATA_CLASS.PERSONAL)
        );
        if (!hasPersonalInput) return true;
        return page.components?.some(c =>
          c.type === 'form' && c.fields?.some(f => f.type === 'consent-checkbox')
        );
      },
      remediation: 'Add a consent checkbox component to the form.',
      reference: 'GDPR Art. 7',
    },
  ],
};

const HIPAA = {
  id: 'hipaa',
  name: 'HIPAA',
  version: '1996/2013',
  jurisdiction: ['US'],
  description: 'Health Insurance Portability and Accountability Act — US healthcare data privacy.',
  rules: [
    {
      id: 'hipaa-001',
      category: 'phi-protection',
      severity: SEVERITY.BLOCKER,
      description: 'Protected Health Information (PHI) fields must be encrypted at rest.',
      checkType: 'field',
      check: (field) => {
        if (field.dataClass === DATA_CLASS.REGULATED && field.regulatedType === 'health') {
          return field.encryptedAtRest === true;
        }
        return true;
      },
      remediation: 'Set `encryptedAtRest: true` on all PHI fields.',
      reference: 'HIPAA Security Rule §164.312(a)(2)(iv)',
    },
    {
      id: 'hipaa-002',
      category: 'phi-protection',
      severity: SEVERITY.BLOCKER,
      description: 'PHI must not be exposed in public-facing pages without authentication.',
      checkType: 'page',
      check: (page) => {
        const exposesPHI = page.components?.some(c =>
          c.dataBinding?.dataClass === DATA_CLASS.REGULATED &&
          c.dataBinding?.regulatedType === 'health'
        );
        if (!exposesPHI) return true;
        return page.requiresAuth === true;
      },
      remediation: 'Set `requiresAuth: true` on pages that display PHI.',
      reference: 'HIPAA Privacy Rule §164.502',
    },
    {
      id: 'hipaa-003',
      category: 'access-control',
      severity: SEVERITY.CRITICAL,
      description: 'Applications handling PHI must implement role-based access control.',
      checkType: 'project',
      check: (project) => {
        const handlesPHI = project.collections?.some(c =>
          c.fields?.some(f => f.dataClass === DATA_CLASS.REGULATED && f.regulatedType === 'health')
        );
        if (!handlesPHI) return true;
        return project.rbacEnabled === true;
      },
      remediation: 'Enable `rbacEnabled: true` in your project settings and define role-based access rules.',
      reference: 'HIPAA Security Rule §164.312(a)(1)',
    },
    {
      id: 'hipaa-004',
      category: 'audit',
      severity: SEVERITY.CRITICAL,
      description: 'All access to PHI must be logged in the audit trail.',
      checkType: 'project',
      check: (project) => {
        const handlesPHI = project.collections?.some(c =>
          c.fields?.some(f => f.dataClass === DATA_CLASS.REGULATED && f.regulatedType === 'health')
        );
        if (!handlesPHI) return true;
        return project.auditLoggingEnabled === true;
      },
      remediation: 'Enable `auditLoggingEnabled: true` in your project settings.',
      reference: 'HIPAA Security Rule §164.312(b)',
    },
    {
      id: 'hipaa-005',
      category: 'data-residency',
      severity: SEVERITY.BLOCKER,
      description: 'PHI must be hosted within the United States.',
      checkType: 'deploy',
      check: (deployConfig) => {
        const handlesPHI = deployConfig.dataClasses?.includes(DATA_CLASS.REGULATED) &&
          deployConfig.regulatedTypes?.includes('health');
        if (!handlesPHI) return true;
        const usRegions = ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'us-gov-west-1'];
        return usRegions.includes(deployConfig.region);
      },
      remediation: 'Deploy to a US region (e.g., us-east-1).',
      reference: 'HIPAA Security Rule §164.308(a)(1)',
    },
    {
      id: 'hipaa-006',
      category: 'agent-restriction',
      severity: SEVERITY.BLOCKER,
      description: 'AI agents must not process PHI without explicit HIPAA mode enabled.',
      checkType: 'agent',
      check: (agentPlan, projectConfig) => {
        const touchesPHI = agentPlan.steps?.some(s =>
          s.params?.dataClass === DATA_CLASS.REGULATED &&
          s.params?.regulatedType === 'health'
        );
        if (!touchesPHI) return true;
        return projectConfig.hipaaMode === true;
      },
      remediation: 'Enable `hipaaMode: true` in your project compliance settings before running agents on PHI data.',
      reference: 'HIPAA Security Rule §164.308(a)(3)',
    },
  ],
};

const SOC2 = {
  id: 'soc2',
  name: 'SOC 2 (Type I & II)',
  version: '2017',
  jurisdiction: ['US', 'GLOBAL'],
  description: 'Service Organization Control 2 — security, availability, processing integrity, confidentiality, and privacy.',
  rules: [
    {
      id: 'soc2-001',
      category: 'access-control',
      severity: SEVERITY.CRITICAL,
      description: 'Multi-factor authentication must be enabled for all admin accounts.',
      checkType: 'project',
      check: (project) => project.mfaRequired !== false,
      remediation: 'Set `mfaRequired: true` in your project security settings.',
      reference: 'SOC 2 CC6.1',
    },
    {
      id: 'soc2-002',
      category: 'encryption',
      severity: SEVERITY.CRITICAL,
      description: 'All data in transit must use TLS 1.2 or higher.',
      checkType: 'deploy',
      check: (deployConfig) => deployConfig.tlsVersion >= 1.2,
      remediation: 'Ensure your hosting configuration enforces TLS 1.2+ (this is the default for Nuvra cloud hosting).',
      reference: 'SOC 2 CC6.7',
    },
    {
      id: 'soc2-003',
      category: 'availability',
      severity: SEVERITY.WARNING,
      description: 'Production deployments should have a defined uptime SLA.',
      checkType: 'deploy',
      check: (deployConfig) => !!deployConfig.uptimeSLA,
      remediation: 'Define an `uptimeSLA` in your deployment configuration.',
      reference: 'SOC 2 A1.1',
    },
    {
      id: 'soc2-004',
      category: 'change-management',
      severity: SEVERITY.WARNING,
      description: 'All production deployments should be linked to a version and change record.',
      checkType: 'deploy',
      check: (deployConfig) => !!deployConfig.versionId && !!deployConfig.changeRecord,
      remediation: 'Ensure deployments are triggered through the versioned deploy pipeline.',
      reference: 'SOC 2 CC8.1',
    },
  ],
};

const PCI_DSS = {
  id: 'pci-dss',
  name: 'PCI-DSS',
  version: '4.0',
  jurisdiction: ['GLOBAL'],
  description: 'Payment Card Industry Data Security Standard — for apps handling cardholder data.',
  rules: [
    {
      id: 'pci-001',
      category: 'cardholder-data',
      severity: SEVERITY.BLOCKER,
      description: 'Primary Account Numbers (PANs) must never be stored in plaintext.',
      checkType: 'field',
      check: (field) => {
        if (field.regulatedType === 'payment-card-pan') {
          return field.encryptedAtRest === true && field.masked === true;
        }
        return true;
      },
      remediation: 'Set `encryptedAtRest: true` and `masked: true` on PAN fields. Never store the full PAN — use a payment processor token instead.',
      reference: 'PCI-DSS Req. 3.4',
    },
    {
      id: 'pci-002',
      category: 'cardholder-data',
      severity: SEVERITY.BLOCKER,
      description: 'CVV/CVC codes must never be stored after authorization.',
      checkType: 'field',
      check: (field) => field.regulatedType !== 'payment-card-cvv',
      remediation: 'Remove any fields with `regulatedType: "payment-card-cvv"`. CVV must never be stored.',
      reference: 'PCI-DSS Req. 3.2',
    },
    {
      id: 'pci-003',
      category: 'network-security',
      severity: SEVERITY.CRITICAL,
      description: 'Cardholder data environments must be isolated from other network segments.',
      checkType: 'deploy',
      check: (deployConfig) => {
        const handlesPaymentData = deployConfig.regulatedTypes?.includes('payment-card-pan');
        if (!handlesPaymentData) return true;
        return deployConfig.networkIsolation === true;
      },
      remediation: 'Enable `networkIsolation: true` in your deployment configuration.',
      reference: 'PCI-DSS Req. 1.3',
    },
  ],
};

const COPPA = {
  id: 'coppa',
  name: 'COPPA',
  version: '1998/2013',
  jurisdiction: ['US'],
  description: 'Children\'s Online Privacy Protection Act — for apps directed at children under 13.',
  rules: [
    {
      id: 'coppa-001',
      category: 'parental-consent',
      severity: SEVERITY.BLOCKER,
      description: 'Apps directed at children must obtain verifiable parental consent before collecting personal data.',
      checkType: 'project',
      check: (project) => {
        if (!project.directedAtChildren) return true;
        return project.parentalConsentMechanism === true;
      },
      remediation: 'Set `parentalConsentMechanism: true` and implement a verifiable parental consent flow.',
      reference: 'COPPA §312.5',
    },
    {
      id: 'coppa-002',
      category: 'data-minimization',
      severity: SEVERITY.BLOCKER,
      description: 'Apps directed at children must not collect more personal data than is reasonably necessary.',
      checkType: 'collection',
      check: (collection, projectConfig) => {
        if (!projectConfig?.directedAtChildren) return true;
        const personalFields = collection.fields?.filter(f =>
          f.dataClass === DATA_CLASS.PERSONAL || f.dataClass === DATA_CLASS.SENSITIVE
        ) || [];
        return personalFields.every(f => f.coppaJustification);
      },
      remediation: 'Add a `coppaJustification` to each personal data field explaining why it is necessary.',
      reference: 'COPPA §312.7',
    },
    {
      id: 'coppa-003',
      category: 'advertising',
      severity: SEVERITY.BLOCKER,
      description: 'Behavioral advertising must not be used in apps directed at children.',
      checkType: 'project',
      check: (project) => {
        if (!project.directedAtChildren) return true;
        return project.behavioralAdvertising !== true;
      },
      remediation: 'Set `behavioralAdvertising: false` in your project settings.',
      reference: 'COPPA §312.2',
    },
  ],
};

const ISO_27001 = {
  id: 'iso-27001',
  name: 'ISO 27001',
  version: '2022',
  jurisdiction: ['GLOBAL'],
  description: 'International standard for information security management systems (ISMS).',
  rules: [
    {
      id: 'iso27001-001',
      category: 'asset-management',
      severity: SEVERITY.WARNING,
      description: 'All information assets (collections, APIs) should be classified and inventoried.',
      checkType: 'project',
      check: (project) => {
        return project.collections?.every(c => c.dataClass) ?? true;
      },
      remediation: 'Assign a `dataClass` to all collections.',
      reference: 'ISO 27001 A.8.1',
    },
    {
      id: 'iso27001-002',
      category: 'access-control',
      severity: SEVERITY.CRITICAL,
      description: 'Access to sensitive information must be restricted on a need-to-know basis.',
      checkType: 'collection',
      check: (collection) => {
        if (collection.dataClass === DATA_CLASS.SENSITIVE || collection.dataClass === DATA_CLASS.REGULATED) {
          return !!collection.accessPolicy;
        }
        return true;
      },
      remediation: 'Define an `accessPolicy` on sensitive and regulated collections.',
      reference: 'ISO 27001 A.9.1',
    },
    {
      id: 'iso27001-003',
      category: 'incident-response',
      severity: SEVERITY.INFO,
      description: 'Projects should define an incident response contact.',
      checkType: 'project',
      check: (project) => !!project.incidentResponseContact,
      remediation: 'Add an `incidentResponseContact` (email or URL) to your project settings.',
      reference: 'ISO 27001 A.16.1',
    },
  ],
};

const ENTERPRISE_INTERNAL = {
  id: 'enterprise-internal',
  name: 'Enterprise Internal Policy',
  version: 'custom',
  jurisdiction: ['ORG'],
  description: 'Customizable internal policy framework for enterprise organizations.',
  rules: [
    {
      id: 'ent-001',
      category: 'approved-ai-models',
      severity: SEVERITY.BLOCKER,
      description: 'AI generation must only use approved models from the organization\'s allowlist.',
      checkType: 'agent',
      check: (agentPlan, projectConfig, orgConfig) => {
        const usedModel = agentPlan.aiModel;
        if (!usedModel) return true;
        const allowedModels = orgConfig?.approvedAiModels;
        if (!allowedModels || allowedModels.length === 0) return true;
        return allowedModels.includes(usedModel);
      },
      remediation: 'Use only AI models from your organization\'s approved list (configured in Admin Console → AI Governance).',
      reference: 'Enterprise AI Policy',
    },
    {
      id: 'ent-002',
      category: 'data-exfiltration',
      severity: SEVERITY.CRITICAL,
      description: 'Sensitive data must not be included in AI prompts sent to external providers.',
      checkType: 'agent',
      check: (agentPlan, projectConfig) => {
        const promptContainsSensitive = agentPlan.steps?.some(s =>
          s.promptContext?.some(c =>
            c.dataClass === DATA_CLASS.SENSITIVE || c.dataClass === DATA_CLASS.REGULATED
          )
        );
        return !promptContainsSensitive;
      },
      remediation: 'Enable prompt redaction in AI Governance settings to automatically strip sensitive data from prompts.',
      reference: 'Enterprise Data Policy',
    },
  ],
};

// ─── Registry ─────────────────────────────────────────────────────────────────

const _registry = new Map([
  ['gdpr',              GDPR],
  ['hipaa',             HIPAA],
  ['soc2',              SOC2],
  ['pci-dss',           PCI_DSS],
  ['coppa',             COPPA],
  ['iso-27001',         ISO_27001],
  ['enterprise-internal', ENTERPRISE_INTERNAL],
]);

export const policyRegistry = {
  /**
   * Get a framework definition by ID.
   * @param {string} frameworkId
   * @returns {object|null}
   */
  getFramework(frameworkId) {
    return _registry.get(frameworkId) || null;
  },

  /**
   * Get all registered frameworks.
   * @returns {object[]}
   */
  getAllFrameworks() {
    return Array.from(_registry.values());
  },

  /**
   * Register a custom framework (for enterprise internal policies).
   * @param {object} framework
   */
  registerFramework(framework) {
    if (!framework.id || !framework.rules) {
      throw new Error('Framework must have an id and rules array.');
    }
    _registry.set(framework.id, framework);
    console.log(`[PolicyRegistry] Registered framework: ${framework.id}`);
  },

  /**
   * Get all rules of a given checkType across all active frameworks.
   * @param {string[]} activeFrameworkIds
   * @param {string} checkType
   * @returns {Array<{frameworkId: string, rule: object}>}
   */
  getRulesForCheckType(activeFrameworkIds, checkType) {
    const results = [];
    for (const fwId of activeFrameworkIds) {
      const fw = _registry.get(fwId);
      if (!fw) continue;
      for (const rule of fw.rules) {
        if (rule.checkType === checkType) {
          results.push({ frameworkId: fwId, frameworkName: fw.name, rule });
        }
      }
    }
    return results;
  },
};
