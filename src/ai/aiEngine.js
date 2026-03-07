/**
 * Nuvra Builder — AI Engine (Phase 10 — Extension-Aware)
 *
 * This is a drop-in replacement for the Phase 9B aiEngine.js.
 * It adds AI Pack awareness by wrapping all generation calls
 * with the extension hook system from aiApi.js.
 *
 * CHANGES FROM PHASE 9B:
 *  - generatePage, generateSite, generateApp now run through:
 *      1. runBeforeHooks(context)     — AI packs can modify the prompt
 *      2. runPromptExtenders(prompt)  — AI packs inject domain context
 *      3. getBestPlanner(prompt, mode) — AI packs can override the system prompt
 *      4. [original generation logic]
 *      5. runAfterHooks(result)       — AI packs can post-process the result
 *  - getAIPackSummary() is appended to every system prompt
 *
 * ALL OTHER BEHAVIOUR IS IDENTICAL TO PHASE 9B.
 * All existing imports of aiEngine.js continue to work unchanged.
 */
'use strict';

// ─── Phase 2 / 2.5 imports ────────────────────────────────────────────────────
import { validatePageSchema }                          from './pageSchema.js';
import { renderPageSchema }                            from './schemaRenderer.js';
import { analysePrompt }                               from './promptAnalyser.js';
import { mockGeneratePage, mockGenerateSite, mockGenerateApp } from './mockProvider.js';
// ─── Phase 5A imports ─────────────────────────────────────────────────────────
import { ProviderBase, PromptBudget }                  from './providerBase.js';
import {
  buildPageSystemPrompt, buildPageUserMessage,
  buildSiteSystemPrompt, buildSiteUserMessage,
  buildAppSystemPrompt,  buildAppUserMessage,
}                                                      from './promptBuilder.js';
import { OpenAIProvider }                              from './providers/openaiProvider.js';
import { AnthropicProvider }                           from './providers/anthropicProvider.js';
import { LocalProvider }                               from './providers/localProvider.js';
// ─── Phase 5B imports ─────────────────────────────────────────────────────────
import { analyseAppPrompt }                             from './appPlanner.js';
import { validateAppPlan }                             from './appSchema.js';
import { renderAppPage }                               from './appSchemaRenderer.js';
// ─── Phase 10 imports — AI Pack hooks ─────────────────────────────────────────
import {
  getBestPlanner,
  runPromptExtenders,
  runBeforeHooks,
  runAfterHooks,
  getAIPackSummary,
}                                                      from '../extensions/api/aiApi.js';

// ─── Provider Registry ────────────────────────────────────────────────────────

const PROVIDER_REGISTRY = {
  openai:    OpenAIProvider,
  anthropic: AnthropicProvider,
  local:     LocalProvider,
};

// ─── Active Provider State ────────────────────────────────────────────────────

let _activeProvider  = null;
let _activeConfig    = { provider: 'mock' };

// ─── Public Configuration API ─────────────────────────────────────────────────

/**
 * Configure the AI engine with a provider and credentials.
 */
export function configureAI(config = {}) {
  _activeConfig = config;
  const providerId    = config.provider || 'mock';
  const ProviderClass = PROVIDER_REGISTRY[providerId];
  if (!ProviderClass) {
    _activeProvider = null;
    console.info('[Nuvra AI] Provider set to: Mock (offline)');
    return;
  }
  _activeProvider = new ProviderClass(config);
  console.info(`[Nuvra AI] Provider set to: ${_activeProvider.displayName} (model: ${config.model || 'default'})`);
}

export function getActiveProviderName() {
  if (!_activeProvider) return 'Mock (offline)';
  return _activeProvider.displayName;
}

export function getUsageSummary() {
  if (!_activeProvider?.budget) return { totalTokens: 0, estimatedCost: 0 };
  return _activeProvider.budget.getSummary();
}

// ─── Page Generation ──────────────────────────────────────────────────────────

/**
 * Generate a single page from a prompt.
 * Phase 10: AI pack hooks are applied before and after generation.
 */
export async function generatePage(prompt, options = {}) {
  // Run before hooks (AI packs can modify the prompt)
  const ctx = await runBeforeHooks({ prompt, mode: 'page', options });
  const effectivePrompt = runPromptExtenders(ctx.prompt || prompt, { mode: 'page' });

  const intent = analysePrompt(effectivePrompt);

  if (!_activeProvider) {
    const result = await _mockPageResult(effectivePrompt);
    return runAfterHooks(result, { prompt: effectivePrompt, mode: 'page' });
  }

  try {
    // Check if an AI pack provides a custom planner for this prompt
    const planner = getBestPlanner(effectivePrompt, 'page');
    const systemPrompt = (planner?.systemPrompt || buildPageSystemPrompt()) + getAIPackSummary();
    const userMessage  = buildPageUserMessage(effectivePrompt, intent);

    const schema       = await _activeProvider.generatePage(systemPrompt, userMessage, options);
    const { html, css } = renderPageSchema(schema);
    const result = {
      html,
      css,
      name:   schema.pageName || _titleCase(effectivePrompt),
      schema,
      meta: {
        provider:  _activeProvider.id,
        model:     _activeConfig.model || 'default',
        tokens:    _activeProvider.budget?.getSummary().totalTokens ?? null,
        aiPack:    planner?.extensionId || null,
      },
    };
    return runAfterHooks(result, { prompt: effectivePrompt, mode: 'page' });
  } catch (err) {
    console.warn('[Nuvra AI] Real provider failed, falling back to mock:', err.message);
    const result = await _mockPageResult(effectivePrompt);
    return runAfterHooks(result, { prompt: effectivePrompt, mode: 'page' });
  }
}

