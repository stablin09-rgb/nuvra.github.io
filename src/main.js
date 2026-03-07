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
 * Phase 8 additions (Steps 38–44):
 * 38.  Initialize AI Extension Layer
 * 39.  Initialize Extension Governance
 * 40.  Initialize Extension Registry
 * 41.  Initialize Marketplace Catalog
 * 42.  Initialize Revenue Engine
 * 43.  Initialize Compatibility Matrix
 * 44.  Initialize Extension Dev Tools + wire all extension events
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

// Phase 8: Extensions & Marketplace
import { ExtensionRegistry }   from './extensions/registry/extensionRegistry.js';
import { MarketplaceCatalog }  from './marketplace/catalog/marketplaceCatalog.js';
import { RevenueEngine }       from './monetization/revenue/revenueEngine.js';
import { ExtensionGovernance } from './governance/extensions/extensionGovernance.js';
import { AIExtensionLayer }    from './ai/extensions/aiExtensionLayer.js';
import { ExtensionDevTools }   from './extensions/devtools/extensionDevTools.js';
import { CompatibilityMatrix } from './extensions/compatibility/compatibilityMatrix.js';

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  // ── Step 1: Install global error handlers ──────────────────────────────────
  errorBoundary.installGlobalHandlers();
  logger.info('main', 'Nuvra booting (Phase 8)…');

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
    if (event === 'provider:blocked') {
      toastManager.show('AI provider blocked: ' + data.reason, 'error', 5000);
    }
  });

  logger.info('main', 'AI Provider Registry configured');

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
  const supabaseUrl = _getEnvVar('SUPABASE_URL') || null;
  const supabaseKey = _getEnvVar('SUPABASE_KEY') || null;

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
    sessionManager: { create: (s) => {}, restore: () => null, clear: (k) => {} },
  });

  await authManager.restoreSession();
  logger.info('main', `Auth manager initialized (user: ${store.getState().auth?.userId || 'none'})`);

  // ── Step 8: Initialize Cloud Adapter ───────────────────────────────────────
  let cloudAdapter;
  if (supabaseUrl && supabaseKey) {
    cloudAdapter = new SupabaseCloudAdapter({ supabaseUrl, supabaseKey });
    logger.info('main', 'Supabase cloud adapter initialized');
  } else {
    cloudAdapter = new LocalCloudAdapter();
    logger.info('main', 'Local cloud adapter initialized (no Supabase credentials)');
  }

  // ── Step 9: Initialize Ownership Manager ───────────────────────────────────
  const ownershipManager = new OwnershipManager({ store, eventBus, logger });
  logger.info('main', 'Ownership manager initialized');

  // ── Step 10: Initialize Cloud Storage ──────────────────────────────────────
  const cloudStorage = new CloudStorage({ cloudAdapter, logger });
  logger.info('main', 'Cloud storage initialized');

  // ── Step 11: Initialize Sync Engine ────────────────────────────────────────
  const syncEngine = new SyncEngine({ cloudAdapter, store, eventBus, logger });
  logger.info('main', 'Sync engine initialized');

  // ── Step 12: Initialize Reconciliation Engine ──────────────────────────────
  const reconciliationEngine = new ReconciliationEngine({ store, eventBus, logger });
  logger.info('main', 'Reconciliation engine initialized');

  // ── Step 13: Initialize AI Safety Boundary ─────────────────────────────────
  const aiSafetyBoundary = new AISafetyBoundary({ logger });
  logger.info('main', 'AI Safety Boundary initialized');

  // ── Step 14: Initialize AI Governance Layer ────────────────────────────────
  const aiGovernanceLayer = new AIGovernanceLayer({ store, eventBus, logger });
  logger.info('main', 'AI Governance Layer initialized');

  // ── Step 15: Initialize Usage Ledger ───────────────────────────────────────
  const usageLedger = new UsageLedger({ store, eventBus, logger });
  logger.info('main', 'Usage Ledger initialized');

  // ── Step 16: Initialize Entitlement Manager ────────────────────────────────
  const entitlementManager = new EntitlementManager({ store, eventBus, logger });
  logger.info('main', 'Entitlement Manager initialized');

  // ── Step 17: Initialize Limit Enforcement Engine ───────────────────────────
  const limitEnforcementEngine = new LimitEnforcementEngine({ store, eventBus, logger });
  logger.info('main', 'Limit Enforcement Engine initialized');

  // ── Step 18: Initialize AI Cost Governance ─────────────────────────────────
  const aiCostGovernance = new AICostGovernance({ store, eventBus, logger });
  logger.info('main', 'AI Cost Governance initialized');

  // ── Step 19: Initialize Billing Provider Registry ──────────────────────────
  const billingProviders = new BillingProviderRegistry({ logger });
  billingProviders.register(new LocalBillingProvider());
  logger.info('main', 'Billing Provider Registry initialized');

  // ── Step 20: Initialize Abuse Detector ─────────────────────────────────────
  const abuseDetector = new AbuseDetector({ eventBus, logger });
  logger.info('main', 'Abuse Detector initialized');

  // ── Step 21: Initialize Billing Dashboard ──────────────────────────────────
  const billingDashboard = new BillingDashboard({ store, eventBus, logger });
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
  logger.info('main', 'Enterprise billing initialized');

  // ── Phase 8: Extensions & Marketplace Initializations ──────────────────────
  const aiExtensionLayer = new AIExtensionLayer({ logger });
  logger.info('main', 'AI Extension Layer initialized');

  const extensionGovernance = new ExtensionGovernance({ logger, securityScanner });
  logger.info('main', 'Extension Governance initialized');

  const extensionRegistry = new ExtensionRegistry({ logger, eventBus, store });
  logger.info('main', 'Extension Registry initialized');

  const marketplaceCatalog = new MarketplaceCatalog({ logger, eventBus, extensionGovernance });
  logger.info('main', 'Marketplace Catalog initialized');

  const revenueEngine = new RevenueEngine({ logger, eventBus });
  logger.info('main', 'Revenue Engine initialized');

  const compatibilityMatrix = new CompatibilityMatrix({ nuvraCoreVersion: NUVRA_CURRENT_VERSION, logger });
  logger.info('main', 'Compatibility Matrix initialized');

  const extensionDevTools = new ExtensionDevTools({ registry: extensionRegistry, governance: extensionGovernance, catalog: marketplaceCatalog, logger });
  logger.info('main', 'Extension Dev Tools initialized');

  // ── Step 24: Register all modules ──────────────────────────────────────────
  runtime
    .register(pageManager)
    .register(editorShell)
    .register(secretsManager)
    .register(providerRegistry)
    .register(budgetEngine)
    .register(authManager)
    .register(cloudAdapter)
    .register(ownershipManager)
    .register(cloudStorage)
    .register(syncEngine)
    .register(reconciliationEngine)
    .register(aiSafetyBoundary)
    .register(aiGovernanceLayer)
    .register(usageLedger)
    .register(entitlementManager)
    .register(limitEnforcementEngine)
    .register(aiCostGovernance)
    .register(billingProviders)
    .register(abuseDetector)
    .register(billingDashboard)
    .register(upgradeEngine)
    .register(enterpriseBilling)
    .register(aiExtensionLayer)
    .register(extensionGovernance)
    .register(extensionRegistry)
    .register(marketplaceCatalog)
    .register(revenueEngine)
    .register(compatibilityMatrix)
    .register(extensionDevTools);

  // ── Step 25: Start all modules ─────────────────────────────────────────────
  await runtime.startAllModules();

  // ── Step 26: Wire persistence auto-save ────────────────────────────────────
  storageEngine.wireAutoSave(store);

  // ── Step 27: Wire save-requested event ─────────────────────────────────────
  eventBus.on('app:save-requested', () => storageEngine.save(store.getState()));

  // ── Step 28: Wire online/offline detection ─────────────────────────────────
  window.addEventListener('online',  () => store.dispatch({ type: 'FLAGS/SET_ONLINE', payload: true }));
  window.addEventListener('offline', () => store.dispatch({ type: 'FLAGS/SET_ONLINE', payload: false }));

  // ── Step 29: Wire App Runtime activation ───────────────────────────────────
  const appRuntime = new AppRuntime({ store, eventBus, logger });
  eventBus.on('app:activate-runtime', ({ appId, mode }) => appRuntime.activate(appId, mode));
  eventBus.on('app:deactivate-runtime', () => appRuntime.deactivate());

  // ── Step 30: Wire Preview Mode activation/exit ─────────────────────────────
  previewMode.wireEvents(eventBus, store);

  // ── Step 31: Wire Publish Pipeline events ──────────────────────────────────
  publishPipeline.wireEvents(eventBus, store, outputTargets);

  // ── Step 32: Wire AI Generation events (with safety + governance + billing) ──
  aiGenerationEngine.wireEvents(eventBus, store, budgetEngine, aiSafetyBoundary, aiGovernanceLayer, usageLedger);

  // ── Step 33: Wire Auth events ──────────────────────────────────────────────
  authManager.wireEvents();

  // ── Step 34: Wire Cloud Sync events ────────────────────────────────────────
  syncEngine.wireEvents(eventBus, store);

  // ── Step 35: Wire Governance events ────────────────────────────────────────
  aiGovernanceLayer.wireEvents(eventBus, store);

  // ── Step 36: Wire Billing events ───────────────────────────────────────────
  usageLedger.wireEvents(eventBus, store);
  entitlementManager.wireEvents(eventBus, store);
  limitEnforcementEngine.wireEvents(eventBus, store);
  aiCostGovernance.wireEvents(eventBus, store);
  billingProviders.wireEvents(eventBus, store);
  abuseDetector.wireEvents(eventBus, store);
  billingDashboard.wireEvents(eventBus, store);
  upgradeEngine.wireEvents(eventBus, store);
  enterpriseBilling.wireEvents(eventBus, store);

  // ── Phase 8: Wire Extension & Marketplace events ───────────────────────────
  aiExtensionLayer.wireEvents(eventBus, store);
  extensionGovernance.wireEvents(eventBus, store);
  extensionRegistry.wireEvents(eventBus, store);
  marketplaceCatalog.wireEvents(eventBus, store);
  revenueEngine.wireEvents(eventBus, store);
  compatibilityMatrix.wireEvents(eventBus, store);
  extensionDevTools.wireEvents(eventBus, store);

  // ── Step 37: Mark as booted ────────────────────────────────────────────────
  store.dispatch({ type: 'FLAGS/SET_BOOTED' });
  logger.info('main', 'Nuvra booted successfully!');

  // ── Helper to get environment variables ────────────────────────────────────
  function _getEnvVar(name) {
    // In a browser environment, process.env is not available. Use a global or window object if defined.
    // For local development, we might inject these via a build step or a separate config file.
    if (typeof process !== 'undefined' && process.env && process.env[name]) {
      return process.env[name];
    }
    // Fallback for browser-like environments or if process.env is not set up
    return window._nuvraEnv?.[name] || null;
  }
}

// Start the boot process
boot().catch(err => {
  logger.error('main', 'Fatal error during Nuvra boot', err);
  errorBoundary.handleError(err, ErrorSeverity.CRITICAL, 'NuvraBoot');
  toastManager.show('Nuvra failed to start. Please check the console for details.', 'error', 0);
});
