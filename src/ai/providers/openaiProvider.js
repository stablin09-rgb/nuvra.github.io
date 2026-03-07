/**
 * Nuvra Builder — OpenAI Provider
 *
 * Implements the ProviderBase interface for the OpenAI API.
 *
 * Key features:
 *  - Uses response_format: { type: "json_object" } to enforce JSON output
 *  - Supports gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-3.5-turbo
 *  - Records token usage for the PromptBudget system
 *  - API key is stored in localStorage (never sent to any Nuvra server)
 */

'use strict';

import { ProviderBase } from '../providerBase.js';

export class OpenAIProvider extends ProviderBase {
  constructor(config = {}) {
    super(config);
    this._apiKey = config.apiKey || '';
    this._model  = config.model  || 'gpt-4o-mini';
  }

  get id()          { return 'openai'; }
  get displayName() { return 'OpenAI'; }
  get models() {
    return ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'];
  }

  setApiKey(key) { this._apiKey = key; }
  setModel(model) { this._model = model; }

  async _callAPI(messages, opts = {}) {
    if (!this._apiKey) {
      throw new Error('OpenAI API key is not set. Configure it in AI Settings.');
    }

    const model      = opts.model      || this._model;
    const maxTokens  = opts.maxTokens  || 4096;
    const temperature = opts.temperature || 0.7;

    const body = {
      model,
      messages,
      max_tokens:      maxTokens,
      temperature,
      response_format: { type: 'json_object' },
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${this._apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`OpenAI API error ${response.status}: ${err?.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || '';

    return {
      text,
      usage: {
        inputTokens:  data?.usage?.prompt_tokens     || 0,
        outputTokens: data?.usage?.completion_tokens || 0,
      },
    };
  }
}
