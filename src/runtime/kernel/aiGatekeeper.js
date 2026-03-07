/**
 * Nuvra Runtime Kernel — aiGatekeeper.js (Phase 16)
 *
 * The AI Decision Gatekeeper. Every AI action passes through this gate
 * before execution. The gatekeeper evaluates the request against policy,
 * data sensitivity, risk score, cost budget, and authorization level.
 *
 * Decisions:
 *   allow           — Proceed as requested
 *   modify          — Proceed with modifications (e.g., redacted prompt)
 *   delay           — Queue for later execution (e.g., off-peak hours)
 *   require_approval — Block until a human approves
 *   block           — Deny execution entirely
 *
 * Every decision is recorded in the ExplainabilityLedger for audit.
 *
 * @module runtime/aiGatekeeper
 */
'use strict';

import { ACTOR, INTENT, RISK_LEVEL } from './executionContext.js';

// ─── Decision Constants ───────────────────────────────────────────────────────
export const DECISION = Object.freeze({
  ALLOW:            'allow',
  MODIFY:           'modify',
  DELAY:            'delay',
  REQUIRE_APPROVAL: 'require_approval',
  BLOCK:            'block',
});

// ─── Gatekeeper Result ────────────────────────────────────────────────────────
/**
 * @typedef {object} GatekeeperResult
 * @property {string}   decision          - DECISION constant
 * @property {string}   reason            - Human-readable explanation
 * @property {string}   [appliedRule]     - The rule that triggered this decision
 * @property {string}   [regulation]      - The regulation that applies (e.g., 'GDPR Art. 22')
 * @property {object}   [modifications]   - Modifications applied to the request (if decision=modify)
 * @property {string[]} [redactedFields]  - Fields that were redacted from the prompt
 * @property {number}   [estimatedCost]   - Estimated token cost of the request
 * @property {number}   [riskScore]       - Computed risk score (0-100)
 * @property {number}   timestamp
 */

