/**
 * Nuvra Builder — AI Engine
 *
 * The public API for all AI generation in Nuvra.
 * Provider-agnostic, schema-driven, and extensible.
 *
 * Architecture:
 *  ┌──────────────────────────────────────────────────────────────────┐
 *  │  aiEngine.js  (public API — never changes)                       │
 *  │    generatePage(prompt)  → PageSchema → SchemaRenderer → HTML    │
 *  │    generateSite(prompt)  → SitePlan  → SchemaRenderer → HTML[]   │
 *  │    generateApp(prompt)   → AppPlan   → AppSchemaRenderer → HTML  │
 *  │                                                                  │
 *  │  Provider Layer (pluggable):                                     │
 *  │    ├── MockProvider     (offline / fallback — always available)  │
 *  │    ├── OpenAIProvider   (requires API key)                       │
 *  │    ├── AnthropicProvider (requires API key)                      │
 *  │    └── LocalProvider   (requires local Ollama/LM Studio)        │
 *  └──────────────────────────────────────────────────────────────────┘
 *
 * To add a new provider:
 *  1. Create a class that extends ProviderBase in src/ai/providerBase.js
 *  2. Implement _callAPI(messages, opts) → { text, usage }
 *  3. Register it in PROVIDER_REGISTRY below
 *
 * GenerationResult shape (for generatePage / generateSite pages):
 *  {
 *    html:    string,
 *    css:     string,
 *    name:    string,
 *    schema:  PageSchema | null,
 *    meta: { provider, model, tokens }
 *  }
 *
 * AppGenerationResult shape (for generateApp):
 *  {
 *    pages:   Array<{ name, html, css, schema, pageType }>,
 *    plan:    AppPlan,
 *    meta:    { provider, model }
 *  }
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
 * Call this at startup and whenever the user changes AI settings.
 *
 * @param {object} config
 * @param {'mock'|'openai'|'anthropic'|'local'} config.provider
 * @param {string}  [config.apiKey]
 * @param {string}  [config.model]
 * @param {string}  [config.baseUrl]
 * @param {number}  [config.maxTokens]
 * @param {number}  [config.maxCost]
 */
export function configureAI(config = {}) {
  _activeConfig = config;

  const providerId    = config.provider || 'mock';
  const ProviderClass = PROVIDER_REGISTRY[providerId];

  if (!ProviderClass) {
    // Unknown provider — fall back to mock silently
    _activeProvider = null;
    console.info('[Nuvra AI] Provider set to: Mock (offline)');
    return;
  }

  _activeProvider = new ProviderClass(config);
  console.info(`[Nuvra AI] Provider set to: ${_activeProvider.displayName} (model: ${config.model || 'default'})`);
}

/**
 * Return the name of the currently active provider.
 * @returns {string}
 */
export function getActiveProviderName() {
  if (!_activeProvider) return 'Mock (offline)';
  return _activeProvider.displayName;
}

/**
 * Return the current session usage summary.
 * @returns {object}
 */
export function getUsageSummary() {
  if (!_activeProvider?.budget) return { requests: 0, totalTokens: 0, estimatedCost: '$0.0000' };
  return _activeProvider.budget.getSummary();
}

// ─── Page Generation ──────────────────────────────────────────────────────────

/**
 * Generate a single marketing/landing page from a prompt.
 *
 * @param {string} prompt
 * @param {object} [options]
 * @returns {Promise<GenerationResult>}
 */
export async function generatePage(prompt, options = {}) {
  const intent = analysePrompt(prompt);

  // Use mock provider if no real provider is configured
  if (!_activeProvider) {
    return _mockPageResult(prompt);
  }

  try {
    const systemPrompt = buildPageSystemPrompt();
    const userMessage  = buildPageUserMessage(prompt, intent);
    const schema       = await _activeProvider.generatePage(systemPrompt, userMessage, options);
    const { html, css } = renderPageSchema(schema);

    return {
      html,
      css,
      name:   schema.pageName || _titleCase(prompt),
      schema,
      meta: {
        provider: _activeProvider.id,
        model:    _activeConfig.model || 'default',
        tokens:   _activeProvider.budget?.getSummary().totalTokens ?? null,
      },
    };
  } catch (err) {
    console.warn('[Nuvra AI] Real provider failed, falling back to mock:', err.message);
    return _mockPageResult(prompt);
  }
}

