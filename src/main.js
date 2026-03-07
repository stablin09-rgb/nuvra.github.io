/**
 * main.js — Nuvra Phase 10
 *
 * The application boot sequence.
 *
 * Core modules (Phases 1–4) are required and will abort boot on failure.
 * Optional modules (Phases 5–10) are wrapped in try/catch so a single
 * broken module never freezes the loading screen.
 *
 * @module main
 */
'use strict';

// ─── Core (required) ─────────────────────────────────────────────────────────
import { runtime }        from './runtime/coreRuntime.js';
import { eventBus }       from './runtime/eventBus.js';
import { store }          from './state/store.js';
import { storageEngine }  from './persistence/storageEngine.js';
import { pageManager }    from './pages/pageManager.js';
import { editorShell }    from './ui/editorShell.js';
import { logger }         from './diagnostics/logger.js';
import { errorBoundary, ErrorSeverity } from './diagnostics/errorBoundary.js';
import { toastManager }   from './ui/controls/toast.js';
import { previewMode }    from './preview/previewMode.js';
import { publishPipeline } from './publish/publishPipeline.js';
import { outputTargets }  from './output/outputTargets.js';
import { AppRuntime }     from './app/runtime/appRuntime.js';

// ─── Phase 5: AI systems ─────────────────────────────────────────────────────
import { providerRegistry }   from './ai/providers/providerRegistry.js';
import { OpenAIProvider }     from './ai/providers/openAIProvider.js';
import { AnthropicProvider }  from './ai/providers/anthropicProvider.js';
import { budgetEngine, LimitType } from './ai/budget/budgetEngine.js';
import { aiGenerationEngine } from './ai/generation/aiGenerationEngine.js';

// ─── Phase 6: Cloud, Auth, Governance ────────────────────────────────────────
import { SecretsManager }     from './governance/secretsManager.js';
import { AuthManager }        from './auth/authManager.js';
import { LocalAuthProvider }  from './auth/providers/localAuthProvider.js';
import { SupabaseAuthProvider } from './auth/providers/supabaseAuthProvider.js';
import { LocalCloudAdapter }  from './cloud/adapters/localCloudAdapter.js';
import { SupabaseCloudAdapter } from './cloud/adapters/supabaseCloudAdapter.js';
import { OwnershipManager }   from './ownership/ownershipManager.js';
import { CloudStorage }       from './cloud/storage/cloudStorage.js';
import { SyncEngine }         from './cloud/sync/syncEngine.js';
import { ReconciliationEngine } from './cloud/reconciliation/reconciliationEngine.js';
import { AISafetyBoundary }   from './governance/aiSafetyBoundary.js';
import { AIGovernanceLayer }  from './governance/aiGovernanceLayer.js';

// ─── Phase 7: Billing & Usage Governance ─────────────────────────────────────
import { UsageLedger }            from './billing/ledger/usageLedger.js';
import { EntitlementManager }     from './billing/plans/entitlementManager.js';
import { LimitEnforcementEngine } from './billing/limits/limitEnforcementEngine.js';
import { AICostGovernance }       from './billing/limits/aiCostGovernance.js';
import { BillingProviderRegistry } from './billing/providers/billingProviderRegistry.js';
import { LocalBillingProvider }   from './billing/providers/localBillingProvider.js';
import { AbuseDetector }          from './billing/abuse/abuseDetector.js';
import { BillingDashboard }       from './billing/dashboard/billingDashboard.js';
import { UpgradeEngine }          from './billing/upgrade/upgradeEngine.js';
import { EnterpriseBilling }      from './billing/enterprise/enterpriseBilling.js';

// ─── Phase 8: Extensions & Marketplace (class-based) ─────────────────────────
import { ExtensionRegistry }   from './extensions/registry/extensionRegistry.js';
import { MarketplaceCatalog }  from './marketplace/catalog/marketplaceCatalog.js';
import { RevenueEngine }       from './monetization/revenue/revenueEngine.js';
import { ExtensionGovernance } from './governance/extensions/extensionGovernance.js';
import { AIExtensionLayer }    from './ai/extensions/aiExtensionLayer.js';
import { ExtensionDevTools }   from './extensions/devtools/extensionDevTools.js';
import { CompatibilityMatrix } from './extensions/compatibility/compatibilityMatrix.js';

