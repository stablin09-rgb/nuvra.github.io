/**
 * Nuvra Enterprise — White Label Service (Phase 12)
 *
 * Enables true white-labeling of the Nuvra platform for enterprise customers.
 * A white-label deployment is a fully customized instance of Nuvra that appears
 * as the customer's own product.
 *
 * White Label Config Shape:
 * {
 *   orgId:           string,
 *   domain:          string,          // e.g. 'builder.acme.com'
 *   appName:         string,          // e.g. 'Acme Builder'
 *   appTagline:      string,
 *   logoUrl:         string,
 *   faviconUrl:      string,
 *   brandColors: {
 *     primary:       string,          // CSS color
 *     secondary:     string,
 *     accent:        string,
 *     background:    string,
 *     surface:       string,
 *     text:          string,
 *   },
 *   typography: {
 *     fontFamily:    string,          // Google Fonts name or system font
 *     fontUrl:       string | null,   // Google Fonts URL
 *   },
 *   features: {
 *     aiGeneration:  boolean,
 *     cloudPublish:  boolean,
 *     mobileBuild:   boolean,
 *     marketplace:   boolean,
 *     teamManagement:boolean,
 *     analytics:     boolean,
 *     customDomain:  boolean,
 *   },
 *   marketplace: {
 *     enabled:       boolean,
 *     allowedAssets: string[] | null, // null = all, array = subset by assetId
 *     blockedAssets: string[],
 *     customCatalog: boolean,         // show only org-published assets
 *   },
 *   supportUrl:      string | null,
 *   privacyUrl:      string | null,
 *   termsUrl:        string | null,
 *   hideNuvraCredit: boolean,         // requires white_label plan
 *   customCss:       string | null,   // injected into <head>
 * }
 *
 * @module whiteLabelService
 */
'use strict';

import { auditService } from '../org/auditService.js';

// ─── Default Config ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG = Object.freeze({
  orgId:      null,
  domain:     null,
  appName:    'Nuvra',
  appTagline: 'Build anything. Ship everywhere.',
  logoUrl:    null,
  faviconUrl: null,
  brandColors: {
    primary:    '#6366f1',
    secondary:  '#8b5cf6',
    accent:     '#06b6d4',
    background: '#0f0f1a',
    surface:    '#1a1a2e',
    text:       '#e2e8f0',
  },
  typography: {
    fontFamily: 'Inter, system-ui, sans-serif',
    fontUrl:    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  },
  features: {
    aiGeneration:   true,
    cloudPublish:   true,
    mobileBuild:    true,
    marketplace:    true,
    teamManagement: true,
    analytics:      true,
    customDomain:   true,
  },
  marketplace: {
    enabled:      true,
    allowedAssets: null,
    blockedAssets: [],
    customCatalog: false,
  },
  supportUrl:      null,
  privacyUrl:      null,
  termsUrl:        null,
  hideNuvraCredit: false,
  customCss:       null,
});

// ─── Internal State ───────────────────────────────────────────────────────────

let _config    = { ...DEFAULT_CONFIG };
let _applied   = false;
let _listeners = [];

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Initialize the white label service.
 * Loads config from cloud (with localStorage fallback), then applies it.
 *
 * @param {string|null} orgId
 */
export async function init(orgId) {
  if (!orgId) {
    _config  = { ...DEFAULT_CONFIG };
    _applied = false;
    return;
  }

  // Load from cloud
  try {
    const { cloud } = await import('./cloud.js');
    if (cloud.isCloudAvailable()) {
      const { data } = await cloud.orgs.getWhiteLabel(orgId);
      if (data) {
        _config = _mergeConfig(data);
        _saveLocal(orgId, _config);
        _apply();
        return;
      }
    }
  } catch {}

  // Fallback to localStorage
  const cached = _loadLocal(orgId);
  if (cached) {
    _config = _mergeConfig(cached);
    _apply();
  }
}

// ─── Config Management ────────────────────────────────────────────────────────

/**
 * Get the current white label config.
 */
export function getConfig() {
  return { ..._config };
}

/**
 * Update the white label config (admin/owner only).
 * Changes are applied immediately and persisted.
 *
 * @param {object} updates - Partial white label config
 */
export async function updateConfig(updates) {
  const merged = _mergeConfig({ ..._config, ...updates });
  _config = merged;

  // Persist to cloud
  try {
    const { cloud } = await import('./cloud.js');
    if (cloud.isCloudAvailable() && _config.orgId) {
      await cloud.orgs.setWhiteLabel(_config.orgId, merged);
    }
  } catch {}

  // Persist locally
  if (_config.orgId) _saveLocal(_config.orgId, merged);

  // Apply to DOM
  _apply();

  _emit('whitelabel.updated', { config: merged });

  await auditService.log({
    action: 'whitelabel.updated',
    orgId:  _config.orgId,
    meta:   { updatedFields: Object.keys(updates) },
    severity: 'medium',
  });
}

/**
 * Reset to Nuvra defaults.
 */
export async function resetToDefaults() {
  await updateConfig({ ...DEFAULT_CONFIG, orgId: _config.orgId });
}

// ─── Feature Flags ────────────────────────────────────────────────────────────

/**
 * Check if a feature is enabled in the current white-label config.
 *
 * @param {string} feature - Key from config.features
 * @returns {boolean}
 */
export function isFeatureEnabled(feature) {
  return _config.features?.[feature] !== false;
}

/**
 * Check if a marketplace asset is allowed in this white-label deployment.
 *
 * @param {string} assetId
 * @returns {boolean}
 */
export function isAssetAllowed(assetId) {
  const mp = _config.marketplace;
  if (!mp?.enabled) return false;
  if (mp.blockedAssets?.includes(assetId)) return false;
  if (mp.allowedAssets === null) return true;  // all allowed
  return mp.allowedAssets.includes(assetId);
}

