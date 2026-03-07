'use strict';

/**
 * localBillingProvider.js — Nuvra Phase 7
 *
 * A fully functional local billing provider for development and testing.
 * Simulates all billing operations without calling any external API.
 * Supports instant plan upgrades, downgrades, and cancellations.
 */


import { BillingProviderContract } from './billingContract.js';
class LocalBillingProvider extends BillingProviderContract {
  constructor() {
    super();
    this._customers      = new Map(); // userId → customer
    this._subscriptions  = new Map(); // customerId → subscription
    this._checkoutSessions = new Map();
  }

  get id()   { return 'local'; }
  get name() { return 'Local (Development)'; }

  async ensureCustomer({ userId, email, displayName }) {
    if (!this._customers.has(userId)) {
      const customerId = `local_cust_${userId}`;
      this._customers.set(userId, { id: customerId, userId, email, displayName });
      // Default to free plan
      this._subscriptions.set(customerId, {
        id:                 `local_sub_${userId}`,
        status:             'active',
        planId:             'free',
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd:   new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        cancelAtPeriodEnd:  false,
      });
    }
    return { ok: true, customerId: this._customers.get(userId).id };
  }

  async createCheckoutSession({ customerId, planId, successUrl, cancelUrl }) {
    const sessionId = `local_sess_${Date.now()}`;
    this._checkoutSessions.set(sessionId, { customerId, planId });
    // In local mode, immediately upgrade the plan
    const sub = this._subscriptions.get(customerId);
    if (sub) sub.planId = planId;
    return {
      ok:          true,
      checkoutUrl: `${successUrl}?session_id=${sessionId}&plan=${planId}`,
      sessionId,
    };
  }

  async createPortalSession({ customerId, returnUrl }) {
    return { ok: true, portalUrl: `${returnUrl}?portal=local&customer=${customerId}` };
  }

  async getSubscription(customerId) {
    const sub = this._subscriptions.get(customerId);
    return { ok: true, subscription: sub || null };
  }

  async cancelSubscription(subscriptionId) {
    for (const [, sub] of this._subscriptions) {
      if (sub.id === subscriptionId) {
        sub.cancelAtPeriodEnd = true;
        return { ok: true };
      }
    }
    return { ok: false, error: 'Subscription not found', code: 'NOT_FOUND' };
  }

  async processWebhook({ rawBody }) {
    const event = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    return { ok: true, event };
  }

  getPlanMapping() { return {}; }

  // ─── Test Helpers ─────────────────────────────────────────────────────────────

  /** Directly sets a user's plan (for testing). */
  setUserPlan(userId, planId) {
    const customer = this._customers.get(userId);
    if (!customer) return;
    const sub = this._subscriptions.get(customer.id);
    if (sub) sub.planId = planId;
  }

  /** Returns the current plan for a user (for testing). */
  getUserPlan(userId) {
    const customer = this._customers.get(userId);
    if (!customer) return null;
    return this._subscriptions.get(customer.id)?.planId || null;
  }
}

export { LocalBillingProvider };
export default LocalBillingProvider;