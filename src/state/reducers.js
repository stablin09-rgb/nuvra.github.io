
'use strict';

import { generateId } from '../runtime/utils.js';

// ─── Editor Reducer ───────────────────────────────────────────────────────────
const EDITOR_INITIAL = {
  activePageId:     null,
  selectedElement:  null,
  hoverElement:     null,
  zoom:             1,
  gridEnabled:      false,
  snapEnabled:      true,
  deviceMode:       'desktop', // 'desktop' | 'tablet' | 'mobile'
  sidebarPanel:     'blocks',  // 'blocks' | 'style' | 'layers'
  isDirty:          false,
};

export function editorReducer(state = EDITOR_INITIAL, action) {
  switch (action.type) {
    case 'EDITOR/SET_ACTIVE_PAGE':
      return { ...state, activePageId: action.payload, selectedElement: null };
    case 'EDITOR/SELECT_ELEMENT':
      return { ...state, selectedElement: action.payload };
    case 'EDITOR/HOVER_ELEMENT':
      return { ...state, hoverElement: action.payload };
    case 'EDITOR/SET_ZOOM':
      return { ...state, zoom: Math.max(0.25, Math.min(4, action.payload)) };
    case 'EDITOR/TOGGLE_GRID':
      return { ...state, gridEnabled: !state.gridEnabled };
    case 'EDITOR/TOGGLE_SNAP':
      return { ...state, snapEnabled: !state.snapEnabled };
    case 'EDITOR/SET_DEVICE_MODE':
      return { ...state, deviceMode: action.payload };
    case 'EDITOR/SET_SIDEBAR_PANEL':
      return { ...state, sidebarPanel: action.payload };
    case 'EDITOR/MARK_DIRTY':
      return { ...state, isDirty: true };
    case 'EDITOR/MARK_CLEAN':
      return { ...state, isDirty: false };
    default:
      return state;
  }
}

// ─── Pages Reducer ────────────────────────────────────────────────────────────
const PAGES_INITIAL = {
  byId:  {},   // { [pageId]: PageRecord }
  order: [],   // pageId[] — display order
};

export function pagesReducer(state = PAGES_INITIAL, action) {
  switch (action.type) {
    case 'PAGES/ADD': {
      const page = action.payload;
      return {
        byId:  { ...state.byId, [page.id]: page },
        order: [...state.order, page.id],
      };
    }
    case 'PAGES/UPDATE': {
      const { id, changes } = action.payload;
      if (!state.byId[id]) return state;
      return {
        ...state,
        byId: {
          ...state.byId,
          [id]: { ...state.byId[id], ...changes, updatedAt: Date.now() },
        },
      };
    }
    case 'PAGES/REMOVE': {
      const id = action.payload;
      const { [id]: _removed, ...rest } = state.byId;
      return {
        byId:  rest,
        order: state.order.filter(pid => pid !== id),
      };
    }
    case 'PAGES/REORDER': {
      // payload: string[] — new order of page IDs
      const newOrder = action.payload.filter(id => state.byId[id]);
      return { ...state, order: newOrder };
    }
    case 'PAGES/SET_CONTENT': {
      const { id, content } = action.payload;
      if (!state.byId[id]) return state;
      return {
        ...state,
        byId: {
          ...state.byId,
          [id]: { ...state.byId[id], content, updatedAt: Date.now() },
        },
      };
    }
    default:
      return state;
  }
}

// ─── UI Reducer ───────────────────────────────────────────────────────────────
const UI_INITIAL = {
  modals:       {},   // { [modalId]: boolean }
  panels:       { planning: false, marketplace: false, mobile: false },   // { [panelId]: boolean }
  notifications: [],  // { id, type, message, ts }
  loading:      {},   // { [key]: boolean }
  theme:        'dark',
};

