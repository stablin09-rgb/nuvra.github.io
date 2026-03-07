/**
 * Nuvra — agentMemory.js (Phase 14)
 *
 * Structured, scoped, queryable memory for the agent system.
 *
 * Memory types:
 *   - SHORT_TERM: In-memory only, cleared on session end. Used for
 *                 within-run context (e.g., "the user just rejected a hero section").
 *   - LONG_TERM:  Persisted to localStorage, survives sessions. Used for
 *                 project intent, brand rules, user preferences, past actions.
 *
 * Memory is always scoped to a projectId. There is no cross-project memory.
 * Org-level memory is scoped to an orgId and is read-only for agents.
 *
 * Memory keys are namespaced by category for clarity and queryability.
 *
 * @module agentMemory
 */
'use strict';

// ─── Memory Categories ────────────────────────────────────────────────────────
export const MEMORY_CATEGORY = {
  INTENT:       'intent',       // What the user wants to build
  BRAND:        'brand',        // Brand rules (colors, tone, voice)
  DECISIONS:    'decisions',    // Design/architecture decisions made
  PREFERENCES:  'preferences',  // User preferences (e.g., "always use dark mode")
  ACTIONS:      'actions',      // Log of past agent actions
  REJECTIONS:   'rejections',   // Suggestions the user has rejected
  EXPERIMENTS:  'experiments',  // A/B tests and their results
  CONTEXT:      'context',      // Short-term context for the current run
};

// ─── Memory Entry schema ──────────────────────────────────────────────────────
/**
 * @typedef {object} MemoryEntry
 * @property {string}  id          - Unique entry ID
 * @property {string}  category    - MEMORY_CATEGORY value
 * @property {string}  key         - Namespaced key (e.g., 'brand.primaryColor')
 * @property {*}       value       - The stored value
 * @property {string}  source      - Who wrote this ('user' | agentType)
 * @property {string}  createdAt   - ISO timestamp
 * @property {string}  updatedAt   - ISO timestamp
 * @property {number}  [ttl]       - Optional TTL in ms (for short-term entries)
 * @property {boolean} [sensitive] - If true, excluded from agent reads unless explicitly allowed
 */

// ─── AgentMemory class ────────────────────────────────────────────────────────
class AgentMemory {
  constructor() {
    /** @type {Map<string, MemoryEntry>} In-memory short-term store */
    this._shortTerm = new Map();
    /** @type {string|null} Active project ID */
    this._projectId = null;
  }

  /**
   * Set the active project context.
   * @param {string} projectId
   */
  setProject(projectId) {
    this._projectId = projectId;
    this._shortTerm.clear(); // Clear short-term memory on project switch
  }

  // ─── Write ──────────────────────────────────────────────────────────────────

  /**
   * Write a long-term memory entry.
   * @param {object} params
   * @param {string}  params.category
   * @param {string}  params.key
   * @param {*}       params.value
   * @param {string}  [params.source]    - Who is writing ('user' | agentType)
   * @param {boolean} [params.sensitive]
   * @returns {MemoryEntry}
   */
  write({ category, key, value, source = 'system', sensitive = false }) {
    if (!this._projectId) throw new Error('AgentMemory: no active project');

    const existing = this._findLongTerm(category, key);
    const now = new Date().toISOString();
    const entry = {
      id:        existing?.id || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      category,
      key,
      value,
      source,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      sensitive,
    };

    const store = this._loadStore();
    const idx = store.findIndex(e => e.category === category && e.key === key);
    if (idx >= 0) store[idx] = entry;
    else store.push(entry);
    this._saveStore(store);

    return entry;
  }

  /**
   * Write a short-term memory entry (in-memory only, not persisted).
   * @param {string} key
   * @param {*}      value
   * @param {number} [ttlMs] - Optional TTL in milliseconds
   */
  writeShortTerm(key, value, ttlMs) {
    const entry = {
      key, value,
      createdAt: Date.now(),
      expiresAt: ttlMs ? Date.now() + ttlMs : null,
    };
    this._shortTerm.set(key, entry);
  }

  // ─── Read ───────────────────────────────────────────────────────────────────

  /**
   * Read a specific long-term memory entry by category and key.
   * @param {string} category
   * @param {string} key
   * @returns {*} The stored value, or undefined
   */
  read(category, key) {
    const entry = this._findLongTerm(category, key);
    return entry?.value;
  }

