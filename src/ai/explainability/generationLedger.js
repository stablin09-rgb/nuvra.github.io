/**
 * generationLedger.js — Nuvra Phase 5
 *
 * Explainability & Human-in-the-Loop system.
 *
 * The ledger records every AI decision with:
 *   - What was decided
 *   - Why it was decided (the AI's stated reason)
 *   - What alternatives were considered
 *   - Whether the user accepted, modified, or rejected the decision
 *   - The full audit trail for the session
 *
 * Human-in-the-loop (HITL) support:
 *   - Users can inspect any decision before accepting the schema
 *   - Users can lock specific decisions (they survive re-planning)
 *   - Users can override specific decisions with their own values
 *   - The ledger tracks all user interventions
 *
 * @module ai/explainability/generationLedger
 */
'use strict';

// ─── Decision Status ──────────────────────────────────────────────────────────
export const DecisionStatus = Object.freeze({
  AI_PROPOSED:    'ai_proposed',    // AI made this decision, user hasn't reviewed
  USER_ACCEPTED:  'user_accepted',  // User explicitly accepted
  USER_MODIFIED:  'user_modified',  // User changed the value
  USER_REJECTED:  'user_rejected',  // User rejected and AI will re-plan this
  USER_LOCKED:    'user_locked',    // User locked — survives re-planning
  AUTO_REPAIRED:  'auto_repaired',  // System auto-repaired a validation error
});

// ─── Decision Category ────────────────────────────────────────────────────────
export const DecisionCategory = Object.freeze({
  PAGE_STRUCTURE:    'page_structure',
  DATA_MODEL:        'data_model',
  ACTION_LOGIC:      'action_logic',
  STATE_DESIGN:      'state_design',
  PERMISSIONS:       'permissions',
  COMPONENT_CHOICE:  'component_choice',
  CONTENT:           'content',
  ARCHITECTURE:      'architecture',
});

// ─── GenerationLedger ─────────────────────────────────────────────────────────
class GenerationLedger {
  constructor() {
    this._sessions  = new Map();  // runId → session
    this._listeners = [];
  }

  // ── Session Management ───────────────────────────────────────────────────────

  /**
   * Start a new ledger session for a generation run.
   * @param {string} runId
   * @param {string} prompt
   * @returns {string} runId
   */
  startSession(runId, prompt) {
    this._sessions.set(runId, {
      runId,
      prompt,
      startedAt:  Date.now(),
      decisions:  [],
      userActions: [],
      lockedDecisions: new Set(),
    });
    return runId;
  }

  /**
   * Close a session (mark as complete).
   * @param {string} runId
   */
  closeSession(runId) {
    const session = this._getSession(runId);
    if (session) {
      session.completedAt = Date.now();
      session.duration    = session.completedAt - session.startedAt;
    }
  }

  // ── Decision Recording ───────────────────────────────────────────────────────

  /**
   * Record an AI decision.
   *
   * @param {object} params
   * @param {string}   params.runId       - Generation run ID
   * @param {string}   params.category    - DecisionCategory
   * @param {string}   params.field       - What was decided (e.g., 'pages[0].mode')
   * @param {*}        params.value       - The decided value
   * @param {string}   params.reason      - Why this was decided
   * @param {*[]}      [params.alternatives] - Other values considered
   * @param {number}   [params.confidence] - AI confidence 0–1
   * @returns {string} Decision ID
   */
  recordDecision({ runId, category, field, value, reason, alternatives = [], confidence = 1 }) {
    const session = this._getSession(runId);
    if (!session) return null;

    const id = _generateId('dec');
    const decision = {
      id,
      runId,
      category:     category || DecisionCategory.ARCHITECTURE,
      field,
      value,
      reason,
      alternatives,
      confidence,
      status:       DecisionStatus.AI_PROPOSED,
      recordedAt:   Date.now(),
      userAction:   null,
    };

    session.decisions.push(decision);
    this._emit('ledger:decision_recorded', { runId, decision });
    return id;
  }

  /**
   * Record decisions from a SystemPlan's decisions array.
   * @param {string} runId
   * @param {object[]} planDecisions - SystemPlan.decisions
   */
  recordPlanDecisions(runId, planDecisions) {
    for (const d of (planDecisions || [])) {
      this.recordDecision({
        runId,
        category:    d.category || DecisionCategory.ARCHITECTURE,
        field:       d.category,
        value:       d.decision,
        reason:      d.reason,
        alternatives: [],
        confidence:  1,
      });
    }
  }

  // ── User Interactions ────────────────────────────────────────────────────────

  /**
   * User accepts a decision.
   * @param {string} runId
   * @param {string} decisionId
   */
  acceptDecision(runId, decisionId) {
    const decision = this._findDecision(runId, decisionId);
    if (!decision) return;
    decision.status    = DecisionStatus.USER_ACCEPTED;
    decision.userAction = { type: 'accept', ts: Date.now() };
    this._recordUserAction(runId, 'accept', decisionId);
    this._emit('ledger:user_accepted', { runId, decisionId });
  }

  /**
   * User modifies a decision value.
   * @param {string} runId
   * @param {string} decisionId
   * @param {*}      newValue
   * @param {string} [userReason]
   */
  modifyDecision(runId, decisionId, newValue, userReason) {
    const decision = this._findDecision(runId, decisionId);
    if (!decision) return;
    decision.originalValue = decision.value;
    decision.value         = newValue;
    decision.status        = DecisionStatus.USER_MODIFIED;
    decision.userAction    = { type: 'modify', newValue, userReason, ts: Date.now() };
    this._recordUserAction(runId, 'modify', decisionId, { newValue, userReason });
    this._emit('ledger:user_modified', { runId, decisionId, newValue });
  }

