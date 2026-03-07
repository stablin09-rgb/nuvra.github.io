/**
 * Nuvra — permissionModel.js (Phase 15)
 *
 * Zero-trust permission model for the entire Nuvra platform.
 * Every action — by a user, an agent, or a plugin — is checked
 * against this model before execution.
 *
 * Integrates with:
 *   - Phase 12 policyEngine (org-level policies)
 *   - Phase 14 agentPermissions (agent-specific gates)
 *   - Phase 15 complianceEngine (regulatory enforcement)
 *   - Phase 15 pluginSandbox (plugin capability checks)
 *
 * @module security/permissionModel
 */
'use strict';

// ─── Action Definitions ───────────────────────────────────────────────────────
export const ACTIONS = Object.freeze({
  // Pages
  PAGE_READ:            'page:read',
  PAGE_CREATE:          'page:create',
  PAGE_UPDATE:          'page:update',
  PAGE_DELETE:          'page:delete',
  PAGE_PUBLISH:         'page:publish',
  // Collections
  COLLECTION_READ:      'collection:read',
  COLLECTION_CREATE:    'collection:create',
  COLLECTION_UPDATE:    'collection:update',
  COLLECTION_DELETE:    'collection:delete',
  // Records
  RECORD_READ:          'record:read',
  RECORD_CREATE:        'record:create',
  RECORD_UPDATE:        'record:update',
  RECORD_DELETE:        'record:delete',
  // AI
  AI_GENERATE:          'ai:generate',
  AI_SETTINGS_READ:     'ai:settings:read',
  AI_SETTINGS_WRITE:    'ai:settings:write',
  // Deploy
  DEPLOY_CREATE:        'deploy:create',
  DEPLOY_ROLLBACK:      'deploy:rollback',
  DEPLOY_DELETE:        'deploy:delete',
  // Project
  PROJECT_READ:         'project:read',
  PROJECT_UPDATE:       'project:update',
  PROJECT_DELETE:       'project:delete',
  PROJECT_EXPORT:       'project:export',
  // Org
  ORG_MEMBER_INVITE:    'org:member:invite',
  ORG_MEMBER_REMOVE:    'org:member:remove',
  ORG_SETTINGS_UPDATE:  'org:settings:update',
  // Admin
  ADMIN_CONSOLE_ACCESS: 'admin:console:access',
  COMPLIANCE_OVERRIDE:  'compliance:override',
  AUDIT_EXPORT:         'audit:export',
  // Billing
  BILLING_READ:         'billing:read',
  BILLING_UPDATE:       'billing:update',
});

