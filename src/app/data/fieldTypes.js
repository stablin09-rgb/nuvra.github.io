/**
 * fieldTypes.js — Nuvra Phase 3
 *
 * Canonical field type definitions for the Data Model System.
 *
 * Each field type defines:
 *  - id:         The type identifier used in schemas
 *  - label:      Human-readable name
 *  - validate:   A function that validates a value for this type
 *  - coerce:     A function that coerces a raw value to the correct type
 *  - defaultValue: The default value if none is specified
 *
 * @module app/data/fieldTypes
 */
'use strict';

// ─── Field Type Registry ──────────────────────────────────────────────────────
const FIELD_TYPES = {

  text: {
    id:           'text',
    label:        'Text',
    defaultValue: '',
    validate(value, rules = {}) {
      if (value === null || value === undefined) {
        return rules.required ? { ok: false, error: 'Field is required' } : { ok: true };
      }
      const str = String(value);
      if (rules.minLength && str.length < rules.minLength) {
        return { ok: false, error: `Minimum length is ${rules.minLength}` };
      }
      if (rules.maxLength && str.length > rules.maxLength) {
        return { ok: false, error: `Maximum length is ${rules.maxLength}` };
      }
      if (rules.pattern && !new RegExp(rules.pattern).test(str)) {
        return { ok: false, error: rules.patternMessage || 'Invalid format' };
      }
      return { ok: true };
    },
    coerce: (v) => (v === null || v === undefined) ? '' : String(v),
  },

  number: {
    id:           'number',
    label:        'Number',
    defaultValue: 0,
    validate(value, rules = {}) {
      if (value === null || value === undefined) {
        return rules.required ? { ok: false, error: 'Field is required' } : { ok: true };
      }
      const n = Number(value);
      if (isNaN(n)) return { ok: false, error: 'Must be a number' };
      if (rules.min !== undefined && n < rules.min) {
        return { ok: false, error: `Minimum value is ${rules.min}` };
      }
      if (rules.max !== undefined && n > rules.max) {
        return { ok: false, error: `Maximum value is ${rules.max}` };
      }
      return { ok: true };
    },
    coerce: (v) => {
      const n = Number(v);
      return isNaN(n) ? 0 : n;
    },
  },

  boolean: {
    id:           'boolean',
    label:        'Boolean',
    defaultValue: false,
    validate(value, rules = {}) {
      if (value === null || value === undefined) {
        return rules.required ? { ok: false, error: 'Field is required' } : { ok: true };
      }
      return { ok: true };
    },
    coerce: (v) => Boolean(v),
  },

  date: {
    id:           'date',
    label:        'Date',
    defaultValue: null,
    validate(value, rules = {}) {
      if (value === null || value === undefined) {
        return rules.required ? { ok: false, error: 'Field is required' } : { ok: true };
      }
      const d = new Date(value);
      if (isNaN(d.getTime())) return { ok: false, error: 'Must be a valid date' };
      return { ok: true };
    },
    coerce: (v) => {
      if (!v) return null;
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d.toISOString();
    },
  },

  select: {
    id:           'select',
    label:        'Select',
    defaultValue: null,
    validate(value, rules = {}) {
      if (value === null || value === undefined) {
        return rules.required ? { ok: false, error: 'Field is required' } : { ok: true };
      }
      if (rules.options && !rules.options.includes(value)) {
        return { ok: false, error: `Must be one of: ${rules.options.join(', ')}` };
      }
      return { ok: true };
    },
    coerce: (v) => (v === undefined ? null : v),
  },

  multiselect: {
    id:           'multiselect',
    label:        'Multi-Select',
    defaultValue: [],
    validate(value, rules = {}) {
      if (!Array.isArray(value)) {
        return { ok: false, error: 'Must be an array' };
      }
      if (rules.required && value.length === 0) {
        return { ok: false, error: 'At least one selection is required' };
      }
      if (rules.options) {
        const invalid = value.filter(v => !rules.options.includes(v));
        if (invalid.length > 0) {
          return { ok: false, error: `Invalid options: ${invalid.join(', ')}` };
        }
      }
      return { ok: true };
    },
    coerce: (v) => Array.isArray(v) ? v : [],
  },

  relation: {
    id:           'relation',
    label:        'Relation',
    defaultValue: null,
    validate(value, rules = {}) {
      if (value === null || value === undefined) {
        return rules.required ? { ok: false, error: 'Field is required' } : { ok: true };
      }
      if (typeof value !== 'string') {
        return { ok: false, error: 'Relation must be a record ID (string)' };
      }
      return { ok: true };
    },
    coerce: (v) => (v === undefined ? null : String(v)),
  },

  multirelation: {
    id:           'multirelation',
    label:        'Multi-Relation',
    defaultValue: [],
    validate(value, rules = {}) {
      if (!Array.isArray(value)) {
        return { ok: false, error: 'Must be an array of record IDs' };
      }
      return { ok: true };
    },
    coerce: (v) => Array.isArray(v) ? v : [],
  },

  email: {
    id:           'email',
    label:        'Email',
    defaultValue: '',
    validate(value, rules = {}) {
      if (!value) {
        return rules.required ? { ok: false, error: 'Field is required' } : { ok: true };
      }
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRe.test(String(value))) {
        return { ok: false, error: 'Must be a valid email address' };
      }
      return { ok: true };
    },
    coerce: (v) => (v === null || v === undefined) ? '' : String(v).toLowerCase().trim(),
  },

  url: {
    id:           'url',
    label:        'URL',
    defaultValue: '',
    validate(value, rules = {}) {
      if (!value) {
        return rules.required ? { ok: false, error: 'Field is required' } : { ok: true };
      }
      try {
        new URL(String(value));
        return { ok: true };
      } catch {
        return { ok: false, error: 'Must be a valid URL' };
      }
    },
    coerce: (v) => (v === null || v === undefined) ? '' : String(v).trim(),
  },

  json: {
    id:           'json',
    label:        'JSON',
    defaultValue: null,
    validate(value, rules = {}) {
      if (value === null || value === undefined) {
        return rules.required ? { ok: false, error: 'Field is required' } : { ok: true };
      }
      if (typeof value === 'string') {
        try { JSON.parse(value); return { ok: true }; }
        catch { return { ok: false, error: 'Must be valid JSON' }; }
      }
      return { ok: true }; // already an object
    },
    coerce: (v) => {
      if (typeof v === 'string') {
        try { return JSON.parse(v); } catch { return null; }
      }
      return v;
    },
  },
};

// ─── Public API ───────────────────────────────────────────────────────────────
export function getFieldType(typeId) {
  return FIELD_TYPES[typeId] || null;
}

export function validateField(value, fieldDef) {
  const type = FIELD_TYPES[fieldDef.type];
  if (!type) return { ok: false, error: `Unknown field type: ${fieldDef.type}` };
  return type.validate(value, fieldDef.rules || {});
}

export function coerceField(value, fieldDef) {
  const type = FIELD_TYPES[fieldDef.type];
  if (!type) return value;
  return type.coerce(value);
}

export function getDefaultValue(fieldDef) {
  if (fieldDef.defaultValue !== undefined) return fieldDef.defaultValue;
  const type = FIELD_TYPES[fieldDef.type];
  return type ? type.defaultValue : null;
}

export const ALL_FIELD_TYPES = Object.values(FIELD_TYPES);

export default FIELD_TYPES;
