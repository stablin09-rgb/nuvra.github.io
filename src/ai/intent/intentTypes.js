/**
 * intentTypes.js — Nuvra Phase 2–2.5
 *
 * Canonical definitions for the IntentSchema — the structured output
 * of the Intent Analysis Engine.
 *
 * An IntentSchema is NOT a site plan. It is the normalized understanding
 * of what the user wants to build, extracted from natural language.
 *
 * It answers:
 *   - What kind of product is this?
 *   - Who is it for?
 *   - What must it communicate?
 *   - What must it do?
 *   - How confident are we in our understanding?
 *   - What is ambiguous?
 *
 * IntentSchema shape:
 * {
 *   id:           string   — unique identifier for this intent analysis
 *   version:      number   — schema version
 *   rawPrompt:    string   — the original user input, preserved verbatim
 *   createdAt:    number   — Unix ms
 *
 *   product: {
 *     type:       string   — 'site' | 'app' | 'hybrid' | 'landing' | 'portfolio' | 'ecommerce' | 'saas' | 'blog'
 *     domain:     string   — industry/domain (e.g. 'fitness', 'fintech', 'healthcare')
 *     subDomain:  string   — more specific context (e.g. 'B2B SaaS', 'D2C e-commerce')
 *   }
 *
 *   audience: {
 *     primary:    string   — primary target audience description
 *     secondary:  string[] — secondary audiences
 *     painPoints: string[] — known pain points of the audience
 *     goals:      string[] — what the audience wants to achieve
 *   }
 *
 *   brand: {
 *     name:       string   — brand/product name if mentioned
 *     tone:       string[] — tone adjectives (e.g. ['professional', 'warm', 'bold'])
 *     personality:string[] — brand personality traits
 *     avoid:      string[] — things to explicitly avoid in tone/style
 *   }
 *
 *   goals: {
 *     primary:    string   — the single most important goal (e.g. 'lead capture')
 *     secondary:  string[] — supporting goals
 *     kpis:       string[] — measurable outcomes mentioned
 *   }
 *
 *   features: {
 *     required:   string[] — explicitly requested features
 *     implied:    string[] — features implied by context
 *     excluded:   string[] — features explicitly NOT wanted
 *   }
 *
 *   content: {
 *     sections:   string[] — content sections mentioned or implied
 *     mustHave:   string[] — content that must appear
 *     mustAvoid:  string[] — content to exclude
 *   }
 *
 *   constraints: {
 *     pages:      number|null  — max number of pages if specified
 *     complexity: string       — 'simple' | 'moderate' | 'complex'
 *     timeline:   string|null  — urgency/timeline if mentioned
 *   }
 *
 *   confidence:   number   — 0.0–1.0, overall confidence in this analysis
 *   ambiguities:  Array<{ field: string, description: string, suggestion: string }>
 *   assumptions:  Array<{ field: string, value: string, reason: string }>
 * }
 *
 * @module ai/intent/intentTypes
 */
'use strict';

import { generateId, now } from '../../runtime/utils.js';

// ─── Constants ────────────────────────────────────────────────────────────────
export const INTENT_SCHEMA_VERSION = 1;

export const ProductType = Object.freeze({
  SITE:       'site',
  APP:        'app',
  HYBRID:     'hybrid',
  LANDING:    'landing',
  PORTFOLIO:  'portfolio',
  ECOMMERCE:  'ecommerce',
  SAAS:       'saas',
  BLOG:       'blog',
  UNKNOWN:    'unknown',
});

export const Complexity = Object.freeze({
  SIMPLE:   'simple',
  MODERATE: 'moderate',
  COMPLEX:  'complex',
});

// ─── Factory ──────────────────────────────────────────────────────────────────
/**
 * Create an empty IntentSchema scaffold.
 * Used as the base for the intent analysis output.
 * @param {string} rawPrompt
 * @returns {object} IntentSchema
 */
export function createIntentSchema(rawPrompt = '') {
  return {
    id:        generateId('intent'),
    version:   INTENT_SCHEMA_VERSION,
    rawPrompt: String(rawPrompt),
    createdAt: now(),

    product: {
      type:      ProductType.UNKNOWN,
      domain:    '',
      subDomain: '',
    },

    audience: {
      primary:    '',
      secondary:  [],
      painPoints: [],
      goals:      [],
    },

    brand: {
      name:        '',
      tone:        [],
      personality: [],
      avoid:       [],
    },

    goals: {
      primary:   '',
      secondary: [],
      kpis:      [],
    },

    features: {
      required: [],
      implied:  [],
      excluded: [],
    },

    content: {
      sections:  [],
      mustHave:  [],
      mustAvoid: [],
    },

    constraints: {
      pages:      null,
      complexity: Complexity.MODERATE,
      timeline:   null,
    },

    confidence:   0,
    ambiguities:  [],
    assumptions:  [],
  };
}

/**
 * Validate an IntentSchema. Returns an array of error strings (empty = valid).
 * @param {object} intent
 * @returns {string[]}
 */
export function validateIntentSchema(intent) {
  const errors = [];
  if (!intent || typeof intent !== 'object')  { errors.push('intent must be an object'); return errors; }
  if (!intent.id)                              errors.push('intent.id is required');
  if (typeof intent.rawPrompt !== 'string')    errors.push('intent.rawPrompt must be a string');
  if (!intent.product || typeof intent.product !== 'object') errors.push('intent.product is required');
  if (!intent.audience || typeof intent.audience !== 'object') errors.push('intent.audience is required');
  if (!intent.goals || typeof intent.goals !== 'object') errors.push('intent.goals is required');
  if (typeof intent.confidence !== 'number')   errors.push('intent.confidence must be a number');
  if (!Array.isArray(intent.ambiguities))      errors.push('intent.ambiguities must be an array');
  if (!Array.isArray(intent.assumptions))      errors.push('intent.assumptions must be an array');
  return errors;
}
