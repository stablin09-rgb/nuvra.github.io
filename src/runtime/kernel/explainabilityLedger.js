/**
 * Nuvra Runtime Kernel — explainabilityLedger.js (Phase 16)
 *
 * Records every AI decision with full explainability context.
 * Required for enterprise and government trust.
 *
 * For every AI action, the ledger records:
 *   - What was requested
 *   - What was allowed / modified / blocked
 *   - Which gatekeeper rule applied
 *   - Which regulation applied
 *   - Who made the request (actor, context)
 *   - When it happened
 *
 * The ledger is:
 *   - Append-only (no deletions)
 *   - Queryable by project, actor, decision, date range
 *   - Exportable as JSON or CSV
 *   - Integrated with the Evidence Vault for long-term storage
 *
 * @module runtime/explainabilityLedger
 */
'use strict';

const STORAGE_KEY_PREFIX = 'nuvra-xai-ledger-';
const MAX_LOCAL_ENTRIES  = 5_000;

// ─── Entry Schema ─────────────────────────────────────────────────────────────
/**
 * @typedef {object} LedgerEntry
 * @property {string} id           - Unique entry ID
 * @property {string} contextId    - ExecutionContext ID
 * @property {string} actor        - ACTOR constant
 * @property {string} actorId      - Actor's unique ID
 * @property {string} intent       - INTENT constant
 * @property {string} projectId    - Active project ID
 * @property {string} orgId        - Active org ID
 * @property {string} decision     - DECISION constant
 * @property {string} reason       - Human-readable explanation
 * @property {string} [appliedRule]    - The rule that triggered the decision
 * @property {string} [regulation]     - The regulation that applies
 * @property {string[]} [redactedFields] - Fields redacted from the prompt
 * @property {number} [estimatedCost]  - Estimated token cost
 * @property {number} [riskScore]      - Risk score at time of decision
 * @property {object} [promptSummary]  - Sanitized summary of the prompt (no PII)
 * @property {number} timestamp
 */

// ─── Internal State ───────────────────────────────────────────────────────────
let _userId    = null;
let _projectId = null;
let _entries   = [];
let _vault     = null;   // Optional: EvidenceVault reference

// ─── Initialization ───────────────────────────────────────────────────────────
export function init(userId, projectId, options = {}) {
  _userId    = userId;
  _projectId = projectId;
  _vault     = options.vault || null;
  _entries   = _load();
}

// ─── Record a Decision ────────────────────────────────────────────────────────
/**
 * Record a gatekeeper decision in the ledger.
 * @param {ExecutionContext}  ctx     - The execution context
 * @param {object}            meta    - Request metadata
 * @param {GatekeeperResult}  result  - The gatekeeper's decision
 */
export async function record(ctx, meta, result) {
  const entry = {
    id:          _generateId(),
    contextId:   ctx.id,
    actor:       ctx.actor,
    actorId:     ctx.actorId,
    intent:      ctx.intent,
    projectId:   ctx.projectId || _projectId,
    orgId:       ctx.orgId     || null,
    environment: ctx.environment,
    riskLevel:   ctx.riskLevel,
    decision:    result.decision,
    reason:      result.reason,
    appliedRule: result.appliedRule  || null,
    regulation:  result.regulation   || null,
    redactedFields: result.redactedFields || [],
    estimatedCost:  result.estimatedCost  || null,
    promptSummary:  _sanitizePrompt(meta.prompt),
    timestamp:   result.timestamp || Date.now(),
  };

  _entries.push(entry);

  // Trim to max local entries
  if (_entries.length > MAX_LOCAL_ENTRIES) {
    _entries = _entries.slice(-MAX_LOCAL_ENTRIES);
  }

  _save();

  // Forward to evidence vault for long-term storage
  if (_vault) {
    await _vault.record({ type: 'ai_decision', ...entry }).catch(() => {});
  }

  return entry;
}

