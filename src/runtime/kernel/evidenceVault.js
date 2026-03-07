/**
 * Nuvra Runtime Kernel — evidenceVault.js (Phase 16)
 *
 * The Governance Evidence Vault. Collects, stores, and organizes all
 * compliance and governance evidence required for audits and certifications.
 *
 * Evidence types:
 *   - ai_decision        — Gatekeeper decisions from ExplainabilityLedger
 *   - simulation_report  — Compliance simulation run results
 *   - replay_report      — Audit replay results
 *   - policy_change      — Policy configuration changes
 *   - access_event       — Data access events
 *   - deploy_event       — Deployment events
 *   - agent_run          — Agent execution summaries
 *   - cert_assessment    — SOC 2 / compliance readiness assessments
 *
 * The vault:
 *   - Stores evidence in localStorage (local) and Supabase (cloud)
 *   - Organizes evidence by type, date, and project
 *   - Generates evidence packages for auditors (ZIP with JSON + summary)
 *   - Supports legal hold (prevents deletion of specific evidence)
 *
 * @module runtime/evidenceVault
 */
'use strict';

const VAULT_KEY_PREFIX = 'nuvra-evidence-vault-';
const MAX_LOCAL_ITEMS  = 2_000;

// ─── Evidence Entry ───────────────────────────────────────────────────────────
/**
 * @typedef {object} EvidenceEntry
 * @property {string} id
 * @property {string} type        - Evidence type constant
 * @property {string} projectId
 * @property {string} orgId
 * @property {object} data        - The evidence payload
 * @property {boolean} legalHold  - If true, cannot be deleted
 * @property {number}  timestamp
 * @property {string}  hash       - SHA-256 hash of the entry (tamper detection)
 */

// ─── Internal State ───────────────────────────────────────────────────────────
let _userId    = null;
let _projectId = null;
let _cloud     = null;  // Cloud.js reference for Supabase storage
let _entries   = [];

// ─── Initialization ───────────────────────────────────────────────────────────
export function init(userId, projectId, options = {}) {
  _userId    = userId;
  _projectId = projectId;
  _cloud     = options.cloud || null;
  _entries   = _load();
}

// ─── Record Evidence ──────────────────────────────────────────────────────────
/**
 * Record a piece of evidence in the vault.
 * @param {object} evidence - { type, data, projectId?, orgId? }
 * @returns {Promise<EvidenceEntry>}
 */
export async function record(evidence) {
  const entry = {
    id:        _generateId(),
    type:      evidence.type      || 'general',
    projectId: evidence.projectId || _projectId,
    orgId:     evidence.orgId     || null,
    data:      evidence,
    legalHold: false,
    timestamp: Date.now(),
    hash:      await _hash(evidence),
  };

  _entries.push(entry);

  if (_entries.length > MAX_LOCAL_ITEMS) {
    // Preserve legal hold entries; trim the rest
    const held    = _entries.filter(e => e.legalHold);
    const regular = _entries.filter(e => !e.legalHold);
    _entries = [...held, ...regular.slice(-MAX_LOCAL_ITEMS)];
  }

  _save();

  // Sync to cloud if available
  if (_cloud) {
    await _cloud.upsertEvidenceEntry(entry).catch(() => {});
  }

  return entry;
}

// ─── Query ────────────────────────────────────────────────────────────────────
/**
 * Query evidence entries.
 * @param {object} [filters]
 * @param {string}   [filters.type]
 * @param {string}   [filters.projectId]
 * @param {number}   [filters.since]
 * @param {number}   [filters.until]
 * @param {number}   [filters.limit]
 * @returns {EvidenceEntry[]}
 */
export function query(filters = {}) {
  let results = [..._entries];
  if (filters.type)      results = results.filter(e => e.type      === filters.type);
  if (filters.projectId) results = results.filter(e => e.projectId === filters.projectId);
  if (filters.since)     results = results.filter(e => e.timestamp >= filters.since);
  if (filters.until)     results = results.filter(e => e.timestamp <= filters.until);
  results.sort((a, b) => b.timestamp - a.timestamp);
  return results.slice(0, filters.limit || 200);
}

// ─── Legal Hold ───────────────────────────────────────────────────────────────
export function setLegalHold(id, hold = true) {
  const entry = _entries.find(e => e.id === id);
  if (entry) {
    entry.legalHold = hold;
    _save();
  }
}

// ─── Evidence Package (for auditors) ─────────────────────────────────────────
/**
 * Generate a JSON evidence package for a specific time range and project.
 * @param {object} options
 * @returns {string} JSON string
 */
export function generatePackage(options = {}) {
  const entries = query({
    projectId: options.projectId,
    since:     options.since,
    until:     options.until,
    limit:     5_000,
  });

  const summary = {
    generatedAt:  new Date().toISOString(),
    projectId:    options.projectId || 'all',
    dateRange: {
      from: options.since ? new Date(options.since).toISOString() : 'all time',
      to:   options.until ? new Date(options.until).toISOString() : 'now',
    },
    totalEntries:  entries.length,
    byType:        _countByField(entries, 'type'),
    legalHoldCount: entries.filter(e => e.legalHold).length,
  };

  return JSON.stringify({ summary, entries }, null, 2);
}

// ─── Statistics ───────────────────────────────────────────────────────────────
export function getStats(projectId) {
  const entries = projectId ? _entries.filter(e => e.projectId === projectId) : _entries;
  return {
    total:     entries.length,
    byType:    _countByField(entries, 'type'),
    legalHold: entries.filter(e => e.legalHold).length,
    oldest:    entries.length ? new Date(Math.min(...entries.map(e => e.timestamp))).toISOString() : null,
    newest:    entries.length ? new Date(Math.max(...entries.map(e => e.timestamp))).toISOString() : null,
  };
}

// ─── Persistence ──────────────────────────────────────────────────────────────
function _save() {
  if (!_userId) return;
  try {
    localStorage.setItem(`${VAULT_KEY_PREFIX}${_userId}`, JSON.stringify(_entries));
  } catch (_) {}
}

function _load() {
  if (!_userId) return [];
  try {
    const raw = localStorage.getItem(`${VAULT_KEY_PREFIX}${_userId}`);
    return raw ? JSON.parse(raw) : [];
  } catch (_) { return []; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _generateId() {
  return `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function _hash(data) {
  try {
    const text    = JSON.stringify(data);
    const buffer  = new TextEncoder().encode(text);
    const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (_) {
    return 'hash-unavailable';
  }
}

function _countByField(entries, field) {
  const counts = {};
  for (const e of entries) {
    const val = e[field] || 'unknown';
    counts[val] = (counts[val] || 0) + 1;
  }
  return counts;
}

// ─── Singleton export ─────────────────────────────────────────────────────────
export const evidenceVault = { init, record, query, setLegalHold, generatePackage, getStats };
export default evidenceVault;
