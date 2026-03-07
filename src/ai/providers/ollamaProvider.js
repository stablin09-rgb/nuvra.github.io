/**
 * ollamaProvider.js — Nuvra Phase 5
 *
 * Local model provider for Ollama and LM Studio.
 * Targets the OpenAI-compatible /v1/chat/completions endpoint
 * that both Ollama (>=0.1.24) and LM Studio expose locally.
 *
 * Default: http://localhost:11434/v1 (Ollama)
 * LM Studio: http://localhost:1234/v1
 *
 * @module ai/providers/ollamaProvider
 */
'use strict';

import { BaseProvider, ProviderCapability, ProviderErrorCode } from './providerContract.js';

export class OllamaProvider extends BaseProvider {
  constructor(config = {}) {
    super({
      id:           config.id || 'ollama',
      label:        config.label || 'Ollama (Local)',
      models:       config.models || ['llama3.2', 'mistral', 'phi3', 'gemma2', 'qwen2.5'],
      defaultModel: config.model || config.defaultModel || 'llama3.2',
      capabilities: [
        ProviderCapability.JSON_MODE,
      ],
      pricing: {
        // Local models are free
        input:  0,
        output: 0,
      },
      ...config,
    });

    this._baseUrl = config.baseUrl || 'http://localhost:11434/v1';
    this._timeout = config.timeout || 120_000; // Local models can be slow
    this._noApiKey = true; // Local models don't need API keys
  }

  async _call(request) {
    const model = request.model || this.defaultModel;

    const body = {
      model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user',   content: request.userPrompt   },
      ],
      temperature:  request.temperature ?? 0,
      max_tokens:   request.maxTokens   || 4096,
      // Ollama supports response_format for JSON mode in newer versions
      response_format: { type: 'json_object' },
      stream: false,
    };

    try {
      const resp = await _fetchWithTimeout(
        `${this._baseUrl}/chat/completions`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        },
        this._timeout
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        return {
          ok:        false,
          error:     `Ollama HTTP ${resp.status}: ${text.slice(0, 200)}`,
          errorCode: resp.status >= 500 ? ProviderErrorCode.PROVIDER_ERROR : ProviderErrorCode.UNKNOWN,
          usage:     { input: 0, output: 0, total: 0 },
          model,
        };
      }

      const json = await resp.json();
      const rawText = json.choices?.[0]?.message?.content || '';
      const usage = {
        input:  json.usage?.prompt_tokens     || 0,
        output: json.usage?.completion_tokens || 0,
        total:  json.usage?.total_tokens      || 0,
      };

      const parsed = this._parseJSON(rawText);
      if (!parsed.ok) {
        return {
          ok:        false,
          error:     parsed.error,
          errorCode: ProviderErrorCode.INVALID_JSON,
          raw:       rawText,
          usage,
          model,
        };
      }

      return { ok: true, data: parsed.data, raw: rawText, usage, model };

    } catch (err) {
      // Connection refused = Ollama not running
      const isConnectionError = err.message?.includes('ECONNREFUSED') || err.message?.includes('fetch failed');
      return {
        ok:        false,
        error:     isConnectionError
          ? `Ollama not running at ${this._baseUrl}. Start Ollama with: ollama serve`
          : err.message,
        errorCode: err.name === 'AbortError'
          ? ProviderErrorCode.TIMEOUT
          : ProviderErrorCode.PROVIDER_ERROR,
        usage:     { input: 0, output: 0, total: 0 },
        model,
      };
    }
  }
}

// ─── LM Studio variant ────────────────────────────────────────────────────────
export class LMStudioProvider extends OllamaProvider {
  constructor(config = {}) {
    super({
      id:       'lmstudio',
      label:    'LM Studio (Local)',
      baseUrl:  config.baseUrl || 'http://localhost:1234/v1',
      ...config,
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function _fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export default OllamaProvider;
