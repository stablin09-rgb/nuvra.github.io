/**
 * Nuvra — agentPermissions.js (Phase 14)
 *
 * The AgentPermissions module enforces what agents are allowed to do.
 * It integrates with:
 *   - User roles (creator, admin, viewer)
 *   - Organization policies (Phase 12 policyEngine)
 *   - Environment rules (draft vs production)
 *   - Design pack constraints (Phase 13 packRuntime)
 *   - Auto-approve rules (user-configured shortcuts)
 *
 * Every agent action passes through this module before execution.
 *
 * @module agentPermissions
 */
'use strict';

// ─── Permission levels ────────────────────────────────────────────────────────
export const PERMISSION_LEVEL = {
  READ:    'read',
  SUGGEST: 'suggest',
  DEPLOY:  'deploy',
  ADMIN:   'admin',
};

// ─── Role capabilities ────────────────────────────────────────────────────────
const ROLE_CAPABILITIES = {
  viewer:    [PERMISSION_LEVEL.READ],
  editor:    [PERMISSION_LEVEL.READ, PERMISSION_LEVEL.SUGGEST],
  developer: [PERMISSION_LEVEL.READ, PERMISSION_LEVEL.SUGGEST, PERMISSION_LEVEL.DEPLOY],
  admin:     [PERMISSION_LEVEL.READ, PERMISSION_LEVEL.SUGGEST, PERMISSION_LEVEL.DEPLOY, PERMISSION_LEVEL.ADMIN],
  owner:     [PERMISSION_LEVEL.READ, PERMISSION_LEVEL.SUGGEST, PERMISSION_LEVEL.DEPLOY, PERMISSION_LEVEL.ADMIN],
};

// ─── Default auto-approve rules ───────────────────────────────────────────────
const DEFAULT_AUTO_APPROVE_RULES = [
  // Read operations never need approval
  { toolLevel: 'read', environment: '*', autoApprove: true },
];

// ─── AgentPermissions class ───────────────────────────────────────────────────
class AgentPermissions {
  constructor() {
    /** @type {string} Current user role */
    this._userRole = 'editor';
    /** @type {string} Current environment */
    this._environment = 'draft';
    /** @type {object[]} User-configured auto-approve rules */
    this._autoApproveRules = [...DEFAULT_AUTO_APPROVE_RULES];
    /** @type {object|null} External policy engine reference */
    this._policyEngine = null;
    /** @type {object|null} Active pack constraints */
    this._packConstraints = null;
    /** @type {boolean} Dry-run mode — proposals are generated but never applied */
    this._dryRun = false;
  }

  /**
   * Initialize with the current user context.
   * @param {object} params
   * @param {string}   params.userRole
   * @param {string}   params.environment
   * @param {object}   [params.policyEngine]
   * @param {object}   [params.packConstraints]
   */
  init({ userRole, environment, policyEngine, packConstraints } = {}) {
    this._userRole       = userRole       || 'editor';
    this._environment    = environment    || 'draft';
    this._policyEngine   = policyEngine   || null;
    this._packConstraints = packConstraints || null;
    this._loadAutoApproveRules();
  }

