/**
 * Nuvra Builder — Local LLM Provider
 *
 * Implements the ProviderBase interface for locally-running LLMs.
 *
 * Compatible with:
 *  - Ollama (http://localhost:11434)
 *  - LM Studio (http://localhost:1234/v1)
 *  - Any OpenAI-compatible API endpoint
 *
 * Key features:
 *  - Zero cost (local inference)
 *  - Model auto-detection via the Ollama /api/tags endpoint
 *  - Graceful fallback if JSON mode is not supported
 *  - No API key required
 */

'use strict';

import { ProviderBase } from '../providerBase.js';

const DEFAULT_BASE_URL = 'http://localhost:11434';

export class LocalProvider extends ProviderBase {
  constructor(config = {}) {
    super(config);
    this._baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this._model   = config.model || 'llama3';
    this._detectedModels = [];
  }

  get id()          { return 'local'; }
  get displayName() { return 'Local LLM (Ollama / LM Studio)'; }
  get models()      { return this._detectedModels.length ? this._detectedModels : [this._model]; }

  setBaseUrl(url)  { this._baseUrl = url.replace(/\/$/, ''); }
  setModel(model)  { this._model   = model; }

  /**
   * Attempt to detect running models from the Ollama /api/tags endpoint.
   * Returns an array of model name strings.
   * @returns {Promise<string[]>}
   */
  async detectModels() {
    try {
      const res = await fetch(`${this._baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return [];
      const data = await res.json();
      this._detectedModels = (data.models || []).map((m) => m.name).filter(Boolean);
      return this._detectedModels;
    } catch (_) {
      return [];
    }
  }

  /**
   * Check if the local server is reachable.
   * @returns {Promise<boolean>}
   */
  async isReachable() {
    try {
      const res = await fetch(`${this._baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch (_) {
      return false;
    }
  }

  async _callAPI(messages, opts = {}) {
    const model       = opts.model       || this._model;
    const maxTokens   = opts.maxTokens   || 4096;
    const temperature = opts.temperature || 0.7;

    // Try OpenAI-compatible endpoint first (works with LM Studio and Ollama ≥ 0.1.24)
    const openAiUrl = `${this._baseUrl}/v1/chat/completions`;

    try {
      const body = {
        model,
        messages,
        max_tokens:  maxTokens,
        temperature,
        // Request JSON mode if supported
        response_format: { type: 'json_object' },
      };

      const response = await fetch(openAiUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      if (response.ok) {
        const data = await response.json();
        const text = data?.choices?.[0]?.message?.content || '';
        return { text, usage: { inputTokens: 0, outputTokens: 0 } };
      }
    } catch (_) {
      // Fall through to Ollama native API
    }

    // Fallback: Ollama native /api/chat endpoint
    const ollamaUrl = `${this._baseUrl}/api/chat`;

    const body = {
      model,
      messages,
      stream:  false,
      options: { temperature, num_predict: maxTokens },
      format:  'json', // Ollama JSON mode
    };

    const response = await fetch(ollamaUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(
        `Local LLM error ${response.status}. Is your server running at ${this._baseUrl}?`
      );
    }

    const data = await response.json();
    const text = data?.message?.content || data?.response || '';
    return { text, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
