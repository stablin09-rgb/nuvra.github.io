/**
 * selectors.js — Nuvra Foundation (Phase 0–1)
 *
 * Pure selector functions for reading derived state.
 * Selectors MUST be pure: (state) => value.
 * They MUST NOT mutate state or have side effects.
 *
 * Selectors are the ONLY way to read state outside the store.
 * Components and modules import selectors, not raw state slices.
 *
 * @module state/selectors
 */
'use strict';

// ─── Editor Selectors ─────────────────────────────────────────────────────────
export const selectActivePageId    = (s) => s.editor.activePageId;
export const selectSelectedElement = (s) => s.editor.selectedElement;
export const selectHoverElement    = (s) => s.editor.hoverElement;
export const selectZoom            = (s) => s.editor.zoom;
export const selectGridEnabled     = (s) => s.editor.gridEnabled;
export const selectSnapEnabled     = (s) => s.editor.snapEnabled;
export const selectDeviceMode      = (s) => s.editor.deviceMode;
export const selectSidebarPanel    = (s) => s.editor.sidebarPanel;
export const selectIsDirty         = (s) => s.editor.isDirty;

// ─── Pages Selectors ──────────────────────────────────────────────────────────
export const selectPagesById   = (s) => s.pages.byId;
export const selectPageOrder   = (s) => s.pages.order;
export const selectPageCount   = (s) => s.pages.order.length;
export const selectHasPages    = (s) => s.pages.order.length > 0;

/**
 * Get a page record by ID.
 * @param {object} state
 * @param {string} pageId
 */
export const selectPageById = (state, pageId) => state.pages.byId[pageId] || null;

/**
 * Get all pages in display order.
 * @param {object} state
 * @returns {Array}
 */
export const selectAllPages = (state) =>
  state.pages.order.map(id => state.pages.byId[id]).filter(Boolean);

/**
 * Get the currently active page record.
 * @param {object} state
 * @returns {object|null}
 */
export const selectActivePage = (state) => {
  const id = selectActivePageId(state);
  return id ? selectPageById(state, id) : null;
};

/**
 * Get the content of the active page.
 * @param {object} state
 * @returns {*}
 */
export const selectActivePageContent = (state) => {
  const page = selectActivePage(state);
  return page ? page.content : null;
};

// ─── UI Selectors ─────────────────────────────────────────────────────────────
export const selectModals        = (s) => s.ui.modals;
export const selectPanels        = (s) => s.ui.panels;
export const selectNotifications = (s) => s.ui.notifications;
export const selectTheme         = (s) => s.ui.theme;

/**
 * Check if a specific modal is open.
 * @param {object} state
 * @param {string} modalId
 */
export const selectIsModalOpen = (state, modalId) => !!state.ui.modals[modalId];

/**
 * Check if a specific panel is open.
 * @param {object} state
 * @param {string} panelId
 */
export const selectIsPanelOpen = (state, panelId) => !!state.ui.panels[panelId];

/**
 * Check if a loading key is active.
 * @param {object} state
 * @param {string} key
 */
export const selectIsLoading = (state, key) => !!state.ui.loading[key];

// ─── Flags Selectors ──────────────────────────────────────────────────────────
export const selectIsBooted    = (s) => s.flags.isBooted;
export const selectIsOnline    = (s) => s.flags.isOnline;
export const selectIsSaving    = (s) => s.flags.isSaving;
export const selectLastSavedAt = (s) => s.flags.lastSavedAt;
export const selectSchemaVersion = (s) => s.flags.schemaVersion;
