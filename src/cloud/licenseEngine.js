/**
 * Nuvra Builder — License Engine (Phase 11)
 *
 * Validates and enforces asset licenses.
 * Supports: Free, Commercial, Subscription, Per-Project, Enterprise.
 *
 * License types:
 *  - 'free'         — No restrictions. Free to use in any project.
 *  - 'mit'          — Open source, attribution required.
 *  - 'commercial'   — Requires a valid purchase or active subscription.
 *  - 'per-project'  — License is tied to a specific project.
 *  - 'subscription' — Requires an active subscription (checked periodically).
 *  - 'enterprise'   — Requires an enterprise plan.
 *  - 'trial'        — Free for N days, then requires purchase.
 *
 * License records are stored in localStorage and synced to cloud on auth.
 */
'use strict';

const LICENSE_STORE_KEY = (uid) => `nuvra-licenses-${uid || 'anon'}`;

let _userId = null;

function _read(uid) {
  try { return JSON.parse(localStorage.getItem(LICENSE_STORE_KEY(uid)) || '{}'); } catch { return {}; }
}
function _write(uid, data) {
  try { localStorage.setItem(LICENSE_STORE_KEY(uid), JSON.stringify(data)); } catch {}
}

export const licenseEngine = {

  init(userId) {
    _userId = userId;
  },

  /**
   * Check if a user has access to an asset based on its license.
   * @param {CloudAsset} asset
   * @param {string|null} userId
   * @returns {{ allowed: boolean, message: string, licenseType: string }}
   */
  async checkAccess(asset, userId) {
    const license = asset.license || { type: 'free' };
    const type    = (license.type || 'free').toLowerCase();

    switch (type) {
      case 'free':
      case 'mit':
      case 'apache-2.0':
      case 'gpl':
        return { allowed: true, message: '', licenseType: type };

      case 'commercial':
      case 'per-project':
      case 'subscription': {
        const record = this.getLicenseRecord(asset.assetId, userId);
        if (!record) {
          return {
            allowed:     false,
            message:     `This asset requires a license. ${license.price ? `Price: ${license.currency || 'USD'} ${license.price}` : 'Purchase required.'}`,
            licenseType: type,
          };
        }
        if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
          return {
            allowed:     false,
            message:     `Your license for "${asset.name}" has expired. Please renew.`,
            licenseType: type,
          };
        }
        if (type === 'per-project' && record.projectId && record.projectId !== _userId) {
          return {
            allowed:     false,
            message:     `This license is tied to a different project.`,
            licenseType: type,
          };
        }
        return { allowed: true, message: '', licenseType: type };
      }

      case 'trial': {
        const record = this.getLicenseRecord(asset.assetId, userId);
        if (record && record.type === 'purchased') {
          return { allowed: true, message: '', licenseType: 'purchased' };
        }
        const trialRecord = this.getTrialRecord(asset.assetId, userId);
        if (!trialRecord) {
          // Start trial
          this.startTrial(asset.assetId, userId, license.trialDays || 14);
          return { allowed: true, message: `Trial started. ${license.trialDays || 14} days remaining.`, licenseType: 'trial' };
        }
        const daysLeft = Math.ceil((new Date(trialRecord.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
        if (daysLeft <= 0) {
          return {
            allowed:     false,
            message:     `Your trial for "${asset.name}" has expired. Purchase to continue.`,
            licenseType: 'trial-expired',
          };
        }
        return { allowed: true, message: `Trial: ${daysLeft} days remaining.`, licenseType: 'trial' };
      }

      case 'enterprise':
        // Would check against the user's plan in production
        return { allowed: false, message: 'This asset requires an Enterprise plan.', licenseType: 'enterprise' };

      default:
        return { allowed: true, message: '', licenseType: type };
    }
  },

  /**
   * Grant a license to a user for an asset (called after successful purchase).
   * @param {string} assetId
   * @param {string} userId
   * @param {{ type, expiresAt?, projectId?, purchaseId? }} opts
   */
  grantLicense(assetId, userId, opts = {}) {
    const store = _read(userId);
    store[assetId] = {
      assetId,
      userId,
      type:       opts.type || 'purchased',
      grantedAt:  new Date().toISOString(),
      expiresAt:  opts.expiresAt || null,
      projectId:  opts.projectId || null,
      purchaseId: opts.purchaseId || null,
    };
    _write(userId, store);
  },

  /**
   * Revoke a license (e.g., after refund or subscription cancellation).
   */
  revokeLicense(assetId, userId) {
    const store = _read(userId);
    delete store[assetId];
    _write(userId, store);
  },

  getLicenseRecord(assetId, userId) {
    const store = _read(userId || _userId);
    return store[assetId] || null;
  },

  startTrial(assetId, userId, days = 14) {
    const store = _read(userId || _userId);
    const trialKey = `trial-${assetId}`;
    store[trialKey] = {
      assetId,
      startedAt:  new Date().toISOString(),
      expiresAt:  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
    };
    _write(userId || _userId, store);
  },

  getTrialRecord(assetId, userId) {
    const store = _read(userId || _userId);
    return store[`trial-${assetId}`] || null;
  },

  /**
   * Get all licenses for a user (for the creator dashboard / account page).
   */
  getAllLicenses(userId) {
    return Object.values(_read(userId || _userId))
      .filter(r => !r.assetId?.startsWith('trial-'));
  },

  /**
   * Generate a human-readable license summary for display.
   */
  getLicenseSummary(asset) {
    const license = asset.license || { type: 'free' };
    const type    = (license.type || 'free').toLowerCase();
    const map = {
      'free':         'Free — no restrictions',
      'mit':          'MIT License — open source, attribution required',
      'apache-2.0':   'Apache 2.0 — open source',
      'gpl':          'GPL — open source, copyleft',
      'commercial':   `Commercial — one-time purchase${license.price ? ` ($${license.price})` : ''}`,
      'per-project':  'Per-Project License',
      'subscription': 'Subscription required',
      'trial':        `Free trial (${license.trialDays || 14} days), then purchase required`,
      'enterprise':   'Enterprise license required',
    };
    return map[type] || `License: ${type}`;
  },
};
