/**
 * sidebar.js — Nuvra Foundation (Phase 0–1)
 *
 * The Sidebar panel.
 * Renders the panel tab switcher (Blocks / Style / Layers).
 * Content of each panel is provided by future phases.
 *
 * @module ui/panels/sidebar
 */
'use strict';

import { store }           from '../../state/store.js';
import { selectSidebarPanel } from '../../state/selectors.js';

const PANELS = [
  { id: 'blocks', label: 'Blocks' },
  { id: 'style',  label: 'Style'  },
  { id: 'layers', label: 'Layers' },
];

export const sidebar = {
  _el: null,

  mount(el) {
    if (!el) return;
    this._el = el;
    this._el.addEventListener('click', this._onClick.bind(this));
  },

  unmount() { this._el = null; },

  render(state) {
    if (!this._el) return;
    const active = selectSidebarPanel(state);

    this._el.innerHTML = `
      <div class="nv-sidebar-tabs" role="tablist">
        ${PANELS.map(p => `
          <button
            class="nv-sidebar-tab ${p.id === active ? 'active' : ''}"
            data-panel="${p.id}"
            role="tab"
            aria-selected="${p.id === active}"
            aria-controls="nv-panel-${p.id}">
            ${p.label}
          </button>
        `).join('')}
      </div>
      <div class="nv-sidebar-content">
        ${PANELS.map(p => `
          <div
            id="nv-panel-${p.id}"
            class="nv-panel ${p.id === active ? 'active' : ''}"
            role="tabpanel"
            aria-hidden="${p.id !== active}">
            <div class="nv-panel-placeholder">
              ${p.label} panel — content provided by future phases.
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },

  _onClick(e) {
    const panelId = e.target.closest('[data-panel]')?.dataset.panel;
    if (panelId) {
      store.dispatch({ type: 'EDITOR/SET_SIDEBAR_PANEL', payload: panelId });
    }
  },
};

export default sidebar;
