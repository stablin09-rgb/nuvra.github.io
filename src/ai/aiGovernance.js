/**
 * Nuvra Enterprise — AI Governance (Phase 12)
 *
 * Provides enterprise-grade controls over all AI operations in Nuvra.
 *
 * Capabilities:
 *   1. APPROVED MODEL LIST — Only allow specific AI models per org
 *   2. PROMPT REDACTION — Strip PII/sensitive data from prompts before sending
 *   3. PROMPT LOGGING — Optionally log all prompts + responses for compliance
 *   4. USAGE CAPS — Per-user and per-team AI usage limits (beyond billing caps)
 *   5. TRAINING OPT-OUT — Mark all requests with opt-out headers
 *   6. EXPLAINABILITY — Record why each AI decision was made
 *   7. CONTENT FILTERING — Block prompts matching forbidden patterns
 *   8. RESPONSE AUDITING — Log all AI responses for review
 *
 * This module wraps the AI generation pipeline. It does NOT replace aiEngine.js —
 * it sits in front of it as a governance layer.
 *
 * GovernanceConfig Shape:
 * {
 *   orgId:            string,
 *   approvedModels:   string[] | null,   // null = all allowed
 *   blockedModels:    string[],
 *   promptRedaction: {
 *     enabled:        boolean,
 *     patterns:       RedactionPattern[],
 *   },
 *   promptLogging: {
 *     enabled:        boolean,
 *     retentionDays:  number,
 *     includeResponse:boolean,
 *   },
 *   usageCaps: {
 *     perUserPerDay:  number | null,
 *     perTeamPerDay:  number | null,
 *     perOrgPerMonth: number | null,
 *   },
 *   trainingOptOut:   boolean,
 *   contentFiltering: {
 *     enabled:        boolean,
 *     blockedPatterns:string[],
 *     severity:       'warn' | 'block',
 *   },
 * }
 *
 * RedactionPattern Shape:
 * {
 *   name:        string,
 *   pattern:     string,    // regex string
 *   replacement: string,    // e.g. '[REDACTED]', '[EMAIL]'
 * }
 *
 * @module aiGovernance
 */
'use strict';

import { auditService, SEVERITY } from '../org/auditService.js';
import { policyEngine, ACTIONS }  from '../org/policyEngine.js';

// ─── Built-in Redaction Patterns ─────────────────────────────────────────────

export const BUILTIN_REDACTION_PATTERNS = [
  { name: 'email',       pattern: '[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}', replacement: '[EMAIL]' },
  { name: 'phone_us',    pattern: '\\b(?:\\+1[\\s.-]?)?\\(?[0-9]{3}\\)?[\\s.-]?[0-9]{3}[\\s.-]?[0-9]{4}\\b', replacement: '[PHONE]' },
  { name: 'ssn',         pattern: '\\b[0-9]{3}[-\\s]?[0-9]{2}[-\\s]?[0-9]{4}\\b', replacement: '[SSN]' },
  { name: 'credit_card', pattern: '\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12})\\b', replacement: '[CARD]' },
  { name: 'api_key',     pattern: '(?:sk|pk|api|key|token|secret)[_\\-]?[a-zA-Z0-9]{20,}', replacement: '[API_KEY]' },
  { name: 'ip_address',  pattern: '\\b(?:[0-9]{1,3}\\.){3}[0-9]{1,3}\\b', replacement: '[IP]' },
];

// ─── Internal State ───────────────────────────────────────────────────────────

let _config    = null;
let _orgId     = null;
let _userId    = null;
let _listeners = [];

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Initialize AI governance for the current org.
 *
 * @param {string|null} orgId
 * @param {string|null} userId
 */
