/**
 * Nuvra — dataClassifier.js (Phase 15)
 *
 * Formal data classification system. Assigns and infers data classes
 * for every field, collection, API, export, and agent action.
 *
 * Data Classes (ordered by sensitivity):
 *   public     → No restrictions
 *   internal   → Internal use only, not for public display
 *   personal   → PII — names, emails, addresses, IDs
 *   sensitive  → Financial data, credentials, private communications
 *   regulated  → Health (PHI), biometric, payment card (PAN), government ID
 *
 * @module compliance/dataClassifier
 */
'use strict';

import { DATA_CLASS } from './policyRegistry.js';

// ─── Field Name Patterns → Inferred Data Class ────────────────────────────────
const INFERENCE_RULES = [
  // Regulated — health
  { pattern: /\b(diagnosis|condition|medication|prescription|icd|cpt|npi|phi|health|medical|clinical|patient|symptom|allergy|blood|dna|biometric|fingerprint|retina|face_id)\b/i, class: DATA_CLASS.REGULATED, type: 'health' },
  // Regulated — payment
  { pattern: /\b(pan|card_number|credit_card|debit_card|cvv|cvc|expiry|card_exp|routing_number|account_number|iban|swift)\b/i, class: DATA_CLASS.REGULATED, type: 'payment-card-pan' },
  // Regulated — government ID
  { pattern: /\b(ssn|social_security|passport|national_id|tax_id|ein|driver_license|voter_id)\b/i, class: DATA_CLASS.REGULATED, type: 'government-id' },
  // Sensitive — credentials
  { pattern: /\b(password|passwd|secret|api_key|token|private_key|auth_code|otp|pin)\b/i, class: DATA_CLASS.SENSITIVE, type: 'credential' },
  // Sensitive — financial
  { pattern: /\b(salary|income|net_worth|bank_balance|credit_score|loan|debt|tax_return)\b/i, class: DATA_CLASS.SENSITIVE, type: 'financial' },
  // Personal — contact
  { pattern: /\b(email|phone|mobile|address|zip|postal|city|state|country|location|ip_address|device_id|cookie|session_id|user_id|uid|uuid)\b/i, class: DATA_CLASS.PERSONAL, type: 'contact' },
  // Personal — identity
  { pattern: /\b(name|first_name|last_name|full_name|username|display_name|handle|dob|date_of_birth|age|gender|ethnicity|nationality|religion)\b/i, class: DATA_CLASS.PERSONAL, type: 'identity' },
  // Internal
  { pattern: /\b(internal|private|confidential|restricted|draft|unpublished)\b/i, class: DATA_CLASS.INTERNAL, type: 'internal' },
];

// ─── Sensitivity Order ────────────────────────────────────────────────────────
const SENSITIVITY_ORDER = [
  DATA_CLASS.PUBLIC,
  DATA_CLASS.INTERNAL,
  DATA_CLASS.PERSONAL,
  DATA_CLASS.SENSITIVE,
  DATA_CLASS.REGULATED,
];

function _maxClass(classes) {
  let max = DATA_CLASS.PUBLIC;
  for (const c of classes) {
    if (SENSITIVITY_ORDER.indexOf(c) > SENSITIVITY_ORDER.indexOf(max)) {
      max = c;
    }
  }
  return max;
}

