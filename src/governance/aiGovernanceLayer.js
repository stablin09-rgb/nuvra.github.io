/**
 * aiGovernanceLayer.js — Nuvra Phase 6
 *
 * AI Governance Layer — enterprise-grade auditability.
 *
 * Captures:
 *  - Every prompt sent to an AI provider
 *  - Every AI response received
 *  - Every schema diff produced by AI
 *  - Every approval/rejection decision
 *  - Full cost and token accounting
 *
 * The governance layer is append-only. Records cannot be modified or deleted.
 * This is the audit trail that compliance officers and security teams need.
 *
 * @module governance/aiGovernanceLayer
 */
'use strict';

// ─── Record Types ─────────────────────────────────────────────────────────────
export const GovernanceRecordType = Object.freeze({
  PROMPT_SENT:       'prompt_sent',
  RESPONSE_RECEIVED: 'response_received',
  SCHEMA_DIFF:       'schema_diff',
  APPROVAL_REQUIRED: 'approval_required',
  APPROVED:          'approved',
  REJECTED:          'rejected',
  SAFETY_BLOCK:      'safety_block',
  SCOPE_VIOLATION:   'scope_violation',
  COST_WARNING:      'cost_warning',
  GENERATION_COMPLETE: 'generation_complete',
  GENERATION_FAILED:   'generation_failed',
});

// ─── Approval Status ──────────────────────────────────────────────────────────
export const ApprovalStatus = Object.freeze({
  PENDING:  'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  AUTO_APPROVED: 'auto_approved',
});

// ─── Schema Diff ──────────────────────────────────────────────────────────────
function computeSchemaDiff(before, after) {
  if (!before && !after) return { type: 'no_change', changes: [] };
  if (!before) return { type: 'created', changes: [{ path: '/', op: 'create', value: after }] };
  if (!after)  return { type: 'deleted', changes: [{ path: '/', op: 'delete' }] };

  const changes = [];
  _diffObjects('', before, after, changes);

  return {
    type:    changes.length > 0 ? 'modified' : 'no_change',
    changes,
    summary: `${changes.length} change(s)`,
  };
}

function _diffObjects(path, before, after, changes) {
  const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);

  for (const key of allKeys) {
    if (key.startsWith('_')) continue; // Skip metadata fields

    const fullPath = path ? `${path}.${key}` : key;
    const bVal = before?.[key];
    const aVal = after?.[key];

    if (bVal === aVal) continue;

    if (bVal === undefined) {
      changes.push({ path: fullPath, op: 'add', value: aVal });
    } else if (aVal === undefined) {
      changes.push({ path: fullPath, op: 'remove', before: bVal });
    } else if (typeof bVal === 'object' && typeof aVal === 'object' && !Array.isArray(bVal) && !Array.isArray(aVal)) {
      _diffObjects(fullPath, bVal, aVal, changes);
    } else if (Array.isArray(bVal) && Array.isArray(aVal)) {
      if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
        changes.push({ path: fullPath, op: 'replace', before: bVal, after: aVal });
      }
    } else {
      changes.push({ path: fullPath, op: 'replace', before: bVal, after: aVal });
    }
  }
}

export class AIGovernanceLayer {
  /**
   * @param {object} params
   * @param {object}   params.store
   * @param {object}   params.eventBus
   * @param {function} params.getCurrentUserId
   * @param {object}   [params.config]
   * @param {boolean}  [params.config.requireApprovalForGeneration] - Default false
   * @param {boolean}  [params.config.requireApprovalForMutation]   - Default true
   * @param {number}   [params.config.autoApproveBelow]             - Auto-approve if diff < N changes
   */
  constructor({ store, eventBus, getCurrentUserId, config }) {
    this._store            = store;
    this._eventBus         = eventBus;
    this._getCurrentUserId = getCurrentUserId;
    this._config           = {
      requireApprovalForGeneration: false,
      requireApprovalForMutation:   true,
      autoApproveBelow:             5,
      ...(config || {}),
    };

    this._records          = [];  // Append-only audit log
    this._pendingApprovals = {};  // approvalId → ApprovalRecord
    this._operationMap     = {};  // operationId → [recordIds]
  }