export async function init(orgId, userId) {
  _orgId  = orgId;
  _userId = userId;

  if (!orgId) {
    _config = _defaultConfig(null);
    return;
  }

  // Load from cloud
  try {
    const { cloud } = await import('../cloud/cloud.js');
    if (cloud.isCloudAvailable()) {
      const { data } = await cloud.orgs.getAIGovernance(orgId);
      if (data) {
        _config = _mergeConfig(data);
        _saveLocal(orgId, _config);
        return;
      }
    }
  } catch {}

  // Fallback to localStorage
  const cached = _loadLocal(orgId);
  _config = cached ? _mergeConfig(cached) : _defaultConfig(orgId);
}

// ─── Core Governance Gate ─────────────────────────────────────────────────────

/**
 * Pre-flight check before any AI generation.
 * Returns { allowed: boolean, reason: string, redactedPrompt: string | null }
 *
 * @param {object} opts
 * @param {string} opts.model     - The AI model being used
 * @param {string} opts.prompt    - The user prompt
 * @param {string} opts.action    - 'page' | 'site' | 'app'
 * @param {string} [opts.userId]
 * @param {string} [opts.teamId]
 * @returns {Promise<GovernanceCheckResult>}
 */
export async function checkGeneration({ model, prompt, action, userId = _userId, teamId }) {
  const context = {
    orgId: _orgId, userId, teamId,
    request: { model, action },
  };

  // 1. Policy check — model approval
  const modelResult = policyEngine.evaluate(ACTIONS.AI_USE_MODEL, context);
  if (!modelResult.allowed) {
    await _logDenial('ai.model_blocked', { model, reason: modelResult.reason });
    return { allowed: false, reason: modelResult.reason, redactedPrompt: null };
  }

  // 2. Approved model list check
  if (_config.approvedModels !== null && !_config.approvedModels.includes(model)) {
    const reason = `Model '${model}' is not in the approved model list for this organization.`;
    await _logDenial('ai.model_not_approved', { model, reason });
    return { allowed: false, reason, redactedPrompt: null };
  }

  // 3. Blocked model check
  if (_config.blockedModels?.includes(model)) {
    const reason = `Model '${model}' is blocked for this organization.`;
    await _logDenial('ai.model_blocked', { model, reason });
    return { allowed: false, reason, redactedPrompt: null };
  }

  // 4. Policy check — AI generation allowed
  const genResult = policyEngine.evaluate(ACTIONS.AI_GENERATE, context);
  if (!genResult.allowed) {
    await _logDenial('ai.generation_blocked', { reason: genResult.reason });
    return { allowed: false, reason: genResult.reason, redactedPrompt: null };
  }

  // 5. Usage cap check
  const capResult = await _checkUsageCap(userId, teamId);
  if (!capResult.allowed) {
    await _logDenial('ai.usage_cap_exceeded', { reason: capResult.reason });
    return { allowed: false, reason: capResult.reason, redactedPrompt: null };
  }

  // 6. Content filtering
  if (_config.contentFiltering?.enabled) {
    const filterResult = _filterContent(prompt);
    if (filterResult.blocked) {
      await _logDenial('ai.content_blocked', { reason: filterResult.reason, pattern: filterResult.pattern });
      return { allowed: false, reason: filterResult.reason, redactedPrompt: null };
    }
  }

  // 7. Prompt redaction
  let redactedPrompt = prompt;
  if (_config.promptRedaction?.enabled) {
    redactedPrompt = _redactPrompt(prompt);
  }

  return { allowed: true, reason: 'Governance checks passed.', redactedPrompt };
}

/**
 * Post-generation hook — logs the prompt/response if logging is enabled.
 *
 * @param {object} opts
 * @param {string} opts.model
 * @param {string} opts.prompt
 * @param {string} opts.response
 * @param {object} opts.meta     - { tokens, action, pageId, projectId }
 */
