/**
 * planningEngine.js — Nuvra Phase 2–2.5
 *
 * The Planning Engine — the top-level orchestrator.
 *
 * This is the public API for the entire AI planning system.
 * All external code (UI, boot sequence, tests) interacts with this module.
 *
 * Responsibilities:
 *  - Orchestrate the full planning pipeline:
 *      Prompt → Intent Analysis → Planning Graph → Schema Store
 *  - Support full re-planning (new prompt, same site)
 *  - Support incremental re-planning (update specific sections)
 *  - Preserve user edits across re-plans
 *  - Emit progress events for UI feedback
 *  - Handle errors at every stage
 *
 * @module ai/planningEngine
 */
'use strict';

import { eventBus }       from '../runtime/eventBus.js';
import { logger }         from '../diagnostics/logger.js';
import { errorBoundary, ErrorSeverity } from '../diagnostics/errorBoundary.js';
import { store }          from '../state/store.js';
import { intentAnalyzer } from './intent/intentAnalyzer.js';
import { planningGraph }  from './planning/planningGraph.js';
import { schemaStore }    from './schemas/schemaStore.js';
import { schemaValidator } from './validator/schemaValidator.js';
import { now }            from '../runtime/utils.js';

// ─── PlanningEngine ───────────────────────────────────────────────────────────
export const planningEngine = {
  id:   'planningEngine',
  deps: [],

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  init(runtime) {
    // Listen for section re-plan requests from the UI
    eventBus.on('ai:replan_section_requested', ({ sectionId }) => {
      this.replanSection(sectionId).catch(err => {
        errorBoundary.capture(err, { module: 'planningEngine', context: 'replan_section', severity: ErrorSeverity.MEDIUM });
      });
    });

    // Restore schema store from persisted state on hydration
    eventBus.on('store:hydrated', () => {
      const state = store.getState();
      if (state.ai?.schemaStore) {
        schemaStore.restore(state.ai.schemaStore);
        logger.info('planningEngine', 'Schema store restored from persisted state');
      }
    });

    // Persist schema store on every change
    schemaStore.subscribe(() => {
      store.dispatch({
        type:    'AI/SET_SCHEMA_STORE',
        payload: schemaStore.serialize(),
      });
    });
  },

  start(runtime) {
    logger.info('planningEngine', 'Planning engine started');
  },

  stop() {},

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Run the full planning pipeline from a raw prompt.
   *
   * Pipeline:
   *   1. Analyze intent
   *   2. Validate intent
   *   3. Store intent
   *   4. Generate site plan
   *   5. Validate site plan
   *   6. Store site plan
   *
   * @param {string} rawPrompt
   * @param {object} [options]
   * @param {boolean} [options.deterministic]
   * @returns {Promise<{ ok: boolean, intentId: string, siteId: string, errors: string[] }>}
   */
  async run(rawPrompt, { deterministic = true } = {}) {
    logger.info('planningEngine', 'Starting full planning pipeline');
    store.dispatch({ type: 'AI/SET_PLANNING', payload: true });
    eventBus.emit('ai:pipeline_started', { rawPrompt: rawPrompt.slice(0, 100) });

    try {
      // ── Stage 1: Intent Analysis ───────────────────────────────────────────
      this._emitProgress('intent_analysis', 'Analyzing your intent…');
      const { intent, errors: intentErrors } = await intentAnalyzer.analyze(rawPrompt, { deterministic });

      if (intentErrors.length > 0 || !intent) {
        const msg = `Intent analysis failed: ${intentErrors.join(', ')}`;
        logger.error('planningEngine', msg);
        store.dispatch({ type: 'AI/SET_PLANNING', payload: false });
        return { ok: false, intentId: null, siteId: null, errors: intentErrors };
      }

      // ── Stage 2: Store Intent ──────────────────────────────────────────────
      schemaStore.setIntent(intent);
      store.dispatch({ type: 'AI/SET_INTENT', payload: intent });

      // ── Stage 3: Planning Graph ────────────────────────────────────────────
      this._emitProgress('planning', 'Building your site plan…');
      const { siteSchema, decisions, errors: planErrors } = await planningGraph.plan(intent, { deterministic });

      if (planErrors.length > 0 || !siteSchema) {
        const msg = `Planning failed: ${planErrors.join(', ')}`;
        logger.error('planningEngine', msg);
        store.dispatch({ type: 'AI/SET_PLANNING', payload: false });
        return { ok: false, intentId: intent.id, siteId: null, errors: planErrors };
      }

      // ── Stage 4: Validate Site Schema ──────────────────────────────────────
      const validationErrors = schemaValidator.validateSiteSchema(siteSchema);
      if (validationErrors.length > 0) {
        logger.error('planningEngine', 'Site schema validation failed', { validationErrors });
        store.dispatch({ type: 'AI/SET_PLANNING', payload: false });
        return { ok: false, intentId: intent.id, siteId: null, errors: validationErrors };
      }

      // ── Stage 5: Store Site Schema ─────────────────────────────────────────
      const { ok, errors: storeErrors } = schemaStore.setSiteSchema(siteSchema, { source: 'ai' });
      if (!ok) {
        store.dispatch({ type: 'AI/SET_PLANNING', payload: false });
        return { ok: false, intentId: intent.id, siteId: null, errors: storeErrors };
      }

      store.dispatch({ type: 'AI/SET_SITE_SCHEMA', payload: siteSchema });
      store.dispatch({ type: 'AI/SET_DECISIONS',   payload: decisions });

      logger.info('planningEngine', 'Full planning pipeline complete', {
        intentId: intent.id,
        siteId:   siteSchema.id,
        pages:    siteSchema.pages.length,
      });

      eventBus.emit('ai:pipeline_complete', {
        intentId: intent.id,
        siteId:   siteSchema.id,
      });

      return { ok: true, intentId: intent.id, siteId: siteSchema.id, errors: [] };

    } catch (err) {
      errorBoundary.capture(err, {
        module:   'planningEngine',
        context:  'run',
        severity: ErrorSeverity.HIGH,
      });
      return { ok: false, intentId: null, siteId: null, errors: [err.message] };
    } finally {
      store.dispatch({ type: 'AI/SET_PLANNING', payload: false });
    }
  },

  /**
   * Re-plan with a new prompt, preserving user edits on locked sections.
   * @param {string} newPrompt
   * @returns {Promise<object>}
   */
  async replan(newPrompt) {
    logger.info('planningEngine', 'Re-planning with new prompt');
    eventBus.emit('ai:replan_started', {});
    return this.run(newPrompt);
  },

  /**
   * Re-plan a single section without touching the rest of the site.
   * @param {string} sectionId
   * @returns {Promise<{ ok: boolean, errors: string[] }>}
   */
  async replanSection(sectionId) {
    const site   = schemaStore.getSiteSchema();
    const intent = schemaStore.getIntent();

    if (!site || !intent) {
      return { ok: false, errors: ['No site schema or intent available for section re-planning'] };
    }

    // Find the section
    let targetSection = null;
    let targetPage    = null;
    for (const page of site.pages) {
      const sec = page.sections.find(s => s.id === sectionId);
      if (sec) { targetSection = sec; targetPage = page; break; }
    }

    if (!targetSection) {
      return { ok: false, errors: [`Section ${sectionId} not found`] };
    }

    if (targetSection.meta.locked) {
      return { ok: false, errors: [`Section ${sectionId} is locked — unlock it first`] };
    }

    logger.info('planningEngine', `Re-planning section ${sectionId} (${targetSection.type}) on page "${targetPage.name}"`);
    eventBus.emit('ai:section_replan_started', { sectionId, sectionType: targetSection.type });

    // Re-plan just this section using the planning graph
    try {
      const { siteSchema: newSite, errors } = await planningGraph.plan(intent);
      if (errors.length > 0) return { ok: false, errors };

      // Find the corresponding section in the new plan
      const newPage = newSite.pages.find(p => p.slug === targetPage.slug);
      const newSec  = newPage?.sections.find(s => s.type === targetSection.type);

      if (newSec) {
        // Apply the new section's contentIntent to the existing section
        schemaStore.recordUserEdit(sectionId, 'purpose',       newSec.purpose);
        schemaStore.recordUserEdit(sectionId, 'reason',        newSec.reason);
        schemaStore.recordUserEdit(sectionId, 'contentIntent', newSec.contentIntent);
      }

      eventBus.emit('ai:section_replan_complete', { sectionId });
      return { ok: true, errors: [] };
    } catch (err) {
      return { ok: false, errors: [err.message] };
    }
  },

  /**
   * Apply a partial update to the site schema (e.g. user edited a section's contentIntent).
   * @param {string} sectionId
   * @param {object} changes
   */
  applyPartialUpdate(sectionId, changes) {
    for (const [field, value] of Object.entries(changes)) {
      schemaStore.recordUserEdit(sectionId, field, value);
    }
    eventBus.emit('ai:partial_update_applied', { sectionId, fields: Object.keys(changes) });
  },

  // ── Private ────────────────────────────────────────────────────────────────
  _emitProgress(stage, message) {
    store.dispatch({ type: 'AI/SET_PLANNING_STAGE', payload: { stage, message } });
    eventBus.emit('ai:progress', { stage, message });
    logger.info('planningEngine', `[${stage}] ${message}`);
  },
};

export default planningEngine;
