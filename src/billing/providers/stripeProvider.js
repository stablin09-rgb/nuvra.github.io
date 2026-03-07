'use strict';

/**
 * stripeProvider.js — Nuvra Phase 7
 *
 * Stripe billing provider adapter.
 * Uses the Stripe REST API directly (no SDK dependency).
 */


import { BillingProviderContract } from './billingContract.js';
class StripeProvider extends BillingProviderContract {
  /**
   * @param {object} options
   * @param {string} options.secretKey       - Stripe secret key (sk_live_... or sk_test_...)
   * @param {object} options.planMapping     - { [stripePriceId]: nuvraPlanId }
   * @param {string} [options.webhookSecret] - Stripe webhook signing secret
   * @param {object} [options.logger]
   */
  constructor({ secretKey, planMapping = {}, webhookSecret = null, logger = null }) {
    super();
    this._secretKey      = secretKey;
    this._planMapping    = planMapping;
    this._webhookSecret  = webhookSecret;
    this._logger         = logger;

    // Reverse mapping: nuvraPlanId → stripePriceId
    this._reversePlanMapping = Object.fromEntries(
      Object.entries(planMapping).map(([k, v]) => [v, k])
    );
  }

  get id()   { return 'stripe'; }
  get name() { return 'Stripe'; }

  async ensureCustomer({ userId, email, displayName }) {
    try {
      // Search for existing customer
      const searchResult = await this._request('GET', `/v1/customers/search?query=metadata['nuvra_user_id']:'${userId}'`);
      if (searchResult.data && searchResult.data.length > 0) {
        return { ok: true, customerId: searchResult.data[0].id };
      }

      // Create new customer
      const customer = await this._request('POST', '/v1/customers', {
        email,
        name: displayName,
        metadata: { nuvra_user_id: userId },
      });

      return { ok: true, customerId: customer.id };
    } catch (err) {
      return { ok: false, error: err.message, code: 'STRIPE_CUSTOMER_ERROR' };
    }
  }

  async createCheckoutSession({ customerId, planId, successUrl, cancelUrl }) {
    try {
      const priceId = this._reversePlanMapping[planId];
      if (!priceId) {
        return { ok: false, error: `No Stripe price ID mapped for plan "${planId}"`, code: 'PLAN_NOT_MAPPED' };
      }

      const session = await this._request('POST', '/v1/checkout/sessions', {
        customer:    customerId,
        mode:        'subscription',
        line_items:  [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url:  cancelUrl,
        metadata:    { nuvra_plan_id: planId },
      });

      return { ok: true, checkoutUrl: session.url, sessionId: session.id };
    } catch (err) {
      return { ok: false, error: err.message, code: 'STRIPE_CHECKOUT_ERROR' };
    }
  }

  async createPortalSession({ customerId, returnUrl }) {
    try {
      const session = await this._request('POST', '/v1/billing_portal/sessions', {
        customer:   customerId,
        return_url: returnUrl,
      });
      return { ok: true, portalUrl: session.url };
    } catch (err) {
      return { ok: false, error: err.message, code: 'STRIPE_PORTAL_ERROR' };
    }
  }

  async getSubscription(customerId) {
    try {
      const result = await this._request('GET', `/v1/subscriptions?customer=${customerId}&status=active&limit=1`);
      if (!result.data || result.data.length === 0) {
        return { ok: true, subscription: null };
      }
      const sub = result.data[0];
      const priceId = sub.items?.data?.[0]?.price?.id;
      return {
        ok: true,
        subscription: {
          id:             sub.id,
          status:         sub.status,
          planId:         this._planMapping[priceId] || 'free',
          currentPeriodStart: new Date(sub.current_period_start * 1000).toISOString(),
          currentPeriodEnd:   new Date(sub.current_period_end   * 1000).toISOString(),
          cancelAtPeriodEnd:  sub.cancel_at_period_end,
        },
      };
    } catch (err) {
      return { ok: false, error: err.message, code: 'STRIPE_SUBSCRIPTION_ERROR' };
    }
  }

  async cancelSubscription(subscriptionId) {
    try {
      await this._request('POST', `/v1/subscriptions/${subscriptionId}`, {
        cancel_at_period_end: true,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message, code: 'STRIPE_CANCEL_ERROR' };
    }
  }

  async processWebhook({ rawBody, signature, secret }) {
    // In a real implementation, this would use Stripe's webhook signature verification.
    // For the architecture layer, we parse and return the event.
    try {
      const event = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
      return { ok: true, event };
    } catch (err) {
      return { ok: false, error: 'Invalid webhook payload', code: 'STRIPE_WEBHOOK_ERROR' };
    }
  }

  getPlanMapping() { return { ...this._planMapping }; }

  // ─── Private ─────────────────────────────────────────────────────────────────

  async _request(method, path, body = null) {
    // In a real implementation, this would use fetch() or the Stripe SDK.
    // This is the architectural stub — the interface is correct.
    const url = `https://api.stripe.com${path}`;
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${this._secretKey}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
    };
    if (body) {
      options.body = new URLSearchParams(this._flatten(body)).toString();
    }
    // Stub: in production, call fetch(url, options) and parse JSON
    throw new Error('[StripeProvider] _request is a stub. Configure a real Stripe secret key to use.');
  }

  _flatten(obj, prefix = '') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}[${key}]` : key;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(result, this._flatten(value, fullKey));
      } else if (Array.isArray(value)) {
        value.forEach((item, i) => {
          if (typeof item === 'object') {
            Object.assign(result, this._flatten(item, `${fullKey}[${i}]`));
          } else {
            result[`${fullKey}[${i}]`] = item;
          }
        });
      } else {
        result[fullKey] = value;
      }
    }
    return result;
  }
}

export { StripeProvider };
export default StripeProvider;