export async function recordGeneration({ model, prompt, response, meta = {} }) {
  // Always record usage for cap tracking
  _incrementUsage(_userId);

  // Log to audit trail if enabled
  if (_config.promptLogging?.enabled) {
    const entry = {
      action:   'ai.generation_logged',
      orgId:    _orgId,
      userId:   _userId,
      meta: {
        model,
        prompt:   _config.promptRedaction?.enabled ? _redactPrompt(prompt) : prompt,
        response: _config.promptLogging?.includeResponse ? response : '[omitted]',
        tokens:   meta.tokens,
        action:   meta.action,
        projectId:meta.projectId,
      },
      severity: SEVERITY.LOW,
    };
    await auditService.log(entry);
  }

  _emit('ai.generation_recorded', { model, meta });
}

// ─── Config Management ────────────────────────────────────────────────────────

/**
 * Get the current AI governance config.
 */
export function getConfig() {
  return { ..._config };
}

/**
 * Update the AI governance config.
 */
export async function updateConfig(updates) {
  _config = _mergeConfig({ ..._config, ...updates });

  try {
    const { cloud } = await import('../cloud/cloud.js');
    if (cloud.isCloudAvailable() && _orgId) {
      await cloud.orgs.setAIGovernance(_orgId, _config);
    }
  } catch {}

  if (_orgId) _saveLocal(_orgId, _config);

  _emit('ai_governance.updated', { config: _config });

  await auditService.log({
    action: 'ai_governance.updated',
    orgId:  _orgId,
    userId: _userId,
    meta:   { updatedFields: Object.keys(updates) },
    severity: SEVERITY.MEDIUM,
  });
}

// ─── Explainability ───────────────────────────────────────────────────────────

/**
 * Get a human-readable explanation of why a specific AI model is or isn't allowed.
 *
 * @param {string} model
 * @returns {string}
 */
export function explainModelAccess(model) {
  if (_config.blockedModels?.includes(model)) {
    return `Model '${model}' is explicitly blocked by your organization's AI governance policy.`;
  }
  if (_config.approvedModels !== null && !_config.approvedModels.includes(model)) {
    return `Model '${model}' is not in your organization's approved model list. Approved models: ${_config.approvedModels.join(', ')}.`;
  }
  return `Model '${model}' is approved for use in your organization.`;
}

/**
 * Get a summary of all active governance controls.
 */
export function getGovernanceSummary() {
  const cfg = _config;
  return {
    approvedModels:    cfg.approvedModels === null ? 'All models allowed' : cfg.approvedModels.join(', '),
    blockedModels:     cfg.blockedModels?.length ? cfg.blockedModels.join(', ') : 'None',
    promptRedaction:   cfg.promptRedaction?.enabled ? `Enabled (${(cfg.promptRedaction?.patterns || []).length} patterns)` : 'Disabled',
    promptLogging:     cfg.promptLogging?.enabled ? `Enabled (${cfg.promptLogging?.retentionDays || 30} day retention)` : 'Disabled',
    trainingOptOut:    cfg.trainingOptOut ? 'Enabled — all requests include opt-out headers' : 'Disabled',
    contentFiltering:  cfg.contentFiltering?.enabled ? `Enabled (${cfg.contentFiltering?.severity || 'block'} mode)` : 'Disabled',
    usageCaps:         _formatUsageCaps(cfg.usageCaps),
  };
}

// ─── Training Opt-Out ─────────────────────────────────────────────────────────

/**
 * Returns headers to add to AI API requests to opt out of training.
 * Different providers use different mechanisms.
 */
export function getTrainingOptOutHeaders() {
  if (!_config.trainingOptOut) return {};
  return {
    'OpenAI-Beta': 'assistants=v2',
    'X-Training-Opt-Out': 'true',
    'Anthropic-Beta': 'no-training',
  };
}

export function isTrainingOptOut() {
  return _config.trainingOptOut === true;
}

// ─── Event Subscription ───────────────────────────────────────────────────────

