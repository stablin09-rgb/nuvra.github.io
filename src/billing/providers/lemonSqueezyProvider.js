'use strict';

/**
 * lemonSqueezyProvider.js — Nuvra Phase 7
 *
 * Lemon Squeezy billing provider adapter.
 * Popular with indie developers; handles tax, VAT, and global payments.
 */

const { BillingProviderContract } = require('./billingContract');

class LemonSqueezyProvider extends BillingProviderContract {
  /**
   * @param {object} options
   * @param {string} options.apiKey      - Lemon Squeezy API key
   * @param {string} options.storeId     - Lemon Squeezy store ID
   * @param {object} options.planMapping - { [lsVariantId]: nuvraPlanId }
   * @param {string} [options.webhookSecret]
   * @param {object} [options.logger]
   */
  constructor({ apiKey, storeId, planMapping = {}, webhookSecret = null, logger = null }) {
    super();
    this._apiKey        = apiKey;
    this._storeId       = storeId;
    this._planMapping   = planMapping;
    this._webhookSecret = webhookSecret;
    this._logger        = logger;

    this._reversePlanMapping = Object.fromEntries(
      Object.entries(planMapping).map(([k, v]) => [v, k])
    );
  }

  get id()   { return 'lemon_squeezy'; }
  get name() { return 'Lemon Squeezy'; }

  async ensureCustomer({ userId, email, displayName }) {
    // Lemon Squeezy creates customers automatically on checkout.
    // We store the user ID in the checkout metadata.
    return { ok: true, customerId: `ls_${userId}` };
  }

  async createCheckoutSession({ customerId, planId, successUrl, cancelUrl }) {
    try {
      const variantId = this._reversePlanMapping[planId];
      if (!variantId) {
        return { ok: false, error: `No Lemon Squeezy variant ID mapped for plan "${planId}"`, code: 'PLAN_NOT_MAPPED' };
      }

      const checkout = await this._request('POST', '/v1/checkouts', {
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: {
              custom: { nuvra_user_id: customerId.replace('ls_', ''), nuvra_plan_id: planId },
            },
            product_options: {
              redirect_url: successUrl,
            },
          },
          relationships: {
            store:   { data: { type: 'stores',   id: this._storeId } },
            variant: { data: { type: 'variants',  id: variantId    } },
          },
        },
      });

      return {
        ok:          true,
        checkoutUrl: checkout.data?.attributes?.url,
        sessionId:   checkout.data?.id,
      };
    } catch (err) {
      return { ok: false, error: err.message, code: 'LS_CHECKOUT_ERROR' };
    }
  }

  async createPortalSession({ customerId, returnUrl }) {
    // Lemon Squeezy provides a customer portal via the API
    return {
      ok:        true,
      portalUrl: `https://app.lemonsqueezy.com/my-orders`,
    };
  }

  async getSubscription(customerId) {
    try {
      const userId = customerId.replace('ls_', '');
      const result = await this._request('GET', `/v1/subscriptions?filter[store_id]=${this._storeId}&filter[user_email]=${userId}`);
      if (!result.data || result.data.length === 0) {
        return { ok: true, subscription: null };
      }
      const sub      = result.data[0];
      const variantId = sub.attributes?.variant_id?.toString();
      return {
        ok: true,
        subscription: {
          id:                 sub.id,
          status:             sub.attributes?.status,
          planId:             this._planMapping[variantId] || 'free',
          currentPeriodStart: sub.attributes?.billing_anchor,
          currentPeriodEnd:   sub.attributes?.renews_at,
          cancelAtPeriodEnd:  sub.attributes?.status === 'cancelled',
        },
      };
    } catch (err) {
      return { ok: false, error: err.message, code: 'LS_SUBSCRIPTION_ERROR' };
    }
  }

  async cancelSubscription(subscriptionId) {
    try {
      await this._request('DELETE', `/v1/subscriptions/${subscriptionId}`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message, code: 'LS_CANCEL_ERROR' };
    }
  }

  async processWebhook({ rawBody, signature, secret }) {
    try {
      const event = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
      return { ok: true, event };
    } catch (err) {
      return { ok: false, error: 'Invalid webhook payload', code: 'LS_WEBHOOK_ERROR' };
    }
  }

  getPlanMapping() { return { ...this._planMapping }; }

  async _request(method, path, body = null) {
    throw new Error('[LemonSqueezyProvider] _request is a stub. Configure a real Lemon Squeezy API key to use.');
  }
}

module.exports = { LemonSqueezyProvider };
