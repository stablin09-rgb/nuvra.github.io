/**
 * aiGenerationEngine.js — Nuvra Phase 5
 *
 * The AI App Generation Engine.
 *
 * This is the top-level orchestrator for all AI generation.
 * It coordinates the mandatory 3-step pipeline:
 *   Step 1: Intent Extraction  (intentExtractor)
 *   Step 2: System Planning    (systemPlanner)
 *   Step 3: Schema Assembly    (schemaAssembler)
 *
 * Plus:
 *   - Schema validation & repair (schemaRepairLoop)
 *   - Budget governance (budgetEngine)
 *   - Security scanning (securityScanner)
 *   - Explainability ledger (generationLedger)
 *   - Event emission for UI updates
 *
 * Generation types supported:
 *   - 'marketing_site'   — Landing page, pricing, about, contact
 *   - 'crud_app'         — Full CRUD with table, form, and actions
 *   - 'dashboard'        — Analytics dashboard with stat cards and charts
 *   - 'admin_panel'      — Admin interface with user management
 *   - 'internal_tool'    — Internal workflow tool
 *   - 'multi_page'       — Multi-page system (auto-detected from intent)
 *
 * @module ai/generation/aiGenerationEngine
 */
'use strict';

import { intentExtractor } from '../pipeline/intentExtractor.js';
import { systemPlanner }   from '../pipeline/systemPlanner.js';
import { schemaAssembler } from '../pipeline/schemaAssembler.js';
import { schemaRepairLoop } from '../repair/schemaRepairLoop.js';
import { budgetEngine }    from '../budget/budgetEngine.js';
import { providerRegistry } from '../providers/providerRegistry.js';

// ─── Generation Stage ─────────────────────────────────────────────────────────
export const GenerationStage = Object.freeze({
  IDLE:       'idle',
  EXTRACTING: 'extracting',   // Step 1
  PLANNING:   'planning',     // Step 2
  ASSEMBLING: 'assembling',   // Step 3
  VALIDATING: 'validating',
  REPAIRING:  'repairing',
  COMPLETE:   'complete',
  FAILED:     'failed',
});