// ─── Phase 9: Mobile Outputs Governance ──────────────────────────────────────
import { MobileRuntimeContract }      from './mobile/governance/mobileRuntimeContract.js';
import { CapabilityDeclarationSystem } from './mobile/governance/capabilityDeclarationSystem.js';
import { MobilePolicyEngine }         from './mobile/governance/mobilePolicyEngine.js';
import { MobileAwarePlanner }         from './ai/planning/mobileAwarePlanner.js';
import { PreviewParityEnforcement }   from './preview/previewParityEnforcement.js';
import { GovernedBuildPipeline }      from './publish/governedBuildPipeline.js';
import { EnterpriseRegulatedProfiles } from './mobile/governance/enterpriseRegulatedProfiles.js';
import { MobileVersioningRollback }   from './mobile/governance/mobileVersioningRollback.js';
import { SecurityThreatModeling }     from './security/securityThreatModeling.js';
// mobileReadinessDashboard is a singleton object, not a class
import { mobileReadinessDashboard }   from './ui/panels/mobileReadinessDashboard.js';
import { CapabilityInspector }        from './ui/panels/capabilityInspector.js';

// ─── Phase 10: Extension Runtime & Marketplace Manager (functional modules) ──
import * as p10ExtensionRegistry from './extensions/extensionRegistry.js';
import * as extensionHost        from './extensions/extensionHost.js';
import * as extensionLoader      from './extensions/extensionLoader.js';
import * as permissionsModule    from './extensions/permissions.js';
import * as editorApiModule      from './extensions/api/editorApi.js';
import * as dataApiModule        from './extensions/api/dataApi.js';
import * as aiApiModule          from './extensions/api/aiApi.js';
import * as marketplaceManager   from './marketplace/marketplaceManager.js';
import * as marketplaceUI        from './marketplace/marketplaceUI.js';

// ─── Helper ───────────────────────────────────────────────────────────────────
function _getEnvVar(name) {
  if (typeof window !== 'undefined' && window.NUVRA_ENV_VARS?.[name]) {
    return window.NUVRA_ENV_VARS[name];
  }
  if (typeof process !== 'undefined' && process.env?.[name]) {
    return process.env[name];
  }
  return undefined;
}

