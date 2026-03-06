/**
 * canvas.js — Nuvra Foundation (Phase 0–1)
 *
 * The Canvas panel.
 * Renders the active page in a device-framed iframe.
 * In Phase 0–1 the canvas shows the page metadata and a placeholder
 * for the GrapesJS integration (added in a future phase).
 *
 * The canvas reacts to:
 *  - Active page changes (switches content instantly)
 *  - Device mode changes (resizes the frame)
 *
 * @module ui/panels/canvas
 */
'use strict';

import {
  selectActivePage,
  selectDeviceMode,
  selectZoom,
} from '../../state/selectors.js';

const DEVICE_WIDTHS = {
  desktop: '100%',
  tablet:  '768px',
  mobile:  '375px',
};

export const canvas = {
  _el: null,

  mount(el) {
    if (!el) return;
    this._el = el;
  },

  unmount() { this._el = null; },

  render(state) {
    if (!this._el) return;

    const page   = selectActivePage(state);
    const device = selectDeviceMode(state);
    const zoom   = selectZoom(state);
    const width  = DEVICE_WIDTHS[device] || '100%';

    if (!page) {
      this._el.innerHTML = `
        <div class="nv-canvas-empty">
          <p>No page selected. Create a page to get started.</p>
        </div>
      `;
      return;
    }

    this._el.innerHTML = `
      <div class="nv-canvas-wrapper" style="zoom:${zoom}">
        <div class="nv-canvas-frame" style="width:${width};max-width:100%;">
          <div class="nv-canvas-device-label">${device}</div>
          <div class="nv-canvas-surface" id="nv-canvas-surface">
            <div class="nv-canvas-page-info">
              <h2>${this._esc(page.name)}</h2>
              <p class="nv-canvas-slug">/${this._esc(page.slug)}</p>
              <p class="nv-canvas-type">Type: ${this._esc(page.type)}</p>
              <p class="nv-canvas-desc">${this._esc(page.description || '')}</p>
              <div class="nv-canvas-placeholder">
                <span>&#9881;</span>
                <p>Editor canvas — GrapesJS integration added in Phase 1+</p>
                <p class="nv-canvas-hint">Page content is stored in state and will persist across reloads.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  _esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  },
};

export default canvas;
