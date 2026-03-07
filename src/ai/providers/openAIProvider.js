/**
 * openAIProvider.js — Nuvra Phase 5
 *
 * OpenAI provider implementation.
 * Supports GPT-4o, GPT-4o-mini, GPT-4-turbo with native JSON mode.
 *
 * @module ai/providers/openAIProvider
 */
'use strict';

import { BaseProvider, ProviderCapability, ProviderErrorCode } from './providerContract.js';

export class OpenAIProvider extends BaseProvider {
  constructor(config = {}) {
    super({
      id:           'openai',
      label:        'OpenAI',
      models:       ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4.1-mini', 'gpt-4.1-nano'],
      defaultModel: config.model || 'gpt-4o-mini',
      capabilities: [
        ProviderCapability.JSON_MODE,
        ProviderCapability.FUNCTION_CALL,
        ProviderCapability.VISION,
        ProviderCapability.LONG_CONTEXT,
      ],
      pricing: {
        // GPT-4o-mini pricing per 1M tokens (USD)
        input:  0.15,
        output: 0.60,
      },
      ...config,
    });

    this._apiKey  = config.apiKey  || (typeof process !== 'undefined' ? process.env?.OPENAI_API_KEY : null) || null;
    this._baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this._timeout = config.timeout || 60_000;
  }

  async _call(request) {
    if (!this._apiKey) {
      return {
        ok:        false,
        error:     'OpenAI API key not configured',
        errorCode: ProviderErrorCode.AUTH_FAILED,
        usage:     { input: 0, output: 0, total: 0 },
      };
    }

    const model = request.model || this.defaultModel;
    const messages = [
      { role: 'system', content: request.systemPrompt },
      { role: 'user',   content: request.userPrompt   },
    ];

    const body = {
      model,
      messages,
      temperature:  request.temperature ?? 0,
      max_tokens:   request.maxTokens   || 4096,
      response_format: { type: 'json_object' },
    };

    let rawText;
    let statusCode;

    try {
      const resp = await _fetchWithTimeout(
        `${this._baseUrl}/chat/completions`,
        {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${this._apiKey}`,
          },
          body: JSON.stringify(body),
        },
        this._timeout
      );

      statusCode = resp.status;
      const json = await resp.json();

      if (!resp.ok) {
        const errMsg = json?.error?.message || `HTTP ${statusCode}`;
        const code   = _mapOpenAIError(statusCode, json?.error?.code);
        return {
          ok:        false,
          error:     errMsg,
          errorCode: code,
          usage:     { input: 0, output: 0, total: 0 },
        };
      }

      rawText = json.choices?.[0]?.message?.content || '';
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
      const code = err.name === 'AbortError'
        ? ProviderErrorCode.TIMEOUT
        : ProviderErrorCode.PROVIDER_ERROR;
      return {
        ok:        false,
        error:     err.message,
        errorCode: code,
        usage:     { input: 0, output: 0, total: 0 },
        model,
      };
    }
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

function _mapOpenAIError(status, code) {
  if (status === 401)                         return ProviderErrorCode.AUTH_FAILED;
  if (status === 429)                         return ProviderErrorCode.RATE_LIMITED;
  if (status === 400 && code === 'context_length_exceeded') return ProviderErrorCode.CONTEXT_OVERFLOW;
  if (status >= 500)                          return ProviderErrorCode.PROVIDER_ERROR;
  return ProviderErrorCode.UNKNOWN;
}

export default OpenAIProvider;
