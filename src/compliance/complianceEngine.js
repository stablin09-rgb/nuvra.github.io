/**
 * Nuvra — complianceEngine.js (Phase 15)
 *
 * The Compliance AI Engine. Continuously evaluates project structure,
 * data models, agent plans, and deployment configs against active
 * regulatory frameworks.
 *
 * This is the central enforcement point for all compliance decisions.
 * It does NOT contain policy logic — that lives in policyRegistry.js.
 *
 * @module compliance/complianceEngine
 */
'use strict';

import { policyRegistry, SEVERITY } from './policyRegistry.js';

// ─── Violation Record ─────────────────────────────────────────────────────────
/**
 * @typedef {object} ComplianceViolation
 * @property {string} id              - Unique violation ID (rule ID + context hash)
 * @property {string} ruleId          - The rule that was violated
 * @property {string} frameworkId     - The framework the rule belongs to
 * @property {string} frameworkName   - Human-readable framework name
 * @property {string} severity        - 'blocker' | 'critical' | 'warning' | 'info'
 * @property {string} description     - What was violated
 * @property {string} remediation     - How to fix it
 * @property {string} reference       - Regulatory reference
 * @property {string} context         - Where the violation was found (e.g., "field:email")
 * @property {string} checkType       - 'field' | 'collection' | 'page' | 'project' | 'agent' | 'deploy'
 * @property {number} timestamp       - When the violation was detected
 * @property {boolean} acknowledged   - Whether the user has acknowledged this violation
 */

// ─── Compliance Result ────────────────────────────────────────────────────────
/**
 * @typedef {object} ComplianceResult
 * @property {boolean} compliant         - True only if there are zero blockers
 * @property {boolean} requiresApproval  - True if there are critical violations
 * @property {number}  riskScore         - 0-100 (0=safe, 100=maximum risk)
 * @property {ComplianceViolation[]} violations
 * @property {string[]} activeFrameworks
 * @property {number}  timestamp
 */

// ─── Internal State ───────────────────────────────────────────────────────────
let _activeFrameworks = [];
let _projectConfig    = null;
let _orgConfig        = null;
let _violations       = [];
let _listeners        = [];
let _initialized      = false;

