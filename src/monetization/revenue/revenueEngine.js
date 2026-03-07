'use strict';

/**
 * revenueEngine.js — Nuvra Phase 8
 *
 * The Monetization & Revenue Sharing Engine.
 *
 * Responsibilities:
 * - Pricing model enforcement: free, paid (one-time), subscription, usage-based, enterprise
 * - Revenue split calculation: creator share vs. platform share
 * - License enforcement: single-user, multi-user, org, unlimited
 * - Purchase and subscription lifecycle
 * - Usage-based billing metering for extensions
 * - Revenue reporting for creators
 *
 * Revenue split model:
 *   - Verified extensions: 80% creator / 20% platform
 *   - Community extensions: 70% creator / 30% platform
 *   - Experimental extensions: not eligible for paid listing
 */

const { TrustTier } = require('../../extensions/manifest/extensionTypes');

// ─── Revenue Split Rates ──────────────────────────────────────────────────────

const REVENUE_SPLITS = Object.freeze({
  [TrustTier.VERIFIED]:     { creator: 0.80, platform: 0.20 },
  [TrustTier.COMMUNITY]:    { creator: 0.70, platform: 0.30 },
  [TrustTier.EXPERIMENTAL]: null, // Not eligible for paid listing
});

// ─── Pricing Models ───────────────────────────────────────────────────────────

const PricingModel = Object.freeze({
  FREE:         'free',
  PAID:         'paid',          // One-time purchase
  SUBSCRIPTION: 'subscription',  // Recurring monthly/annual
  USAGE_BASED:  'usage_based',   // Per-use metering
  ENTERPRISE:   'enterprise_only',
});

// ─── License Types ────────────────────────────────────────────────────────────

const LicenseType = Object.freeze({
  SINGLE_USER:  'single_user',
  MULTI_USER:   'multi_user',    // Up to N seats
  ORG:          'org',           // Entire organization
  UNLIMITED:    'unlimited',
});

// ─── Purchase Record ──────────────────────────────────────────────────────────

