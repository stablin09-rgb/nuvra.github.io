/**
 * schemaValidator.js — Nuvra Phase 2–2.5
 *
 * The Schema Validator — the gatekeeper between AI output and the system.
 *
 * All AI output flows through this validator before being used.
 * If the output is invalid, it is rejected with a clear error message.
 * The system never silently accepts malformed AI output.
 *
 * Validates:
 *   - Intent analysis AI output
 *   - Planning graph AI output
 *   - SiteSchema, PageSchema, SectionSchema
 *
 * @module ai/validator/schemaValidator
 */
'use strict';

import { logger } from '../../diagnostics/logger.js';
import { SectionType } from '../planning/planningHeuristics.js';

const VALID_SECTION_TYPES = new Set(Object.values(SectionType));
const VALID_PRODUCT_TYPES = new Set(['site', 'app', 'hybrid', 'landing', 'portfolio', 'ecommerce', 'saas', 'blog', 'unknown']);
const VALID_COMPLEXITY    = new Set(['simple', 'moderate', 'complex']);

export const schemaValidator = {

  // ── Intent AI Output ────────────────────────────────────────────────────────
  /**
   * Validate the raw JSON returned by the Intent Analysis AI.
   * @param {object} output
   * @returns {string[]} array of error messages (empty = valid)
   */
  validateIntentAiOutput(output) {
    const errors = [];
    if (!output || typeof output !== 'object') {
      errors.push('AI output must be a JSON object');
      return errors;
    }

    // product
    if (!output.product || typeof output.product !== 'object') {
      errors.push('output.product must be an object');
    } else {
      if (!VALID_PRODUCT_TYPES.has(output.product.type)) {
        errors.push(`output.product.type must be one of: ${[...VALID_PRODUCT_TYPES].join(', ')}`);
      }
    }

    // audience
    if (!output.audience || typeof output.audience !== 'object') {
      errors.push('output.audience must be an object');
    }

    // brand
    if (!output.brand || typeof output.brand !== 'object') {
      errors.push('output.brand must be an object');
    }

    // goals
    if (!output.goals || typeof output.goals !== 'object') {
      errors.push('output.goals must be an object');
    } else {
      if (typeof output.goals.primary !== 'string') {
        errors.push('output.goals.primary must be a string');
      }
    }

    // features
    if (!output.features || typeof output.features !== 'object') {
      errors.push('output.features must be an object');
    }

    // content
    if (!output.content || typeof output.content !== 'object') {
      errors.push('output.content must be an object');
    }

    // constraints
    if (!output.constraints || typeof output.constraints !== 'object') {
      errors.push('output.constraints must be an object');
    } else {
      if (output.constraints.complexity && !VALID_COMPLEXITY.has(output.constraints.complexity)) {
        errors.push(`output.constraints.complexity must be one of: ${[...VALID_COMPLEXITY].join(', ')}`);
      }
    }

    // confidence
    if (typeof output.confidence !== 'number' || output.confidence < 0 || output.confidence > 1) {
      errors.push('output.confidence must be a number between 0 and 1');
    }

    // ambiguities
    if (!Array.isArray(output.ambiguities)) {
      errors.push('output.ambiguities must be an array');
    }

    // assumptions
    if (!Array.isArray(output.assumptions)) {
      errors.push('output.assumptions must be an array');
    }

    if (errors.length > 0) {
      logger.warn('schemaValidator', `Intent AI output validation failed (${errors.length} errors)`, { errors });
    }

    return errors;
  },

  // ── Planning AI Output ──────────────────────────────────────────────────────
  /**
   * Validate the raw JSON returned by the Planning Graph AI.
   * @param {object} output
   * @returns {string[]}
   */
  validatePlanningAiOutput(output) {
    const errors = [];
    if (!output || typeof output !== 'object') {
      errors.push('AI planning output must be a JSON object');
      return errors;
    }

    if (!Array.isArray(output.sections)) {
      errors.push('output.sections must be an array');
      return errors;
    }

    if (output.sections.length === 0) {
      errors.push('output.sections must not be empty');
    }

    for (let i = 0; i < output.sections.length; i++) {
      const sec = output.sections[i];
      const prefix = `output.sections[${i}]`;

      if (!sec || typeof sec !== 'object') {
        errors.push(`${prefix} must be an object`);
        continue;
      }

      if (!sec.type) {
        errors.push(`${prefix}.type is required`);
      } else if (!VALID_SECTION_TYPES.has(sec.type)) {
        errors.push(`${prefix}.type "${sec.type}" is not a valid section type`);
      }

      if (!sec.purpose || typeof sec.purpose !== 'string') {
        errors.push(`${prefix}.purpose must be a non-empty string`);
      }

      if (!sec.reason || typeof sec.reason !== 'string') {
        errors.push(`${prefix}.reason must be a non-empty string`);
      }

      if (sec.contentIntent && typeof sec.contentIntent !== 'object') {
        errors.push(`${prefix}.contentIntent must be an object`);
      }
    }

    if (typeof output.confidence !== 'number') {
      errors.push('output.confidence must be a number');
    }

    if (errors.length > 0) {
      logger.warn('schemaValidator', `Planning AI output validation failed (${errors.length} errors)`, { errors });
    }

    return errors;
  },

  // ── SiteSchema ──────────────────────────────────────────────────────────────
  /**
   * Validate a complete SiteSchema.
   * @param {object} schema
   * @returns {string[]}
   */
  validateSiteSchema(schema) {
    const errors = [];
    if (!schema || typeof schema !== 'object') {
      errors.push('SiteSchema must be an object');
      return errors;
    }
    if (!schema.id)       errors.push('SiteSchema.id is required');
    if (!schema.intentId) errors.push('SiteSchema.intentId is required');
    if (!Array.isArray(schema.pages)) errors.push('SiteSchema.pages must be an array');

    (schema.pages || []).forEach((page, i) => {
      const pageErrors = this.validatePageSchema(page);
      pageErrors.forEach(e => errors.push(`pages[${i}]: ${e}`));
    });

    return errors;
  },

  /**
   * Validate a PageSchema.
   */
  validatePageSchema(schema) {
    const errors = [];
    if (!schema || typeof schema !== 'object') { errors.push('PageSchema must be an object'); return errors; }
    if (!schema.id)   errors.push('PageSchema.id is required');
    if (!schema.name) errors.push('PageSchema.name is required');
    if (!schema.slug) errors.push('PageSchema.slug is required');
    if (!Array.isArray(schema.sections)) errors.push('PageSchema.sections must be an array');

    (schema.sections || []).forEach((sec, i) => {
      const secErrors = this.validateSectionSchema(sec);
      secErrors.forEach(e => errors.push(`sections[${i}]: ${e}`));
    });

    return errors;
  },

  /**
   * Validate a SectionSchema.
   */
  validateSectionSchema(schema) {
    const errors = [];
    if (!schema || typeof schema !== 'object') { errors.push('SectionSchema must be an object'); return errors; }
    if (!schema.id)   errors.push('SectionSchema.id is required');
    if (!schema.type) errors.push('SectionSchema.type is required');
    if (!schema.contentIntent) errors.push('SectionSchema.contentIntent is required');
    return errors;
  },
};

export default schemaValidator;