// ─── Query ────────────────────────────────────────────────────────────────────
/**
 * Query ledger entries with optional filters.
 * @param {object} [filters]
 * @param {string}   [filters.projectId]
 * @param {string}   [filters.actorId]
 * @param {string}   [filters.decision]    - DECISION constant
 * @param {string}   [filters.intent]      - INTENT constant
 * @param {number}   [filters.since]       - Timestamp (ms)
 * @param {number}   [filters.until]       - Timestamp (ms)
 * @param {number}   [filters.limit]       - Max results (default 100)
 * @returns {LedgerEntry[]}
 */
export function query(filters = {}) {
  let results = [..._entries];

  if (filters.projectId) results = results.filter(e => e.projectId === filters.projectId);
  if (filters.actorId)   results = results.filter(e => e.actorId   === filters.actorId);
  if (filters.decision)  results = results.filter(e => e.decision  === filters.decision);
  if (filters.intent)    results = results.filter(e => e.intent    === filters.intent);
  if (filters.since)     results = results.filter(e => e.timestamp >= filters.since);
  if (filters.until)     results = results.filter(e => e.timestamp <= filters.until);

  results.sort((a, b) => b.timestamp - a.timestamp);

  const limit = filters.limit || 100;
  return results.slice(0, limit);
}

/**
 * Get a summary of AI decisions for a project.
 * @param {string} projectId
 * @returns {object} Summary statistics
 */
export function getSummary(projectId) {
  const entries = projectId ? _entries.filter(e => e.projectId === projectId) : _entries;
  const counts  = {};
  for (const e of entries) {
    counts[e.decision] = (counts[e.decision] || 0) + 1;
  }
  const blocked   = entries.filter(e => e.decision === 'block');
  const modified  = entries.filter(e => e.decision === 'modify');
  const approvals = entries.filter(e => e.decision === 'require_approval');

  return {
    total:              entries.length,
    byDecision:         counts,
    blockRate:          entries.length ? (blocked.length / entries.length * 100).toFixed(1) : 0,
    modificationRate:   entries.length ? (modified.length / entries.length * 100).toFixed(1) : 0,
    pendingApprovals:   approvals.filter(e => !e.resolved).length,
    topBlockReasons:    _topReasons(blocked, 5),
    topAppliedRules:    _topRules(entries, 5),
    redactedFieldCount: entries.reduce((sum, e) => sum + (e.redactedFields?.length || 0), 0),
  };
}

// ─── Export ───────────────────────────────────────────────────────────────────
export function exportJSON(filters = {}) {
  const entries = query({ ...filters, limit: 10_000 });
  return JSON.stringify({ exportedAt: new Date().toISOString(), entries }, null, 2);
}

export function exportCSV(filters = {}) {
  const entries = query({ ...filters, limit: 10_000 });
  const headers = ['id', 'timestamp', 'actor', 'actorId', 'intent', 'decision', 'reason', 'appliedRule', 'regulation', 'projectId'];
  const rows = entries.map(e => headers.map(h => JSON.stringify(e[h] ?? '')).join(','));
  return [headers.join(','), ...rows].join('\n');
}

// ─── Persistence ──────────────────────────────────────────────────────────────
function _save() {
  if (!_userId) return;
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${_userId}`, JSON.stringify(_entries));
  } catch (_) {}
}

function _load() {
  if (!_userId) return [];
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${_userId}`);
    return raw ? JSON.parse(raw) : [];
  } catch (_) { return []; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _generateId() {
  return `xai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function _sanitizePrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') return null;
  // Return only the first 200 chars, with PII patterns removed
  return prompt
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]')
    .replace(/\b(?:\d{4}[- ]){3}\d{4}\b/g, '[CARD]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]')
    .slice(0, 200);
}

function _topReasons(entries, n) {
  const counts = {};
  for (const e of entries) {
    counts[e.reason] = (counts[e.reason] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([reason, count]) => ({ reason, count }));
}

function _topRules(entries, n) {
  const counts = {};
  for (const e of entries) {
    if (e.appliedRule) counts[e.appliedRule] = (counts[e.appliedRule] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([rule, count]) => ({ rule, count }));
}

// ─── Singleton export ─────────────────────────────────────────────────────────
export const explainabilityLedger = { init, record, query, getSummary, exportJSON, exportCSV };
export default explainabilityLedger;
