/**
 * Nuvra Builder — Marketplace Service (Phase 11)
 *
 * The central service layer for the cloud marketplace.
 * Decoupled from the editor — can be used in any context.
 *
 * Responsibilities:
 *  - Fetch and cache the cloud asset catalog
 *  - Resolve asset dependencies
 *  - Check compatibility
 *  - Coordinate install/update/remove with the asset registry
 *  - Emit marketplace events for the UI
 *
 * Architecture:
 *  ┌─────────────────────────────────────────────────────────────────┐
 *  │  marketplaceService.js  (public API)                            │
 *  │    search(), getAsset(), install(), update(), remove()          │
 *  │                                                                 │
 *  │  assetRegistry.js       (cloud asset state)                     │
 *  │  versionResolver.js     (semver + dependency resolution)        │
 *  │  licenseEngine.js       (license validation + enforcement)      │
 *  │  revenueEngine.js       (purchase + entitlement tracking)       │
 *  └─────────────────────────────────────────────────────────────────┘
 *
 * Asset shape (CloudAsset):
 *  {
 *    assetId:         string (UUID),
 *    slug:            string (url-safe, unique),
 *    name:            string,
 *    description:     string,
 *    longDescription: string,
 *    type:            'template' | 'plugin' | 'component' | 'integration' | 'ai-pack' | 'blueprint',
 *    category:        string,
 *    tags:            string[],
 *    author:          CreatorProfile,
 *    versions:        AssetVersion[],
 *    latestVersion:   string,
 *    pricing:         PricingModel,
 *    license:         LicenseDefinition,
 *    compatibility:   CompatibilitySpec,
 *    stats:           AssetStats,
 *    trust:           TrustSignals,
 *    screenshots:     string[],
 *    createdAt:       ISO string,
 *    updatedAt:       ISO string,
 *  }
 */
'use strict';

import { assetRegistry }   from './assetRegistry.js';
import { versionResolver } from './versionResolver.js';
import { licenseEngine }   from './licenseEngine.js';
import { revenueEngine }   from './revenueEngine.js';
import { trustEngine }     from '../governance/trust/trustEngine.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const NUVRA_VERSION       = '11.0.0';
const CATALOG_CACHE_TTL   = 5 * 60 * 1000; // 5 minutes
const CATALOG_CACHE_KEY   = 'nuvra-mp-catalog-cache';
const INSTALLED_KEY_PFX   = 'nuvra-mp-installed-';

// ─── Internal State ───────────────────────────────────────────────────────────

let _catalogCache     = null;
let _catalogCachedAt  = 0;
let _userId           = null;
let _projectId        = null;
let _listeners        = new Map(); // event → Set<fn>

// ─── Public API ───────────────────────────────────────────────────────────────

