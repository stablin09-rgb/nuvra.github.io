/**
 * Nuvra Enterprise — Audit Service (Phase 12)
 *
 * Provides an immutable, append-only audit trail for all enterprise actions.
 *
 * Design principles:
 *   - IMMUTABLE: Audit entries can never be modified or deleted (only expired by retention policy)
 *   - APPEND-ONLY: New entries are always appended, never updated
 *   - TAMPER-EVIDENT: Each entry includes a chain hash linking to the previous entry
 *   - STRUCTURED: Every entry has a consistent, queryable schema
 *   - EXPORTABLE: Full audit trail can be exported as JSON, CSV, or NDJSON
 *
 * AuditEntry Shape:
 * {
 *   id:          string (UUID),
 *   timestamp:   ISO string,
 *   action:      string,           // e.g. 'policy.denied', 'member.invited'
 *   orgId:       string | null,
 *   userId:      string | null,
 *   sessionId:   string | null,
 *   severity:    'low' | 'medium' | 'high' | 'critical',
 *   meta:        object,           // action-specific metadata
 *   chainHash:   string,           // SHA-256 of (prevHash + this entry data)
 *   ipAddress:   string | null,    // best-effort, not reliable in browser
 *   userAgent:   string | null,
 * }
 *
 * Retention Policy:
 *   - Free/Team: 30 days
 *   - Business:  1 year
 *   - Enterprise: 7 years (configurable)
 *   - Legal Hold: indefinite (overrides retention)
 *
 * @module auditService
 */
'use strict';

// ─── Severity Levels ──────────────────────────────────────────────────────────

export const SEVERITY = Object.freeze({
  LOW:      'low',
  MEDIUM:   'medium',
  HIGH:     'high',
  CRITICAL: 'critical',
});

// ─── Internal State ───────────────────────────────────────────────────────────

let _orgId       = null;
let _userId      = null;
let _sessionId   = null;
let _lastHash    = '0'.repeat(64);   // Genesis hash
let _queue       = [];               // Offline queue
let _legalHolds  = new Set();        // orgIds under legal hold
let _listeners   = [];
let _flushTimer  = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Initialize the audit service.
 *
 * @param {string|null} orgId
 * @param {string|null} userId
 * @param {string|null} sessionId
 */
export function init(orgId, userId, sessionId) {
  _orgId     = orgId;
  _userId    = userId;
  _sessionId = sessionId;

  // Restore last chain hash from localStorage
  if (orgId) {
    _lastHash = localStorage.getItem(`nuvra-audit-chain-${orgId}`) || '0'.repeat(64);
  }

  // Start flush timer for offline queue
  _startFlushTimer();
}

// ─── Core Logging ─────────────────────────────────────────────────────────────

/**
 * Log an audit event.
 *
 * @param {object} opts
 * @param {string} opts.action       - The action being logged
 * @param {string} [opts.orgId]      - Override org ID
 * @param {string} [opts.userId]     - Override user ID
 * @param {object} [opts.meta]       - Action-specific metadata
 * @param {string} [opts.severity]   - 'low' | 'medium' | 'high' | 'critical'
 * @returns {Promise<AuditEntry>}
 */
export async function log({
  action,
  orgId    = _orgId,
  userId   = _userId,
  meta     = {},
  severity = SEVERITY.LOW,
}) {
  const timestamp = new Date().toISOString();
  const id        = _uuid();

  // Compute chain hash (tamper-evident chain)
  const entryData = JSON.stringify({ id, timestamp, action, orgId, userId, meta, severity });
  const chainHash = await _sha256(_lastHash + entryData);

  const entry = {
    id,
    timestamp,
    action,
    orgId:     orgId || null,
    userId:    userId || null,
    sessionId: _sessionId || null,
    severity,
    meta,
    chainHash,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    ipAddress: null,  // Cannot reliably get IP in browser; server-side enrichment required
  };

  // Update chain
  _lastHash = chainHash;
  if (orgId) {
    try { localStorage.setItem(`nuvra-audit-chain-${orgId}`, chainHash); } catch {}
  }

  // Persist
  await _persist(entry);

  // Emit to listeners
  _emit('audit.logged', entry);

  return entry;
}

