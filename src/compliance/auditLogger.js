/**
 * Nuvra — auditLogger.js (Phase 15)
 *
 * Tamper-resistant, SHA-256 hash-chained audit log.
 * Every log entry includes a hash of the previous entry, forming
 * a chain that makes retroactive tampering detectable.
 *
 * Extends Phase 12 auditService.js with:
 *   - Compliance-specific event categories
 *   - Legal hold support
 *   - Configurable retention policies
 *   - CSV, JSON, and SIEM-format export
 *   - Explainable deny reasons
 *
 * @module compliance/auditLogger
 */
'use strict';

// ─── Event Categories ─────────────────────────────────────────────────────────
export const AUDIT_CATEGORIES = Object.freeze({
  AUTH:        'auth',
  DATA_ACCESS: 'data.access',
  DATA_WRITE:  'data.write',
  DATA_DELETE: 'data.delete',
  POLICY:      'policy',
  COMPLIANCE:  'compliance',
  PLUGIN:      'plugin',
  AGENT:       'agent',
  DEPLOY:      'deploy',
  BILLING:     'billing',
  ADMIN:       'admin',
  SECURITY:    'security',
});

// ─── Severity Levels ──────────────────────────────────────────────────────────
export const SEVERITY = Object.freeze({
  INFO:     'info',
  WARN:     'warn',
  ERROR:    'error',
  CRITICAL: 'critical',
});

// ─── Storage Keys ─────────────────────────────────────────────────────────────
const STORAGE_KEY_PREFIX = 'nuvra-audit-log-';
const LEGAL_HOLD_KEY     = 'nuvra-audit-legal-hold';
const MAX_LOCAL_ENTRIES  = 10_000;

// ─── Internal State ───────────────────────────────────────────────────────────
let _userId      = null;
let _projectId   = null;
let _prevHash    = '0000000000000000';
let _entries     = [];
let _legalHolds  = new Set();
let _cloudLogger = null; // Optional: async (entry) => void

// ─── Hash Computation ─────────────────────────────────────────────────────────
async function _computeHash(entry) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const content = JSON.stringify(entry);
    const encoder = new TextEncoder();
    const data    = encoder.encode(content);
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback: FNV-1a (dev only)
  const content = JSON.stringify(entry);
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16).padStart(16, '0');
}

// ─── Persistence ──────────────────────────────────────────────────────────────
function _storageKey() {
  return `${STORAGE_KEY_PREFIX}${_userId || 'anon'}`;
}

function _loadFromStorage() {
  try {
    const raw = localStorage.getItem(_storageKey());
    if (!raw) return;
    const data = JSON.parse(raw);
    _entries  = data.entries || [];
    _prevHash = data.prevHash || '0000000000000000';
    // Load legal holds
    const holdsRaw = localStorage.getItem(LEGAL_HOLD_KEY);
    if (holdsRaw) _legalHolds = new Set(JSON.parse(holdsRaw));
  } catch (_) {}
}

function _saveToStorage() {
  try {
    // Trim to max entries (keep newest), but never trim legal-held entries
    if (_entries.length > MAX_LOCAL_ENTRIES) {
      const held   = _entries.filter(e => _legalHolds.has(e.id));
      const unheld = _entries.filter(e => !_legalHolds.has(e.id));
      const keep   = unheld.slice(-MAX_LOCAL_ENTRIES + held.length);
      _entries = [...held, ...keep].sort((a, b) => a.timestamp - b.timestamp);
    }
    localStorage.setItem(_storageKey(), JSON.stringify({ entries: _entries, prevHash: _prevHash }));
  } catch (_) {}
}

