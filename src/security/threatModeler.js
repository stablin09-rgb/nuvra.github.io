/**
 * Nuvra — threatModeler.js (Phase 15)
 *
 * STRIDE-based threat modeling for extensions, agent plans, and deployments.
 * Analyzes declared capabilities, data access patterns, and network behavior
 * to identify and score potential threats before execution.
 *
 * STRIDE categories:
 *   S — Spoofing Identity
 *   T — Tampering with Data
 *   R — Repudiation
 *   I — Information Disclosure
 *   D — Denial of Service
 *   E — Elevation of Privilege
 *
 * @module security/threatModeler
 */
'use strict';

// ─── Threat Definitions ───────────────────────────────────────────────────────
const STRIDE_THREATS = {
  S: {
    category: 'Spoofing',
    description: 'Impersonating another user, plugin, or system component.',
  },
  T: {
    category: 'Tampering',
    description: 'Unauthorized modification of data, pages, or configurations.',
  },
  R: {
    category: 'Repudiation',
    description: 'Performing actions without leaving a traceable audit trail.',
  },
  I: {
    category: 'Information Disclosure',
    description: 'Exposing sensitive data to unauthorized parties.',
  },
  D: {
    category: 'Denial of Service',
    description: 'Consuming excessive resources or disrupting availability.',
  },
  E: {
    category: 'Elevation of Privilege',
    description: 'Gaining capabilities beyond what was declared or authorized.',
  },
};

// ─── Threat Rules ─────────────────────────────────────────────────────────────
// Each rule maps a behavioral pattern to a STRIDE threat and a risk score (0-10)
const THREAT_RULES = [
  // Spoofing
  {
    id: 'S-001',
    stride: 'S',
    pattern: 'fetch:external',
    condition: (manifest) => manifest.capabilities?.includes('fetch:external') && !manifest.allowedDomains,
    risk: 7,
    description: 'Plugin can make unconstrained external network requests, enabling identity spoofing via SSRF.',
    mitigation: 'Declare an `allowedDomains` allowlist in the plugin manifest.',
  },
  {
    id: 'S-002',
    stride: 'S',
    pattern: 'read:user-id',
    condition: (manifest) => manifest.capabilities?.includes('read:user-id') && manifest.capabilities?.includes('fetch:external'),
    risk: 8,
    description: 'Plugin can read user identity AND make external requests — risk of user impersonation or data exfiltration.',
    mitigation: 'Remove `fetch:external` or `read:user-id` from capabilities, or restrict `allowedDomains`.',
  },
  // Tampering
  {
    id: 'T-001',
    stride: 'T',
    pattern: 'write:pages + write:collections',
    condition: (manifest) => manifest.capabilities?.includes('write:pages') && manifest.capabilities?.includes('write:collections'),
    risk: 6,
    description: 'Plugin can modify both pages and data models — broad write access increases tampering risk.',
    mitigation: 'Limit to the minimum required write capabilities.',
  },
  {
    id: 'T-002',
    stride: 'T',
    pattern: 'write:records + regulated-data',
    condition: (manifest) => manifest.capabilities?.includes('write:records') && manifest.maxDataClass === 'regulated',
    risk: 9,
    description: 'Plugin can write to regulated data collections (PHI, PAN, etc.) — high tampering risk.',
    mitigation: 'Reduce `maxDataClass` to "personal" or lower, or require explicit approval for each write.',
  },
  // Repudiation
  {
    id: 'R-001',
    stride: 'R',
    pattern: 'no-audit-logging',
    condition: (manifest) => !manifest.auditLogging,
    risk: 4,
    description: 'Plugin does not declare audit logging support — actions may not be traceable.',
    mitigation: 'Set `auditLogging: true` in the plugin manifest to ensure all actions are logged.',
  },
  // Information Disclosure
  {
    id: 'I-001',
    stride: 'I',
    pattern: 'read:records + fetch:external + personal-data',
    condition: (manifest) => {
      const caps = manifest.capabilities || [];
      return caps.includes('read:records') && caps.includes('fetch:external') &&
        (manifest.maxDataClass === 'personal' || manifest.maxDataClass === 'sensitive' || manifest.maxDataClass === 'regulated');
    },
    risk: 9,
    description: 'Plugin can read personal/sensitive records AND make external requests — high data exfiltration risk.',
    mitigation: 'Remove `fetch:external` capability, or restrict `maxDataClass` to "public".',
  },
  {
    id: 'I-002',
    stride: 'I',
    pattern: 'read:ai-settings',
    condition: (manifest) => manifest.capabilities?.includes('read:ai-settings'),
    risk: 5,
    description: 'Plugin can read AI provider settings, which may include API keys.',
    mitigation: 'Only grant `read:ai-settings` to trusted, verified plugins.',
  },
  // Denial of Service
  {
    id: 'D-001',
    stride: 'D',
    pattern: 'invoke:ai + no-rate-limit',
    condition: (manifest) => manifest.capabilities?.includes('invoke:ai') && !manifest.aiCallLimit,
    risk: 6,
    description: 'Plugin can invoke AI without a declared call limit — risk of excessive API usage and billing DoS.',
    mitigation: 'Set `aiCallLimit` in the plugin manifest (e.g., `aiCallLimit: 100`).',
  },
  {
    id: 'D-002',
    stride: 'D',
    pattern: 'write:records + no-write-limit',
    condition: (manifest) => manifest.capabilities?.includes('write:records') && !manifest.writeLimit,
    risk: 5,
    description: 'Plugin can write records without a declared limit — risk of storage exhaustion.',
    mitigation: 'Set `writeLimit` in the plugin manifest.',
  },
  // Elevation of Privilege
  {
    id: 'E-001',
    stride: 'E',
    pattern: 'write:collections + write:pages',
    condition: (manifest) => {
      const caps = manifest.capabilities || [];
      return caps.includes('write:collections') && caps.includes('write:pages') && caps.includes('invoke:ai');
    },
    risk: 8,
    description: 'Plugin has broad write access across pages, collections, and AI — risk of privilege escalation via AI-generated code injection.',
    mitigation: 'Limit to the minimum required capabilities. Consider splitting into separate, narrower plugins.',
  },
  {
    id: 'E-002',
    stride: 'E',
    pattern: 'undeclared-capabilities',
    condition: (manifest) => !manifest.capabilities || manifest.capabilities.length === 0,
    risk: 3,
    description: 'Plugin declares no capabilities — may attempt to access APIs without authorization.',
    mitigation: 'Explicitly declare all required capabilities in the plugin manifest.',
  },
];

