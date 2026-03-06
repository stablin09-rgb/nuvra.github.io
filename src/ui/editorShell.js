/**
 * editorShell.js — Nuvra Foundation (Phase 0–1)
 *
 * The Live Editor Shell.
 *
 * This module owns the editor UI. It is a runtime module registered
 * with CoreRuntime. It renders and updates the UI in response to
 * state changes — never by direct DOM manipulation from other modules.
 *
 * Principles:
 *  - All UI state comes from the store (via selectors)
 *  - All user interactions dispatch actions to the store
 *  - The shell re-renders only the parts of the UI that changed
 *  - No static HTML pretending to be interactive
 *  - No page reloads, no DOM hacks
 *
 * Architecture:
 *  - editorShell.js    — top-level shell, mounts panels
 *  - panels/toolbar.js — page selector, device mode, zoom controls
 *  - panels/sidebar.js — block/style/layer panels
 *  - panels/canvas.js  — the editable canvas area
 *  - controls/*.js     — reusable UI controls (button, select, modal, toast)
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
import { pageManager }   from '../pages/pageManager.js';
import { toolbar }       from './panels/toolbar.js';
import { sidebar }       from './panels/sidebar.js';
import { canvas }        from './panels/canvas.js';
import { toastManager }  from './controls/toast.js';

// ─── EditorShell Module ───────────────────────────────────────────────────────
export const editorShell = {
  id:   'editorShell',
  deps: ['pageManager'],

  _rootEl:     null,
  _unsubscribe: null,

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  init(runtime) {
    logger.info('editorShell', 'Initializing editor shell');
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
    if (this._rootEl) this._rootEl.innerHTML = '';
  },

  // ── Shell Construction ─────────────────────────────────────────────────────
  _buildShell() {
    this._rootEl.innerHTML = `
      <div id="nv-toolbar"  class="nv-toolbar"></div>
      <div id="nv-body"     class="nv-body">
        <div id="nv-sidebar" class="nv-sidebar"></div>
        <div id="nv-canvas"  class="nv-canvas"></div>
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
    } catch (err) {
      errorBoundary.capture(err, {
        module:   'editorShell',
        context:  'render',
        severity: ErrorSeverity.HIGH,
      });
    }
  },

  _onStateChange(newState, prevState) {
    // Only re-render panels whose relevant state has changed
    const activeChanged   = newState.editor.activePageId !== prevState.editor.activePageId;
    const pagesChanged    = newState.pages !== prevState.pages;
    const deviceChanged   = newState.editor.deviceMode !== prevState.editor.deviceMode;
    const sidebarChanged  = newState.editor.sidebarPanel !== prevState.editor.sidebarPanel;
    const dirtyChanged    = newState.editor.isDirty !== prevState.editor.isDirty;
    const notifChanged    = newState.ui.notifications !== prevState.ui.notifications;

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
  },
};

export default editorShell;
