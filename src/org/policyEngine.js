/**
 * Nuvra Enterprise — Policy Engine (Phase 12)
 *
 * This is NOT RBAC. This is policy-driven access control.
 *
 * A Policy is a declarative, versioned, auditable document that controls
 * what actions are allowed, under what conditions, for which subjects.
 *
 * Policy Document Shape:
 * {
 *   id:          string (UUID),
 *   version:     number,
 *   name:        string,
 *   description: string,
 *   orgId:       string,
 *   scope:       'org' | 'workspace' | 'team' | 'user',
 *   scopeId:     string,
 *   rules:       PolicyRule[],
 *   createdAt:   ISO string,
 *   updatedAt:   ISO string,
 *   createdBy:   string (userId),
 * }
 *
 * PolicyRule Shape:
 * {
 *   id:         string,
 *   action:     string,          // e.g. 'ai.generate', 'publish.cloud', 'data.export'
 *   effect:     'allow' | 'deny',
 *   conditions: PolicyCondition[],
 *   priority:   number,          // higher wins on conflict
 *   reason:     string,          // human-readable explanation
 * }
 *
 * PolicyCondition Shape:
 * {
 *   field:    string,   // e.g. 'role', 'plan', 'ai.model', 'time.hour'
 *   operator: string,   // 'eq' | 'neq' | 'in' | 'nin' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains'
 *   value:    any,
 * }
 *
 * PolicyEvaluationResult Shape:
 * {
 *   allowed:    boolean,
 *   effect:     'allow' | 'deny' | 'default_allow' | 'default_deny',
 *   matchedRule: PolicyRule | null,
 *   policyId:   string | null,
 *   reason:     string,          // human-readable explanation
 *   context:    object,          // the evaluation context that was used
 * }
 *
 * Evaluation Order:
 *   1. Explicit DENY rules (highest priority wins)
 *   2. Explicit ALLOW rules (highest priority wins)
 *   3. Default effect (deny if no rules match)
 *
 * @module policyEngine
 */
'use strict';

import { auditService } from './auditService.js';

// ─── Built-in Policy Actions ──────────────────────────────────────────────────

export const ACTIONS = Object.freeze({
  // AI
  AI_GENERATE:          'ai.generate',
  AI_USE_MODEL:         'ai.use_model',
  AI_LOG_PROMPTS:       'ai.log_prompts',
  AI_EXPORT_PROMPTS:    'ai.export_prompts',

  // Publishing
  PUBLISH_LOCAL:        'publish.local',
  PUBLISH_CLOUD:        'publish.cloud',
  PUBLISH_CUSTOM_DOMAIN:'publish.custom_domain',

  // Data
  DATA_EXPORT:          'data.export',
  DATA_IMPORT:          'data.import',
  DATA_ACCESS_FIELD:    'data.access_field',

  // Marketplace
  MARKETPLACE_INSTALL:  'marketplace.install',
  MARKETPLACE_PUBLISH:  'marketplace.publish',

  // Mobile
  MOBILE_BUILD:         'mobile.build',

  // Members
  MEMBER_INVITE:        'member.invite',
  MEMBER_REMOVE:        'member.remove',
  MEMBER_ROLE_CHANGE:   'member.role_change',

  // Org
  ORG_SETTINGS:         'org.settings',
  ORG_DELETE:           'org.delete',
  ORG_BILLING:          'org.billing',

  // Identity
  IDENTITY_MFA_REQUIRED:'identity.mfa_required',
  IDENTITY_SSO_REQUIRED: 'identity.sso_required',

  // Integrations
  INTEGRATION_CONNECT:  'integration.connect',
  INTEGRATION_USE:      'integration.use',
});

// ─── Internal State ───────────────────────────────────────────────────────────

let _policies    = [];   // Array of PolicyDocument
let _orgId       = null;
let _listeners   = [];

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Initialize the policy engine for the current org.
 * Loads policies from cloud (with localStorage fallback).
 *
 * @param {string|null} orgId
 */
