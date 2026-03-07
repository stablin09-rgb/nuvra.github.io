/**
 * previewPanel.js — Nuvra Phase 4
 *
 * The Preview Controls UI Panel.
 *
 * Provides the Build ↔ Preview toggle, viewport switching, reload,
 * reset, debug overlay, and error boundary display.
 *
 * This panel replaces the editor canvas when Preview Mode is active.
 * It is 100% state-driven — all controls dispatch actions to the store.
 *
 * @module ui/panels/previewPanel
 */
'use strict';

import { store }       from '../../state/store.js';
import { eventBus }    from '../../runtime/eventBus.js';
import { previewMode, PreviewState } from '../../preview/previewMode.js';
import { publishPipeline, PipelineStage } from '../../publish/publishPipeline.js';
import { outputTargets } from '../../output/outputTargets.js';
import { RenderTarget }  from '../../renderer/renderTarget.js';
import { logger }        from '../../diagnostics/logger.js';

// ─── PreviewPanel ─────────────────────────────────────────────────────────────
export class PreviewPanel {
  constructor() {
    this._name       = 'PreviewPanel';
    this._el         = null;
    this._frameEl    = null;
    this._unsubs     = [];
    this._debugOpen  = false;
  }

  /**
   * Mount the preview panel into a container element.
   * @param {Element} container
   */
  mount(container) {
    this._el = document.createElement('div');
    this._el.className = 'nv-preview-panel';
    this._el.innerHTML = this._template();
    container.appendChild(this._el);

    this._frameEl = this._el.querySelector('#nv-preview-frame-container');
    this._bindEvents();
    this._subscribeToState();

    logger.info('PreviewPanel', 'Mounted');
  }