// ─── Public API ───────────────────────────────────────────────────────────────
export const dataClassifier = {
  /**
   * Classify a single field. Uses explicit declaration if present,
   * otherwise infers from the field name.
   * @param {object} field - { name, type, dataClass?, regulatedType? }
   * @returns {{ dataClass: string, regulatedType: string|null, inferred: boolean }}
   */
  classifyField(field) {
    // Explicit declaration takes precedence
    if (field.dataClass) {
      return {
        dataClass:    field.dataClass,
        regulatedType: field.regulatedType || null,
        inferred:     false,
      };
    }

    // Infer from field name
    const name = (field.name || field.id || '').toLowerCase();
    for (const rule of INFERENCE_RULES) {
      if (rule.pattern.test(name)) {
        return {
          dataClass:    rule.class,
          regulatedType: rule.type || null,
          inferred:     true,
        };
      }
    }

    // Default to public
    return {
      dataClass:    DATA_CLASS.PUBLIC,
      regulatedType: null,
      inferred:     true,
    };
  },

  /**
   * Classify an entire collection. The collection's class is the
   * maximum class of all its fields.
   * @param {object} collection - { name, fields: [] }
   * @returns {{ dataClass: string, fieldClassifications: object[], regulatedTypes: string[] }}
   */
  classifyCollection(collection) {
    const fieldClassifications = (collection.fields || []).map(f => ({
      fieldName: f.name || f.id,
      ...this.classifyField(f),
    }));

    const classes = fieldClassifications.map(fc => fc.dataClass);
    const regulatedTypes = fieldClassifications
      .filter(fc => fc.regulatedType)
      .map(fc => fc.regulatedType)
      .filter((v, i, a) => a.indexOf(v) === i); // unique

    return {
      dataClass:          _maxClass(classes),
      fieldClassifications,
      regulatedTypes,
    };
  },

  /**
   * Classify a full project. Returns a summary of data classes present.
   * @param {object} project - { collections: [] }
   * @returns {{ dataClasses: string[], regulatedTypes: string[], highestClass: string, summary: object }}
   */
  classifyProject(project) {
    const collectionResults = (project.collections || []).map(c => ({
      collectionName: c.name || c.id,
      ...this.classifyCollection(c),
    }));

    const allClasses = collectionResults.map(r => r.dataClass);
    const allRegulatedTypes = collectionResults
      .flatMap(r => r.regulatedTypes)
      .filter((v, i, a) => a.indexOf(v) === i);

    const uniqueClasses = [...new Set(allClasses)];

    return {
      dataClasses:      uniqueClasses,
      regulatedTypes:   allRegulatedTypes,
      highestClass:     _maxClass(allClasses),
      summary:          collectionResults,
    };
  },

  /**
   * Annotate a project's collections and fields with inferred data classes.
   * Mutates the project object in-place (only adds missing classifications).
   * @param {object} project
   * @returns {object} The annotated project
   */
  annotateProject(project) {
    for (const collection of (project.collections || [])) {
      const collectionResult = this.classifyCollection(collection);
      if (!collection.dataClass) {
        collection.dataClass    = collectionResult.dataClass;
        collection.regulatedTypes = collectionResult.regulatedTypes;
        collection._classInferred = true;
      }
      for (let i = 0; i < (collection.fields || []).length; i++) {
        const field = collection.fields[i];
        if (!field.dataClass) {
          const result = this.classifyField(field);
          field.dataClass    = result.dataClass;
          field.regulatedType = result.regulatedType;
          field._classInferred = true;
        }
      }
    }
    return project;
  },

  /**
   * Check if a data class is at or above a given sensitivity threshold.
   * @param {string} dataClass
   * @param {string} threshold
   * @returns {boolean}
   */
  isAtLeast(dataClass, threshold) {
    return SENSITIVITY_ORDER.indexOf(dataClass) >= SENSITIVITY_ORDER.indexOf(threshold);
  },

  /**
   * Get a human-readable label for a data class.
   * @param {string} dataClass
   * @returns {string}
   */
  getLabel(dataClass) {
    const labels = {
      [DATA_CLASS.PUBLIC]:    '🟢 Public',
      [DATA_CLASS.INTERNAL]:  '🔵 Internal',
      [DATA_CLASS.PERSONAL]:  '🟡 Personal',
      [DATA_CLASS.SENSITIVE]: '🟠 Sensitive',
      [DATA_CLASS.REGULATED]: '🔴 Regulated',
    };
    return labels[dataClass] || '⚪ Unknown';
  },

  /**
   * Get a CSS color class for a data class.
   * @param {string} dataClass
   * @returns {string}
   */
  getColorClass(dataClass) {
    const colors = {
      [DATA_CLASS.PUBLIC]:    'nv-class-public',
      [DATA_CLASS.INTERNAL]:  'nv-class-internal',
      [DATA_CLASS.PERSONAL]:  'nv-class-personal',
      [DATA_CLASS.SENSITIVE]: 'nv-class-sensitive',
      [DATA_CLASS.REGULATED]: 'nv-class-regulated',
    };
    return colors[dataClass] || 'nv-class-unknown';
  },

  DATA_CLASS,
  SENSITIVITY_ORDER,
};