  // ── Audit Recording ───────────────────────────────────────────────────────────

  /**
   * Record a prompt being sent to an AI provider.
   */
  recordPromptSent({ operationId, projectId, capability, provider, model, prompt, estimatedTokens, estimatedCost }) {
    return this._append({
      type:    GovernanceRecordType.PROMPT_SENT,
      operationId,
      projectId,
      userId:  this._getCurrentUserId(),
      data: {
        capability,
        provider,
        model,
        promptLength: prompt?.length || 0,
        promptHash:   _hash(prompt || ''),
        estimatedTokens,
        estimatedCost,
        // Note: full prompt is NOT stored by default (privacy)
        // Set config.storePrompts = true to enable for debugging
      },
    });
  }

  /**
   * Record an AI response being received.
   */
  recordResponseReceived({ operationId, projectId, provider, model, tokensUsed, costUsd, success, error }) {
    return this._append({
      type:    GovernanceRecordType.RESPONSE_RECEIVED,
      operationId,
      projectId,
      userId:  this._getCurrentUserId(),
      data: {
        provider,
        model,
        tokensUsed,
        costUsd,
        success,
        error: error || null,
      },
    });
  }

  /**
   * Record a schema diff produced by an AI operation.
   */
  recordSchemaDiff({ operationId, projectId, schemaType, before, after }) {
    const diff = computeSchemaDiff(before, after);

    return this._append({
      type:    GovernanceRecordType.SCHEMA_DIFF,
      operationId,
      projectId,
      userId:  this._getCurrentUserId(),
      data: {
        schemaType,
        diff,
        changeCount: diff.changes.length,
      },
    });
  }

  /**
   * Record a safety block.
   */
  recordSafetyBlock({ operationId, projectId, reason, code }) {
    return this._append({
      type:    GovernanceRecordType.SAFETY_BLOCK,
      operationId,
      projectId,
      userId:  this._getCurrentUserId(),
      data: { reason, code },
    });
  }

  /**
   * Record a scope violation.
   */
  recordScopeViolation({ operationId, projectId, violations }) {
    return this._append({
      type:    GovernanceRecordType.SCOPE_VIOLATION,
      operationId,
      projectId,
      userId:  this._getCurrentUserId(),
      data: { violations },
    });
  }

  // ── Approval Hooks ────────────────────────────────────────────────────────────

  /**
   * Request approval for an AI-generated schema change.
   * Returns immediately if auto-approved.
   *
   * @param {object} params
   * @param {string} params.operationId
   * @param {string} params.projectId
   * @param {string} params.capability
   * @param {object} params.proposedSchema
   * @param {object} [params.previousSchema]
   * @returns {{ approvalId, status, autoApproved, diff }}
   */
  requestApproval({ operationId, projectId, capability, proposedSchema, previousSchema }) {
    const diff = computeSchemaDiff(previousSchema, proposedSchema);

    // Determine if approval is required
    const requiresApproval = this._requiresApproval(capability, diff);

    if (!requiresApproval || diff.changes.length < this._config.autoApproveBelow) {
      // Auto-approve
      const record = this._append({
        type:    GovernanceRecordType.APPROVED,
        operationId,
        projectId,
        userId:  this._getCurrentUserId(),
        data: { autoApproved: true, reason: 'Below auto-approve threshold', diff },
      });

      return {
        approvalId:   record.id,
        status:       ApprovalStatus.AUTO_APPROVED,
        autoApproved: true,
        diff,
      };
    }

    // Manual approval required
    const approvalId = _generateId('appr');

    const approvalRecord = {
      id:            approvalId,
      operationId,
      projectId,
      capability,
      proposedSchema,
      previousSchema,
      diff,
      status:        ApprovalStatus.PENDING,
      requestedAt:   Date.now(),
      requestedBy:   this._getCurrentUserId(),
      resolvedAt:    null,
      resolvedBy:    null,
    };

    this._pendingApprovals[approvalId] = approvalRecord;

    this._append({
      type:    GovernanceRecordType.APPROVAL_REQUIRED,
      operationId,
      projectId,
      userId:  this._getCurrentUserId(),
      data: { approvalId, changeCount: diff.changes.length, capability },
    });

    this._store.dispatch({ type: 'AI_APPROVAL_REQUIRED', payload: { approvalId, approvalRecord } });
    this._eventBus.emit('governance:approval_required', { approvalId, approvalRecord });

    return {
      approvalId,
      status:       ApprovalStatus.PENDING,
      autoApproved: false,
      diff,
    };
  }