// ─── Site Generation ──────────────────────────────────────────────────────────

/**
 * Generate a complete multi-page site from a prompt.
 * Phase 10: AI pack hooks are applied.
 */
export async function generateSite(prompt, options = {}) {
  const ctx = await runBeforeHooks({ prompt, mode: 'site', options });
  const effectivePrompt = runPromptExtenders(ctx.prompt || prompt, { mode: 'site' });

  const intent = analysePrompt(effectivePrompt);

  if (!_activeProvider) {
    const results = await _mockSiteResult(effectivePrompt);
    return runAfterHooks(results, { prompt: effectivePrompt, mode: 'site' });
  }

  try {
    const planner = getBestPlanner(effectivePrompt, 'site');
    const systemPrompt = (planner?.systemPrompt || buildSiteSystemPrompt()) + getAIPackSummary();
    const userMessage  = buildSiteUserMessage(effectivePrompt, intent);

    const sitePlan = await _activeProvider.generateSite(systemPrompt, userMessage, options);
    const results = (sitePlan.pages || []).map((pageSchema) => {
      const { html, css } = renderPageSchema(pageSchema);
      return {
        html,
        css,
        name:   pageSchema.pageName || 'Page',
        schema: pageSchema,
        meta: {
          provider: _activeProvider.id,
          model:    _activeConfig.model || 'default',
          tokens:   null,
          aiPack:   planner?.extensionId || null,
        },
      };
    });
    return runAfterHooks(results, { prompt: effectivePrompt, mode: 'site' });
  } catch (err) {
    console.warn('[Nuvra AI] Real provider failed for site, falling back to mock:', err.message);
    const results = await _mockSiteResult(effectivePrompt);
    return runAfterHooks(results, { prompt: effectivePrompt, mode: 'site' });
  }
}

// ─── App Generation ───────────────────────────────────────────────────────────

/**
 * Generate a full data-driven application from a prompt.
 * Phase 10: AI pack hooks are applied. AI packs can provide custom app planners.
 */
export async function generateApp(prompt, options = {}) {
  const ctx = await runBeforeHooks({ prompt, mode: 'app', options });
  const effectivePrompt = runPromptExtenders(ctx.prompt || prompt, { mode: 'app' });

  const intent = analyseAppPrompt(effectivePrompt);

  if (!_activeProvider) {
    const result = await _mockAppResult(effectivePrompt);
    return runAfterHooks(result, { prompt: effectivePrompt, mode: 'app' });
  }

  try {
    // AI packs can provide a custom app planner (e.g., SaaS AI Pack, E-Commerce AI Pack)
    const planner = getBestPlanner(effectivePrompt, 'app');
    const systemPrompt = (planner?.systemPrompt || buildAppSystemPrompt({
      existingCollections: options.existingCollections || [],
    })) + getAIPackSummary();

    const userMessage = buildAppUserMessage(effectivePrompt, intent);
    const rawPlan     = await _activeProvider.generateApp(systemPrompt, userMessage, options);
    const appPlan     = validateAppPlan(rawPlan);
    const result      = _buildAppResult(appPlan, _activeProvider.id, _activeConfig.model || 'default', planner?.extensionId || null);
    return runAfterHooks(result, { prompt: effectivePrompt, mode: 'app' });
  } catch (err) {
    console.warn('[Nuvra AI] Real provider failed for app, falling back to mock:', err.message);
    const result = await _mockAppResult(effectivePrompt);
    return runAfterHooks(result, { prompt: effectivePrompt, mode: 'app' });
  }
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

async function _mockPageResult(prompt) {
  const result = await mockGeneratePage(prompt);
  if (result && result.html) return result;
  const schema = result;
  const { html, css } = renderPageSchema(schema);
  return {
    html,
    css,
    name:   schema.pageName || _titleCase(prompt),
    schema,
    meta: { provider: 'mock', model: 'nuvra-mock-v3', tokens: null, aiPack: null },
  };
}

async function _mockSiteResult(prompt) {
  const pages = await mockGenerateSite(prompt);
  return pages.map(p => ({
    html:   p.html   || '',
    css:    p.css    || '',
    name:   p.name   || 'Page',
    schema: p.schema || null,
    meta: { provider: 'mock', model: 'nuvra-mock-v3', tokens: null, aiPack: null },
  }));
}

async function _mockAppResult(prompt) {
  return mockGenerateApp(prompt);
}

function _buildAppResult(appPlan, providerId, model, aiPackId = null) {
  const pages = (appPlan.pages || []).map(pagePlan => {
    const { html, css } = renderAppPage(pagePlan, appPlan);
    return {
      name:     pagePlan.pageName || pagePlan.pageType || 'Page',
      pageType: pagePlan.pageType,
      html,
      css,
      schema:   pagePlan,
    };
  });
  return {
    pages,
    plan: appPlan,
    meta: { provider: providerId, model, aiPack: aiPackId },
  };
}

function _titleCase(str) {
  return str.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