// ─── Agent Plan Threat Rules ──────────────────────────────────────────────────
const AGENT_THREAT_RULES = [
  {
    id: 'A-001',
    stride: 'T',
    condition: (plan) => plan.steps?.some(s => s.action === 'deleteCollection' || s.action === 'dropField'),
    risk: 8,
    description: 'Agent plan includes destructive schema operations (delete collection / drop field).',
    mitigation: 'Require explicit human approval for all destructive schema operations.',
  },
  {
    id: 'A-002',
    stride: 'I',
    condition: (plan) => plan.steps?.some(s => s.params?.dataClass === 'regulated' && s.action?.startsWith('read')),
    risk: 7,
    description: 'Agent plan reads regulated data (PHI, PAN, etc.).',
    mitigation: 'Ensure HIPAA/PCI mode is enabled and the operation is logged.',
  },
  {
    id: 'A-003',
    stride: 'E',
    condition: (plan) => plan.steps?.length > 20,
    risk: 5,
    description: 'Agent plan has more than 20 steps — complex plans are harder to review and may have unintended side effects.',
    mitigation: 'Break the goal into smaller, reviewable sub-goals.',
  },
  {
    id: 'A-004',
    stride: 'D',
    condition: (plan) => plan.steps?.filter(s => s.action === 'invokeAI').length > 5,
    risk: 6,
    description: 'Agent plan invokes AI more than 5 times — risk of excessive token usage.',
    mitigation: 'Consolidate AI invocations or set a token budget.',
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────
export const threatModeler = {
  /**
   * Analyze a plugin manifest for STRIDE threats.
   * @param {object} manifest - Plugin manifest
   * @returns {{ threats: object[], riskScore: number, blocked: boolean }}
   */
  analyzePlugin(manifest) {
    const threats = [];
    for (const rule of THREAT_RULES) {
      try {
        if (rule.condition(manifest)) {
          threats.push({
            id:          rule.id,
            stride:      rule.stride,
            category:    STRIDE_THREATS[rule.stride].category,
            risk:        rule.risk,
            description: rule.description,
            mitigation:  rule.mitigation,
          });
        }
      } catch (_) {}
    }

    const riskScore = Math.min(100, threats.reduce((sum, t) => sum + t.risk * 10, 0) / Math.max(1, threats.length));
    const blocked   = threats.some(t => t.risk >= 9);

    return { threats, riskScore: Math.round(riskScore), blocked };
  },

  /**
   * Analyze an agent plan for STRIDE threats.
   * @param {object} plan - Agent plan from goalInterpreter
   * @returns {{ threats: object[], riskScore: number, requiresApproval: boolean }}
   */
  analyzeAgentPlan(plan) {
    const threats = [];
    for (const rule of AGENT_THREAT_RULES) {
      try {
        if (rule.condition(plan)) {
          threats.push({
            id:          rule.id,
            stride:      rule.stride,
            category:    STRIDE_THREATS[rule.stride].category,
            risk:        rule.risk,
            description: rule.description,
            mitigation:  rule.mitigation,
          });
        }
      } catch (_) {}
    }

    const riskScore       = threats.reduce((sum, t) => sum + t.risk, 0);
    const requiresApproval = threats.some(t => t.risk >= 7);

    return { threats, riskScore: Math.min(100, riskScore * 5), requiresApproval };
  },

  /**
   * Get a human-readable STRIDE summary for a threat.
   * @param {string} strideCategory - 'S' | 'T' | 'R' | 'I' | 'D' | 'E'
   * @returns {object}
   */
  getStrideInfo(strideCategory) {
    return STRIDE_THREATS[strideCategory] || null;
  },

  /**
   * Get a risk level label for a numeric risk score (0-10).
   * @param {number} risk
   * @returns {{ label: string, color: string }}
   */
  getRiskLevel(risk) {
    if (risk >= 9) return { label: 'Critical', color: '#dc2626' };
    if (risk >= 7) return { label: 'High',     color: '#ea580c' };
    if (risk >= 5) return { label: 'Medium',   color: '#d97706' };
    if (risk >= 3) return { label: 'Low',      color: '#65a30d' };
    return             { label: 'Info',       color: '#6b7280' };
  },

  STRIDE_THREATS,
};