  /**
   * Read a short-term memory entry.
   * @param {string} key
   * @returns {*}
   */
  readShortTerm(key) {
    const entry = this._shortTerm.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this._shortTerm.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Query long-term memory by category, with optional filtering.
   * @param {object} params
   * @param {string}   params.category
   * @param {string}   [params.keyPrefix]   - Filter by key prefix
   * @param {boolean}  [params.includeSensitive] - Include sensitive entries
   * @param {number}   [params.limit]
   * @returns {MemoryEntry[]}
   */
  query({ category, keyPrefix, includeSensitive = false, limit = 50 }) {
    const store = this._loadStore();
    let results = store.filter(e => {
      if (e.category !== category) return false;
      if (!includeSensitive && e.sensitive) return false;
      if (keyPrefix && !e.key.startsWith(keyPrefix)) return false;
      return true;
    });
    // Sort by updatedAt descending
    results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return results.slice(0, limit);
  }

  /**
   * Get a structured summary of project memory for use in AI prompts.
   * Returns only non-sensitive entries, formatted for LLM consumption.
   * @returns {string}
   */
  getSummaryForPrompt() {
    if (!this._projectId) return '';

    const intent      = this.read(MEMORY_CATEGORY.INTENT, 'project.goal');
    const brand       = this.query({ category: MEMORY_CATEGORY.BRAND, limit: 10 });
    const decisions   = this.query({ category: MEMORY_CATEGORY.DECISIONS, limit: 10 });
    const preferences = this.query({ category: MEMORY_CATEGORY.PREFERENCES, limit: 10 });
    const rejections  = this.query({ category: MEMORY_CATEGORY.REJECTIONS, limit: 5 });

    const lines = [];
    if (intent) lines.push(`Project Goal: ${intent}`);
    if (brand.length)       lines.push(`Brand Rules: ${brand.map(e => `${e.key}=${JSON.stringify(e.value)}`).join(', ')}`);
    if (decisions.length)   lines.push(`Past Decisions: ${decisions.map(e => e.value).join('; ')}`);
    if (preferences.length) lines.push(`User Preferences: ${preferences.map(e => `${e.key}: ${e.value}`).join('; ')}`);
    if (rejections.length)  lines.push(`Rejected Suggestions (do not repeat): ${rejections.map(e => e.value).join('; ')}`);

    return lines.join('\n');
  }

  /**
   * Record a rejected suggestion so agents don't repeat it.
   * @param {string} description - Human-readable description of what was rejected
   * @param {string} agentType   - Which agent made the suggestion
   */
  recordRejection(description, agentType) {
    const store = this._loadStore();
    const entry = {
      id:        `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      category:  MEMORY_CATEGORY.REJECTIONS,
      key:       `rejection.${Date.now()}`,
      value:     `[${agentType}] ${description}`,
      source:    'user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sensitive: false,
    };
    store.push(entry);
    // Keep only the last 20 rejections
    const rejections = store.filter(e => e.category === MEMORY_CATEGORY.REJECTIONS);
    if (rejections.length > 20) {
      const oldest = rejections.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      const idx = store.findIndex(e => e.id === oldest.id);
      if (idx >= 0) store.splice(idx, 1);
    }
    this._saveStore(store);
  }

  /**
   * Record an agent action in the long-term action log.
   * @param {object} action
   */
  recordAction(action) {
    const store = this._loadStore();
    store.push({
      id:        `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      category:  MEMORY_CATEGORY.ACTIONS,
      key:       `action.${Date.now()}`,
      value:     action,
      source:    action.agentType || 'system',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sensitive: false,
    });
    // Keep only the last 200 actions
    const actions = store.filter(e => e.category === MEMORY_CATEGORY.ACTIONS);
    if (actions.length > 200) {
      const oldest = actions.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      const idx = store.findIndex(e => e.id === oldest.id);
      if (idx >= 0) store.splice(idx, 1);
    }
    this._saveStore(store);
  }

  /**
   * Delete a specific memory entry.
   * @param {string} category
   * @param {string} key
   */
  delete(category, key) {
    const store = this._loadStore();
    const idx = store.findIndex(e => e.category === category && e.key === key);
    if (idx >= 0) {
      store.splice(idx, 1);
      this._saveStore(store);
    }
  }

  /**
   * Clear all memory for the current project.
   * This is a destructive operation and should require user confirmation.
   */
  clearAll() {
    if (!this._projectId) return;
    localStorage.removeItem(this._storageKey());
    this._shortTerm.clear();
  }

  /**
   * Export all memory as a JSON object (for backup/portability).
   * @returns {object}
   */
  export() {
    return {
      projectId: this._projectId,
      exportedAt: new Date().toISOString(),
      entries: this._loadStore(),
    };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────
  _storageKey() {
    return `nuvra-agent-memory-${this._projectId}`;
  }

  _loadStore() {
    try {
      const raw = localStorage.getItem(this._storageKey());
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  _saveStore(store) {
    try {
      localStorage.setItem(this._storageKey(), JSON.stringify(store));
    } catch { /* storage full — silently fail */ }
  }

  _findLongTerm(category, key) {
    const store = this._loadStore();
    return store.find(e => e.category === category && e.key === key) || null;
  }
}

export const agentMemory = new AgentMemory();