// ─── Public API ───────────────────────────────────────────────────────────────
export const auditLogger = {
  /**
   * Initialize the audit logger.
   * @param {object} opts
   * @param {string} opts.userId
   * @param {string} [opts.projectId]
   * @param {function} [opts.cloudLogger] - async (entry) => void
   */
  init({ userId, projectId, cloudLogger } = {}) {
    _userId      = userId || 'anon';
    _projectId   = projectId || null;
    _cloudLogger = cloudLogger || null;
    _loadFromStorage();
  },

  /**
   * Log an audit event.
   * @param {object} opts
   * @param {string} opts.category - One of AUDIT_CATEGORIES
   * @param {string} opts.action   - Specific action (e.g., 'page.delete')
   * @param {string} opts.severity - One of SEVERITY
   * @param {object} [opts.actor]  - { id, type: 'user'|'agent'|'plugin', name }
   * @param {object} [opts.resource] - { type, id, name }
   * @param {object} [opts.outcome] - { success: boolean, reason?: string }
   * @param {object} [opts.metadata] - Additional context
   * @returns {Promise<object>} The logged entry
   */
  async log({ category, action, severity = SEVERITY.INFO, actor, resource, outcome, metadata } = {}) {
    const entryWithoutHash = {
      id:        `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      isoTime:   new Date().toISOString(),
      userId:    _userId,
      projectId: _projectId,
      category:  category || AUDIT_CATEGORIES.ADMIN,
      action:    action || 'unknown',
      severity:  severity || SEVERITY.INFO,
      actor:     actor || { id: _userId, type: 'user' },
      resource:  resource || null,
      outcome:   outcome || { success: true },
      metadata:  metadata || {},
      prevHash:  _prevHash,
    };

    const hash = await _computeHash(entryWithoutHash);
    const entry = { ...entryWithoutHash, hash };
    _prevHash = hash;

    _entries.push(entry);
    _saveToStorage();

    // Forward to cloud logger if configured
    if (_cloudLogger) {
      try { await _cloudLogger(entry); } catch (_) {}
    }

    return entry;
  },

  /**
   * Log a compliance violation.
   * @param {object} violation - From complianceEngine
   */
  async logViolation(violation) {
    return this.log({
      category: AUDIT_CATEGORIES.COMPLIANCE,
      action:   `compliance.violation.${violation.ruleId}`,
      severity: violation.severity === 'blocker' ? SEVERITY.CRITICAL : SEVERITY.WARN,
      resource: { type: 'compliance-rule', id: violation.ruleId, name: violation.description },
      outcome:  { success: false, reason: violation.description },
      metadata: { framework: violation.framework, remediation: violation.remediation },
    });
  },

  /**
   * Log a permission denial.
   * @param {object} permResult - From permissionModel.check()
   */
  async logDenial(permResult) {
    return this.log({
      category: AUDIT_CATEGORIES.SECURITY,
      action:   `permission.denied.${permResult.action}`,
      severity: SEVERITY.WARN,
      actor:    { id: _userId, type: permResult.actor },
      outcome:  { success: false, reason: permResult.reason },
      metadata: { denySource: permResult.denySource },
    });
  },

  /**
   * Place a legal hold on specific entries (prevents deletion/trimming).
   * @param {string[]} entryIds
   */
  setLegalHold(entryIds) {
    for (const id of entryIds) _legalHolds.add(id);
    try {
      localStorage.setItem(LEGAL_HOLD_KEY, JSON.stringify([..._legalHolds]));
    } catch (_) {}
  },

  /**
   * Release a legal hold.
   * @param {string[]} entryIds
   */
  releaseHold(entryIds) {
    for (const id of entryIds) _legalHolds.delete(id);
    try {
      localStorage.setItem(LEGAL_HOLD_KEY, JSON.stringify([..._legalHolds]));
    } catch (_) {}
  },

  /**
   * Query the audit log.
   * @param {object} filters
   * @param {string} [filters.category]
   * @param {string} [filters.severity]
   * @param {number} [filters.since] - Unix timestamp
   * @param {number} [filters.until] - Unix timestamp
   * @param {string} [filters.actorId]
   * @param {string} [filters.resourceId]
   * @param {number} [filters.limit]
   * @returns {object[]}
   */
  query({ category, severity, since, until, actorId, resourceId, limit } = {}) {
    let results = [..._entries];
    if (category)    results = results.filter(e => e.category === category);
    if (severity)    results = results.filter(e => e.severity === severity);
    if (since)       results = results.filter(e => e.timestamp >= since);
    if (until)       results = results.filter(e => e.timestamp <= until);
    if (actorId)     results = results.filter(e => e.actor?.id === actorId);
    if (resourceId)  results = results.filter(e => e.resource?.id === resourceId);
    results = results.sort((a, b) => b.timestamp - a.timestamp);
    if (limit)       results = results.slice(0, limit);
    return results;
  },

  /**
   * Verify the integrity of the audit log chain.
   * @returns {Promise<{ valid: boolean, brokenAt: string|null }>}
   */
  async verifyChain() {
    let prevHash = '0000000000000000';
    for (const entry of _entries) {
      const { hash, ...rest } = entry;
      const computed = await _computeHash({ ...rest, prevHash });
      if (computed !== hash) {
        return { valid: false, brokenAt: entry.id };
      }
      prevHash = hash;
    }
    return { valid: true, brokenAt: null };
  },

  /**
   * Export the audit log.
   * @param {'json'|'csv'|'siem'} format
   * @param {object} [filters] - Same as query()
   * @returns {string}
   */
  export(format = 'json', filters = {}) {
    const entries = this.query(filters);
    if (format === 'json') {
      return JSON.stringify({ exportedAt: new Date().toISOString(), count: entries.length, entries }, null, 2);
    }
    if (format === 'csv') {
      const headers = ['id', 'isoTime', 'category', 'action', 'severity', 'actorId', 'actorType', 'resourceId', 'success', 'reason', 'hash'];
      const rows    = entries.map(e => [
        e.id, e.isoTime, e.category, e.action, e.severity,
        e.actor?.id || '', e.actor?.type || '',
        e.resource?.id || '',
        e.outcome?.success ? 'true' : 'false',
        (e.outcome?.reason || '').replace(/,/g, ';'),
        e.hash,
      ].join(','));
      return [headers.join(','), ...rows].join('\n');
    }
    if (format === 'siem') {
      // CEF (Common Event Format) for SIEM ingestion
      return entries.map(e => {
        const sev = { info: 3, warn: 6, error: 8, critical: 10 }[e.severity] || 3;
        return `CEF:0|Nuvra|NuvraBuilder|1.0|${e.action}|${e.category}|${sev}|` +
          `rt=${e.timestamp} suser=${e.actor?.id || ''} act=${e.action} outcome=${e.outcome?.success ? 'success' : 'failure'} msg=${e.outcome?.reason || ''}`;
      }).join('\n');
    }
    return '';
  },

  /**
   * Get the total number of log entries.
   */
  count() {
    return _entries.length;
  },

  /**
   * Clear all non-held entries (respects legal holds).
   */
  clear() {
    _entries  = _entries.filter(e => _legalHolds.has(e.id));
    _prevHash = _entries.length > 0 ? _entries[_entries.length - 1].hash : '0000000000000000';
    _saveToStorage();
  },

  AUDIT_CATEGORIES,
  SEVERITY,
};
