/**
 * main.js — Nuvra Phase 2–2.5
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
 * 10. Mark as booted
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

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  // ── Step 1: Install global error handlers ──────────────────────────────────
  errorBoundary.installGlobalHandlers();
  logger.info('main', 'Nuvra booting (Phase 2–2.5)…');

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
  // In the browser, set window.NUVRA_OPENAI_KEY before the page loads.
  // In Node (tests), set OPENAI_API_KEY in the environment.
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

  // ── Step 10: Mark as booted ────────────────────────────────────────────────
  store.dispatch({ type: 'FLAGS/SET_BOOTED' });
  eventBus.emit('app:booted', { ts: Date.now() });
  logger.info('main', 'Nuvra booted successfully (Phase 2–2.5)');
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
boot().catch((err) => {
  errorBoundary.capture(err, {
    module:   'main',
    context:  'boot sequence',
    severity: ErrorSeverity.CRITICAL,
  });
});
