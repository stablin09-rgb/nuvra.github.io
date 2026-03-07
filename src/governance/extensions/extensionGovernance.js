'use strict';

/**
 * extensionGovernance.js — Nuvra Phase 8
 *
 * The Governance & Trust Model for extensions.
 *
 * Responsibilities:
 * - Security scanning: static analysis of extension manifests and code
 * - Review status management: pending, approved, rejected, suspended
 * - Runtime behavior logging: records all bridge calls for audit
 * - Admin controls: suspend, reinstate, force-uninstall, flag for review
 * - Threat detection: permission escalation attempts, anomalous network calls
 * - Compliance reporting: per-extension audit trail
 */

const { TrustTier, Permission } = require('../../extensions/manifest/extensionTypes');

// ─── Review Status ────────────────────────────────────────────────────────────

const ReviewStatus = Object.freeze({
  PENDING:   'pending',
  APPROVED:  'approved',
  REJECTED:  'rejected',
  SUSPENDED: 'suspended',
  FLAGGED:   'flagged',
});

// ─── Threat Levels ────────────────────────────────────────────────────────────

const ThreatLevel = Object.freeze({
  NONE:     'none',
  LOW:      'low',
  MEDIUM:   'medium',
  HIGH:     'high',
  CRITICAL: 'critical',
});

// ─── Security Scan Patterns ───────────────────────────────────────────────────

