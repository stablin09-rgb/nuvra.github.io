/**
 * Nuvra Runtime Kernel — isolationManager.js (Phase 16)
 *
 * Manages runtime isolation modes. Isolation is policy-driven, not manual.
 * The IsolationManager selects the appropriate isolation level based on the
 * ExecutionContext's risk profile, compliance requirements, and actor type.
 *
 * Isolation Modes:
 *
 *  SOFT      — Marketing pages, public content. Minimal restrictions.
 *              No sensitive data access. No external API calls without approval.
 *
 *  APP       — CRUD apps, forms, dashboards. Standard data access controls.
 *              External API calls allowed within declared permissions.
 *
 *  SECURE    — Regulated apps (HIPAA, PCI-DSS, GDPR). Full encryption at rest.
 *              All data access logged. External calls require explicit allow-list.
 *
 *  ENCLAVE   — Maximum isolation. Agent-only execution zones.
 *              No DOM access. No network access except approved endpoints.
 *              All output must pass content inspection before leaving the enclave.
 *
 * @module runtime/isolationManager
 */
'use strict';

import { ACTOR, INTENT, ENVIRONMENT, RISK_LEVEL } from './executionContext.js';

// ─── Isolation Mode Constants ─────────────────────────────────────────────────
export const ISOLATION_MODE = Object.freeze({
  SOFT:    'soft',
  APP:     'app',
  SECURE:  'secure',
  ENCLAVE: 'enclave',
});

// ─── Isolation Mode Capabilities ─────────────────────────────────────────────
const MODE_CAPABILITIES = {
  [ISOLATION_MODE.SOFT]: {
    domAccess:          true,
    localStorageAccess: false,
    networkAccess:      false,  // Only same-origin
    dataAccess:         false,
    agentExecution:     false,
    externalApis:       false,
    maxTimeoutMs:       10_000,
  },
  [ISOLATION_MODE.APP]: {
    domAccess:          true,
    localStorageAccess: true,
    networkAccess:      true,   // Declared endpoints only
    dataAccess:         true,
    agentExecution:     false,
    externalApis:       true,   // With permission
    maxTimeoutMs:       30_000,
  },
  [ISOLATION_MODE.SECURE]: {
    domAccess:          true,
    localStorageAccess: true,   // Encrypted
    networkAccess:      true,   // Allow-listed only
    dataAccess:         true,   // All access logged
    agentExecution:     true,   // With approval gates
    externalApis:       true,   // Strict allow-list
    maxTimeoutMs:       60_000,
    requiresAuditLog:   true,
    requiresEncryption: true,
  },
  [ISOLATION_MODE.ENCLAVE]: {
    domAccess:          false,
    localStorageAccess: false,
    networkAccess:      false,  // Zero network access
    dataAccess:         true,   // Via controlled API only
    agentExecution:     true,   // Primary use case
    externalApis:       false,
    maxTimeoutMs:       120_000,
    requiresAuditLog:   true,
    requiresEncryption: true,
    requiresContentInspection: true,
  },
};

// ─── Selection Rules ──────────────────────────────────────────────────────────
// Rules are evaluated in order. First match wins.
const SELECTION_RULES = [
  // Rule 1: Agents always run in enclave
  {
    name: 'agent-enclave',
    match: ctx => ctx.actor === ACTOR.AGENT,
    mode:  ISOLATION_MODE.ENCLAVE,
  },
  // Rule 2: Regulated compliance profiles → secure
  {
    name: 'regulated-secure',
    match: ctx => ctx.compliance.some(f => ['hipaa', 'pci-dss', 'fedramp', 'iso27001'].includes(f)),
    mode:  ISOLATION_MODE.SECURE,
  },
  // Rule 3: Production + high risk → secure
  {
    name: 'prod-high-risk-secure',
    match: ctx => ctx.environment === ENVIRONMENT.PROD && ctx.riskLevel === RISK_LEVEL.HIGH,
    mode:  ISOLATION_MODE.SECURE,
  },
  // Rule 4: Deploy intent → secure
  {
    name: 'deploy-secure',
    match: ctx => ctx.intent === INTENT.DEPLOY,
    mode:  ISOLATION_MODE.SECURE,
  },
  // Rule 5: Plugin execution → app sandbox
  {
    name: 'plugin-app',
    match: ctx => ctx.actor === ACTOR.PLUGIN,
    mode:  ISOLATION_MODE.APP,
  },
  // Rule 6: Production environment → app sandbox
  {
    name: 'prod-app',
    match: ctx => ctx.environment === ENVIRONMENT.PROD,
    mode:  ISOLATION_MODE.APP,
  },
  // Rule 7: GDPR compliance → app sandbox (with logging)
  {
    name: 'gdpr-app',
    match: ctx => ctx.compliance.includes('gdpr'),
    mode:  ISOLATION_MODE.APP,
  },
  // Default: soft sandbox
  {
    name: 'default-soft',
    match: () => true,
    mode:  ISOLATION_MODE.SOFT,
  },
];