// ─── Built-in Evaluation Rules ────────────────────────────────────────────────
// Rules are evaluated in order. First match that returns a non-null decision wins.
const BUILT_IN_RULES = [

  // ── Safety Rules ──────────────────────────────────────────────────────────

  {
    name: 'block-pii-in-prompt',
    description: 'Block AI requests that contain PII in the prompt without explicit consent.',
    evaluate(ctx, meta) {
      if (!meta.prompt) return null;
      const piiPatterns = [
        /\b\d{3}-\d{2}-\d{4}\b/,                        // SSN
        /\b(?:\d{4}[- ]){3}\d{4}\b/,                    // Credit card
        /\b[A-Z]{2}\d{6}[A-Z]?\b/,                      // Passport
        /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,                // Phone
      ];
      const detected = piiPatterns.filter(p => p.test(meta.prompt));
      if (detected.length > 0 && !meta.piiConsentGranted) {
        return {
          decision: DECISION.BLOCK,
          reason:   'The prompt contains PII (personally identifiable information). Remove sensitive data before generating.',
          appliedRule: 'block-pii-in-prompt',
          regulation: 'GDPR Art. 5(1)(c) — Data Minimisation',
        };
      }
      return null;
    },
  },

  {
    name: 'block-phi-in-prompt',
    description: 'Block AI requests containing PHI when HIPAA is active.',
    evaluate(ctx, meta) {
      if (!ctx.requiresCompliance('hipaa')) return null;
      if (!meta.prompt) return null;
      const phiPatterns = [
        /\b(?:mrn|medical record|patient id)\s*[:#]?\s*\d+/i,
        /\b(?:diagnosis|prescribed|medication|dosage)\b/i,
        /\b(?:dob|date of birth)\s*[:#]?\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/i,
      ];
      const detected = phiPatterns.filter(p => p.test(meta.prompt));
      if (detected.length > 0) {
        return {
          decision: DECISION.BLOCK,
          reason:   'The prompt contains Protected Health Information (PHI). HIPAA prohibits sending PHI to AI providers without a Business Associate Agreement.',
          appliedRule: 'block-phi-in-prompt',
          regulation: 'HIPAA § 164.502',
        };
      }
      return null;
    },
  },

  {
    name: 'require-approval-agent-deploy',
    description: 'Require human approval before an agent deploys to production.',
    evaluate(ctx, meta) {
      if (ctx.actor !== ACTOR.AGENT) return null;
      if (ctx.intent !== INTENT.DEPLOY) return null;
      return {
        decision:    DECISION.REQUIRE_APPROVAL,
        reason:      'Agent deployment to production requires human approval.',
        appliedRule: 'require-approval-agent-deploy',
      };
    },
  },

  {
    name: 'require-approval-agent-schema-change',
    description: 'Require human approval before an agent modifies data schemas.',
    evaluate(ctx, meta) {
      if (ctx.actor !== ACTOR.AGENT) return null;
      if (ctx.intent !== INTENT.MODIFY) return null;
      if (!meta.targetType || meta.targetType !== 'schema') return null;
      return {
        decision:    DECISION.REQUIRE_APPROVAL,
        reason:      'Schema modifications by agents require human approval to prevent data loss.',
        appliedRule: 'require-approval-agent-schema-change',
      };
    },
  },

  // ── Cost / Budget Rules ───────────────────────────────────────────────────

  {
    name: 'block-over-budget',
    description: 'Block requests that exceed the remaining AI token budget.',
    evaluate(ctx, meta) {
      if (!meta.estimatedTokens || !meta.remainingBudget) return null;
      if (meta.estimatedTokens > meta.remainingBudget) {
        return {
          decision:      DECISION.BLOCK,
          reason:        `This request requires ~${meta.estimatedTokens.toLocaleString()} tokens but only ${meta.remainingBudget.toLocaleString()} remain in your budget.`,
          appliedRule:   'block-over-budget',
          estimatedCost: meta.estimatedTokens,
        };
      }
      return null;
    },
  },

  {
    name: 'warn-high-cost',
    description: 'Require approval for unusually expensive requests.',
    evaluate(ctx, meta) {
      if (!meta.estimatedTokens) return null;
      if (meta.estimatedTokens > 50_000) {
        return {
          decision:      DECISION.REQUIRE_APPROVAL,
          reason:        `This request is estimated to use ${meta.estimatedTokens.toLocaleString()} tokens (~$${(meta.estimatedTokens * 0.00002).toFixed(2)}). Please confirm.`,
          appliedRule:   'warn-high-cost',
          estimatedCost: meta.estimatedTokens,
        };
      }
      return null;
    },
  },

  // ── Data Sensitivity Rules ────────────────────────────────────────────────

  {
    name: 'redact-sensitive-context',
    description: 'Automatically redact sensitive fields from AI context before sending.',
    evaluate(ctx, meta) {
      if (!meta.contextData) return null;
      const sensitiveKeys = ['password', 'secret', 'token', 'apiKey', 'api_key', 'privateKey', 'ssn', 'creditCard'];
      const redacted = [];
      const cleanedContext = JSON.parse(JSON.stringify(meta.contextData));

      function redactObject(obj) {
        if (typeof obj !== 'object' || obj === null) return;
        for (const key of Object.keys(obj)) {
          if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
            obj[key] = '[REDACTED]';
            redacted.push(key);
          } else {
            redactObject(obj[key]);
          }
        }
      }
      redactObject(cleanedContext);

      if (redacted.length > 0) {
        return {
          decision:       DECISION.MODIFY,
          reason:         `Sensitive fields were automatically redacted from the AI context: ${redacted.join(', ')}.`,
          appliedRule:    'redact-sensitive-context',
          modifications:  { contextData: cleanedContext },
          redactedFields: redacted,
        };
      }
      return null;
    },
  },

  // ── Authorization Rules ───────────────────────────────────────────────────

  {
    name: 'block-unauthenticated-prod-deploy',
    description: 'Block anonymous users from deploying to production.',
    evaluate(ctx, meta) {
      if (ctx.intent !== INTENT.DEPLOY) return null;
      if (ctx.actorId === 'anonymous' || !ctx.actorId) {
        return {
          decision:    DECISION.BLOCK,
          reason:      'You must be signed in to deploy to production.',
          appliedRule: 'block-unauthenticated-prod-deploy',
        };
      }
      return null;
    },
  },

  {
    name: 'block-viewer-modify',
    description: 'Block users with viewer role from modifying content.',
    evaluate(ctx, meta) {
      if (ctx.intent !== INTENT.MODIFY && ctx.intent !== INTENT.BUILD) return null;
      if (ctx.meta?.role === 'viewer') {
        return {
          decision:    DECISION.BLOCK,
          reason:      'Viewers cannot modify content. Contact your administrator to change your role.',
          appliedRule: 'block-viewer-modify',
        };
      }
      return null;
    },
  },
];

// ─── Internal State ───────────────────────────────────────────────────────────
let _customRules    = [];
let _ledger         = null;   // ExplainabilityLedger reference
let _orgRules       = [];     // Org-specific rules loaded from policyEngine
let _initialized    = false;

// ─── Initialization ───────────────────────────────────────────────────────────
export function init(options = {}) {
  _ledger = options.ledger || null;
  _initialized = true;
}

export function setOrgRules(rules = []) {
  _orgRules = rules;
}

// ─── Primary Evaluation ───────────────────────────────────────────────────────
/**
 * Evaluate an execution context and request metadata against all gatekeeper rules.
 *
 * @param {ExecutionContext} ctx  - The execution context
 * @param {object}           meta - Request metadata (prompt, estimatedTokens, etc.)
 * @returns {Promise<GatekeeperResult>}
 */
export async function evaluate(ctx, meta = {}) {
  const allRules = [..._customRules, ..._orgRules, ...BUILT_IN_RULES];

  let finalDecision = null;

  for (const rule of allRules) {
    try {
      const result = await Promise.resolve(rule.evaluate(ctx, meta));
      if (result !== null && result !== undefined) {
        finalDecision = result;
        // BLOCK and REQUIRE_APPROVAL are terminal — stop evaluating
        if (result.decision === DECISION.BLOCK || result.decision === DECISION.REQUIRE_APPROVAL) {
          break;
        }
        // MODIFY: apply modifications and continue evaluating remaining rules
        if (result.decision === DECISION.MODIFY && result.modifications) {
          meta = { ...meta, ...result.modifications };
        }
      }
    } catch (e) {
      console.warn(`[Gatekeeper] Rule "${rule.name}" threw an error:`, e.message);
    }
  }

  const gatekeeperResult = finalDecision || {
    decision:    DECISION.ALLOW,
    reason:      'All gatekeeper checks passed.',
    appliedRule: 'default-allow',
    timestamp:   Date.now(),
  };

  gatekeeperResult.timestamp = Date.now();

  // Record in explainability ledger
  if (_ledger) {
    await _ledger.record(ctx, meta, gatekeeperResult).catch(() => {});
  }

  return gatekeeperResult;
}

// ─── Custom Rule Management ───────────────────────────────────────────────────
export function addRule(rule) {
  _customRules.unshift(rule);
}

export function removeRule(name) {
  _customRules = _customRules.filter(r => r.name !== name);
}

export function listRules() {
  return [
    ..._customRules.map(r => ({ ...r, source: 'custom' })),
    ..._orgRules.map(r => ({ ...r, source: 'org' })),
    ...BUILT_IN_RULES.map(r => ({ name: r.name, description: r.description, source: 'built-in' })),
  ];
}

// ─── Singleton export ─────────────────────────────────────────────────────────
export const aiGatekeeper = { init, evaluate, addRule, removeRule, listRules, setOrgRules };
export default aiGatekeeper;
