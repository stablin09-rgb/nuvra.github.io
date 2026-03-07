/**
 * Nuvra Builder — Extension AI API (Phase 10)
 *
 * The scoped AI API surface available to extensions.
 * This is the critical differentiator for AI Packs.
 *
 * AI Packs can:
 *  - Register custom planners (domain-specific generation strategies)
 *  - Extend prompts with domain context
 *  - Register pre/post generation hooks
 *  - Trigger AI generation on behalf of the user
 *
 * DESIGN: The AI API uses a registry pattern. Extensions register
 * their contributions at init time. The aiEngine.js checks this
 * registry before every generation call.
 */
'use strict';

import { hasPermission } from '../permissions.js';

// ─── AI Pack Registry ─────────────────────────────────────────────────────────

/**
 * Registered planners from AI packs.
 * Map<extensionId, PlannerDefinition[]>
 */
const _planners = new Map();

/**
 * Registered prompt extenders.
 * Map<extensionId, PromptExtenderFn[]>
 */
const _promptExtenders = new Map();

/**
 * Registered generation hooks.
 * Map<'before' | 'after', Map<extensionId, HookFn[]>>
 */
const _hooks = {
  before: new Map(),
  after:  new Map(),
};

// ─── Public Registry API (used by aiEngine.js) ────────────────────────────────

/**
 * Get all registered planners from all enabled AI packs.
 * @returns {PlannerDefinition[]}
 */
export function getAllPlanners() {
  const result = [];
  for (const planners of _planners.values()) {
    result.push(...planners);
  }
  return result;
}

/**
 * Get the best planner for a given prompt and generation mode.
 * Returns null if no pack claims the prompt.
 * @param {string} prompt
 * @param {'page'|'site'|'app'} mode
 * @returns {PlannerDefinition | null}
 */
export function getBestPlanner(prompt, mode) {
  const all = getAllPlanners().filter(p => !p.mode || p.mode === mode);
  if (all.length === 0) return null;

  // Score each planner by keyword match
  const lower = prompt.toLowerCase();
  let best = null;
  let bestScore = 0;

  for (const planner of all) {
    const keywords = planner.keywords || [];
    const score = keywords.reduce((s, kw) => {
      return s + (lower.includes(kw.toLowerCase()) ? 1 : 0);
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      best = planner;
    }
  }

  return bestScore > 0 ? best : null;
}

/**
 * Run all registered prompt extenders for a given context.
 * Returns the extended system prompt string.
 * @param {string} basePrompt
 * @param {object} context - { mode, projectMeta }
 * @returns {string}
 */
export function runPromptExtenders(basePrompt, context) {
  let prompt = basePrompt;
  for (const extenders of _promptExtenders.values()) {
    for (const extender of extenders) {
      try {
        const result = extender(prompt, context);
        if (typeof result === 'string' && result.length > 0) {
          prompt = result;
        }
      } catch (e) {
        console.warn('[Nuvra AI API] Prompt extender error:', e);
      }
    }
  }
  return prompt;
}

/**
 * Run all registered pre-generation hooks.
 * @param {object} context - { prompt, mode, options }
 * @returns {object} Potentially modified context
 */
export async function runBeforeHooks(context) {
  let ctx = { ...context };
  const hooks = _hooks.before;
  for (const hookList of hooks.values()) {
    for (const hook of hookList) {
      try {
        const result = await hook(ctx);
        if (result && typeof result === 'object') ctx = result;
      } catch (e) {
        console.warn('[Nuvra AI API] Before-hook error:', e);
      }
    }
  }
  return ctx;
}

/**
 * Run all registered post-generation hooks.
 * @param {object} result - The generation result
 * @param {object} context - { prompt, mode }
 * @returns {object} Potentially modified result
 */
export async function runAfterHooks(result, context) {
  let res = { ...result };
  const hooks = _hooks.after;
  for (const hookList of hooks.values()) {
    for (const hook of hookList) {
      try {
        const modified = await hook(res, context);
        if (modified && typeof modified === 'object') res = modified;
      } catch (e) {
        console.warn('[Nuvra AI API] After-hook error:', e);
      }
    }
  }
  return res;
}

/**
 * Get a summary of all installed AI packs for the AI engine's system prompt.
 * This is how the AI knows what extensions are available.
 * @returns {string}
 */
export function getAIPackSummary() {
  const planners = getAllPlanners();
  if (planners.length === 0) return '';

  const lines = planners.map(p =>
    `- ${p.name}: ${p.description || ''} (keywords: ${(p.keywords || []).join(', ')})`
  );
  return `\n\nInstalled AI Packs:\n${lines.join('\n')}`;
}

/**
 * Remove all AI pack contributions from a specific extension.
 * Called on disable or uninstall.
 */
export function cleanupAIExtension(extensionId) {
  _planners.delete(extensionId);
  _promptExtenders.delete(extensionId);
  _hooks.before.delete(extensionId);
  _hooks.after.delete(extensionId);
}

// ─── Extension-Facing Dispatch ────────────────────────────────────────────────

/**
 * Dispatch an AI API call from a sandboxed extension.
 */
export async function dispatchAICall(method, args, extensionId, permissions, generateFn) {
  switch (method) {
    case 'ai.registerPlanner': {
      _requirePermission(permissions, 'ai.planner.register', method);
      const [def] = args;
      _validatePlannerDef(def);
      if (!_planners.has(extensionId)) _planners.set(extensionId, []);
      _planners.get(extensionId).push({ ...def, extensionId });
      return true;
    }

    case 'ai.extendPrompt': {
      _requirePermission(permissions, 'ai.prompt.extend', method);
      const [fnString] = args;
      // Deserialise the function string safely
      // eslint-disable-next-line no-new-func
      const fn = new Function('return ' + fnString)();
      if (typeof fn !== 'function') throw new Error('extendPrompt: argument must be a function');
      if (!_promptExtenders.has(extensionId)) _promptExtenders.set(extensionId, []);
      _promptExtenders.get(extensionId).push(fn);
      return true;
    }

    case 'ai.registerHook': {
      _requirePermission(permissions, 'ai.hooks.before', method);
      const [when, fnString] = args;
      if (when !== 'before' && when !== 'after') throw new Error('Hook must be "before" or "after"');
      // eslint-disable-next-line no-new-func
      const fn = new Function('return ' + fnString)();
      if (typeof fn !== 'function') throw new Error('registerHook: argument must be a function');
      if (!_hooks[when].has(extensionId)) _hooks[when].set(extensionId, []);
      _hooks[when].get(extensionId).push(fn);
      return true;
    }

    case 'ai.generate': {
      _requirePermission(permissions, 'ai.schema.generate', method);
      const [prompt, options] = args;
      if (!generateFn) throw new Error('AI generate function not available');
      return generateFn(prompt, options || {});
    }

    default:
      throw new Error(`Unknown AI API method: ${method}`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _requirePermission(permissions, required, method) {
  if (!hasPermission(permissions, required)) {
    throw new Error(`Permission denied: "${required}" required for ${method}`);
  }
}

function _validatePlannerDef(def) {
  if (!def || typeof def !== 'object') throw new Error('Planner definition must be an object');
  if (!def.name || typeof def.name !== 'string') throw new Error('Planner must have a name');
  if (!Array.isArray(def.keywords)) throw new Error('Planner must have a keywords array');
  if (!def.systemPrompt || typeof def.systemPrompt !== 'string') {
    throw new Error('Planner must have a systemPrompt string');
  }
}
