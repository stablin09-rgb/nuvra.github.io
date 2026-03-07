/**
 * unifiedRenderer.js — Nuvra Phase 4
 *
 * The Unified Runtime Renderer.
 *
 * This is the ONLY renderer in Nuvra. There is no preview renderer,
 * no publish renderer, no mobile renderer. There is one renderer with
 * configurable targets.
 *
 * The renderer takes a RenderContext (schema + snapshot + target + config)
 * and produces a RenderOutput (HTML document string + CSS + JS bundle).
 *
 * The same RenderOutput is used by:
 *  - Preview Mode (injected into a sandboxed iframe)
 *  - Publish Pipeline (written to files in a ZIP)
 *  - Live Preview (served as a Blob URL)
 *  - App-Ready Output (bundled for mobile wrapping)
 *
 * @module renderer/unifiedRenderer
 */
'use strict';

import { generateRuntimeScript } from './runtimeBundle.js';
import { generateRuntimeCSS }    from './runtimeStyles.js';
import { RenderTarget }          from './renderTarget.js';

// ─── RenderContext ─────────────────────────────────────────────────────────────
/**
 * @typedef {object} RenderContext
 * @property {object}  appSchema    - The AppSchema to render
 * @property {object}  [snapshot]   - Data/state snapshot (optional)
 * @property {string}  target       - RenderTarget ID
 * @property {object}  [config]     - Optional configuration overrides
 * @property {string}  [config.title]   - Page title
 * @property {string}  [config.version] - Build version
 * @property {boolean} [config.debug]   - Enable debug mode
 * @property {string}  [config.favicon] - Favicon URL
 */

// ─── RenderOutput ──────────────────────────────────────────────────────────────
/**
 * @typedef {object} RenderOutput
 * @property {boolean} ok           - Whether rendering succeeded
 * @property {string}  [html]       - Full HTML document string
 * @property {string}  [css]        - Canonical CSS
 * @property {string}  [js]         - Runtime JS bundle
 * @property {string}  [error]      - Error message if ok === false
 * @property {object}  [meta]       - Build metadata
 */

// ─── Renderer ─────────────────────────────────────────────────────────────────
export class UnifiedRenderer {
  constructor() {
    this._name = 'UnifiedRenderer';
  }

  /**
   * Render a complete executable document from a RenderContext.
   *
   * @param {RenderContext} ctx
   * @returns {RenderOutput}
   */
  render(ctx) {
    const { appSchema, snapshot, target, config = {} } = ctx;

    if (!appSchema) {
      return { ok: false, error: 'UnifiedRenderer: appSchema is required' };
    }
    if (!target) {
      return { ok: false, error: 'UnifiedRenderer: target is required' };
    }

    try {
      const css = generateRuntimeCSS();
      const js  = generateRuntimeScript({ appSchema, snapshot, target, config });
      const html = this._buildHTMLDocument({ appSchema, css, js, config, target });

      return {
        ok:   true,
        html,
        css,
        js,
        meta: {
          target,
          appId:     appSchema.id,
          appName:   appSchema.name,
          version:   config.version || '1.0.0',
          builtAt:   Date.now(),
          pageCount: appSchema.pages?.length || 0,
        },
      };
    } catch (err) {
      return { ok: false, error: 'UnifiedRenderer: ' + err.message };
    }
  }

  /**
   * Build a complete, self-contained HTML document.
   * No external dependencies. No CDN links. Everything is inline.
   *
   * @private
   */
  _buildHTMLDocument({ appSchema, css, js, config, target }) {
    const title   = config.title   || appSchema.name || 'Nuvra App';
    const version = config.version || '1.0.0';
    const debug   = config.debug   || false;

    // Determine if this is a preview render (adds a thin debug banner if debug=true)
    const isPreview = target === RenderTarget.PREVIEW;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="generator" content="Nuvra v4"/>
  <meta name="app-id" content="${_esc(appSchema.id)}"/>
  <meta name="app-version" content="${_esc(version)}"/>
  ${config.favicon ? `<link rel="icon" href="${_esc(config.favicon)}"/>` : ''}
  <title>${_esc(title)}</title>
  <style>
${css}
  </style>
</head>
<body>
  ${isPreview && debug ? `<div id="nv-preview-banner" style="background:#1e1b4b;color:#a5b4fc;padding:6px 16px;font-size:11px;font-family:monospace;border-bottom:1px solid #312e81;">
    ⚡ Nuvra Preview Mode — target: ${_esc(target)} — app: ${_esc(appSchema.id)} — ${new Date().toISOString()}
  </div>` : ''}
  <div id="nv-app"></div>
  <script>
${js}
  </script>
</body>
</html>`;
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────
export const unifiedRenderer = new UnifiedRenderer();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default unifiedRenderer;