export function uiReducer(state = UI_INITIAL, action) {
  switch (action.type) {
    case 'UI/OPEN_MODAL':
      return { ...state, modals: { ...state.modals, [action.payload]: true } };
    case 'UI/CLOSE_MODAL':
      return { ...state, modals: { ...state.modals, [action.payload]: false } };
    case 'UI/TOGGLE_PANEL':
      return {
        ...state,
        panels: { ...state.panels, [action.payload]: !state.panels[action.payload] },
      };
    case 'UI/SHOW_NOTIFICATION': {
      const note = { id: generateId('note'), ts: Date.now(), ...action.payload };
      return { ...state, notifications: [...state.notifications, note] };
    }
    case 'UI/DISMISS_NOTIFICATION':
      return {
        ...state,
        notifications: state.notifications.filter(n => n.id !== action.payload),
      };
    case 'UI/SET_LOADING':
      return {
        ...state,
        loading: { ...state.loading, [action.payload.key]: action.payload.value },
      };
    case 'UI/SET_THEME':
      return { ...state, theme: action.payload };
    default:
      return state;
  }
}

// ─── Runtime Flags Reducer ────────────────────────────────────────────────────
const FLAGS_INITIAL = {
  isBooted:     false,
  isOnline:     true,
  isSaving:     false,
  lastSavedAt:  null,
  schemaVersion: 1,
};

export function flagsReducer(state = FLAGS_INITIAL, action) {
  switch (action.type) {
    case 'FLAGS/SET_BOOTED':
      return { ...state, isBooted: true };
    case 'FLAGS/SET_ONLINE':
      return { ...state, isOnline: action.payload };
    case 'FLAGS/SET_SAVING':
      return { ...state, isSaving: action.payload };
    case 'FLAGS/SET_LAST_SAVED':
      return { ...state, lastSavedAt: action.payload, isSaving: false };
    default:
      return state;
  }
}

// ─── AI Reducer ──────────────────────────────────────────────────────────────
const AI_INITIAL = {
  isPlanning:    false,
  planningStage: null,   // { stage: string, message: string }
  intent:        null,   // current IntentSchema
  siteSchema:    null,   // current SiteSchema
  decisions:     [],     // planning decisions log
  schemaStore:   null,   // serialized SchemaStore (for persistence)
};

export function aiReducer(state = AI_INITIAL, action) {
  switch (action.type) {
    case 'AI/SET_PLANNING':
      return { ...state, isPlanning: action.payload };
    case 'AI/SET_PLANNING_STAGE':
      return { ...state, planningStage: action.payload };
    case 'AI/SET_INTENT':
      return { ...state, intent: action.payload };
    case 'AI/CLEAR_INTENT':
      return { ...state, intent: null, siteSchema: null, decisions: [] };
    case 'AI/SET_SITE_SCHEMA':
      return { ...state, siteSchema: action.payload };
    case 'AI/SET_DECISIONS':
      return { ...state, decisions: action.payload };
    case 'AI/SET_SCHEMA_STORE':
      return { ...state, schemaStore: action.payload };
    default:
      return state;
  }
}

// ─── App Builder Reducer ─────────────────────────────────────────────────────
// Tracks the App Builder state: which AppSchema is loaded, the active runtime
// mode, and the list of app schemas the user has created.
const APP_INITIAL = {
  schemas:       {},    // { [appId]: AppSchema } — all app schemas
  activeAppId:   null,  // currently open app schema in the editor
  runtimeMode:   null,  // 'preview' | 'publish' | null
  runtimeReady:  false, // true when AppRuntime has booted
};

export function appReducer(state = APP_INITIAL, action) {
  switch (action.type) {
    case 'APP/SET_SCHEMA': {
      const schema = action.payload;
      return {
        ...state,
        schemas: { ...state.schemas, [schema.id]: schema },
        activeAppId: schema.id,
      };
    }
    case 'APP/UPDATE_SCHEMA': {
      const { id, changes } = action.payload;
      if (!state.schemas[id]) return state;
      return {
        ...state,
        schemas: {
          ...state.schemas,
          [id]: { ...state.schemas[id], ...changes, updatedAt: Date.now() },
        },
      };
    }
    case 'APP/REMOVE_SCHEMA': {
      const { [action.payload]: _removed, ...rest } = state.schemas;
      return {
        ...state,
        schemas:     rest,
        activeAppId: state.activeAppId === action.payload ? null : state.activeAppId,
      };
    }
    case 'APP/SET_ACTIVE':
      return { ...state, activeAppId: action.payload };
    case 'APP/SET_RUNTIME_MODE':
      return { ...state, runtimeMode: action.payload, runtimeReady: false };
    case 'APP/SET_RUNTIME_READY':
      return { ...state, runtimeReady: action.payload };
    default:
      return state;
  }
}

