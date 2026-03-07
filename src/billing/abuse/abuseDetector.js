'use strict';

/**
 * abuseDetector.js — Nuvra Phase 7
 *
 * The Abuse Detection & Throttle Engine identifies and blocks patterns
 * that indicate misuse of the AI generation system.
 *
 * Abuse patterns detected:
 *  - Prompt spam:         > N identical or near-identical prompts in a window
 *  - Token flooding:      Single requests with abnormally large token counts
 *  - Regeneration loops:  Rapid repeated regeneration of the same resource
 *  - Velocity abuse:      Too many AI calls per minute/hour
 *  - Cost spiking:        Single session spending > X% of monthly budget
 *
 * Responses:
 *  - THROTTLE:  Slow down the user (add artificial delay)
 *  - BLOCK:     Block the specific action
 *  - SUSPEND:   Flag the account for review
 */

// ─── Abuse Codes ──────────────────────────────────────────────────────────────

const AbuseCode = Object.freeze({
  PROMPT_SPAM:        'PROMPT_SPAM',
  TOKEN_FLOOD:        'TOKEN_FLOOD',
  REGEN_LOOP:         'REGEN_LOOP',
  VELOCITY_EXCEEDED:  'VELOCITY_EXCEEDED',
  COST_SPIKE:         'COST_SPIKE',
  CLEAN:              'CLEAN',
});

// ─── Default Thresholds ───────────────────────────────────────────────────────

const DEFAULT_THRESHOLDS = {
  // Prompt spam: same prompt hash > N times in windowMs
  promptSpam: {
    maxIdentical:   3,
    windowMs:       5 * 60 * 1000, // 5 minutes
  },
  // Token flood: single request exceeds N tokens
  tokenFlood: {
    maxInputTokens:  20_000,
    maxOutputTokens: 8_000,
  },
  // Regeneration loop: same resourceId regenerated > N times in windowMs
  regenLoop: {
    maxRegens:  5,
    windowMs:   2 * 60 * 1000, // 2 minutes
  },
  // Velocity: > N AI calls in windowMs
  velocity: {
    maxCallsPerMinute: 10,
    maxCallsPerHour:   100,
  },
  // Cost spike: single session cost > X% of monthly plan budget
  costSpike: {
    sessionToMonthlyRatio: 0.5, // Block if session > 50% of monthly budget
  },
};

// ─── AbuseDetector ────────────────────────────────────────────────────────────