export const marketplaceService = {

  // ── Initialisation ─────────────────────────────────────────────────────────

  /**
   * Initialise the marketplace service.
   * @param {{ userId: string|null, projectId: string|null }} opts
   */
  init({ userId = null, projectId = null } = {}) {
    _userId    = userId;
    _projectId = projectId;
    assetRegistry.init(userId);
    revenueEngine.init(userId);
    licenseEngine.init(userId);
    console.info('[Marketplace] Initialised', { userId, projectId });
  },

  setProject(projectId) {
    _projectId = projectId;
  },

  setUser(userId) {
    _userId = userId;
    assetRegistry.init(userId);
    revenueEngine.init(userId);
    licenseEngine.init(userId);
  },

  // ── Catalog ────────────────────────────────────────────────────────────────

  /**
   * Fetch the full asset catalog (cloud + local, merged and deduped).
   * Results are cached for CATALOG_CACHE_TTL ms.
   * @returns {Promise<CloudAsset[]>}
   */
  async getCatalog(force = false) {
    const now = Date.now();
    if (!force && _catalogCache && (now - _catalogCachedAt) < CATALOG_CACHE_TTL) {
      return _catalogCache;
    }

    // Try cloud catalog first
    let cloudAssets = [];
    try {
      cloudAssets = await _fetchCloudCatalog();
    } catch (err) {
      console.warn('[Marketplace] Cloud catalog unavailable, using local fallback:', err.message);
    }

    // Merge with local catalog (Phase 10 catalog.json)
    const localAssets = await _fetchLocalCatalog();

    // Deduplicate: cloud takes precedence over local
    const seen = new Set();
    const merged = [];
    for (const asset of [...cloudAssets, ...localAssets]) {
      const key = asset.assetId || asset.id || asset.slug;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(_normaliseAsset(asset));
      }
    }

    _catalogCache    = merged;
    _catalogCachedAt = now;

    // Persist to localStorage for offline access
    try {
      localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({ assets: merged, cachedAt: now }));
    } catch {}

    return merged;
  },

  /**
   * Search the catalog with filters.
   * @param {{ query?, type?, category?, sort?, tags?, minPlan? }} opts
   * @returns {Promise<CloudAsset[]>}
   */
  async search({ query = '', type = '', category = '', sort = 'popular', tags = [], minPlan = '' } = {}) {
    const catalog = await this.getCatalog();
    let results = catalog;

    if (query) {
      const q = query.toLowerCase();
      results = results.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        (a.tags || []).some(t => t.toLowerCase().includes(q)) ||
        (a.author?.name || '').toLowerCase().includes(q)
      );
    }

    if (type) {
      results = results.filter(a => a.type === type);
    }

    if (category) {
      results = results.filter(a => a.category === category);
    }

    if (tags.length) {
      results = results.filter(a => tags.every(t => (a.tags || []).includes(t)));
    }

    // Sort
    switch (sort) {
      case 'popular':
        results.sort((a, b) => (b.stats?.installs || 0) - (a.stats?.installs || 0));
        break;
      case 'newest':
        results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        break;
      case 'updated':
        results.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        break;
      case 'rating':
        results.sort((a, b) => (b.stats?.rating || 0) - (a.stats?.rating || 0));
        break;
      case 'name':
        results.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }

    return results;
  },

  /**
   * Get a single asset by ID or slug.
   * @param {string} idOrSlug
   * @returns {Promise<CloudAsset|null>}
   */
  async getAsset(idOrSlug) {
    const catalog = await this.getCatalog();
    return catalog.find(a => a.assetId === idOrSlug || a.slug === idOrSlug || a.id === idOrSlug) || null;
  },

  /**
   * Get all categories from the catalog.
   * @returns {Promise<string[]>}
   */
  async getCategories() {
    const catalog = await this.getCatalog();
    const cats = new Set(catalog.map(a => a.category).filter(Boolean));
    return Array.from(cats).sort();
  },

  // ── Installation ───────────────────────────────────────────────────────────

  /**
   * Install an asset into the current project.
   * Full flow: license check → entitlement check → dependency resolution →
   *            integrity check → install → record purchase.
   *
   * @param {string} assetId
   * @param {{ version?: string, config?: object }} opts
   * @returns {Promise<InstallResult>}
   */
  async install(assetId, opts = {}) {
    const asset = await this.getAsset(assetId);
    if (!asset) throw new Error(`Asset not found: ${assetId}`);

    // 1. Check license
    const licenseCheck = await licenseEngine.checkAccess(asset, _userId);
    if (!licenseCheck.allowed) {
      return { success: false, reason: 'license', message: licenseCheck.message, asset };
    }

    // 2. Check entitlement (plan-based)
    const entitlementCheck = await revenueEngine.checkEntitlement(asset, _userId);
    if (!entitlementCheck.allowed) {
      return { success: false, reason: 'entitlement', message: entitlementCheck.message, asset, upgradeRequired: entitlementCheck.requiredPlan };
    }

    // 3. Resolve version
    const targetVersion = opts.version || asset.latestVersion;
    const versionSpec   = await versionResolver.resolve(asset, targetVersion);
    if (!versionSpec) {
      return { success: false, reason: 'version', message: `Version ${targetVersion} not found for ${asset.name}` };
    }

    // 4. Check compatibility
    const compatCheck = versionResolver.checkCompatibility(versionSpec, NUVRA_VERSION);
    if (!compatCheck.compatible) {
      return { success: false, reason: 'compatibility', message: compatCheck.message };
    }

    // 5. Resolve dependencies
    const deps = await versionResolver.resolveDependencies(versionSpec, this);
    if (deps.missing.length) {
      return { success: false, reason: 'dependencies', message: `Missing dependencies: ${deps.missing.join(', ')}`, missingDeps: deps.missing };
    }

    // 6. Integrity check
    const integrityOk = await trustEngine.verifyAsset(asset, versionSpec);
    if (!integrityOk) {
      return { success: false, reason: 'integrity', message: 'Asset integrity check failed. The asset may have been tampered with.' };
    }

    // 7. Install
    await assetRegistry.install(asset, versionSpec, { projectId: _projectId, config: opts.config || {} });

    // 8. Record purchase/install
    await revenueEngine.recordInstall(asset, _userId, { version: targetVersion });

    // 9. Emit event
    this._emit('asset.installed', { asset, version: targetVersion, projectId: _projectId });

    return { success: true, asset, version: targetVersion, dependencies: deps.resolved };
  },

  /**
   * Update an installed asset to a newer version.
   * @param {string} assetId
   * @param {{ version?: string }} opts
   * @returns {Promise<UpdateResult>}
   */
  async update(assetId, opts = {}) {
    const installed = assetRegistry.getInstalled(assetId);
    if (!installed) throw new Error(`Asset ${assetId} is not installed`);

    const asset = await this.getAsset(assetId);
    if (!asset) throw new Error(`Asset not found in catalog: ${assetId}`);

    const targetVersion = opts.version || asset.latestVersion;
    if (targetVersion === installed.version) {
      return { success: true, message: 'Already up to date', version: targetVersion };
    }

    // Snapshot current version for rollback
    await assetRegistry.snapshotForRollback(assetId);

    // Re-run install with the new version
    const result = await this.install(assetId, { version: targetVersion, config: installed.config });
    if (result.success) {
      this._emit('asset.updated', { assetId, from: installed.version, to: targetVersion });
    }
    return result;
  },

  /**
   * Roll back an asset to its previous version.
   * @param {string} assetId
   * @returns {Promise<RollbackResult>}
   */
  async rollback(assetId) {
    const result = await assetRegistry.rollback(assetId);
    if (result.success) {
      this._emit('asset.rolledBack', { assetId, version: result.version });
    }
    return result;
  },

  /**
   * Remove an installed asset.
   * @param {string} assetId
   * @returns {Promise<void>}
   */
  async remove(assetId) {
    await assetRegistry.remove(assetId, _projectId);
    this._emit('asset.removed', { assetId, projectId: _projectId });
  },

  // ── Installed Assets ───────────────────────────────────────────────────────

  /**
   * Get all installed assets for the current project.
   * @returns {InstalledAsset[]}
   */
  getInstalled() {
    return assetRegistry.getInstalledForProject(_projectId);
  },

  /**
   * Check if an asset is installed.
   * @param {string} assetId
   * @returns {boolean}
   */
  isInstalled(assetId) {
    return assetRegistry.isInstalled(assetId, _projectId);
  },

  /**
   * Check for available updates across all installed assets.
   * @returns {Promise<UpdateAvailable[]>}
   */
  async checkForUpdates() {
    const installed = this.getInstalled();
    const updates   = [];
    for (const inst of installed) {
      const asset = await this.getAsset(inst.assetId);
      if (asset && versionResolver.isNewer(asset.latestVersion, inst.version)) {
        updates.push({ assetId: inst.assetId, name: asset.name, currentVersion: inst.version, latestVersion: asset.latestVersion });
      }
    }
    return updates;
  },

  /**
   * Validate the full asset graph for the current project.
   * Returns warnings for missing or outdated dependencies.
   * @returns {Promise<AssetGraphReport>}
   */
  async validateAssetGraph() {
    const installed = this.getInstalled();
    const warnings  = [];
    const errors    = [];

    for (const inst of installed) {
      const asset = await this.getAsset(inst.assetId);
      if (!asset) {
        errors.push({ assetId: inst.assetId, message: 'Asset no longer in catalog' });
        continue;
      }

      const versionSpec = await versionResolver.resolve(asset, inst.version);
      if (!versionSpec) {
        warnings.push({ assetId: inst.assetId, message: `Version ${inst.version} no longer available` });
        continue;
      }

      const compat = versionResolver.checkCompatibility(versionSpec, NUVRA_VERSION);
      if (!compat.compatible) {
        errors.push({ assetId: inst.assetId, message: compat.message });
      }

      const deps = await versionResolver.resolveDependencies(versionSpec, this);
      for (const missing of deps.missing) {
        warnings.push({ assetId: inst.assetId, message: `Missing dependency: ${missing}` });
      }
    }

    return { valid: errors.length === 0, warnings, errors, installedCount: installed.length };
  },

  // ── Events ─────────────────────────────────────────────────────────────────

  on(event, fn) {
    if (!_listeners.has(event)) _listeners.set(event, new Set());
    _listeners.get(event).add(fn);
    return () => _listeners.get(event)?.delete(fn);
  },

  _emit(event, data) {
    _listeners.get(event)?.forEach(fn => { try { fn(data); } catch {} });
    document.dispatchEvent(new CustomEvent(`nuvra:marketplace:${event}`, { detail: data }));
  },
};

