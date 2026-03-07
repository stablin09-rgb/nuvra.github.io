/**
 * Nuvra Enterprise — Deployment Manager (Phase 12)
 *
 * Manages multi-deployment model support:
 *
 *   CLOUD:     Nuvra-hosted (default) — Supabase backend
 *   HYBRID:    Customer-managed auth + Nuvra cloud storage
 *   ON_PREM:   Fully self-hosted — customer's own Supabase/Postgres
 *   SOVEREIGN: Air-gapped / government — no external network calls
 *
 * Also manages:
 *   - Feature flags (per-org, per-deployment, per-plan)
 *   - Data residency configuration
 *   - Connectivity mode (online / offline / degraded)
 *
 * DeploymentConfig Shape:
 * {
 *   model:           'cloud' | 'hybrid' | 'on_prem' | 'sovereign',
 *   region:          string,          // e.g. 'us-east-1', 'eu-west-1', 'custom'
 *   dataResidency:   string,          // e.g. 'US', 'EU', 'APAC', 'custom'
 *   supabaseUrl:     string | null,   // override for on-prem/hybrid
 *   supabaseAnonKey: string | null,   // override for on-prem/hybrid
 *   features:        FeatureFlags,
 *   allowedDomains:  string[],        // CORS / CSP allowed origins
 *   telemetry:       boolean,         // opt-out of usage telemetry
 * }
 *
 * FeatureFlags Shape:
 * {
 *   [flagName: string]: boolean | string | number
 * }
 *
 * @module deploymentManager
 */
'use strict';

import { auditService } from '../org/auditService.js';

// ─── Deployment Models ────────────────────────────────────────────────────────

export const DEPLOYMENT_MODELS = Object.freeze({
  CLOUD:    'cloud',
  HYBRID:   'hybrid',
  ON_PREM:  'on_prem',
  SOVEREIGN:'sovereign',
});

// ─── Connectivity Modes ───────────────────────────────────────────────────────

export const CONNECTIVITY = Object.freeze({
  ONLINE:   'online',
  OFFLINE:  'offline',
  DEGRADED: 'degraded',   // partial connectivity
});

// ─── Built-in Feature Flags ───────────────────────────────────────────────────

export const FLAGS = Object.freeze({
  // AI
  AI_GENERATION:        'ai.generation',
  AI_CLOUD_MODELS:      'ai.cloud_models',
  AI_LOCAL_MODELS:      'ai.local_models',
  AI_PROMPT_LOGGING:    'ai.prompt_logging',

  // Publishing
  CLOUD_PUBLISH:        'publish.cloud',
  CUSTOM_DOMAIN:        'publish.custom_domain',
  CDN_PUBLISH:          'publish.cdn',

  // Mobile
  MOBILE_BUILD:         'mobile.build',
  MOBILE_PREVIEW:       'mobile.preview',

  // Marketplace
  MARKETPLACE:          'marketplace.enabled',
  MARKETPLACE_PAID:     'marketplace.paid_assets',
  MARKETPLACE_PUBLISH:  'marketplace.publish',

  // Enterprise
  ENTERPRISE_SSO:       'enterprise.sso',
  ENTERPRISE_SCIM:      'enterprise.scim',
  ENTERPRISE_AUDIT:     'enterprise.audit',
  ENTERPRISE_POLICY:    'enterprise.policy',
  ENTERPRISE_WHITE_LABEL:'enterprise.white_label',

  // Telemetry
  TELEMETRY:            'telemetry.enabled',
  CRASH_REPORTING:      'telemetry.crash_reporting',
});

// ─── Default Flags by Deployment Model ───────────────────────────────────────