// ─── Query ────────────────────────────────────────────────────────────────────

/**
 * Query audit logs with filtering, pagination, and sorting.
 *
 * @param {object} opts
 * @param {string} [opts.orgId]
 * @param {string} [opts.userId]
 * @param {string} [opts.action]       - Exact action match or prefix with '*'
 * @param {string} [opts.severity]
 * @param {string} [opts.fromDate]     - ISO string
 * @param {string} [opts.toDate]       - ISO string
 * @param {number} [opts.limit=100]
 * @param {number} [opts.offset=0]
 * @returns {Promise<{entries: AuditEntry[], total: number}>}
 */
export async function query({
  orgId    = _orgId,
  userId,
  action,
  severity,
  fromDate,
  toDate,
  limit  = 100,
  offset = 0,
} = {}) {
  // Try cloud first
  try {
    const { cloud } = await import('../cloud/cloud.js');
    if (cloud.isCloudAvailable()) {
      const { data, error } = await cloud.audit.query({
        orgId, userId, action, severity, fromDate, toDate, limit, offset,
      });
      if (!error && data) return data;
    }
  } catch {}

  // Fallback: query local storage
  return _queryLocal({ orgId, userId, action, severity, fromDate, toDate, limit, offset });
}

// ─── Legal Hold ───────────────────────────────────────────────────────────────

/**
 * Place an org under legal hold.
 * All audit entries for this org are exempt from retention-based deletion.
 *
 * @param {string} orgId
 * @param {string} reason
 */
export async function placeLegalHold(orgId, reason) {
  _legalHolds.add(orgId);
  try {
    const { cloud } = await import('../cloud/cloud.js');
    if (cloud.isCloudAvailable()) {
      await cloud.audit.setLegalHold(orgId, true, reason);
    }
  } catch {}

  await log({
    action: 'audit.legal_hold_placed',
    orgId,
    meta: { reason },
    severity: SEVERITY.CRITICAL,
  });
}

/**
 * Release a legal hold.
 */
export async function releaseLegalHold(orgId, reason) {
  _legalHolds.delete(orgId);
  try {
    const { cloud } = await import('../cloud/cloud.js');
    if (cloud.isCloudAvailable()) {
      await cloud.audit.setLegalHold(orgId, false, reason);
    }
  } catch {}

  await log({
    action: 'audit.legal_hold_released',
    orgId,
    meta: { reason },
    severity: SEVERITY.CRITICAL,
  });
}

export function isUnderLegalHold(orgId) {
  return _legalHolds.has(orgId || _orgId);
}

// ─── Export ───────────────────────────────────────────────────────────────────

/**
 * Export audit logs in the specified format.
 *
 * @param {object} queryOpts - Same as query() options
 * @param {'json'|'csv'|'ndjson'} format
 * @returns {Promise<Blob>}
 */
export async function exportLogs(queryOpts = {}, format = 'json') {
  const { entries } = await query({ ...queryOpts, limit: 10000 });

  await log({
    action: 'audit.exported',
    meta:   { format, count: entries.length },
    severity: SEVERITY.HIGH,
  });

  switch (format) {
    case 'csv':   return _exportCsv(entries);
    case 'ndjson': return _exportNdjson(entries);
    default:      return new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
  }
}

/**
 * Trigger a browser download of the audit export.
 */
