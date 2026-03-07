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

// Phase 9: Mobile Outputs Governance & Runtime Parity
import { MobileRuntimeContract } from './mobile/governance/mobileRuntimeContract.js';
import { CapabilityDeclarationSystem } from './mobile/governance/capabilityDeclarationSystem.js';
import { MobilePolicyEngine } from './mobile/governance/mobilePolicyEngine.js';
import { MobileAwarePlanner } from './ai/planning/mobileAwarePlanner.js';
import { PreviewParityEnforcement } from './preview/previewParityEnforcement.js';
import { GovernedBuildPipeline } from './publish/governedBuildPipeline.js';
import { EnterpriseRegulatedProfiles } from './mobile/governance/enterpriseRegulatedProfiles.js';
import { MobileVersioningRollback } from './mobile/governance/mobileVersioningRollback.js';
import { SecurityThreatModeling } from './security/securityThreatModeling.js';
import { MobileReadinessDashboard } from './ui/panels/mobileReadinessDashboard.js';
import { CapabilityInspector } from './ui/panels/capabilityInspector.js';

// Phase 8: Extensions & Marketplace
import { ExtensionRegistry }   from './extensions/registry/extensionRegistry.js';
import { MarketplaceCatalog }  from './marketplace/catalog/marketplaceCatalog.js';
import { RevenueEngine }       from './monetization/revenue/revenueEngine.js';
import { ExtensionGovernance } from './governance/extensions/extensionGovernance.js';
import { AIExtensionLayer }    from './ai/extensions/aiExtensionLayer.js';
import { ExtensionDevTools }   from './extensions/devtools/extensionDevTools.js';
import { CompatibilityMatrix } from './extensions/compatibility/compatibilityMatrix.js';

