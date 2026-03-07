/**
 * aiAdapter.js — Nuvra Phase 2–2.5
 *
 * The AI Adapter — the only module that talks to an AI provider.
 *
 * All AI calls in the system go through this adapter.
 * It enforces the contract:
 *   - AI receives a system prompt and a user message
 *   - AI must return JSON only
 *   - If AI returns non-JSON, the call fails loudly
 *   - All calls are logged and observable
 *   - The provider is swappable (OpenAI, Gemini, local model)
 *
 * This module does NOT interpret AI output — it only delivers it.
 * Interpretation is the responsibility of the calling module.
 *
 * @module ai/adapter/aiAdapter
 */
'use strict';

import { eventBus }  from '../../runtime/eventBus.js';
import { logger }    from '../../diagnostics/logger.js';
import { errorBoundary, ErrorSeverity } from '../../diagnostics/errorBoundary.js';
import { now }       from '../../runtime/utils.js';

// ─── Provider Config ──────────────────────────────────────────────────────────
const DEFAULT_MODEL   = 'gpt-4.1-mini';
const DEFAULT_TIMEOUT = 30000; // 30s

// ─── AiAdapter ────────────────────────────────────────────────────────────────
class AiAdapter {
  constructor() {
    this._callCount  = 0;
    this._totalMs    = 0;
    this._errors     = 0;
    this._provider   = null; // set by configure()
  }

  /**
   * Configure the adapter with a provider.
   * @param {object} provider - must implement complete(request): Promise<string>
   */
  configure(provider) {
    if (!provider || typeof provider.complete !== 'function') {
      throw new TypeError('aiAdapter.configure: provider must implement complete()');
    }
    this._provider = provider;
    logger.info('aiAdapter', `Provider configured: ${provider.name || 'custom'}`);
  }

  /**
   * Make a completion call to the AI provider.
   *
   * @param {object} request
   * @param {string} request.systemPrompt
   * @param {string} request.userMessage
   * @param {number} [request.temperature]
   * @param {number} [request.maxTokens]
   * @param {'json'|'text'} [request.responseFormat]
   * @returns {Promise<object|string>} parsed JSON object or raw string
   */
  async complete({
    systemPrompt,
    userMessage,
    temperature    = 0,
    maxTokens      = 2000,
    responseFormat = 'json',
  }) {
    if (!this._provider) {
      throw new Error('aiAdapter: no provider configured. Call aiAdapter.configure() first.');
    }
    if (!systemPrompt || !userMessage) {
      throw new TypeError('aiAdapter.complete: systemPrompt and userMessage are required');
    }

    const callId = ++this._callCount;
    const startMs = now();

    logger.debug('aiAdapter', `Call #${callId} starting`, {
      model:         DEFAULT_MODEL,
      temperature,
      maxTokens,
      responseFormat,
      promptLen:     systemPrompt.length + userMessage.length,
    });

    eventBus.emit('ai:call_started', { callId, temperature, responseFormat });

    let rawResponse;
    try {
      rawResponse = await this._provider.complete({
        systemPrompt,
        userMessage,
        temperature,
        maxTokens,
        responseFormat,
      });
    } catch (err) {
      this._errors++;
      const elapsed = now() - startMs;
      logger.error('aiAdapter', `Call #${callId} failed after ${elapsed}ms`, { error: err.message });
      eventBus.emit('ai:call_failed', { callId, error: err.message, elapsed });
      throw err;
    }

    const elapsed = now() - startMs;
    this._totalMs += elapsed;

    logger.debug('aiAdapter', `Call #${callId} complete in ${elapsed}ms`, {
      responseLen: String(rawResponse || '').length,
    });

    eventBus.emit('ai:call_complete', { callId, elapsed, responseLen: String(rawResponse || '').length });

    // ── Enforce JSON contract ────────────────────────────────────────────────
    if (responseFormat === 'json') {
      return this._parseJsonResponse(rawResponse, callId);
    }

    return rawResponse;
  }

  /**
   * Get adapter statistics.
   */
  getStats() {
    return {
      callCount:   this._callCount,
      errorCount:  this._errors,
      totalMs:     this._totalMs,
      avgMs:       this._callCount > 0 ? Math.round(this._totalMs / this._callCount) : 0,
      hasProvider: !!this._provider,
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────
  _parseJsonResponse(raw, callId) {
    if (!raw) throw new Error(`aiAdapter: call #${callId} returned empty response`);

    // Strip markdown code fences if the model ignored instructions
    let cleaned = String(raw).trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    }

    try {
      return JSON.parse(cleaned);
    } catch (err) {
      throw new Error(
        `aiAdapter: call #${callId} returned non-JSON. ` +
        `Parse error: ${err.message}. ` +
        `Response preview: ${cleaned.slice(0, 200)}`
      );
    }
  }
}

// ─── OpenAI Provider ─────────────────────────────────────────────────────────
/**
 * OpenAI-compatible provider.
 * Works with OpenAI, Gemini (via OpenAI-compatible endpoint), and any
 * OpenAI-compatible API.
 */
export class OpenAIProvider {
  constructor({ model = DEFAULT_MODEL, apiKey = null, baseUrl = null } = {}) {
    this.name    = 'openai';
    this._model  = model;
    this._apiKey = apiKey || (typeof process !== 'undefined' ? process.env?.OPENAI_API_KEY : null);
    this._baseUrl = baseUrl || 'https://api.openai.com/v1';
  }

  async complete({ systemPrompt, userMessage, temperature, maxTokens, responseFormat }) {
    const body = {
      model:       this._model,
      temperature,
      max_tokens:  maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage  },
      ],
    };

    if (responseFormat === 'json') {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch(`${this._baseUrl}/chat/completions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${this._apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`OpenAI API error ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? null;
  }
}

// ─── Mock Provider (for testing and deterministic mode) ───────────────────────
/**
 * Mock provider that returns pre-defined responses.
 * Used in tests and when no API key is available.
 */
export class MockAIProvider {
  constructor(responses = {}) {
    this.name       = 'mock';
    this._responses = responses;
    this._callCount = 0;
  }

  async complete({ systemPrompt, userMessage }) {
    const key = Object.keys(this._responses).find(k => systemPrompt.includes(k) || userMessage.includes(k));
    const response = key ? this._responses[key] : this._responses['default'] || '{}';
    this._callCount++;
    // Simulate async
    await new Promise(r => setTimeout(r, 10));
    return typeof response === 'string' ? response : JSON.stringify(response);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const aiAdapter = new AiAdapter();
export default aiAdapter;
