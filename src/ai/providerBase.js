/**
 * Nuvra Builder — Provider Base
 *
 * Abstract base class for all AI providers.
 * Enforces a strict contract: every provider must return a PageSchema.
 *
 * Responsibilities:
 *  - Define the provider interface (generatePage, generateSite, generateApp)
 *  - Enforce schema validation on all output
 *  - Handle retries with exponential backoff
 *  - Track token usage and cost via PromptBudget
 *  - Provide schema repair for near-valid AI output
 *
 * All providers extend this class and implement:
 *  - _callAPI(messages, opts) → raw API response string
 *  - get id()                 → provider identifier string
 *  - get displayName()        → human-readable name
 *  - get models()             → array of available model IDs
 */

'use strict';

import { validatePageSchema, validateSitePlan } from './pageSchema.js';

// ─── Cost Table (per 1M tokens) ───────────────────────────────────────────────

const COST_PER_1M = {
  'gpt-4o':             { input: 5.00,  output: 15.00 },
  'gpt-4o-mini':        { input: 0.15,  output: 0.60  },
  'gpt-4-turbo':        { input: 10.00, output: 30.00 },
  'gpt-3.5-turbo':      { input: 0.50,  output: 1.50  },
  'claude-3-5-sonnet':  { input: 3.00,  output: 15.00 },
  'claude-3-haiku':     { input: 0.25,  output: 1.25  },
  'claude-3-opus':      { input: 15.00, output: 75.00 },
  'local':              { input: 0,     output: 0     },
};

// ─── Prompt Budget ────────────────────────────────────────────────────────────

export class PromptBudget {
  constructor(opts = {}) {
    this.maxTokensPerRequest = opts.maxTokensPerRequest || 4096;
    this.maxCostPerSession   = opts.maxCostPerSession   || 1.00; // USD
    this.sessionTokens       = { input: 0, output: 0 };
    this.sessionCost         = 0;
    this.requestCount        = 0;
  }

  /**
   * Record token usage for a completed request.
   * @param {string} model
   * @param {number} inputTokens
   * @param {number} outputTokens
   */
  record(model, inputTokens, outputTokens) {
    this.sessionTokens.input  += inputTokens  || 0;
    this.sessionTokens.output += outputTokens || 0;
    this.requestCount++;

    const costs = COST_PER_1M[model] || COST_PER_1M['gpt-4o-mini'];
    this.sessionCost += ((inputTokens || 0) / 1_000_000) * costs.input;
    this.sessionCost += ((outputTokens || 0) / 1_000_000) * costs.output;
  }

  /**
   * Check if a request would exceed the session cost limit.
   * @returns {boolean}
   */
  wouldExceedLimit() {
    return this.sessionCost >= this.maxCostPerSession;
  }

  /**
   * Get a summary of session usage.
   * @returns {object}
   */
  getSummary() {
    return {
      requests:     this.requestCount,
      inputTokens:  this.sessionTokens.input,
      outputTokens: this.sessionTokens.output,
      totalTokens:  this.sessionTokens.input + this.sessionTokens.output,
      estimatedCost: `$${this.sessionCost.toFixed(4)}`,
    };
  }

  /**
   * Reset session counters.
   */
  reset() {
    this.sessionTokens = { input: 0, output: 0 };
    this.sessionCost   = 0;
    this.requestCount  = 0;
  }
}

// ─── Provider Base ────────────────────────────────────────────────────────────

export class ProviderBase {
  constructor(config = {}) {
    this.config = config;
    this.budget = new PromptBudget({
      maxTokensPerRequest: config.maxTokens   || 4096,
      maxCostPerSession:   config.maxCost     || 1.00,
    });
    this._maxRetries = config.maxRetries || 2;
  }

  // ── Interface (must be implemented by subclasses) ──────────────────────────

  /** @returns {string} */
  get id()          { throw new Error('ProviderBase: id not implemented'); }

  /** @returns {string} */
  get displayName() { throw new Error('ProviderBase: displayName not implemented'); }

  /** @returns {string[]} */
  get models()      { return []; }

  /**
   * Call the underlying AI API.
   * @param {object[]} messages  - Array of { role, content } objects
   * @param {object}   opts      - { model, maxTokens, temperature }
   * @returns {Promise<string>}  - Raw response text (should be JSON)
   */
  async _callAPI(messages, opts) {
    throw new Error('ProviderBase: _callAPI not implemented');
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Generate a single page schema from a prompt.
   *
   * @param {string} systemPrompt
   * @param {string} userMessage
   * @param {object} [opts]
   * @returns {Promise<PageSchema>}
   */
  async generatePage(systemPrompt, userMessage, opts = {}) {
    if (this.budget.wouldExceedLimit()) {
      throw new Error('Session cost limit reached. Reset your budget in AI Settings.');
    }

    const raw    = await this._callWithRetry(systemPrompt, userMessage, opts);
    const parsed = this._parseJSON(raw);
    return validatePageSchema(parsed);
  }

  /**
   * Generate a multi-page site plan from a prompt.
   *
   * @param {string} systemPrompt
   * @param {string} userMessage
   * @param {object} [opts]
   * @returns {Promise<SitePlan>}
   */
  async generateSite(systemPrompt, userMessage, opts = {}) {
    if (this.budget.wouldExceedLimit()) {
      throw new Error('Session cost limit reached. Reset your budget in AI Settings.');
    }

    const raw    = await this._callWithRetry(systemPrompt, userMessage, opts);
    const parsed = this._parseJSON(raw);
    return validateSitePlan(parsed);
  }

  /**
   * Generate an app plan from a prompt.
   * Returns an AppPlan (validated by the app schema system).
   *
   * @param {string} systemPrompt
   * @param {string} userMessage
   * @param {object} [opts]
   * @returns {Promise<AppPlan>}
   */
  async generateApp(systemPrompt, userMessage, opts = {}) {
    if (this.budget.wouldExceedLimit()) {
      throw new Error('Session cost limit reached. Reset your budget in AI Settings.');
    }

    const raw    = await this._callWithRetry(systemPrompt, userMessage, opts);
    const parsed = this._parseJSON(raw);
    // App plan validation is handled by the appSchema module
    return parsed;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  async _callWithRetry(systemPrompt, userMessage, opts) {
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage  },
    ];

    let lastError;
    for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
      try {
        const result = await this._callAPI(messages, {
          model:       opts.model       || this.config.model || (this.models[0] || 'default'),
          maxTokens:   opts.maxTokens   || this.budget.maxTokensPerRequest,
          temperature: opts.temperature || 0.7,
          jsonMode:    true,
        });

        // Record usage if the provider returned token counts
        if (result.usage) {
          this.budget.record(
            opts.model || this.config.model,
            result.usage.inputTokens,
            result.usage.outputTokens,
          );
          return result.text;
        }

        return typeof result === 'string' ? result : result.text || result;

      } catch (err) {
        lastError = err;
        if (attempt < this._maxRetries) {
          const delay = 1000 * Math.pow(2, attempt); // exponential backoff
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw lastError || new Error('AI request failed after retries.');
  }

  _parseJSON(raw) {
    if (typeof raw === 'object' && raw !== null) return raw;

    const text = String(raw).trim();

    // Try direct parse
    try { return JSON.parse(text); } catch (_) { /* continue */ }

    // Try extracting JSON from markdown code block
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlock) {
      try { return JSON.parse(codeBlock[1]); } catch (_) { /* continue */ }
    }

    // Try extracting the first { ... } block
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } catch (_) { /* continue */ }
    }

    throw new Error(`AI returned non-JSON output: ${text.slice(0, 200)}`);
  }
}
