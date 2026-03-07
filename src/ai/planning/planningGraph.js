/**
 * planningGraph.js — Nuvra Phase 2–2.5
 *
 * The AI Planning Graph.
 *
 * This is NOT a linear AI response. It is a structured planning process
 * that produces a fully explainable SiteSchema from an IntentSchema.
 *
 * The Planning Graph operates in three stages:
 *
 *   Stage 1 — Page Planning
 *     Decide which pages exist and why, using heuristics + AI validation.
 *
 *   Stage 2 — Section Planning
 *     For each page, decide which sections exist, in what order, and why.
 *     Uses PAGE_TEMPLATES as the heuristic baseline, then refines with AI.
 *
 *   Stage 3 — Content Intent Planning
 *     For each section, define what it must communicate (not the copy itself).
 *     This is the ContentIntentSchema — the semantic contract for the renderer.
 *
 * Every decision is encoded with a `reason` field.
 * No decision is hidden.
 *
 * @module ai/planning/planningGraph
 */
'use strict';

import { eventBus }        from '../../runtime/eventBus.js';
import { logger }          from '../../diagnostics/logger.js';
import { errorBoundary, ErrorSeverity } from '../../diagnostics/errorBoundary.js';
import { aiAdapter }       from '../adapter/aiAdapter.js';
import { schemaValidator } from '../validator/schemaValidator.js';
import {
  PAGE_TEMPLATES,
  SECTION_METADATA,
  SectionType,
  selectPagesForIntent,
} from './planningHeuristics.js';
import {
  createSiteSchema,
  createPageSchema,
  createSectionSchema,
  createContentIntentSchema,
} from '../schemas/schemaTypes.js';
import { generateId, now } from '../../runtime/utils.js';

// ─── Planning Graph System Prompt ─────────────────────────────────────────────
const PLANNING_SYSTEM_PROMPT = `You are the Planning Graph for Nuvra, a professional website builder.

Your job is to refine a pre-computed section plan for a single page.
You receive:
- A structured intent object describing what the user wants to build
- A heuristic baseline section plan for the page

You must return a JSON object with this exact structure:
{
  "sections": [
    {
      "type": "<section type from the provided list>",
      "purpose": "<one sentence: what this section must achieve>",
      "reason": "<one sentence: why this section is here, in this position>",
      "priority": <1-10, where 10 is most important>,
      "contentIntent": {
        "headline": "<what the headline must communicate, not the actual copy>",
        "body": "<what the body content must convey>",
        "cta": "<what action the CTA must drive, or null>",
        "tone": "<tone for this specific section>",
        "mustInclude": ["<content element that must be present>"],
        "mustAvoid": ["<content element to exclude>"]
      }
    }
  ],
  "planningNotes": "<brief explanation of any significant changes from the baseline>",
  "confidence": <0.0 to 1.0>
}

Rules:
- Return ONLY valid JSON. No markdown, no explanation.
- Do NOT add sections not in the provided allowed types list.
- Do NOT remove required sections (navigation, hero, footer).
- You MAY reorder sections if there is a strong UX reason.
- You MAY add sections from the allowed list if they serve the intent.
- You MAY remove optional sections if they do not serve the intent.
- Every section MUST have a reason that references the user's intent.`;

