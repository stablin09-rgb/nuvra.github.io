/**
 * schemaStore.js — Nuvra Phase 2–2.5
 *
 * The Schema Store — the authoritative repository for all planning schemas.
 *
 * This store manages:
 *   - The current IntentSchema
 *   - The current SiteSchema
 *   - A full version history (every plan is preserved)
 *   - Schema diffs (what changed between versions)
 *   - User edits (locked sections, manual overrides)
 *
 * The Schema Store is separate from the runtime state store.
 * It is the AI planning system's own source of truth.
 *
 * Key properties:
 *   - Every schema change creates a new version (never mutates in place)
 *   - Diffs are computed and stored for every version transition
 *   - User edits are preserved across re-planning
 *   - The store is observable (emits events on every change)
 *   - The store is persistable (can be serialized and restored)
 *
 * @module ai/schemas/schemaStore
 */
'use strict';

import { eventBus }   from '../../runtime/eventBus.js';
import { logger }     from '../../diagnostics/logger.js';
import { generateId, now, deepClone } from '../../runtime/utils.js';
import { schemaValidator } from '../validator/schemaValidator.js';

// ─── SchemaStore ──────────────────────────────────────────────────────────────
class SchemaStore {
  constructor() {
    this._intent      = null;  // current IntentSchema
    this._site        = null;  // current SiteSchema
    this._history     = [];    // array of { version, intent, site, diff, savedAt, source }
    this._userEdits   = new Map(); // sectionId → { field, value, editedAt }
    this._maxHistory  = 50;
    this._listeners   = new Set();
  }

  // ── Intent ─────────────────────────────────────────────────────────────────
  /**
   * Store a new IntentSchema.
   * @param {object} intent
   * @returns {{ ok: boolean, errors: string[] }}
   */
  setIntent(intent) {
    if (!intent || typeof intent !== 'object') {
      return { ok: false, errors: ['intent must be an object'] };
    }
    this._intent = deepClone(intent);
    logger.info('schemaStore', `Intent stored: ${intent.id}`);
    eventBus.emit('schema:intent_stored', { intentId: intent.id });
    this._notify('intent_changed', { intentId: intent.id });
    return { ok: true, errors: [] };
  }

  getIntent() { return this._intent ? deepClone(this._intent) : null; }

  // ── Site Schema ────────────────────────────────────────────────────────────
  /**
   * Store a new SiteSchema, creating a new version entry.
   * @param {object} siteSchema
   * @param {object} [options]
   * @param {string} [options.source] - 'ai' | 'user' | 'replan'
   * @returns {{ ok: boolean, version: number, errors: string[] }}
   */
  setSiteSchema(siteSchema, { source = 'ai' } = {}) {
    const errors = schemaValidator.validateSiteSchema(siteSchema);
    if (errors.length > 0) {
      logger.warn('schemaStore', 'setSiteSchema: validation failed', { errors });
      return { ok: false, version: null, errors };
    }

    const prev    = this._site;
    const newSite = deepClone(siteSchema);

    // Compute diff
    const diff = this._computeDiff(prev, newSite);

    // Re-apply user edits to preserved sections
    this._applyUserEdits(newSite);

    // Store version
    const version = this._history.length + 1;
    this._history.push({
      version,
      intentId: this._intent?.id || null,
      site:     deepClone(newSite),
      diff,
      savedAt:  now(),
      source,
    });

    if (this._history.length > this._maxHistory) this._history.shift();

    this._site = newSite;

    logger.info('schemaStore', `SiteSchema stored (v${version}, source: ${source})`, {
      siteId:   newSite.id,
      pages:    newSite.pages.length,
      sections: newSite.pages.reduce((n, p) => n + p.sections.length, 0),
      diffSize: diff.changes.length,
    });

    eventBus.emit('schema:site_stored', {
      siteId:  newSite.id,
      version,
      source,
      diff,
    });

    this._notify('site_changed', { siteId: newSite.id, version, source, diff });
    return { ok: true, version, errors: [] };
  }

  getSiteSchema() { return this._site ? deepClone(this._site) : null; }

  // ── History ────────────────────────────────────────────────────────────────
  getHistory() { return [...this._history]; }
  getVersion(n) { return this._history.find(h => h.version === n) || null; }
  getLatestVersion() { return this._history[this._history.length - 1] || null; }

  /**
   * Restore a previous version.
   * @param {number} version
   * @returns {{ ok: boolean, errors: string[] }}
   */
  restoreVersion(version) {
    const entry = this.getVersion(version);
    if (!entry) return { ok: false, errors: [`Version ${version} not found`] };
    return this.setSiteSchema(entry.site, { source: 'restore' });
  }

  // ── Diffs ──────────────────────────────────────────────────────────────────
  /**
   * Get the diff between two versions.
   * @param {number} fromVersion
   * @param {number} toVersion
   * @returns {object|null}
   */
  getDiff(fromVersion, toVersion) {
    const from = this.getVersion(fromVersion);
    const to   = this.getVersion(toVersion);
    if (!from || !to) return null;
    return this._computeDiff(from.site, to.site);
  }

