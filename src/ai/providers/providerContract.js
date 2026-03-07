/**
 * providerContract.js — Nuvra Phase 5
 *
 * The canonical interface every AI provider must implement.
 *
 * This is the only contract between Nuvra and any AI provider.
 * Providers are plug-and-play: swap the provider, nothing else changes.
 *
 * Contract rules:
 *  1. Every call returns a ProviderResponse (never throws)
 *  2. Output is always JSON (providers must enforce this)
 *  3. Token counts are always reported
 *  4. Errors are always structured
 *  5. Providers never mutate Nuvra state
 *
 * @module ai/providers/providerContract
 */
'use strict';

// ─── Provider Capabilities ────────────────────────────────────────────────────
export const ProviderCapability = Object.freeze({
  JSON_MODE:    'json_mode',    // Native JSON output mode
  STREAMING:    'streaming',    // Streaming responses
  VISION:       'vision',       // Image understanding
  FUNCTION_CALL:'function_call',// Function/tool calling
  LONG_CONTEXT: 'long_context', // >32k token context
});

// ─── Provider Response ────────────────────────────────────────────────────────
/**
 * @typedef {object} ProviderResponse
 * @property {boolean} ok           - Whether the call succeeded
 * @property {object}  [data]       - Parsed JSON output (if ok)
 * @property {string}  [raw]        - Raw string output (if ok)
 * @property {string}  [error]      - Error message (if !ok)
 * @property {string}  [errorCode]  - Machine-readable error code
 * @property {object}  usage        - Token usage
 * @property {number}  usage.input  - Input tokens
 * @property {number}  usage.output - Output tokens
 * @property {number}  usage.total  - Total tokens
 * @property {number}  latencyMs    - Round-trip latency in milliseconds
 * @property {string}  provider     - Provider ID
 * @property {string}  model        - Model ID used
 * @property {string}  requestId    - Unique request ID for tracing
 */

// ─── Provider Error Codes ─────────────────────────────────────────────────────
export const ProviderErrorCode = Object.freeze({
  INVALID_JSON:     'invalid_json',      // Output was not valid JSON
  SCHEMA_MISMATCH:  'schema_mismatch',   // Output did not match expected schema
  RATE_LIMITED:     'rate_limited',      // Provider rate limit hit
  CONTEXT_OVERFLOW: 'context_overflow',  // Prompt exceeded context window
  AUTH_FAILED:      'auth_failed',       // API key invalid or missing
  TIMEOUT:          'timeout',           // Request timed out
  PROVIDER_ERROR:   'provider_error',    // Provider returned an error
  BUDGET_EXCEEDED:  'budget_exceeded',   // Budget limit hit before call
  SAFETY_BLOCKED:   'safety_blocked',    // Safety filter blocked the request
  UNKNOWN:          'unknown',           // Uncategorized error
});

// ─── BaseProvider ─────────────────────────────────────────────────────────────
/**
 * Abstract base class for all AI providers.
 * Providers MUST extend this class and implement `_call()`.
 */
export class BaseProvider {
  /**
   * @param {object} config
   * @param {string}   config.id          - Unique provider ID (e.g., 'openai')
   * @param {string}   config.label       - Human-readable label
   * @param {string[]} config.models      - Available model IDs
   * @param {string}   config.defaultModel- Default model ID
   * @param {string[]} [config.capabilities] - ProviderCapability[]
   * @param {object}   [config.pricing]   - Cost per 1M tokens { input, output } in USD
   */
  constructor(config) {
    if (!config.id)           throw new Error('BaseProvider: id is required');
    if (!config.defaultModel) throw new Error('BaseProvider: defaultModel is required');

    this.id           = config.id;
    this.label        = config.label || config.id;
    this.models       = config.models || [config.defaultModel];
    this.defaultModel = config.defaultModel;
    this.capabilities = config.capabilities || [];
    this.pricing      = config.pricing || { input: 0, output: 0 };
    this._healthy     = true;
    this._lastError   = null;
  }

  /**
   * Send a generation request to the provider.
   *
   * @param {object} request
   * @param {string}   request.systemPrompt  - The system prompt
   * @param {string}   request.userPrompt    - The user prompt
   * @param {object}   request.schema        - Expected JSON output schema (for validation)
   * @param {string}   [request.model]       - Model override
   * @param {number}   [request.maxTokens]   - Max output tokens
   * @param {number}   [request.temperature] - Temperature (0 = deterministic)
   * @param {string}   [request.requestId]   - Trace ID
   * @returns {Promise<ProviderResponse>}
   */
  async call(request) {
    const start = Date.now();
    const requestId = request.requestId || _generateId('req');

    try {
      const response = await this._call({ ...request, requestId });
      response.latencyMs = Date.now() - start;
      response.provider  = this.id;
      response.requestId = requestId;
      response.model     = response.model || request.model || this.defaultModel;

      if (response.ok) {
        this._healthy   = true;
        this._lastError = null;
      } else {
        this._lastError = response.error;
      }

      return response;
    } catch (err) {
      this._healthy   = false;
      this._lastError = err.message;
      return {
        ok:        false,
        error:     err.message,
        errorCode: ProviderErrorCode.UNKNOWN,
        usage:     { input: 0, output: 0, total: 0 },
        latencyMs: Date.now() - start,
        provider:  this.id,
        model:     request.model || this.defaultModel,
        requestId,
      };
    }
  }

  /**
   * Check if this provider supports a capability.
   * @param {string} capability - ProviderCapability
   * @returns {boolean}
   */
  supports(capability) {
    return this.capabilities.includes(capability);
  }

  /**
   * Estimate the cost of a response in USD.
   * @param {object} usage - { input, output }
   * @returns {number} Cost in USD
   */
  estimateCost(usage) {
    return (
      (usage.input  / 1_000_000) * this.pricing.input +
      (usage.output / 1_000_000) * this.pricing.output
    );
  }

  /**
   * Provider health status.
   * @returns {{ healthy: boolean, lastError: string|null }}
   */
  health() {
    return { healthy: this._healthy, lastError: this._lastError };
  }

  /**
   * Implement this in subclasses.
   * @param {object} request
   * @returns {Promise<ProviderResponse>}
   * @abstract
   */
  async _call(_request) {
    throw new Error(`Provider "${this.id}": _call() not implemented`);
  }

  /**
   * Parse and validate JSON from a raw string.
   * Handles markdown code fences and trailing commas.
   * @param {string} raw
   * @returns {{ ok: boolean, data?: object, error?: string }}
   */
  _parseJSON(raw) {
    if (!raw) return { ok: false, error: 'Empty response' };

    // Strip markdown code fences
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    cleaned = cleaned.trim();

    // Find the first { or [ and last } or ]
    const firstBrace = cleaned.search(/[{[]/);
    if (firstBrace > 0) cleaned = cleaned.slice(firstBrace);
    const lastBrace = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (lastBrace >= 0) cleaned = cleaned.slice(0, lastBrace + 1);

    try {
      const data = JSON.parse(cleaned);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: `JSON parse error: ${e.message}`, raw: cleaned };
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _generateId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export default BaseProvider;