// ─── Preview Reducer ─────────────────────────────────────────────────────────
const PREVIEW_INITIAL = {
  state:    'idle',    // PreviewState
  viewport: 'desktop', // 'desktop' | 'tablet' | 'mobile'
  debug:    false,
};

export function previewReducer(state = PREVIEW_INITIAL, action) {
  switch (action.type) {
    case 'PREVIEW/SET_STATE':
      return { ...state, state: action.payload };
    case 'PREVIEW/SET_VIEWPORT':
      return { ...state, viewport: action.payload };
    case 'PREVIEW/SET_DEBUG':
      return { ...state, debug: action.payload };
    default:
      return state;
  }
}

// ─── Publish Reducer ──────────────────────────────────────────────────────────
const PUBLISH_INITIAL = {
  stage:      'idle',  // PipelineStage
  lastResult: null,    // Last publish result
  error:      null,    // Last publish error
};

export function publishReducer(state = PUBLISH_INITIAL, action) {
  switch (action.type) {
    case 'PUBLISH/SET_STAGE':
      return { ...state, stage: action.payload, error: null };
    case 'PUBLISH/SET_RESULT':
      return { ...state, stage: 'complete', lastResult: action.payload, error: null };
    case 'PUBLISH/SET_ERROR':
      return { ...state, stage: 'error', error: action.payload };
    default:
      return state;
  }
}

// ─── Runtime Errors Reducer ───────────────────────────────────────────────────
const RUNTIME_ERRORS_INITIAL = {
  errors: [], // RuntimeError[]
};

export function runtimeErrorsReducer(state = RUNTIME_ERRORS_INITIAL, action) {
  switch (action.type) {
    case 'RUNTIME/ADD_ERROR':
      return { ...state, errors: [...state.errors.slice(-99), action.payload] };
    case 'RUNTIME/MARK_ERROR_RECOVERED': {
      return {
        ...state,
        errors: state.errors.map(e =>
          e.id === action.payload ? { ...e, recovered: true } : e
        ),
      };
    }
    case 'RUNTIME/CLEAR_ERRORS':
      return { ...state, errors: [] };
    default:
      return state;
  }
}

// ─── AI Generation Reducer ────────────────────────────────────────────────────
const AI_GENERATION_INITIAL = {
  activeGenerations: {},
  history: [],
  lastError: null,
};

export function aiGenerationReducer(state = AI_GENERATION_INITIAL, action) {
  switch (action.type) {
    case 'AI_GENERATION/START':
      return {
        ...state,
        activeGenerations: { ...state.activeGenerations, [action.payload.id]: action.payload },
      };
    case 'AI_GENERATION/UPDATE_STAGE': {
      const { id, stage, message } = action.payload;
      if (!state.activeGenerations[id]) return state;
      return {
        ...state,
        activeGenerations: {
          ...state.activeGenerations,
          [id]: { ...state.activeGenerations[id], stage, message },
        },
      };
    }
    case 'AI_GENERATION/COMPLETE': {
      const { [action.payload.id]: completed, ...rest } = state.activeGenerations;
      if (!completed) return state;
      return {
        ...state,
        activeGenerations: rest,
        history: [completed, ...state.history.slice(0, 49)],
      };
    }
    case 'AI_GENERATION/FAIL': {
      const { [action.payload.id]: failed, ...rest } = state.activeGenerations;
      if (!failed) return state;
      return {
        ...state,
        activeGenerations: rest,
        lastError: action.payload.error,
        history: [failed, ...state.history.slice(0, 49)],
      };
    }
    default:
      return state;
  }
}