  // ── User Edits ─────────────────────────────────────────────────────────────
  /**
   * Record a user edit to a section.
   * User edits are preserved across re-planning.
   * @param {string} sectionId
   * @param {string} field
   * @param {*} value
   */
  recordUserEdit(sectionId, field, value) {
    if (!this._userEdits.has(sectionId)) {
      this._userEdits.set(sectionId, []);
    }
    this._userEdits.get(sectionId).push({ field, value, editedAt: now() });

    // Apply to current site schema
    if (this._site) {
      this._applyEditToSite(this._site, sectionId, field, value);
    }

    eventBus.emit('schema:user_edit', { sectionId, field });
    this._notify('user_edit', { sectionId, field });
  }

  /**
   * Lock a section — re-planning will not modify it.
   * @param {string} sectionId
   */
  lockSection(sectionId) {
    if (!this._site) return;
    for (const page of this._site.pages) {
      const sec = page.sections.find(s => s.id === sectionId);
      if (sec) {
        sec.meta.locked = true;
        eventBus.emit('schema:section_locked', { sectionId });
        this._notify('section_locked', { sectionId });
        return;
      }
    }
  }

  unlockSection(sectionId) {
    if (!this._site) return;
    for (const page of this._site.pages) {
      const sec = page.sections.find(s => s.id === sectionId);
      if (sec) {
        sec.meta.locked = false;
        eventBus.emit('schema:section_unlocked', { sectionId });
        return;
      }
    }
  }

  // ── Serialization ──────────────────────────────────────────────────────────
  serialize() {
    return {
      intent:    this._intent,
      site:      this._site,
      history:   this._history,
      userEdits: Object.fromEntries(this._userEdits),
    };
  }

  restore(data) {
    if (!data || typeof data !== 'object') return;
    this._intent    = data.intent    || null;
    this._site      = data.site      || null;
    this._history   = data.history   || [];
    this._userEdits = new Map(Object.entries(data.userEdits || {}));
    this._notify('restored', {});
  }

  // ── Subscription ──────────────────────────────────────────────────────────
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  // ── Private ────────────────────────────────────────────────────────────────
  _notify(type, data) {
    for (const l of this._listeners) {
      try { l(type, data); } catch {}
    }
  }

  _computeDiff(prev, next) {
    const changes = [];

    if (!prev) {
      changes.push({ type: 'created', description: 'Initial site schema created' });
      return { changes, summary: 'Initial plan created' };
    }

    // Page-level diff
    const prevPageIds = new Set((prev.pages || []).map(p => p.id));
    const nextPageIds = new Set((next.pages || []).map(p => p.id));

    for (const id of nextPageIds) {
      if (!prevPageIds.has(id)) {
        const page = next.pages.find(p => p.id === id);
        changes.push({ type: 'page_added', pageId: id, pageName: page?.name });
      }
    }
    for (const id of prevPageIds) {
      if (!nextPageIds.has(id)) {
        const page = prev.pages.find(p => p.id === id);
        changes.push({ type: 'page_removed', pageId: id, pageName: page?.name });
      }
    }

    // Section-level diff (for pages that exist in both)
    for (const nextPage of (next.pages || [])) {
      const prevPage = (prev.pages || []).find(p => p.slug === nextPage.slug);
      if (!prevPage) continue;

      const prevSecTypes = (prevPage.sections || []).map(s => s.type);
      const nextSecTypes = (nextPage.sections || []).map(s => s.type);

      for (const type of nextSecTypes) {
        if (!prevSecTypes.includes(type)) {
          changes.push({ type: 'section_added', page: nextPage.name, sectionType: type });
        }
      }
      for (const type of prevSecTypes) {
        if (!nextSecTypes.includes(type)) {
          changes.push({ type: 'section_removed', page: nextPage.name, sectionType: type });
        }
      }

      // Order changes
      const prevOrder = JSON.stringify(prevSecTypes);
      const nextOrder = JSON.stringify(nextSecTypes);
      if (prevOrder !== nextOrder) {
        changes.push({ type: 'section_reordered', page: nextPage.name });
      }
    }

    const summary = changes.length === 0
      ? 'No structural changes'
      : `${changes.length} change${changes.length > 1 ? 's' : ''}: ${changes.map(c => c.type).join(', ')}`;

    return { changes, summary };
  }

  _applyUserEdits(siteSchema) {
    for (const [sectionId, edits] of this._userEdits) {
      for (const page of siteSchema.pages) {
        const sec = page.sections.find(s => s.id === sectionId);
        if (sec) {
          for (const edit of edits) {
            this._applyEditToSite(siteSchema, sectionId, edit.field, edit.value);
          }
          sec.meta.userEdited = true;
        }
      }
    }
  }

  _applyEditToSite(siteSchema, sectionId, field, value) {
    for (const page of siteSchema.pages) {
      const sec = page.sections.find(s => s.id === sectionId);
      if (sec) {
        if (field.startsWith('contentIntent.')) {
          const subField = field.slice('contentIntent.'.length);
          if (sec.contentIntent) sec.contentIntent[subField] = value;
        } else {
          sec[field] = value;
        }
        sec.meta.userEdited = true;
        return;
      }
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const schemaStore = new SchemaStore();
export default schemaStore;
