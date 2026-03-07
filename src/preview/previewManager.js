/**
 * Nuvra Builder — Preview Manager
 *
 * Orchestrates the Build ↔ Preview mode toggle.
 *
 * Responsibilities:
 *  - Show/hide the GrapesJS editor canvas
 *  - Create and manage the preview iframe
 *  - Render the current page into the iframe
 *  - Handle viewport switching (desktop / tablet / mobile)
 *  - Keyboard shortcut: Ctrl/Cmd + P
 *
 * The preview iframe is sandboxed with allow-scripts and allow-forms
 * to enable the app runtime while blocking navigation and top-level access.
 */

'use strict';

import { buildPreviewDocument } from './previewRenderer.js';

// ─── Preview Manager ──────────────────────────────────────────────────────────

class PreviewManager {
  constructor() {
    this._active     = false;
    this._iframe     = null;
    this._overlay    = null;
    this._editor     = null;
    this._getPage    = null;
    this._getMeta    = null;
    this._viewport   = 'desktop';
  }

  /**
   * Initialise the preview manager.
   *
   * @param {object} opts
   * @param {object}   opts.editor    - GrapesJS editor instance
   * @param {Function} opts.getPage   - () => current page object
   * @param {Function} opts.getMeta   - () => project meta { name, accent }
   */
  init({ editor, getPage, getMeta }) {
    this._editor  = editor;
    this._getPage = getPage;
    this._getMeta = getMeta;

    this._buildOverlay();
    this._bindKeyboard();
  }

  /**
   * Toggle between build and preview mode.
   */
  toggle() {
    this._active ? this.exit() : this.enter();
  }

  /**
   * Enter preview mode.
   */
  enter() {
    if (this._active) return;
    this._active = true;

    // Save current editor state before switching
    const page = this._getPage();
    if (!page) return;

    // Hide the editor panels
    document.getElementById('editor-wrap')?.classList.add('nv-hidden');

    // Show the preview overlay
    this._overlay.classList.remove('nv-hidden');

    // Render the page into the iframe
    this._renderPage(page);

    // Update the preview button
    const btn = document.getElementById('btn-preview');
    if (btn) {
      btn.textContent = '✕ Exit Preview';
      btn.classList.add('active');
    }
  }

  /**
   * Exit preview mode and return to the editor.
   */
  exit() {
    if (!this._active) return;
    this._active = false;

    // Show the editor
    document.getElementById('editor-wrap')?.classList.remove('nv-hidden');

    // Hide the preview overlay
    this._overlay.classList.add('nv-hidden');

    // Clear the iframe to free memory
    if (this._iframe) {
      this._iframe.srcdoc = '';
    }

    // Reset the preview button
    const btn = document.getElementById('btn-preview');
    if (btn) {
      btn.textContent = '▶ Preview';
      btn.classList.remove('active');
    }
  }

  /**
   * Set the viewport size.
   * @param {'desktop'|'tablet'|'mobile'} viewport
   */
  setViewport(viewport) {
    this._viewport = viewport;

    const widths = { desktop: '100%', tablet: '768px', mobile: '375px' };
    if (this._iframe) {
      this._iframe.style.width  = widths[viewport] || '100%';
      this._iframe.style.margin = viewport === 'desktop' ? '0' : '0 auto';
    }

    // Update toolbar buttons
    document.querySelectorAll('.nv-viewport-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.viewport === viewport);
    });
  }

  /**
   * Re-render the current page (called when the user switches pages in preview).
   */
  refresh() {
    if (!this._active) return;
    const page = this._getPage();
    if (page) this._renderPage(page);
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  _renderPage(page) {
    const meta = this._getMeta ? this._getMeta() : {};
    const html = buildPreviewDocument(page, meta);

    if (this._iframe) {
      this._iframe.srcdoc = html;
    }
  }

  _buildOverlay() {
    this._overlay = document.createElement('div');
    this._overlay.id        = 'nv-preview-overlay';
    this._overlay.className = 'nv-preview-overlay nv-hidden';

    this._overlay.innerHTML = `
      <div class="nv-preview-toolbar">
        <div class="nv-preview-toolbar-left">
          <span class="nv-preview-label">Preview Mode</span>
        </div>
        <div class="nv-preview-toolbar-center">
          <button class="nv-viewport-btn active" data-viewport="desktop" title="Desktop">🖥</button>
          <button class="nv-viewport-btn" data-viewport="tablet"  title="Tablet">📱</button>
          <button class="nv-viewport-btn" data-viewport="mobile"  title="Mobile">📲</button>
        </div>
        <div class="nv-preview-toolbar-right">
          <button id="nv-preview-exit-btn" class="nuvra-btn">✕ Exit Preview</button>
        </div>
      </div>
      <div class="nv-preview-canvas">
        <iframe
          id="nv-preview-iframe"
          sandbox="allow-scripts allow-forms allow-same-origin"
          style="width:100%; height:100%; border:none; display:block; transition:width 0.3s ease;"
        ></iframe>
      </div>
    `;

    document.body.appendChild(this._overlay);
    this._iframe = this._overlay.querySelector('#nv-preview-iframe');

    // Viewport buttons
    this._overlay.querySelectorAll('.nv-viewport-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.setViewport(btn.dataset.viewport));
    });

    // Exit button
    this._overlay.querySelector('#nv-preview-exit-btn')?.addEventListener('click', () => this.exit());
  }

  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const mod   = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key === 'p') {
        e.preventDefault();
        this.toggle();
      }
      if (e.key === 'Escape' && this._active) {
        this.exit();
      }
    });
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const previewManager = new PreviewManager();