// ─── Phase 6: Auth, Cloud, Governance ─────────────────────────────────────────

const AUTH_INITIAL = {
  session: null,
  user: null,
  provider: null,
  status: 'idle',
  error: null,
};

export function authReducer(state = AUTH_INITIAL, action) {
  switch (action.type) {
    case 'AUTH/SET_STATUS':
      return { ...state, status: action.payload, error: null };
    case 'AUTH/SET_SESSION':
      return { ...state, session: action.payload, user: action.payload?.user || null, status: 'authenticated' };
    case 'AUTH/SIGN_OUT':
      return { ...AUTH_INITIAL, provider: state.provider };
    case 'AUTH/SET_ERROR':
      return { ...state, error: action.payload, status: 'error' };
    default:
      return state;
  }
}

const CLOUD_INITIAL = {
  projects: [],
  activeProject: null,
  status: 'idle',
  lastSynced: null,
  error: null,
};

export function cloudReducer(state = CLOUD_INITIAL, action) {
  switch (action.type) {
    case 'CLOUD/SET_STATUS':
      return { ...state, status: action.payload };
    case 'CLOUD/SET_PROJECTS':
      return { ...state, projects: action.payload };
    case 'CLOUD/SET_ACTIVE_PROJECT':
      return { ...state, activeProject: action.payload };
    case 'CLOUD/SET_LAST_SYNCED':
      return { ...state, lastSynced: action.payload };
    case 'CLOUD/SET_ERROR':
      return { ...state, error: action.payload };
    default:
      return state;
  }
}

const GOVERNANCE_INITIAL = {
  secrets: {},
  ownership: {},
  logs: [],
};

export function governanceReducer(state = GOVERNANCE_INITIAL, action) {
  switch (action.type) {
    case 'GOVERNANCE/SET_SECRETS':
      return { ...state, secrets: action.payload };
    case 'GOVERNANCE/SET_OWNERSHIP':
      return { ...state, ownership: action.payload };
    case 'GOVERNANCE/ADD_LOG':
      return { ...state, logs: [...state.logs, action.payload] };
    default:
      return state;
  }
}

// ─── Phase 7: Billing & Usage ─────────────────────────────────────────────────

const BILLING_INITIAL = {
  plan: 'free',
  usage: {},
  limits: {},
  history: [],
  status: 'active',
  aiCostBlocked: null,
  abuseFlag: null,
};

export function billingReducer(state = BILLING_INITIAL, action) {
  switch (action.type) {
    case 'BILLING/SET_PLAN':
      return { ...state, plan: action.payload };
    case 'BILLING/SET_USAGE':
      return { ...state, usage: { ...state.usage, ...action.payload } };
    case 'BILLING/SET_LIMITS':
      return { ...state, limits: action.payload };
    case 'BILLING/SET_HISTORY':
      return { ...state, history: action.payload };
    case 'BILLING/SET_STATUS':
      return { ...state, status: action.payload };
    case 'BILLING/SET_AI_COST_BLOCKED':
      return { ...state, aiCostBlocked: action.payload };
    case 'BILLING/CLEAR_AI_COST_BLOCKED':
      return { ...state, aiCostBlocked: null };
    case 'BILLING/SET_ABUSE_FLAG':
      return { ...state, abuseFlag: action.payload };
    case 'BILLING/CLEAR_ABUSE_FLAG':
      return { ...state, abuseFlag: null };
    default:
      return state;
  }
}

// ─── Phase 8: Extensions & Marketplace ──────────────────────────────────────

const EXTENSIONS_INITIAL = {
  installed:          [],   // { id, name, version, type, trustTier, enabled, sandboxState }
  active:             [],   // extensionId[]
  marketplaceCatalog: { results: [], total: 0, lastFetched: null },
  devSession:         null, // { extensionId, sessionId, startedAt, reloads }
  statusReport:       null,
};

