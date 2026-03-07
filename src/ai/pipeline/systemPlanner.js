/**
 * systemPlanner.js — Nuvra Phase 5
 *
 * Pipeline Step 2: System Planning.
 *
 * Converts an IntentSchema into a SystemPlan — a structured blueprint
 * for the entire application before any schema assembly occurs.
 *
 * The SystemPlan defines:
 *   - Pages and their types
 *   - Data collections and their fields
 *   - Relations between collections
 *   - Actions and their triggers
 *   - State flows
 *   - Permissions model
 *   - Planning decisions (each with a reason)
 *
 * The AI reasons about the SYSTEM, not about UI.
 * It never mentions HTML, CSS, or components at this stage.
 *
 * @module ai/pipeline/systemPlanner
 */
'use strict';

import { budgetEngine } from '../budget/budgetEngine.js';
import { providerRegistry } from '../providers/providerRegistry.js';
import { ProviderErrorCode } from '../providers/providerContract.js';

// ─── System Prompt ────────────────────────────────────────────────────────────
const PLANNER_SYSTEM_PROMPT = `You are the System Planning module of Nuvra, an AI-native app builder.

You receive a structured IntentSchema and produce a SystemPlan.

You are planning a SOFTWARE SYSTEM, not a website layout.
Think like a senior product engineer, not a designer.

You MUST output valid JSON matching this exact schema:
{
  "pages": [
    {
      "id":       string,   // slug, e.g., "page_dashboard"
      "name":     string,   // Display name
      "slug":     string,   // URL slug, e.g., "dashboard"
      "mode":     "marketing" | "app" | "hybrid",
      "isHome":   boolean,
      "purpose":  string,   // One sentence: what this page does
      "reason":   string,   // Why this page was included
      "sections": string[]  // Section types, e.g., ["hero", "features", "cta"]
    }
  ],
  "collections": [
    {
      "id":       string,   // e.g., "tasks"
      "name":     string,   // Display name
      "purpose":  string,   // What this data represents
      "fields": [
        {
          "id":       string,
          "label":    string,
          "type":     "text" | "number" | "boolean" | "date" | "select" | "email" | "url" | "relation" | "richtext",
          "required": boolean,
          "options":  string[] | null,  // For select fields
          "relatesTo": string | null    // Collection ID for relation fields
        }
      ],
      "reason": string
    }
  ],
  "relations": [
    {
      "from":     string,   // Collection ID
      "to":       string,   // Collection ID
      "type":     "one_to_many" | "many_to_many" | "one_to_one",
      "label":    string,
      "reason":   string
    }
  ],
  "actions": [
    {
      "id":       string,
      "name":     string,
      "trigger":  "button_click" | "form_submit" | "page_load" | "data_change" | "scheduled",
      "steps":    string[],  // High-level step descriptions
      "reason":   string
    }
  ],
  "stateFlows": [
    {
      "id":       string,
      "name":     string,
      "scope":    "global" | "page",
      "type":     "text" | "number" | "boolean" | "select",
      "purpose":  string,
      "reason":   string
    }
  ],
  "permissions": {
    "model":    "public" | "auth_required" | "role_based",
    "roles":    string[],
    "reason":   string
  },
  "decisions": [
    {
      "category": string,
      "decision": string,
      "reason":   string
    }
  ]
}

Rules:
- Every page, collection, action, and state flow MUST have a "reason" field
- Collections should only be created if they are actually needed by the app
- For "site" outputType: no collections, no actions, focus on pages and sections
- For "app" outputType: focus on collections, actions, and state flows
- For "hybrid": include both
- Actions should be high-level (e.g., "Create task", "Delete record") — not implementation details
- Permissions: "public" for sites, "auth_required" for apps with user data
- decisions: list the 3-5 most important architectural decisions you made`;

