/**
 * intentAnalyzer.js — Nuvra Phase 2–2.5
 *
 * The Intent Analysis Engine.
 *
 * This is NOT a generator. It is an understanding layer.
 *
 * Responsibilities:
 *  - Receive a raw user prompt
 *  - Dispatch it to the AI adapter with a strict analysis prompt
 *  - Validate the AI's structured response
 *  - Normalize the output into a canonical IntentSchema
 *  - Flag ambiguities and document assumptions
 *  - Emit events for observability
 *
 * The AI is instructed to return JSON only.
 * If it returns anything else, the analysis fails loudly.
 *
 * @module ai/intent/intentAnalyzer
 */
'use strict';

import { eventBus }       from '../../runtime/eventBus.js';
import { logger }         from '../../diagnostics/logger.js';
import { errorBoundary, ErrorSeverity } from '../../diagnostics/errorBoundary.js';
import { aiAdapter }      from '../adapter/aiAdapter.js';
import { schemaValidator } from '../validator/schemaValidator.js';
import {
  createIntentSchema,
  validateIntentSchema,
  ProductType,
  Complexity,
  INTENT_SCHEMA_VERSION,
} from './intentTypes.js';
import { generateId, now } from '../../runtime/utils.js';

// ─── System Prompt ────────────────────────────────────────────────────────────
const INTENT_SYSTEM_PROMPT = `You are the Intent Analysis Engine for Nuvra, a professional website and app builder.

Your ONLY job is to analyze a user's description of what they want to build and return a structured JSON object.

You MUST:
- Return ONLY valid JSON. No markdown, no explanation, no code blocks.
- Be precise and literal. Do not invent details not present or strongly implied.
- Document every assumption you make.
- Flag every ambiguity you detect.
- Normalize vague language into specific, actionable terms.

You MUST NOT:
- Generate HTML, CSS, or JavaScript.
- Write copy or content.
- Make visual design decisions.
- Suggest specific colors, fonts, or layouts.

The JSON you return must conform exactly to this structure:
{
  "product": {
    "type": "<site|app|hybrid|landing|portfolio|ecommerce|saas|blog|unknown>",
    "domain": "<industry or domain, e.g. 'fitness', 'fintech', 'healthcare', 'education'>",
    "subDomain": "<more specific context, e.g. 'B2B SaaS', 'D2C e-commerce', or empty string>"
  },
  "audience": {
    "primary": "<single sentence describing the primary target audience>",
    "secondary": ["<secondary audience 1>", "..."],
    "painPoints": ["<pain point 1>", "..."],
    "goals": ["<what the audience wants to achieve>", "..."]
  },
  "brand": {
    "name": "<brand or product name, or empty string if not mentioned>",
    "tone": ["<tone adjective 1>", "..."],
    "personality": ["<personality trait 1>", "..."],
    "avoid": ["<thing to avoid in tone/style>", "..."]
  },
  "goals": {
    "primary": "<the single most important business goal, e.g. 'lead capture', 'direct sales', 'brand awareness'>",
    "secondary": ["<secondary goal 1>", "..."],
    "kpis": ["<measurable outcome 1>", "..."]
  },
  "features": {
    "required": ["<explicitly requested feature>", "..."],
    "implied": ["<feature implied by context>", "..."],
    "excluded": ["<feature explicitly NOT wanted>", "..."]
  },
  "content": {
    "sections": ["<section type mentioned or implied, e.g. 'hero', 'pricing', 'testimonials'>", "..."],
    "mustHave": ["<content that must appear>", "..."],
    "mustAvoid": ["<content to exclude>", "..."]
  },
  "constraints": {
    "pages": <number or null>,
    "complexity": "<simple|moderate|complex>",
    "timeline": "<urgency description or null>"
  },
  "confidence": <0.0 to 1.0>,
  "ambiguities": [
    { "field": "<field name>", "description": "<what is unclear>", "suggestion": "<how to resolve>" }
  ],
  "assumptions": [
    { "field": "<field name>", "value": "<assumed value>", "reason": "<why this assumption was made>" }
  ]
}`;