const DANGEROUS_PATTERNS = [
  { pattern: /eval\s*\(/g,                   threat: ThreatLevel.CRITICAL, reason: 'eval() usage detected' },
  { pattern: /new\s+Function\s*\(/g,         threat: ThreatLevel.CRITICAL, reason: 'new Function() usage detected' },
  { pattern: /process\.env/g,               threat: ThreatLevel.HIGH,     reason: 'process.env access detected' },
  { pattern: /require\s*\(\s*['"]child_process/g, threat: ThreatLevel.CRITICAL, reason: 'child_process require detected' },
  { pattern: /require\s*\(\s*['"]fs['"]/g,  threat: ThreatLevel.HIGH,     reason: 'fs module require detected' },
  { pattern: /require\s*\(\s*['"]net['"]/g, threat: ThreatLevel.HIGH,     reason: 'net module require detected' },
  { pattern: /document\.cookie/g,           threat: ThreatLevel.HIGH,     reason: 'document.cookie access detected' },
  { pattern: /localStorage\./g,             threat: ThreatLevel.MEDIUM,   reason: 'Direct localStorage access (use SDK storage API)' },
  { pattern: /sessionStorage\./g,           threat: ThreatLevel.MEDIUM,   reason: 'Direct sessionStorage access (use SDK storage API)' },
  { pattern: /XMLHttpRequest/g,             threat: ThreatLevel.MEDIUM,   reason: 'XMLHttpRequest usage (use SDK fetch API)' },
  { pattern: /fetch\s*\(/g,                 threat: ThreatLevel.MEDIUM,   reason: 'Direct fetch() usage (use SDK fetch API)' },
  { pattern: /window\.__nuvra/g,            threat: ThreatLevel.HIGH,     reason: 'Attempted access to Nuvra internal globals' },
  { pattern: /prototype\s*\[/g,             threat: ThreatLevel.HIGH,     reason: 'Prototype pollution pattern detected' },
  { pattern: /__proto__/g,                  threat: ThreatLevel.HIGH,     reason: '__proto__ manipulation detected' },
  { pattern: /constructor\s*\[/g,           threat: ThreatLevel.MEDIUM,   reason: 'Constructor property access detected' },
];

// High-risk permissions that require elevated review
const HIGH_RISK_PERMISSIONS = new Set([
  Permission.DATA_CREATE_COLLECTION,
  Permission.AI_REGISTER_PLANNER,
  Permission.AI_REGISTER_SCHEMA_MODIFIER,
  Permission.RUNTIME_PUBLISH_HOOK,
  Permission.RUNTIME_MOBILE_HOOK,
]);

// ─── ExtensionGovernance ──────────────────────────────────────────────────────

class ExtensionGovernance {
  /**
   * @param {object} [options]
   * @param {object} [options.logger]
   */
  constructor({ logger = null } = {}) {
    this._logger       = logger;
    this._reviews      = new Map(); // extensionId → ReviewRecord
    this._behaviorLogs = new Map(); // extensionId → BehaviorLogEntry[]
    this._adminActions = [];        // AdminActionRecord[]
  }

  // ─── Security Scanning ───────────────────────────────────────────────────

  /**
   * Scans an extension's source code for dangerous patterns.
   * @param {string} extensionId
   * @param {string} code - The extension's source code
   * @returns {{ threatLevel: string, findings: object[], safe: boolean }}
   */
  scanCode(extensionId, code) {
    const findings = [];
    let maxThreat  = ThreatLevel.NONE;

    for (const { pattern, threat, reason } of DANGEROUS_PATTERNS) {
      const matches = code.match(pattern);
      if (matches) {
        findings.push({
          pattern: pattern.toString(),
          threat,
          reason,
          occurrences: matches.length,
        });
        if (this._threatLevel(threat) > this._threatLevel(maxThreat)) {
          maxThreat = threat;
        }
      }
    }

    const safe = maxThreat === ThreatLevel.NONE || maxThreat === ThreatLevel.LOW;
    this._log('info', `Code scan for "${extensionId}": ${maxThreat} (${findings.length} findings)`);

    return { threatLevel: maxThreat, findings, safe };
  }

  /**
   * Scans a manifest for governance concerns.
   * @param {object} manifest
   * @returns {{ threatLevel: string, findings: object[] }}
   */
  scanManifest(manifest) {
    const findings = [];
    let maxThreat  = ThreatLevel.NONE;

    // Check for high-risk permissions
    const highRisk = (manifest.permissions || []).filter(p => HIGH_RISK_PERMISSIONS.has(p));
    if (highRisk.length > 0) {
      findings.push({
        type:    'high_risk_permissions',
        threat:  ThreatLevel.MEDIUM,
        reason:  `High-risk permissions declared: ${highRisk.join(', ')}`,
        details: highRisk,
      });
      maxThreat = ThreatLevel.MEDIUM;
    }

    // Check for excessive permissions (> 10)
    if ((manifest.permissions || []).length > 10) {
      findings.push({
        type:   'excessive_permissions',
        threat: ThreatLevel.LOW,
        reason: `Extension declares ${manifest.permissions.length} permissions. Consider reducing scope.`,
      });
    }

    // Check for network + storage + AI combination (potential data exfiltration)
    const hasNetwork = (manifest.permissions || []).includes(Permission.NETWORK_FETCH);
    const hasStorage = (manifest.permissions || []).includes(Permission.STORAGE_SCOPED);
    const hasAI      = (manifest.permissions || []).some(p => p.startsWith('ai:'));
    if (hasNetwork && hasStorage && hasAI) {
      findings.push({
        type:   'data_exfiltration_risk',
        threat: ThreatLevel.MEDIUM,
        reason: 'Extension combines network, storage, and AI permissions — potential data exfiltration risk',
      });
      if (this._threatLevel(ThreatLevel.MEDIUM) > this._threatLevel(maxThreat)) {
        maxThreat = ThreatLevel.MEDIUM;
      }
    }

    return { threatLevel: maxThreat, findings };
  }

  // ─── Review Management ────────────────────────────────────────────────────

  /**
   * Submits an extension for review.
   * @param {string} extensionId
   * @param {object} manifest
   * @param {string} [code]
   * @returns {{ ok: boolean, reviewId: string, threatLevel: string }}
   */
  submitForReview(extensionId, manifest, code = null) {
    const manifestScan = this.scanManifest(manifest);
    const codeScan     = code ? this.scanCode(extensionId, code) : null;

    const maxThreat = codeScan
      ? (this._threatLevel(codeScan.threatLevel) > this._threatLevel(manifestScan.threatLevel)
          ? codeScan.threatLevel : manifestScan.threatLevel)
      : manifestScan.threatLevel;

    const reviewId = `review_${extensionId}_${Date.now()}`;
    const review = {
      id:            reviewId,
      extensionId,
      status:        maxThreat === ThreatLevel.CRITICAL ? ReviewStatus.REJECTED : ReviewStatus.PENDING,
      threatLevel:   maxThreat,
      manifestScan,
      codeScan,
      submittedAt:   new Date().toISOString(),
      reviewedAt:    null,
      reviewedBy:    null,
      notes:         null,
    };

    // Auto-reject critical threats
    if (maxThreat === ThreatLevel.CRITICAL) {
      review.status     = ReviewStatus.REJECTED;
      review.reviewedAt = new Date().toISOString();
      review.reviewedBy = 'auto-scanner';
      review.notes      = 'Automatically rejected due to critical security findings';
    }

    this._reviews.set(extensionId, review);
    this._log('info', `Review submitted for "${extensionId}": ${review.status} (threat: ${maxThreat})`);

    return { ok: true, reviewId, threatLevel: maxThreat, status: review.status };
  }

  /**
   * Approves an extension review (admin action).
   * @param {string} extensionId
   * @param {string} reviewerId
   * @param {string} [notes]
   * @returns {{ ok: boolean, error?: string }}
   */
  approve(extensionId, reviewerId, notes = '') {
    const review = this._reviews.get(extensionId);
    if (!review) return { ok: false, error: `No review found for "${extensionId}"` };
    if (review.status === ReviewStatus.REJECTED) {
      return { ok: false, error: 'Cannot approve a rejected extension. Submit a new version.' };
    }
    review.status     = ReviewStatus.APPROVED;
    review.reviewedAt = new Date().toISOString();
    review.reviewedBy = reviewerId;
    review.notes      = notes;
    this._recordAdminAction('approve', extensionId, reviewerId, notes);
    this._log('info', `Extension approved: "${extensionId}" by ${reviewerId}`);
    return { ok: true };
  }

  /**
   * Rejects an extension review (admin action).
   */
  reject(extensionId, reviewerId, reason) {
    const review = this._reviews.get(extensionId);
    if (!review) return { ok: false, error: `No review found for "${extensionId}"` };
    review.status     = ReviewStatus.REJECTED;
    review.reviewedAt = new Date().toISOString();
    review.reviewedBy = reviewerId;
    review.notes      = reason;
    this._recordAdminAction('reject', extensionId, reviewerId, reason);
    this._log('info', `Extension rejected: "${extensionId}" by ${reviewerId}: ${reason}`);
    return { ok: true };
  }

  /**
   * Suspends a published extension (admin action — e.g., security incident).
   */
  suspend(extensionId, adminId, reason) {
    const review = this._reviews.get(extensionId);
    if (review) {
      review.status     = ReviewStatus.SUSPENDED;
      review.reviewedAt = new Date().toISOString();
      review.reviewedBy = adminId;
      review.notes      = reason;
    }
    this._recordAdminAction('suspend', extensionId, adminId, reason);
    this._log('warn', `Extension suspended: "${extensionId}" by ${adminId}: ${reason}`);
    return { ok: true };
  }

  /**
   * Reinstates a suspended extension.
   */
  reinstate(extensionId, adminId, notes = '') {
    const review = this._reviews.get(extensionId);
    if (review) {
      review.status     = ReviewStatus.APPROVED;
      review.reviewedAt = new Date().toISOString();
      review.reviewedBy = adminId;
      review.notes      = notes;
    }
    this._recordAdminAction('reinstate', extensionId, adminId, notes);
    this._log('info', `Extension reinstated: "${extensionId}" by ${adminId}`);
    return { ok: true };
  }

  // ─── Runtime Behavior Logging ─────────────────────────────────────────────

  /**
   * Logs a bridge call for audit purposes.
   * @param {string} extensionId
   * @param {string} method     - The bridge method called
   * @param {object} [meta]     - Additional metadata
   */
  logBridgeCall(extensionId, method, meta = {}) {
    if (!this._behaviorLogs.has(extensionId)) {
      this._behaviorLogs.set(extensionId, []);
    }
    const log = this._behaviorLogs.get(extensionId);
    log.push({
      method,
      meta,
      timestamp: new Date().toISOString(),
    });
    // Keep only the last 500 entries per extension
    if (log.length > 500) log.shift();
  }

  /**
   * Returns the behavior log for an extension.
   * @param {string} extensionId
   * @returns {object[]}
   */
  getBehaviorLog(extensionId) {
    return this._behaviorLogs.get(extensionId) || [];
  }

  // ─── Review Queries ───────────────────────────────────────────────────────

  getReview(extensionId) {
    return this._reviews.get(extensionId) ?? null;
  }

  isApproved(extensionId) {
    return this._reviews.get(extensionId)?.status === ReviewStatus.APPROVED;
  }

  isSuspended(extensionId) {
    return this._reviews.get(extensionId)?.status === ReviewStatus.SUSPENDED;
  }

  getPendingReviews() {
    return [...this._reviews.values()].filter(r => r.status === ReviewStatus.PENDING);
  }

  getAdminActions() {
    return [...this._adminActions];
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  _recordAdminAction(action, extensionId, adminId, notes) {
    this._adminActions.push({
      action,
      extensionId,
      adminId,
      notes,
      timestamp: new Date().toISOString(),
    });
  }

  _threatLevel(level) {
    const order = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
    return order[level] ?? 0;
  }

  _log(level, message) {
    if (this._logger) this._logger[level]?.(`[ExtensionGovernance] ${message}`);
  }
}

export { ExtensionGovernance, ReviewStatus, ThreatLevel };
export default ExtensionGovernance;