// ─── Site Generation ──────────────────────────────────────────────────────────

/**
 * Generate a complete multi-page site from a prompt.
 *
 * @param {string} prompt
 * @param {object} [options]
 * @returns {Promise<Array<GenerationResult>>}
 */
export async function generateSite(prompt, options = {}) {
  const intent = analysePrompt(prompt);

  // Use mock provider if no real provider is configured
  if (!_activeProvider) {
    return _mockSiteResult(prompt);
  }

  try {
    const systemPrompt = buildSiteSystemPrompt();
    const userMessage  = buildSiteUserMessage(prompt, intent);
    const sitePlan     = await _activeProvider.generateSite(systemPrompt, userMessage, options);

    return (sitePlan.pages || []).map((pageSchema) => {
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
        },
      };
    });
  } catch (err) {
    console.warn('[Nuvra AI] Real provider failed for site, falling back to mock:', err.message);
    return _mockSiteResult(prompt);
  }
}

// ─── App Generation ───────────────────────────────────────────────────────────

/**
 * Generate a full data-driven application from a prompt.
 *
 * @param {string} prompt
 * @param {object} [options]
 * @param {object[]} [options.existingCollections] - Already-defined collections to pass as context
 * @returns {Promise<AppGenerationResult>}
 */
export async function generateApp(prompt, options = {}) {
  const intent = analyseAppPrompt(prompt);

  // Use mock app planner if no real provider is configured
  if (!_activeProvider) {
    return _mockAppResult(prompt);
  }

  try {
    const systemPrompt = buildAppSystemPrompt({
      existingCollections: options.existingCollections || [],
    });
    const userMessage = buildAppUserMessage(prompt, intent);
    const rawPlan     = await _activeProvider.generateApp(systemPrompt, userMessage, options);
    const appPlan     = validateAppPlan(rawPlan);

    return _buildAppResult(appPlan, _activeProvider.id, _activeConfig.model || 'default');
  } catch (err) {
    console.warn('[Nuvra AI] Real provider failed for app, falling back to mock:', err.message);
    return _mockAppResult(prompt);
  }
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

async function _mockPageResult(prompt) {
  const result = await mockGeneratePage(prompt);
  // mockGeneratePage now returns a GenerationResult directly (html, css, name, schema, meta)
  if (result && result.html) return result;
  // Fallback: treat result as a raw schema
  const schema = result;
  const { html, css } = renderPageSchema(schema);
  return {
    html,
    css,
    name:   schema.pageName || _titleCase(prompt),
    schema,
    meta: { provider: 'mock', model: 'nuvra-mock-v3', tokens: null },
  };
}

async function _mockSiteResult(prompt) {
  const result = await mockGenerateSite(prompt);
  // mockGenerateSite returns a SiteGenerationResult with .pages array
  if (result && Array.isArray(result.pages)) {
    return result.pages;
  }
  // Fallback: treat result as a raw array of schemas
  const schemas = Array.isArray(result) ? result : [result];
  return schemas.map((pageSchema) => {
    const { html, css } = renderPageSchema(pageSchema);
    return {
      html,
      css,
      name:   pageSchema.pageName || 'Page',
      schema: pageSchema,
      meta: { provider: 'mock', model: 'nuvra-mock-v3', tokens: null },
    };
  });
}

async function _mockAppResult(prompt) {
  const appPlan = await mockGenerateApp(prompt);
  return _buildAppResult(appPlan, 'mock', 'nuvra-mock-v3');
}

function _buildAppResult(appPlan, providerId, model) {
  const pages = (appPlan.pages || []).map((appPage) => {
    const { html, css } = renderAppPage(appPage, appPlan);
    return {
      name:     appPage.pageName,
      html,
      css,
      schema:   appPage,
      pageType: appPage.pageType || 'app',
    };
  });

  return {
    pages,
    plan: appPlan,
    collections: appPlan.collections || [],
    meta: { provider: providerId, model },
  };
}

function _titleCase(str) {
  return String(str)
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
