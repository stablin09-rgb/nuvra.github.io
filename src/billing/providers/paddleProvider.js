'use strict';

/**
 * paddleProvider.js — Nuvra Phase 7
 *
 * Paddle billing provider adapter (Paddle Billing v2 API).
 * Paddle handles VAT/tax automatically, making it ideal for EU/global SaaS.
 */

const { BillingProviderContract } = require('./billingContract');

class PaddleProvider extends BillingProviderContract {
  /**
   * @param {object} options
   * @param {string} options.apiKey       - Paddle API key
   * @param {string} options.vendorId     - Paddle vendor ID
   * @param {object} options.planMapping  - { [paddlePriceId]: nuvraPlanId }
   * @param {string} [options.webhookSecret]
   * @param {boolean} [options.sandbox]   - Use Paddle sandbox environment
   * @param {object} [options.logger]
   */
  constructor({ apiKey, vendorId, planMapping = {}, webhookSecret = null, sandbox = false, logger = null }) {
    super();
    this._apiKey         = apiKey;
    this._vendorId       = vendorId;
    this._planMapping    = planMapping;
    this._webhookSecret  = webhookSecret;
    this._sandbox        = sandbox;
    this._logger         = logger;
    this._baseUrl        = sandbox ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';

    this._reversePlanMapping = Object.fromEntries(
      Object.entries(planMapping).map(([k, v]) => [v, k])
    );
  }

  get id()   { return 'paddle'; }
  get name() { return 'Paddle'; }

  async ensureCustomer({ userId, email, displayName }) {
    try {
      // Paddle Billing v2: create or find customer
      const customer = await this._request('POST', '/customers', {
        email,
        name:           displayName,
        custom_data:    { nuvra_user_id: userId },
      });
      return { ok: true, customerId: customer.data.id };
    } catch (err) {
      return { ok: false, error: err.message, code: 'PADDLE_CUSTOMER_ERROR' };
    }
  }

  async createCheckoutSession({ customerId, planId, successUrl, cancelUrl }) {
    try {
      const priceId = this._reversePlanMapping[planId];
      if (!priceId) {
        return { ok: false, error: `No Paddle price ID mapped for plan "${planId}"`, code: 'PLAN_NOT_MAPPED' };
      }

      // Paddle Billing v2 uses client-side checkout with a transaction
      const transaction = await this._request('POST', '/transactions', {
        items:       [{ price_id: priceId, quantity: 1 }],
        customer_id: customerId,
        custom_data: { nuvra_plan_id: planId },
      });

      // Return the checkout URL (Paddle overlay or redirect)
      const checkoutUrl = `${this._baseUrl}/checkout/${transaction.data.id}?success_url=${encodeURIComponent(successUrl)}&cancel_url=${encodeURIComponent(cancelUrl)}`;
      return { ok: true, checkoutUrl, sessionId: transaction.data.id };
    } catch (err) {
      return { ok: false, error: err.message, code: 'PADDLE_CHECKOUT_ERROR' };
    }
  }

  async createPortalSession({ customerId, returnUrl }) {
    // Paddle does not have a hosted portal; return a link to the Paddle customer portal
    return {
      ok:        true,
      portalUrl: `https://vendors.paddle.com/subscriptions/customers/${customerId}`,
    };
  }

  async getSubscription(customerId) {
    try {
      const result = await this._request('GET', `/subscriptions?customer_id=${customerId}&status=active&per_page=1`);
      if (!result.data || result.data.length === 0) {
        return { ok: true, subscription: null };
      }
      const sub    = result.data[0];
      const priceId = sub.items?.[0]?.price?.id;
      return {
        ok: true,
        subscription: {
          id:                 sub.id,
          status:             sub.status,
          planId:             this._planMapping[priceId] || 'free',
          currentPeriodStart: sub.current_billing_period?.starts_at,
          currentPeriodEnd:   sub.current_billing_period?.ends_at,
          cancelAtPeriodEnd:  sub.scheduled_change?.action === 'cancel',
        },
      };
    } catch (err) {
      return { ok: false, error: err.message, code: 'PADDLE_SUBSCRIPTION_ERROR' };
    }
  }

  async cancelSubscription(subscriptionId) {
    try {
      await this._request('POST', `/subscriptions/${subscriptionId}/cancel`, {
        effective_from: 'next_billing_period',
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message, code: 'PADDLE_CANCEL_ERROR' };
    }
  }

  async processWebhook({ rawBody, signature, secret }) {
    try {
      const event = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
      return { ok: true, event };
    } catch (err) {
      return { ok: false, error: 'Invalid webhook payload', code: 'PADDLE_WEBHOOK_ERROR' };
    }
  }

  getPlanMapping() { return { ...this._planMapping }; }

  async _request(method, path, body = null) {
    // Architectural stub — configure a real Paddle API key to use.
    throw new Error('[PaddleProvider] _request is a stub. Configure a real Paddle API key to use.');
  }
}

module.exports = { PaddleProvider };
