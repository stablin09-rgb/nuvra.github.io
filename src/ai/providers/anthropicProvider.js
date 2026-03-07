/**
 * anthropicProvider.js — Nuvra Phase 5
 *
 * Anthropic Claude provider implementation.
 * Supports Claude 3.5 Sonnet, Claude 3 Haiku.
 *
 * @module ai/providers/anthropicProvider
 */
'use strict';

import { BaseProvider, ProviderCapability, ProviderErrorCode } from './providerContract.js';

export class AnthropicProvider extends BaseProvider {
  constructor(config = {}) {
    super({
      id:           'anthropic',
      label:        'Anthropic Claude',
      models:       ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307', 'claude-3-opus-20240229'],
      defaultModel: config.model || 'claude-3-5-sonnet-20241022',
      capabilities: [
        ProviderCapability.VISION,
        ProviderCapability.LONG_CONTEXT,
        ProviderCapability.FUNCTION_CALL,
      ],
      pricing: {
        // Claude 3.5 Sonnet pricing per 1M tokens (USD)
        input:  3.00,
        output: 15.00,
      },
      ...config,
    });

    this._apiKey  = config.apiKey || (typeof process !== 'undefined' ? process.env?.ANTHROPIC_API_KEY : null) || null;
    this._baseUrl = config.baseUrl || 'https://api.anthropic.com/v1';
    this._timeout = config.timeout || 60_000;
    this._version = '2023-06-01';
  }

  async _call(request) {
    if (!this._apiKey) {
      return {
        ok:        false,
        error:     'Anthropic API key not configured',
        errorCode: ProviderErrorCode.AUTH_FAILED,
        usage:     { input: 0, output: 0, total: 0 },
      };
    }

    const model = request.model || this.defaultModel;

    // Anthropic requires JSON output via system prompt instruction
    const systemPrompt = request.systemPrompt +
      '\n\nIMPORTANT: You MUST respond with valid JSON only. No prose, no markdown, no code fences. Start your response with { or [.';

    const body = {
      model,
      max_tokens:  request.maxTokens || 4096,
      temperature: request.temperature ?? 0,
      system:      systemPrompt,
      messages: [
        { role: 'user', content: request.userPrompt },
      ],
    };

    try {
      const resp = await _fetchWithTimeout(
        `${this._baseUrl}/messages`,
        {
          method:  'POST',
          headers: {
            'Content-Type':      'application/json',
            'x-api-key':         this._apiKey,
            'anthropic-version': this._version,
          },
          body: JSON.stringify(body),
        },
        this._timeout
      );

      const statusCode = resp.status;
      const json = await resp.json();

      if (!resp.ok) {
        const errMsg = json?.error?.message || `HTTP ${statusCode}`;
        const code   = _mapAnthropicError(statusCode, json?.error?.type);
        return {
          ok:        false,
          error:     errMsg,
          errorCode: code,
          usage:     { input: 0, output: 0, total: 0 },
        };
      }

      const rawText = json.content?.[0]?.text || '';
      const usage = {
        input:  json.usage?.input_tokens  || 0,
        output: json.usage?.output_tokens || 0,
        total:  (json.usage?.input_tokens || 0) + (json.usage?.output_tokens || 0),
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

function _mapAnthropicError(status, type) {
  if (status === 401)                          return ProviderErrorCode.AUTH_FAILED;
  if (status === 429)                          return ProviderErrorCode.RATE_LIMITED;
  if (type === 'invalid_request_error')        return ProviderErrorCode.CONTEXT_OVERFLOW;
  if (status >= 500)                           return ProviderErrorCode.PROVIDER_ERROR;
  return ProviderErrorCode.UNKNOWN;
}

export default AnthropicProvider;
