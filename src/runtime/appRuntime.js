/**
 * Nuvra Builder — App Runtime
 *
 * Hydrates rendered app-page HTML with live state, data bindings,
 * and action handlers. This is the bridge between the static HTML
 * produced by the renderer and the live, interactive app.
 *
 * The runtime scans the page for data-nv-* attributes and:
 *  - Hydrates data-table, data-form, data-list, stat-card components
 *  - Binds action handlers to buttons and forms
 *  - Sets up reactive state subscriptions
 *  - Handles conditional rendering
 *
 * This module is used in two contexts:
 *  1. Editor canvas (live preview within GrapesJS)
 *  2. Preview Mode iframe
 *
 * It is NOT used in the published output — the PreviewRuntime
 * (a self-contained IIFE) handles that.
 */

'use strict';

import { hydrateAppComponents } from '../app-components/appComponents.js';
import { bindElementToAction }  from '../actions/actionEngine.js';
import { stateManager }         from '../state/stateManager.js';
import { dataStore }            from '../data/dataModel.js';

// ─── App Runtime ──────────────────────────────────────────────────────────────

class AppRuntime {
  constructor() {
    this._cleanupFns  = [];
    this._currentPage = null;
  }

  /**
   * Activate the runtime for a given page container.
   *
   * @param {HTMLElement} container  - The page root element
   * @param {string}      pageId
   */
  activate(container, pageId) {
    this.deactivate(); // Clean up any previous activation

    this._currentPage = pageId;

    // 1. Hydrate data-aware components (tables, forms, lists, stat cards)
    hydrateAppComponents(container, pageId);

    // 2. Bind action handlers to all action-bearing elements
    const actionEls = container.querySelectorAll('[data-nv-action-type], [data-nv-action]');
    actionEls.forEach((el) => {
      const cleanup = bindElementToAction(el, pageId);
      this._cleanupFns.push(cleanup);
    });

    // 3. Set up data-bind text interpolations
    this._bindTextNodes(container);

    // 4. Listen for action results to refresh components
    const resultHandler = (e) => {
      const { type, record } = e.detail || {};
      if (type === 'submit' || type === 'delete' || type === 'update') {
        // Re-hydrate all components on the page after a data mutation
        hydrateAppComponents(container, pageId);
      }
    };
    container.addEventListener('nuvra:action:result', resultHandler);
    this._cleanupFns.push(() => container.removeEventListener('nuvra:action:result', resultHandler));

    console.log(`[AppRuntime] Activated for page: ${pageId}`);
  }

  /**
   * Deactivate the runtime and clean up all subscriptions.
   */
  deactivate() {
    this._cleanupFns.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
    this._cleanupFns  = [];
    this._currentPage = null;
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  /**
   * Bind data-nv-bind="key:collection" text nodes to live data.
   * @param {HTMLElement} container
   */
  _bindTextNodes(container) {
    const bindEls = container.querySelectorAll('[data-nv-bind]');
    bindEls.forEach((el) => {
      const [type, source] = (el.dataset.nvBind || '').split(':');
      if (!type || !source) return;

      const update = () => {
        if (type === 'count') {
          el.textContent = `${dataStore.count(source)} record${dataStore.count(source) !== 1 ? 's' : ''}`;
        } else if (type === 'state') {
          el.textContent = stateManager.getApp(source) ?? '';
        }
      };

      update();

      if (type === 'count') {
        const unsub = dataStore.subscribe(source, update);
        this._cleanupFns.push(unsub);
      } else if (type === 'state') {
        const unsub = stateManager.subscribeApp(source, update);
        this._cleanupFns.push(unsub);
      }
    });
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const appRuntime = new AppRuntime();
