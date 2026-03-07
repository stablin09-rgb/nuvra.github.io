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

// ─── Phase 11: Cloud Marketplace & Blueprint Economy ─────────────────────────
import { marketplaceService }  from './cloud/marketplaceService.js';
import { assetRegistry }       from './cloud/assetRegistry.js';
import { licenseEngine }       from './cloud/licenseEngine.js';
import { revenueEngine as revenueEngine11 } from './cloud/revenueEngine.js';
import { analyticsService }    from './cloud/analyticsService.js';
import { versionResolver }     from './cloud/versionResolver.js';
import { creatorService }      from './cloud/creatorService.js';
import { trustEngine }         from './governance/trust/trustEngine.js';
import { blueprintRegistry }   from './blueprints/blueprintRegistry.js';
import { blueprintInstaller }  from './blueprints/blueprintInstaller.js';
import { marketplaceAdvisor }  from './ai/marketplaceAdvisor.js';
import { marketplaceStore }    from './ui/marketplaceStore.js';

// ─── Phase 12: Enterprise Admin Console ──────────────────────────────────────
import { auditService }        from './org/auditService.js';
import { orgService }          from './org/orgService.js';
import { policyEngine }        from './org/policyEngine.js';
import * as identityService    from './org/identityService.js';
import * as deploymentManager  from './cloud/deploymentManager.js';
import * as whiteLabelService  from './cloud/whiteLabelService.js';
import * as aiGovernance       from './ai/aiGovernance.js';
import * as adminConsole       from './ui/adminConsole.js';

// ─── Phase 13: Hosting Packs & Deploy Panel ────────────────────────────────
import { packSDK }              from './design-packs/packSDK.js';
import { packRuntime }          from './design-packs/packRuntime.js';
import { packManager }          from './design-packs/packManager.js';
import { hostingManager, DEPLOY_STATUS } from './hosting/hostingManager.js';
import { deployPipeline }       from './hosting/deployPipeline.js';
import { deployHistory }        from './hosting/deployHistory.js';
import { domainManager }        from './hosting/domainManager.js';
import { observabilityService } from './hosting/observabilityService.js';
import { aiExtensions }         from './ai/aiExtensions.js';
import { deployPanel }          from './ui/deployPanel.js';

// ─── Phase 14: Autonomous Agent System ───────────────────────────────────────
import { agentRuntime }     from './agents/agentRuntime.js';
import { agentPermissions } from './agents/agentPermissions.js';
import { agentMemory, MEMORY_CATEGORY } from './agents/agentMemory.js';
import { goalInterpreter }  from './agents/goalInterpreter.js';
import { planExecutor, EXECUTION_STATUS } from './agents/planExecutor.js';
import { agentManager }     from './agents/agentManager.js';
import { agentConsole }     from './ui/agentConsole.js';

// ─── Phase 15: Institutional Trust & Compliance ───────────────────────────────
import { policyRegistry, SEVERITY as COMPLIANCE_SEVERITY, DATA_CLASS } from './compliance/policyRegistry.js';
import { complianceEngine }   from './compliance/complianceEngine.js';
import { dataClassifier }     from './compliance/dataClassifier.js';
import { jurisdictionRules, REGION_JURISDICTIONS } from './compliance/jurisdictionRules.js';
import { auditLogger, AUDIT_CATEGORIES } from './compliance/auditLogger.js';
import { permissionModel, ACTIONS as PERMISSION_ACTIONS } from './security/permissionModel.js';
import { pluginSandbox, CAPABILITIES } from './security/pluginSandbox.js';
import { supplyChainSecurity } from './security/supplyChainSecurity.js';
import { threatModeler }       from './security/threatModeler.js';
import { complianceConsole }   from './ui/complianceConsole.js';