// ─── DOM Application ──────────────────────────────────────────────────────────

/**
 * Apply the white label config to the DOM.
 * This is called automatically on init and updateConfig.
 */
export function apply() {
  _apply();
}

// ─── Accessors ────────────────────────────────────────────────────────────────

export function getAppName()       { return _config.appName; }
export function getLogoUrl()       { return _config.logoUrl; }
export function getFaviconUrl()    { return _config.faviconUrl; }
export function getSupportUrl()    { return _config.supportUrl; }
export function getPrivacyUrl()    { return _config.privacyUrl; }
export function getTermsUrl()      { return _config.termsUrl; }
export function hideNuvraCredit()  { return _config.hideNuvraCredit === true; }
export function isApplied()        { return _applied; }

// ─── Event Subscription ───────────────────────────────────────────────────────

export function subscribe(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function _apply() {
  if (typeof document === 'undefined') return;

  const cfg = _config;

  // 1. Document title
  if (cfg.appName) document.title = cfg.appName;

  // 2. Favicon
  if (cfg.faviconUrl) {
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = cfg.faviconUrl;
  }

  // 3. CSS custom properties (brand colors)
  const root = document.documentElement;
  if (cfg.brandColors) {
    const c = cfg.brandColors;
    if (c.primary)    root.style.setProperty('--nv-color-primary',    c.primary);
    if (c.secondary)  root.style.setProperty('--nv-color-secondary',  c.secondary);
    if (c.accent)     root.style.setProperty('--nv-color-accent',     c.accent);
    if (c.background) root.style.setProperty('--nv-color-bg',         c.background);
    if (c.surface)    root.style.setProperty('--nv-color-surface',    c.surface);
    if (c.text)       root.style.setProperty('--nv-color-text',       c.text);
  }

  // 4. Typography
  if (cfg.typography?.fontUrl) {
    const existingLink = document.getElementById('nv-wl-font');
    if (!existingLink) {
      const link = document.createElement('link');
      link.id   = 'nv-wl-font';
      link.rel  = 'stylesheet';
      link.href = cfg.typography.fontUrl;
      document.head.appendChild(link);
    } else {
      existingLink.href = cfg.typography.fontUrl;
    }
  }
  if (cfg.typography?.fontFamily) {
    root.style.setProperty('--nv-font-family', cfg.typography.fontFamily);
    document.body.style.fontFamily = cfg.typography.fontFamily;
  }

  // 5. Logo
  const logoEl = document.getElementById('nv-topbar-logo');
  if (logoEl) {
    if (cfg.logoUrl) {
      logoEl.innerHTML = `<img src="${cfg.logoUrl}" alt="${cfg.appName}" style="height:28px;object-fit:contain;">`;
    } else {
      logoEl.textContent = cfg.appName || 'Nuvra';
    }
  }

  // 6. Custom CSS injection
  let customStyleEl = document.getElementById('nv-wl-custom-css');
  if (cfg.customCss) {
    if (!customStyleEl) {
      customStyleEl = document.createElement('style');
      customStyleEl.id = 'nv-wl-custom-css';
      document.head.appendChild(customStyleEl);
    }
    customStyleEl.textContent = cfg.customCss;
  } else if (customStyleEl) {
    customStyleEl.textContent = '';
  }

  // 7. Nuvra credit visibility
  const creditEl = document.getElementById('nv-powered-by');
  if (creditEl) {
    creditEl.style.display = cfg.hideNuvraCredit ? 'none' : '';
  }

  // 8. Feature-gated UI elements
  _applyFeatureFlags(cfg.features);

  _applied = true;
  _emit('whitelabel.applied', { config: cfg });
}

function _applyFeatureFlags(features) {
  if (!features) return;

  const featureMap = {
    aiGeneration:   ['#btn-ai-page', '#btn-ai-site', '#btn-ai-app'],
    cloudPublish:   ['#btn-cloud-publish'],
    mobileBuild:    ['#btn-mobile-build'],
    marketplace:    ['#btn-marketplace'],
    teamManagement: ['#nv-team-section'],
    analytics:      ['#nv-analytics-section'],
  };

  for (const [feature, selectors] of Object.entries(featureMap)) {
    const enabled = features[feature] !== false;
    selectors.forEach(sel => {
      const el = document.querySelector(sel);
      if (el) el.style.display = enabled ? '' : 'none';
    });
  }
}

function _mergeConfig(partial) {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    brandColors: { ...DEFAULT_CONFIG.brandColors, ...(partial.brandColors || {}) },
    typography:  { ...DEFAULT_CONFIG.typography,  ...(partial.typography  || {}) },
    features:    { ...DEFAULT_CONFIG.features,    ...(partial.features    || {}) },
    marketplace: { ...DEFAULT_CONFIG.marketplace, ...(partial.marketplace || {}) },
  };
}

function _saveLocal(orgId, config) {
  try { localStorage.setItem(`nuvra-wl-${orgId}`, JSON.stringify(config)); } catch {}
}

function _loadLocal(orgId) {
  try { return JSON.parse(localStorage.getItem(`nuvra-wl-${orgId}`)); } catch { return null; }
}

function _emit(event, data) {
  _listeners.forEach(fn => { try { fn(event, data); } catch {} });
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const whiteLabelService = {
  init, getConfig, updateConfig, resetToDefaults,
  isFeatureEnabled, isAssetAllowed, apply,
  getAppName, getLogoUrl, getFaviconUrl,
  getSupportUrl, getPrivacyUrl, getTermsUrl,
  hideNuvraCredit, isApplied, subscribe,
};
