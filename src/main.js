/**
 * main.js — Nuvra Phase 5
 *
 * The application boot sequence.
 *
 * Boot order:
 *  1.  Install global error boundary
 *  2.  Initialize the Core Runtime
 *  3.  Hydrate state from persistence
 *  4.  Configure AI Provider Registry (OpenAI primary, Anthropic fallback)
 *  5.  Configure Budget Engine limits
 *  6.  Register all modules (in dependency order)
 *  7.  Start all modules
 *  8.  Wire persistence auto-save
 *  9.  Wire save-requested event
 * 10.  Wire online/offline detection
 * 11.  Wire App Runtime activation
 * 12.  Wire Preview Mode activation/exit
 * 13.  Wire Publish Pipeline events
 * 14.  Wire AI Generation events
 * 15.  Wire Security Scanner events
 * 16.  Mark as booted
 *
 * Phase 5 additions:
 *  - providerRegistry replaces the single aiAdapter
 *  - budgetEngine is configured with session limits
 *  - aiGenerationEngine is wired to ai:generate events
 *  - securityScanner is wired to scan all prompts
 *  - generationLedger is wired to track all decisions
 *  - Human-in-the-loop events: ai:accept_decision, ai:modify_decision, ai:reject_decision, ai:lock_decision
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
import { AppRuntime }     from './app/runtime/appRuntime.js';
import { previewMode }    from './preview/previewMode.js';
import { publishPipeline } from './publish/publishPipeline.js';
import { outputTargets }  from './output/outputTargets.js';
import { runtimeErrorBoundary } from './preview/runtimeErrorBoundary.js';
import { RenderTarget }   from './renderer/renderTarget.js';

// Phase 5: AI systems
import { providerRegistry }   from './ai/providers/providerRegistry.js';
import { OpenAIProvider }     from './ai/providers/openAIProvider.js';
import { AnthropicProvider }  from './ai/providers/anthropicProvider.js';
import { budgetEngine }       from './ai/budget/budgetEngine.js';
import { aiGenerationEngine, GenerationStage } from './ai/generation/aiGenerationEngine.js';
import { securityScanner }    from './ai/security/securityScanner.js';
import { generationLedger }   from './ai/explainability/generationLedger.js';
import { LimitType }          from './ai/budget/budgetEngine.js';

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  // ── Step 1: Install global error handlers ──────────────────────────────────
  errorBoundary.installGlobalHandlers();
  logger.info('main', 'Nuvra booting (Phase 5)…');

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

  // ── Step 4: Configure AI Provider Registry ─────────────────────────────────
  const openaiKey    = _getEnvVar('NUVRA_OPENAI_KEY')    || _getEnvVar('OPENAI_API_KEY')    || null;
  const anthropicKey = _getEnvVar('NUVRA_ANTHROPIC_KEY') || _getEnvVar('ANTHROPIC_API_KEY') || null;

  // Register OpenAI as the primary provider
  providerRegistry.register(
    new OpenAIProvider({ apiKey: openaiKey }),
    { setActive: true }
  );
  logger.info('main', `OpenAI provider registered (key present: ${!!openaiKey})`);

  // Register Anthropic as the fallback provider (if key available)
  if (anthropicKey) {
    providerRegistry.register(
      new AnthropicProvider({ apiKey: anthropicKey }),
      { setFallback: true }
    );
    logger.info('main', 'Anthropic provider registered as fallback');
  }

  // Subscribe to provider events for logging
  providerRegistry.subscribe((event, data) => {
    if (event === 'provider:fallback_used') {
      logger.warn('main', `AI fallback used: ${data.primaryId} → ${data.fallbackId} (reason: ${data.reason})`);
      toastManager.show('Switched to fallback AI provider', 'warning', 3000);
    }
  });

  // ── Step 5: Configure Budget Engine ────────────────────────────────────────
  budgetEngine.configure({
    operation: {
      tokens: { type: LimitType.HARD, value: 8_000 },
      cost:   { type: LimitType.SOFT, value: 0.10  },
    },
    session: {
      tokens: { type: LimitType.SOFT, value: 200_000 },
      cost:   { type: LimitType.HARD, value: 5.00    },
      calls:  { type: LimitType.SOFT, value: 100      },
    },
  });

  budgetEngine.subscribe((event, data) => {
    if (event === 'budget:warning') {
      logger.warn('main', 'Budget warning', { warnings: data.warnings });
      toastManager.show(`Budget warning: ${data.warnings[0]}`, 'warning', 4000);
    }
    if (event === 'budget:blocked') {
      logger.error('main', 'Budget limit exceeded — AI call blocked', { reason: data.blocked });
      toastManager.show('AI call blocked: budget limit exceeded', 'error', 5000);
    }
  });

  logger.info('main', 'Budget engine configured');

  // ── Step 6: Register all modules (dependency order) ────────────────────────
  runtime
    .register(pageManager)
    .register(editorShell);

  // ── Step 7: Start all modules ──────────────────────────────────────────────
  await runtime.start();

  // ── Step 8: Wire auto-save ─────────────────────────────────────────────────
  store.subscribe((newState) => {
    storageEngine.scheduleSave(newState);
  });

  // ── Step 9: Wire save-requested event ──────────────────────────────────────
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

  // ── Step 10: Wire online/offline detection ─────────────────────────────────
  if (typeof window !== 'undefined') {
    window.addEventListener('online',  () => store.dispatch({ type: 'FLAGS/SET_ONLINE', payload: true  }));
    window.addEventListener('offline', () => store.dispatch({ type: 'FLAGS/SET_ONLINE', payload: false }));
  }

  // ── Step 11: Wire App Runtime activation ───────────────────────────────────
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
      runtimeErrorBoundary.capture(err, { module: 'appRuntime', errorClass: 'render_failed' });
    }
  });

  eventBus.on('app:runtime:teardown', ({ mountEl }) => {
    if (mountEl?._nuvraAppRuntime) {
      mountEl._nuvraAppRuntime.teardown();
      delete mountEl._nuvraAppRuntime;
      logger.info('main', 'AppRuntime torn down');
    }
  });

  // ── Step 12: Wire Preview Mode ─────────────────────────────────────────────
  eventBus.on('editor:enter_preview', async ({ appSchema, mountEl, debug }) => {
    if (!appSchema || !mountEl) {
      logger.warn('main', 'editor:enter_preview received without appSchema or mountEl');
      return;
    }
    store.dispatch({ type: 'PREVIEW/SET_STATE', payload: 'loading' });
    const result = await previewMode.enter({ appSchema, mountEl, debug: debug || false });
    if (!result.ok) {
      runtimeErrorBoundary.capture(new Error(result.error), { module: 'previewMode', errorClass: 'render_failed' });
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

  // ── Step 13: Wire Publish Pipeline ─────────────────────────────────────────
  eventBus.on('publish:run', async ({ appSchema, target, config }) => {
    if (!appSchema) {
      logger.warn('main', 'publish:run received without appSchema');
      return;
    }
    const resolvedTarget = target || RenderTarget.STATIC_SITE;
    store.dispatch({ type: 'PUBLISH/SET_STAGE', payload: 'validate' });

    const result = await publishPipeline.run({ appSchema, target: resolvedTarget, config: config || {} });

    if (!result.ok) {
      runtimeErrorBoundary.capture(new Error(result.error), { module: 'publishPipeline', errorClass: 'publish_error' });
      toastManager.show('Publish failed: ' + result.error, 'error', 5000);
      return;
    }

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

  // ── Step 14: Wire AI Generation events ─────────────────────────────────────

  // Subscribe to generation engine events for state updates
  aiGenerationEngine.subscribe((event, data) => {
    switch (event) {
      case 'generation:started':
        store.dispatch({ type: 'AI/SET_GENERATION_STAGE', payload: GenerationStage.EXTRACTING });
        store.dispatch({ type: 'AI/SET_GENERATION_RUN_ID', payload: data.runId });
        break;
      case 'generation:stage':
        store.dispatch({ type: 'AI/SET_GENERATION_STAGE', payload: data.stage });
        break;
      case 'generation:intent_complete':
        store.dispatch({ type: 'AI/SET_INTENT', payload: data.intent });
        break;
      case 'generation:plan_complete':
        store.dispatch({ type: 'AI/SET_PLAN', payload: data.plan });
        // Record plan decisions in the ledger
        generationLedger.recordPlanDecisions(data.runId, data.plan?.decisions);
        break;
      case 'generation:complete':
        store.dispatch({ type: 'AI/SET_GENERATION_STAGE', payload: GenerationStage.COMPLETE });
        store.dispatch({ type: 'AI/SET_SCHEMA', payload: data.schema });
        toastManager.show('Generation complete', 'success', 3000);
        eventBus.emit('ai:generation:complete', { schema: data.schema, runId: data.runId });
        break;
      case 'generation:failed':
        store.dispatch({ type: 'AI/SET_GENERATION_STAGE', payload: GenerationStage.FAILED });
        store.dispatch({ type: 'AI/SET_GENERATION_ERROR', payload: data.error });
        toastManager.show(`Generation failed: ${data.error}`, 'error', 5000);
        break;
    }
  });

  // Main generation trigger
  eventBus.on('ai:generate', async ({ prompt, options }) => {
    if (!prompt?.trim()) {
      toastManager.show('Please enter a description', 'warning', 3000);
      return;
    }

    // Security scan the prompt first
    const scan = securityScanner.scanPrompt(prompt);
    if (!scan.safe) {
      const highThreats = scan.threats.filter(t => t.level === 'high' || t.level === 'critical');
      if (highThreats.length > 0) {
        logger.warn('main', 'Prompt blocked by security scanner', { threats: highThreats });
        toastManager.show(`Prompt blocked: ${highThreats[0].description}`, 'error', 6000);
        store.dispatch({ type: 'AI/SET_GENERATION_ERROR', payload: highThreats[0].description });
        return;
      }
      // Medium threats: warn but continue with sanitized prompt
      toastManager.show('Prompt contains potentially sensitive content — proceeding with caution', 'warning', 4000);
    }

    // Start a ledger session
    const runId = _generateId('gen');
    generationLedger.startSession(runId, prompt);

    const result = await aiGenerationEngine.generate({
      prompt:   scan.sanitized || prompt,
      options:  options || {},
    });

    if (result.ok) {
      // Scan the generated schema
      const schemaScan = securityScanner.scanSchema(result.schema);
      if (!schemaScan.safe) {
        logger.error('main', 'Generated schema failed security scan', { threats: schemaScan.threats });
        toastManager.show('Generated schema contains unsafe patterns — blocked', 'error', 6000);
        store.dispatch({ type: 'AI/SET_GENERATION_ERROR', payload: 'Schema security scan failed' });
        return;
      }

      generationLedger.closeSession(runId);
      store.dispatch({ type: 'AI/SET_BUDGET_SUMMARY', payload: budgetEngine.getSessionSummary() });
    }
  });

  // Regeneration trigger
  eventBus.on('ai:regenerate', async ({ schema, target, targetId, instruction }) => {
    if (!schema || !instruction?.trim()) return;

    const result = await aiGenerationEngine.regenerate({ schema, target, targetId, instruction });
    if (result.ok) {
      const schemaScan = securityScanner.scanSchema(result.schema);
      if (!schemaScan.safe) {
        toastManager.show('Regenerated schema blocked by security scanner', 'error', 5000);
        return;
      }
      store.dispatch({ type: 'AI/SET_SCHEMA', payload: result.schema });
      toastManager.show('Regeneration complete', 'success', 3000);
    }
  });

  // ── Step 15: Wire Human-in-the-Loop events ─────────────────────────────────
  eventBus.on('ai:accept_decision', ({ runId, decisionId }) => {
    generationLedger.acceptDecision(runId, decisionId);
  });

  eventBus.on('ai:modify_decision', ({ runId, decisionId, newValue, userReason }) => {
    generationLedger.modifyDecision(runId, decisionId, newValue, userReason);
  });

  eventBus.on('ai:reject_decision', ({ runId, decisionId, feedback }) => {
    generationLedger.rejectDecision(runId, decisionId, feedback);
  });

  eventBus.on('ai:lock_decision', ({ runId, decisionId }) => {
    generationLedger.lockDecision(runId, decisionId);
  });

  // Budget reset
  eventBus.on('ai:reset_budget', () => {
    budgetEngine.resetSession();
    store.dispatch({ type: 'AI/SET_BUDGET_SUMMARY', payload: budgetEngine.getSessionSummary() });
    toastManager.show('AI budget reset', 'info', 2000);
  });

  // Provider switch
  eventBus.on('ai:set_provider', ({ providerId }) => {
    try {
      providerRegistry.setActive(providerId);
      store.dispatch({ type: 'AI/SET_ACTIVE_PROVIDER', payload: providerId });
      toastManager.show(`AI provider switched to ${providerId}`, 'success', 2000);
    } catch (err) {
      toastManager.show(`Unknown provider: ${providerId}`, 'error', 3000);
    }
  });

  // ── Step 16: Mark as booted ────────────────────────────────────────────────
  store.dispatch({ type: 'FLAGS/SET_BOOTED' });
  eventBus.emit('app:booted', { ts: Date.now() });
  logger.info('main', 'Nuvra booted successfully (Phase 5)');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _getEnvVar(name) {
  if (typeof window !== 'undefined' && window[name]) return window[name];
  if (typeof process !== 'undefined' && process.env?.[name]) return process.env[name];
  return null;
}

function _generateId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
boot().catch((err) => {
  errorBoundary.capture(err, {
    module:   'main',
    context:  'boot sequence',
    severity: ErrorSeverity.CRITICAL,
  });
});