// ─── IntentAnalyzer ───────────────────────────────────────────────────────────
export const intentAnalyzer = {
  id:   'intentAnalyzer',

  /**
   * Analyze a raw user prompt and return a canonical IntentSchema.
   *
   * @param {string} rawPrompt
   * @param {object} [options]
   * @param {boolean} [options.deterministic] - use temperature=0 for reproducible output
   * @returns {Promise<{ intent: object, raw: object, errors: string[] }>}
   */
  async analyze(rawPrompt, { deterministic = true } = {}) {
    if (!rawPrompt || typeof rawPrompt !== 'string' || !rawPrompt.trim()) {
      return { intent: null, raw: null, errors: ['rawPrompt must be a non-empty string'] };
    }

    const prompt = rawPrompt.trim();
    logger.info('intentAnalyzer', `Analyzing intent for prompt (${prompt.length} chars)`, { deterministic });
    eventBus.emit('ai:intent_analysis_started', { promptLength: prompt.length });

    // ── Call AI adapter ──────────────────────────────────────────────────────
    let rawAiResponse;
    try {
      rawAiResponse = await aiAdapter.complete({
        systemPrompt: INTENT_SYSTEM_PROMPT,
        userMessage:  prompt,
        temperature:  deterministic ? 0 : 0.3,
        maxTokens:    1500,
        responseFormat: 'json',
      });
    } catch (err) {
      const msg = `AI adapter error: ${err.message}`;
      logger.error('intentAnalyzer', msg);
      errorBoundary.capture(err, { module: 'intentAnalyzer', context: 'AI call', severity: ErrorSeverity.HIGH });
      return { intent: null, raw: null, errors: [msg] };
    }

    // ── Parse AI response ────────────────────────────────────────────────────
    let parsed;
    try {
      parsed = typeof rawAiResponse === 'string' ? JSON.parse(rawAiResponse) : rawAiResponse;
    } catch (err) {
      const msg = `AI returned non-JSON response: ${String(rawAiResponse).slice(0, 200)}`;
      logger.error('intentAnalyzer', msg);
      return { intent: null, raw: rawAiResponse, errors: [msg] };
    }

    // ── Validate AI output structure ─────────────────────────────────────────
    const validationErrors = schemaValidator.validateIntentAiOutput(parsed);
    if (validationErrors.length > 0) {
      logger.warn('intentAnalyzer', 'AI output failed validation', { validationErrors });
      return { intent: null, raw: parsed, errors: validationErrors };
    }

    // ── Normalize into canonical IntentSchema ────────────────────────────────
    const intent = this._normalize(parsed, prompt);

    // ── Final validation ─────────────────────────────────────────────────────
    const schemaErrors = validateIntentSchema(intent);
    if (schemaErrors.length > 0) {
      logger.error('intentAnalyzer', 'Normalized intent failed schema validation', { schemaErrors });
      return { intent: null, raw: parsed, errors: schemaErrors };
    }

    logger.info('intentAnalyzer', `Intent analysis complete (confidence: ${intent.confidence})`, {
      productType: intent.product.type,
      domain:      intent.product.domain,
      ambiguities: intent.ambiguities.length,
      assumptions: intent.assumptions.length,
    });

    eventBus.emit('ai:intent_analysis_complete', {
      intentId:    intent.id,
      confidence:  intent.confidence,
      ambiguities: intent.ambiguities.length,
    });

    return { intent, raw: parsed, errors: [] };
  },

  // ── Private ────────────────────────────────────────────────────────────────
  _normalize(parsed, rawPrompt) {
    const base = createIntentSchema(rawPrompt);

    // Product
    base.product.type      = this._normalizeProductType(parsed.product?.type);
    base.product.domain    = String(parsed.product?.domain || '').toLowerCase().trim();
    base.product.subDomain = String(parsed.product?.subDomain || '').trim();

    // Audience
    base.audience.primary    = String(parsed.audience?.primary || '').trim();
    base.audience.secondary  = this._normalizeStringArray(parsed.audience?.secondary);
    base.audience.painPoints = this._normalizeStringArray(parsed.audience?.painPoints);
    base.audience.goals      = this._normalizeStringArray(parsed.audience?.goals);

    // Brand
    base.brand.name        = String(parsed.brand?.name || '').trim();
    base.brand.tone        = this._normalizeStringArray(parsed.brand?.tone);
    base.brand.personality = this._normalizeStringArray(parsed.brand?.personality);
    base.brand.avoid       = this._normalizeStringArray(parsed.brand?.avoid);

    // Goals
    base.goals.primary   = String(parsed.goals?.primary || '').trim();
    base.goals.secondary = this._normalizeStringArray(parsed.goals?.secondary);
    base.goals.kpis      = this._normalizeStringArray(parsed.goals?.kpis);

    // Features
    base.features.required = this._normalizeStringArray(parsed.features?.required);
    base.features.implied  = this._normalizeStringArray(parsed.features?.implied);
    base.features.excluded = this._normalizeStringArray(parsed.features?.excluded);

    // Content
    base.content.sections  = this._normalizeStringArray(parsed.content?.sections);
    base.content.mustHave  = this._normalizeStringArray(parsed.content?.mustHave);
    base.content.mustAvoid = this._normalizeStringArray(parsed.content?.mustAvoid);

    // Constraints
    base.constraints.pages      = typeof parsed.constraints?.pages === 'number' ? parsed.constraints.pages : null;
    base.constraints.complexity = this._normalizeComplexity(parsed.constraints?.complexity);
    base.constraints.timeline   = parsed.constraints?.timeline ? String(parsed.constraints.timeline) : null;

    // Confidence & meta
    base.confidence  = this._clamp(Number(parsed.confidence) || 0, 0, 1);
    base.ambiguities = this._normalizeAmbiguities(parsed.ambiguities);
    base.assumptions = this._normalizeAssumptions(parsed.assumptions);

    return base;
  },

  _normalizeProductType(raw) {
    const valid = Object.values(ProductType);
    const v = String(raw || '').toLowerCase().trim();
    return valid.includes(v) ? v : ProductType.UNKNOWN;
  },

  _normalizeComplexity(raw) {
    const valid = Object.values(Complexity);
    const v = String(raw || '').toLowerCase().trim();
    return valid.includes(v) ? v : Complexity.MODERATE;
  },

  _normalizeStringArray(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(s => String(s || '').trim()).filter(Boolean);
  },

  _normalizeAmbiguities(arr) {
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(a => a && typeof a === 'object')
      .map(a => ({
        field:       String(a.field || '').trim(),
        description: String(a.description || '').trim(),
        suggestion:  String(a.suggestion || '').trim(),
      }))
      .filter(a => a.field && a.description);
  },

  _normalizeAssumptions(arr) {
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(a => a && typeof a === 'object')
      .map(a => ({
        field:  String(a.field || '').trim(),
        value:  String(a.value || '').trim(),
        reason: String(a.reason || '').trim(),
      }))
      .filter(a => a.field && a.value);
  },

  _clamp(v, min, max) { return Math.min(Math.max(v, min), max); },
};

export default intentAnalyzer;