// ─── Risk Score Weights ───────────────────────────────────────────────────────
const RISK_WEIGHTS = {
  [SEVERITY.BLOCKER]:  40,
  [SEVERITY.CRITICAL]: 20,
  [SEVERITY.WARNING]:   8,
  [SEVERITY.INFO]:      2,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _computeRiskScore(violations) {
  const raw = violations.reduce((sum, v) => sum + (RISK_WEIGHTS[v.severity] || 0), 0);
  return Math.min(100, raw);
}

function _makeViolationId(ruleId, context) {
  return `${ruleId}::${context}`;
}

function _notify(event, data) {
  for (const listener of _listeners) {
    try { listener(event, data); } catch (_) {}
  }
}

function _runRule(ruleEntry, subject, context, extraArgs = []) {
  const { frameworkId, frameworkName, rule } = ruleEntry;
  let passed = true;
  try {
    passed = rule.check(subject, _projectConfig, _orgConfig, ...extraArgs);
  } catch (err) {
    console.warn(`[ComplianceEngine] Rule ${rule.id} threw an error:`, err);
    passed = false;
  }

  if (!passed) {
    return {
      id:           _makeViolationId(rule.id, context),
      ruleId:       rule.id,
      frameworkId,
      frameworkName,
      severity:     rule.severity,
      description:  rule.description,
      remediation:  rule.remediation,
      reference:    rule.reference,
      context,
      checkType:    rule.checkType,
      timestamp:    Date.now(),
      acknowledged: false,
    };
  }
  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────
export const complianceEngine = {
  /**
   * Initialize the compliance engine for a project.
   * @param {object} projectConfig - The full project config object
   * @param {object} orgConfig     - The org-level config (from orgService)
   */
  init(projectConfig, orgConfig = null) {
    _projectConfig    = projectConfig || {};
    _orgConfig        = orgConfig || {};
    _activeFrameworks = _projectConfig.complianceFrameworks || [];
    _violations       = [];
    _initialized      = true;
    console.log(`[ComplianceEngine] Initialized with frameworks: [${_activeFrameworks.join(', ')}]`);
  },

  /**
   * Check if the engine is initialized.
   */
  isInitialized() {
    return _initialized;
  },

  /**
   * Get the currently active frameworks.
   */
  getActiveFrameworks() {
    return [..._activeFrameworks];
  },

  /**
   * Enable a compliance framework for the current project.
   * @param {string} frameworkId
   */
  enableFramework(frameworkId) {
    if (!policyRegistry.getFramework(frameworkId)) {
      throw new Error(`Unknown framework: ${frameworkId}`);
    }
    if (!_activeFrameworks.includes(frameworkId)) {
      _activeFrameworks.push(frameworkId);
      _notify('framework:enabled', { frameworkId });
    }
  },

  /**
   * Disable a compliance framework.
   * @param {string} frameworkId
   */
  disableFramework(frameworkId) {
    _activeFrameworks = _activeFrameworks.filter(f => f !== frameworkId);
    _notify('framework:disabled', { frameworkId });
  },

  // ─── Check Methods ──────────────────────────────────────────────────────────

  /**
   * Check a single field definition.
   * @param {object} field - The field definition object
   * @param {string} collectionName
   * @returns {ComplianceViolation[]}
   */
  checkField(field, collectionName = 'unknown') {
    if (!_initialized || _activeFrameworks.length === 0) return [];
    const rules = policyRegistry.getRulesForCheckType(_activeFrameworks, 'field');
    const context = `field:${collectionName}.${field.name || field.id}`;
    return rules.map(r => _runRule(r, field, context)).filter(Boolean);
  },

  /**
   * Check a collection definition.
   * @param {object} collection
   * @returns {ComplianceViolation[]}
   */
  checkCollection(collection) {
    if (!_initialized || _activeFrameworks.length === 0) return [];
    const rules = policyRegistry.getRulesForCheckType(_activeFrameworks, 'collection');
    const context = `collection:${collection.name || collection.id}`;
    const collectionViolations = rules.map(r => _runRule(r, collection, context)).filter(Boolean);

    // Also check each field within the collection
    const fieldViolations = [];
    for (const field of (collection.fields || [])) {
      fieldViolations.push(...this.checkField(field, collection.name));
    }

    return [...collectionViolations, ...fieldViolations];
  },

  /**
   * Check a page definition.
   * @param {object} page
   * @returns {ComplianceViolation[]}
   */
  checkPage(page) {
    if (!_initialized || _activeFrameworks.length === 0) return [];
    const rules = policyRegistry.getRulesForCheckType(_activeFrameworks, 'page');
    const context = `page:${page.name || page.id}`;
    return rules.map(r => _runRule(r, page, context)).filter(Boolean);
  },

  /**
   * Check the full project.
   * @param {object} project
   * @returns {ComplianceViolation[]}
   */
  checkProject(project) {
    if (!_initialized || _activeFrameworks.length === 0) return [];
    const rules = policyRegistry.getRulesForCheckType(_activeFrameworks, 'project');
    const context = `project:${project.name || project.id}`;
    return rules.map(r => _runRule(r, project, context)).filter(Boolean);
  },

  /**
   * Check a deployment configuration before deploying.
   * @param {object} deployConfig
   * @returns {ComplianceViolation[]}
   */
  checkDeploy(deployConfig) {
    if (!_initialized || _activeFrameworks.length === 0) return [];
    const rules = policyRegistry.getRulesForCheckType(_activeFrameworks, 'deploy');
    const context = `deploy:${deployConfig.environment || 'production'}`;
    return rules.map(r => _runRule(r, deployConfig, context)).filter(Boolean);
  },

  /**
   * Check an agent plan before execution.
   * @param {object} agentPlan - The structured plan from goalInterpreter
   * @returns {ComplianceViolation[]}
   */
  checkAgentPlan(agentPlan) {
    if (!_initialized || _activeFrameworks.length === 0) return [];
    const rules = policyRegistry.getRulesForCheckType(_activeFrameworks, 'agent');
    const context = `agent:${agentPlan.agentType || 'unknown'}:${agentPlan.goal?.slice(0, 30)}`;
    return rules.map(r => _runRule(r, agentPlan, context)).filter(Boolean);
  },

  // ─── Full Evaluation ────────────────────────────────────────────────────────

  /**
   * Run a full compliance evaluation of the entire project.
   * @param {object} project - The full project state
   * @returns {ComplianceResult}
   */
  evaluateProject(project) {
    if (!_initialized || _activeFrameworks.length === 0) {
      return {
        compliant: true,
        requiresApproval: false,
        riskScore: 0,
        violations: [],
        activeFrameworks: [],
        timestamp: Date.now(),
      };
    }

    const allViolations = [];

    // Project-level checks
    allViolations.push(...this.checkProject(project));

    // Collection + field checks
    for (const collection of (project.collections || [])) {
      allViolations.push(...this.checkCollection(collection));
    }

    // Page checks
    for (const page of (project.pages || [])) {
      allViolations.push(...this.checkPage(page));
    }

    // Deduplicate by violation ID
    const seen = new Set();
    const deduped = allViolations.filter(v => {
      if (seen.has(v.id)) return false;
      seen.add(v.id);
      return true;
    });

    _violations = deduped;
    _notify('evaluation:complete', { violations: deduped });

    const hasBlockers  = deduped.some(v => v.severity === SEVERITY.BLOCKER);
    const hasCriticals = deduped.some(v => v.severity === SEVERITY.CRITICAL);

    return {
      compliant:        !hasBlockers,
      requiresApproval: hasCriticals,
      riskScore:        _computeRiskScore(deduped),
      violations:       deduped,
      activeFrameworks: [..._activeFrameworks],
      timestamp:        Date.now(),
    };
  },

  /**
   * Get the current cached violations.
   */
  getViolations() {
    return [..._violations];
  },

  /**
   * Get violations by severity.
   * @param {string} severity
   */
  getViolationsBySeverity(severity) {
    return _violations.filter(v => v.severity === severity);
  },

  /**
   * Acknowledge a violation (user has reviewed and accepted the risk).
   * @param {string} violationId
   * @param {string} acknowledgedBy - User ID
   * @param {string} reason
   */
  acknowledgeViolation(violationId, acknowledgedBy, reason) {
    const v = _violations.find(v => v.id === violationId);
    if (v) {
      v.acknowledged    = true;
      v.acknowledgedBy  = acknowledgedBy;
      v.acknowledgedAt  = Date.now();
      v.acknowledgeReason = reason;
      _notify('violation:acknowledged', { violationId, acknowledgedBy, reason });
    }
  },

  /**
   * Get a human-readable explanation for a violation.
   * @param {string} violationId
   * @returns {string}
   */
  explainViolation(violationId) {
    const v = _violations.find(v => v.id === violationId);
    if (!v) return 'Violation not found.';
    return [
      `**Violation**: ${v.description}`,
      `**Framework**: ${v.frameworkName} (${v.reference})`,
      `**Severity**: ${v.severity.toUpperCase()}`,
      `**Where**: ${v.context}`,
      `**How to fix**: ${v.remediation}`,
    ].join('\n');
  },

  /**
   * Generate a compliance summary for AI agents.
   * Used by goalInterpreter to inject compliance context into plans.
   * @returns {string}
   */
  getAgentComplianceSummary() {
    if (!_initialized || _activeFrameworks.length === 0) return '';
    const blockers = _violations.filter(v => v.severity === SEVERITY.BLOCKER && !v.acknowledged);
    const lines = [
      `Active compliance frameworks: ${_activeFrameworks.join(', ')}.`,
    ];
    if (blockers.length > 0) {
      lines.push(`BLOCKING violations that must not be worsened:`);
      for (const b of blockers) {
        lines.push(`  - [${b.frameworkId.toUpperCase()}] ${b.description}`);
      }
    }
    return lines.join('\n');
  },

  /**
   * Subscribe to compliance events.
   * @param {function} listener - (event, data) => void
   * @returns {function} unsubscribe
   */
  on(listener) {
    _listeners.push(listener);
    return () => { _listeners = _listeners.filter(l => l !== listener); };
  },

  /**
   * Reset the engine state (used when switching projects).
   */
  reset() {
    _activeFrameworks = [];
    _projectConfig    = null;
    _orgConfig        = null;
    _violations       = [];
    _initialized      = false;
  },
};