class AbuseDetector {
  /**
   * @param {object} options
   * @param {object} [options.thresholds]  - Override default thresholds
   * @param {object} [options.eventBus]
   * @param {object} [options.logger]
   */
  constructor({ thresholds = {}, eventBus = null, logger = null } = {}) {
    this._thresholds = this._mergeThresholds(DEFAULT_THRESHOLDS, thresholds);
    this._eventBus   = eventBus;
    this._logger     = logger;

    // In-memory tracking (would be Redis/DB in production)
    // userId → { promptHashes: [{hash, ts}], callTimestamps: [ts], regenMap: {resourceId: [ts]} }
    this._userState = new Map();

    // Flagged users: userId → { code, flaggedAt, reason }
    this._flagged = new Map();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Checks a pending AI call for abuse patterns.
   *
   * @param {object} params
   * @param {string} params.userId
   * @param {string} params.prompt
   * @param {string} [params.resourceId]         - ID of the resource being generated
   * @param {number} [params.estimatedInputTokens]
   * @param {number} [params.estimatedOutputTokens]
   * @param {number} [params.sessionCostUSD]     - Current session cost
   * @param {number} [params.monthlyBudgetUSD]   - User's monthly plan budget
   * @returns {object} { clean: boolean, code: string, action: 'allow'|'throttle'|'block', reason?: string }
   */
  check({ userId, prompt, resourceId = null, estimatedInputTokens = 0, estimatedOutputTokens = 0, sessionCostUSD = 0, monthlyBudgetUSD = Infinity }) {
    // Check if already flagged
    if (this._flagged.has(userId)) {
      const flag = this._flagged.get(userId);
      return { clean: false, code: flag.code, action: 'block', reason: flag.reason };
    }

    const state = this._getState(userId);
    const now   = Date.now();

    // 1. Token flood check
    const { maxInputTokens, maxOutputTokens } = this._thresholds.tokenFlood;
    if (estimatedInputTokens > maxInputTokens) {
      return this._flag(userId, AbuseCode.TOKEN_FLOOD, `Input token count (${estimatedInputTokens}) exceeds limit (${maxInputTokens}).`, 'block');
    }
    if (estimatedOutputTokens > maxOutputTokens) {
      return this._flag(userId, AbuseCode.TOKEN_FLOOD, `Output token count (${estimatedOutputTokens}) exceeds limit (${maxOutputTokens}).`, 'block');
    }

    // 2. Prompt spam check
    const promptHash = this._hashPrompt(prompt);
    const { maxIdentical, windowMs: spamWindow } = this._thresholds.promptSpam;
    const recentIdentical = state.promptHashes.filter(
      p => p.hash === promptHash && now - p.ts < spamWindow
    ).length;
    if (recentIdentical >= maxIdentical) {
      return this._flag(userId, AbuseCode.PROMPT_SPAM, `Identical prompt submitted ${recentIdentical + 1} times in ${spamWindow / 60000} minutes.`, 'throttle');
    }

    // 3. Regeneration loop check
    if (resourceId) {
      const { maxRegens, windowMs: regenWindow } = this._thresholds.regenLoop;
      const recentRegens = (state.regenMap[resourceId] || []).filter(ts => now - ts < regenWindow).length;
      if (recentRegens >= maxRegens) {
        return this._flag(userId, AbuseCode.REGEN_LOOP, `Resource "${resourceId}" regenerated ${recentRegens + 1} times in ${regenWindow / 60000} minutes.`, 'throttle');
      }
    }

    // 4. Velocity check
    const { maxCallsPerMinute, maxCallsPerHour } = this._thresholds.velocity;
    const callsLastMinute = state.callTimestamps.filter(ts => now - ts < 60_000).length;
    const callsLastHour   = state.callTimestamps.filter(ts => now - ts < 3_600_000).length;
    if (callsLastMinute >= maxCallsPerMinute) {
      return { clean: false, code: AbuseCode.VELOCITY_EXCEEDED, action: 'throttle', reason: `Rate limit: ${callsLastMinute} calls in the last minute (max ${maxCallsPerMinute}).` };
    }
    if (callsLastHour >= maxCallsPerHour) {
      return { clean: false, code: AbuseCode.VELOCITY_EXCEEDED, action: 'throttle', reason: `Rate limit: ${callsLastHour} calls in the last hour (max ${maxCallsPerHour}).` };
    }

    // 5. Cost spike check
    if (monthlyBudgetUSD !== Infinity && monthlyBudgetUSD > 0) {
      const { sessionToMonthlyRatio } = this._thresholds.costSpike;
      if (sessionCostUSD / monthlyBudgetUSD > sessionToMonthlyRatio) {
        return this._flag(userId, AbuseCode.COST_SPIKE, `Session cost ($${sessionCostUSD.toFixed(4)}) exceeds ${sessionToMonthlyRatio * 100}% of monthly budget ($${monthlyBudgetUSD.toFixed(2)}).`, 'block');
      }
    }

    // All checks passed — record the call
    this._recordCall(userId, promptHash, resourceId, now);
    return { clean: true, code: AbuseCode.CLEAN, action: 'allow' };
  }

  /**
   * Clears the abuse flag for a user (e.g., after manual review).
   */
  clearFlag(userId) {
    this._flagged.delete(userId);
  }

  /**
   * Returns whether a user is currently flagged.
   */
  isFlagged(userId) {
    return this._flagged.has(userId);
  }

  /**
   * Returns all currently flagged users.
   */
  getFlaggedUsers() {
    return Array.from(this._flagged.entries()).map(([userId, flag]) => ({ userId, ...flag }));
  }

  /**
   * Returns the current abuse state for a user (for diagnostics).
   */
  getUserState(userId) {
    return this._getState(userId);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  _flag(userId, code, reason, action) {
    if (action === 'block') {
      this._flagged.set(userId, { code, reason, flaggedAt: new Date().toISOString() });
    }

    if (this._logger) this._logger.warn(`[AbuseDetector] ${action.toUpperCase()}: ${code} for ${userId}`, { reason });
    if (this._eventBus) this._eventBus.emit('billing:abuse:detected', { userId, code, reason, action });

    return { clean: false, code, action, reason };
  }

  _recordCall(userId, promptHash, resourceId, now) {
    const state = this._getState(userId);
    state.promptHashes.push({ hash: promptHash, ts: now });
    state.callTimestamps.push(now);
    if (resourceId) {
      if (!state.regenMap[resourceId]) state.regenMap[resourceId] = [];
      state.regenMap[resourceId].push(now);
    }
    // Prune old entries to prevent memory growth
    const maxAge = Math.max(this._thresholds.promptSpam.windowMs, this._thresholds.regenLoop.windowMs, 3_600_000);
    state.promptHashes   = state.promptHashes.filter(p => now - p.ts < maxAge);
    state.callTimestamps = state.callTimestamps.filter(ts => now - ts < maxAge);
  }

  _getState(userId) {
    if (!this._userState.has(userId)) {
      this._userState.set(userId, { promptHashes: [], callTimestamps: [], regenMap: {} });
    }
    return this._userState.get(userId);
  }

  _hashPrompt(prompt) {
    // Simple deterministic hash for prompt deduplication
    // In production, use a proper hash function (e.g., FNV-1a)
    const normalized = prompt.trim().toLowerCase().replace(/\s+/g, ' ');
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(36);
  }

  _mergeThresholds(defaults, overrides) {
    const result = {};
    for (const key of Object.keys(defaults)) {
      result[key] = { ...defaults[key], ...(overrides[key] || {}) };
    }
    return result;
  }
}

export { AbuseDetector, AbuseCode, DEFAULT_THRESHOLDS };