/**
 * main.js — Nuvra Phase 7
 *
 * The application boot sequence.
 *
 * Boot order:
 *  1.  Install global error boundary
 *  2.  Initialize the Core Runtime
 *  3.  Hydrate state from persistence
 *  4.  Initialize Secrets Manager
 *  5.  Configure AI Provider Registry (from secrets)
 *  6.  Configure Budget Engine limits
 *  7.  Initialize Auth Manager
 *  8.  Initialize Cloud Adapter
 *  9.  Initialize Ownership Manager
 * 10.  Initialize Cloud Storage
 * 11.  Initialize Sync Engine
 * 12.  Initialize Reconciliation Engine
 * 13.  Initialize AI Safety Boundary
 * 14.  Initialize AI Governance Layer
 * 15.  Initialize Usage Ledger
 * 16.  Initialize Entitlement Manager
 * 17.  Initialize Limit Enforcement Engine
 * 18.  Initialize AI Cost Governance
 * 19.  Initialize Billing Provider Registry
 * 20.  Initialize Abuse Detector
 * 21.  Initialize Billing Dashboard
 * 22.  Initialize Upgrade Engine
 * 23.  Initialize Enterprise Billing
 * 24.  Register all modules
 * 25.  Start all modules
 * 26.  Wire persistence auto-save
 * 27.  Wire save-requested event
 * 28.  Wire online/offline detection
 * 29.  Wire App Runtime activation
 * 30.  Wire Preview Mode activation/exit
 * 31.  Wire Publish Pipeline events
 * 32.  Wire AI Generation events (with safety + governance + billing)
 * 33.  Wire Auth events
 * 34.  Wire Cloud Sync events
 * 35.  Wire Governance events
 * 36.  Wire Billing events
 * 37.  Mark as booted
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

// Phase 6: Cloud, Auth, Governance
import { SecretsManager, KeyType, KeyScope } from './governance/secretsManager.js';
import { AuthManager }        from './auth/authManager.js';
import { LocalAuthProvider }  from './auth/providers/localAuthProvider.js';
import { SupabaseAuthProvider } from './auth/providers/supabaseAuthProvider.js';
import { LocalCloudAdapter }  from './cloud/adapters/localCloudAdapter.js';
import { SupabaseCloudAdapter } from './cloud/adapters/supabaseCloudAdapter.js';
import { OwnershipManager, Permission } from './ownership/ownershipManager.js';
import { CloudStorage }       from './cloud/storage/cloudStorage.js';
import { SyncEngine, MergeStrategy } from './cloud/sync/syncEngine.js';
import { ReconciliationEngine } from './cloud/reconciliation/reconciliationEngine.js';
import { AISafetyBoundary, AICapability, AIScope } from './governance/aiSafetyBoundary.js';
import { AIGovernanceLayer }  from './governance/aiGovernanceLayer.js';

// Phase 7: Billing & Usage Governance
import { UsageLedger }            from './billing/ledger/usageLedger.js';
import { Dimension }              from './billing/ledger/usageDimensions.js';
import { EntitlementManager }     from './billing/plans/entitlementManager.js';
import { LimitEnforcementEngine } from './billing/limits/limitEnforcementEngine.js';
import { AICostGovernance }       from './billing/limits/aiCostGovernance.js';
import { BillingProviderRegistry } from './billing/providers/billingProviderRegistry.js';
import { LocalBillingProvider }   from './billing/providers/localBillingProvider.js';
import { AbuseDetector }          from './billing/abuse/abuseDetector.js';
import { BillingDashboard }       from './billing/dashboard/billingDashboard.js';
import { UpgradeEngine }          from './billing/upgrade/upgradeEngine.js';
import { EnterpriseBilling }      from './billing/enterprise/enterpriseBilling.js';

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  // ── Step 1: Install global error handlers ──────────────────────────────────
  errorBoundary.installGlobalHandlers();
  logger.info('main', 'Nuvra booting (Phase 7)…');

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
      logger.info('main', `State migrated from v${version} to v${migrationsRun[migrationsRun.length - 1]}`);
    } else {
      logger.info('main', `State restored from storage (v${version})`);
    }
  } else {
    logger.info('main', 'No saved state — starting fresh');
  }

  // ── Step 4: Initialize Secrets Manager ─────────────────────────────────────
  const secretsManager = new SecretsManager({
    eventBus,
    getCurrentUserId: () => store.getState().auth?.userId || null,
  });

  const envOpenAIKey    = _getEnvVar('NUVRA_OPENAI_KEY')    || _getEnvVar('OPENAI_API_KEY');
  const envAnthropicKey = _getEnvVar('NUVRA_ANTHROPIC_KEY') || _getEnvVar('ANTHROPIC_API_KEY');
  const envSupabaseUrl  = _getEnvVar('SUPABASE_URL');
  const envSupabaseKey  = _getEnvVar('SUPABASE_KEY');

  logger.info('main', 'Secrets Manager initialized');

  // ── Step 5: Configure AI Provider Registry ─────────────────────────────────
  const openaiKey    = envOpenAIKey    || null;
  const anthropicKey = envAnthropicKey || null;

  providerRegistry.register(new OpenAIProvider({ apiKey: openaiKey }), { setActive: true });
  logger.info('main', `OpenAI provider registered (key present: ${!!openaiKey})`);

  if (anthropicKey) {
    providerRegistry.register(new AnthropicProvider({ apiKey: anthropicKey }), { setFallback: true });
    logger.info('main', 'Anthropic provider registered as fallback');
  }

  providerRegistry.subscribe((event, data) => {
    if (event === 'provider:fallback_used') {
      logger.warn('main', `AI fallback used: ${data.primaryId} → ${data.fallbackId}`);
      toastManager.show('Switched to fallback AI provider', 'warning', 3000);
    }
  });

  // ── Step 6: Configure Budget Engine ────────────────────────────────────────
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
      toastManager.show(`Budget warning: ${data.warnings[0]}`, 'warning', 4000);
    }
    if (event === 'budget:blocked') {
      toastManager.show('AI call blocked: budget limit exceeded', 'error', 5000);
    }
  });

  logger.info('main', 'Budget engine configured');

  // ── Step 7: Initialize Auth Manager ────────────────────────────────────────
  const supabaseUrl = envSupabaseUrl || null;
  const supabaseKey = envSupabaseKey || null;

  let authProvider;
  if (supabaseUrl && supabaseKey) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm').catch(() => ({ createClient: null }));
    if (createClient) {
      const supabaseClient = createClient(supabaseUrl, supabaseKey);
      authProvider = new SupabaseAuthProvider({ client: supabaseClient });
      logger.info('main', 'Supabase auth provider initialized');
    } else {
      authProvider = new LocalAuthProvider();
      logger.info('main', 'Supabase import failed — using local auth provider');
    }
  } else {
    authProvider = new LocalAuthProvider();
    logger.info('main', 'Local auth provider initialized (no Supabase credentials)');
  }

  const authManager = new AuthManager({
    provider:       authProvider,
    store,
    eventBus,
    tokenManager:   { store: (k, v) => {}, retrieve: (k) => null, clear: (k) => {} },
    sessionManager: { create: (s) => {}, restore: () => null, clear: () => {} },
  });

  await authManager.restoreSession();
  logger.info('main', `Auth session restored (authenticated: ${authManager.isAuthenticated()})`);

  // ── Step 8: Initialize Cloud Adapter ───────────────────────────────────────
  let cloudAdapter;
  if (supabaseUrl && supabaseKey) {
    try {
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm').catch(() => ({ createClient: null }));
      if (createClient) {
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        cloudAdapter = new SupabaseCloudAdapter({
          client:         supabaseClient,
          getAccessToken: () => authManager.getAccessToken(),
        });
        logger.info('main', 'Supabase cloud adapter initialized');
      } else {
        cloudAdapter = new LocalCloudAdapter();
      }
    } catch (err) {
      cloudAdapter = new LocalCloudAdapter();
      logger.warn('main', 'Cloud adapter init failed — using local adapter', { error: err.message });
    }
  } else {
    cloudAdapter = new LocalCloudAdapter();
    logger.info('main', 'Local cloud adapter initialized');
  }

  // ── Step 9: Initialize Ownership Manager ───────────────────────────────────
  const ownershipManager = new OwnershipManager({
    store, eventBus, cloudAdapter,
    getCurrentUserId: () => store.getState().auth?.userId || null,
  });

  if (authManager.isAuthenticated()) {
    await ownershipManager.loadProjects();
    logger.info('main', 'Projects loaded');
  }

  // ── Step 10: Initialize Cloud Storage ──────────────────────────────────────
  const cloudStorage = new CloudStorage({ adapter: cloudAdapter, ownershipManager, eventBus });

  // ── Step 11: Initialize Sync Engine ────────────────────────────────────────
  const syncEngine = new SyncEngine({
    cloudAdapter, store, eventBus,
    defaultStrategy: MergeStrategy.LATEST_WINS,
    getLocalSchema:  async (projectId, schemaType) => store.getState().schemas?.[projectId]?.[schemaType] || null,
    setLocalSchema:  async (projectId, schemaType, data) => store.dispatch({ type: 'SCHEMA/SET', payload: { projectId, schemaType, data } }),
  });

  // ── Step 12: Initialize Reconciliation Engine ───────────────────────────────
  const reconciliationEngine = new ReconciliationEngine({
    cloudStorage, store, eventBus,
    getLocalState:   async (projectId, schemaType) => store.getState().schemas?.[projectId]?.[schemaType] || null,
    applyLocalState: async (projectId, schemaType, data) => store.dispatch({ type: 'SCHEMA/SET', payload: { projectId, schemaType, data } }),
  });

  // ── Step 13: Initialize AI Safety Boundary ─────────────────────────────────
  const aiSafetyBoundary = new AISafetyBoundary({
    store, eventBus, ownershipManager,
    getCurrentUserId: () => store.getState().auth?.userId || null,
    limits: {
      maxTokensPerCall:    8_000,
      maxCostPerCall:      0.10,
      maxTokensPerSession: 200_000,
      maxCostPerSession:   5.00,
      maxCallsPerSession:  100,
    },
  });

  // ── Step 14: Initialize AI Governance Layer ─────────────────────────────────
  const aiGovernance = new AIGovernanceLayer({
    store, eventBus,
    getCurrentUserId: () => store.getState().auth?.userId || null,
    config: {
      requireApprovalForGeneration: false,
      requireApprovalForMutation:   true,
      autoApproveBelow:             5,
    },
  });

  // ── Step 15: Initialize Usage Ledger ───────────────────────────────────────
  const usageLedger = new UsageLedger({ eventBus, logger });
  logger.info('main', 'Usage Ledger initialized');

  // ── Step 16: Initialize Entitlement Manager ────────────────────────────────
  const entitlementManager = new EntitlementManager({
    ledger:           usageLedger,
    getPlanId:        () => store.getState().billing?.planId || 'free',
    getCurrentUserId: () => store.getState().auth?.userId || null,
    eventBus,
  });
  logger.info('main', 'Entitlement Manager initialized');

  // ── Step 17: Initialize Limit Enforcement Engine ───────────────────────────
  const limitEngine = new LimitEnforcementEngine({
    ledger:             usageLedger,
    entitlementManager,
    eventBus,
    logger,
  });

  limitEngine.on('limit:soft_warning', ({ dimension, pct, planId }) => {
    toastManager.show(`Usage warning: ${dimension} at ${pct.toFixed(0)}% of plan limit`, 'warning', 4000);
    store.dispatch({ type: 'BILLING/SET_LIMIT_WARNING', payload: { dimension, pct } });
  });

  limitEngine.on('limit:hard_blocked', ({ dimension, planId }) => {
    toastManager.show(`Limit reached: ${dimension}. Upgrade your plan to continue.`, 'error', 6000);
    store.dispatch({ type: 'BILLING/SET_LIMIT_BLOCKED', payload: { dimension } });
  });

  logger.info('main', 'Limit Enforcement Engine initialized');

  // ── Step 18: Initialize AI Cost Governance ─────────────────────────────────
  const aiCostGovernance = new AICostGovernance({
    ledger:           usageLedger,
    entitlementManager,
    eventBus,
    logger,
    defaultLimits: {
      perSessionUSD:  5.00,
      perProjectUSD:  50.00,
      perMonthUSD:    100.00,
    },
  });

  aiCostGovernance.on('cost:warning', ({ scope, costUSD, limitUSD }) => {
    toastManager.show(`AI cost warning: $${costUSD.toFixed(4)} of $${limitUSD.toFixed(2)} ${scope} limit`, 'warning', 4000);
  });

  aiCostGovernance.on('cost:blocked', ({ scope, reason }) => {
    toastManager.show(`AI blocked: ${reason}`, 'error', 5000);
    store.dispatch({ type: 'BILLING/SET_AI_COST_BLOCKED', payload: { scope, reason } });
  });

  logger.info('main', 'AI Cost Governance initialized');

  // ── Step 19: Initialize Billing Provider Registry ──────────────────────────
  const billingProviders = new BillingProviderRegistry();
  // LocalBillingProvider is registered by default in the registry constructor
  logger.info('main', 'Billing Provider Registry initialized');

  // ── Step 20: Initialize Abuse Detector ─────────────────────────────────────
  const abuseDetector = new AbuseDetector({ eventBus, logger });

  abuseDetector.on = (event, handler) => eventBus.on(`billing:abuse:${event}`, handler);

  eventBus.on('billing:abuse:detected', ({ userId, code, action, reason }) => {
    logger.warn('main', `Abuse detected: ${code} for ${userId} — action: ${action}`, { reason });
    if (action === 'block') {
      toastManager.show(`Account flagged for suspicious activity: ${code}`, 'error', 8000);
      store.dispatch({ type: 'BILLING/SET_ABUSE_FLAG', payload: { userId, code, reason } });
    } else if (action === 'throttle') {
      toastManager.show('Slow down — too many requests', 'warning', 4000);
    }
  });

  logger.info('main', 'Abuse Detector initialized');

  // ── Step 21: Initialize Billing Dashboard ──────────────────────────────────
  const billingDashboard = new BillingDashboard({
    ledger:             usageLedger,
    entitlementManager,
  });
  logger.info('main', 'Billing Dashboard initialized');

  // ── Step 22: Initialize Upgrade Engine ─────────────────────────────────────
  const upgradeEngine = new UpgradeEngine({
    billingProviderRegistry: billingProviders,
    ledger:                  usageLedger,
    eventBus,
    logger,
  });
  logger.info('main', 'Upgrade Engine initialized');

  // ── Step 23: Initialize Enterprise Billing ─────────────────────────────────
  const enterpriseBilling = new EnterpriseBilling({ ledger: usageLedger, eventBus, logger });
  logger.info('main', 'Enterprise Billing initialized');

  // ── Step 24: Register all modules ──────────────────────────────────────────
  runtime
    .register(pageManager)
    .register(editorShell);

  // ── Step 25: Start all modules ─────────────────────────────────────────────
  await runtime.start();

  // ── Step 26: Wire auto-save ─────────────────────────────────────────────────
  store.subscribe((newState) => {
    storageEngine.scheduleSave(newState);
  });

  // ── Step 27: Wire save-requested event ─────────────────────────────────────
  eventBus.on('editor:save_requested', () => {
    const result = storageEngine.save(store.getState());
    if (result.ok) {
      store.dispatch({ type: 'FLAGS/SET_LAST_SAVED', payload: Date.now() });
      store.dispatch({ type: 'EDITOR/MARK_CLEAN' });
      toastManager.show('Saved', 'success', 2000);
    } else {
      errorBoundary.capture(new Error(result.error), {
        module: 'persistence', context: 'manual save', severity: ErrorSeverity.HIGH,
      });
    }
  });

  // ── Step 28: Wire online/offline detection ──────────────────────────────────
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      store.dispatch({ type: 'FLAGS/SET_ONLINE', payload: true });
      const activeProjectId = store.getState().activeProjectId;
      if (activeProjectId && syncEngine.getOfflineQueueSize() > 0) {
        syncEngine.sync(activeProjectId, ['site_schema', 'app_schema', 'data_model'])
          .then(result => {
            if (result.ok) toastManager.show(`Synced ${result.pushed} offline changes`, 'success', 3000);
          });
      }
    });
    window.addEventListener('offline', () => {
      store.dispatch({ type: 'FLAGS/SET_ONLINE', payload: false });
      toastManager.show('You are offline — changes will sync when reconnected', 'warning', 4000);
    });
  }

  // ── Step 29: Wire App Runtime activation ───────────────────────────────────
  eventBus.on('app:runtime:boot', async ({ appSchema, mountEl, mode }) => {
    if (!appSchema || !mountEl) return;
    try {
      const appRuntime = new AppRuntime({ appSchema, mountEl, mode: mode || 'preview' });
      await appRuntime.boot();
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
    }
  });

  // ── Step 30: Wire Preview Mode ──────────────────────────────────────────────
  eventBus.on('editor:enter_preview', async ({ appSchema, mountEl, debug }) => {
    if (!appSchema || !mountEl) return;
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
  });

  // ── Step 31: Wire Publish Pipeline ─────────────────────────────────────────
  eventBus.on('publish:run', async ({ appSchema, target, config }) => {
    if (!appSchema) return;

    // Phase 7: Check publish entitlement
    const userId = store.getState().auth?.userId || null;
    const planId = store.getState().billing?.planId || 'free';
    const check  = limitEngine.check({ dimension: Dimension.PUBLISHES, userId, planId });

    if (!check.allowed) {
      toastManager.show(`Publish blocked: ${check.reason}`, 'error', 6000);
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

    // Record the publish in the usage ledger
    if (userId) {
      usageLedger.record({
        dimension:  Dimension.PUBLISHES,
        quantity:   1,
        userId,
        projectId:  appSchema.id,
        meta:       { target: resolvedTarget },
      });
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
  });

  // ── Step 32: Wire AI Generation events (with safety + governance + billing) ─
  aiGenerationEngine.subscribe((event, data) => {
    switch (event) {
      case 'generation:started':
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

  eventBus.on('ai:generate', async ({ prompt, options, projectId }) => {
    if (!prompt?.trim()) {
      toastManager.show('Please enter a description', 'warning', 3000);
      return;
    }

    const userId = store.getState().auth?.userId || null;
    const planId = store.getState().billing?.planId || 'free';

    // Phase 7: Abuse detection
    if (userId) {
      const sessionCost = aiCostGovernance.getSessionCostUSD(userId);
      const planMonthly = entitlementManager.getEntitlement(planId, Dimension.AI_COST_USD)?.limit || Infinity;
      const abuseCheck  = abuseDetector.check({
        userId,
        prompt,
        resourceId:              projectId,
        estimatedInputTokens:    Math.ceil(prompt.length / 4),
        estimatedOutputTokens:   2000,
        sessionCostUSD:          sessionCost,
        monthlyBudgetUSD:        planMonthly,
      });

      if (!abuseCheck.clean) {
        if (abuseCheck.action === 'block') {
          toastManager.show(`Request blocked: ${abuseCheck.code}`, 'error', 6000);
          return;
        }
        if (abuseCheck.action === 'throttle') {
          toastManager.show('Slow down — too many similar requests', 'warning', 4000);
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }

    // Phase 7: AI cost governance check
    if (userId) {
      const costCheck = aiCostGovernance.checkBeforeCall({
        userId,
        projectId,
        estimatedCostUSD: 0.05,
      });
      if (!costCheck.allowed) {
        toastManager.show(`AI blocked: ${costCheck.reason}`, 'error', 5000);
        return;
      }
    }

    // Phase 7: Entitlement check for AI generations
    if (userId) {
      const entCheck = limitEngine.check({ dimension: Dimension.AI_GENERATIONS, userId, planId });
      if (!entCheck.allowed) {
        toastManager.show(`AI generation limit reached. ${entCheck.upgradeMessage || 'Upgrade to continue.'}`, 'error', 6000);
        return;
      }
    }

    // Phase 6: Safety boundary check
    const boundaryCheck = aiSafetyBoundary.checkPermission({
      projectId:       projectId || null,
      capability:      AICapability.GENERATION,
      scope:           projectId ? AIScope.PROJECT : AIScope.GLOBAL,
      estimatedTokens: Math.ceil(prompt.length / 4) * 10,
      estimatedCost:   0.05,
    });

    if (!boundaryCheck.allowed) {
      toastManager.show(`AI blocked: ${boundaryCheck.reason}`, 'error', 5000);
      aiGovernance.recordSafetyBlock({ operationId: _generateId('op'), projectId, reason: boundaryCheck.reason, code: boundaryCheck.code });
      return;
    }

    if (boundaryCheck.warning) {
      toastManager.show(`AI warning: ${boundaryCheck.reason}`, 'warning', 4000);
    }

    // Security scan the prompt
    const scan = securityScanner.scanPrompt(prompt);
    if (!scan.safe) {
      const highThreats = scan.threats.filter(t => t.level === 'high' || t.level === 'critical');
      if (highThreats.length > 0) {
        toastManager.show(`Prompt blocked: ${highThreats[0].description}`, 'error', 6000);
        store.dispatch({ type: 'AI/SET_GENERATION_ERROR', payload: highThreats[0].description });
        return;
      }
      toastManager.show('Prompt contains sensitive content — proceeding with caution', 'warning', 4000);
    }

    const runId = _generateId('gen');
    generationLedger.startSession(runId, prompt);

    aiGovernance.recordPromptSent({
      operationId:     runId,
      projectId,
      capability:      AICapability.GENERATION,
      provider:        providerRegistry.getActive()?.id || 'unknown',
      model:           'gpt-4o',
      prompt:          scan.sanitized || prompt,
      estimatedTokens: Math.ceil(prompt.length / 4) * 10,
      estimatedCost:   0.05,
    });

    const result = await aiGenerationEngine.generate({
      prompt:  scan.sanitized || prompt,
      options: options || {},
    });

    if (result.ok) {
      const schemaScan = securityScanner.scanSchema(result.schema);
      if (!schemaScan.safe) {
        toastManager.show('Generated schema contains unsafe patterns — blocked', 'error', 6000);
        store.dispatch({ type: 'AI/SET_GENERATION_ERROR', payload: 'Schema security scan failed' });
        return;
      }

      const approval = aiGovernance.requestApproval({
        operationId:    runId,
        projectId,
        capability:     AICapability.GENERATION,
        proposedSchema: result.schema,
        previousSchema: null,
      });

      if (approval.status === 'pending') {
        toastManager.show('AI generation requires approval — check the governance panel', 'info', 5000);
        store.dispatch({ type: 'AI/SET_PENDING_APPROVAL', payload: { approvalId: approval.approvalId, schema: result.schema } });
      } else {
        aiSafetyBoundary.recordUsage(projectId, result.tokensUsed || 0, result.costUsd || 0);
        aiGovernance.recordSchemaDiff({ operationId: runId, projectId, schemaType: 'app_schema', before: null, after: result.schema });

        // Phase 7: Record usage in ledger
        if (userId) {
          const inputTokens  = result.tokensUsed?.input  || Math.ceil(prompt.length / 4) * 10;
          const outputTokens = result.tokensUsed?.output || 1000;
          const costUSD      = result.costUsd || 0.05;

          usageLedger.record({ dimension: Dimension.AI_GENERATIONS,   quantity: 1,            userId, projectId });
          usageLedger.record({ dimension: Dimension.AI_TOKENS_INPUT,  quantity: inputTokens,  userId, projectId, provider: providerRegistry.getActive()?.id });
          usageLedger.record({ dimension: Dimension.AI_TOKENS_OUTPUT, quantity: outputTokens, userId, projectId, provider: providerRegistry.getActive()?.id });
          usageLedger.record({ dimension: Dimension.AI_COST_USD,      quantity: costUSD,      userId, projectId, provider: providerRegistry.getActive()?.id, meta: { model: 'gpt-4o' } });

          aiCostGovernance.recordCost({ userId, projectId, costUSD, inputTokens, outputTokens });

          // Update billing state
          store.dispatch({ type: 'BILLING/SET_SESSION_COST', payload: aiCostGovernance.getSessionCostUSD(userId) });
        }
      }

      generationLedger.closeSession(runId);
      store.dispatch({ type: 'AI/SET_BUDGET_SUMMARY', payload: budgetEngine.getSessionSummary() });
    }
  });

  eventBus.on('ai:regenerate', async ({ schema, target, targetId, instruction, projectId }) => {
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

  // ── Step 33: Wire Auth events ───────────────────────────────────────────────
  eventBus.on('auth:sign_in', async ({ email, password, provider }) => {
    let result;
    if (provider === 'google' || provider === 'github') {
      result = await authManager.signInWithOAuth(provider);
    } else {
      result = await authManager.signIn(email, password);
    }
    if (result.ok) {
      await ownershipManager.loadProjects();
      toastManager.show('Signed in', 'success', 2000);
    } else {
      toastManager.show(`Sign in failed: ${result.error}`, 'error', 4000);
    }
  });

  eventBus.on('auth:sign_up', async ({ email, password }) => {
    const result = await authManager.signUp(email, password);
    if (result.ok) {
      toastManager.show('Account created — check your email to verify', 'success', 4000);
    } else {
      toastManager.show(`Sign up failed: ${result.error}`, 'error', 4000);
    }
  });

  eventBus.on('auth:sign_out', async () => {
    await authManager.signOut();
    store.dispatch({ type: 'PROJECTS/CLEAR' });
    toastManager.show('Signed out', 'info', 2000);
  });

  // ── Step 34: Wire Cloud Sync events ────────────────────────────────────────
  eventBus.on('cloud:sync', async ({ projectId, schemaTypes }) => {
    if (!projectId) return;
    const types  = schemaTypes || ['site_schema', 'app_schema', 'data_model'];
    const result = await syncEngine.sync(projectId, types);
    if (result.ok) {
      if (result.conflicts > 0) {
        toastManager.show(`Sync complete — ${result.conflicts} conflict(s) need review`, 'warning', 5000);
      } else {
        toastManager.show(`Synced (↑${result.pushed} ↓${result.pulled})`, 'success', 2000);
      }
    } else if (!result.skipped) {
      toastManager.show(`Sync failed: ${result.error}`, 'error', 4000);
    }
  });

  eventBus.on('cloud:resolve_conflict', async ({ conflictId, resolution, mergedData }) => {
    const result = await syncEngine.resolveConflict(conflictId, resolution, mergedData);
    if (result.ok) toastManager.show('Conflict resolved', 'success', 2000);
  });

  eventBus.on('cloud:save_schema', async ({ projectId, schemaType, data }) => {
    if (!projectId || !schemaType || !data) return;
    const result = await cloudStorage.save(projectId, schemaType, data);
    if (!result.ok) {
      syncEngine.queueOfflineChange(projectId, schemaType, data);
      logger.warn('main', 'Cloud save failed — queued for offline sync', { projectId, schemaType });
    }
  });

  eventBus.on('cloud:reconcile', async ({ projectId }) => {
    if (!projectId) return;
    const result = await reconciliationEngine.reconcile(projectId, ['site_schema', 'app_schema', 'data_model']);
    if (result.requiresManualReview) {
      toastManager.show(`Reconciliation found ${result.conflicts} conflict(s) — review required`, 'warning', 5000);
    } else if (result.ok) {
      toastManager.show(`Reconciled (${result.applied} change(s) applied)`, 'success', 2000);
    }
  });

  // ── Step 35: Wire Governance events ────────────────────────────────────────
  eventBus.on('governance:approve', ({ approvalId, reason }) => {
    const result = aiGovernance.approve(approvalId, reason);
    if (result.ok) {
      const pending = store.getState().ai?.pendingApproval;
      if (pending?.approvalId === approvalId) {
        store.dispatch({ type: 'AI/SET_SCHEMA', payload: pending.schema });
        store.dispatch({ type: 'AI/CLEAR_PENDING_APPROVAL' });
        toastManager.show('AI generation approved and applied', 'success', 3000);
      }
    }
  });

  eventBus.on('governance:reject', ({ approvalId, reason }) => {
    aiGovernance.reject(approvalId, reason);
    store.dispatch({ type: 'AI/CLEAR_PENDING_APPROVAL' });
    toastManager.show('AI generation rejected', 'info', 2000);
  });

  eventBus.on('ai:accept_decision',  ({ runId, decisionId }) => generationLedger.acceptDecision(runId, decisionId));
  eventBus.on('ai:modify_decision',  ({ runId, decisionId, newValue, userReason }) => generationLedger.modifyDecision(runId, decisionId, newValue, userReason));
  eventBus.on('ai:reject_decision',  ({ runId, decisionId, feedback }) => generationLedger.rejectDecision(runId, decisionId, feedback));
  eventBus.on('ai:lock_decision',    ({ runId, decisionId }) => generationLedger.lockDecision(runId, decisionId));
  eventBus.on('ai:reset_budget',     () => {
    budgetEngine.resetSession();
    aiSafetyBoundary.resetSessionUsage();
    store.dispatch({ type: 'AI/SET_BUDGET_SUMMARY', payload: budgetEngine.getSessionSummary() });
    toastManager.show('AI budget reset', 'info', 2000);
  });
  eventBus.on('ai:set_provider', ({ providerId }) => {
    try {
      providerRegistry.setActive(providerId);
      store.dispatch({ type: 'AI/SET_ACTIVE_PROVIDER', payload: providerId });
      toastManager.show(`AI provider switched to ${providerId}`, 'success', 2000);
    } catch (err) {
      toastManager.show(`Unknown provider: ${providerId}`, 'error', 3000);
    }
  });

  eventBus.on('secrets:store_key', ({ keyType, value, scope, projectId, label }) => {
    const result = secretsManager.storeKey(keyType, value, { scope, projectId, label });
    if (result.ok) {
      toastManager.show('Key stored securely', 'success', 2000);
      if (keyType === KeyType.OPENAI_API_KEY) {
        const newKey = secretsManager.getKey(KeyType.OPENAI_API_KEY);
        if (newKey) providerRegistry.register(new OpenAIProvider({ apiKey: newKey }), { setActive: true });
      }
    } else {
      toastManager.show(`Key storage failed: ${result.error}`, 'error', 3000);
    }
  });

  // ── Step 36: Wire Billing events ───────────────────────────────────────────

  // Get billing dashboard data
  eventBus.on('billing:get_dashboard', () => {
    const userId = store.getState().auth?.userId || null;
    const planId = store.getState().billing?.planId || 'free';
    if (!userId) return;
    const data = billingDashboard.getDashboardData({ userId, planId });
    store.dispatch({ type: 'BILLING/SET_DASHBOARD', payload: data });
  });

  // Preview a plan transition
  eventBus.on('billing:preview_transition', ({ fromPlanId, toPlanId, currentPeriodEnd }) => {
    const preview = upgradeEngine.previewTransition({ userId: store.getState().auth?.userId, fromPlanId, toPlanId, currentPeriodEnd });
    store.dispatch({ type: 'BILLING/SET_TRANSITION_PREVIEW', payload: preview });
  });

  // Execute an upgrade
  eventBus.on('billing:upgrade', async ({ toPlanId, successUrl, cancelUrl }) => {
    const userId     = store.getState().auth?.userId || null;
    const customerId = store.getState().billing?.customerId || null;
    const fromPlanId = store.getState().billing?.planId || 'free';
    if (!userId) return;

    const result = await upgradeEngine.executeUpgrade({ userId, customerId, fromPlanId, toPlanId, successUrl, cancelUrl });
    if (result.ok) {
      if (result.checkoutUrl) {
        if (typeof window !== 'undefined') window.location.href = result.checkoutUrl;
      } else {
        store.dispatch({ type: 'BILLING/SET_PLAN', payload: toPlanId });
        toastManager.show(`Upgraded to ${toPlanId}`, 'success', 3000);
      }
    } else {
      toastManager.show(`Upgrade failed: ${result.error}`, 'error', 4000);
    }
  });

  // Schedule a downgrade
  eventBus.on('billing:schedule_downgrade', async ({ toPlanId, subscriptionId, currentPeriodEnd }) => {
    const userId     = store.getState().auth?.userId || null;
    const fromPlanId = store.getState().billing?.planId || 'free';
    if (!userId) return;

    const result = await upgradeEngine.scheduleDowngrade({ userId, subscriptionId, fromPlanId, toPlanId, currentPeriodEnd });
    if (result.ok) {
      store.dispatch({ type: 'BILLING/SET_PENDING_DOWNGRADE', payload: { toPlanId, effectiveAt: result.effectiveAt } });
      toastManager.show(`Downgrade to ${toPlanId} scheduled for ${result.effectiveAt}`, 'info', 5000);
    } else {
      toastManager.show(`Downgrade failed: ${result.error}`, 'error', 4000);
    }
  });

  // Cancel a pending downgrade
  eventBus.on('billing:cancel_downgrade', () => {
    const userId = store.getState().auth?.userId || null;
    if (!userId) return;
    upgradeEngine.cancelPendingDowngrade(userId);
    store.dispatch({ type: 'BILLING/CLEAR_PENDING_DOWNGRADE' });
    toastManager.show('Downgrade cancelled', 'success', 2000);
  });

  // Export usage data
  eventBus.on('billing:export_usage', ({ format, since, until }) => {
    const userId = store.getState().auth?.userId || null;
    if (!userId) return;
    const { since: mSince, until: mUntil } = UsageLedger.currentMonthWindow();
    const exportSince = since || mSince;
    const exportUntil = until || mUntil;

    if (format === 'csv') {
      const csv = usageLedger.exportCSV(userId, exportSince, exportUntil);
      _downloadText(csv, `nuvra-usage-${exportSince.slice(0, 7)}.csv`, 'text/csv');
    } else {
      const json = usageLedger.exportJSON(userId, exportSince, exportUntil);
      _downloadText(JSON.stringify(json, null, 2), `nuvra-usage-${exportSince.slice(0, 7)}.json`, 'application/json');
    }
    toastManager.show('Usage data exported', 'success', 2000);
  });

  // Clear abuse flag (admin action)
  eventBus.on('billing:clear_abuse_flag', ({ userId }) => {
    abuseDetector.clearFlag(userId);
    store.dispatch({ type: 'BILLING/CLEAR_ABUSE_FLAG', payload: { userId } });
    toastManager.show('Abuse flag cleared', 'success', 2000);
  });

  // ── Step 37: Mark as booted ─────────────────────────────────────────────────
  store.dispatch({ type: 'FLAGS/SET_BOOTED' });
  eventBus.emit('app:booted', { ts: Date.now() });
  logger.info('main', 'Nuvra booted successfully (Phase 7)');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _getEnvVar(name) {
  if (typeof window !== 'undefined' && window[name]) return window[name];
  if (typeof process !== 'undefined' && process.env?.[name]) return process.env[name];
  return null;
}

function _generateId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function _downloadText(content, filename, mimeType) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot().catch(err => {
      console.error('[Nuvra] Boot failed:', err);
    });
  }
} else {
  // Node.js environment (tests)
  module.exports = { boot };
}
