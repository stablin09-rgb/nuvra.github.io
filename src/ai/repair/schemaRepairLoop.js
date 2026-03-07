/**
 * schemaRepairLoop.js — Nuvra Phase 5
 *
 * Schema Validation & Repair Loop.
 *
 * When AI output fails validation, this module:
 *  1. Detects the specific errors
 *  2. Classifies them (structural, type, missing, invalid)
 *  3. Attempts automatic repair for simple errors
 *  4. For complex errors: retries with a constrained repair prompt
 *  5. Applies a hard retry limit (default: 3)
 *  6. Surfaces failure clearly — never silently accepts bad output
 *
 * Repair strategies (in order of preference):
 *  A. Auto-repair: fix without AI (e.g., add missing required fields with defaults)
 *  B. AI-repair: retry with a targeted "fix this specific error" prompt
 *  C. Fail loudly: return a structured failure with full context
 *
 * @module ai/repair/schemaRepairLoop
 */
'use strict';

import { budgetEngine } from '../budget/budgetEngine.js';
import { ProviderErrorCode } from '../providers/providerContract.js';

// ─── Error Classes ────────────────────────────────────────────────────────────
export const RepairErrorClass = Object.freeze({
  MISSING_FIELD:    'missing_field',    // Required field absent
  WRONG_TYPE:       'wrong_type',       // Field has wrong type
  INVALID_ENUM:     'invalid_enum',     // Value not in allowed set
  EMPTY_ARRAY:      'empty_array',      // Required array is empty
  INVALID_RELATION: 'invalid_relation', // References non-existent ID
  STRUCTURAL:       'structural',       // Object shape is wrong
  UNKNOWN:          'unknown',
});

// ─── SchemaRepairLoop ─────────────────────────────────────────────────────────
class SchemaRepairLoop {
  constructor() {
    this._maxRetries = 3;
    this._repairLog  = [];
  }

  /**
   * Validate and repair an IntentSchema.
   * @param {object} data - Raw AI output
   * @returns {{ ok: boolean, data?: object, errors?: ValidationError[], repairLog?: object[] }}
   */
  validateAndRepairIntent(data) {
    return this._validateAndRepair(data, _intentRules, 'intent');
  }

  /**
   * Validate and repair a SystemPlan.
   * @param {object} data - Raw AI output
   * @returns {{ ok: boolean, data?: object, errors?: ValidationError[], repairLog?: object[] }}
   */
  validateAndRepairPlan(data) {
    return this._validateAndRepair(data, _planRules, 'plan');
  }

  /**
   * Validate an AppSchema (assembled — no AI repair needed, just validation).
   * @param {object} schema
   * @returns {{ ok: boolean, errors?: ValidationError[] }}
   */
  validateAppSchema(schema) {
    const errors = _validateAppSchema(schema);
    return { ok: errors.length === 0, errors };
  }

  /**
   * Attempt AI-assisted repair of a failed schema.
   * @param {object} params
   * @param {object}   params.data          - The invalid data
   * @param {object[]} params.errors         - Validation errors
   * @param {string}   params.schemaType     - 'intent' | 'plan'
   * @param {object}   params.provider       - AI provider
   * @param {string}   params.originalPrompt - The original user prompt
   * @param {number}   [params.attempt=1]    - Current attempt number
   * @returns {Promise<{ ok: boolean, data?: object, error?: string, attempts?: number }>}
   */
  async repairWithAI({ data, errors, schemaType, provider, originalPrompt, attempt = 1 }) {
    if (attempt > this._maxRetries) {
      return {
        ok:       false,
        error:    `Schema repair failed after ${this._maxRetries} attempts. Errors: ${errors.map(e => e.message).join('; ')}`,
        attempts: attempt - 1,
      };
    }

    // Budget check for repair call
    const repairPrompt = _buildRepairPrompt(data, errors, schemaType, originalPrompt);
    const budgetCheck = budgetEngine.check({
      inputTokens:   Math.ceil(repairPrompt.length / 4) + 500,
      outputTokens:  1500,
      provider,
      operationType: `repair_${schemaType}`,
    });

    if (!budgetCheck.allowed) {
      return { ok: false, error: budgetCheck.blocked, errorCode: ProviderErrorCode.BUDGET_EXCEEDED };
    }

    const systemPrompt = _getRepairSystemPrompt(schemaType);

    const response = await provider.call({
      systemPrompt,
      userPrompt:  repairPrompt,
      maxTokens:   1500,
      temperature: 0,
      requestId:   _generateId('repair'),
    });

    budgetEngine.record({
      operationType: `repair_${schemaType}`,
      providerId:    provider.id,
      usage:         response.usage,
      cost:          provider.estimateCost(response.usage),
      ok:            response.ok,
      latencyMs:     response.latencyMs,
    });

    if (!response.ok) {
      return { ok: false, error: response.error, attempts: attempt };
    }

    // Validate the repaired output
    const rules = schemaType === 'intent' ? _intentRules : _planRules;
    const repairResult = this._validateAndRepair(response.data, rules, schemaType);

    this._repairLog.push({
      attempt,
      schemaType,
      errorsFixed: errors.length - (repairResult.errors?.length || 0),
      remainingErrors: repairResult.errors?.length || 0,
      ts: Date.now(),
    });

    if (repairResult.ok) {
      return { ok: true, data: repairResult.data, attempts: attempt };
    }

    // Recurse with remaining errors
    return this.repairWithAI({
      data:           response.data,
      errors:         repairResult.errors,
      schemaType,
      provider,
      originalPrompt,
      attempt:        attempt + 1,
    });
  }

