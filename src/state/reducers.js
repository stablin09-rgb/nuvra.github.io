/**
 * reducers.js — Nuvra Foundation (Phase 0–1)
 *
 * Pure reducer functions. Each reducer handles a slice of state.
 * Reducers MUST be pure: (state, action) => newState.
 * They MUST NOT mutate state, call APIs, or have side effects.
 *
 * Action shape: { type: string, payload: * }
 *
 * @module state/reducers
 */
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
  panels:       {},   // { [panelId]: boolean }
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

// ─── AI Generation Reducer (Phase 5) ────────────────────────────────────────
// Tracks the full Phase 5 AI generation pipeline state.
const AI_GEN_INITIAL = {
  generationStage:  'idle',    // GenerationStage
  generationRunId:  null,      // Current run ID
  generationError:  null,      // Last error message
  intent:           null,      // IntentSchema from Step 1
  plan:             null,      // SystemPlan from Step 2
  generatedSchema:  null,      // Assembled AppSchema from Step 3
  activeProviderId: 'openai',  // Currently active provider
  budgetSummary:    null,      // BudgetEngine session summary
  securityThreats:  [],        // Recent security scan threats
};

export function aiGenerationReducer(state = AI_GEN_INITIAL, action) {
  switch (action.type) {
    case 'AI/SET_GENERATION_STAGE':
      return { ...state, generationStage: action.payload, generationError: null };
    case 'AI/SET_GENERATION_RUN_ID':
      return { ...state, generationRunId: action.payload };
    case 'AI/SET_GENERATION_ERROR':
      return { ...state, generationStage: 'failed', generationError: action.payload };
    case 'AI/SET_INTENT':
      return { ...state, intent: action.payload };
    case 'AI/SET_PLAN':
      return { ...state, plan: action.payload };
    case 'AI/SET_SCHEMA':
      return { ...state, generatedSchema: action.payload };
    case 'AI/SET_ACTIVE_PROVIDER':
      return { ...state, activeProviderId: action.payload };
    case 'AI/SET_BUDGET_SUMMARY':
      return { ...state, budgetSummary: action.payload };
    case 'AI/ADD_SECURITY_THREAT':
      return { ...state, securityThreats: [...state.securityThreats.slice(-19), action.payload] };
    case 'AI/CLEAR_GENERATION':
      return { ...AI_GEN_INITIAL, activeProviderId: state.activeProviderId, budgetSummary: state.budgetSummary };
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
  };
}

export default rootReducer;
