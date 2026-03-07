/**
 * toolbar.js — Nuvra Foundation (Phase 0–1)
 *
 * The Toolbar panel.
 * Renders the page selector, device mode toggle, zoom controls,
 * and save indicator. All state-driven.
 *
 * @module ui/panels/toolbar
 */
'use strict';

import { store }       from '../../state/store.js';
import { eventBus }    from '../../runtime/eventBus.js';
import {
  selectAllPages,
  selectActivePageId,
  selectDeviceMode,
  selectZoom,
  selectIsDirty,
  selectLastSavedAt,
} from '../../state/selectors.js';
import { pageManager } from '../../pages/pageManager.js';
import { formatTs }    from '../../runtime/utils.js';

export const toolbar = {
  _el: null,

  mount(el) {
    if (!el) return;
    this._el = el;
    this._el.addEventListener('click',  this._onClick.bind(this));
    this._el.addEventListener('change', this._onChange.bind(this));
  },

  unmount() {
    this._el = null;
  },

  render(state) {
    if (!this._el) return;

    const pages       = selectAllPages(state);
    const activeId    = selectActivePageId(state);
    const deviceMode  = selectDeviceMode(state);
    const zoom        = selectZoom(state);
    const isDirty     = selectIsDirty(state);
    const lastSaved   = selectLastSavedAt(state);

    this._el.innerHTML = `
      <div class="nv-toolbar-inner">
        <!-- Brand -->
        <span class="nv-brand">Nu<span>vra</span></span>
        <div class="nv-divider"></div>

        <!-- Page Selector -->
        <label class="nv-sr-only" for="nv-page-select">Page</label>
        <select id="nv-page-select" class="nv-select" data-action="switch-page">
          ${pages.map(p => `
            <option value="${p.id}" ${p.id === activeId ? 'selected' : ''}>
              ${this._esc(p.name)}
            </option>
          `).join('')}
        </select>

        <!-- Page Actions -->
        <button class="nv-btn" data-action="add-page"    title="Add page">+ Page</button>
        <button class="nv-btn" data-action="rename-page" title="Rename page" ${!activeId ? 'disabled' : ''}>Rename</button>
        <button class="nv-btn nv-btn-danger" data-action="delete-page" title="Delete page"
          ${pages.length <= 1 ? 'disabled' : ''}>Delete</button>

        <div class="nv-divider"></div>

        <!-- AI Actions -->
        <button class="nv-btn nv-btn-primary" data-action="ai-generate" title="Generate with AI">Generate</button>
        <button class="nv-btn" data-action="toggle-planning-panel" title="Toggle Planning Panel">Planning</button>

        <div class="nv-divider"></div>

        <!-- Device Mode -->
        <div class="nv-device-group" role="group" aria-label="Device mode">
          <button class="nv-btn nv-device-btn ${deviceMode === 'desktop' ? 'active' : ''}"
            data-action="device-desktop" title="Desktop">&#128187;</button>
          <button class="nv-btn nv-device-btn ${deviceMode === 'tablet' ? 'active' : ''}"
            data-action="device-tablet"  title="Tablet">&#128213;</button>
          <button class="nv-btn nv-device-btn ${deviceMode === 'mobile' ? 'active' : ''}"
            data-action="device-mobile"  title="Mobile">&#128241;</button>
        </div>

        <div class="nv-divider"></div>

        <!-- Zoom -->
        <button class="nv-btn" data-action="zoom-out" title="Zoom out">&#8722;</button>
        <span class="nv-zoom-label" aria-live="polite">${Math.round(zoom * 100)}%</span>
        <button class="nv-btn" data-action="zoom-in"  title="Zoom in">+</button>
        <button class="nv-btn" data-action="zoom-reset" title="Reset zoom">&#8635;</button>

        <div class="nv-divider"></div>

        <!-- Save Indicator -->
        <span class="nv-save-indicator ${isDirty ? 'dirty' : 'clean'}" aria-live="polite">
          ${isDirty
            ? '&#9679; Unsaved'
            : lastSaved
              ? `&#10003; Saved ${formatTs(lastSaved).slice(11)}`
              : '&#10003; Saved'}
        </span>
        <button class="nv-btn nv-btn-primary" data-action="save" title="Save" ${!isDirty ? 'disabled' : ''}>
          Save
        </button>

        <div class="nv-divider"></div>

        <!-- User/Profile Menu Placeholder -->
        <div class="nv-profile-menu">
          <button class="nv-btn" id="nv-profile-btn" data-action="toggle-profile-menu" title="User Profile" hint="User Profile">
            &#128100; Profile
          </button>
          <div class="nv-profile-dropdown nv-panel-hidden">
            <div class="nv-profile-item" data-action="show-billing">Billing Dashboard</div>
            <div class="nv-profile-item" data-action="show-cloud-sync">Cloud Sync Status</div>
            <div class="nv-profile-item" data-action="logout">Logout</div>
          </div>
        </div>
      </div>
    `;
  },

  _onClick(e) {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;

    switch (action) {
      case 'add-page': {
        const name = prompt('Page name:');
        if (name?.trim()) {
          try { pageManager.addPage({ name: name.trim() }); }
          catch (err) { alert(err.message); }
        }
        break;
      }
      case 'rename-page': {
        const active = pageManager.getActivePage();
        if (!active) break;
        const name = prompt('New name:', active.name);
        if (name?.trim()) {
          try { pageManager.updatePage(active.id, { name: name.trim() }); }
          catch (err) { alert(err.message); }
        }
        break;
      }
      case 'delete-page': {
        const active = pageManager.getActivePage();
        if (!active) break;
        if (confirm(`Delete page "${active.name}"?`)) {
          try { pageManager.removePage(active.id); }
          catch (err) { alert(err.message); }
        }
        break;
      }
      case 'device-desktop':
        store.dispatch({ type: 'EDITOR/SET_DEVICE_MODE', payload: 'desktop' }); break;
      case 'device-tablet':
        store.dispatch({ type: 'EDITOR/SET_DEVICE_MODE', payload: 'tablet' });  break;
      case 'device-mobile':
        store.dispatch({ type: 'EDITOR/SET_DEVICE_MODE', payload: 'mobile' });  break;
      case 'zoom-in':
        store.dispatch({ type: 'EDITOR/SET_ZOOM', payload: selectZoom(store.getState()) + 0.1 }); break;
      case 'zoom-out':
        store.dispatch({ type: 'EDITOR/SET_ZOOM', payload: selectZoom(store.getState()) - 0.1 }); break;
      case 'zoom-reset':
        store.dispatch({ type: 'EDITOR/SET_ZOOM', payload: 1 }); break;
      case 'save':
        eventBus.emit('editor:save_requested', {}); break;
      case 'ai-generate':
        eventBus.emit('ai:generate_requested', {}); break;
      case 'toggle-planning-panel':
        store.dispatch({ type: 'UI/TOGGLE_PANEL', payload: 'planning' }); break;
      case 'toggle-profile-menu':
        // Emit event so admin console (or other panels) can respond
        eventBus.emit('ui:toggle_profile_panel', {});
        break;
      case 'show-billing':
        // Handle showing billing dashboard
        alert('Billing Dashboard clicked!');
        // In a real app, you'd dispatch an action to show the billing dashboard UI
        break;
      case 'show-cloud-sync':
        // Handle showing cloud sync status
        alert('Cloud Sync Status clicked!');
        // In a real app, you'd dispatch an action to show the cloud sync status UI
        break;
      case 'logout':
        // Handle logout
        alert('Logout clicked!');
        // In a real app, you'd dispatch an action to handle user logout
        break;
    }
  },

  _onChange(e) {
    if (e.target.dataset.action === 'switch-page') {
      try { pageManager.setActivePage(e.target.value); }
      catch (err) { console.error(err); }
    }
  },

  _esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },
};

export default toolbar;
