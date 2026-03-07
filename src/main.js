/**
 * main.js — Nuvra Phase 4
 *
 * The application boot sequence.
 *
 * Boot order:
 *  1. Install global error boundary
 *  2. Initialize the Core Runtime
 *  3. Hydrate state from persistence
 *  4. Configure AI adapter
 *  5. Register all modules (in dependency order)
 *  6. Start all modules
 *  7. Wire persistence auto-save
 *  8. Wire save-requested event
 *  9. Wire online/offline detection
 * 10. Wire App Runtime activation
 * 11. Wire Preview Mode activation/exit
 * 12. Wire Publish Pipeline events
 * 13. Mark as booted
 *
 * Phase 4 additions:
 *  - PreviewMode is wired to editor:enter_preview / editor:exit_preview events
 *  - PublishPipeline is wired to publish:run events
 *  - Preview state slice is added to the store
 *  - Publish state slice is added to the store
 *  - RuntimeErrorBoundary captures all runtime errors
 *
 * @module main
 */
'use strict';

import { runtime }        from './runtime/coreRuntime.js';
import { eventBus }       from './runtime/eventBus.js';
import { store }          from './state/store.js';
import { storageEngine }  from './persistence/storageEngine.js';
import { pageManager }    from './pages/pageManager.js';
import { editorShell }    from './ui/editorShell.js';
import { logger }         from './diagnostics/logger.js';
import { errorBoundary, ErrorSeverity } from './diagnostics/errorBoundary.js';
import { toastManager }   from './ui/controls/toast.js';
import { planningEngine } from './ai/planningEngine.js';
import { aiAdapter, OpenAIProvider } from './ai/adapter/aiAdapter.js';
import { AppRuntime }     from './app/runtime/appRuntime.js';
import { previewMode }    from './preview/previewMode.js';
import { publishPipeline } from './publish/publishPipeline.js';
import { outputTargets }  from './output/outputTargets.js';
import { runtimeErrorBoundary } from './preview/runtimeErrorBoundary.js';
import { RenderTarget }   from './renderer/renderTarget.js';

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  // ── Step 1: Install global error handlers ──────────────────────────────────
  errorBoundary.installGlobalHandlers();
  logger.info('main', 'Nuvra booting (Phase 4)…');

  // ── Step 2: Initialize the Core Runtime ────────────────────────────────────
  runtime.init();

  // ── Step 3: Hydrate state from persistence ─────────────────────────────────
  const { state: savedState, version, migrationsRun, error: loadError } = storageEngine.load();

  if (loadError) {
    logger.warn('main', 'Persistence load error — attempting backup restore', { loadError });
    const { state: backupState, slot } = storageEngine.restoreFromBackup();
    if (backupState) {
      store.hydrate(backupState);
      logger.info('main', `Restored from backup slot ${slot}`);
    } else {
      logger.warn('main', 'No backup available — starting with empty state');
    }
  } else if (savedState) {
    store.hydrate(savedState);
    if (migrationsRun.length > 0) {
      logger.info('main', `State migrated from v${version} to v${migrationsRun[migrationsRun.length - 1]}`, { migrationsRun });
    } else {
      logger.info('main', `State restored from storage (v${version})`);
    }
  } else {
    logger.info('main', 'No saved state — starting fresh');
  }

  // ── Step 4: Configure AI adapter ───────────────────────────────────────────
  const apiKey = (typeof window !== 'undefined' && window.NUVRA_OPENAI_KEY)
    || (typeof process !== 'undefined' ? process.env?.OPENAI_API_KEY : null)
    || null;

  aiAdapter.configure(new OpenAIProvider({ apiKey }));
  logger.info('main', `AI adapter configured (key present: ${!!apiKey})`);

  // ── Step 5: Register all modules (dependency order) ────────────────────────
  runtime
    .register(pageManager)
    .register(planningEngine)
    .register(editorShell);

  // ── Step 6: Start all modules ──────────────────────────────────────────────
  await runtime.start();

  // ── Step 7: Wire auto-save ─────────────────────────────────────────────────
  store.subscribe((newState) => {
    // Do not persist preview or publish transient state
    storageEngine.scheduleSave(newState);
  });

  // ── Step 8: Wire save-requested event ──────────────────────────────────────
  eventBus.on('editor:save_requested', () => {
    const result = storageEngine.save(store.getState());
    if (result.ok) {
      store.dispatch({ type: 'FLAGS/SET_LAST_SAVED', payload: Date.now() });
      store.dispatch({ type: 'EDITOR/MARK_CLEAN' });
      toastManager.show('Saved', 'success', 2000);
    } else {
      errorBoundary.capture(new Error(result.error), {
        module:   'persistence',
        context:  'manual save',
        severity: ErrorSeverity.HIGH,
      });
    }
  });

  // ── Step 9: Wire online/offline detection ──────────────────────────────────
  if (typeof window !== 'undefined') {
    window.addEventListener('online',  () => store.dispatch({ type: 'FLAGS/SET_ONLINE', payload: true  }));
    window.addEventListener('offline', () => store.dispatch({ type: 'FLAGS/SET_ONLINE', payload: false }));
  }

  // ── Step 10: Wire App Runtime activation ───────────────────────────────────
  eventBus.on('app:runtime:boot', async ({ appSchema, mountEl, mode }) => {
    if (!appSchema || !mountEl) {
      logger.warn('main', 'app:runtime:boot received without appSchema or mountEl');
      return;
    }
    try {
      const appRuntime = new AppRuntime({ appSchema, mountEl, mode: mode || 'preview' });
      await appRuntime.boot();
      logger.info('main', `AppRuntime booted for app "${appSchema.name}" in ${mode || 'preview'} mode`);
      mountEl._nuvraAppRuntime = appRuntime;
      eventBus.emit('app:runtime:ready', { appId: appSchema.id });
    } catch (err) {
      runtimeErrorBoundary.capture(err, {
        module:     'appRuntime',
        errorClass: 'render_failed',
      });
    }
  });

  eventBus.on('app:runtime:teardown', ({ mountEl }) => {
    if (mountEl?._nuvraAppRuntime) {
      mountEl._nuvraAppRuntime.teardown();
      delete mountEl._nuvraAppRuntime;
      logger.info('main', 'AppRuntime torn down');
    }
  });

  // ── Step 11: Wire Preview Mode ─────────────────────────────────────────────
  eventBus.on('editor:enter_preview', async ({ appSchema, mountEl, debug }) => {
    if (!appSchema || !mountEl) {
      logger.warn('main', 'editor:enter_preview received without appSchema or mountEl');
      return;
    }

    store.dispatch({ type: 'PREVIEW/SET_STATE', payload: 'loading' });

    const result = await previewMode.enter({ appSchema, mountEl, debug: debug || false });

    if (!result.ok) {
      runtimeErrorBoundary.capture(new Error(result.error), {
        module:     'previewMode',
        errorClass: 'render_failed',
      });
      toastManager.show('Preview failed: ' + result.error, 'error', 5000);
    } else {
      toastManager.show('Preview ready', 'success', 2000);
    }
  });

  eventBus.on('editor:exit_preview', () => {
    previewMode.exit();
    store.dispatch({ type: 'EDITOR/SET_MODE', payload: 'edit' });
    logger.info('main', 'Exited preview mode');
  });

  // ── Step 12: Wire Publish Pipeline ─────────────────────────────────────────
  eventBus.on('publish:run', async ({ appSchema, target, config }) => {
    if (!appSchema) {
      logger.warn('main', 'publish:run received without appSchema');
      return;
    }

    const resolvedTarget = target || RenderTarget.STATIC_SITE;

    store.dispatch({ type: 'PUBLISH/SET_STAGE', payload: 'validate' });

    const result = await publishPipeline.run({
      appSchema,
      target:    resolvedTarget,
      config:    config || {},
    });

    if (!result.ok) {
      runtimeErrorBoundary.capture(new Error(result.error), {
        module:     'publishPipeline',
        errorClass: 'publish_error',
      });
      toastManager.show('Publish failed: ' + result.error, 'error', 5000);
      return;
    }

    // Apply the output target (download ZIP, open Blob URL, etc.)
    const outputTarget = outputTargets[resolvedTarget];
    if (outputTarget) {
      const output = await outputTarget.apply(result);

      if (resolvedTarget === RenderTarget.STATIC_SITE || resolvedTarget === RenderTarget.APP_READY) {
        outputTarget.download?.(output);
        toastManager.show('Download started', 'success', 3000);
      } else if (resolvedTarget === RenderTarget.LIVE_PREVIEW) {
        outputTarget.openInNewTab?.(output);
        toastManager.show('Live preview opened', 'success', 3000);
      }
    }

    logger.info('main', `Publish complete: "${appSchema.name}" → ${resolvedTarget}`);
  });

  // ── Step 13: Mark as booted ────────────────────────────────────────────────
  store.dispatch({ type: 'FLAGS/SET_BOOTED' });
  eventBus.emit('app:booted', { ts: Date.now() });
  logger.info('main', 'Nuvra booted successfully (Phase 4)');
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
boot().catch((err) => {
  errorBoundary.capture(err, {
    module:   'main',
    context:  'boot sequence',
    severity: ErrorSeverity.CRITICAL,
  });
});