/** Safely call a function; log and swallow errors so boot continues. */
function _try(label, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.catch(err => {
        logger.warn('main', `[optional] ${label} failed (async): ${err?.message || err}`);
        console.warn(`[Nuvra] Optional module "${label}" failed:`, err);
      });
    }
    return result;
  } catch (err) {
    logger.warn('main', `[optional] ${label} failed: ${err?.message || err}`);
    console.warn(`[Nuvra] Optional module "${label}" failed:`, err);
    return null;
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  // ── Step 1: Install global error handlers ──────────────────────────────────
  errorBoundary.installGlobalHandlers();
  logger.info('main', 'Nuvra booting (Phase 10)…');

  // ── Step 2: Initialize the Core Runtime ────────────────────────────────────
  runtime.init();

  // ── Step 3: Hydrate state from persistence ─────────────────────────────────
  try {
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
      logger.info('main', `State restored from storage (v${version})`);
    } else {
      logger.info('main', 'No saved state — starting fresh');
    }
  } catch (err) {
    logger.warn('main', `State hydration failed: ${err.message} — starting fresh`);
  }

  // ── Step 4: Initialize Secrets Manager ─────────────────────────────────────
  let secretsManager = null;
  _try('SecretsManager', () => {
    secretsManager = new SecretsManager({
      eventBus,
      getCurrentUserId: () => store.getState().auth?.userId || null,
    });
    logger.info('main', 'Secrets Manager initialized');
  });

  const envOpenAIKey    = _getEnvVar('NUVRA_OPENAI_KEY')    || _getEnvVar('OPENAI_API_KEY');
  const envAnthropicKey = _getEnvVar('NUVRA_ANTHROPIC_KEY') || _getEnvVar('ANTHROPIC_API_KEY');

  // ── Step 5: Configure AI Provider Registry ─────────────────────────────────
  _try('AI Provider Registry', () => {
    providerRegistry.register(new OpenAIProvider({ apiKey: envOpenAIKey || null }), { setActive: true });
    if (envAnthropicKey) {
      providerRegistry.register(new AnthropicProvider({ apiKey: envAnthropicKey }), { setFallback: true });
    }
    providerRegistry.subscribe((event, data) => {
      if (event === 'provider:fallback_used') {
        toastManager.show('Switched to fallback AI provider', 'warning', 3000);
      }
      if (event === 'provider:blocked') {
        toastManager.show('AI provider blocked: ' + data.reason, 'error', 5000);
      }
    });
    logger.info('main', 'AI Provider Registry configured');
  });

  // ── Step 6: Configure Budget Engine ────────────────────────────────────────
  _try('Budget Engine', () => {
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
        toastManager.show(`Budget warning: ${data.warnings?.[0]}`, 'warning', 4000);
      }
      if (event === 'budget:blocked') {
        toastManager.show('AI call blocked: budget limit exceeded', 'error', 5000);
      }
    });
    logger.info('main', 'Budget engine configured');
  });

  // ── Step 7: Initialize Auth Manager ────────────────────────────────────────
  let authManager = null;
  _try('Auth Manager', () => {
    // Use LocalAuthProvider in the browser (no server-side env vars available at runtime)
    const authProvider = new LocalAuthProvider();
    authManager = new AuthManager({
      provider: authProvider,
      store,
      eventBus,
      tokenManager:   { store: () => {}, retrieve: () => null, clear: () => {} },
      sessionManager: { create: () => {}, restore: () => null, clear: () => {} },
    });
    // Session restore is triggered internally in the constructor via this._restoreSession()
    logger.info('main', 'Auth Manager initialized');
  });

  // ── Step 8–12: Cloud, Ownership, Sync ──────────────────────────────────────
  let cloudAdapter = null, ownershipManager = null, cloudStorage = null;
  let syncEngine = null, reconciliationEngine = null;

  _try('Cloud Adapter', () => {
    cloudAdapter = new LocalCloudAdapter();
    logger.info('main', 'Cloud adapter initialized (local)');
  });
  _try('Ownership Manager', () => {
    ownershipManager = new OwnershipManager({ eventBus, store });
    logger.info('main', 'Ownership Manager initialized');
  });
  _try('Cloud Storage', () => {
    cloudStorage = new CloudStorage({ cloudAdapter, eventBus });
    logger.info('main', 'Cloud Storage initialized');
  });
  _try('Sync Engine', () => {
    syncEngine = new SyncEngine({ cloudAdapter, store, eventBus, ownershipManager });
    logger.info('main', 'Sync Engine initialized');
  });
  _try('Reconciliation Engine', () => {
    reconciliationEngine = new ReconciliationEngine({ cloudAdapter, store, eventBus });
    logger.info('main', 'Reconciliation Engine initialized');
  });

  // ── Step 13–14: AI Safety & Governance ─────────────────────────────────────
  let aiSafetyBoundary = null, aiGovernanceLayer = null;
  _try('AI Safety Boundary', () => {
    aiSafetyBoundary = new AISafetyBoundary({ eventBus, store });
    logger.info('main', 'AI Safety Boundary initialized');
  });
  _try('AI Governance Layer', () => {
    aiGovernanceLayer = new AIGovernanceLayer({ eventBus, store });
    logger.info('main', 'AI Governance Layer initialized');
  });

  // ── Step 15–23: Billing & Usage Governance ─────────────────────────────────
  let usageLedger = null, entitlementManager = null, limitEnforcementEngine = null;
  let aiCostGovernance = null, billingProviderRegistry = null, abuseDetector = null;
  let billingDashboard = null, upgradeEngine = null, enterpriseBilling = null;

  _try('Usage Ledger', () => {
    usageLedger = new UsageLedger({ eventBus, store });
  });
  _try('Entitlement Manager', () => {
    entitlementManager = new EntitlementManager({ eventBus, store });
  });
  _try('Limit Enforcement Engine', () => {
    limitEnforcementEngine = new LimitEnforcementEngine({ eventBus, store });
  });
  _try('AI Cost Governance', () => {
    aiCostGovernance = new AICostGovernance({ eventBus, store });
  });
  _try('Billing Provider Registry', () => {
    billingProviderRegistry = new BillingProviderRegistry({ eventBus });
    billingProviderRegistry.register(new LocalBillingProvider());
  });
  _try('Abuse Detector', () => {
    abuseDetector = new AbuseDetector({ eventBus, store });
  });
  _try('Billing Dashboard', () => {
    billingDashboard = new BillingDashboard({ eventBus, store });
  });
  _try('Upgrade Engine', () => {
    upgradeEngine = new UpgradeEngine({ eventBus, store });
  });
  _try('Enterprise Billing', () => {
    enterpriseBilling = new EnterpriseBilling({ eventBus, store });
  });

  logger.info('main', 'Phase 7 billing modules initialized');

  // ── Step 24: Register core modules ─────────────────────────────────────────
  const coreModules = {
    secretsManager, authManager, cloudAdapter, ownershipManager,
    cloudStorage, syncEngine, reconciliationEngine, aiSafetyBoundary,
    aiGovernanceLayer, usageLedger, entitlementManager, limitEnforcementEngine,
    aiCostGovernance, billingProviderRegistry, abuseDetector, billingDashboard,
    upgradeEngine, enterpriseBilling,
  };
  for (const [name, mod] of Object.entries(coreModules)) {
    if (mod) runtime.registerModule(name, mod);
  }

  // ── Phase 8: Extensions & Marketplace ──────────────────────────────────────
  let extensionRegistry = null, marketplaceCatalog = null, revenueEngine = null;
  let extensionGovernance = null, aiExtensionLayer = null;
  let extensionDevTools = null, compatibilityMatrix = null;

  _try('ExtensionRegistry (P8)', () => {
    extensionRegistry = new ExtensionRegistry({ eventBus, store });
    runtime.registerModule('extensionRegistry', extensionRegistry);
  });
  _try('MarketplaceCatalog (P8)', () => {
    marketplaceCatalog = new MarketplaceCatalog({ eventBus, store });
    runtime.registerModule('marketplaceCatalog', marketplaceCatalog);
  });
  _try('RevenueEngine (P8)', () => {
    revenueEngine = new RevenueEngine({ eventBus, store });
    runtime.registerModule('revenueEngine', revenueEngine);
  });
  _try('ExtensionGovernance (P8)', () => {
    extensionGovernance = new ExtensionGovernance({ eventBus, store });
    runtime.registerModule('extensionGovernance', extensionGovernance);
  });
  _try('AIExtensionLayer (P8)', () => {
    aiExtensionLayer = new AIExtensionLayer({ eventBus, store });
    runtime.registerModule('aiExtensionLayer', aiExtensionLayer);
  });
  _try('ExtensionDevTools (P8)', () => {
    extensionDevTools = new ExtensionDevTools({ eventBus, store });
    runtime.registerModule('extensionDevTools', extensionDevTools);
  });
  _try('CompatibilityMatrix (P8)', () => {
    compatibilityMatrix = new CompatibilityMatrix({ eventBus, store });
    runtime.registerModule('compatibilityMatrix', compatibilityMatrix);
  });

  logger.info('main', 'Phase 8 modules registered');

  // ── Phase 9: Mobile Outputs Governance ─────────────────────────────────────
  let mobileRuntimeContract = null, capabilityDeclarationSystem = null;
  let mobilePolicyEngine = null, mobileAwarePlanner = null;
  let previewParityEnforcement = null, governedBuildPipeline = null;
  let enterpriseRegulatedProfiles = null, mobileVersioningRollback = null;
  let securityThreatModeling = null, capabilityInspector = null;

  _try('MobileRuntimeContract (P9)', () => {
    mobileRuntimeContract = new MobileRuntimeContract({ eventBus, store });
    runtime.registerModule('mobileRuntimeContract', mobileRuntimeContract);
  });
  _try('CapabilityDeclarationSystem (P9)', () => {
    capabilityDeclarationSystem = new CapabilityDeclarationSystem({ eventBus, store });
    runtime.registerModule('capabilityDeclarationSystem', capabilityDeclarationSystem);
  });
  _try('MobilePolicyEngine (P9)', () => {
    mobilePolicyEngine = new MobilePolicyEngine({ eventBus, store });
    runtime.registerModule('mobilePolicyEngine', mobilePolicyEngine);
  });
  _try('MobileAwarePlanner (P9)', () => {
    mobileAwarePlanner = new MobileAwarePlanner({ eventBus, store });
    runtime.registerModule('mobileAwarePlanner', mobileAwarePlanner);
  });
  _try('PreviewParityEnforcement (P9)', () => {
    previewParityEnforcement = new PreviewParityEnforcement({ eventBus, store });
    runtime.registerModule('previewParityEnforcement', previewParityEnforcement);
  });
  _try('GovernedBuildPipeline (P9)', () => {
    governedBuildPipeline = new GovernedBuildPipeline({ eventBus, store });
    runtime.registerModule('governedBuildPipeline', governedBuildPipeline);
  });
  _try('EnterpriseRegulatedProfiles (P9)', () => {
    enterpriseRegulatedProfiles = new EnterpriseRegulatedProfiles({ eventBus, store });
    runtime.registerModule('enterpriseRegulatedProfiles', enterpriseRegulatedProfiles);
  });
  _try('MobileVersioningRollback (P9)', () => {
    mobileVersioningRollback = new MobileVersioningRollback({ eventBus, store });
    runtime.registerModule('mobileVersioningRollback', mobileVersioningRollback);
  });
  _try('SecurityThreatModeling (P9)', () => {
    securityThreatModeling = new SecurityThreatModeling({ eventBus, store });
    runtime.registerModule('securityThreatModeling', securityThreatModeling);
  });
  _try('MobileReadinessDashboard (P9)', () => {
    // mobileReadinessDashboard is a singleton object (not a class)
    runtime.registerModule('mobileReadinessDashboard', mobileReadinessDashboard);
  });
  _try('CapabilityInspector (P9)', () => {
    capabilityInspector = new CapabilityInspector({ eventBus, store });
    runtime.registerModule('capabilityInspector', capabilityInspector);
  });

  logger.info('main', 'Phase 9 modules registered');

  // ── Phase 10: Extension Runtime & Marketplace Manager ──────────────────────
  _try('P10 ExtensionHost init', () => {
    if (typeof extensionHost.init === 'function') {
      extensionHost.init(null, null);
    }
  });
  _try('P10 MarketplaceUI init', () => {
    if (typeof marketplaceUI.init === 'function') {
      marketplaceUI.init();
    }
  });

  logger.info('main', 'Phase 10 modules registered');

  // ── Step 25: Start all modules ─────────────────────────────────────────────
  _try('runtime.start', () => runtime.start());

  // ── Step 26: Wire persistence auto-save ────────────────────────────────────
  store.subscribe(() => {
    try { storageEngine.save(store.getState()); } catch (_) {}
  });
  eventBus.on('app:save-requested', () => {
    try { storageEngine.save(store.getState()); } catch (_) {}
  });

  // ── Step 28: Wire online/offline detection ─────────────────────────────────
  window.addEventListener('online',  () => store.dispatch({ type: 'FLAGS/SET_ONLINE', payload: true }));
  window.addEventListener('offline', () => store.dispatch({ type: 'FLAGS/SET_ONLINE', payload: false }));

  // ── Step 29: Wire App Runtime activation ───────────────────────────────────
  _try('AppRuntime wire', () => {
    const appRuntime = new AppRuntime({ store, eventBus, logger });
    eventBus.on('app:activate-runtime',   ({ appId, mode }) => appRuntime.activate(appId, mode));
    eventBus.on('app:deactivate-runtime', () => appRuntime.deactivate());
  });

  // ── Step 30: Wire Preview Mode ─────────────────────────────────────────────
  _try('previewMode.wireEvents', () => previewMode.wireEvents(eventBus, store));

  // ── Step 31: Wire Publish Pipeline ─────────────────────────────────────────
  _try('publishPipeline.wireEvents', () => publishPipeline.wireEvents(eventBus, store, outputTargets));

  // ── Step 32: Wire AI Generation events ─────────────────────────────────────
  _try('aiGenerationEngine.wireEvents', () => {
    aiGenerationEngine.wireEvents(eventBus, store, budgetEngine, aiSafetyBoundary, aiGovernanceLayer, usageLedger);
  });

  eventBus.on('ai:generate_requested', async ({ prompt, context, options }) => {
    store.dispatch({ type: 'AI/SET_PLANNING', payload: true });
    store.dispatch({ type: 'AI/CLEAR_INTENT' });
    try {
      const targetPlatform = store.getState().editor?.deviceMode === 'mobile' ? 'ios' : 'web';
      const result = await aiGenerationEngine.generate({
        prompt,
        context,
        options: { ...options, targetPlatform },
      });
      if (result.ok) {
        const page = pageManager.addPage({ name: result.intent?.appName || 'New App', content: result.schema });
        pageManager.setActivePage(page.id);
        if (targetPlatform !== 'web' && mobilePolicyEngine) {
          const evaluation = mobilePolicyEngine.evaluateApp(result.schema, targetPlatform);
          if (!evaluation.isValid) {
            toastManager.show(`App generated with ${evaluation.errors.length} policy violations.`, 'warning', 6000);
          }
        }
      } else {
        toastManager.show(`AI Generation failed: ${result.error}`, 'error', 5000);
      }
    } catch (err) {
      errorBoundary.capture(err, { module: 'main', context: 'ai:generate_requested' });
      toastManager.show(`AI Generation error: ${err.message}`, 'error', 5000);
    } finally {
      store.dispatch({ type: 'AI/SET_PLANNING', payload: false });
    }
  });

  // ── Step 33: Wire Auth events ──────────────────────────────────────────────
  _try('authManager.wireEvents', () => authManager?.wireEvents());

  // ── Step 34: Wire Cloud Sync events ────────────────────────────────────────
  _try('syncEngine.wireEvents', () => syncEngine?.wireEvents(eventBus, store));

  // ── Step 35: Wire Governance events ────────────────────────────────────────
  _try('aiGovernanceLayer.wireEvents', () => aiGovernanceLayer?.wireEvents());
  _try('extensionGovernance.wireEvents', () => extensionGovernance?.wireEvents());

  // ── Step 36: Wire Billing events ───────────────────────────────────────────
  _try('billingProviderRegistry.wireEvents', () => billingProviderRegistry?.wireEvents());
  _try('abuseDetector.wireEvents', () => abuseDetector?.wireEvents());
  _try('billingDashboard.wireEvents', () => billingDashboard?.wireEvents());
  _try('upgradeEngine.wireEvents', () => upgradeEngine?.wireEvents());
  _try('enterpriseBilling.wireEvents', () => enterpriseBilling?.wireEvents());

  // ── Step 37: Start the Editor Shell (renders the UI, clears loading screen) ─
  const appEl = document.getElementById('nv-app');
  if (appEl) {
    editorShell.start(appEl);
    logger.info('main', 'Editor shell started');
  } else {
    logger.error('main', 'Could not find #nv-app element — editor shell not started');
  }

  // ── Step 38: Mark as booted ────────────────────────────────────────────────
  store.dispatch({ type: 'APP/SET_BOOTED', payload: true });
  logger.info('main', 'Nuvra booted (Phase 10).');

  // ── Debug handles ──────────────────────────────────────────────────────────
  Object.assign(window, {
    store, eventBus, runtime, pageManager, editorShell,
    aiGenerationEngine, budgetEngine, aiSafetyBoundary, aiGovernanceLayer,
    usageLedger, entitlementManager, limitEnforcementEngine, aiCostGovernance,
    billingProviderRegistry, abuseDetector, billingDashboard, upgradeEngine, enterpriseBilling,
    extensionRegistry, marketplaceCatalog, revenueEngine, extensionGovernance,
    aiExtensionLayer, extensionDevTools, compatibilityMatrix,
    mobileReadinessDashboard, mobilePolicyEngine,
    p10ExtensionRegistry, extensionHost, extensionLoader,
    marketplaceManager, marketplaceUI,
  });
}

// ─── Start Boot Sequence ──────────────────────────────────────────────────────
boot().catch(err => {
  console.error('Failed to boot Nuvra:', err);
  const appEl = document.getElementById('nv-app');
  if (appEl) {
    appEl.innerHTML = `
      <div style="padding:40px;font-family:system-ui,sans-serif;color:#f44336;background:#0d1117;min-height:100vh;">
        <h1 style="color:#f44336;">⚠ Nuvra Boot Error</h1>
        <p style="color:#aaa;">The application failed to start. Please check the browser console for details.</p>
        <pre style="background:#161b22;padding:16px;border-radius:8px;color:#ff7b72;overflow:auto;">${err?.message || err}</pre>
        <p style="color:#aaa;margin-top:16px;">Stack trace:</p>
        <pre style="background:#161b22;padding:16px;border-radius:8px;color:#8b949e;overflow:auto;font-size:12px;">${err?.stack || 'No stack trace available'}</pre>
      </div>
    `;
  }
});
