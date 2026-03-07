/**
 * intentExtractor.js — Nuvra Phase 5
 *
 * Pipeline Step 1: Intent Extraction.
 *
 * Converts a raw user prompt into a structured IntentSchema.
 * The IntentSchema is the canonical input to the rest of the pipeline.
 *
 * Output contract (IntentSchema):
 * {
 *   goal:            string,   // What the user wants to build
 *   outputType:      'site' | 'app' | 'hybrid',
 *   industry:        string,   // e.g., 'saas', 'ecommerce', 'healthcare'
 *   brandTone:       string,   // e.g., 'professional', 'playful', 'minimal'
 *   complexity:      'simple' | 'medium' | 'complex',
 *   targetAudience:  string,
 *   dataRequirements: string[], // e.g., ['users', 'products', 'orders']
 *   featureSet:      string[], // e.g., ['crud', 'dashboard', 'auth', 'search']
 *   pageHints:       string[], // e.g., ['landing', 'pricing', 'dashboard']
 *   assumptions:     string[], // What the AI assumed
 *   confidence:      number,   // 0–1
 * }
 *
 * @module ai/pipeline/intentExtractor
 */
'use strict';

import { budgetEngine } from '../budget/budgetEngine.js';
import { providerRegistry } from '../providers/providerRegistry.js';
import { ProviderErrorCode } from '../providers/providerContract.js';

// ─── System Prompt ────────────────────────────────────────────────────────────
const INTENT_SYSTEM_PROMPT = `You are the Intent Extraction module of Nuvra, an AI-native website and app builder.

Your ONLY job is to analyze a user's description and extract structured intent.

You MUST output valid JSON matching this exact schema:
{
  "goal":             string,   // One sentence: what the user wants to build
  "outputType":       "site" | "app" | "hybrid",
  "industry":         string,   // e.g., "saas", "ecommerce", "healthcare", "education", "finance", "general"
  "brandTone":        string,   // e.g., "professional", "playful", "minimal", "bold", "trustworthy"
  "complexity":       "simple" | "medium" | "complex",
  "targetAudience":   string,   // Who will use this
  "dataRequirements": string[], // Data entities needed, e.g., ["users", "products", "orders"]
  "featureSet":       string[], // Features needed, e.g., ["crud", "dashboard", "auth", "search", "forms"]
  "pageHints":        string[], // Suggested page names, e.g., ["Home", "Pricing", "Dashboard"]
  "assumptions":      string[], // What you assumed (be explicit)
  "confidence":       number    // Your confidence 0.0–1.0
}

Rules:
- outputType "site" = marketing/content site (no persistent data)
- outputType "app" = data-driven application (has collections, actions, state)
- outputType "hybrid" = marketing site + app features (e.g., landing page + dashboard)
- Be explicit about assumptions — never silently guess
- If the prompt is vague, set confidence < 0.7 and list assumptions
- dataRequirements should be entity names (singular), e.g., "task" not "tasks"
- featureSet values: "crud", "dashboard", "auth", "search", "forms", "notifications", "analytics", "export", "import", "api"
- Do not add features not implied by the prompt`;