// ─── IsolationManager Class ───────────────────────────────────────────────────
export class IsolationManager {
  constructor() {
    this._config = {};
    this._customRules = [];
  }

  async init(config = {}) {
    this._config = config;
  }

  /**
   * Select the appropriate isolation mode for an execution context.
   * @param {ExecutionContext} ctx
   * @returns {string} ISOLATION_MODE constant
   */
  selectMode(ctx) {
    const allRules = [...this._customRules, ...SELECTION_RULES];
    for (const rule of allRules) {
      if (rule.match(ctx)) {
        return rule.mode;
      }
    }
    return ISOLATION_MODE.SOFT;
  }

  /**
   * Get the capabilities for a given isolation mode.
   * @param {string} mode - ISOLATION_MODE constant
   * @returns {object}
   */
  getCapabilities(mode) {
    return { ...MODE_CAPABILITIES[mode] } || { ...MODE_CAPABILITIES[ISOLATION_MODE.SOFT] };
  }

  /**
   * Check if a specific capability is allowed in a given isolation mode.
   * @param {string} mode       - ISOLATION_MODE constant
   * @param {string} capability - Capability name (e.g., 'networkAccess')
   * @returns {boolean}
   */
  isCapabilityAllowed(mode, capability) {
    const caps = MODE_CAPABILITIES[mode];
    return caps ? !!caps[capability] : false;
  }

  /**
   * Add a custom isolation rule (e.g., for org-specific policies).
   * Custom rules are evaluated BEFORE built-in rules.
   * @param {object} rule - { name, match: (ctx) => bool, mode }
   */
  addRule(rule) {
    this._customRules.unshift(rule);
  }

  /**
   * Remove a custom rule by name.
   * @param {string} name
   */
  removeRule(name) {
    this._customRules = this._customRules.filter(r => r.name !== name);
  }

  getAvailableModes() {
    return Object.values(ISOLATION_MODE);
  }

  /**
   * Explain why a particular isolation mode was selected for a context.
   * Useful for debugging and audit trails.
   * @param {ExecutionContext} ctx
   * @returns {{ mode: string, rule: string, reason: string }}
   */
  explainSelection(ctx) {
    const allRules = [...this._customRules, ...SELECTION_RULES];
    for (const rule of allRules) {
      if (rule.match(ctx)) {
        return {
          mode:   rule.mode,
          rule:   rule.name,
          reason: _ruleExplanations[rule.name] || `Matched rule: ${rule.name}`,
        };
      }
    }
    return { mode: ISOLATION_MODE.SOFT, rule: 'default', reason: 'No specific rule matched.' };
  }
}

// ─── Rule Explanations (for audit trails) ────────────────────────────────────
const _ruleExplanations = {
  'agent-enclave':       'Autonomous agents always run in maximum isolation (enclave mode) to prevent uncontrolled side effects.',
  'regulated-secure':    'Active compliance profile (HIPAA/PCI-DSS/FedRAMP/ISO 27001) requires secure enclave execution.',
  'prod-high-risk-secure': 'Production environment with high-risk intent requires secure isolation.',
  'deploy-secure':       'Deployment operations always require secure isolation.',
  'plugin-app':          'Third-party plugins run in app sandbox with declared permissions only.',
  'prod-app':            'Production environment requires app-level isolation.',
  'gdpr-app':            'GDPR compliance requires app-level isolation with audit logging.',
  'default-soft':        'No elevated risk factors detected. Soft sandbox is sufficient.',
};

export default IsolationManager;