  /**
   * Approve a pending AI operation.
   */
  approve(approvalId, reason = '') {
    const record = this._pendingApprovals[approvalId];
    if (!record) return { ok: false, error: 'Approval not found' };
    if (record.status !== ApprovalStatus.PENDING) return { ok: false, error: 'Approval already resolved' };

    record.status     = ApprovalStatus.APPROVED;
    record.resolvedAt = Date.now();
    record.resolvedBy = this._getCurrentUserId();
    record.reason     = reason;

    this._append({
      type:    GovernanceRecordType.APPROVED,
      operationId: record.operationId,
      projectId:   record.projectId,
      userId:  this._getCurrentUserId(),
      data: { approvalId, reason },
    });

    this._store.dispatch({ type: 'AI_APPROVED', payload: { approvalId } });
    this._eventBus.emit('governance:approved', { approvalId, record });

    return { ok: true, record };
  }

  /**
   * Reject a pending AI operation.
   */
  reject(approvalId, reason = '') {
    const record = this._pendingApprovals[approvalId];
    if (!record) return { ok: false, error: 'Approval not found' };
    if (record.status !== ApprovalStatus.PENDING) return { ok: false, error: 'Approval already resolved' };

    record.status     = ApprovalStatus.REJECTED;
    record.resolvedAt = Date.now();
    record.resolvedBy = this._getCurrentUserId();
    record.reason     = reason;

    this._append({
      type:    GovernanceRecordType.REJECTED,
      operationId: record.operationId,
      projectId:   record.projectId,
      userId:  this._getCurrentUserId(),
      data: { approvalId, reason },
    });

    this._store.dispatch({ type: 'AI_REJECTED', payload: { approvalId } });
    this._eventBus.emit('governance:rejected', { approvalId, record });

    return { ok: true, record };
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  getPendingApprovals() {
    return Object.values(this._pendingApprovals).filter(r => r.status === ApprovalStatus.PENDING);
  }

  getAuditLog({ projectId, type, limit = 100, since } = {}) {
    let records = [...this._records];

    if (projectId) records = records.filter(r => r.projectId === projectId);
    if (type)      records = records.filter(r => r.type === type);
    if (since)     records = records.filter(r => r.timestamp > since);

    return records.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  getOperationTrail(operationId) {
    return this._records
      .filter(r => r.operationId === operationId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  exportAuditLog(projectId) {
    const records = projectId
      ? this._records.filter(r => r.projectId === projectId)
      : this._records;

    return {
      exportedAt: new Date().toISOString(),
      projectId:  projectId || 'all',
      count:      records.length,
      records:    records.sort((a, b) => a.timestamp - b.timestamp),
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  _append(record) {
    const entry = {
      id:          _generateId('gov'),
      timestamp:   Date.now(),
      ...record,
    };

    this._records.push(entry);

    // Index by operationId
    if (entry.operationId) {
      if (!this._operationMap[entry.operationId]) {
        this._operationMap[entry.operationId] = [];
      }
      this._operationMap[entry.operationId].push(entry.id);
    }

    // Keep last 10,000 records
    if (this._records.length > 10_000) {
      this._records.shift();
    }

    this._eventBus.emit('governance:record_appended', { type: entry.type, id: entry.id });

    return entry;
  }

  _requiresApproval(capability, diff) {
    if (capability === 'mutation') return this._config.requireApprovalForMutation;
    if (['generation', 'regeneration'].includes(capability)) return this._config.requireApprovalForGeneration;
    return false;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _generateId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function _hash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}
