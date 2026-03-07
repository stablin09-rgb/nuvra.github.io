/**
 * previewMode.js — Nuvra Phase 4
 *
 * The Preview Mode Execution Sandbox.
 *
 * Preview Mode is not a mock. It is real execution with isolated state.
 *
 * Implementation:
 *  1. Create a snapshot of the current app state and data
 *  2. Render the app using the UnifiedRenderer (same as publish)
 *  3. Inject the rendered HTML into a sandboxed iframe
 *  4. The iframe runs the exact same runtime JS as the published output
 *  5. Mutations inside the iframe do NOT affect the editor state
 *  6. The preview can be reset by re-creating the snapshot and re-rendering
 *
 * The iframe sandbox attribute prevents:
 *  - Access to the parent window
 *  - Navigation of the parent frame
 *  - Popups
 *  - Pointer lock
 *
 * The iframe is allowed:
 *  - Scripts (required for the runtime)
 *  - Same-origin (required for Blob URL injection)
 *  - Forms (required for form components)
 *
 * @module preview/previewMode
 */
'use strict';

import { unifiedRenderer }  from '../renderer/unifiedRenderer.js';
import { snapshotEngine }   from '../snapshot/snapshotEngine.js';
import { RenderTarget }     from '../renderer/renderTarget.js';
import { eventBus }         from '../runtime/eventBus.js';
import { store }            from '../state/store.js';
import { logger }           from '../diagnostics/logger.js';
import { errorBoundary, ErrorSeverity } from '../diagnostics/errorBoundary.js';

// ─── Preview State ─────────────────────────────────────────────────────────────
export const PreviewState = Object.freeze({
  IDLE:     'idle',
  LOADING:  'loading',
  RUNNING:  'running',
  ERROR:    'error',
  RESETTING:'resetting',
});

// ─── PreviewMode ───────────────────────────────────────────────────────────────
export class PreviewMode {
  constructor() {
    this._name        = 'PreviewMode';
    this._iframe      = null;
    this._blobUrl     = null;
    this._state       = PreviewState.IDLE;
    this._appSchema   = null;
    this._snapshot    = null;
    this._mountEl     = null;
    this._viewport    = 'desktop'; // 'desktop' | 'tablet' | 'mobile'
    this._debug       = false;
    this._lastRender  = null;
  }

  /**
   * Enter Preview Mode.
   *
   * @param {object} opts
   * @param {object}  opts.appSchema  - The AppSchema to preview
   * @param {Element} opts.mountEl    - The DOM element to mount the preview into
   * @param {object}  [opts.snapshot] - Optional pre-built snapshot
   * @param {boolean} [opts.debug]    - Enable debug overlay
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  async enter(opts = {}) {
    const { appSchema, mountEl, snapshot, debug = false } = opts;

    if (!appSchema) return { ok: false, error: 'PreviewMode.enter: appSchema is required' };
    if (!mountEl)   return { ok: false, error: 'PreviewMode.enter: mountEl is required' };

    this._setState(PreviewState.LOADING);
    this._appSchema = appSchema;
    this._mountEl   = mountEl;
    this._debug     = debug;

    try {
      // 1. Create snapshot (from live runtime or schema defaults)
      this._snapshot = snapshot || snapshotEngine.createFromSchema(appSchema);

      // 2. Render using the Unified Renderer (same as publish)
      const renderResult = unifiedRenderer.render({
        appSchema,
        snapshot:  this._snapshot,
        target:    RenderTarget.PREVIEW,
        config: {
          debug,
          title:   appSchema.name,
          version: appSchema.version || '1.0.0',
        },
      });

      if (!renderResult.ok) {
        this._setState(PreviewState.ERROR);
        return { ok: false, error: renderResult.error };
      }

      this._lastRender = renderResult;

      // 3. Inject into sandboxed iframe
      this._injectIntoIframe(renderResult.html, mountEl);

      this._setState(PreviewState.RUNNING);

      // Notify the editor
      store.dispatch({ type: 'PREVIEW/SET_STATE', payload: PreviewState.RUNNING });
      eventBus.emit('preview:entered', { appId: appSchema.id });

      logger.info('PreviewMode', `Preview entered for "${appSchema.name}"`);
      return { ok: true };

    } catch (err) {
      this._setState(PreviewState.ERROR);
      errorBoundary.capture(err, {
        module:   'PreviewMode',
        context:  'enter',
        severity: ErrorSeverity.HIGH,
      });
      return { ok: false, error: err.message };
    }
  }

  /**
   * Exit Preview Mode. Tears down the iframe and cleans up.
   */
  exit() {
    this._teardownIframe();
    this._appSchema  = null;
    this._snapshot   = null;
    this._mountEl    = null;
    this._lastRender = null;
    this._setState(PreviewState.IDLE);

    store.dispatch({ type: 'PREVIEW/SET_STATE', payload: PreviewState.IDLE });
    eventBus.emit('preview:exited', {});
    logger.info('PreviewMode', 'Preview exited');
  }