// ─── Phase 16: Nuvra Runtime Kernel (NRK) ─────────────────────────────────────
import { ExecutionContext, ACTOR, INTENT, ENVIRONMENT, RISK_LEVEL } from './runtime/kernel/executionContext.js';
import { IsolationManager, ISOLATION_MODE } from './runtime/kernel/isolationManager.js';
import * as kernelModule from './runtime/kernel/kernel.js';
import { DECISION as GATEKEEPER_DECISION, init as aiGatekeeperInit, evaluate as aiGatekeeperEvaluate } from './runtime/kernel/aiGatekeeper.js';
import { AuditReplayer } from './runtime/kernel/auditReplayer.js';
import { certReadiness, READINESS_LEVEL } from './runtime/kernel/certReadiness.js';
import { init as evidenceVaultInit, record as evidenceRecord, query as evidenceQuery } from './runtime/kernel/evidenceVault.js';
import { init as explainabilityInit } from './runtime/kernel/explainabilityLedger.js';
import { SimulationEngine, SCENARIO_STATUS } from './runtime/kernel/simulationEngine.js';
import { soc2Mapper, SOC2_CRITERIA } from './runtime/kernel/soc2Mapper.js';
import { init as trustGraphInit, computeTrust, getTrustLevel, TRUST_LEVEL } from './runtime/kernel/trustGraph.js';
import { runtimeConsole } from './ui/runtimeConsole.js';

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

/**
 * Register a module with the runtime using a (name, mod) signature.
 * Wraps runtime.register() which requires mod.id to be set.
 * Silently skips null/undefined modules.
 */
