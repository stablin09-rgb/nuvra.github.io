/**
 * Nuvra Builder — Publish Manager
 *
 * Orchestrates the end-to-end publish flow.
 *
 * Export targets:
 *  1. Static ZIP  — downloads a .zip file ready for any static host
 *  2. Live Preview — opens the published site in a new browser tab
 *
 * The ZIP is assembled in-browser using the fflate library (loaded from CDN).
 * No server is required.
 *
 * UI:
 *  - Opens a modal with a target selector and build report
 *  - Shows a progress bar during the build
 *  - Displays per-page build status
 */

'use strict';

import { buildSite } from './siteBuilder.js';

// ─── Publish Manager ──────────────────────────────────────────────────────────

class PublishManager {
  constructor() {
    this._modal      = null;
    this._getPages   = null;
    this._getStore   = null;
    this._getMeta    = null;
    this._target     = 'zip';
  }

  /**
   * Initialise the publish manager.
   *
   * @param {object}   opts
   * @param {Function} opts.getPages  - () => page[]
   * @param {Function} opts.getStore  - () => serialized DataStore snapshot
   * @param {Function} opts.getMeta   - () => { name, accent }
   */
  init({ getPages, getStore, getMeta }) {
    this._getPages = getPages;
    this._getStore = getStore;
    this._getMeta  = getMeta;
    this._buildModal();
  }

  /**
   * Open the publish modal.
   */
  openPublishModal() {
    if (!this._modal) this._buildModal();
    this._resetModal();
    this._modal.classList.remove('nv-hidden');
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  _buildModal() {
    this._modal = document.createElement('div');
    this._modal.className = 'nv-modal-backdrop nv-hidden';
    this._modal.innerHTML = `
      <div class="nv-modal nv-publish-modal">
        <div class="nv-modal-header">
          <h2 class="nv-modal-title">🚀 Publish Site</h2>
          <button class="nv-modal-close" id="nv-publish-close">✕</button>
        </div>
        <div class="nv-modal-body">
          <div id="nv-publish-setup">
            <p style="color:#6b7280;font-size:13px;margin:0 0 20px;">
              Choose how to export your site. The output is identical to what you see in Preview Mode.
            </p>

            <div class="nv-publish-targets">
              <label class="nv-publish-target active" data-target="zip">
                <input type="radio" name="nv-publish-target" value="zip" checked>
                <div class="nv-publish-target-icon">📦</div>
                <div>
                  <strong>Static ZIP</strong>
                  <p>Download a .zip file ready for Netlify, Vercel, or GitHub Pages.</p>
                </div>
              </label>
              <label class="nv-publish-target" data-target="preview">
                <input type="radio" name="nv-publish-target" value="preview">
                <div class="nv-publish-target-icon">🌐</div>
                <div>
                  <strong>Live Preview</strong>
                  <p>Open the published site in a new tab to test before downloading.</p>
                </div>
              </label>
            </div>

            <button id="nv-publish-build-btn" class="nuvra-btn publish" style="width:100%;margin-top:20px;padding:12px;font-size:14px;">
              Build &amp; Export
            </button>
          </div>

          <div id="nv-publish-progress" class="nv-hidden">
            <p id="nv-publish-status" style="color:#374151;font-size:13px;margin:0 0 12px;">Building…</p>
            <div class="nv-progress-bar">
              <div class="nv-progress-fill" id="nv-progress-fill" style="width:0%"></div>
            </div>
            <div id="nv-publish-log" style="margin-top:16px;font-size:12px;color:#6b7280;max-height:160px;overflow-y:auto;"></div>
          </div>

          <div id="nv-publish-done" class="nv-hidden">
            <div style="text-align:center;padding:20px 0;">
              <div style="font-size:48px;margin-bottom:12px;">✅</div>
              <h3 style="margin:0 0 8px;color:#111;">Build complete!</h3>
              <p id="nv-publish-done-msg" style="color:#6b7280;font-size:13px;margin:0 0 20px;"></p>
              <button id="nv-publish-again-btn" class="nuvra-btn" style="margin-right:8px;">Build Again</button>
              <button id="nv-publish-close-done-btn" class="nuvra-btn publish">Close</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this._modal);

    // Close buttons
    this._modal.querySelector('#nv-publish-close')?.addEventListener('click', () => this._close());
    this._modal.querySelector('#nv-publish-close-done-btn')?.addEventListener('click', () => this._close());
    this._modal.querySelector('#nv-publish-again-btn')?.addEventListener('click', () => this._resetModal());
    this._modal.addEventListener('click', (e) => { if (e.target === this._modal) this._close(); });

    // Target selector
    this._modal.querySelectorAll('.nv-publish-target').forEach((label) => {
      label.addEventListener('click', () => {
        this._target = label.dataset.target;
        this._modal.querySelectorAll('.nv-publish-target').forEach((l) => l.classList.remove('active'));
        label.classList.add('active');
      });
    });

    // Build button
    this._modal.querySelector('#nv-publish-build-btn')?.addEventListener('click', () => this._runBuild());
  }

  async _runBuild() {
    // Switch to progress view
    this._modal.querySelector('#nv-publish-setup').classList.add('nv-hidden');
    this._modal.querySelector('#nv-publish-progress').classList.remove('nv-hidden');

    const pages   = this._getPages();
    const store   = this._getStore();
    const meta    = this._getMeta();
    const logEl   = this._modal.querySelector('#nv-publish-log');
    const fillEl  = this._modal.querySelector('#nv-progress-fill');
    const statusEl = this._modal.querySelector('#nv-publish-status');

    const log = (msg) => {
      const line = document.createElement('div');
      line.textContent = `✓ ${msg}`;
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
    };

    try {
      statusEl.textContent = 'Building your site…';

      const bundle = await buildSite({
        pages,
        dataStore: store,
        projectMeta: meta,
        onProgress: (pct, msg) => {
          fillEl.style.width = pct + '%';
          log(msg);
        },
      });

      fillEl.style.width = '100%';
      statusEl.textContent = 'Packaging…';

      if (this._target === 'zip') {
        await this._downloadZip(bundle, meta);
      } else {
        this._openLivePreview(bundle, meta);
      }

      // Show done screen
      this._modal.querySelector('#nv-publish-progress').classList.add('nv-hidden');
      this._modal.querySelector('#nv-publish-done').classList.remove('nv-hidden');
      const doneMsg = this._modal.querySelector('#nv-publish-done-msg');
      if (doneMsg) {
        doneMsg.textContent = this._target === 'zip'
          ? `Your site (${bundle.manifest.pageCount} page${bundle.manifest.pageCount !== 1 ? 's' : ''}) has been downloaded as a ZIP file.`
          : 'Your site has been opened in a new tab.';
      }

    } catch (err) {
      console.error('[PublishManager] Build failed:', err);
      statusEl.textContent = `Build failed: ${err.message}`;
      fillEl.style.background = '#ef4444';
    }
  }

  async _downloadZip(bundle, meta) {
    // Use fflate if available, otherwise fall back to a simple multi-file download
    if (typeof window.fflate !== 'undefined') {
      const { strToU8, zipSync } = window.fflate;
      const zipFiles = {};
      for (const [filename, content] of Object.entries(bundle.files)) {
        zipFiles[filename] = strToU8(content);
      }
      const zipped   = zipSync(zipFiles);
      const blob     = new Blob([zipped], { type: 'application/zip' });
      const url      = URL.createObjectURL(blob);
      const a        = document.createElement('a');
      const projName = (meta.name || 'nuvra-site').toLowerCase().replace(/\s+/g, '-');
      a.href         = url;
      a.download     = `${projName}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      // Fallback: load fflate from CDN then retry
      await this._loadFflate();
      return this._downloadZip(bundle, meta);
    }
  }