export function extensionsReducer(state = EXTENSIONS_INITIAL, action) {
  switch (action.type) {
    case 'EXTENSIONS/REGISTRY_UPDATED':
      return { ...state, installed: action.payload.installed, active: action.payload.active };
    case 'EXTENSIONS/STATUS_REPORT':
      return { ...state, statusReport: action.payload };
    case 'EXTENSIONS/CATALOG_UPDATED':
      return { ...state, marketplaceCatalog: action.payload };
    case 'EXTENSIONS/DEV_SESSION_STARTED':
      return { ...state, devSession: action.payload };
    case 'EXTENSIONS/DEV_SESSION_ENDED':
      return { ...state, devSession: null };
    default:
      return state;
  }
}

const MARKETPLACE_INITIAL = {
  catalog:   [], // Array of MarketplaceExtensionManifests
  filters:   {}, // Active filters for the catalog
  query:     '', // Search query
  featured:  [], // Featured extensions
  promotions: [], // Active promotions
};

export function marketplaceReducer(state = MARKETPLACE_INITIAL, action) {
  switch (action.type) {
    case 'MARKETPLACE/SET_CATALOG':
      return { ...state, catalog: action.payload };
    case 'MARKETPLACE/SET_FILTERS':
      return { ...state, filters: { ...state.filters, ...action.payload } };
    case 'MARKETPLACE/SET_QUERY':
      return { ...state, query: action.payload };
    case 'MARKETPLACE/SET_FEATURED':
      return { ...state, featured: action.payload };
    case 'MARKETPLACE/SET_PROMOTIONS':
      return { ...state, promotions: action.payload };
    default:
      return state;
  }
}

const REVENUE_INITIAL = {
  transactions: [], // Array of TransactionRecords
  earnings:     {}, // { [extensionId]: amount }
  payouts:      [], // Array of PayoutRecords
};

export function revenueReducer(state = REVENUE_INITIAL, action) {
  switch (action.type) {
    case 'REVENUE/ADD_TRANSACTION':
      return { ...state, transactions: [...state.transactions, action.payload] };
    case 'REVENUE/UPDATE_EARNINGS':
      return { ...state, earnings: { ...state.earnings, ...action.payload } };
    case 'REVENUE/ADD_PAYOUT':
      return { ...state, payouts: [...state.payouts, action.payload] };
    default:
      return state;
  }
}

const EXTENSION_GOVERNANCE_INITIAL = {
  securityViolations: [], // Array of SecurityViolationRecords
  auditLogs:          [], // Array of AuditLogRecords
  policies:           {}, // Active policies
};

export function extensionGovernanceReducer(state = EXTENSION_GOVERNANCE_INITIAL, action) {
  switch (action.type) {
    case 'EXTENSION_GOVERNANCE/ADD_VIOLATION':
      return { ...state, securityViolations: [...state.securityViolations, action.payload] };
    case 'EXTENSION_GOVERNANCE/ADD_AUDIT_LOG':
      return { ...state, auditLogs: [...state.auditLogs, action.payload] };
    case 'EXTENSION_GOVERNANCE/SET_POLICY':
      return { ...state, policies: { ...state.policies, ...action.payload } };
    default:
      return state;
  }
}

const AI_EXTENSIONS_INITIAL = {
  availableModels:    [], // Array of AIModelRecords
  activeIntegrations: [], // Array of active AI extension IDs
  usageStats:         {}, // { [extensionId]: UsageStats }
};

export function aiExtensionsReducer(state = AI_EXTENSIONS_INITIAL, action) {
  switch (action.type) {
    case 'AI_EXTENSIONS/SET_AVAILABLE_MODELS':
      return { ...state, availableModels: action.payload };
    case 'AI_EXTENSIONS/ACTIVATE_INTEGRATION':
      return { ...state, activeIntegrations: [...state.activeIntegrations, action.payload] };
    case 'AI_EXTENSIONS/DEACTIVATE_INTEGRATION':
      return { ...state, activeIntegrations: state.activeIntegrations.filter(id => id !== action.payload) };
    case 'AI_EXTENSIONS/UPDATE_USAGE_STATS':
      return { ...state, usageStats: { ...state.usageStats, ...action.payload } };
    default:
      return state;
  }
}