  /**
   * Check if an agent is allowed to use a specific tool.
   * Returns a rich result explaining the decision.
   *
   * @param {object} params
   * @param {string}   params.agentType
   * @param {string}   params.toolName
   * @param {string}   params.toolLevel
   * @param {object}   [params.toolParams]
   * @returns {PermissionResult}
   */
  check({ agentType, toolName, toolLevel, toolParams = {} }) {
    // 1. Check role capability
    const roleCapabilities = ROLE_CAPABILITIES[this._userRole] || [];
    if (!roleCapabilities.includes(toolLevel)) {
      return {
        allowed: false,
        reason: `Your role (${this._userRole}) does not have ${toolLevel} permission.`,
        appliedRule: 'role_check',
      };
    }

    // 2. Dry-run mode — nothing is applied
    if (this._dryRun && toolLevel !== PERMISSION_LEVEL.READ) {
      return {
        allowed: false,
        reason: 'Dry-run mode is active. No changes will be applied.',
        appliedRule: 'dry_run',
        dryRun: true,
      };
    }

    // 3. Production environment guard — deploy requires explicit permission
    if (this._environment === 'production' && toolLevel === PERMISSION_LEVEL.DEPLOY) {
      const orgPolicy = this._policyEngine?.check({
        action: 'agent.deploy',
        resource: 'production',
        context: { agentType, toolName },
      });
      if (orgPolicy && !orgPolicy.allowed) {
        return {
          allowed: false,
          reason: orgPolicy.reason || 'Organization policy prohibits agent deployments to production.',
          appliedRule: 'org_policy',
        };
      }
    }

    // 4. Pack constraint check
    if (this._packConstraints && toolName === 'project.write.page') {
      const constraint = this._packConstraints.checkWriteConstraint?.(toolParams);
      if (constraint && !constraint.allowed) {
        return {
          allowed: false,
          reason: `Active Design Pack "${constraint.packName}" restricts this change: ${constraint.reason}`,
          appliedRule: 'pack_constraint',
        };
      }
    }

    // 5. Check auto-approve rules
    const autoApprove = this._checkAutoApprove({ agentType, toolName, toolLevel });

    return {
      allowed: true,
      requiresApproval: !autoApprove && toolLevel !== PERMISSION_LEVEL.READ,
      autoApproved: autoApprove,
      appliedRule: autoApprove ? 'auto_approve' : 'manual_approval_required',
    };
  }

  /**
   * Check if a proposal should be auto-approved.
   * @param {object} params
   * @returns {boolean}
   */
  _checkAutoApprove({ agentType, toolName, toolLevel }) {
    for (const rule of this._autoApproveRules) {
      const matchLevel  = rule.toolLevel  === '*' || rule.toolLevel  === toolLevel;
      const matchAgent  = !rule.agentType || rule.agentType === agentType;
      const matchTool   = !rule.toolName  || rule.toolName  === toolName;
      const matchEnv    = rule.environment === '*' || rule.environment === this._environment;
      if (matchLevel && matchAgent && matchTool && matchEnv) {
        return rule.autoApprove === true;
      }
    }
    return false;
  }

  /**
   * Add an auto-approve rule.
   * @param {object} rule
   * @param {string}  rule.toolLevel    - 'read' | 'suggest' | 'deploy' | 'admin' | '*'
   * @param {string}  [rule.agentType]  - Specific agent type, or omit for all
   * @param {string}  [rule.toolName]   - Specific tool name, or omit for all in level
   * @param {string}  rule.environment  - 'draft' | 'production' | '*'
   * @param {boolean} rule.autoApprove
   */
  addAutoApproveRule(rule) {
    this._autoApproveRules.push(rule);
    this._saveAutoApproveRules();
  }

  /**
   * Remove an auto-approve rule by index.
   * @param {number} index
   */
  removeAutoApproveRule(index) {
    this._autoApproveRules.splice(index, 1);
    this._saveAutoApproveRules();
  }

  /**
   * Get all current auto-approve rules.
   * @returns {object[]}
   */
  getAutoApproveRules() {
    return [...this._autoApproveRules];
  }

  /**
   * Enable or disable dry-run mode.
   * In dry-run mode, agents generate proposals but nothing is applied.
   * @param {boolean} enabled
   */
  setDryRun(enabled) {
    this._dryRun = enabled;
  }

  isDryRun() {
    return this._dryRun;
  }

  /**
   * Set the current environment context.
   * @param {'draft'|'production'} env
   */
  setEnvironment(env) {
    this._environment = env;
  }

  getEnvironment() {
    return this._environment;
  }

  // ─── Persistence ────────────────────────────────────────────────────────────
  _loadAutoApproveRules() {
    try {
      const stored = localStorage.getItem('nuvra-agent-auto-approve');
      if (stored) {
        const parsed = JSON.parse(stored);
        // Always keep the default read rule
        this._autoApproveRules = [
          ...DEFAULT_AUTO_APPROVE_RULES,
          ...parsed.filter(r => r.toolLevel !== 'read'),
        ];
      }
    } catch { /* ignore */ }
  }

  _saveAutoApproveRules() {
    try {
      // Don't persist the default rules
      const toSave = this._autoApproveRules.filter(r => r.toolLevel !== 'read');
      localStorage.setItem('nuvra-agent-auto-approve', JSON.stringify(toSave));
    } catch { /* ignore */ }
  }
}

export const agentPermissions = new AgentPermissions();