  /**
   * Get the repair log for the current session.
   */
  getRepairLog() {
    return [...this._repairLog];
  }

  clearLog() {
    this._repairLog = [];
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _validateAndRepair(data, rules, schemaType) {
    // Step 1: Detect errors
    const errors = _applyRules(data, rules);
    if (errors.length === 0) {
      return { ok: true, data };
    }

    // Step 2: Auto-repair simple errors
    const { repaired, remaining } = _autoRepair(data, errors, rules);

    if (remaining.length === 0) {
      return { ok: true, data: repaired, repairLog: [{ type: 'auto', fixed: errors.length }] };
    }

    // Step 3: Cannot auto-repair — return errors for AI repair or failure
    return { ok: false, data: repaired, errors: remaining };
  }
}

// ─── Validation Rules ─────────────────────────────────────────────────────────

// IntentSchema rules
const _intentRules = [
  { field: 'goal',             type: 'string',  required: true },
  { field: 'outputType',       type: 'enum',    required: true, values: ['site','app','hybrid'] },
  { field: 'industry',         type: 'string',  required: true,  default: 'general' },
  { field: 'brandTone',        type: 'string',  required: true,  default: 'professional' },
  { field: 'complexity',       type: 'enum',    required: true, values: ['simple','medium','complex'], default: 'medium' },
  { field: 'targetAudience',   type: 'string',  required: false, default: 'general users' },
  { field: 'dataRequirements', type: 'array',   required: true,  default: [] },
  { field: 'featureSet',       type: 'array',   required: true,  default: [] },
  { field: 'pageHints',        type: 'array',   required: true,  default: [] },
  { field: 'assumptions',      type: 'array',   required: true,  default: [] },
  { field: 'confidence',       type: 'number',  required: true,  default: 0.5 },
];

// SystemPlan rules
const _planRules = [
  { field: 'pages',        type: 'array',   required: true,  default: [] },
  { field: 'collections',  type: 'array',   required: true,  default: [] },
  { field: 'relations',    type: 'array',   required: true,  default: [] },
  { field: 'actions',      type: 'array',   required: true,  default: [] },
  { field: 'stateFlows',   type: 'array',   required: true,  default: [] },
  { field: 'decisions',    type: 'array',   required: true,  default: [] },
  { field: 'permissions',  type: 'object',  required: true,  default: { model: 'public', roles: [], reason: 'Default' } },
];

// ─── AppSchema Validation ─────────────────────────────────────────────────────
function _validateAppSchema(schema) {
  const errors = [];
  if (!schema || typeof schema !== 'object') {
    return [{ field: 'root', errorClass: RepairErrorClass.STRUCTURAL, message: 'Schema is not an object' }];
  }
  if (!schema.id)          errors.push({ field: 'id',          errorClass: RepairErrorClass.MISSING_FIELD, message: 'id is required' });
  if (!schema.name)        errors.push({ field: 'name',        errorClass: RepairErrorClass.MISSING_FIELD, message: 'name is required' });
  if (!Array.isArray(schema.pages))       errors.push({ field: 'pages',       errorClass: RepairErrorClass.WRONG_TYPE, message: 'pages must be an array' });
  if (!Array.isArray(schema.collections)) errors.push({ field: 'collections', errorClass: RepairErrorClass.WRONG_TYPE, message: 'collections must be an array' });
  if (!Array.isArray(schema.actions))     errors.push({ field: 'actions',     errorClass: RepairErrorClass.WRONG_TYPE, message: 'actions must be an array' });

  // Validate pages
  for (const [i, page] of (schema.pages || []).entries()) {
    if (!page.id)   errors.push({ field: `pages[${i}].id`,   errorClass: RepairErrorClass.MISSING_FIELD, message: `pages[${i}].id is required` });
    if (!page.name) errors.push({ field: `pages[${i}].name`, errorClass: RepairErrorClass.MISSING_FIELD, message: `pages[${i}].name is required` });
    if (!page.mode) errors.push({ field: `pages[${i}].mode`, errorClass: RepairErrorClass.MISSING_FIELD, message: `pages[${i}].mode is required` });
  }

  // Validate collections
  for (const [i, coll] of (schema.collections || []).entries()) {
    if (!coll.id)   errors.push({ field: `collections[${i}].id`,   errorClass: RepairErrorClass.MISSING_FIELD, message: `collections[${i}].id is required` });
    if (!coll.name) errors.push({ field: `collections[${i}].name`, errorClass: RepairErrorClass.MISSING_FIELD, message: `collections[${i}].name is required` });
    if (!Array.isArray(coll.fields)) errors.push({ field: `collections[${i}].fields`, errorClass: RepairErrorClass.WRONG_TYPE, message: `collections[${i}].fields must be an array` });
  }

  return errors;
}

// ─── Rule Engine ──────────────────────────────────────────────────────────────
function _applyRules(data, rules) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    return [{ field: 'root', errorClass: RepairErrorClass.STRUCTURAL, message: 'Output is not an object' }];
  }

  for (const rule of rules) {
    const value = data[rule.field];

    if (rule.required && (value === undefined || value === null)) {
      if (rule.default !== undefined) continue; // Can auto-repair
      errors.push({
        field:      rule.field,
        errorClass: RepairErrorClass.MISSING_FIELD,
        message:    `${rule.field} is required`,
        canAutoRepair: false,
      });
      continue;
    }

    if (value === undefined || value === null) continue; // Optional, missing is ok

    if (rule.type === 'string' && typeof value !== 'string') {
      errors.push({
        field:      rule.field,
        errorClass: RepairErrorClass.WRONG_TYPE,
        message:    `${rule.field} must be a string, got ${typeof value}`,
        canAutoRepair: true,
      });
    } else if (rule.type === 'number' && typeof value !== 'number') {
      errors.push({
        field:      rule.field,
        errorClass: RepairErrorClass.WRONG_TYPE,
        message:    `${rule.field} must be a number, got ${typeof value}`,
        canAutoRepair: true,
      });
    } else if (rule.type === 'array' && !Array.isArray(value)) {
      errors.push({
        field:      rule.field,
        errorClass: RepairErrorClass.WRONG_TYPE,
        message:    `${rule.field} must be an array, got ${typeof value}`,
        canAutoRepair: true,
      });
    } else if (rule.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
      errors.push({
        field:      rule.field,
        errorClass: RepairErrorClass.WRONG_TYPE,
        message:    `${rule.field} must be an object`,
        canAutoRepair: rule.default !== undefined,
      });
    } else if (rule.type === 'enum' && !rule.values.includes(value)) {
      errors.push({
        field:      rule.field,
        errorClass: RepairErrorClass.INVALID_ENUM,
        message:    `${rule.field} must be one of: ${rule.values.join(', ')}, got "${value}"`,
        canAutoRepair: rule.default !== undefined,
      });
    }
  }

  return errors;
}