const DEFAULT_FLAGS_BY_MODEL = {
  [DEPLOYMENT_MODELS.CLOUD]: {
    [FLAGS.AI_GENERATION]:        true,
    [FLAGS.AI_CLOUD_MODELS]:      true,
    [FLAGS.AI_LOCAL_MODELS]:      true,
    [FLAGS.AI_PROMPT_LOGGING]:    false,
    [FLAGS.CLOUD_PUBLISH]:        true,
    [FLAGS.CUSTOM_DOMAIN]:        true,
    [FLAGS.CDN_PUBLISH]:          true,
    [FLAGS.MOBILE_BUILD]:         true,
    [FLAGS.MOBILE_PREVIEW]:       true,
    [FLAGS.MARKETPLACE]:          true,
    [FLAGS.MARKETPLACE_PAID]:     true,
    [FLAGS.MARKETPLACE_PUBLISH]:  true,
    [FLAGS.ENTERPRISE_SSO]:       false,
    [FLAGS.ENTERPRISE_SCIM]:      false,
    [FLAGS.ENTERPRISE_AUDIT]:     false,
    [FLAGS.ENTERPRISE_POLICY]:    false,
    [FLAGS.ENTERPRISE_WHITE_LABEL]:false,
    [FLAGS.TELEMETRY]:            true,
    [FLAGS.CRASH_REPORTING]:      true,
  },
  [DEPLOYMENT_MODELS.HYBRID]: {
    [FLAGS.AI_GENERATION]:        true,
    [FLAGS.AI_CLOUD_MODELS]:      true,
    [FLAGS.AI_LOCAL_MODELS]:      true,
    [FLAGS.AI_PROMPT_LOGGING]:    true,
    [FLAGS.CLOUD_PUBLISH]:        true,
    [FLAGS.CUSTOM_DOMAIN]:        true,
    [FLAGS.CDN_PUBLISH]:          true,
    [FLAGS.MOBILE_BUILD]:         true,
    [FLAGS.MOBILE_PREVIEW]:       true,
    [FLAGS.MARKETPLACE]:          true,
    [FLAGS.MARKETPLACE_PAID]:     true,
    [FLAGS.MARKETPLACE_PUBLISH]:  false,
    [FLAGS.ENTERPRISE_SSO]:       true,
    [FLAGS.ENTERPRISE_SCIM]:      true,
    [FLAGS.ENTERPRISE_AUDIT]:     true,
    [FLAGS.ENTERPRISE_POLICY]:    true,
    [FLAGS.ENTERPRISE_WHITE_LABEL]:true,
    [FLAGS.TELEMETRY]:            false,
    [FLAGS.CRASH_REPORTING]:      false,
  },
  [DEPLOYMENT_MODELS.ON_PREM]: {
    [FLAGS.AI_GENERATION]:        true,
    [FLAGS.AI_CLOUD_MODELS]:      false,  // No external AI calls
    [FLAGS.AI_LOCAL_MODELS]:      true,
    [FLAGS.AI_PROMPT_LOGGING]:    true,
    [FLAGS.CLOUD_PUBLISH]:        false,
    [FLAGS.CUSTOM_DOMAIN]:        true,
    [FLAGS.CDN_PUBLISH]:          false,
    [FLAGS.MOBILE_BUILD]:         true,
    [FLAGS.MOBILE_PREVIEW]:       true,
    [FLAGS.MARKETPLACE]:          false,
    [FLAGS.MARKETPLACE_PAID]:     false,
    [FLAGS.MARKETPLACE_PUBLISH]:  false,
    [FLAGS.ENTERPRISE_SSO]:       true,
    [FLAGS.ENTERPRISE_SCIM]:      true,
    [FLAGS.ENTERPRISE_AUDIT]:     true,
    [FLAGS.ENTERPRISE_POLICY]:    true,
    [FLAGS.ENTERPRISE_WHITE_LABEL]:true,
    [FLAGS.TELEMETRY]:            false,
    [FLAGS.CRASH_REPORTING]:      false,
  },
  [DEPLOYMENT_MODELS.SOVEREIGN]: {
    [FLAGS.AI_GENERATION]:        true,
    [FLAGS.AI_CLOUD_MODELS]:      false,  // Air-gapped
    [FLAGS.AI_LOCAL_MODELS]:      true,
    [FLAGS.AI_PROMPT_LOGGING]:    true,
    [FLAGS.CLOUD_PUBLISH]:        false,
    [FLAGS.CUSTOM_DOMAIN]:        false,
    [FLAGS.CDN_PUBLISH]:          false,
    [FLAGS.MOBILE_BUILD]:         true,
    [FLAGS.MOBILE_PREVIEW]:       true,
    [FLAGS.MARKETPLACE]:          false,
    [FLAGS.MARKETPLACE_PAID]:     false,
    [FLAGS.MARKETPLACE_PUBLISH]:  false,
    [FLAGS.ENTERPRISE_SSO]:       true,
    [FLAGS.ENTERPRISE_SCIM]:      true,
    [FLAGS.ENTERPRISE_AUDIT]:     true,
    [FLAGS.ENTERPRISE_POLICY]:    true,
    [FLAGS.ENTERPRISE_WHITE_LABEL]:true,
    [FLAGS.TELEMETRY]:            false,
    [FLAGS.CRASH_REPORTING]:      false,
  },
};

// ─── Internal State ───────────────────────────────────────────────────────────

let _config      = null;
let _flags       = {};
let _connectivity = CONNECTIVITY.ONLINE;
let _listeners   = [];
let _connectivityTimer = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Initialize the deployment manager.
 * Detects the deployment model from the environment and loads feature flags.
 *
 * @param {string|null} orgId
 */