  /**
   * Unmount and clean up.
   */
  unmount() {
    this._unsubs.forEach(u => u());
    this._unsubs = [];
    previewMode.exit();
    this._el?.remove();
    this._el = null;
    logger.info('PreviewPanel', 'Unmounted');
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  _template() {
    return `
<div class="nv-preview-toolbar">
  <div class="nv-preview-toolbar__left">
    <button class="nv-btn nv-btn--sm nv-btn--secondary" id="nv-preview-back">
      ← Back to Editor
    </button>
    <span class="nv-preview-toolbar__app-name" id="nv-preview-app-name">—</span>
  </div>
  <div class="nv-preview-toolbar__center">
    <div class="nv-viewport-switcher">
      <button class="nv-btn nv-btn--xs nv-btn--ghost nv-viewport-btn active" data-viewport="desktop" title="Desktop">🖥</button>
      <button class="nv-btn nv-btn--xs nv-btn--ghost nv-viewport-btn"        data-viewport="tablet"  title="Tablet">📱</button>
      <button class="nv-btn nv-btn--xs nv-btn--ghost nv-viewport-btn"        data-viewport="mobile"  title="Mobile">📲</button>
    </div>
  </div>
  <div class="nv-preview-toolbar__right">
    <button class="nv-btn nv-btn--xs nv-btn--ghost" id="nv-preview-reload"   title="Reload Preview">↺ Reload</button>
    <button class="nv-btn nv-btn--xs nv-btn--ghost" id="nv-preview-reset"    title="Reset State">⟳ Reset Data</button>
    <button class="nv-btn nv-btn--xs nv-btn--ghost" id="nv-preview-debug"    title="Debug Overlay">🔍 Debug</button>
    <div class="nv-publish-menu">
      <button class="nv-btn nv-btn--sm nv-btn--primary" id="nv-publish-btn">Publish ▾</button>
      <div class="nv-publish-menu__dropdown" id="nv-publish-dropdown" style="display:none">
        <button class="nv-publish-menu__item" data-target="static_site">📦 Download ZIP</button>
        <button class="nv-publish-menu__item" data-target="live_preview">🔗 Open Live Preview</button>
        <button class="nv-publish-menu__item" data-target="app_ready">📱 App-Ready ZIP</button>
      </div>
    </div>
  </div>
</div>

<div class="nv-preview-status-bar" id="nv-preview-status">
  <span class="nv-preview-status__dot nv-preview-status__dot--idle"></span>
  <span class="nv-preview-status__text">Idle</span>
</div>

<div class="nv-preview-frame-wrapper" id="nv-preview-frame-container"></div>

<div class="nv-preview-debug-overlay" id="nv-preview-debug-overlay" style="display:none">
  <div class="nv-preview-debug-overlay__header">
    <span>Debug Overlay</span>
    <button class="nv-btn nv-btn--xs nv-btn--ghost" id="nv-debug-close">✕</button>
  </div>
  <div class="nv-preview-debug-overlay__body" id="nv-debug-body"></div>
</div>

<div class="nv-preview-error-panel" id="nv-preview-error-panel" style="display:none">
  <div class="nv-preview-error-panel__icon">⚠</div>
  <div class="nv-preview-error-panel__title">Preview Error</div>
  <div class="nv-preview-error-panel__message" id="nv-preview-error-msg"></div>
  <button class="nv-btn nv-btn--sm nv-btn--secondary" id="nv-preview-retry">Retry</button>
</div>

<div class="nv-publish-progress" id="nv-publish-progress" style="display:none">
  <div class="nv-publish-progress__bar">
    <div class="nv-publish-progress__fill" id="nv-publish-progress-fill"></div>
  </div>
  <div class="nv-publish-progress__label" id="nv-publish-progress-label">Building…</div>
</div>
`;
  }

  _bindEvents() {
    const el = this._el;

    // Back to editor
    el.querySelector('#nv-preview-back')?.addEventListener('click', () => {
      eventBus.emit('editor:exit_preview', {});
    });

    // Viewport switching
    el.querySelectorAll('.nv-viewport-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('.nv-viewport-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        previewMode.setViewport(btn.dataset.viewport);
      });
    });

    // Reload
    el.querySelector('#nv-preview-reload')?.addEventListener('click', async () => {
      await this._reloadPreview();
    });

    // Reset data
    el.querySelector('#nv-preview-reset')?.addEventListener('click', async () => {
      await previewMode.reset();
      this._setStatus('running', 'Preview reset');
    });

    // Debug overlay
    el.querySelector('#nv-preview-debug')?.addEventListener('click', () => {
      this._toggleDebug();
    });

    el.querySelector('#nv-debug-close')?.addEventListener('click', () => {
      this._closeDebug();
    });

    // Retry on error
    el.querySelector('#nv-preview-retry')?.addEventListener('click', async () => {
      await this._reloadPreview();
    });

    // Publish menu toggle
    el.querySelector('#nv-publish-btn')?.addEventListener('click', () => {
      const dd = el.querySelector('#nv-publish-dropdown');
      if (dd) dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
    });

    // Publish targets
    el.querySelectorAll('.nv-publish-menu__item').forEach(btn => {
      btn.addEventListener('click', async () => {
        el.querySelector('#nv-publish-dropdown').style.display = 'none';
        await this._runPublish(btn.dataset.target);
      });
    });

    // Close publish dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!el.querySelector('.nv-publish-menu')?.contains(e.target)) {
        const dd = el.querySelector('#nv-publish-dropdown');
        if (dd) dd.style.display = 'none';
      }
    });

    // Listen for preview events
    this._unsubs.push(
      eventBus.on('preview:state_changed', ({ next }) => this._onPreviewStateChange(next)),
      eventBus.on('preview:entered',  () => this._setStatus('running', 'Preview running')),
      eventBus.on('preview:exited',   () => this._setStatus('idle',    'Idle')),
      eventBus.on('preview:reset',    () => this._setStatus('running', 'Preview reset')),
      eventBus.on('publish:stage',    ({ stage }) => this._onPublishStage(stage)),
      eventBus.on('publish:complete', (r) => this._onPublishComplete(r)),
      eventBus.on('publish:error',    ({ error }) => this._onPublishError(error)),
    );
  }

  _subscribeToState() {
    const unsub = store.subscribe((state) => {
      const appState = state.app;
      if (!appState) return;

      // Update app name in toolbar
      const activeId = appState.activeAppId;
      const schema   = activeId ? appState.schemas?.[activeId] : null;
      const nameEl   = this._el?.querySelector('#nv-preview-app-name');
      if (nameEl) nameEl.textContent = schema?.name || '—';
    });
    this._unsubs.push(unsub);
  }

  async _reloadPreview() {
    const state     = store.getState();
    const activeId  = state.app?.activeAppId;
    const appSchema = activeId ? state.app?.schemas?.[activeId] : null;

    if (!appSchema) {
      this._showError('No active app schema. Open an app page first.');
      return;
    }

    this._setStatus('loading', 'Loading preview…');
    this._hideError();

    const result = await previewMode.enter({
      appSchema,
      mountEl: this._frameEl,
      debug:   this._debugOpen,
    });

    if (!result.ok) {
      this._showError(result.error);
    }
  }

  async _runPublish(target) {
    const state     = store.getState();
    const activeId  = state.app?.activeAppId;
    const appSchema = activeId ? state.app?.schemas?.[activeId] : null;

    if (!appSchema) {
      this._showError('No active app schema. Open an app page first.');
      return;
    }

    this._showPublishProgress('Initializing…');

    const result = await publishPipeline.run({ appSchema, target });

    if (!result.ok) {
      this._hidePublishProgress();
      this._showError('Publish failed: ' + result.error);
      return;
    }

    this._hidePublishProgress();

    // Apply the output target
    const outputTarget = outputTargets[target];
    if (outputTarget) {
      const output = await outputTarget.apply(result);
      if (target === RenderTarget.STATIC_SITE || target === RenderTarget.APP_READY) {
        outputTarget.download?.(output);
      } else if (target === RenderTarget.LIVE_PREVIEW) {
        outputTarget.openInNewTab?.(output);
      }
    }
  }

  _onPreviewStateChange(state) {
    const statusMap = {
      [PreviewState.IDLE]:      { cls: 'idle',    text: 'Idle' },
      [PreviewState.LOADING]:   { cls: 'loading', text: 'Loading…' },
      [PreviewState.RUNNING]:   { cls: 'running', text: 'Preview running' },
      [PreviewState.ERROR]:     { cls: 'error',   text: 'Error' },
      [PreviewState.RESETTING]: { cls: 'loading', text: 'Resetting…' },
    };
    const s = statusMap[state] || { cls: 'idle', text: state };
    this._setStatus(s.cls, s.text);
  }

  _onPublishStage(stage) {
    const labels = {
      [PipelineStage.VALIDATE]: 'Validating schema…',
      [PipelineStage.SNAPSHOT]: 'Creating snapshot…',
      [PipelineStage.MANIFEST]: 'Generating manifest…',
      [PipelineStage.RENDER]:   'Rendering output…',
      [PipelineStage.ASSEMBLE]: 'Assembling files…',
      [PipelineStage.TARGET]:   'Applying target…',
      [PipelineStage.COMPLETE]: 'Build complete!',
    };
    const stageOrder = [
      PipelineStage.VALIDATE, PipelineStage.SNAPSHOT, PipelineStage.MANIFEST,
      PipelineStage.RENDER, PipelineStage.ASSEMBLE, PipelineStage.TARGET, PipelineStage.COMPLETE,
    ];
    const progress = ((stageOrder.indexOf(stage) + 1) / stageOrder.length) * 100;
    this._showPublishProgress(labels[stage] || stage, progress);
  }

  _onPublishComplete(result) {
    setTimeout(() => this._hidePublishProgress(), 1000);
    logger.info('PreviewPanel', `Publish complete: ${result.appName} → ${result.target}`);
  }

  _onPublishError(error) {
    this._hidePublishProgress();
    this._showError('Publish error: ' + error);
  }

  _setStatus(cls, text) {
    const bar = this._el?.querySelector('#nv-preview-status');
    if (!bar) return;
    const dot  = bar.querySelector('.nv-preview-status__dot');
    const label = bar.querySelector('.nv-preview-status__text');
    if (dot)  { dot.className = `nv-preview-status__dot nv-preview-status__dot--${cls}`; }
    if (label) label.textContent = text;
  }

  _showError(message) {
    const panel = this._el?.querySelector('#nv-preview-error-panel');
    const msg   = this._el?.querySelector('#nv-preview-error-msg');
    if (panel) panel.style.display = 'flex';
    if (msg)   msg.textContent = message;
    this._setStatus('error', 'Error');
  }

  _hideError() {
    const panel = this._el?.querySelector('#nv-preview-error-panel');
    if (panel) panel.style.display = 'none';
  }

  _toggleDebug() {
    this._debugOpen = !this._debugOpen;
    const overlay = this._el?.querySelector('#nv-preview-debug-overlay');
    if (!overlay) return;
    overlay.style.display = this._debugOpen ? 'flex' : 'none';
    if (this._debugOpen) this._updateDebugOverlay();
  }

  _closeDebug() {
    this._debugOpen = false;
    const overlay = this._el?.querySelector('#nv-preview-debug-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  _updateDebugOverlay() {
    const body = this._el?.querySelector('#nv-debug-body');
    if (!body) return;

    const state     = store.getState();
    const activeId  = state.app?.activeAppId;
    const appSchema = activeId ? state.app?.schemas?.[activeId] : null;
    const snap      = previewMode.getSnapshot();
    const render    = previewMode.getLastRender();

    body.innerHTML = `
<div class="nv-debug-section">
  <div class="nv-debug-section__title">Preview State</div>
  <div class="nv-debug-kv"><span>Status</span><span>${previewMode.getState()}</span></div>
  <div class="nv-debug-kv"><span>Viewport</span><span>${state.preview?.viewport || 'desktop'}</span></div>
</div>
<div class="nv-debug-section">
  <div class="nv-debug-section__title">App Schema</div>
  <div class="nv-debug-kv"><span>ID</span><span>${appSchema?.id || '—'}</span></div>
  <div class="nv-debug-kv"><span>Name</span><span>${appSchema?.name || '—'}</span></div>
  <div class="nv-debug-kv"><span>Pages</span><span>${appSchema?.pages?.length || 0}</span></div>
  <div class="nv-debug-kv"><span>Collections</span><span>${appSchema?.collections?.length || 0}</span></div>
  <div class="nv-debug-kv"><span>Actions</span><span>${appSchema?.actions?.length || 0}</span></div>
</div>
<div class="nv-debug-section">
  <div class="nv-debug-section__title">Snapshot</div>
  <div class="nv-debug-kv"><span>Created</span><span>${snap ? new Date(snap.createdAt).toLocaleTimeString() : '—'}</span></div>
  <div class="nv-debug-kv"><span>Collections</span><span>${snap ? Object.keys(snap.data || {}).length : 0}</span></div>
</div>
<div class="nv-debug-section">
  <div class="nv-debug-section__title">Last Render</div>
  <div class="nv-debug-kv"><span>Target</span><span>${render?.meta?.target || '—'}</span></div>
  <div class="nv-debug-kv"><span>HTML size</span><span>${render ? Math.round(render.html.length / 1024) + ' KB' : '—'}</span></div>
  <div class="nv-debug-kv"><span>JS size</span><span>${render ? Math.round(render.js.length / 1024) + ' KB' : '—'}</span></div>
</div>
<div class="nv-debug-section">
  <div class="nv-debug-section__title">Build Log</div>
  <pre class="nv-debug-log">${publishPipeline.getBuildLog().join('\n') || 'No build log yet.'}</pre>
</div>
`;
  }

  _showPublishProgress(label, percent = 0) {
    const bar   = this._el?.querySelector('#nv-publish-progress');
    const fill  = this._el?.querySelector('#nv-publish-progress-fill');
    const lbl   = this._el?.querySelector('#nv-publish-progress-label');
    if (bar)  bar.style.display = 'block';
    if (fill) fill.style.width  = percent + '%';
    if (lbl)  lbl.textContent   = label;
  }

  _hidePublishProgress() {
    const bar = this._el?.querySelector('#nv-publish-progress');
    if (bar) bar.style.display = 'none';
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────
export const previewPanel = new PreviewPanel();
export default previewPanel;