// ─── PlanningGraph ────────────────────────────────────────────────────────────
export const planningGraph = {
  id: 'planningGraph',

  /**
   * Generate a complete SiteSchema from an IntentSchema.
   *
   * @param {object} intent - canonical IntentSchema
   * @param {object} [options]
   * @param {boolean} [options.deterministic]
   * @returns {Promise<{ siteSchema: object, decisions: object[], errors: string[] }>}
   */
  async plan(intent, { deterministic = true } = {}) {
    if (!intent || typeof intent !== 'object') {
      return { siteSchema: null, decisions: [], errors: ['intent must be an object'] };
    }

    logger.info('planningGraph', `Planning site for intent: ${intent.id}`);
    eventBus.emit('ai:planning_started', { intentId: intent.id });

    const decisions = [];
    const siteSchema = createSiteSchema({ intentId: intent.id, intent });

    // ── Stage 1: Page Planning ────────────────────────────────────────────────
    const pageDescriptors = selectPagesForIntent(intent);
    logger.info('planningGraph', `Stage 1: Selected ${pageDescriptors.length} pages`, {
      pages: pageDescriptors.map(p => p.name),
    });

    decisions.push({
      stage:   1,
      type:    'page_selection',
      outcome: pageDescriptors.map(p => ({ name: p.name, reason: p.reason })),
    });

    // ── Stage 2 & 3: Section + Content Intent Planning per page ───────────────
    for (const pageDesc of pageDescriptors) {
      logger.info('planningGraph', `Stage 2/3: Planning sections for page "${pageDesc.name}"`);

      // Get heuristic baseline
      const baseline = PAGE_TEMPLATES[pageDesc.template] || PAGE_TEMPLATES.landing;

      // Refine with AI
      let refinedSections;
      try {
        refinedSections = await this._refineSectionsWithAI(
          intent, pageDesc, baseline, { deterministic }
        );
      } catch (err) {
        logger.warn('planningGraph', `AI refinement failed for "${pageDesc.name}", using baseline`, { err: err.message });
        refinedSections = this._baselineToSections(baseline, intent);
      }

      // Build PageSchema
      const pageSchema = createPageSchema({
        name:     pageDesc.name,
        slug:     pageDesc.slug,
        purpose:  pageDesc.purpose,
        reason:   pageDesc.reason,
        template: pageDesc.template,
        intentId: intent.id,
      });

      // Build SectionSchemas
      for (const sec of refinedSections) {
        const sectionSchema = createSectionSchema({
          type:          sec.type,
          purpose:       sec.purpose,
          reason:        sec.reason,
          priority:      sec.priority || 5,
          contentIntent: createContentIntentSchema({
            sectionType: sec.type,
            headline:    sec.contentIntent?.headline || '',
            body:        sec.contentIntent?.body     || '',
            cta:         sec.contentIntent?.cta      || null,
            tone:        sec.contentIntent?.tone     || intent.brand.tone[0] || 'professional',
            mustInclude: sec.contentIntent?.mustInclude || [],
            mustAvoid:   sec.contentIntent?.mustAvoid   || [],
          }),
        });
        pageSchema.sections.push(sectionSchema);
      }

      siteSchema.pages.push(pageSchema);

      decisions.push({
        stage:   2,
        type:    'section_planning',
        page:    pageDesc.name,
        outcome: refinedSections.map(s => ({ type: s.type, reason: s.reason })),
      });
    }

    // ── Finalize SiteSchema ───────────────────────────────────────────────────
    siteSchema.meta.pageCount    = siteSchema.pages.length;
    siteSchema.meta.sectionCount = siteSchema.pages.reduce((n, p) => n + p.sections.length, 0);
    siteSchema.meta.plannedAt    = now();

    logger.info('planningGraph', `Planning complete: ${siteSchema.pages.length} pages, ${siteSchema.meta.sectionCount} sections`);
    eventBus.emit('ai:planning_complete', {
      intentId:     intent.id,
      siteSchemaId: siteSchema.id,
      pageCount:    siteSchema.pages.length,
      sectionCount: siteSchema.meta.sectionCount,
    });

    return { siteSchema, decisions, errors: [] };
  },

  // ── Private ────────────────────────────────────────────────────────────────
  async _refineSectionsWithAI(intent, pageDesc, baseline, { deterministic }) {
    const allowedTypes = Object.values(SectionType);
    const userMessage = JSON.stringify({
      intent: {
        productType: intent.product.type,
        domain:      intent.product.domain,
        audience:    intent.audience.primary,
        goals:       intent.goals,
        brand:       intent.brand,
        features:    intent.features,
      },
      page: {
        name:     pageDesc.name,
        template: pageDesc.template,
        purpose:  pageDesc.purpose,
      },
      baseline: baseline.map(b => ({ type: b.type, reason: b.reason })),
      allowedSectionTypes: allowedTypes,
    });

    const raw = await aiAdapter.complete({
      systemPrompt:   PLANNING_SYSTEM_PROMPT,
      userMessage,
      temperature:    deterministic ? 0 : 0.2,
      maxTokens:      2000,
      responseFormat: 'json',
    });

    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

    // Validate AI output
    const errors = schemaValidator.validatePlanningAiOutput(parsed);
    if (errors.length > 0) {
      throw new Error(`AI planning output invalid: ${errors.join(', ')}`);
    }

    return parsed.sections;
  },

  _baselineToSections(baseline, intent) {
    return baseline.map((b, idx) => ({
      type:     b.type,
      purpose:  SECTION_METADATA[b.type]?.purpose || b.reason,
      reason:   b.reason,
      priority: Math.max(1, 10 - idx),
      contentIntent: {
        headline:    `Communicate the core ${b.type} message for ${intent.product.domain || 'this product'}`,
        body:        `Support the ${b.type} purpose with relevant content for ${intent.audience.primary || 'the target audience'}`,
        cta:         b.type === SectionType.HERO || b.type === SectionType.CTA ? intent.goals.primary || 'Get started' : null,
        tone:        intent.brand.tone[0] || 'professional',
        mustInclude: SECTION_METADATA[b.type]?.required || [],
        mustAvoid:   intent.content.mustAvoid || [],
      },
    }));
  },
};

export default planningGraph;
