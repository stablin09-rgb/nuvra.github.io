/**
 * Nuvra Builder — Trust Engine (Phase 11)
 *
 * Security and governance layer for marketplace assets.
 *
 * Responsibilities:
 *  1. Asset signing     — Generate a deterministic signature for an asset bundle
 *  2. Integrity checks  — Verify that an installed asset matches its published signature
 *  3. Trust scoring     — Compute a trust score (0–100) for each asset
 *  4. Reputation system — Track creator reputation based on reviews, installs, and reports
 *  5. Abuse detection   — Flag suspicious patterns (rapid version bumps, obfuscated code, etc.)
 *
 * Trust Score components:
 *  - Creator verification status:    +30
 *  - Install count (log-scaled):      up to +20
 *  - Average rating (4.5+):           up to +15
 *  - Age of asset (months, log):      up to +10
 *  - Open source license:             +10
 *  - No security scan warnings:       +10
 *  - Abuse reports (per report):       -5
 *  - Rapid version bumps (>3/week):   -10
 *
 * Trust levels:
 *  0–39:   Unverified (show warning)
 *  40–59:  Basic (show neutral badge)
 *  60–79:  Trusted (show green badge)
 *  80–100: Verified (show shield badge)
 *
 * Signing algorithm:
 *  Uses a simple deterministic hash of: assetId + version + bundle + creatorId
 *  In production, this would use HMAC-SHA256 with a server-side secret.
 *  For the client-side implementation, we use a 64-character hex hash.
 */
'use strict';

const TRUST_STORE_KEY  = 'nuvra-trust-store';
const REPORTS_KEY      = 'nuvra-abuse-reports';
const SIGNATURES_KEY   = 'nuvra-asset-signatures';

function _read(key) { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } }
function _write(key, data) { try { localStorage.setItem(key, JSON.stringify(data)); } catch {} }

// Simple deterministic hash (not cryptographic — for client-side use only)
function _simpleHash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(16, '0');
}

function _hashAsset(asset) {
  const payload = [
    asset.assetId || '',
    asset.version || '',
    (asset.bundle || '').slice(0, 10000), // First 10KB for performance
    asset.creatorId || '',
  ].join('|');
  // Generate a 64-char hex signature by hashing in 4 chunks
  const chunks = [payload, payload + '1', payload + '2', payload + '3'];
  return chunks.map(_simpleHash).join('');
}