function makePurchaseRecord(data) {
  return {
    id:           data.id || `purchase_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    extensionId:  data.extensionId,
    userId:       data.userId,
    orgId:        data.orgId || null,
    pricingModel: data.pricingModel,
    licenseType:  data.licenseType || LicenseType.SINGLE_USER,
    seats:        data.seats       || 1,
    priceUSD:     data.priceUSD,
    creatorShare: data.creatorShare,
    platformShare:data.platformShare,
    currency:     data.currency    || 'USD',
    status:       data.status      || 'active', // active | cancelled | refunded | expired
    purchasedAt:  new Date().toISOString(),
    expiresAt:    data.expiresAt   || null,
    renewsAt:     data.renewsAt    || null,
    billingPeriod:data.billingPeriod || null, // 'monthly' | 'annual'
    usageThisPeriod: 0,
    usageLimit:   data.usageLimit  || null,
  };
}

// ─── RevenueEngine ────────────────────────────────────────────────────────────

class RevenueEngine {
  /**
   * @param {object} [options]
   * @param {object} [options.logger]
   */
  constructor({ logger = null } = {}) {
    this._logger    = logger;
    this._purchases = new Map(); // purchaseId → PurchaseRecord
    this._byUser    = new Map(); // userId → Set<purchaseId>
    this._byExt     = new Map(); // extensionId → Set<purchaseId>
    this._usageLogs = [];        // Usage metering entries
  }

  // ─── Revenue Split ────────────────────────────────────────────────────────

  /**
   * Calculates the revenue split for a given trust tier and price.
   * @param {string} trustTier
   * @param {number} priceUSD
   * @returns {{ creatorUSD: number, platformUSD: number, eligible: boolean }}
   */
  calculateSplit(trustTier, priceUSD) {
    const split = REVENUE_SPLITS[trustTier];
    if (!split) {
      return { creatorUSD: 0, platformUSD: 0, eligible: false };
    }
    const creatorUSD  = Math.round(priceUSD * split.creator  * 100) / 100;
    const platformUSD = Math.round(priceUSD * split.platform * 100) / 100;
    return { creatorUSD, platformUSD, eligible: true };
  }

  // ─── Purchase ─────────────────────────────────────────────────────────────

  /**
   * Records a new purchase.
   * @param {object} data
   * @returns {{ ok: boolean, purchase?: object, error?: string }}
   */
  purchase(data) {
    if (!data.extensionId || !data.userId || !data.pricingModel) {
      return { ok: false, error: 'Missing required fields: extensionId, userId, pricingModel' };
    }

    if (data.pricingModel === PricingModel.FREE) {
      return { ok: false, error: 'Free extensions do not require a purchase record' };
    }

    const { creatorUSD, platformUSD, eligible } = this.calculateSplit(
      data.trustTier || TrustTier.COMMUNITY,
      data.priceUSD || 0
    );

    if (!eligible) {
      return { ok: false, error: `Extensions with trust tier "${data.trustTier}" are not eligible for paid listing` };
    }

    const purchase = makePurchaseRecord({
      ...data,
      creatorShare:  creatorUSD,
      platformShare: platformUSD,
    });

    this._purchases.set(purchase.id, purchase);
    this._indexByUser(data.userId, purchase.id);
    this._indexByExt(data.extensionId, purchase.id);

    this._log('info', `Purchase recorded: ${purchase.id} (${data.extensionId} by ${data.userId})`);
    return { ok: true, purchase };
  }

  // ─── License Enforcement ─────────────────────────────────────────────────

  /**
   * Checks if a user has a valid license for an extension.
   * @param {string} userId
   * @param {string} extensionId
   * @param {object} [options]
   * @param {string} [options.orgId]  - For org licenses
   * @returns {{ licensed: boolean, reason?: string, purchase?: object }}
   */
  checkLicense(userId, extensionId, { orgId } = {}) {
    const purchaseIds = this._byExt.get(extensionId) || new Set();

    for (const pid of purchaseIds) {
      const p = this._purchases.get(pid);
      if (!p || p.status !== 'active') continue;

      // Check expiry
      if (p.expiresAt && new Date(p.expiresAt) < new Date()) continue;

      // Single-user license: must match userId
      if (p.licenseType === LicenseType.SINGLE_USER && p.userId === userId) {
        return { licensed: true, purchase: p };
      }

      // Org license: must match orgId
      if (p.licenseType === LicenseType.ORG && orgId && p.orgId === orgId) {
        return { licensed: true, purchase: p };
      }

      // Unlimited license
      if (p.licenseType === LicenseType.UNLIMITED) {
        return { licensed: true, purchase: p };
      }

      // Multi-user: check seat count (simplified — in production, track active seats)
      if (p.licenseType === LicenseType.MULTI_USER && p.userId === userId) {
        return { licensed: true, purchase: p };
      }
    }

    return { licensed: false, reason: 'No valid license found' };
  }

  // ─── Usage-Based Metering ─────────────────────────────────────────────────

  /**
   * Records usage for a usage-based extension.
   * @param {string} extensionId
   * @param {string} userId
   * @param {number} quantity
   * @param {object} [meta]
   */
  recordUsage(extensionId, userId, quantity, meta = {}) {
    const entry = {
      extensionId,
      userId,
      quantity,
      meta,
      recordedAt: new Date().toISOString(),
    };
    this._usageLogs.push(entry);

    // Update usage on the active purchase
    const purchaseIds = this._byExt.get(extensionId) || new Set();
    for (const pid of purchaseIds) {
      const p = this._purchases.get(pid);
      if (p && p.userId === userId && p.status === 'active' && p.pricingModel === PricingModel.USAGE_BASED) {
        p.usageThisPeriod += quantity;
      }
    }
  }

  /**
   * Returns usage for a user/extension pair in the current period.
   * @param {string} extensionId
   * @param {string} userId
   * @returns {number}
   */
  getUsageThisPeriod(extensionId, userId) {
    return this._usageLogs
      .filter(e => e.extensionId === extensionId && e.userId === userId)
      .reduce((sum, e) => sum + e.quantity, 0);
  }

  // ─── Cancellation / Refund ────────────────────────────────────────────────

  /**
   * Cancels a subscription or purchase.
   * @param {string} purchaseId
   * @param {string} reason - 'user_cancelled' | 'refund' | 'expired' | 'admin'
   * @returns {{ ok: boolean, error?: string }}
   */
  cancel(purchaseId, reason = 'user_cancelled') {
    const purchase = this._purchases.get(purchaseId);
    if (!purchase) return { ok: false, error: `Purchase "${purchaseId}" not found` };
    purchase.status    = reason === 'refund' ? 'refunded' : 'cancelled';
    purchase.cancelledAt = new Date().toISOString();
    purchase.cancelReason = reason;
    this._log('info', `Purchase cancelled: ${purchaseId} (${reason})`);
    return { ok: true };
  }

  // ─── Revenue Reporting ────────────────────────────────────────────────────

  /**
   * Returns a revenue report for a creator (by extensionId).
   * @param {string} extensionId
   * @returns {object}
   */
  getCreatorReport(extensionId) {
    const purchaseIds = this._byExt.get(extensionId) || new Set();
    const purchases   = [...purchaseIds].map(id => this._purchases.get(id)).filter(Boolean);

    const active    = purchases.filter(p => p.status === 'active');
    const refunded  = purchases.filter(p => p.status === 'refunded');
    const cancelled = purchases.filter(p => p.status === 'cancelled');

    const totalRevenue  = purchases.reduce((s, p) => s + (p.priceUSD || 0), 0);
    const creatorRevenue= purchases.reduce((s, p) => s + (p.creatorShare || 0), 0);
    const totalUsage    = this._usageLogs.filter(e => e.extensionId === extensionId)
                                          .reduce((s, e) => s + e.quantity, 0);

    return {
      extensionId,
      totalPurchases:  purchases.length,
      activeLicenses:  active.length,
      refunds:         refunded.length,
      cancellations:   cancelled.length,
      totalRevenueUSD: Math.round(totalRevenue  * 100) / 100,
      creatorShareUSD: Math.round(creatorRevenue * 100) / 100,
      totalUsage,
      generatedAt:     new Date().toISOString(),
    };
  }

  /**
   * Returns all purchases for a user.
   * @param {string} userId
   * @returns {object[]}
   */
  getUserPurchases(userId) {
    const ids = this._byUser.get(userId) || new Set();
    return [...ids].map(id => this._purchases.get(id)).filter(Boolean);
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  _indexByUser(userId, purchaseId) {
    if (!this._byUser.has(userId)) this._byUser.set(userId, new Set());
    this._byUser.get(userId).add(purchaseId);
  }

  _indexByExt(extensionId, purchaseId) {
    if (!this._byExt.has(extensionId)) this._byExt.set(extensionId, new Set());
    this._byExt.get(extensionId).add(purchaseId);
  }

  _log(level, message) {
    if (this._logger) this._logger[level]?.(`[RevenueEngine] ${message}`);
  }
}

module.exports = { RevenueEngine, PricingModel, LicenseType, REVENUE_SPLITS };