  /**
   * User rejects a decision (triggers re-planning for this item).
   * @param {string} runId
   * @param {string} decisionId
   * @param {string} [feedback] - Why the user rejected it
   */
  rejectDecision(runId, decisionId, feedback) {
    const decision = this._findDecision(runId, decisionId);
    if (!decision) return;
    decision.status     = DecisionStatus.USER_REJECTED;
    decision.userAction = { type: 'reject', feedback, ts: Date.now() };
    this._recordUserAction(runId, 'reject', decisionId, { feedback });
    this._emit('ledger:user_rejected', { runId, decisionId, feedback });
  }

  /**
   * User locks a decision — it will survive re-planning.
   * @param {string} runId
   * @param {string} decisionId
   */
  lockDecision(runId, decisionId) {
    const session = this._getSession(runId);
    if (!session) return;
    const decision = this._findDecision(runId, decisionId);
    if (!decision) return;
    decision.status = DecisionStatus.USER_LOCKED;
    decision.userAction = { type: 'lock', ts: Date.now() };
    session.lockedDecisions.add(decisionId);
    this._recordUserAction(runId, 'lock', decisionId);
    this._emit('ledger:user_locked', { runId, decisionId });
  }

  // ── Queries ──────────────────────────────────────────────────────────────────

  /**
   * Get all decisions for a session.
   * @param {string} runId
   * @returns {object[]}
   */
  getDecisions(runId) {
    const session = this._getSession(runId);
    return session ? [...session.decisions] : [];
  }

  /**
   * Get locked decisions for a session (to preserve during re-planning).
   * @param {string} runId
   * @returns {object[]}
   */
  getLockedDecisions(runId) {
    const session = this._getSession(runId);
    if (!session) return [];
    return session.decisions.filter(d => d.status === DecisionStatus.USER_LOCKED);
  }

  /**
   * Get rejected decisions (for re-planning feedback).
   * @param {string} runId
   * @returns {object[]}
   */
  getRejectedDecisions(runId) {
    const session = this._getSession(runId);
    if (!session) return [];
    return session.decisions.filter(d => d.status === DecisionStatus.USER_REJECTED);
  }

  /**
   * Get a human-readable summary of all decisions for a session.
   * @param {string} runId
   * @returns {string}
   */
  getSummary(runId) {
    const decisions = this.getDecisions(runId);
    if (!decisions.length) return 'No decisions recorded.';

    const lines = [`Generation Decisions (${decisions.length} total):\n`];
    for (const d of decisions) {
      const statusIcon = {
        [DecisionStatus.AI_PROPOSED]:   '🤖',
        [DecisionStatus.USER_ACCEPTED]: '✅',
        [DecisionStatus.USER_MODIFIED]: '✏️',
        [DecisionStatus.USER_REJECTED]: '❌',
        [DecisionStatus.USER_LOCKED]:   '🔒',
        [DecisionStatus.AUTO_REPAIRED]: '🔧',
      }[d.status] || '?';

      lines.push(`${statusIcon} [${d.category}] ${d.field}`);
      lines.push(`   Decision: ${JSON.stringify(d.value)}`);
      lines.push(`   Reason: ${d.reason}`);
      if (d.alternatives?.length) {
        lines.push(`   Alternatives: ${d.alternatives.map(a => JSON.stringify(a)).join(', ')}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Get the full audit trail for a session.
   * @param {string} runId
   * @returns {object}
   */
  getAuditTrail(runId) {
    const session = this._getSession(runId);
    if (!session) return null;
    return {
      runId:       session.runId,
      prompt:      session.prompt,
      startedAt:   session.startedAt,
      completedAt: session.completedAt,
      duration:    session.duration,
      decisions:   session.decisions,
      userActions: session.userActions,
      stats: {
        total:        session.decisions.length,
        accepted:     session.decisions.filter(d => d.status === DecisionStatus.USER_ACCEPTED).length,
        modified:     session.decisions.filter(d => d.status === DecisionStatus.USER_MODIFIED).length,
        rejected:     session.decisions.filter(d => d.status === DecisionStatus.USER_REJECTED).length,
        locked:       session.decisions.filter(d => d.status === DecisionStatus.USER_LOCKED).length,
        autoRepaired: session.decisions.filter(d => d.status === DecisionStatus.AUTO_REPAIRED).length,
      },
    };
  }

  /**
   * Get all sessions.
   * @returns {object[]}
   */
  getAllSessions() {
    return Array.from(this._sessions.values()).map(s => ({
      runId:       s.runId,
      prompt:      s.prompt,
      startedAt:   s.startedAt,
      completedAt: s.completedAt,
      decisionCount: s.decisions.length,
    }));
  }

  // ── Events ───────────────────────────────────────────────────────────────────

  subscribe(listener) {
    this._listeners.push(listener);
    return () => { this._listeners = this._listeners.filter(l => l !== listener); };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _getSession(runId) {
    return this._sessions.get(runId) || null;
  }

  _findDecision(runId, decisionId) {
    const session = this._getSession(runId);
    if (!session) return null;
    return session.decisions.find(d => d.id === decisionId) || null;
  }

  _recordUserAction(runId, type, decisionId, data = {}) {
    const session = this._getSession(runId);
    if (!session) return;
    session.userActions.push({ type, decisionId, ...data, ts: Date.now() });
  }

  _emit(event, data) {
    for (const l of this._listeners) {
      try { l(event, data); } catch (_) {}
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _generateId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const generationLedger = new GenerationLedger();
export default generationLedger;