  _openLivePreview(bundle, meta) {
    // Find the entry point HTML
    const entryFile = bundle.manifest.entryPoint || 'index.html';
    const html      = bundle.files[entryFile] || bundle.files[Object.keys(bundle.files)[0]];
    if (!html) return;

    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    window.open(url, '_blank');
    // Note: the blob URL will be revoked when the tab is closed (browser handles this)
  }

  _loadFflate() {
    return new Promise((resolve, reject) => {
      if (window.fflate) return resolve();
      const script = document.createElement('script');
      script.src   = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js';
      script.onload  = resolve;
      script.onerror = () => reject(new Error('Failed to load fflate. Please check your internet connection.'));
      document.head.appendChild(script);
    });
  }

  _resetModal() {
    this._modal.querySelector('#nv-publish-setup')?.classList.remove('nv-hidden');
    this._modal.querySelector('#nv-publish-progress')?.classList.add('nv-hidden');
    this._modal.querySelector('#nv-publish-done')?.classList.add('nv-hidden');

    const fillEl = this._modal.querySelector('#nv-progress-fill');
    if (fillEl) fillEl.style.width = '0%';

    const logEl = this._modal.querySelector('#nv-publish-log');
    if (logEl) logEl.innerHTML = '';
  }

  _close() {
    this._modal?.classList.add('nv-hidden');
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const publishManager = new PublishManager();
