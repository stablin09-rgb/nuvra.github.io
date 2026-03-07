'use strict';

/**
 * billingContract.js — Nuvra Phase 7
 *
 * The canonical interface every billing provider must implement.
 * Billing providers are plugins, not dependencies.
 *
 * All methods return a standard result object:
 *   { ok: boolean, data?: any, error?: string, code?: string }
 */

class BillingProviderContract {
  get id()   { throw new Error('BillingProvider must implement id getter'); }
  get name() { throw new Error('BillingProvider must implement name getter'); }

  /**
   * Creates or retrieves a customer record for a user.
   * @param {object} params - { userId, email, displayName }
   * @returns {Promise<{ ok: boolean, customerId?: string, error?: string }>}
   */
  async ensureCustomer(params) { throw new Error('Not implemented'); }

  /**
   * Creates a checkout session for a plan upgrade.
   * @param {object} params - { customerId, planId, successUrl, cancelUrl }
   * @returns {Promise<{ ok: boolean, checkoutUrl?: string, sessionId?: string, error?: string }>}
   */
  async createCheckoutSession(params) { throw new Error('Not implemented'); }

  /**
   * Creates a customer portal session for managing billing.
   * @param {object} params - { customerId, returnUrl }
   * @returns {Promise<{ ok: boolean, portalUrl?: string, error?: string }>}
   */
  async createPortalSession(params) { throw new Error('Not implemented'); }

  /**
   * Retrieves the current subscription for a customer.
   * @param {string} customerId
   * @returns {Promise<{ ok: boolean, subscription?: object, error?: string }>}
   */
  async getSubscription(customerId) { throw new Error('Not implemented'); }

  /**
   * Cancels a subscription (at period end).
   * @param {string} subscriptionId
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  async cancelSubscription(subscriptionId) { throw new Error('Not implemented'); }

  /**
   * Processes a webhook event from the billing provider.
   * @param {object} params - { rawBody, signature, secret }
   * @returns {Promise<{ ok: boolean, event?: object, error?: string }>}
   */
  async processWebhook(params) { throw new Error('Not implemented'); }

  /**
   * Returns the plan ID mapping from provider-specific plan IDs to Nuvra plan IDs.
   * @returns {object} { [providerPlanId]: nuvraPlanId }
   */
  getPlanMapping() { throw new Error('Not implemented'); }
}

module.exports = { BillingProviderContract };