export async function init(orgId) {
  _orgId = orgId;
  if (!orgId) {
    _policies = [];
    return;
  }

  // Load from cloud
  try {
    const { cloud } = await import('../cloud/cloud.js');
    if (cloud.isCloudAvailable()) {
      const { data } = await cloud.policies.list(orgId);
      if (data) {
        _policies = data;
        _saveLocalPolicies(orgId, data);
        return;
      }
    }
  } catch {}

  // Fallback to localStorage
  _policies = _loadLocalPolicies(orgId);
}

// ─── Policy CRUD ──────────────────────────────────────────────────────────────

/**
 * Create a new policy document.
 *
 * @param {object} policyDoc - PolicyDocument (without id/version/timestamps)
 * @returns {Promise<PolicyDocument>}
 */
export async function createPolicy(policyDoc) {
  const now = new Date().toISOString();
  const policy = {
    ...policyDoc,
    id:        _uuid(),
    version:   1,
    createdAt: now,
    updatedAt: now,
    orgId:     _orgId,
  };

  _policies.push(policy);
  await _persistPolicy(policy);

  _emit('policy.created', { policy });

  await auditService.log({
    action: 'policy.created',
    orgId:  _orgId,
    meta:   { policyId: policy.id, name: policy.name },
  });

  return policy;
}

/**
 * Update an existing policy (creates a new version).
 *
 * @param {string} policyId
 * @param {object} updates
 * @returns {Promise<PolicyDocument>}
 */
export async function updatePolicy(policyId, updates) {
  const idx = _policies.findIndex(p => p.id === policyId);
  if (idx === -1) throw new Error(`Policy ${policyId} not found.`);

  const previous = _policies[idx];
  const updated  = {
    ...previous,
    ...updates,
    id:        policyId,
    version:   previous.version + 1,
    updatedAt: new Date().toISOString(),
  };

  _policies[idx] = updated;
  await _persistPolicy(updated);

  _emit('policy.updated', { policy: updated, previous });

  await auditService.log({
    action: 'policy.updated',
    orgId:  _orgId,
    meta:   { policyId, version: updated.version, changes: Object.keys(updates) },
  });

  return updated;
}

/**
 * Delete a policy.
 */
export async function deletePolicy(policyId) {
  _policies = _policies.filter(p => p.id !== policyId);

  try {
    const { cloud } = await import('../cloud/cloud.js');
    if (cloud.isCloudAvailable()) {
      await cloud.policies.delete(policyId);
    }
  } catch {}

  _saveLocalPolicies(_orgId, _policies);
  _emit('policy.deleted', { policyId });

  await auditService.log({
    action: 'policy.deleted',
    orgId:  _orgId,
    meta:   { policyId },
  });
}

/**
 * List all policies for the active org.
 */
export function listPolicies() {
  return [..._policies];
}

/**
 * Get a specific policy by ID.
 */
export function getPolicy(policyId) {
  return _policies.find(p => p.id === policyId) || null;
}

// ─── Policy Evaluation ────────────────────────────────────────────────────────

/**
 * Evaluate whether an action is allowed for the given context.
 *
 * This is the CORE method. Every gated action in Nuvra calls this.
 *
 * @param {string} action - One of ACTIONS.*
 * @param {object} context - Evaluation context
 * @param {string} [context.userId]
 * @param {string} [context.orgId]
 * @param {string} [context.workspaceId]
 * @param {string} [context.role]
 * @param {string} [context.plan]
 * @param {string} [context.teamId]
 * @param {object} [context.resource] - The resource being acted upon
 * @param {object} [context.request]  - Additional request metadata
 * @returns {PolicyEvaluationResult}
 */