// ─── Role → Default Permissions ──────────────────────────────────────────────
const ROLE_PERMISSIONS = {
  owner: Object.values(ACTIONS),
  admin: [
    ACTIONS.PAGE_READ, ACTIONS.PAGE_CREATE, ACTIONS.PAGE_UPDATE, ACTIONS.PAGE_DELETE, ACTIONS.PAGE_PUBLISH,
    ACTIONS.COLLECTION_READ, ACTIONS.COLLECTION_CREATE, ACTIONS.COLLECTION_UPDATE, ACTIONS.COLLECTION_DELETE,
    ACTIONS.RECORD_READ, ACTIONS.RECORD_CREATE, ACTIONS.RECORD_UPDATE, ACTIONS.RECORD_DELETE,
    ACTIONS.AI_GENERATE, ACTIONS.AI_SETTINGS_READ, ACTIONS.AI_SETTINGS_WRITE,
    ACTIONS.DEPLOY_CREATE, ACTIONS.DEPLOY_ROLLBACK,
    ACTIONS.PROJECT_READ, ACTIONS.PROJECT_UPDATE, ACTIONS.PROJECT_EXPORT,
    ACTIONS.ORG_MEMBER_INVITE, ACTIONS.ORG_MEMBER_REMOVE, ACTIONS.ORG_SETTINGS_UPDATE,
    ACTIONS.ADMIN_CONSOLE_ACCESS, ACTIONS.AUDIT_EXPORT,
    ACTIONS.BILLING_READ,
  ],
  developer: [
    ACTIONS.PAGE_READ, ACTIONS.PAGE_CREATE, ACTIONS.PAGE_UPDATE, ACTIONS.PAGE_DELETE, ACTIONS.PAGE_PUBLISH,
    ACTIONS.COLLECTION_READ, ACTIONS.COLLECTION_CREATE, ACTIONS.COLLECTION_UPDATE,
    ACTIONS.RECORD_READ, ACTIONS.RECORD_CREATE, ACTIONS.RECORD_UPDATE,
    ACTIONS.AI_GENERATE, ACTIONS.AI_SETTINGS_READ,
    ACTIONS.DEPLOY_CREATE,
    ACTIONS.PROJECT_READ, ACTIONS.PROJECT_EXPORT,
  ],
  editor: [
    ACTIONS.PAGE_READ, ACTIONS.PAGE_CREATE, ACTIONS.PAGE_UPDATE,
    ACTIONS.COLLECTION_READ,
    ACTIONS.RECORD_READ, ACTIONS.RECORD_CREATE, ACTIONS.RECORD_UPDATE,
    ACTIONS.AI_GENERATE,
    ACTIONS.PROJECT_READ,
  ],
  viewer: [
    ACTIONS.PAGE_READ,
    ACTIONS.COLLECTION_READ,
    ACTIONS.RECORD_READ,
    ACTIONS.PROJECT_READ,
  ],
  // Special: anonymous user (local-only, no org)
  anonymous: [
    ACTIONS.PAGE_READ, ACTIONS.PAGE_CREATE, ACTIONS.PAGE_UPDATE, ACTIONS.PAGE_DELETE, ACTIONS.PAGE_PUBLISH,
    ACTIONS.COLLECTION_READ, ACTIONS.COLLECTION_CREATE, ACTIONS.COLLECTION_UPDATE, ACTIONS.COLLECTION_DELETE,
    ACTIONS.RECORD_READ, ACTIONS.RECORD_CREATE, ACTIONS.RECORD_UPDATE, ACTIONS.RECORD_DELETE,
    ACTIONS.AI_GENERATE, ACTIONS.AI_SETTINGS_READ, ACTIONS.AI_SETTINGS_WRITE,
    ACTIONS.DEPLOY_CREATE, ACTIONS.DEPLOY_ROLLBACK,
    ACTIONS.PROJECT_READ, ACTIONS.PROJECT_UPDATE, ACTIONS.PROJECT_DELETE, ACTIONS.PROJECT_EXPORT,
    ACTIONS.BILLING_READ,
  ],
};

// ─── Permission Check Result ──────────────────────────────────────────────────
/**
 * @typedef {object} PermissionResult
 * @property {boolean} allowed
 * @property {string}  reason
 * @property {string}  actor    - 'user' | 'agent' | 'plugin'
 * @property {string}  action
 * @property {string|null} denySource - 'role' | 'policy' | 'compliance' | 'suspension'
 */

// ─── Internal State ───────────────────────────────────────────────────────────
let _currentRole        = 'anonymous';
let _policyEngine       = null;
let _complianceEngine   = null;
let _customGrants       = new Set();
let _customDenials      = new Set();