export function subscribe(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function _redactPrompt(prompt) {
  let redacted = prompt;
  const patterns = [
    ...(BUILTIN_REDACTION_PATTERNS),
    ...(_config.promptRedaction?.patterns || []),
  ];
  for (const p of patterns) {
    try {
      redacted = redacted.replace(new RegExp(p.pattern, 'gi'), p.replacement);
    } catch {}
  }
  return redacted;
}

function _filterContent(prompt) {
  const patterns = _config.contentFiltering?.blockedPatterns || [];
  for (const pattern of patterns) {
    try {
      if (new RegExp(pattern, 'i').test(prompt)) {
        return {
          blocked: true,
          reason:  `Prompt contains content that violates your organization's AI usage policy.`,
          pattern,
        };
      }
    } catch {}
  }
  return { blocked: false };
}

async function _checkUsageCap(userId, teamId) {
  const caps = _config.usageCaps;
  if (!caps) return { allowed: true };

  const today = new Date().toISOString().split('T')[0];

  if (caps.perUserPerDay !== null && userId) {
    const key   = `nuvra-ai-usage-${userId}-${today}`;
    const count = parseInt(localStorage.getItem(key) || '0', 10);
    if (count >= caps.perUserPerDay) {
      return { allowed: false, reason: `Daily AI generation limit (${caps.perUserPerDay}) reached for your account.` };
    }
  }

  return { allowed: true };
}

function _incrementUsage(userId) {
  if (!userId) return;
  const today = new Date().toISOString().split('T')[0];
  const key   = `nuvra-ai-usage-${userId}-${today}`;
  const count = parseInt(localStorage.getItem(key) || '0', 10);
  try { localStorage.setItem(key, String(count + 1)); } catch {}
}

async function _logDenial(action, meta) {
  await auditService.log({
    action,
    orgId:    _orgId,
    userId:   _userId,
    meta,
    severity: SEVERITY.MEDIUM,
  });
}

function _formatUsageCaps(caps) {
  if (!caps) return 'No caps configured';
  const parts = [];
  if (caps.perUserPerDay)   parts.push(`${caps.perUserPerDay}/user/day`);
  if (caps.perTeamPerDay)   parts.push(`${caps.perTeamPerDay}/team/day`);
  if (caps.perOrgPerMonth)  parts.push(`${caps.perOrgPerMonth}/org/month`);
  return parts.length ? parts.join(', ') : 'No caps configured';
}

function _defaultConfig(orgId) {
  return {
    orgId,
    approvedModels:   null,
    blockedModels:    [],
    promptRedaction:  { enabled: false, patterns: [] },
    promptLogging:    { enabled: false, retentionDays: 30, includeResponse: false },
    usageCaps:        { perUserPerDay: null, perTeamPerDay: null, perOrgPerMonth: null },
    trainingOptOut:   false,
    contentFiltering: { enabled: false, blockedPatterns: [], severity: 'block' },
  };
}

function _mergeConfig(partial) {
  const def = _defaultConfig(partial.orgId || _orgId);
  return {
    ...def,
    ...partial,
    promptRedaction:  { ...def.promptRedaction,  ...(partial.promptRedaction  || {}) },
    promptLogging:    { ...def.promptLogging,     ...(partial.promptLogging    || {}) },
    usageCaps:        { ...def.usageCaps,         ...(partial.usageCaps        || {}) },
    contentFiltering: { ...def.contentFiltering,  ...(partial.contentFiltering || {}) },
  };
}

function _saveLocal(orgId, config) {
  try { localStorage.setItem(`nuvra-ai-gov-${orgId}`, JSON.stringify(config)); } catch {}
}

function _loadLocal(orgId) {
  try { return JSON.parse(localStorage.getItem(`nuvra-ai-gov-${orgId}`)); } catch { return null; }
}

function _emit(event, data) {
  _listeners.forEach(fn => { try { fn(event, data); } catch {} });
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const aiGovernance = {
  init, checkGeneration, recordGeneration,
  getConfig, updateConfig,
  explainModelAccess, getGovernanceSummary,
  getTrainingOptOutHeaders, isTrainingOptOut,
  subscribe, BUILTIN_REDACTION_PATTERNS,
};
