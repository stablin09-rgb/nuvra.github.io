/**
 * providerRegistry.js — Nuvra Phase 5
 *
 * Central registry for all AI providers.
 * Manages provider registration, selection, health, and fallback.
 *
 * The registry is the only place that knows which providers exist.
 * All other modules receive a provider instance — they never query the registry.
 *
 * @module ai/providers/providerRegistry
 */
'use strict';

import { ProviderErrorCode } from './providerContract.js';

// ─── ProviderRegistry ─────────────────────────────────────────────────────────
class ProviderRegistry {
  constructor() {
    this._providers  = new Map();  // id → BaseProvider
    this._activeId   = null;
    this._fallbackId = null;
    this._listeners  = [];
  }

  // ── Registration ────────────────────────────────────────────────────────────

  /**
   * Register a provider.
   * @param {BaseProvider} provider
   * @param {object} [options]
   * @param {boolean} [options.setActive=false]   - Make this the active provider
   * @param {boolean} [options.setFallback=false] - Make this the fallback provider
   * @returns {ProviderRegistry} (chainable)
   */
  register(provider, options = {}) {
    if (!provider?.id) throw new Error('ProviderRegistry: provider must have an id');

    this._providers.set(provider.id, provider);

    if (options.setActive || this._providers.size === 1) {
      this._activeId = provider.id;
    }
    if (options.setFallback) {
      this._fallbackId = provider.id;
    }

    this._emit('provider:registered', { providerId: provider.id });
    return this;
  }

  /**
   * Unregister a provider.
   * @param {string} providerId
   */
  unregister(providerId) {
    this._providers.delete(providerId);
    if (this._activeId   === providerId) this._activeId   = this._providers.keys().next().value || null;
    if (this._fallbackId === providerId) this._fallbackId = null;
    this._emit('provider:unregistered', { providerId });
  }

  // ── Selection ───────────────────────────────────────────────────────────────

  /**
   * Set the active provider.
   * @param {string} providerId
   */
  setActive(providerId) {
    if (!this._providers.has(providerId)) {
      throw new Error(`ProviderRegistry: unknown provider "${providerId}"`);
    }
    const prev = this._activeId;
    this._activeId = providerId;
    this._emit('provider:active_changed', { from: prev, to: providerId });
  }

  /**
   * Set the fallback provider (used when the active provider fails).
   * @param {string} providerId
   */
  setFallback(providerId) {
    if (!this._providers.has(providerId)) {
      throw new Error(`ProviderRegistry: unknown provider "${providerId}"`);
    }
    this._fallbackId = providerId;
  }

  // ── Access ──────────────────────────────────────────────────────────────────

  /**
   * Get the active provider.
   * @returns {BaseProvider}
   */
  getActive() {
    if (!this._activeId) throw new Error('ProviderRegistry: no active provider configured');
    return this._providers.get(this._activeId);
  }

  /**
   * Get the fallback provider (or null).
   * @returns {BaseProvider|null}
   */
  getFallback() {
    return this._fallbackId ? (this._providers.get(this._fallbackId) || null) : null;
  }

  /**
   * Get a specific provider by ID.
   * @param {string} providerId
   * @returns {BaseProvider}
   */
  get(providerId) {
    const p = this._providers.get(providerId);
    if (!p) throw new Error(`ProviderRegistry: unknown provider "${providerId}"`);
    return p;
  }

  /**
   * List all registered providers.
   * @returns {object[]} Array of provider summaries
   */
  list() {
    return Array.from(this._providers.values()).map(p => ({
      id:           p.id,
      label:        p.label,
      models:       p.models,
      defaultModel: p.defaultModel,
      capabilities: p.capabilities,
      pricing:      p.pricing,
      isActive:     p.id === this._activeId,
      isFallback:   p.id === this._fallbackId,
      health:       p.health(),
    }));
  }

  /**
   * Get the active provider ID.
   * @returns {string|null}
   */
  getActiveId() {
    return this._activeId;
  }

  // ── Call with Fallback ───────────────────────────────────────────────────────

  /**
   * Make a call using the active provider, falling back if it fails.
   * @param {object} request
   * @param {object} [options]
   * @param {boolean} [options.useFallback=true] - Whether to use fallback on failure
   * @returns {Promise<ProviderResponse>}
   */
  async call(request, options = {}) {
    const useFallback = options.useFallback !== false;
    const active = this.getActive();

    const response = await active.call(request);

    if (!response.ok && useFallback) {
      const fallback = this.getFallback();
      if (fallback && fallback.id !== active.id) {
        this._emit('provider:fallback_used', {
          primaryId:  active.id,
          fallbackId: fallback.id,
          reason:     response.errorCode,
        });
        const fallbackResponse = await fallback.call(request);
        fallbackResponse._usedFallback = true;
        fallbackResponse._primaryError = response.error;
        return fallbackResponse;
      }
    }

    return response;
  }

  // ── Events ──────────────────────────────────────────────────────────────────

  /**
   * Subscribe to registry events.
   * @param {Function} listener - (event, data) => void
   * @returns {Function} Unsubscribe function
   */
  subscribe(listener) {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter(l => l !== listener);
    };
  }

  _emit(event, data) {
    for (const listener of this._listeners) {
      try { listener(event, data); } catch (_) {}
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const providerRegistry = new ProviderRegistry();
export default providerRegistry;
