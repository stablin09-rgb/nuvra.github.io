/**
 * Nuvra Builder — Export & Import Module
 *
 * Handles all export (single page, full site, project JSON) and
 * import (project JSON) operations.
 *
 * Export formats:
 *  - Single page  → standalone .html file with inlined CSS
 *  - Full site    → one .html file per page (downloaded sequentially)
 *  - Project JSON → full state snapshot for backup / transfer
 *
 * Import:
 *  - Project JSON → restores all pages and editor state
 */

'use strict';

import { downloadFile, showToast } from '../utils/helpers.js';
import { serializeProject, deserializeProject } from './storage.js';
import { getSnapshot, loadPages } from './pageManager.js';

// ─── Export ───────────────────────────────────────────────────────────────────

/**
 * Export the currently active page as a standalone HTML file.
 *
 * @param {object} editor - GrapesJS editor instance
 */
export function exportCurrentPage(editor) {
  const { pages, currentPage } = getSnapshot();
  const page = pages[currentPage];

  const html = _buildStandaloneHtml(page.name, page.html, editor.getCss());
  downloadFile(`${currentPage}.html`, html, 'text/html');
  showToast(`Exported "${page.name}" as HTML.`, 'success');
}

/**
 * Export every page as individual HTML files.
 * Files are downloaded one by one with a short delay to avoid browser blocking.
 *
 * @param {object} editor - GrapesJS editor instance
 */
export function exportFullSite(editor) {
  const { pages } = getSnapshot();
  const ids = Object.keys(pages);

  // Use the shared CSS from the current editor state for all pages
  const sharedCss = editor.getCss();

  ids.forEach((id, index) => {
    const page = pages[id];
    const html = _buildStandaloneHtml(page.name, page.html, page.css || sharedCss);

    // Stagger downloads slightly so browsers don't block them
    setTimeout(() => {
      downloadFile(`${id}.html`, html, 'text/html');
    }, index * 120);
  });

  showToast(`Exported ${ids.length} page(s) as HTML files.`, 'success');
}

/**
 * Export the full project as a JSON file for backup or transfer.
 */
export function exportProjectJson() {
  const { pages, currentPage } = getSnapshot();
  const json = serializeProject(pages, currentPage);
  downloadFile('nuvra-project.json', json, 'application/json');
  showToast('Project exported as JSON.', 'success');
}

// ─── Import ───────────────────────────────────────────────────────────────────

/**
 * Open a file picker and import a Nuvra project JSON file.
 * On success, replaces all current pages with the imported data.
 */
export function importProjectJson() {
  const input    = document.createElement('input');
  input.type     = 'file';
  input.accept   = '.json,application/json';

  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.addEventListener('load', () => {
      try {
        const project = deserializeProject(reader.result);
        loadPages(project.pages, project.currentPage);
        showToast('Project imported successfully.', 'success');
      } catch (err) {
        showToast(`Import failed: ${err.message}`, 'error');
      }
    });

    reader.readAsText(file);
  });

  input.click();
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

/**
 * Build a complete, self-contained HTML document string.
 *
 * @param {string} title - Page <title>
 * @param {string} body  - Inner HTML for <body>
 * @param {string} css   - CSS string to inline in <style>
 * @returns {string}
 */
function _buildStandaloneHtml(title, body, css) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${_escapeHtml(title)}</title>
  <style>
${css || ''}
  </style>
</head>
<body>
${body || ''}
</body>
</html>`;
}

/**
 * Escape HTML special characters to prevent XSS in title attributes.
 *
 * @param {string} str
 * @returns {string}
 */
function _escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