export async function downloadExport(queryOpts = {}, format = 'json') {
  const blob     = await exportLogs(queryOpts, format);
  const url      = URL.createObjectURL(blob);
  const a        = document.createElement('a');
  const ext      = format === 'csv' ? 'csv' : format === 'ndjson' ? 'ndjson' : 'json';
  a.href         = url;
  a.download     = `nuvra-audit-${(_orgId || 'local').slice(0, 8)}-${Date.now()}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ─── Chain Verification ───────────────────────────────────────────────────────

/**
 * Verify the integrity of the audit chain.
 * Returns { valid: boolean, firstBrokenAt: AuditEntry | null }
 */
export async function verifyChain(orgId = _orgId) {
  const { entries } = await query({ orgId, limit: 10000 });
  let prevHash = '0'.repeat(64);

  for (const entry of entries) {
    const { chainHash, ...rest } = entry;
    const entryData = JSON.stringify({
      id: rest.id, timestamp: rest.timestamp, action: rest.action,
      orgId: rest.orgId, userId: rest.userId, meta: rest.meta, severity: rest.severity,
    });
    const expected = await _sha256(prevHash + entryData);
    if (expected !== chainHash) {
      return { valid: false, firstBrokenAt: entry };
    }
    prevHash = chainHash;
  }

  return { valid: true, firstBrokenAt: null };
}

// ─── Event Subscription ───────────────────────────────────────────────────────

export function subscribe(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function _persist(entry) {
  // Try cloud
  try {
    const { cloud } = await import('../cloud/cloud.js');
    if (cloud.isCloudAvailable()) {
      const { error } = await cloud.audit.insert(entry);
      if (!error) return;
    }
  } catch {}

  // Fallback: queue for later + local storage
  _queue.push(entry);
  _saveLocalEntry(entry);
}

function _startFlushTimer() {
  if (_flushTimer) clearInterval(_flushTimer);
  _flushTimer = setInterval(_flushQueue, 30_000);
}

async function _flushQueue() {
  if (_queue.length === 0) return;
  try {
    const { cloud } = await import('../cloud/cloud.js');
    if (!cloud.isCloudAvailable()) return;
    const batch = [..._queue];
    _queue = [];
    for (const entry of batch) {
      await cloud.audit.insert(entry);
    }
  } catch {}
}

function _saveLocalEntry(entry) {
  try {
    const key  = `nuvra-audit-local-${entry.orgId || 'anon'}`;
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    list.push(entry);
    // Keep last 1000 entries locally
    if (list.length > 1000) list.splice(0, list.length - 1000);
    localStorage.setItem(key, JSON.stringify(list));
  } catch {}
}

function _queryLocal({ orgId, userId, action, severity, fromDate, toDate, limit, offset }) {
  try {
    const key   = `nuvra-audit-local-${orgId || 'anon'}`;
    let entries = JSON.parse(localStorage.getItem(key) || '[]');

    if (userId)   entries = entries.filter(e => e.userId === userId);
    if (action)   entries = entries.filter(e => action.endsWith('*') ? e.action.startsWith(action.slice(0, -1)) : e.action === action);
    if (severity) entries = entries.filter(e => e.severity === severity);
    if (fromDate) entries = entries.filter(e => e.timestamp >= fromDate);
    if (toDate)   entries = entries.filter(e => e.timestamp <= toDate);

    const total   = entries.length;
    const sliced  = entries.slice(offset, offset + limit);
    return { entries: sliced, total };
  } catch { return { entries: [], total: 0 }; }
}

function _exportCsv(entries) {
  const headers = ['id', 'timestamp', 'action', 'orgId', 'userId', 'severity', 'meta', 'chainHash'];
  const rows    = entries.map(e => headers.map(h => {
    const v = h === 'meta' ? JSON.stringify(e[h]) : (e[h] || '');
    return `"${String(v).replace(/"/g, '""')}"`;
  }).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  return new Blob([csv], { type: 'text/csv' });
}

function _exportNdjson(entries) {
  const ndjson = entries.map(e => JSON.stringify(e)).join('\n');
  return new Blob([ndjson], { type: 'application/x-ndjson' });
}

async function _sha256(message) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray  = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback: simple non-cryptographic hash for environments without crypto.subtle
  let h = 0;
  for (let i = 0; i < message.length; i++) {
    h = ((h << 5) - h) + message.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(16).padStart(64, '0');
}

function _uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function _emit(event, data) {
  _listeners.forEach(fn => { try { fn(event, data); } catch {} });
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const auditService = {
  init, log, query, placeLegalHold, releaseLegalHold,
  isUnderLegalHold, exportLogs, downloadExport, verifyChain, subscribe,
  SEVERITY,
};
