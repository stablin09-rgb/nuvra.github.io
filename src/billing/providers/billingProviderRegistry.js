'use strict';

/**
 * billingProviderRegistry.js — Nuvra Phase 7
 *
 * Central registry for billing providers. The rest of the system
 * calls the registry — never a specific provider directly.
 */

const { LocalBillingProvider } = require('./localBillingProvider');

class BillingProviderRegistry {
  constructor() {
    this._providers = new Map();
    this._activeId  = null;

    // Register the local provider by default
    const local = new LocalBillingProvider();
    this.register(local);
    this._activeId = local.id;
  }

  /**
   * Registers a billing provider.
   * @param {object} provider - Must implement BillingProviderContract
   */
  register(provider) {
    if (!provider.id || !provider.name) {
      throw new Error('[BillingProviderRegistry] Provider must have id and name');
    }
    this._providers.set(provider.id, provider);
  }

  /**
   * Sets the active billing provider.
   * @param {string} providerId
   */
  setActive(providerId) {
    if (!this._providers.has(providerId)) {
      throw new Error(`[BillingProviderRegistry] Unknown provider: "${providerId}"`);
    }
    this._activeId = providerId;
  }

  /**
   * Returns the active billing provider.
   * @returns {object}
   */
  getActive() {
    return this._providers.get(this._activeId);
  }

  /**
   * Returns a provider by ID.
   * @param {string} providerId
   * @returns {object|null}
   */
  get(providerId) {
    return this._providers.get(providerId) || null;
  }

  /**
   * Returns all registered provider IDs.
   * @returns {string[]}
   */
  listProviders() {
    return Array.from(this._providers.keys());
  }
}

export { BillingProviderRegistry };
export default BillingProviderRegistry;