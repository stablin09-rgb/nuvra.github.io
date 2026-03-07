/**
 * Nuvra Builder — Page Manager
 *
 * Manages the multi-page state: creating, switching, renaming, and deleting
 * pages. Keeps the GrapesJS editor and the UI dropdown in sync.
 *
 * This module is intentionally stateful (it owns `pages` and `currentPage`)
 * and exposes a clean API so that other modules never touch the raw state.
 */

'use strict';

import { slugify, showToast, promptModal, confirmModal } from '../utils/helpers.js';
import { saveProject } from './storage.js';
import { debounce } from '../utils/helpers.js';

// ─── Internal State ──────────────────────────────────────────────────────────

let editor      = null;   // GrapesJS editor instance (injected via init)
let pages       = {};     // { [pageId]: { name, html, css } }
let currentPage = 'home'; // ID of the active page

const pageSelect = document.getElementById('pageSelect');

// ─── Debounced Autosave ───────────────────────────────────────────────────────

const debouncedSave = debounce(() => {
  _snapshotCurrentPage();
  saveProject(pages, currentPage);
}, 600);

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Initialise the page manager with a GrapesJS editor instance.
 * Must be called once after the editor is ready.
 *
 * @param {object} grapesEditor - GrapesJS editor instance
 * @param {object} initialPages - Restored pages map (from storage or default)
 * @param {string} activePage   - ID of the page to load first
 */
export function init(grapesEditor, initialPages, activePage) {
  editor      = grapesEditor;
  pages       = initialPages;
  currentPage = activePage;

  // Bind editor change events to autosave
  const saveEvents = [
    'component:update',
    'component:add',
    'component:remove',
    'style:property:update',
    'canvas:drop',
  ];
  saveEvents.forEach((event) => editor.on(event, debouncedSave));

  // Failsafe interval save (every 15 s)
  setInterval(() => {
    _snapshotCurrentPage();
    saveProject(pages, currentPage);
  }, 15_000);

  // Bind page selector dropdown
  pageSelect.addEventListener('change', () => switchPage(pageSelect.value));

  // Render initial dropdown
  _rebuildDropdown();

  // Load the active page into the editor
  _loadPageIntoEditor(currentPage);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Switch to a different page by ID.
 * Saves the current page state before switching.
 *
 * @param {string} pageId
 */
export function switchPage(pageId) {
  if (pageId === currentPage) return;
  if (!pages[pageId]) {
    showToast('Page not found.', 'error');
    return;
  }

  _snapshotCurrentPage();
  currentPage = pageId;
  _loadPageIntoEditor(pageId);
  pageSelect.value = pageId;
  saveProject(pages, currentPage);
}

/**
 * Add a new blank page.
 * Prompts the user for a name via a modal.
 */
export async function addPage() {
  const name = await promptModal('New Page', 'Page name…');
  if (!name) return;

  const id = slugify(name);

  if (pages[id]) {
    showToast(`A page with the slug "${id}" already exists.`, 'error');
    return;
  }

  _snapshotCurrentPage();

  pages[id] = {
    name,
    html: '',
    css:  '',
    meta: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  };

  _addDropdownOption(id, name);
  switchPage(id);
  showToast(`Page "${name}" created.`, 'success');
}

/**
 * Rename the currently active page.
 */
export async function renamePage() {
  const newName = await promptModal(
    'Rename Page',
    'New name…',
    pages[currentPage].name
  );
  if (!newName) return;

  pages[currentPage].name = newName;

  // Update dropdown label
  const option = [...pageSelect.options].find((o) => o.value === currentPage);
  if (option) option.textContent = newName;

  saveProject(pages, currentPage);
  showToast(`Page renamed to "${newName}".`, 'success');
}

/**
 * Delete the currently active page.
 * Prevents deletion when only one page remains.
 */
export async function deletePage() {
  const keys = Object.keys(pages);
  if (keys.length === 1) {
    showToast('You must keep at least one page.', 'error');
    return;
  }

  const confirmed = await confirmModal(
    'Delete Page',
    `Are you sure you want to delete "${pages[currentPage].name}"? This cannot be undone.`
  );
  if (!confirmed) return;

  const deletedId = currentPage;
  delete pages[deletedId];

  // Remove from dropdown
  const option = [...pageSelect.options].find((o) => o.value === deletedId);
  if (option) option.remove();

  // Switch to the first remaining page
  currentPage = Object.keys(pages)[0];
  pageSelect.value = currentPage;
  _loadPageIntoEditor(currentPage);

  saveProject(pages, currentPage);
  showToast('Page deleted.', 'success');
}

/**
 * Programmatically add a page with pre-defined content.
 * Used by the AI engine when generating a new page.
 *
 * @param {string} id   - Page slug/ID
 * @param {string} name - Human-readable page name
 * @param {string} html - Page HTML content
 * @param {string} css  - Page CSS content
 */
export function addGeneratedPage(id, name, html, css, schema = null, appMeta = null) {
  if (pages[id]) {
    // If the page already exists, update it
    pages[id] = { ...pages[id], name, html, css, schema, appMeta };
  } else {
    pages[id] = {
      name,
      html,
      css,
      schema,
      appMeta,
      meta: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    };
    _addDropdownOption(id, name);
  }

  switchPage(id);
  saveProject(pages, currentPage);
}

/**
 * Replace all pages with an imported project's page map.
 *
 * @param {object} newPages
 * @param {string} newCurrentPage
 */
export function loadPages(newPages, newCurrentPage) {
  pages       = newPages;
  currentPage = newCurrentPage;
  _rebuildDropdown();
  _loadPageIntoEditor(currentPage);
  saveProject(pages, currentPage);
}

/**
 * Return a read-only snapshot of the current pages map.
 * Ensures the current page's content is up to date before returning.
 *
 * @returns {{ pages: object, currentPage: string }}
 */
export function getSnapshot() {
  _snapshotCurrentPage();
  return { pages: { ...pages }, currentPage };
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

/** Capture the editor's current HTML/CSS into the active page entry. */
function _snapshotCurrentPage() {
  if (!editor || !pages[currentPage]) return;
  pages[currentPage].html = editor.getComponents().toHTML();
  pages[currentPage].css  = editor.getCss();
  if (pages[currentPage].meta) {
    pages[currentPage].meta.updatedAt = new Date().toISOString();
  }
}

/** Load a page's HTML/CSS into the GrapesJS editor. */
function _loadPageIntoEditor(pageId) {
  const page = pages[pageId];
  if (!page) return;
  editor.setComponents(page.html || '');
  editor.setStyle(page.css   || '');
}

/** Rebuild the page selector dropdown from scratch. */
function _rebuildDropdown() {
  pageSelect.innerHTML = '';
  Object.keys(pages).forEach((id) => {
    _addDropdownOption(id, pages[id].name);
  });
  pageSelect.value = currentPage;
}

/** Append a single option to the page selector dropdown. */
function _addDropdownOption(id, name) {
  const option       = document.createElement('option');
  option.value       = id;
  option.textContent = name;
  pageSelect.appendChild(option);
}