function _registerModule(name, mod) {
  if (!mod) return;
  try {
    // Attach the id if not already set
    if (!mod.id) mod.id = name;
    runtime.register(mod);
  } catch (err) {
    logger.warn('main', `[optional] registerModule("${name}") failed: ${err?.message || err}`);
    console.warn(`[Nuvra] Module "${name}" registration failed:`, err);
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
    if (mod) _registerModule(name, mod);
  }

  // ── Phase 8: Extensions & Marketplace ──────────────────────────────────────
  let extensionRegistry = null, marketplaceCatalog = null, revenueEngine = null;
  let extensionGovernance = null, aiExtensionLayer = null;
  let extensionDevTools = null, compatibilityMatrix = null;

  _try('ExtensionRegistry (P8)', () => {
    extensionRegistry = new ExtensionRegistry({ eventBus, store });
    _registerModule('extensionRegistry', extensionRegistry);
  });
  _try('MarketplaceCatalog (P8)', () => {
    marketplaceCatalog = new MarketplaceCatalog({ eventBus, store });
    _registerModule('marketplaceCatalog', marketplaceCatalog);
  });
  _try('RevenueEngine (P8)', () => {
    revenueEngine = new RevenueEngine({ eventBus, store });
    _registerModule('revenueEngine', revenueEngine);
  });
  _try('ExtensionGovernance (P8)', () => {
    extensionGovernance = new ExtensionGovernance({ eventBus, store });
    _registerModule('extensionGovernance', extensionGovernance);
  });
  _try('AIExtensionLayer (P8)', () => {
    aiExtensionLayer = new AIExtensionLayer({ eventBus, store });
    _registerModule('aiExtensionLayer', aiExtensionLayer);
  });
  _try('ExtensionDevTools (P8)', () => {
    extensionDevTools = new ExtensionDevTools({ eventBus, store });
    _registerModule('extensionDevTools', extensionDevTools);
  });
  _try('CompatibilityMatrix (P8)', () => {
    compatibilityMatrix = new CompatibilityMatrix({ eventBus, store });
    _registerModule('compatibilityMatrix', compatibilityMatrix);
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
    _registerModule('mobileRuntimeContract', mobileRuntimeContract);
  });
  _try('CapabilityDeclarationSystem (P9)', () => {
    capabilityDeclarationSystem = new CapabilityDeclarationSystem({ eventBus, store });
    _registerModule('capabilityDeclarationSystem', capabilityDeclarationSystem);
  });
  _try('MobilePolicyEngine (P9)', () => {
    mobilePolicyEngine = new MobilePolicyEngine({ eventBus, store });
    _registerModule('mobilePolicyEngine', mobilePolicyEngine);
  });
  _try('MobileAwarePlanner (P9)', () => {
    mobileAwarePlanner = new MobileAwarePlanner({ eventBus, store });
    _registerModule('mobileAwarePlanner', mobileAwarePlanner);
  });
  _try('PreviewParityEnforcement (P9)', () => {
    previewParityEnforcement = new PreviewParityEnforcement({ eventBus, store });
    _registerModule('previewParityEnforcement', previewParityEnforcement);
  });
  _try('GovernedBuildPipeline (P9)', () => {
    governedBuildPipeline = new GovernedBuildPipeline({ eventBus, store });
    _registerModule('governedBuildPipeline', governedBuildPipeline);
  });
  _try('EnterpriseRegulatedProfiles (P9)', () => {
    enterpriseRegulatedProfiles = new EnterpriseRegulatedProfiles({ eventBus, store });
    _registerModule('enterpriseRegulatedProfiles', enterpriseRegulatedProfiles);
  });
  _try('MobileVersioningRollback (P9)', () => {
    mobileVersioningRollback = new MobileVersioningRollback({ eventBus, store });
    _registerModule('mobileVersioningRollback', mobileVersioningRollback);
  });
  _try('SecurityThreatModeling (P9)', () => {
    securityThreatModeling = new SecurityThreatModeling({ eventBus, store });
    _registerModule('securityThreatModeling', securityThreatModeling);
  });
  _try('MobileReadinessDashboard (P9)', () => {
    // mobileReadinessDashboard is a singleton object (not a class)
    _registerModule('mobileReadinessDashboard', mobileReadinessDashboard);
  });
  _try('CapabilityInspector (P9)', () => {
    capabilityInspector = new CapabilityInspector({ eventBus, store });
    _registerModule('capabilityInspector', capabilityInspector);
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

  // ── Phase 11: Cloud Marketplace & Blueprint Economy ────────────────────────
  _try('P11 assetRegistry init', () => {
    if (typeof assetRegistry.init === 'function') assetRegistry.init();
  });
  _try('P11 analyticsService init', () => {
    if (typeof analyticsService.init === 'function') analyticsService.init();
  });
  _try('P11 marketplaceService init', () => {
    if (typeof marketplaceService.init === 'function') marketplaceService.init();
  });
  _try('P11 marketplaceStore init', () => {
    // Initialize the Phase 11 full marketplace store (creates the overlay panel)
    const authState = store.getState()?.auth || {};
    marketplaceStore.init({
      userId:    authState.userId || 'guest',
      projectId: store.getState()?.editor?.activePageId || 'default',
      userPlan:  authState.plan || 'free',
    });
    // Wire the MARKETPLACE tab button in the sidebar to open the store
    const mpTabBtn = document.querySelector('[data-tab="marketplace"], #nv-sidebar [role="tab"]:nth-child(4)');
    if (mpTabBtn) {
      mpTabBtn.addEventListener('click', () => marketplaceStore.open());
    }
    // Also wire the Generate button's marketplace option if present
    const mpBtn = document.getElementById('nv-marketplace-btn');
    if (mpBtn) mpBtn.addEventListener('click', () => marketplaceStore.open());
  });
  _registerModule('marketplaceService', marketplaceService);
  _registerModule('assetRegistry', assetRegistry);
  _registerModule('licenseEngine', licenseEngine);
  _registerModule('revenueEngine11', revenueEngine11);
  _registerModule('analyticsService', analyticsService);
  _registerModule('versionResolver', versionResolver);
  _registerModule('creatorService', creatorService);
  _registerModule('trustEngine', trustEngine);
  _registerModule('blueprintRegistry', blueprintRegistry);
  _registerModule('blueprintInstaller', blueprintInstaller);
  _registerModule('marketplaceAdvisor', marketplaceAdvisor);
  _registerModule('marketplaceStore', marketplaceStore);

  logger.info('main', 'Phase 11 modules registered');

  // ── Phase 12: Enterprise Admin Console ──────────────────────────────────
  _try('P12 auditService init', () => {
    const authState = store.getState()?.auth || {};
    if (typeof auditService.init === 'function') {
      auditService.init(authState.orgId || 'default', authState.userId || 'guest', 'session-0');
    }
  });
  _try('P12 orgService init', () => {
    const authState = store.getState()?.auth || {};
    if (typeof orgService.init === 'function') {
      orgService.init(authState.userId || 'guest');
    }
  });
  _try('P12 policyEngine init', () => {
    const authState = store.getState()?.auth || {};
    if (typeof policyEngine.init === 'function') {
      policyEngine.init(authState.orgId || 'default');
    }
  });
  _try('P12 deploymentManager init', () => {
    const authState = store.getState()?.auth || {};
    if (typeof deploymentManager.init === 'function') {
      deploymentManager.init(authState.orgId || 'default');
    }
  });
  _try('P12 whiteLabelService init', () => {
    const authState = store.getState()?.auth || {};
    if (typeof whiteLabelService.init === 'function') {
      whiteLabelService.init(authState.orgId || 'default');
    }
  });
  _try('P12 adminConsole init', () => {
    // Initialize the admin console (creates the overlay panel + Profile button wiring)
    if (typeof adminConsole.init === 'function') adminConsole.init();
    // Wire the Profile button in the toolbar to open the admin console
    const profileBtn = document.getElementById('nv-profile-btn') ||
      document.querySelector('[hint="User Profile"], [data-hint="User Profile"]');
    if (profileBtn && typeof adminConsole.toggle === 'function') {
      profileBtn.addEventListener('click', () => adminConsole.toggle());
    }
  });
  _registerModule('auditService', auditService);
  _registerModule('orgService', orgService);
  _registerModule('policyEngine', policyEngine);
  _registerModule('identityService', identityService);
  _registerModule('deploymentManager', deploymentManager);
  _registerModule('whiteLabelService', whiteLabelService);
  _registerModule('aiGovernance', aiGovernance);
  _registerModule('adminConsole', adminConsole);

  logger.info('main', 'Phase 12 modules registered');

  // ── Phase 13: Hosting Packs & Deploy Panel ────────────────────────────────
  _try('P13 packSDK init', () => {
    if (typeof packSDK.init === 'function') packSDK.init();
  });
  _try('P13 packRuntime init', () => {
    if (typeof packRuntime.init === 'function') packRuntime.init();
  });
  _try('P13 packManager init', () => {
    if (typeof packManager.init === 'function') packManager.init();
  });
  _try('P13 hostingManager init', () => {
    if (typeof hostingManager.init === 'function') hostingManager.init();
  });
  _try('P13 observabilityService init', () => {
    if (typeof observabilityService.init === 'function') observabilityService.init();
  });
  _try('P13 aiExtensions init', () => {
    if (typeof aiExtensions.init === 'function') aiExtensions.init();
  });
  _try('P13 deployPanel init', () => {
    if (typeof deployPanel.init === 'function') deployPanel.init();
    // Wire the Save button (right-click) to open the deploy panel
    const saveBtn = document.getElementById('nv-save-btn') ||
      document.querySelector('[hint="Save"]');
    if (saveBtn && typeof deployPanel.show === 'function') {
      saveBtn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        deployPanel.show();
      });
    }
    // Wire a dedicated deploy button if it exists
    const deployBtn = document.getElementById('nv-deploy-btn');
    if (deployBtn && typeof deployPanel.show === 'function') {
      deployBtn.addEventListener('click', () => deployPanel.show());
    }
  });
  _registerModule('packSDK', packSDK);
  _registerModule('packRuntime', packRuntime);
  _registerModule('packManager', packManager);
  _registerModule('hostingManager', hostingManager);
  _registerModule('deployPipeline', deployPipeline);
  _registerModule('deployHistory', deployHistory);
  _registerModule('domainManager', domainManager);
  _registerModule('observabilityService', observabilityService);
  _registerModule('aiExtensions', aiExtensions);
  _registerModule('deployPanel', deployPanel);

  logger.info('main', 'Phase 13 modules registered');

  // ── Phase 14: Autonomous Agent System ────────────────────────────────────────
  _try('P14 agentRuntime init', () => {
    if (typeof agentRuntime.init === 'function') agentRuntime.init();
  });
  _try('P14 agentPermissions init', () => {
    if (typeof agentPermissions.init === 'function') agentPermissions.init();
  });
  _try('P14 agentMemory init', () => {
    if (typeof agentMemory.init === 'function') agentMemory.init();
  });
  _try('P14 goalInterpreter init', () => {
    if (typeof goalInterpreter.init === 'function') goalInterpreter.init();
  });
  _try('P14 planExecutor init', () => {
    if (typeof planExecutor.init === 'function') planExecutor.init();
  });
  _try('P14 agentManager init', () => {
    if (typeof agentManager.init === 'function') agentManager.init();
  });
  _try('P14 agentConsole init', () => {
    if (typeof agentConsole.init === 'function') agentConsole.init();
    // Wire the Generate button to open the agent console
    const generateBtn = document.querySelector('[hint="Generate with AI"]');
    if (generateBtn && typeof agentConsole.open === 'function') {
      generateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        agentConsole.open();
      });
    }
  });
  _registerModule('agentRuntime', agentRuntime);
  _registerModule('agentPermissions', agentPermissions);
  _registerModule('agentMemory', agentMemory);
  _registerModule('goalInterpreter', goalInterpreter);
  _registerModule('planExecutor', planExecutor);
  _registerModule('agentManager', agentManager);
  _registerModule('agentConsole', agentConsole);

  logger.info('main', 'Phase 14 modules registered');

  // ── Phase 15: Institutional Trust & Compliance ────────────────────────────────
  _try('P15 policyRegistry init', () => {
    if (typeof policyRegistry.init === 'function') policyRegistry.init();
  });
  _try('P15 complianceEngine init', () => {
    if (typeof complianceEngine.init === 'function') complianceEngine.init();
  });
  _try('P15 dataClassifier init', () => {
    if (typeof dataClassifier.init === 'function') dataClassifier.init();
  });
  _try('P15 jurisdictionRules init', () => {
    if (typeof jurisdictionRules.init === 'function') jurisdictionRules.init();
  });
  _try('P15 auditLogger init', () => {
    if (typeof auditLogger.init === 'function') auditLogger.init();
  });
  _try('P15 permissionModel init', () => {
    if (typeof permissionModel.init === 'function') permissionModel.init();
  });
  _try('P15 pluginSandbox init', () => {
    if (typeof pluginSandbox.init === 'function') pluginSandbox.init();
  });
  _try('P15 supplyChainSecurity init', () => {
    if (typeof supplyChainSecurity.init === 'function') supplyChainSecurity.init();
  });
  _try('P15 threatModeler init', () => {
    if (typeof threatModeler.init === 'function') threatModeler.init();
  });
  _try('P15 complianceConsole init', () => {
    if (typeof complianceConsole.init === 'function') complianceConsole.init();
    // Wire the Planning button to also show the compliance console
    const planningBtn = document.querySelector('[hint="Toggle Planning Panel"]');
    if (planningBtn && typeof complianceConsole.open === 'function') {
      planningBtn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        complianceConsole.open();
      });
    }
  });
  _registerModule('policyRegistry', policyRegistry);
  _registerModule('complianceEngine', complianceEngine);
  _registerModule('dataClassifier', dataClassifier);
  _registerModule('jurisdictionRules', jurisdictionRules);
  _registerModule('auditLogger', auditLogger);
  _registerModule('permissionModel', permissionModel);
  _registerModule('pluginSandbox', pluginSandbox);
  _registerModule('supplyChainSecurity', supplyChainSecurity);
  _registerModule('threatModeler', threatModeler);
  _registerModule('complianceConsole', complianceConsole);

  logger.info('main', 'Phase 15 modules registered');

  // ── Phase 16: Nuvra Runtime Kernel (NRK) ──────────────────────────────────────
  _try('P16 kernelModule boot', async () => {
    if (typeof kernelModule.boot === 'function') {
      await kernelModule.boot({}, { env: 'production' });
    }
  });
  _try('P16 aiGatekeeper init', () => {
    aiGatekeeperInit({ enabled: true });
  });
  _try('P16 evidenceVault init', () => {
    evidenceVaultInit('anonymous', 'default-project');
  });
  _try('P16 explainabilityLedger init', () => {
    explainabilityInit('anonymous', 'default-project');
  });
  _try('P16 trustGraph init', () => {
    trustGraphInit('anonymous');
  });
  _try('P16 runtimeConsole init', () => {
    if (typeof runtimeConsole.init === 'function') runtimeConsole.init();
    // Wire the Planning button left-click to open the runtime console
    const planningBtn = document.querySelector('[hint="Toggle Planning Panel"]');
    if (planningBtn && typeof runtimeConsole.show === 'function') {
      planningBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        runtimeConsole.show();
      });
    }
  });
  _registerModule('executionContext', { ExecutionContext, ACTOR, INTENT, ENVIRONMENT, RISK_LEVEL });
  _registerModule('isolationManager', { IsolationManager, ISOLATION_MODE });
  _registerModule('kernelModule', kernelModule);
  _registerModule('certReadiness', certReadiness);
  _registerModule('soc2Mapper', soc2Mapper);
  _registerModule('runtimeConsole', runtimeConsole);

  logger.info('main', 'Phase 16 modules registered');

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
  // editorShell.start() takes the runtime object and finds #nv-app internally
  editorShell.start(runtime);
  logger.info('main', 'Editor shell started');

  // ── Post-shell wiring: wire toolbar events to panels ──
  _try('post-shell adminConsole eventBus wiring', () => {
    if (typeof adminConsole.toggle === 'function') {
      eventBus.on('ui:toggle_profile_panel', () => adminConsole.toggle());
      logger.info('main', 'Admin console wired to ui:toggle_profile_panel event');
    }
  });

  // ── Step 38: Mark as booted ────────────────────────────────────────────────
  store.dispatch({ type: 'APP/SET_BOOTED', payload: true });
  logger.info('main', 'Nuvra booted (Phase 16).');

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
    // Phase 11
    marketplaceService, assetRegistry, licenseEngine, revenueEngine11,
    analyticsService, versionResolver, creatorService, trustEngine,
    blueprintRegistry, blueprintInstaller, marketplaceAdvisor, marketplaceStore,
    // Phase 12
    auditService, orgService, policyEngine, identityService,
    deploymentManager, whiteLabelService, aiGovernance, adminConsole,
    // Phase 13
    packSDK, packRuntime, packManager,
    hostingManager, deployPipeline, deployHistory, domainManager,
    observabilityService, aiExtensions, deployPanel, DEPLOY_STATUS,
    // Phase 14
    agentRuntime, agentPermissions, agentMemory, MEMORY_CATEGORY,
    goalInterpreter, planExecutor, EXECUTION_STATUS,
    agentManager, agentConsole,
    // Phase 15
    policyRegistry, COMPLIANCE_SEVERITY, DATA_CLASS,
    complianceEngine, dataClassifier,
    jurisdictionRules, REGION_JURISDICTIONS,
    auditLogger, AUDIT_CATEGORIES,
    permissionModel, PERMISSION_ACTIONS,
    pluginSandbox, CAPABILITIES,
    supplyChainSecurity, threatModeler, complianceConsole,
    // Phase 16
    ExecutionContext, ACTOR, INTENT, ENVIRONMENT, RISK_LEVEL,
    IsolationManager, ISOLATION_MODE,
    kernelModule, certReadiness, READINESS_LEVEL,
    soc2Mapper, SOC2_CRITERIA,
    TRUST_LEVEL, GATEKEEPER_DECISION, SCENARIO_STATUS,
    AuditReplayer, SimulationEngine, runtimeConsole,
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
