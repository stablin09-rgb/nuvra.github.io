/**
 * Nuvra Builder — Revenue Engine (Phase 11)
 *
 * The monetization backbone for the Nuvra marketplace.
 * Provider-agnostic: Stripe, Paddle, Lemon Squeezy, or custom.
 *
 * Supported monetization models:
 *  - free           — No charge
 *  - one-time       — Single purchase, perpetual license
 *  - subscription   — Recurring (monthly/annual), tied to user plan
 *  - usage-based    — Charged per AI token / API call consumed
 *  - revenue-share  — Creator earns % of revenue from stores built with their asset
 *
 * Revenue split (default):
 *  - Nuvra platform fee:  20%
 *  - Creator earnings:    80%
 *  - Adjustable per creator tier (verified creators: 85%)
 *
 * All transactions are recorded in an append-only ledger in localStorage,
 * synced to Supabase on auth.
 *
 * Fraud prevention hooks:
 *  - Velocity checks (too many installs in short time)
 *  - Duplicate purchase detection
 *  - Refund window enforcement (14 days)
 */
'use strict';

import { licenseEngine } from './licenseEngine.js';

const LEDGER_KEY     = (uid) => `nuvra-revenue-ledger-${uid || 'anon'}`;
const PURCHASE_KEY   = (uid) => `nuvra-purchases-${uid || 'anon'}`;
const VELOCITY_KEY   = (uid) => `nuvra-install-velocity-${uid || 'anon'}`;

const PLATFORM_FEE_RATE    = 0.20;
const CREATOR_RATE_DEFAULT = 0.80;
const CREATOR_RATE_VERIFIED = 0.85;
const REFUND_WINDOW_DAYS   = 14;

let _userId = null;

function _readLedger(uid) {
  try { return JSON.parse(localStorage.getItem(LEDGER_KEY(uid)) || '[]'); } catch { return []; }
}
function _appendLedger(uid, entry) {
  const ledger = _readLedger(uid);
  ledger.push(entry);
  try { localStorage.setItem(LEDGER_KEY(uid), JSON.stringify(ledger)); } catch {}
}
function _readPurchases(uid) {
  try { return JSON.parse(localStorage.getItem(PURCHASE_KEY(uid)) || '{}'); } catch { return {}; }
}
function _writePurchases(uid, data) {
  try { localStorage.setItem(PURCHASE_KEY(uid), JSON.stringify(data)); } catch {}
}