function _autoRepair(data, errors, rules) {
  const repaired = { ...data };
  const remaining = [];

  for (const error of errors) {
    const rule = rules.find(r => r.field === error.field);
    if (!rule) { remaining.push(error); continue; }

    if (error.errorClass === RepairErrorClass.MISSING_FIELD && rule.default !== undefined) {
      repaired[error.field] = rule.default;
    } else if (error.errorClass === RepairErrorClass.WRONG_TYPE) {
      if (rule.type === 'string')  repaired[error.field] = String(data[error.field] || rule.default || '');
      else if (rule.type === 'number') repaired[error.field] = Number(data[error.field]) || (rule.default ?? 0);
      else if (rule.type === 'array')  repaired[error.field] = Array.isArray(data[error.field]) ? data[error.field] : (rule.default || []);
      else if (rule.type === 'object' && rule.default) repaired[error.field] = rule.default;
      else remaining.push(error);
    } else if (error.errorClass === RepairErrorClass.INVALID_ENUM && rule.default !== undefined) {
      repaired[error.field] = rule.default;
    } else {
      remaining.push(error);
    }
  }

  return { repaired, remaining };
}

// ─── Repair Prompts ───────────────────────────────────────────────────────────
function _getRepairSystemPrompt(schemaType) {
  return `You are a JSON repair specialist for the Nuvra AI engine.
You will receive invalid JSON output and a list of specific errors.
Your ONLY job is to fix the errors and return valid JSON.
Do not add new fields. Do not change correct fields. Only fix the listed errors.
Output valid JSON only — no prose, no markdown.`;
}

function _buildRepairPrompt(data, errors, schemaType, originalPrompt) {
  return `The following ${schemaType} JSON output has validation errors.

Original user prompt: "${originalPrompt || 'unknown'}"

Invalid output:
${JSON.stringify(data, null, 2)}

Errors to fix:
${errors.map((e, i) => `${i + 1}. [${e.errorClass}] ${e.message}`).join('\n')}

Return the corrected JSON with ONLY these errors fixed.`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _generateId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const schemaRepairLoop = new SchemaRepairLoop();
export default schemaRepairLoop;