// ─── AIGenerationEngine ───────────────────────────────────────────────────────
class AIGenerationEngine {
  constructor() {
    this._stage     = GenerationStage.IDLE;
    this._listeners = [];
    this._ledger    = [];  // All generation records
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Generate a complete AppSchema from a natural language prompt.
   *
   * @param {object} params
   * @param {string}   params.prompt          - Natural language description
   * @param {object}   [params.provider]      - Provider override
   * @param {object}   [params.context]       - Previous intent/schema for iteration
   * @param {object}   [params.options]       - Generation options
   * @param {boolean}  [params.options.repair=true] - Enable AI repair on validation failure
   * @returns {Promise<GenerationResult>}
   */
  async generate({ prompt, provider, context, options = {} }) {
    const runId = _generateId('gen');
    const start = Date.now();
    const enableRepair = options.repair !== false;
    const activeProvider = provider || providerRegistry.getActive();

    const record = {
      id:       runId,
      prompt,
      startedAt: start,
      stages:   [],
      usage:    { input: 0, output: 0, total: 0 },
      cost:     0,
    };

    this._emit('generation:started', { runId, prompt });

    try {
      // ── Step 1: Intent Extraction ─────────────────────────────────────────
      this._setStage(GenerationStage.EXTRACTING, runId);
      record.stages.push({ stage: 'intent', startedAt: Date.now() });

      const intentResult = await intentExtractor.extract({ prompt, provider: activeProvider, context });
      _accumulateUsage(record, intentResult.usage);

      if (!intentResult.ok) {
        return this._fail(record, 'intent', intentResult.error, intentResult.errorCode);
      }

      record.stages[record.stages.length - 1].completedAt = Date.now();
      record.stages[record.stages.length - 1].intent = intentResult.intent;
      this._emit('generation:intent_complete', { runId, intent: intentResult.intent });

      // ── Step 2: System Planning ───────────────────────────────────────────
      this._setStage(GenerationStage.PLANNING, runId);
      record.stages.push({ stage: 'planning', startedAt: Date.now() });

      const planResult = await systemPlanner.plan({ intent: intentResult.intent, provider: activeProvider });
      _accumulateUsage(record, planResult.usage);

      if (!planResult.ok) {
        // Attempt AI repair of the plan
        if (enableRepair && planResult.raw) {
          this._setStage(GenerationStage.REPAIRING, runId);
          const repairResult = await schemaRepairLoop.repairWithAI({
            data:           planResult.raw,
            errors:         [{ field: 'root', message: planResult.error }],
            schemaType:     'plan',
            provider:       activeProvider,
            originalPrompt: prompt,
          });
          if (!repairResult.ok) {
            return this._fail(record, 'planning', planResult.error, planResult.errorCode);
          }
          // Re-normalize the repaired plan
          planResult.plan = repairResult.data;
          planResult.ok   = true;
        } else {
          return this._fail(record, 'planning', planResult.error, planResult.errorCode);
        }
      }

      record.stages[record.stages.length - 1].completedAt = Date.now();
      record.stages[record.stages.length - 1].plan = planResult.plan;
      this._emit('generation:plan_complete', { runId, plan: planResult.plan });

      // ── Step 3: Schema Assembly ───────────────────────────────────────────
      this._setStage(GenerationStage.ASSEMBLING, runId);
      record.stages.push({ stage: 'assembly', startedAt: Date.now() });

      const assemblyResult = schemaAssembler.assemble({
        plan:   planResult.plan,
        intent: intentResult.intent,
      });

      if (!assemblyResult.ok) {
        return this._fail(record, 'assembly', assemblyResult.error);
      }

      // ── Validation ────────────────────────────────────────────────────────
      this._setStage(GenerationStage.VALIDATING, runId);
      const validation = schemaRepairLoop.validateAppSchema(assemblyResult.schema);

      if (!validation.ok) {
        return this._fail(record, 'validation', `Schema validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
      }

      record.stages[record.stages.length - 1].completedAt = Date.now();
      record.stages[record.stages.length - 1].schema = assemblyResult.schema;

      // ── Complete ──────────────────────────────────────────────────────────
      this._setStage(GenerationStage.COMPLETE, runId);

      record.completedAt = Date.now();
      record.duration    = record.completedAt - start;
      record.schema      = assemblyResult.schema;
      record.intent      = intentResult.intent;
      record.plan        = planResult.plan;
      record.ok          = true;

      this._ledger.push(record);
      this._emit('generation:complete', { runId, schema: assemblyResult.schema, record });

      return {
        ok:       true,
        schema:   assemblyResult.schema,
        intent:   intentResult.intent,
        plan:     planResult.plan,
        usage:    record.usage,
        cost:     record.cost,
        duration: record.duration,
        runId,
      };

    } catch (err) {
      return this._fail(record, 'unknown', err.message);
    }
  }

  /**
   * Regenerate a specific part of an existing schema.
   * Supports partial regeneration without starting over.
   *
   * @param {object} params
   * @param {object}   params.schema      - Existing AppSchema
   * @param {string}   params.target      - 'page' | 'collection' | 'action' | 'full'
   * @param {string}   [params.targetId]  - ID of the specific item to regenerate
   * @param {string}   params.instruction - What to change
   * @param {object}   [params.provider]  - Provider override
   * @returns {Promise<GenerationResult>}
   */
  async regenerate({ schema, target, targetId, instruction, provider }) {
    const activeProvider = provider || providerRegistry.getActive();
    const runId = _generateId('regen');

    this._emit('generation:started', { runId, prompt: instruction, type: 'regenerate' });

    // Build a targeted prompt that focuses on the specific change
    const contextPrompt = _buildRegenerationPrompt(schema, target, targetId, instruction);

    return this.generate({
      prompt:   contextPrompt,
      provider: activeProvider,
      context:  { previousSchema: schema, regenerateTarget: target, regenerateTargetId: targetId },
    });
  }

  /**
   * Get the current generation stage.
   * @returns {string} GenerationStage
   */
  getStage() {
    return this._stage;
  }

  /**
   * Get the full generation ledger.
   * @returns {object[]}
   */
  getLedger() {
    return [...this._ledger];
  }

  /**
   * Get the budget summary for the current session.
   */
  getBudgetSummary() {
    return budgetEngine.getSessionSummary();
  }

  // ── Events ───────────────────────────────────────────────────────────────────

  subscribe(listener) {
    this._listeners.push(listener);
    return () => { this._listeners = this._listeners.filter(l => l !== listener); };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _setStage(stage, runId) {
    this._stage = stage;
    this._emit('generation:stage', { stage, runId });
  }

  _fail(record, failedAt, error, errorCode) {
    this._setStage(GenerationStage.FAILED, record.id);
    record.ok        = false;
    record.failedAt  = failedAt;
    record.error     = error;
    record.errorCode = errorCode;
    record.completedAt = Date.now();
    this._ledger.push(record);
    this._emit('generation:failed', { runId: record.id, failedAt, error });
    return { ok: false, error, errorCode, failedAt, runId: record.id };
  }

  _emit(event, data) {
    for (const l of this._listeners) {
      try { l(event, data); } catch (_) {}
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _accumulateUsage(record, usage) {
  if (!usage) return;
  record.usage.input  += usage.input  || 0;
  record.usage.output += usage.output || 0;
  record.usage.total  += usage.total  || 0;
}

function _buildRegenerationPrompt(schema, target, targetId, instruction) {
  const base = `Modify an existing ${schema.outputType || 'app'} called "${schema.name}".`;
  if (target === 'full') {
    return `${base} Apply this change to the entire system: ${instruction}`;
  }
  if (target === 'page' && targetId) {
    const page = schema.pages?.find(p => p.id === targetId);
    return `${base} Modify the page "${page?.name || targetId}": ${instruction}`;
  }
  if (target === 'collection' && targetId) {
    const coll = schema.collections?.find(c => c.id === targetId);
    return `${base} Modify the data collection "${coll?.name || targetId}": ${instruction}`;
  }
  return `${base} ${instruction}`;
}

function _generateId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const aiGenerationEngine = new AIGenerationEngine();
export default aiGenerationEngine;