export const revenueEngine = {

  init(userId) {
    _userId = userId;
  },

  /**
   * Check if a user is entitled to install an asset based on their plan and purchases.
   * @param {CloudAsset} asset
   * @param {string|null} userId
   * @returns {{ allowed: boolean, message: string, requiredPlan?: string }}
   */
  async checkEntitlement(asset, userId) {
    const pricing = asset.pricing || { model: 'free' };
    const model   = pricing.model || 'free';

    if (model === 'free') {
      return { allowed: true, message: '' };
    }

    if (model === 'one-time') {
      const purchase = this.getPurchase(asset.assetId, userId);
      if (!purchase) {
        return {
          allowed:  false,
          message:  `"${asset.name}" requires a one-time purchase of ${pricing.currency || 'USD'} ${pricing.price || 0}.`,
          pricing,
        };
      }
      return { allowed: true, message: '' };
    }

    if (model === 'subscription') {
      // Check if user's plan includes this asset
      const requiredPlan = pricing.requiredPlan || 'pro';
      // In production, this would check the user's active subscription via billingState
      // For now, we check localStorage for a subscription record
      const sub = this._getSubscriptionRecord(userId);
      if (!sub || !this._planIncludes(sub.plan, requiredPlan)) {
        return {
          allowed:      false,
          message:      `"${asset.name}" requires the ${requiredPlan} plan or higher.`,
          requiredPlan,
          pricing,
        };
      }
      return { allowed: true, message: '' };
    }

    if (model === 'usage-based') {
      // Usage-based assets are always allowed to install; usage is metered at runtime
      return { allowed: true, message: '' };
    }

    if (model === 'revenue-share') {
      // Revenue-share assets are free to install; creator earns from store revenue
      return { allowed: true, message: '' };
    }

    return { allowed: true, message: '' };
  },

  /**
   * Record an asset install in the ledger.
   * @param {CloudAsset} asset
   * @param {string|null} userId
   * @param {{ version: string }} opts
   */
  async recordInstall(asset, userId, opts = {}) {
    const uid = userId || _userId;

    // Velocity check
    const velocityOk = this._checkVelocity(uid, asset.assetId);
    if (!velocityOk) {
      console.warn('[Revenue] Install velocity limit reached for', asset.assetId);
    }

    const entry = {
      type:      'install',
      assetId:   asset.assetId,
      assetName: asset.name,
      version:   opts.version || asset.latestVersion,
      userId:    uid,
      timestamp: new Date().toISOString(),
    };
    _appendLedger(uid, entry);
  },

  /**
   * Process a purchase for an asset.
   * Returns a purchase record and grants the license.
   * @param {CloudAsset} asset
   * @param {string} userId
   * @param {{ paymentProvider, paymentIntentId, amount, currency }} opts
   * @returns {Promise<PurchaseRecord>}
   */
  async processPurchase(asset, userId, opts = {}) {
    const uid = userId || _userId;

    // Duplicate purchase check
    const existing = this.getPurchase(asset.assetId, uid);
    if (existing) {
      return { success: false, message: 'Already purchased', purchase: existing };
    }

    const pricing   = asset.pricing || {};
    const amount    = opts.amount || pricing.price || 0;
    const currency  = opts.currency || pricing.currency || 'USD';
    const creatorRate = (asset.author?.verified) ? CREATOR_RATE_VERIFIED : CREATOR_RATE_DEFAULT;

    const purchase = {
      purchaseId:       `pur_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      assetId:          asset.assetId,
      assetName:        asset.name,
      userId:           uid,
      amount,
      currency,
      platformFee:      +(amount * PLATFORM_FEE_RATE).toFixed(2),
      creatorEarnings:  +(amount * creatorRate).toFixed(2),
      creatorId:        asset.author?.creatorId || null,
      paymentProvider:  opts.paymentProvider || 'stripe',
      paymentIntentId:  opts.paymentIntentId || null,
      purchasedAt:      new Date().toISOString(),
      refundableUntil:  new Date(Date.now() + REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      status:           'completed',
    };

    // Store purchase
    const purchases = _readPurchases(uid);
    purchases[asset.assetId] = purchase;
    _writePurchases(uid, purchases);

    // Append to ledger
    _appendLedger(uid, { type: 'purchase', ...purchase });

    // Grant license
    licenseEngine.grantLicense(asset.assetId, uid, {
      type:       'purchased',
      purchaseId: purchase.purchaseId,
    });

    return { success: true, purchase };
  },

  /**
   * Process a refund for an asset purchase.
   * @param {string} assetId
   * @param {string} userId
   * @returns {Promise<RefundResult>}
   */
  async processRefund(assetId, userId) {
    const uid      = userId || _userId;
    const purchase = this.getPurchase(assetId, uid);

    if (!purchase) {
      return { success: false, message: 'No purchase found' };
    }

    if (new Date() > new Date(purchase.refundableUntil)) {
      return { success: false, message: `Refund window expired (${REFUND_WINDOW_DAYS} days)` };
    }

    // Mark as refunded
    const purchases = _readPurchases(uid);
    purchases[assetId] = { ...purchase, status: 'refunded', refundedAt: new Date().toISOString() };
    _writePurchases(uid, purchases);

    // Append to ledger
    _appendLedger(uid, {
      type:       'refund',
      assetId,
      purchaseId: purchase.purchaseId,
      amount:     purchase.amount,
      currency:   purchase.currency,
      timestamp:  new Date().toISOString(),
    });

    // Revoke license
    licenseEngine.revokeLicense(assetId, uid);

    return { success: true, refundedAmount: purchase.amount, currency: purchase.currency };
  },

  /**
   * Record usage for a usage-based asset (e.g., AI pack tokens consumed).
   * @param {string} assetId
   * @param {string} userId
   * @param {{ units: number, unitType: string, projectId?: string }} opts
   */
  recordUsage(assetId, userId, opts = {}) {
    const uid = userId || _userId;
    _appendLedger(uid, {
      type:      'usage',
      assetId,
      userId:    uid,
      units:     opts.units || 1,
      unitType:  opts.unitType || 'call',
      projectId: opts.projectId || null,
      timestamp: new Date().toISOString(),
    });
  },

  /**
   * Get the full transaction ledger for a user.
   * @param {string|null} userId
   * @returns {LedgerEntry[]}
   */
  getLedger(userId) {
    return _readLedger(userId || _userId);
  },

  /**
   * Get a specific purchase record.
   */
  getPurchase(assetId, userId) {
    const purchases = _readPurchases(userId || _userId);
    const p = purchases[assetId];
    return (p && p.status !== 'refunded') ? p : null;
  },

  /**
   * Get all purchases for a user.
   */
  getAllPurchases(userId) {
    return Object.values(_readPurchases(userId || _userId));
  },

  /**
   * Get earnings summary for a creator (called from creatorDashboard).
   * @param {string} creatorId
   * @returns {EarningsSummary}
   */
  getCreatorEarnings(creatorId) {
    // In production, this would query the Supabase ledger.
    // For now, aggregate from the local ledger.
    const ledger = _readLedger(_userId);
    const purchases = ledger.filter(e => e.type === 'purchase' && e.creatorId === creatorId);
    const refunds   = ledger.filter(e => e.type === 'refund'   && e.creatorId === creatorId);

    const grossRevenue  = purchases.reduce((sum, e) => sum + (e.amount || 0), 0);
    const refundedAmount = refunds.reduce((sum, e) => sum + (e.amount || 0), 0);
    const netRevenue    = grossRevenue - refundedAmount;
    const earnings      = purchases.reduce((sum, e) => sum + (e.creatorEarnings || 0), 0);
    const platformFees  = purchases.reduce((sum, e) => sum + (e.platformFee || 0), 0);

    return {
      creatorId,
      grossRevenue:  +grossRevenue.toFixed(2),
      netRevenue:    +netRevenue.toFixed(2),
      earnings:      +earnings.toFixed(2),
      platformFees:  +platformFees.toFixed(2),
      totalSales:    purchases.length,
      totalRefunds:  refunds.length,
      currency:      'USD',
    };
  },

  /**
   * Calculate the revenue split for a given amount.
   * @param {number} amount
   * @param {boolean} verifiedCreator
   * @returns {{ platformFee: number, creatorEarnings: number }}
   */
  calculateSplit(amount, verifiedCreator = false) {
    const creatorRate = verifiedCreator ? CREATOR_RATE_VERIFIED : CREATOR_RATE_DEFAULT;
    return {
      platformFee:     +(amount * PLATFORM_FEE_RATE).toFixed(2),
      creatorEarnings: +(amount * creatorRate).toFixed(2),
      platformRate:    PLATFORM_FEE_RATE,
      creatorRate,
    };
  },

  // ─── Private Helpers ────────────────────────────────────────────────────────

  _getSubscriptionRecord(userId) {
    try {
      return JSON.parse(localStorage.getItem(`nuvra-subscription-${userId || _userId}`) || 'null');
    } catch { return null; }
  },

  _planIncludes(userPlan, requiredPlan) {
    const hierarchy = ['free', 'pro', 'team', 'enterprise'];
    const userIdx   = hierarchy.indexOf((userPlan || 'free').toLowerCase());
    const reqIdx    = hierarchy.indexOf((requiredPlan || 'free').toLowerCase());
    return userIdx >= reqIdx;
  },

  _checkVelocity(userId, assetId) {
    try {
      const key  = VELOCITY_KEY(userId);
      const data = JSON.parse(localStorage.getItem(key) || '{}');
      const now  = Date.now();
      const window = 60 * 1000; // 1 minute
      const limit  = 10;

      if (!data[assetId]) data[assetId] = [];
      data[assetId] = data[assetId].filter(t => now - t < window);
      data[assetId].push(now);
      localStorage.setItem(key, JSON.stringify(data));

      return data[assetId].length <= limit;
    } catch { return true; }
  },
};