const EXTENSION_DEV_TOOLS_INITIAL = {
  isDevMode:       false,
  selectedExtension: null, // ID of extension being developed
  buildLogs:       [],   // Array of BuildLogRecords
  testResults:     {},   // { [testId]: TestResult }
};

export function extensionDevToolsReducer(state = EXTENSION_DEV_TOOLS_INITIAL, action) {
  switch (action.type) {
    case 'EXTENSION_DEV_TOOLS/SET_DEV_MODE':
      return { ...state, isDevMode: action.payload };
    case 'EXTENSION_DEV_TOOLS/SET_SELECTED_EXTENSION':
      return { ...state, selectedExtension: action.payload };
    case 'EXTENSION_DEV_TOOLS/ADD_BUILD_LOG':
      return { ...state, buildLogs: [...state.buildLogs, action.payload] };
    case 'EXTENSION_DEV_TOOLS/SET_TEST_RESULT':
      return { ...state, testResults: { ...state.testResults, [action.payload.id]: action.payload.result } };
    default:
      return state;
  }
}

const COMPATIBILITY_MATRIX_INITIAL = {
  nuvraCoreVersion: '0.0.0', // Current Nuvra core version
  extensionVersions: {},    // { [extensionId]: { min: 'x.y.z', max: 'a.b.c' } }
  compatibilityIssues: [],  // Array of CompatibilityIssueRecords
};

export function compatibilityMatrixReducer(state = COMPATIBILITY_MATRIX_INITIAL, action) {
  switch (action.type) {
    case 'COMPATIBILITY_MATRIX/SET_CORE_VERSION':
      return { ...state, nuvraCoreVersion: action.payload };
    case 'COMPATIBILITY_MATRIX/SET_EXTENSION_VERSIONS':
      return { ...state, extensionVersions: { ...state.extensionVersions, ...action.payload } };
    case 'COMPATIBILITY_MATRIX/ADD_ISSUE':
      return { ...state, compatibilityIssues: [...state.compatibilityIssues, action.payload] };
    case 'COMPATIBILITY_MATRIX/RESOLVE_ISSUE':
      return { ...state, compatibilityIssues: state.compatibilityIssues.filter(issue => issue.id !== action.payload) };
    default:
      return state;
  }
}

// ─── Root Reducer ─────────────────────────────────────────────────────────────
/**
 * Combines all slice reducers into a single root reducer.
 * @param {object} state
 * @param {object} action
 * @returns {object}
 */
export function rootReducer(state = {}, action) {
  return {
    editor:        editorReducer(state.editor,              action),
    pages:         pagesReducer(state.pages,                action),
    ui:            uiReducer(state.ui,                      action),
    flags:         flagsReducer(state.flags,                action),
    ai:            aiReducer(state.ai,                      action),
    aiGeneration:  aiGenerationReducer(state.aiGeneration,  action),
    app:           appReducer(state.app,                    action),
    preview:       previewReducer(state.preview,            action),
    publish:       publishReducer(state.publish,            action),
    runtimeErrors: runtimeErrorsReducer(state.runtimeErrors, action),
    // Phase 6
    auth:          authReducer(state.auth,                  action),
    cloud:         cloudReducer(state.cloud,                action),
    governance:    governanceReducer(state.governance,      action),
    // Phase 7
    billing:       billingReducer(state.billing,            action),
    // Phase 8
    extensions:             extensionsReducer(state.extensions,             action),
    marketplace:            marketplaceReducer(state.marketplace,            action),
    revenue:                revenueReducer(state.revenue,                action),
    extensionGovernance:    extensionGovernanceReducer(state.extensionGovernance,    action),
    aiExtensions:           aiExtensionsReducer(state.aiExtensions,           action),
    extensionDevTools:      extensionDevToolsReducer(state.extensionDevTools,      action),
    compatibilityMatrix:    compatibilityMatrixReducer(state.compatibilityMatrix,    action),
  };
}

export default rootReducer;