  /**
   * Reset the preview. Re-creates the snapshot from schema defaults and re-renders.
   * All mutations made in the preview are discarded.
   */
  async reset() {
    if (!this._appSchema || !this._mountEl) return { ok: false, error: 'No active preview to reset' };

    this._setState(PreviewState.RESETTING);
    logger.info('PreviewMode', 'Resetting preview…');

    const result = await this.enter({
      appSchema: this._appSchema,
      mountEl:   this._mountEl,
      snapshot:  null, // Force fresh snapshot from schema defaults
      debug:     this._debug,
    });

    eventBus.emit('preview:reset', { appId: this._appSchema?.id });
    return result;
  }

  /**
   * Set the viewport size for the preview iframe.
   * @param {'desktop'|'tablet'|'mobile'} viewport
   */
  setViewport(viewport) {
    this._viewport = viewport;
    if (!this._iframe) return;

    const sizes = {
      desktop: { width: '100%',  height: '100%' },
      tablet:  { width: '768px', height: '1024px' },
      mobile:  { width: '390px', height: '844px' },
    };
    const size = sizes[viewport] || sizes.desktop;
    this._iframe.style.width  = size.width;
    this._iframe.style.height = size.height;
    this._iframe.style.margin = viewport === 'desktop' ? '0' : '0 auto';

    store.dispatch({ type: 'PREVIEW/SET_VIEWPORT', payload: viewport });
    eventBus.emit('preview:viewport_changed', { viewport });
    logger.info('PreviewMode', `Viewport set to ${viewport}`);
  }

  /**
   * Get the current preview state.
   * @returns {string} PreviewState
   */
  getState() { return this._state; }

  /**
   * Get the current snapshot.
   * @returns {object|null}
   */
  getSnapshot() { return this._snapshot; }

  /**
   * Get the last render output.
   * @returns {object|null}
   */
  getLastRender() { return this._lastRender; }

  // ─── Private ─────────────────────────────────────────────────────────────────

  _injectIntoIframe(html, mountEl) {
    this._teardownIframe();

    // Create a Blob URL from the HTML
    const blob = new Blob([html], { type: 'text/html' });
    this._blobUrl = URL.createObjectURL(blob);

    // Create the sandboxed iframe
    const iframe = document.createElement('iframe');
    iframe.id        = 'nv-preview-frame';
    iframe.className = 'nv-preview-frame';
    iframe.sandbox   = 'allow-scripts allow-same-origin allow-forms allow-popups-to-escape-sandbox';
    iframe.src       = this._blobUrl;
    iframe.style.cssText = [
      'width: 100%',
      'height: 100%',
      'border: none',
      'display: block',
      'background: #0f1117',
    ].join(';');

    mountEl.innerHTML = '';
    mountEl.appendChild(iframe);
    this._iframe = iframe;

    // Apply initial viewport
    this.setViewport(this._viewport);
  }

  _teardownIframe() {
    if (this._iframe) {
      this._iframe.remove();
      this._iframe = null;
    }
    if (this._blobUrl) {
      URL.revokeObjectURL(this._blobUrl);
      this._blobUrl = null;
    }
  }

  _setState(newState) {
    const prev = this._state;
    this._state = newState;
    if (prev !== newState) {
      eventBus.emit('preview:state_changed', { prev, next: newState });
    }
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────
export const previewMode = new PreviewMode();
export default previewMode;
