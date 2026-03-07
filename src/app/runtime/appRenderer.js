/**
 * appRenderer.js — Nuvra Phase 3
 *
 * The App Renderer.
 *
 * Renders app pages and components from schemas into the DOM.
 * The renderer is purely reactive — it renders in response to state
 * and data changes, never by direct imperative calls from components.
 *
 * The renderer does NOT own any state. It reads from the AppContext
 * and produces a DOM projection. The DOM is always a projection of
 * the schema + current state + current data. Nothing more.
 *
 * Component rendering is delegated to the AppComponentRegistry.
 *
 * @module app/runtime/appRenderer
 */
'use strict';

import { AppComponentRegistry } from '../components/appComponentRegistry.js';

export class AppRenderer {
  /**
   * @param {object} opts
   * @param {AppContext}   opts.context  - The running app context
   * @param {HTMLElement}  opts.mountEl  - The DOM element to render into
   * @param {string}       opts.mode     - 'editor' | 'preview' | 'publish'
   */
  constructor({ context, mountEl, mode }) {
    this.context    = context;
    this.mountEl    = mountEl;
    this.mode       = mode;
    this._pageEl    = null;
    this._unsubs    = [];
    this._activePage = null;
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  async boot() {
    // Build the app shell
    this.mountEl.innerHTML = `<div class="nv-app-runtime" data-mode="${this.mode}">
      <div class="nv-app-page" id="nv-app-page"></div>
    </div>`;
    this._pageEl = this.mountEl.querySelector('#nv-app-page');

    // Subscribe to page navigation events
    const unsub = this.context.on('runtime:navigate', ({ pageId }) => {
      this._renderPage(pageId);
    });
    this._unsubs.push(unsub);

    // Render the first page
    const firstPage = this.context.appSchema.pages?.[0];
    if (firstPage) {
      await this._renderPage(firstPage.id);
    }
  }

  // ── Page Rendering ─────────────────────────────────────────────────────────
  async _renderPage(pageId) {
    const page = this.context.appSchema.pages?.find(p => p.id === pageId);
    if (!page) {
      this._pageEl.innerHTML = `<div class="nv-app-error">Page not found: ${pageId}</div>`;
      return;
    }

    this._activePage = page;
    this._pageEl.innerHTML = '';
    this._pageEl.setAttribute('data-page-id', pageId);

    // Render each component in the page layout
    for (const componentRef of (page.layout || [])) {
      const el = await this._renderComponent(componentRef);
      if (el) this._pageEl.appendChild(el);
    }
  }

  // ── Component Rendering ────────────────────────────────────────────────────
  async _renderComponent(componentRef) {
    const { componentId, componentType, bindings = {}, props = {} } = componentRef;

    const factory = AppComponentRegistry.get(componentType);
    if (!factory) {
      const errEl = document.createElement('div');
      errEl.className = 'nv-app-component-error';
      errEl.textContent = `Unknown component type: "${componentType}"`;
      return errEl;
    }

    // Resolve bindings: replace binding expressions with live values
    const resolvedProps = this._resolveBindings(props, bindings);

    // Create a container for the component
    const container = document.createElement('div');
    container.className = 'nv-app-component';
    container.setAttribute('data-component-id', componentId);
    container.setAttribute('data-component-type', componentType);

    // Mount the component
    const instance = factory({
      container,
      props:    resolvedProps,
      context:  this.context,
      componentId,
    });

    // Wire reactive re-render: when bound state paths change, re-render
    for (const [propKey, bindingExpr] of Object.entries(bindings)) {
      if (typeof bindingExpr === 'string' && bindingExpr.startsWith('state:')) {
        const statePath = bindingExpr.slice(6);
        const unsub = this.context.onStateChange(statePath, () => {
          const newProps = this._resolveBindings(props, bindings);
          instance?.update?.(newProps);
        });
        this._unsubs.push(unsub);
      }
    }

    return container;
  }

  // ── Binding Resolution ─────────────────────────────────────────────────────
  /**
   * Resolve binding expressions in a props object.
   * Binding expressions:
   *   "state:<path>"         → reads from app state
   *   "data:<collectionId>"  → queries a collection
   *   "literal:<value>"      → returns the value as-is
   *
   * @param {object} props
   * @param {object} bindings
   * @returns {object}
   */
  _resolveBindings(props, bindings) {
    const resolved = { ...props };
    for (const [propKey, bindingExpr] of Object.entries(bindings)) {
      if (typeof bindingExpr !== 'string') {
        resolved[propKey] = bindingExpr;
        continue;
      }
      if (bindingExpr.startsWith('state:')) {
        resolved[propKey] = this.context.getState(bindingExpr.slice(6));
      } else if (bindingExpr.startsWith('data:')) {
        const parts = bindingExpr.slice(5).split('?');
        const collectionId = parts[0];
        const query = parts[1] ? this._parseQuery(parts[1]) : {};
        resolved[propKey] = this.context.query(collectionId, query);
      } else if (bindingExpr.startsWith('literal:')) {
        resolved[propKey] = bindingExpr.slice(8);
      } else {
        resolved[propKey] = bindingExpr;
      }
    }
    return resolved;
  }

  _parseQuery(queryStr) {
    // Simple key=value parser for binding query strings
    const q = {};
    for (const part of queryStr.split('&')) {
      const [k, v] = part.split('=');
      if (k) q[k] = v;
    }
    return q;
  }

  // ── Full Re-render ─────────────────────────────────────────────────────────
  renderAll() {
    if (this._activePage) {
      this._renderPage(this._activePage.id);
    }
  }

  // ── Unmount ────────────────────────────────────────────────────────────────
  unmount() {
    for (const unsub of this._unsubs) {
      try { unsub(); } catch { /* ignore */ }
    }
    this._unsubs = [];
    if (this.mountEl) this.mountEl.innerHTML = '';
  }
}

export default AppRenderer;
