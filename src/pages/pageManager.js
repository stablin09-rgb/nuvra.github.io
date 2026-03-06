/**
 * pageManager.js — Nuvra Foundation (Phase 0–1)
 *
 * The Page System module. All page operations go through here.
 *
 * PageManager is a runtime module (registered with CoreRuntime).
 * It dispatches actions to the store — it never mutates state directly.
 * It emits events on the eventBus for any interested subscriber.
 *
 * Contract:
 *   - Pages are real entities with IDs
 *   - Pages are stored in the state store
 *   - Pages are created dynamically (no hardcoded pages)
 *   - Switching pages never loses data
 *   - All operations are observable
 *
 * @module pages/pageManager
 */
'use strict';

import { store }           from '../state/store.js';
import { eventBus }        from '../runtime/eventBus.js';
import {
  selectAllPages,
  selectPageById,
  selectActivePage,
  selectActivePageId,
  selectPageCount,
} from '../state/selectors.js';
import {
  createPage,
  validatePage,
  normalizePage,
  PageType,
} from './pageTypes.js';
import { now } from '../runtime/utils.js';

// ─── PageManager Module ───────────────────────────────────────────────────────
export const pageManager = {
  id:   'pageManager',
  deps: [], // no module dependencies — only depends on store and eventBus

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  init(runtime) {
    // Listen for store hydration — ensure active page is valid after restore
    eventBus.on('store:hydrated', () => this._validateActivePageAfterHydration());
  },

  start(runtime) {
    // If no pages exist after hydration, create the default home page
    const state = store.getState();
    if (selectPageCount(state) === 0) {
      this.addPage({ name: 'Home', type: PageType.BLANK });
    }
    // Ensure an active page is set
    const activeId = selectActivePageId(store.getState());
    if (!activeId) {
      const pages = selectAllPages(store.getState());
      if (pages.length > 0) {
        this.setActivePage(pages[0].id);
      }
    }
  },

  stop() {
    // Nothing to tear down
  },

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Add a new page.
   * @param {object} params - see createPage()
   * @returns {object} the new PageRecord
   */
  addPage(params = {}) {
    const page = createPage(params);
    const errors = validatePage(page);
    if (errors.length) throw new Error(`pageManager.addPage: ${errors.join(', ')}`);

    store.dispatch({ type: 'PAGES/ADD', payload: page });
    eventBus.emit('pages:added', { pageId: page.id, name: page.name });

    // Auto-activate if it's the first page
    if (selectPageCount(store.getState()) === 1) {
      this.setActivePage(page.id);
    }

    return page;
  },

  /**
   * Set the active (currently visible) page.
   * Saves the current page's content before switching.
   * @param {string} pageId
   */
  setActivePage(pageId) {
    const state = store.getState();
    const page  = selectPageById(state, pageId);
    if (!page) throw new Error(`pageManager.setActivePage: page "${pageId}" not found`);

    const prevId = selectActivePageId(state);
    if (prevId === pageId) return; // already active

    store.dispatch({ type: 'EDITOR/SET_ACTIVE_PAGE', payload: pageId });
    eventBus.emit('pages:activated', { pageId, prevPageId: prevId });
  },

  /**
   * Update page metadata (name, slug, title, description, meta).
   * @param {string} pageId
   * @param {object} changes
   */
  updatePage(pageId, changes) {
    const state = store.getState();
    if (!selectPageById(state, pageId)) {
      throw new Error(`pageManager.updatePage: page "${pageId}" not found`);
    }

    // Prevent updating immutable fields
    const { id: _id, createdAt: _ca, content: _c, ...safeChanges } = changes;

    store.dispatch({ type: 'PAGES/UPDATE', payload: { id: pageId, changes: safeChanges } });
    eventBus.emit('pages:updated', { pageId, changes: safeChanges });
  },

  /**
   * Save the content of a page (e.g. GrapesJS JSON).
   * @param {string} pageId
   * @param {object} content
   */
  savePageContent(pageId, content) {
    const state = store.getState();
    if (!selectPageById(state, pageId)) {
      throw new Error(`pageManager.savePageContent: page "${pageId}" not found`);
    }

    store.dispatch({ type: 'PAGES/SET_CONTENT', payload: { id: pageId, content } });
    store.dispatch({ type: 'EDITOR/MARK_DIRTY' });
    eventBus.emit('pages:content_saved', { pageId });
  },

  /**
   * Remove a page.
   * If the removed page was active, activates the nearest remaining page.
   * Refuses to delete the last page.
   * @param {string} pageId
   */
  removePage(pageId) {
    const state = store.getState();
    if (!selectPageById(state, pageId)) {
      throw new Error(`pageManager.removePage: page "${pageId}" not found`);
    }
    if (selectPageCount(state) <= 1) {
      throw new Error('pageManager.removePage: cannot delete the last page');
    }

    const wasActive = selectActivePageId(state) === pageId;
    store.dispatch({ type: 'PAGES/REMOVE', payload: pageId });
    eventBus.emit('pages:removed', { pageId });

    // Activate a different page if the deleted one was active
    if (wasActive) {
      const remaining = selectAllPages(store.getState());
      if (remaining.length > 0) {
        this.setActivePage(remaining[0].id);
      }
    }
  },

  /**
   * Reorder pages.
   * @param {string[]} orderedIds
   */
  reorderPages(orderedIds) {
    if (!Array.isArray(orderedIds)) throw new TypeError('pageManager.reorderPages: orderedIds must be an array');
    store.dispatch({ type: 'PAGES/REORDER', payload: orderedIds });
    eventBus.emit('pages:reordered', { order: orderedIds });
  },

  /**
   * Duplicate a page.
   * @param {string} pageId
   * @returns {object} the new PageRecord
   */
  duplicatePage(pageId) {
    const state = store.getState();
    const source = selectPageById(state, pageId);
    if (!source) throw new Error(`pageManager.duplicatePage: page "${pageId}" not found`);

    const copy = createPage({
      name:        `${source.name} (Copy)`,
      type:        source.type,
      description: source.description,
      content:     JSON.parse(JSON.stringify(source.content)),
      meta:        { ...source.meta },
    });

    store.dispatch({ type: 'PAGES/ADD', payload: copy });
    eventBus.emit('pages:duplicated', { sourceId: pageId, newId: copy.id });
    return copy;
  },

  // ── Read Helpers ───────────────────────────────────────────────────────────
  getActivePage()       { return selectActivePage(store.getState()); },
  getAllPages()          { return selectAllPages(store.getState()); },
  getPageById(id)       { return selectPageById(store.getState(), id); },
  getPageCount()        { return selectPageCount(store.getState()); },

  // ── Private ────────────────────────────────────────────────────────────────
  _validateActivePageAfterHydration() {
    const state    = store.getState();
    const activeId = selectActivePageId(state);
    if (activeId && !selectPageById(state, activeId)) {
      // Active page no longer exists — reset to first available
      const pages = selectAllPages(state);
      if (pages.length > 0) {
        store.dispatch({ type: 'EDITOR/SET_ACTIVE_PAGE', payload: pages[0].id });
      } else {
        store.dispatch({ type: 'EDITOR/SET_ACTIVE_PAGE', payload: null });
      }
    }
  },
};

export default pageManager;