// ─── SystemPlanner ────────────────────────────────────────────────────────────
class SystemPlanner {
  /**
   * Produce a SystemPlan from an IntentSchema.
   *
   * @param {object} params
   * @param {object}   params.intent    - IntentSchema from Step 1
   * @param {object}   [params.provider] - Provider override
   * @returns {Promise<{ ok: boolean, plan?: SystemPlan, error?: string, usage?: object }>}
   */
  async plan({ intent, provider }) {
    if (!intent || intent._type !== 'IntentSchema') {
      return { ok: false, error: 'Valid IntentSchema is required' };
    }

    const activeProvider = provider || providerRegistry.getActive();

    // ── Budget check ────────────────────────────────────────────────────────
    const intentSummary = JSON.stringify(intent, null, 2);
    const budgetCheck = budgetEngine.check({
      inputTokens:   _estimateTokens(PLANNER_SYSTEM_PROMPT) + _estimateTokens(intentSummary),
      outputTokens:  2000,
      provider:      activeProvider,
      operationType: 'planning',
    });

    if (!budgetCheck.allowed) {
      return { ok: false, error: budgetCheck.blocked, errorCode: ProviderErrorCode.BUDGET_EXCEEDED };
    }

    // ── Build user prompt ───────────────────────────────────────────────────
    const userPrompt = `Produce a SystemPlan for this intent:\n\n${intentSummary}`;

    // ── Call provider ───────────────────────────────────────────────────────
    const start = Date.now();
    const response = await activeProvider.call({
      systemPrompt: PLANNER_SYSTEM_PROMPT,
      userPrompt,
      maxTokens:    2000,
      temperature:  0,
      requestId:    _generateId('plan'),
    });

    // ── Record usage ────────────────────────────────────────────────────────
    budgetEngine.record({
      operationType: 'planning',
      providerId:    activeProvider.id,
      usage:         response.usage,
      cost:          activeProvider.estimateCost(response.usage),
      ok:            response.ok,
      latencyMs:     response.latencyMs,
    });

    if (!response.ok) {
      return { ok: false, error: response.error, errorCode: response.errorCode };
    }

    // ── Validate output ─────────────────────────────────────────────────────
    const validation = _validatePlan(response.data);
    if (!validation.ok) {
      return {
        ok:        false,
        error:     `System planning produced invalid schema: ${validation.errors.join(', ')}`,
        errorCode: ProviderErrorCode.SCHEMA_MISMATCH,
        raw:       response.data,
      };
    }

    const plan = _normalizePlan(response.data, intent);

    return {
      ok:      true,
      plan,
      usage:   response.usage,
      latency: Date.now() - start,
    };
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────
function _validatePlan(data) {
  const errors = [];
  if (!data || typeof data !== 'object')     errors.push('output is not an object');
  if (!Array.isArray(data?.pages))           errors.push('pages must be an array');
  if (!Array.isArray(data?.collections))     errors.push('collections must be an array');
  if (!Array.isArray(data?.actions))         errors.push('actions must be an array');
  if (!Array.isArray(data?.stateFlows))      errors.push('stateFlows must be an array');
  if (!Array.isArray(data?.decisions))       errors.push('decisions must be an array');
  if (!data?.permissions)                    errors.push('permissions is required');

  // Validate pages
  for (const [i, page] of (data?.pages || []).entries()) {
    if (!page.id)      errors.push(`pages[${i}].id is required`);
    if (!page.name)    errors.push(`pages[${i}].name is required`);
    if (!page.mode)    errors.push(`pages[${i}].mode is required`);
    if (!page.reason)  errors.push(`pages[${i}].reason is required`);
  }

  // Validate collections
  for (const [i, coll] of (data?.collections || []).entries()) {
    if (!coll.id)      errors.push(`collections[${i}].id is required`);
    if (!coll.name)    errors.push(`collections[${i}].name is required`);
    if (!Array.isArray(coll.fields)) errors.push(`collections[${i}].fields must be an array`);
  }

  return { ok: errors.length === 0, errors };
}

function _normalizePlan(data, intent) {
  return {
    _type:        'SystemPlan',
    _version:     1,
    _plannedAt:   Date.now(),
    _intentId:    intent._extractedAt,
    pages:        (data.pages || []).map(_normalizePage),
    collections:  (data.collections || []).map(_normalizeCollection),
    relations:    (data.relations || []).map(_normalizeRelation),
    actions:      (data.actions || []).map(_normalizeAction),
    stateFlows:   (data.stateFlows || []).map(_normalizeStateFlow),
    permissions:  data.permissions || { model: 'public', roles: [], reason: 'Default' },
    decisions:    (data.decisions || []).map(d => ({
      category: String(d.category || 'general'),
      decision: String(d.decision || ''),
      reason:   String(d.reason   || ''),
    })),
  };
}

function _normalizePage(p) {
  return {
    id:       String(p.id || _generateId('page')),
    name:     String(p.name || 'Page'),
    slug:     String(p.slug || p.name?.toLowerCase().replace(/\s+/g, '-') || 'page'),
    mode:     ['marketing','app','hybrid'].includes(p.mode) ? p.mode : 'app',
    isHome:   Boolean(p.isHome),
    purpose:  String(p.purpose || ''),
    reason:   String(p.reason  || ''),
    sections: Array.isArray(p.sections) ? p.sections : [],
  };
}

function _normalizeCollection(c) {
  return {
    id:      String(c.id || _generateId('coll')),
    name:    String(c.name || 'Collection'),
    purpose: String(c.purpose || ''),
    reason:  String(c.reason  || ''),
    fields:  (c.fields || []).map(f => ({
      id:        String(f.id || _generateId('field')),
      label:     String(f.label || 'Field'),
      type:      f.type || 'text',
      required:  Boolean(f.required),
      options:   Array.isArray(f.options) ? f.options : null,
      relatesTo: f.relatesTo || null,
    })),
  };
}

function _normalizeRelation(r) {
  return {
    from:   String(r.from || ''),
    to:     String(r.to   || ''),
    type:   r.type || 'one_to_many',
    label:  String(r.label  || ''),
    reason: String(r.reason || ''),
  };
}

function _normalizeAction(a) {
  return {
    id:      String(a.id || _generateId('action')),
    name:    String(a.name || 'Action'),
    trigger: a.trigger || 'button_click',
    steps:   Array.isArray(a.steps) ? a.steps.map(String) : [],
    reason:  String(a.reason || ''),
  };
}

function _normalizeStateFlow(s) {
  return {
    id:      String(s.id || _generateId('state')),
    name:    String(s.name || 'State'),
    scope:   ['global','page'].includes(s.scope) ? s.scope : 'global',
    type:    s.type || 'text',
    purpose: String(s.purpose || ''),
    reason:  String(s.reason  || ''),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

function _generateId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const systemPlanner = new SystemPlanner();
export default systemPlanner;
