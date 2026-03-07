/**
 * schemaTypes.js — Nuvra Phase 2–2.5
 *
 * Canonical schema definitions and factories for the Nuvra Planning Engine.
 *
 * These schemas are the single source of truth for all planned structures.
 * They are:
 *   - Strictly typed (validated at creation)
 *   - Versioned (every schema carries a version number)
 *   - Backward compatible (older schemas can be migrated)
 *   - Render-agnostic (no HTML, CSS, or layout decisions)
 *   - Diffable (stable IDs enable change tracking)
 *
 * Schema hierarchy:
 *   SiteSchema
 *     └── PageSchema[]
 *           └── SectionSchema[]
 *                 ├── ContentIntentSchema
 *                 └── ComponentSchema[]
 *
 * CRITICAL SEPARATION:
 *   These schemas describe WHAT something IS and WHY it exists.
 *   They do NOT describe how it looks.
 *   Styling, layout, theme, and visual design are the renderer's concern.
 *
 * @module ai/schemas/schemaTypes
 */
'use strict';

import { generateId, now, slugify } from '../../runtime/utils.js';

// ─── Schema Versions ──────────────────────────────────────────────────────────
export const SITE_SCHEMA_VERSION    = 1;
export const PAGE_SCHEMA_VERSION    = 1;
export const SECTION_SCHEMA_VERSION = 1;
export const COMPONENT_SCHEMA_VERSION = 1;
export const CONTENT_INTENT_SCHEMA_VERSION = 1;

// ─── SiteSchema ───────────────────────────────────────────────────────────────
/**
 * SiteSchema — the top-level plan for an entire site.
 *
 * {
 *   id:          string   — stable identifier for this site plan
 *   version:     number   — schema version
 *   intentId:    string   — the IntentSchema this was derived from
 *   createdAt:   number   — Unix ms
 *   updatedAt:   number   — Unix ms
 *
 *   identity: {
 *     name:        string   — site/brand name
 *     domain:      string   — industry domain
 *     productType: string   — product type from IntentSchema
 *     primaryGoal: string   — the primary conversion goal
 *   }
 *
 *   pages:       PageSchema[]
 *
 *   meta: {
 *     pageCount:    number
 *     sectionCount: number
 *     plannedAt:    number
 *     planVersion:  number  — increments on each re-plan
 *   }
 * }
 */
export function createSiteSchema({
  intentId    = null,
  intent      = null,
  name        = null,
} = {}) {
  return {
    id:        generateId('site'),
    version:   SITE_SCHEMA_VERSION,
    intentId,
    createdAt: now(),
    updatedAt: now(),

    identity: {
      name:        name || intent?.brand?.name || '',
      domain:      intent?.product?.domain    || '',
      productType: intent?.product?.type      || 'unknown',
      primaryGoal: intent?.goals?.primary     || '',
    },

    pages: [],

    meta: {
      pageCount:    0,
      sectionCount: 0,
      plannedAt:    null,
      planVersion:  1,
    },
  };
}

// ─── PageSchema ───────────────────────────────────────────────────────────────
/**
 * PageSchema — the plan for a single page.
 *
 * {
 *   id:        string
 *   version:   number
 *   intentId:  string
 *   name:      string   — human-readable name (e.g. 'Home', 'About')
 *   slug:      string   — URL path segment (e.g. 'about-us')
 *   template:  string   — the heuristic template used (e.g. 'landing', 'saas')
 *   purpose:   string   — what this page must achieve
 *   reason:    string   — why this page exists in the plan
 *   required:  boolean  — whether this page is mandatory
 *   sections:  SectionSchema[]
 *   meta: {
 *     sectionCount: number
 *     userEdited:   boolean  — true if user has manually modified this page
 *   }
 * }
 */
export function createPageSchema({
  intentId = null,
  name,
  slug     = null,
  template = 'landing',
  purpose  = '',
  reason   = '',
  required = false,
} = {}) {
  if (!name) throw new TypeError('createPageSchema: name is required');
  return {
    id:        generateId('page_schema'),
    version:   PAGE_SCHEMA_VERSION,
    intentId,
    name:      String(name).trim(),
    slug:      slug ? String(slug) : slugify(name),
    template,
    purpose:   String(purpose),
    reason:    String(reason),
    required,
    sections:  [],
    meta: {
      sectionCount: 0,
      userEdited:   false,
    },
  };
}

// ─── SectionSchema ────────────────────────────────────────────────────────────
/**
 * SectionSchema — the plan for a single section within a page.
 *
 * {
 *   id:            string
 *   version:       number
 *   type:          string   — section type (from SectionType enum)
 *   purpose:       string   — what this section must achieve
 *   reason:        string   — why this section is here, in this position
 *   priority:      number   — 1–10, relative importance
 *   contentIntent: ContentIntentSchema
 *   components:    ComponentSchema[]
 *   meta: {
 *     userEdited: boolean
 *     locked:     boolean  — if true, re-planning will not modify this section
 *   }
 * }
 */