// ─── IntentExtractor ─────────────────────────────────────────────────────────
class IntentExtractor {
  /**
   * Extract intent from a raw user prompt.
   *
   * @param {object} params
   * @param {string}   params.prompt          - Raw user prompt
   * @param {object}   [params.provider]      - Provider override (uses registry active if omitted)
   * @param {object}   [params.context]       - Additional context (previous intent, etc.)
   * @returns {Promise<{ ok: boolean, intent?: IntentSchema, error?: string, usage?: object }>}
   */
  async extract({ prompt, provider, context }) {
    if (!prompt?.trim()) {
      return { ok: false, error: 'Prompt is required' };
    }

    const activeProvider = provider || providerRegistry.getActive();

    // ── Budget check ────────────────────────────────────────────────────────
    const budgetCheck = budgetEngine.check({
      inputTokens:   _estimateTokens(INTENT_SYSTEM_PROMPT) + _estimateTokens(prompt),
      outputTokens:  600,
      provider:      activeProvider,
      operationType: 'intent',
    });

    if (!budgetCheck.allowed) {
      return { ok: false, error: budgetCheck.blocked, errorCode: ProviderErrorCode.BUDGET_EXCEEDED };
    }

    // ── Build user prompt ───────────────────────────────────────────────────
    let userPrompt = `Extract the intent from this description:\n\n"${prompt}"`;
    if (context?.previousIntent) {
      userPrompt += `\n\nPrevious intent (for context):\n${JSON.stringify(context.previousIntent, null, 2)}`;
    }

    // ── Call provider ───────────────────────────────────────────────────────
    const start = Date.now();
    const response = await activeProvider.call({
      systemPrompt: INTENT_SYSTEM_PROMPT,
      userPrompt,
      maxTokens:    600,
      temperature:  0,
      requestId:    _generateId('intent'),
    });

    // ── Record usage ────────────────────────────────────────────────────────
    budgetEngine.record({
      operationType: 'intent',
      providerId:    activeProvider.id,
      usage:         response.usage,
      cost:          activeProvider.estimateCost(response.usage),
      ok:            response.ok,
      latencyMs:     response.latencyMs,
    });

    if (!response.ok) {
      return { ok: false, error: response.error, errorCode: response.errorCode };
    }

    // ── Validate output ─────────────────────────────────────────────────────
    const validation = _validateIntent(response.data);
    if (!validation.ok) {
      return {
        ok:        false,
        error:     `Intent extraction produced invalid schema: ${validation.errors.join(', ')}`,
        errorCode: ProviderErrorCode.SCHEMA_MISMATCH,
        raw:       response.data,
      };
    }

    const intent = _normalizeIntent(response.data, prompt);

    return {
      ok:      true,
      intent,
      usage:   response.usage,
      latency: Date.now() - start,
    };
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────
function _validateIntent(data) {
  const errors = [];
  if (!data || typeof data !== 'object')           errors.push('output is not an object');
  if (!data?.goal)                                 errors.push('goal is required');
  if (!['site','app','hybrid'].includes(data?.outputType)) errors.push('outputType must be site|app|hybrid');
  if (!data?.industry)                             errors.push('industry is required');
  if (!data?.brandTone)                            errors.push('brandTone is required');
  if (!['simple','medium','complex'].includes(data?.complexity)) errors.push('complexity must be simple|medium|complex');
  if (!Array.isArray(data?.dataRequirements))      errors.push('dataRequirements must be an array');
  if (!Array.isArray(data?.featureSet))            errors.push('featureSet must be an array');
  if (!Array.isArray(data?.pageHints))             errors.push('pageHints must be an array');
  if (!Array.isArray(data?.assumptions))           errors.push('assumptions must be an array');
  if (typeof data?.confidence !== 'number')        errors.push('confidence must be a number');
  return { ok: errors.length === 0, errors };
}

function _normalizeIntent(data, originalPrompt) {
  return {
    _type:           'IntentSchema',
    _version:        1,
    _extractedAt:    Date.now(),
    _originalPrompt: originalPrompt,
    goal:            String(data.goal || '').trim(),
    outputType:      data.outputType,
    industry:        String(data.industry || 'general').toLowerCase(),
    brandTone:       String(data.brandTone || 'professional').toLowerCase(),
    complexity:      data.complexity,
    targetAudience:  String(data.targetAudience || 'general users').trim(),
    dataRequirements: (data.dataRequirements || []).map(s => String(s).toLowerCase().trim()),
    featureSet:       (data.featureSet || []).map(s => String(s).toLowerCase().trim()),
    pageHints:        (data.pageHints || []).map(s => String(s).trim()),
    assumptions:      (data.assumptions || []).map(s => String(s).trim()),
    confidence:       Math.max(0, Math.min(1, Number(data.confidence) || 0.5)),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _estimateTokens(text) {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil((text || '').length / 4);
}

function _generateId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const intentExtractor = new IntentExtractor();
export default intentExtractor;