export async function init(orgId) {
  // Detect deployment model from window config
  const model = window.__NUVRA_DEPLOYMENT_MODEL__ || DEPLOYMENT_MODELS.CLOUD;

  _config = {
    model,
    region:          window.__NUVRA_REGION__          || 'us-east-1',
    dataResidency:   window.__NUVRA_DATA_RESIDENCY__  || 'US',
    supabaseUrl:     window.__NUVRA_SUPABASE_URL__     || null,
    supabaseAnonKey: window.__NUVRA_SUPABASE_ANON_KEY__|| null,
    allowedDomains:  window.__NUVRA_ALLOWED_DOMAINS__  || [],
    telemetry:       window.__NUVRA_TELEMETRY__        !== false,
  };

  // Start with model defaults
  _flags = { ...DEFAULT_FLAGS_BY_MODEL[model] };

  // Override with org-specific flags from cloud
  if (orgId) {
    try {
      const { cloud } = await import('./cloud.js');
      if (cloud.isCloudAvailable()) {
        const { data } = await cloud.orgs.getFeatureFlags(orgId);
        if (data) {
          _flags = { ..._flags, ...data };
          _saveLocalFlags(orgId, _flags);
        }
      }
    } catch {}

    // Fallback to localStorage
    const cached = _loadLocalFlags(orgId);
    if (cached) _flags = { ..._flags, ...cached };
  }

  // Start connectivity monitoring
  _startConnectivityMonitor();

  _emit('deployment.initialized', { config: _config, flags: _flags });
}

// ─── Feature Flag API ─────────────────────────────────────────────────────────

/**
 * Check if a feature flag is enabled.
 *
 * @param {string} flag - One of FLAGS.*
 * @param {boolean} [defaultValue=true]
 * @returns {boolean}
 */
export function isEnabled(flag, defaultValue = true) {
  if (flag in _flags) return Boolean(_flags[flag]);
  return defaultValue;
}

/**
 * Get the value of a feature flag (supports non-boolean flags).
 */
export function getFlagValue(flag) {
  return _flags[flag];
}

/**
 * Override a feature flag at runtime (admin only, not persisted).
 */
export function overrideFlag(flag, value) {
  _flags[flag] = value;
  _emit('deployment.flag_overridden', { flag, value });
}

/**
 * Get all current feature flags.
 */
export function getAllFlags() {
  return { ..._flags };
}

// ─── Deployment Config Accessors ──────────────────────────────────────────────

export function getModel()         { return _config?.model || DEPLOYMENT_MODELS.CLOUD; }
export function getRegion()        { return _config?.region || 'us-east-1'; }
export function getDataResidency() { return _config?.dataResidency || 'US'; }
export function isTelemetryEnabled(){ return _config?.telemetry !== false && isEnabled(FLAGS.TELEMETRY); }

export function isCloud()          { return getModel() === DEPLOYMENT_MODELS.CLOUD; }
export function isHybrid()         { return getModel() === DEPLOYMENT_MODELS.HYBRID; }
export function isOnPrem()         { return getModel() === DEPLOYMENT_MODELS.ON_PREM; }
export function isSovereign()      { return getModel() === DEPLOYMENT_MODELS.SOVEREIGN; }

// ─── Connectivity ─────────────────────────────────────────────────────────────

export function getConnectivity()  { return _connectivity; }
export function isOnline()         { return _connectivity === CONNECTIVITY.ONLINE; }
export function isOffline()        { return _connectivity === CONNECTIVITY.OFFLINE; }

// ─── Event Subscription ───────────────────────────────────────────────────────

export function subscribe(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function _startConnectivityMonitor() {
  if (_connectivityTimer) clearInterval(_connectivityTimer);

  const _check = () => {
    const wasOnline = _connectivity !== CONNECTIVITY.OFFLINE;
    const nowOnline = navigator.onLine !== false;

    if (nowOnline && !wasOnline) {
      _connectivity = CONNECTIVITY.ONLINE;
      _emit('deployment.connectivity', { mode: CONNECTIVITY.ONLINE });
    } else if (!nowOnline && wasOnline) {
      _connectivity = CONNECTIVITY.OFFLINE;
      _emit('deployment.connectivity', { mode: CONNECTIVITY.OFFLINE });
    }
  };

  window.addEventListener('online',  () => { _connectivity = CONNECTIVITY.ONLINE;  _emit('deployment.connectivity', { mode: CONNECTIVITY.ONLINE }); });
  window.addEventListener('offline', () => { _connectivity = CONNECTIVITY.OFFLINE; _emit('deployment.connectivity', { mode: CONNECTIVITY.OFFLINE }); });

  _connectivityTimer = setInterval(_check, 30_000);
  _check();
}

function _saveLocalFlags(orgId, flags) {
  try { localStorage.setItem(`nuvra-flags-${orgId}`, JSON.stringify(flags)); } catch {}
}

function _loadLocalFlags(orgId) {
  try { return JSON.parse(localStorage.getItem(`nuvra-flags-${orgId}`)); } catch { return null; }
}

function _emit(event, data) {
  _listeners.forEach(fn => { try { fn(event, data); } catch {} });
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const deploymentManager = {
  init, isEnabled, getFlagValue, overrideFlag, getAllFlags,
  getModel, getRegion, getDataResidency, isTelemetryEnabled,
  isCloud, isHybrid, isOnPrem, isSovereign,
  getConnectivity, isOnline, isOffline, subscribe,
  DEPLOYMENT_MODELS, CONNECTIVITY, FLAGS,
};