export function createSectionSchema({
  type,
  purpose       = '',
  reason        = '',
  priority      = 5,
  contentIntent = null,
} = {}) {
  if (!type) throw new TypeError('createSectionSchema: type is required');
  return {
    id:            generateId('section'),
    version:       SECTION_SCHEMA_VERSION,
    type:          String(type),
    purpose:       String(purpose),
    reason:        String(reason),
    priority:      Math.min(10, Math.max(1, Number(priority) || 5)),
    contentIntent: contentIntent || createContentIntentSchema({ sectionType: type }),
    components:    [],
    meta: {
      userEdited: false,
      locked:     false,
    },
  };
}

// ─── ContentIntentSchema ──────────────────────────────────────────────────────
/**
 * ContentIntentSchema — the semantic contract for a section's content.
 *
 * This schema describes WHAT content must communicate, not the content itself.
 * It is the bridge between the planner and the content generator.
 *
 * {
 *   id:          string
 *   version:     number
 *   sectionType: string
 *   headline:    string   — what the headline must communicate
 *   body:        string   — what the body content must convey
 *   cta:         string|null — what action the CTA must drive
 *   tone:        string   — tone for this specific section
 *   mustInclude: string[] — content elements that must be present
 *   mustAvoid:   string[] — content elements to exclude
 * }
 */
export function createContentIntentSchema({
  sectionType = '',
  headline    = '',
  body        = '',
  cta         = null,
  tone        = 'professional',
  mustInclude = [],
  mustAvoid   = [],
} = {}) {
  return {
    id:          generateId('ci'),
    version:     CONTENT_INTENT_SCHEMA_VERSION,
    sectionType: String(sectionType),
    headline:    String(headline),
    body:        String(body),
    cta:         cta ? String(cta) : null,
    tone:        String(tone),
    mustInclude: Array.isArray(mustInclude) ? [...mustInclude] : [],
    mustAvoid:   Array.isArray(mustAvoid)   ? [...mustAvoid]   : [],
  };
}

// ─── ComponentSchema ──────────────────────────────────────────────────────────
/**
 * ComponentSchema — the plan for a single UI component within a section.
 *
 * This is the most granular unit of the schema hierarchy.
 * It describes a component's semantic role, not its visual appearance.
 *
 * {
 *   id:           string
 *   version:      number
 *   componentType: string  — e.g. 'headline', 'button', 'image', 'list', 'form'
 *   role:         string   — semantic role (e.g. 'primary_cta', 'social_proof_badge')
 *   purpose:      string   — what this component must achieve
 *   contentHint:  string   — guidance for content generation
 *   constraints: {
 *     maxLength:  number|null  — max character count for text components
 *     required:   boolean
 *   }
 * }
 */
export function createComponentSchema({
  componentType,
  role        = '',
  purpose     = '',
  contentHint = '',
  constraints = {},
} = {}) {
  if (!componentType) throw new TypeError('createComponentSchema: componentType is required');
  return {
    id:            generateId('comp'),
    version:       COMPONENT_SCHEMA_VERSION,
    componentType: String(componentType),
    role:          String(role),
    purpose:       String(purpose),
    contentHint:   String(contentHint),
    constraints: {
      maxLength: constraints.maxLength ?? null,
      required:  constraints.required  ?? false,
    },
  };
}

// ─── Schema Validators ────────────────────────────────────────────────────────
export function validateSiteSchema(schema) {
  const errors = [];
  if (!schema || typeof schema !== 'object') { errors.push('schema must be an object'); return errors; }
  if (!schema.id)          errors.push('schema.id is required');
  if (!schema.intentId)    errors.push('schema.intentId is required');
  if (!Array.isArray(schema.pages)) errors.push('schema.pages must be an array');
  return errors;
}

export function validatePageSchema(schema) {
  const errors = [];
  if (!schema || typeof schema !== 'object') { errors.push('schema must be an object'); return errors; }
  if (!schema.id)   errors.push('schema.id is required');
  if (!schema.name) errors.push('schema.name is required');
  if (!schema.slug) errors.push('schema.slug is required');
  if (!Array.isArray(schema.sections)) errors.push('schema.sections must be an array');
  return errors;
}

export function validateSectionSchema(schema) {
  const errors = [];
  if (!schema || typeof schema !== 'object') { errors.push('schema must be an object'); return errors; }
  if (!schema.id)   errors.push('schema.id is required');
  if (!schema.type) errors.push('schema.type is required');
  if (!schema.contentIntent) errors.push('schema.contentIntent is required');
  return errors;
}