export const trustEngine = {

  /**
   * Sign an asset and store the signature.
   * @param {object} asset
   * @returns {{ signature: string, signedAt: string }}
   */
  async signAsset(asset) {
    const signature = _hashAsset(asset);
    const signedAt  = new Date().toISOString();

    const sigs = _read(SIGNATURES_KEY);
    sigs[asset.assetId] = { signature, signedAt, version: asset.version };
    _write(SIGNATURES_KEY, sigs);

    return { signature, signedAt };
  },

  /**
   * Verify that an installed asset matches its stored signature.
   * @param {object} asset - the installed asset (with bundle)
   * @returns {{ valid: boolean, message: string }}
   */
  async verifyIntegrity(asset) {
    const sigs = _read(SIGNATURES_KEY);
    const stored = sigs[asset.assetId];

    if (!stored) {
      return { valid: false, message: 'No signature found for this asset. It may not have been verified.' };
    }

    const current = _hashAsset(asset);
    if (current !== stored.signature) {
      return {
        valid:   false,
        message: `Integrity check failed for "${asset.name}". The asset may have been tampered with.`,
      };
    }

    return { valid: true, message: 'Integrity verified' };
  },

  /**
   * Compute the trust score for an asset.
   * @param {object} asset
   * @returns {{ score: number, level: string, badge: string, breakdown: object }}
   */
  computeTrustScore(asset) {
    let score = 0;
    const breakdown = {};

    // Creator verification
    if (asset.author?.verified) {
      score += 30;
      breakdown.creatorVerified = 30;
    }

    // Install count (log-scaled, max 20)
    const installs = asset.stats?.installs || 0;
    const installScore = Math.min(20, Math.floor(Math.log10(installs + 1) * 8));
    score += installScore;
    breakdown.installs = installScore;

    // Rating (4.5+ = full 15 points)
    const rating = asset.stats?.rating || 0;
    const ratingScore = Math.floor((rating / 5) * 15);
    score += ratingScore;
    breakdown.rating = ratingScore;

    // Asset age (months, log-scaled, max 10)
    const createdAt = asset.createdAt ? new Date(asset.createdAt) : new Date();
    const ageMonths = Math.max(0, (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30));
    const ageScore  = Math.min(10, Math.floor(Math.log2(ageMonths + 1) * 3));
    score += ageScore;
    breakdown.age = ageScore;

    // Open source license
    const openSourceLicenses = ['mit', 'apache-2.0', 'gpl', 'bsd', 'free'];
    if (openSourceLicenses.includes((asset.license?.type || '').toLowerCase())) {
      score += 10;
      breakdown.openSource = 10;
    }

    // No security warnings (from validation)
    if (asset.securityScanPassed) {
      score += 10;
      breakdown.securityScan = 10;
    }

    // Abuse reports
    const reports = this.getAbuseReports(asset.assetId);
    const reportPenalty = Math.min(25, reports.length * 5);
    score -= reportPenalty;
    breakdown.abuseReports = -reportPenalty;

    // Rapid version bumps (>3 versions in 7 days = suspicious)
    const recentVersions = (asset.versions || []).filter(v => {
      const d = new Date(v.publishedAt || 0);
      return (Date.now() - d.getTime()) < 7 * 24 * 60 * 60 * 1000;
    });
    if (recentVersions.length > 3) {
      score -= 10;
      breakdown.rapidVersionBumps = -10;
    }

    score = Math.max(0, Math.min(100, score));

    const level = score >= 80 ? 'verified'
                : score >= 60 ? 'trusted'
                : score >= 40 ? 'basic'
                : 'unverified';

    const badge = score >= 80 ? '🛡️ Verified'
                : score >= 60 ? '✓ Trusted'
                : score >= 40 ? '○ Basic'
                : '⚠ Unverified';

    // Cache the score
    const store = _read(TRUST_STORE_KEY);
    store[asset.assetId] = { score, level, badge, computedAt: new Date().toISOString() };
    _write(TRUST_STORE_KEY, store);

    return { score, level, badge, breakdown };
  },

  getTrustScore(assetId) {
    return _read(TRUST_STORE_KEY)[assetId] || null;
  },

  /**
   * Submit an abuse report for an asset.
   * @param {string} assetId
   * @param {string} reason - 'malware' | 'spam' | 'misleading' | 'copyright' | 'other'
   * @param {string} details
   */
  reportAbuse(assetId, reason, details = '') {
    const reports = _read(REPORTS_KEY);
    if (!reports[assetId]) reports[assetId] = [];
    reports[assetId].push({
      reason,
      details,
      reportedAt: new Date().toISOString(),
    });
    _write(REPORTS_KEY, reports);
  },

  getAbuseReports(assetId) {
    return _read(REPORTS_KEY)[assetId] || [];
  },

  /**
   * Check if an asset should be blocked based on abuse reports.
   * @param {string} assetId
   * @returns {boolean}
   */
  isBlocked(assetId) {
    const reports = this.getAbuseReports(assetId);
    // Block if 3+ malware reports or 5+ total reports
    const malwareReports = reports.filter(r => r.reason === 'malware').length;
    return malwareReports >= 3 || reports.length >= 5;
  },

  /**
   * Run a quick security scan on a bundle string.
   * Returns a list of findings.
   * @param {string} bundle
   * @returns {{ passed: boolean, findings: string[] }}
   */
  scanBundle(bundle) {
    const findings = [];

    const patterns = [
      { re: /\beval\s*\(/,                          severity: 'error',   msg: 'eval() usage detected' },
      { re: /new\s+Function\s*\(/,                  severity: 'error',   msg: 'new Function() usage detected' },
      { re: /document\.cookie/,                     severity: 'error',   msg: 'Cookie access detected' },
      { re: /window\.parent\s*\./,                  severity: 'error',   msg: 'window.parent access detected' },
      { re: /window\.top\s*\./,                     severity: 'error',   msg: 'window.top access detected' },
      { re: /atob\s*\(/,                            severity: 'warning', msg: 'Base64 decoding detected (possible obfuscation)' },
      { re: /String\.fromCharCode/,                 severity: 'warning', msg: 'String.fromCharCode detected (possible obfuscation)' },
      { re: /\\\x[0-9a-fA-F]{2}/,                  severity: 'warning', msg: 'Hex escape sequences detected (possible obfuscation)' },
      { re: /fetch\s*\(\s*['"`][^'"` ]+['"`]\s*\)/, severity: 'info',    msg: 'External fetch() call detected' },
    ];

    for (const { re, severity, msg } of patterns) {
      if (re.test(bundle)) findings.push({ severity, message: msg });
    }

    const errors = findings.filter(f => f.severity === 'error');
    return { passed: errors.length === 0, findings };
  },
};