export function evaluate(action, context = {}) {
  const applicablePolicies = _getApplicablePolicies(context);
  const allRules = _collectRules(applicablePolicies, action);

  if (allRules.length === 0) {
    return {
      allowed:     true,
      effect:      'default_allow',
      matchedRule: null,
      policyId:    null,
      reason:      'No policy rules found for this action. Default: allow.',
      context,
    };
  }

  // Sort by priority descending (higher priority wins)
  allRules.sort((a, b) => (b.rule.priority || 0) - (a.rule.priority || 0));

  // Check DENY rules first (explicit deny always wins)
  for (const { rule, policyId } of allRules) {
    if (rule.effect !== 'deny') continue;
    if (_matchesConditions(rule.conditions || [], context)) {
      return {
        allowed:     false,
        effect:      'deny',
        matchedRule: rule,
        policyId,
        reason:      rule.reason || `Action '${action}' is explicitly denied by policy.`,
        context,
      };
    }
  }

  // Check ALLOW rules
  for (const { rule, policyId } of allRules) {
    if (rule.effect !== 'allow') continue;
    if (_matchesConditions(rule.conditions || [], context)) {
      return {
        allowed:     true,
        effect:      'allow',
        matchedRule: rule,
        policyId,
        reason:      rule.reason || `Action '${action}' is explicitly allowed by policy.`,
        context,
      };
    }
  }

  // No rule matched — default deny when policies exist
  return {
    allowed:     false,
    effect:      'default_deny',
    matchedRule: null,
    policyId:    null,
    reason:      `Action '${action}' is not explicitly allowed by any policy. Default: deny.`,
    context,
  };
}

/**
 * Async version of evaluate — also logs the decision to the audit trail
 * when the result is a denial.
 */
export async function evaluateAndLog(action, context = {}) {
  const result = evaluate(action, context);

  if (!result.allowed) {
    await auditService.log({
      action: 'policy.denied',
      orgId:  context.orgId || _orgId,
      userId: context.userId,
      meta:   { action, reason: result.reason, policyId: result.policyId },
      severity: 'medium',
    });
  }

  return result;
}

// ─── Built-in Policy Templates ────────────────────────────────────────────────

/**
 * Returns a set of built-in policy templates for common enterprise scenarios.
 * These are starting points — admins can customize them.
 */
export function getBuiltinTemplates() {
  return [
    {
      name: 'AI Usage Controls',
      description: 'Restrict AI models and set usage caps per team.',
      rules: [
        {
          id: _uuid(), action: ACTIONS.AI_USE_MODEL, effect: 'deny', priority: 100,
          conditions: [{ field: 'request.model', operator: 'nin', value: ['gpt-4.1-mini', 'gpt-4.1-nano'] }],
          reason: 'Only approved AI models may be used.',
        },
        {
          id: _uuid(), action: ACTIONS.AI_GENERATE, effect: 'allow', priority: 50,
          conditions: [{ field: 'role', operator: 'in', value: ['editor', 'developer', 'admin', 'owner'] }],
          reason: 'Editors and above may use AI generation.',
        },
      ],
    },
    {
      name: 'Publish Governance',
      description: 'Restrict cloud publishing to admins and above.',
      rules: [
        {
          id: _uuid(), action: ACTIONS.PUBLISH_CLOUD, effect: 'deny', priority: 100,
          conditions: [{ field: 'role', operator: 'in', value: ['viewer', 'editor'] }],
          reason: 'Only developers and above may publish to cloud.',
        },
        {
          id: _uuid(), action: ACTIONS.PUBLISH_CLOUD, effect: 'allow', priority: 50,
          conditions: [{ field: 'role', operator: 'in', value: ['developer', 'admin', 'owner'] }],
          reason: 'Developers and above may publish to cloud.',
        },
      ],
    },
    {
      name: 'Data Export Restriction',
      description: 'Prevent data export by non-admin users.',
      rules: [
        {
          id: _uuid(), action: ACTIONS.DATA_EXPORT, effect: 'deny', priority: 100,
          conditions: [{ field: 'role', operator: 'in', value: ['viewer', 'editor', 'developer'] }],
          reason: 'Data export is restricted to admins and owners.',
        },
      ],
    },
    {
      name: 'Marketplace Governance',
      description: 'Only admins can install marketplace extensions.',
      rules: [
        {
          id: _uuid(), action: ACTIONS.MARKETPLACE_INSTALL, effect: 'deny', priority: 100,
          conditions: [{ field: 'role', operator: 'in', value: ['viewer', 'editor'] }],
          reason: 'Marketplace installations require developer role or above.',
        },
      ],
    },
    {
      name: 'MFA Enforcement',
      description: 'Require MFA for all admin and owner accounts.',
      rules: [
        {
          id: _uuid(), action: ACTIONS.IDENTITY_MFA_REQUIRED, effect: 'deny', priority: 100,
          conditions: [
            { field: 'role', operator: 'in', value: ['admin', 'owner'] },
            { field: 'identity.mfaEnabled', operator: 'eq', value: false },
          ],
          reason: 'MFA is required for admin and owner accounts.',
        },
      ],
    },
  ];
}