// ─── Private Helpers ──────────────────────────────────────────────────────────

async function _fetchCloudCatalog() {
  // In production this would call the Supabase marketplace API.
  // For now, we simulate a cloud response by extending the local catalog
  // with cloud-specific fields (pricing, stats, trust signals).
  const local = await _fetchLocalCatalog();
  return local.map(a => ({
    ...a,
    source: 'cloud',
    stats: {
      installs: Math.floor(Math.random() * 10000),
      rating:   (3.5 + Math.random() * 1.5).toFixed(1),
      reviews:  Math.floor(Math.random() * 500),
    },
    trust: {
      verified: a.author === 'Nuvra Team',
      score:    a.author === 'Nuvra Team' ? 100 : 75,
      flags:    [],
    },
  }));
}

async function _fetchLocalCatalog() {
  try {
    const response = await fetch('./src/marketplace/catalog.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? data : (data.assets || []);
  } catch {
    // Try the cached version
    try {
      const cached = JSON.parse(localStorage.getItem(CATALOG_CACHE_KEY) || '{}');
      return cached.assets || [];
    } catch {
      return [];
    }
  }
}

function _normaliseAsset(raw) {
  return {
    assetId:         raw.assetId || raw.id || `local-${raw.slug || raw.name}`,
    slug:            raw.slug || _slugify(raw.name || ''),
    name:            raw.name || 'Unnamed Asset',
    description:     raw.description || '',
    longDescription: raw.longDescription || raw.description || '',
    type:            raw.type || 'plugin',
    category:        raw.category || 'General',
    tags:            raw.tags || [],
    author:          typeof raw.author === 'string'
                       ? { name: raw.author, verified: raw.author === 'Nuvra Team' }
                       : (raw.author || { name: 'Unknown' }),
    versions:        raw.versions || [{ version: raw.version || '1.0.0', bundle: raw.bundle, bundleUrl: raw.bundleUrl }],
    latestVersion:   raw.latestVersion || raw.version || '1.0.0',
    pricing:         raw.pricing || { model: 'free', price: 0, currency: 'USD' },
    license:         raw.license || { type: 'MIT', commercial: true },
    compatibility:   raw.compatibility || { minNuvraVersion: raw.minNuvraVersion || '1.0.0', targets: ['web', 'mobile'] },
    stats:           raw.stats || { installs: 0, rating: 0, reviews: 0 },
    trust:           raw.trust || { verified: false, score: 50, flags: [] },
    screenshots:     raw.screenshots || [],
    permissions:     raw.permissions || [],
    bundle:          raw.bundle || null,
    bundleUrl:       raw.bundleUrl || null,
    createdAt:       raw.createdAt || new Date().toISOString(),
    updatedAt:       raw.updatedAt || new Date().toISOString(),
    source:          raw.source || 'local',
  };
}

function _slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