// ─── Public API ───────────────────────────────────────────────────────────────
export const permissionModel = {
  /**
   * Initialize the permission model.
   * @param {object} opts
   * @param {string} opts.role - The current user's role
   * @param {object} [opts.policyEngine] - Phase 12 policyEngine instance
   * @param {object} [opts.complianceEngine] - Phase 15 complianceEngine instance
   */
  init({ role, policyEngine, complianceEngine }) {
    _currentRole      = role || 'anonymous';
    _policyEngine     = policyEngine || null;
    _complianceEngine = complianceEngine || null;
    _customGrants     = new Set();
    _customDenials    = new Set();
  },

  /**
   * Check if the current user can perform an action.
   * @param {string} action - One of ACTIONS
   * @param {object} [context] - Optional context for policy/compliance checks
   * @returns {PermissionResult}
   */
  check(action, context = {}) {
    // 1. Custom denial (highest priority)
    if (_customDenials.has(action)) {
      return { allowed: false, reason: 'Action explicitly denied by custom policy.', actor: 'user', action, denySource: 'policy' };
    }

    // 2. Custom grant
    if (_customGrants.has(action)) {
      return { allowed: true, reason: 'Action explicitly granted by custom policy.', actor: 'user', action, denySource: null };
    }

    // 3. Role-based check
    const rolePerms = ROLE_PERMISSIONS[_currentRole] || [];
    if (!rolePerms.includes(action)) {
      return {
        allowed:    false,
        reason:     `Role "${_currentRole}" does not have permission to perform "${action}".`,
        actor:      'user',
        action,
        denySource: 'role',
      };
    }

    // 4. Policy engine check (org-level)
    if (_policyEngine && _policyEngine.isInitialized?.()) {
      try {
        const policyResult = _policyEngine.check(action, context);
        if (policyResult && !policyResult.allowed) {
          return {
            allowed:    false,
            reason:     policyResult.reason || `Blocked by org policy: ${policyResult.appliedPolicy || 'unknown'}`,
            actor:      'user',
            action,
            denySource: 'policy',
          };
        }
      } catch (_) {}
    }

    // 5. Compliance engine check
    if (_complianceEngine && _complianceEngine.isInitialized?.() && context.agentPlan) {
      const violations = _complianceEngine.checkAgentPlan(context.agentPlan);
      const blockers   = violations.filter(v => v.severity === 'blocker' && !v.acknowledged);
      if (blockers.length > 0) {
        return {
          allowed:    false,
          reason:     `Blocked by compliance: ${blockers.map(b => b.description).join('; ')}`,
          actor:      'user',
          action,
          denySource: 'compliance',
        };
      }
    }

    return { allowed: true, reason: 'Permitted.', actor: 'user', action, denySource: null };
  },

  /**
   * Check permission for an agent action.
   * @param {string} action
   * @param {string} agentType
   * @param {object} [context]
   * @returns {PermissionResult}
   */
  checkAgent(action, agentType, context = {}) {
    // Agents always run as 'developer' role at most
    const agentRole = 'developer';
    const rolePerms = ROLE_PERMISSIONS[agentRole] || [];
    if (!rolePerms.includes(action)) {
      return {
        allowed:    false,
        reason:     `Agent type "${agentType}" cannot perform "${action}" (exceeds developer role).`,
        actor:      'agent',
        action,
        denySource: 'role',
      };
    }

    // Compliance check for agents
    if (_complianceEngine && _complianceEngine.isInitialized?.() && context.agentPlan) {
      const violations = _complianceEngine.checkAgentPlan(context.agentPlan);
      const blockers   = violations.filter(v => v.severity === 'blocker' && !v.acknowledged);
      if (blockers.length > 0) {
        return {
          allowed:    false,
          reason:     `Agent blocked by compliance: ${blockers[0].description}`,
          actor:      'agent',
          action,
          denySource: 'compliance',
        };
      }
    }

    return { allowed: true, reason: 'Agent permitted.', actor: 'agent', action, denySource: null };
  },

  /**
   * Check permission for a plugin action.
   * @param {string} action
   * @param {string} pluginId
   * @param {Set<string>} pluginCapabilities
   * @returns {PermissionResult}
   */
  checkPlugin(action, pluginId, pluginCapabilities) {
    // Map action to capability
    const capabilityMap = {
      [ACTIONS.PAGE_READ]:         'read:pages',
      [ACTIONS.PAGE_CREATE]:       'write:pages',
      [ACTIONS.PAGE_UPDATE]:       'write:pages',
      [ACTIONS.RECORD_READ]:       'read:records',
      [ACTIONS.RECORD_CREATE]:     'write:records',
      [ACTIONS.RECORD_UPDATE]:     'write:records',
      [ACTIONS.AI_GENERATE]:       'invoke:ai',
      [ACTIONS.COLLECTION_READ]:   'read:collections',
      [ACTIONS.COLLECTION_CREATE]: 'write:collections',
    };

    const requiredCap = capabilityMap[action];
    if (requiredCap && !pluginCapabilities.has(requiredCap)) {
      return {
        allowed:    false,
        reason:     `Plugin "${pluginId}" did not declare capability "${requiredCap}" in its manifest.`,
        actor:      'plugin',
        action,
        denySource: 'role',
      };
    }

    return { allowed: true, reason: 'Plugin permitted.', actor: 'plugin', action, denySource: null };
  },

  /**
   * Grant an additional action to the current session.
   * Used for temporary elevated permissions (e.g., after MFA).
   * @param {string} action
   */
  grant(action) {
    _customGrants.add(action);
    _customDenials.delete(action);
  },

  /**
   * Explicitly deny an action for the current session.
   * @param {string} action
   */
  deny(action) {
    _customDenials.add(action);
    _customGrants.delete(action);
  },

  /**
   * Get all actions the current role is permitted to perform.
   * @returns {string[]}
   */
  getAllowedActions() {
    const base = new Set(ROLE_PERMISSIONS[_currentRole] || []);
    for (const a of _customGrants) base.add(a);
    for (const a of _customDenials) base.delete(a);
    return [...base];
  },

  /**
   * Get the current role.
   */
  getRole() {
    return _currentRole;
  },

  ACTIONS,
  ROLE_PERMISSIONS,
};