// ─── Event Subscription ───────────────────────────────────────────────────────

export function subscribe(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function _getApplicablePolicies(context) {
  return _policies.filter(p => {
    if (p.scope === 'org')       return p.scopeId === (context.orgId || _orgId);
    if (p.scope === 'workspace') return p.scopeId === context.workspaceId;
    if (p.scope === 'team')      return context.teamIds?.includes(p.scopeId);
    if (p.scope === 'user')      return p.scopeId === context.userId;
    return false;
  });
}

function _collectRules(policies, action) {
  const rules = [];
  for (const policy of policies) {
    for (const rule of (policy.rules || [])) {
      if (rule.action === action || rule.action === '*') {
        rules.push({ rule, policyId: policy.id });
      }
    }
  }
  return rules;
}

function _matchesConditions(conditions, context) {
  return conditions.every(cond => _evaluateCondition(cond, context));
}

function _evaluateCondition(cond, context) {
  const value = _resolveField(cond.field, context);

  switch (cond.operator) {
    case 'eq':       return value === cond.value;
    case 'neq':      return value !== cond.value;
    case 'in':       return Array.isArray(cond.value) && cond.value.includes(value);
    case 'nin':      return Array.isArray(cond.value) && !cond.value.includes(value);
    case 'gt':       return typeof value === 'number' && value > cond.value;
    case 'lt':       return typeof value === 'number' && value < cond.value;
    case 'gte':      return typeof value === 'number' && value >= cond.value;
    case 'lte':      return typeof value === 'number' && value <= cond.value;
    case 'contains': return typeof value === 'string' && value.includes(cond.value);
    case 'exists':   return value !== undefined && value !== null;
    default:         return false;
  }
}

function _resolveField(field, context) {
  // Support dot-notation: 'request.model', 'identity.mfaEnabled', etc.
  const parts = field.split('.');
  let current = context;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

async function _persistPolicy(policy) {
  try {
    const { cloud } = await import('../cloud/cloud.js');
    if (cloud.isCloudAvailable()) {
      await cloud.policies.upsert(policy);
    }
  } catch {}
  _saveLocalPolicies(_orgId, _policies);
}

function _saveLocalPolicies(orgId, policies) {
  try {
    localStorage.setItem(`nuvra-policies-${orgId}`, JSON.stringify(policies));
  } catch {}
}

function _loadLocalPolicies(orgId) {
  try {
    return JSON.parse(localStorage.getItem(`nuvra-policies-${orgId}`)) || [];
  } catch { return []; }
}

function _emit(event, data) {
  _listeners.forEach(fn => { try { fn(event, data); } catch {} });
}

function _uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const policyEngine = {
  init, createPolicy, updatePolicy, deletePolicy,
  listPolicies, getPolicy, evaluate, evaluateAndLog,
  getBuiltinTemplates, subscribe, ACTIONS,
};
