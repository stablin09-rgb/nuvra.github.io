/**
 * editorShell.js — Nuvra Phase 2–2.5
 *
 * The Live Editor Shell.
 *
 * Extended in Phase 2–2.5 to include the Planning Panel.
 * The sidebar now has a 'planning' panel mode that shows the
 * Explainability & Introspection UI.
 *
 * @module ui/editorShell
 */
'use strict';

import { store }         from '../state/store.js';
import { eventBus }      from '../runtime/eventBus.js';
import { logger }        from '../diagnostics/logger.js';
import { errorBoundary, ErrorSeverity } from '../diagnostics/errorBoundary.js';
import {
  selectActivePage,
  selectAllPages,
  selectActivePageId,
  selectDeviceMode,
  selectSidebarPanel,
  selectIsDirty,
  selectIsBooted,
  selectNotifications,
} from '../state/selectors.js';
import { pageManager }    from '../pages/pageManager.js';
import { toolbar }        from './panels/toolbar.js';
import { sidebar }        from './panels/sidebar.js';
import { canvas }         from './panels/canvas.js';
import { toastManager }   from './controls/toast.js';
import { planningPanel }  from './panels/planningPanel.js';
import { marketplaceCatalog } from './panels/marketplaceCatalog.js';
import { mobileReadinessDashboard } from './panels/mobileReadinessDashboard.js';

// ─── EditorShell Module ───────────────────────────────────────────────────────
export const editorShell = {
  id:   'editorShell',
  deps: ['pageManager', 'planningEngine'],

  _rootEl:      null,
  _unsubscribe: null,

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  init(runtime) {
    logger.info('editorShell', 'Initializing editor shell (Phase 2–2.5)');
  },

  start(runtime) {
    logger.info('editorShell', 'Starting editor shell');

    // Mount root
    this._rootEl = document.getElementById('nv-app');
    if (!this._rootEl) {
      errorBoundary.capture(new Error('editorShell: #nv-app element not found in DOM'), {
        module:   'editorShell',
        severity: ErrorSeverity.CRITICAL,
      });
      return;
    }

    // Build the shell structure
    this._buildShell();

    // Mount sub-panels
    toolbar.mount(document.getElementById('nv-toolbar'));
    sidebar.mount(document.getElementById('nv-sidebar'));
    canvas.mount(document.getElementById('nv-canvas'));
    toastManager.mount(document.getElementById('nv-toasts'));
    
    // Mount extra panels (Phase 2, 8, 9)
    planningPanel.mount(document.getElementById("nv-planning-panel"));
    
    const marketplaceEl = document.getElementById("nv-marketplace-panel");
    if (marketplaceEl) marketplaceCatalog.mount(marketplaceEl);
    
    const mobileEl = document.getElementById("nv-mobile-panel");
    if (mobileEl) mobileReadinessDashboard.mount(mobileEl);

    // Subscribe to store — update UI on state changes
    this._unsubscribe = store.subscribe((newState, prevState) => {
      this._onStateChange(newState, prevState);
    });

    // Subscribe to notification events
    eventBus.on('diagnostics:log', (entry) => {
      if (entry.level >= 3 /* ERROR */) {
        toastManager.show(entry.message, 'error');
      }
    });

    // Show toast on planning progress
    eventBus.on('ai:progress', ({ stage, message }) => {
      toastManager.show(message, 'info', 3000);
    });

    // Show toast on planning complete
    eventBus.on('ai:pipeline_complete', ({ siteId }) => {
      toastManager.show('Plan ready — review in the Planning panel', 'success', 4000);
    });

    // Initial render
    this._render(store.getState());

    logger.info('editorShell', 'Editor shell started');
  },

  stop() {
    this._unsubscribe?.();
    toolbar.unmount();
    sidebar.unmount();
    canvas.unmount();
    toastManager.unmount();
    planningPanel.unmount();
    marketplaceCatalog.unmount();
    mobileReadinessDashboard.unmount();
    if (this._rootEl) this._rootEl.innerHTML = '';
  },

  // ── Shell Construction ─────────────────────────────────────────────────────
  _buildShell() {
    this._rootEl.innerHTML = `
      <div id="nv-toolbar"  class="nv-toolbar"></div>
      <div id="nv-body"     class="nv-body">
        <div id="nv-sidebar"         class="nv-sidebar"></div>
        <div id="nv-canvas"          class="nv-canvas"></div>
        <div id="nv-planning-panel"  class="nv-planning-panel-container nv-panel-hidden"></div>
        <div id="nv-marketplace-panel" class="nv-marketplace-panel-container nv-panel-hidden"></div>
        <div id="nv-mobile-panel"      class="nv-mobile-panel-container nv-panel-hidden"></div>
      </div>
      <div id="nv-toasts"   class="nv-toasts"></div>
    `;
  },

  // ── State-Driven Rendering ─────────────────────────────────────────────────
  _render(state) {
    try {
      toolbar.render(state);
      sidebar.render(state);
      canvas.render(state);
      
      // Render side-panels
      this._renderPlanningPanel(state);
      this._renderMarketplaceCatalog(state);
      this._renderMobileReadinessDashboard(state);
    } catch (err) {
      errorBoundary.capture(err, {
        module:   'editorShell',
        context:  'render',
        severity: ErrorSeverity.HIGH,
      });
    }
  },

  _renderPlanningPanel(state) {
    const panelEl = document.getElementById('nv-planning-panel');
    if (!panelEl) return;
    const isOpen = state.ui?.panels?.['planning'] || false;
    panelEl.classList.toggle('nv-panel-hidden', !isOpen);
    if (isOpen) planningPanel.render();
  },

  _onStateChange(newState, prevState) {
    const activeChanged   = newState.editor.activePageId !== prevState.editor.activePageId;
    const pagesChanged    = newState.pages !== prevState.pages;
    const deviceChanged   = newState.editor.deviceMode !== prevState.editor.deviceMode;
    const sidebarChanged  = newState.editor.sidebarPanel !== prevState.editor.sidebarPanel;
    const dirtyChanged    = newState.editor.isDirty !== prevState.editor.isDirty;
    const notifChanged    = newState.ui.notifications !== prevState.ui.notifications;
    const panelChanged    = newState.ui.panels !== prevState.ui.panels;
    const aiChanged       = newState.ai !== prevState.ai;

    if (activeChanged || pagesChanged || deviceChanged || dirtyChanged) {
      toolbar.render(newState);
    }
    if (sidebarChanged) {
      sidebar.render(newState);
    }
    if (activeChanged || pagesChanged) {
      canvas.render(newState);
    }
    if (notifChanged) {
      toastManager.syncFromState(newState);
    }
    if (panelChanged || aiChanged) {
      this._renderPlanningPanel(newState);
      this._renderMarketplaceCatalog(newState);
      this._renderMobileReadinessDashboard(newState);
    }
  },

  _renderMarketplaceCatalog(state) {
    const panelEl = document.getElementById('nv-marketplace-panel');
    if (!panelEl) return;
    const isOpen = state.ui?.panels?.['marketplace'] || false;
    panelEl.classList.toggle('nv-panel-hidden', !isOpen);
    if (isOpen) marketplaceCatalog.render();
  },

  _renderMobileReadinessDashboard(state) {
    const panelEl = document.getElementById('nv-mobile-panel');
    if (!panelEl) return;
    const isOpen = state.ui?.panels?.['mobile'] || false;
    panelEl.classList.toggle('nv-panel-hidden', !isOpen);
    if (isOpen) mobileReadinessDashboard.render();
  }
};

export default editorShell;'''