// Phase 10: Extension Runtime & Marketplace Manager
import { extensionRegistry as p10ExtensionRegistry } from './extensions/extensionRegistry.js';
import { extensionHost }     from './extensions/extensionHost.js';
import { extensionLoader }   from './extensions/extensionLoader.js';
import { sandboxManager }    from './extensions/sandbox.js';
import { permissionsManager } from './extensions/permissions.js';
import { editorApi }         from './extensions/api/editorApi.js';
import { dataApi }           from './extensions/api/dataApi.js';
import { aiApi }             from './extensions/api/aiApi.js';
import { marketplaceManager } from './marketplace/marketplaceManager.js';
import { marketplaceUI }     from './marketplace/marketplaceUI.js';
import { aiEngine as p10AiEngine } from './ai/aiEngine.js';

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
  const ownershipManager = new OwnershipManager({ eventBus, store });
  logger.info('main', 'Ownership manager initialized');

  // ── Step 10: Initialize Cloud Storage ──────────────────────────────────────
  const cloudStorage = new CloudStorage({ cloudAdapter, eventBus });
  logger.info('main', 'Cloud storage initialized');

  // ── Step 11: Initialize Sync Engine ────────────────────────────────────────
  const syncEngine = new SyncEngine({ cloudAdapter, store, eventBus, ownershipManager });
  logger.info('main', 'Sync engine initialized');

  // ── Step 12: Initialize Reconciliation Engine ──────────────────────────────
  const reconciliationEngine = new ReconciliationEngine({ cloudAdapter, store, eventBus });
  logger.info('main', 'Reconciliation engine initialized');

  // ── Step 13: Initialize AI Safety Boundary ─────────────────────────────────
  const aiSafetyBoundary = new AISafetyBoundary({ eventBus, store });
  logger.info('main', 'AI Safety Boundary initialized');

  // ── Step 14: Initialize AI Governance Layer ────────────────────────────────
  const aiGovernanceLayer = new AIGovernanceLayer({ eventBus, store });
  logger.info('main', 'AI Governance Layer initialized');

  // ── Step 15: Initialize Usage Ledger ───────────────────────────────────────
  const usageLedger = new UsageLedger({ eventBus, store });
  logger.info('main', 'Usage Ledger initialized');

  // ── Step 16: Initialize Entitlement Manager ────────────────────────────────
  const entitlementManager = new EntitlementManager({ eventBus, store });
  logger.info('main', 'Entitlement Manager initialized');

  // ── Step 17: Initialize Limit Enforcement Engine ───────────────────────────
  const limitEnforcementEngine = new LimitEnforcementEngine({ eventBus, store });
  logger.info('main', 'Limit Enforcement Engine initialized');

  // ── Step 18: Initialize AI Cost Governance ─────────────────────────────────
  const aiCostGovernance = new AICostGovernance({ eventBus, store });
  logger.info('main', 'AI Cost Governance initialized');

  // ── Step 19: Initialize Billing Provider Registry ──────────────────────────
  const billingProviderRegistry = new BillingProviderRegistry({ eventBus });
  billingProviderRegistry.register(new LocalBillingProvider());
  logger.info('main', 'Billing Provider Registry initialized');

  // ── Step 20: Initialize Abuse Detector ─────────────────────────────────────
  const abuseDetector = new AbuseDetector({ eventBus, store });
  logger.info('main', 'Abuse Detector initialized');

  // ── Step 21: Initialize Billing Dashboard ──────────────────────────────────
  const billingDashboard = new BillingDashboard({ eventBus, store });
  logger.info('main', 'Billing Dashboard initialized');

  // ── Step 22: Initialize Upgrade Engine ─────────────────────────────────────
  const upgradeEngine = new UpgradeEngine({ eventBus, store });
  logger.info('main', 'Upgrade Engine initialized');

  // ── Step 23: Initialize Enterprise Billing ─────────────────────────────────
  const enterpriseBilling = new EnterpriseBilling({ eventBus, store });
  logger.info('main', 'Enterprise Billing initialized');

  // ── Step 24: Register all modules ──────────────────────────────────────────
  runtime.registerModule('secretsManager', secretsManager);
  runtime.registerModule('authManager', authManager);
  runtime.registerModule('cloudAdapter', cloudAdapter);
  runtime.registerModule('ownershipManager', ownershipManager);
  runtime.registerModule('cloudStorage', cloudStorage);
  runtime.registerModule('syncEngine', syncEngine);
  runtime.registerModule('reconciliationEngine', reconciliationEngine);
  runtime.registerModule('aiSafetyBoundary', aiSafetyBoundary);
  runtime.registerModule('aiGovernanceLayer', aiGovernanceLayer);
  runtime.registerModule('usageLedger', usageLedger);
  runtime.registerModule('entitlementManager', entitlementManager);
  runtime.registerModule('limitEnforcementEngine', limitEnforcementEngine);
  runtime.registerModule('aiCostGovernance', aiCostGovernance);
  runtime.registerModule('billingProviderRegistry', billingProviderRegistry);
  runtime.registerModule('abuseDetector', abuseDetector);
  runtime.registerModule('billingDashboard', billingDashboard);
  runtime.registerModule('upgradeEngine', upgradeEngine);
  runtime.registerModule('enterpriseBilling', enterpriseBilling);

  // Phase 8 Modules
  const extensionRegistry = new ExtensionRegistry({ eventBus, store });
  const marketplaceCatalog = new MarketplaceCatalog({ eventBus, store });
  const revenueEngine = new RevenueEngine({ eventBus, store });
  const extensionGovernance = new ExtensionGovernance({ eventBus, store });
  const aiExtensionLayer = new AIExtensionLayer({ eventBus, store });
  const extensionDevTools = new ExtensionDevTools({ eventBus, store });
  const compatibilityMatrix = new CompatibilityMatrix({ eventBus, store });

  runtime.registerModule("extensionRegistry", extensionRegistry);
  runtime.registerModule("marketplaceCatalog", marketplaceCatalog);
  runtime.registerModule("revenueEngine", revenueEngine);
  runtime.registerModule("extensionGovernance", extensionGovernance);
  runtime.registerModule("aiExtensionLayer", aiExtensionLayer);
  runtime.registerModule("extensionDevTools", extensionDevTools);
  runtime.registerModule("compatibilityMatrix", compatibilityMatrix);

  logger.info("main", "Phase 8 modules registered");

  // Phase 9 Modules
  const mobileRuntimeContract = new MobileRuntimeContract({ eventBus, store });
  const capabilityDeclarationSystem = new CapabilityDeclarationSystem({ eventBus, store });
  const mobilePolicyEngine = new MobilePolicyEngine({ eventBus, store });
  const mobileAwarePlanner = new MobileAwarePlanner({ eventBus, store });
  const previewParityEnforcement = new PreviewParityEnforcement({ eventBus, store });
  const governedBuildPipeline = new GovernedBuildPipeline({ eventBus, store });
  const enterpriseRegulatedProfiles = new EnterpriseRegulatedProfiles({ eventBus, store });
  const mobileVersioningRollback = new MobileVersioningRollback({ eventBus, store });
  const securityThreatModeling = new SecurityThreatModeling({ eventBus, store });
  const mobileReadinessDashboard = new MobileReadinessDashboard({ eventBus, store });
  const capabilityInspector = new CapabilityInspector({ eventBus, store });

  runtime.registerModule("mobileRuntimeContract", mobileRuntimeContract);
  runtime.registerModule("capabilityDeclarationSystem", capabilityDeclarationSystem);
  runtime.registerModule("mobilePolicyEngine", mobilePolicyEngine);
  runtime.registerModule("mobileAwarePlanner", mobileAwarePlanner);
  runtime.registerModule("previewParityEnforcement", previewParityEnforcement);
  runtime.registerModule("governedBuildPipeline", governedBuildPipeline);
  runtime.registerModule("enterpriseRegulatedProfiles", enterpriseRegulatedProfiles);
  runtime.registerModule("mobileVersioningRollback", mobileVersioningRollback);
  runtime.registerModule("securityThreatModeling", securityThreatModeling);
  runtime.registerModule("mobileReadinessDashboard", mobileReadinessDashboard);
  runtime.registerModule("capabilityInspector", capabilityInspector);

  logger.info("main", "Phase 9 modules registered");

  // Phase 10 Modules: Extension Runtime & Marketplace
  p10ExtensionRegistry.init({ eventBus, store });
  extensionHost.init({ eventBus, store, sandboxManager, permissionsManager });
  extensionLoader.init({ eventBus, store, extensionHost: p10ExtensionRegistry });
  sandboxManager.init({ eventBus, store });
  permissionsManager.init({ eventBus, store });
  editorApi.init({ eventBus, store, pageManager });
  dataApi.init({ eventBus, store });
  aiApi.init({ eventBus, store });
  marketplaceManager.init({ eventBus, store, extensionLoader });
  marketplaceUI.init({ eventBus, store, marketplaceManager });
  if (p10AiEngine && typeof p10AiEngine.init === 'function') {
    p10AiEngine.init({ eventBus, store, providerRegistry, budgetEngine });
  }

  logger.info("main", "Phase 10 modules registered");

  // ── Step 25: Start all modules ─────────────────────────────────────────────
  runtime.start();

  // ── Step 26: Wire persistence auto-save ────────────────────────────────────
  store.subscribe(() => storageEngine.save(store.getState()));

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
  eventBus.on("ai:generate_requested", async ({ prompt, context, options }) => {
    store.dispatch({ type: "AI/SET_PLANNING", payload: true });
    store.dispatch({ type: "AI/CLEAR_INTENT" });
    try {
      // Phase 9: Mobile-aware planning
      const targetPlatform = store.getState().editor?.deviceMode === 'mobile' ? 'ios' : 'web';
      const result = await aiGenerationEngine.generate({ 
        prompt, 
        context, 
        options: { ...options, targetPlatform } 
      });

      if (result.ok) {
        const page = pageManager.addPage({ 
          name: result.intent.appName || "New App", 
          content: result.schema 
        });
        pageManager.setActivePage(page.id);
        
        // Phase 9: Evaluate mobile readiness if applicable
        if (targetPlatform !== 'web') {
          const evaluation = mobilePolicyEngine.evaluateApp(result.schema, targetPlatform);
          if (!evaluation.isValid) {
            toastManager.show(`App generated with ${evaluation.errors.length} policy violations. Check Mobile Dashboard.`, "warning", 6000);
          }
        }
      } else {
        toastManager.show(`AI Generation failed: ${result.error}`, "error", 5000);
      }
    } catch (err) {
      errorBoundary.capture(err, { module: "main", context: "ai:generate_requested" });
      toastManager.show(`AI Generation error: ${err.message}`, "error", 5000);
    } finally {
      store.dispatch({ type: "AI/SET_PLANNING", payload: false });
    }
  });

  // ── Step 33: Wire Auth events ──────────────────────────────────────────────
  authManager.wireEvents();

  // ── Step 34: Wire Cloud Sync events ────────────────────────────────────────
  syncEngine.wireEvents(eventBus, store);

  // ── Step 35: Wire Governance events ────────────────────────────────────────
  aiGovernanceLayer.wireEvents();
  extensionGovernance.wireEvents();

  // ── Step 36: Wire Billing events ───────────────────────────────────────────
  billingProviderRegistry.wireEvents();
  abuseDetector.wireEvents();
  billingDashboard.wireEvents();
  upgradeEngine.wireEvents();
  enterpriseBilling.wireEvents();

  // ── Step 37: Mark as booted ────────────────────────────────────────────────
  store.dispatch({ type: 'APP/SET_BOOTED', payload: true });

  logger.info('main', 'Nuvra booted.');

  // ── Debugging ──────────────────────────────────────────────────────────────
  window.store = store;
  window.eventBus = eventBus;
  window.runtime = runtime;
  window.pageManager = pageManager;
  window.aiGenerationEngine = aiGenerationEngine;
  window.budgetEngine = budgetEngine;
  window.aiSafetyBoundary = aiSafetyBoundary;
  window.aiGovernanceLayer = aiGovernanceLayer;
  window.usageLedger = usageLedger;
  window.entitlementManager = entitlementManager;
  window.limitEnforcementEngine = limitEnforcementEngine;
  window.aiCostGovernance = aiCostGovernance;
  window.billingProviderRegistry = billingProviderRegistry;
  window.abuseDetector = abuseDetector;
  window.billingDashboard = billingDashboard;
  window.upgradeEngine = upgradeEngine;
  window.enterpriseBilling = enterpriseBilling;
  window.extensionRegistry = extensionRegistry;
  window.marketplaceCatalog = marketplaceCatalog;
  window.revenueEngine = revenueEngine;
  window.extensionGovernance = extensionGovernance;
  window.aiExtensionLayer = aiExtensionLayer;
  window.extensionDevTools = extensionDevTools;
  window.compatibilityMatrix = compatibilityMatrix;
  // Phase 10 debug handles
  window.p10ExtensionRegistry = p10ExtensionRegistry;
  window.extensionHost = extensionHost;
  window.extensionLoader = extensionLoader;
  window.sandboxManager = sandboxManager;
  window.permissionsManager = permissionsManager;
  window.marketplaceManager = marketplaceManager;
  window.marketplaceUI = marketplaceUI;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _getEnvVar(name) {
  // In a browser environment, process.env is not available.
  // We'll assume environment variables are inlined during build or served via a global config.
  // For local development, you might manually set window.NUVRA_ENV_VARS = { ... }
  if (typeof window !== 'undefined' && window.NUVRA_ENV_VARS && window.NUVRA_ENV_VARS[name]) {
    return window.NUVRA_ENV_VARS[name];
  }
  // Fallback for Node.js environments (e.g., build scripts)
  if (typeof process !== 'undefined' && process.env && process.env[name]) {
    return process.env[name];
  }
  return undefined;
}

// ─── Start Boot Sequence ──────────────────────────────────────────────────────
boot().catch(err => {
  console.error('Failed to boot Nuvra:', err);
  document.body.innerHTML = `
    <div style="padding: 20px; font-family: sans-serif; color: #f44336;">
      <h1>Nuvra Boot Error</h1>
      <p>An unexpected error occurred during startup. Please check the console for details.</p>
      <pre>${err.message}</pre>
    </div>
  `;
});
