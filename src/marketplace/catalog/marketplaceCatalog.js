'use strict';

/**
 * marketplaceCatalog.js — Nuvra Phase 8
 *
 * The Marketplace Catalog. The authoritative source of available extensions.
 *
 * Responsibilities:
 * - Store and index extension listings
 * - Version management: multiple versions per extension, latest resolution
 * - Compatibility matrix: which extension versions work with which Nuvra versions
 * - Trust tier management: verified, community, experimental
 * - Search, filter, and sort
 * - Featured and curated collections
 *
 * In production, this would be backed by a cloud API. In this implementation,
 * it is a local in-memory catalog that can be hydrated from a JSON feed.
 */

const { TrustTier } = require('../../extensions/manifest/extensionTypes');
const { NUVRA_CURRENT_VERSION } = require('../../extensions/manifest/manifestValidator');

// ─── Listing Record ───────────────────────────────────────────────────────────

function makeListingRecord(data) {
  return {
    id:           data.id,
    name:         data.name,
    description:  data.description,
    author:       data.author,
    authorEmail:  data.authorEmail  || null,
    authorUrl:    data.authorUrl    || null,
    type:         data.type,
    categories:   data.categories   || [],
    tags:         data.tags         || [],
    trustTier:    data.trustTier    || TrustTier.COMMUNITY,
    pricing:      data.pricing      || { model: 'free' },
    billingImpact:data.billingImpact || 'none',
    iconUrl:      data.iconUrl      || null,
    screenshotUrls: data.screenshotUrls || [],
    repositoryUrl:  data.repositoryUrl  || null,
    documentationUrl: data.documentationUrl || null,
    // Version history: array of { version, manifest, downloadUrl, publishedAt, nuvraCoreVersion, changelog }
    versions:     data.versions     || [],
    latestVersion:data.latestVersion || null,
    // Stats
    installCount: data.installCount || 0,
    rating:       data.rating       || null, // 0-5
    reviewCount:  data.reviewCount  || 0,
    // Status
    status:       data.status       || 'published', // published | deprecated | removed
    featuredAt:   data.featuredAt   || null,
    publishedAt:  data.publishedAt  || new Date().toISOString(),
    updatedAt:    data.updatedAt    || new Date().toISOString(),
  };
}

// ─── MarketplaceCatalog ───────────────────────────────────────────────────────

class MarketplaceCatalog {
  /**
   * @param {object} [options]
   * @param {string} [options.nuvraCoreVersion] - The current Nuvra core version for compatibility checks
   * @param {object} [options.logger]
   */
  constructor({ nuvraCoreVersion = NUVRA_CURRENT_VERSION, logger = null } = {}) {
    this._coreVersion = nuvraCoreVersion;
    this._logger      = logger;
    this._listings    = new Map(); // extensionId → ListingRecord
    this._categories  = new Map(); // category → Set<extensionId>
    this._featured    = [];        // extensionId[]
  }

  // ─── Publish / Update ────────────────────────────────────────────────────

  /**
   * Publishes a new extension or updates an existing one.
   * @param {object} data - Listing data
   * @returns {{ ok: boolean, id?: string, error?: string }}
   */
  publish(data) {
    if (!data.id || !data.name || !data.type) {
      return { ok: false, error: 'Missing required fields: id, name, type' };
    }

    const existing = this._listings.get(data.id);
    if (existing) {
      // Update existing listing
      const updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
      this._listings.set(data.id, updated);
      this._indexCategories(updated);
      this._log('info', `Updated listing: ${data.id}`);
    } else {
      const listing = makeListingRecord(data);
      this._listings.set(data.id, listing);
      this._indexCategories(listing);
      this._log('info', `Published listing: ${data.id}`);
    }

    return { ok: true, id: data.id };
  }

  /**
   * Adds a new version to an existing listing.
   * @param {string} extensionId
   * @param {object} versionData - { version, manifest, downloadUrl, nuvraCoreVersion, changelog }
   * @returns {{ ok: boolean, error?: string }}
   */
  publishVersion(extensionId, versionData) {
    const listing = this._listings.get(extensionId);
    if (!listing) {
      return { ok: false, error: `Extension "${extensionId}" not found in catalog` };
    }

    const versionEntry = {
      version:          versionData.version,
      manifest:         versionData.manifest,
      downloadUrl:      versionData.downloadUrl,
      nuvraCoreVersion: versionData.nuvraCoreVersion,
      changelog:        versionData.changelog || '',
      publishedAt:      new Date().toISOString(),
    };

    listing.versions.push(versionEntry);
    listing.latestVersion = versionData.version;
    listing.updatedAt     = new Date().toISOString();

    this._log('info', `Published version ${versionData.version} for ${extensionId}`);
    return { ok: true };
  }

  // ─── Trust Tier Management ────────────────────────────────────────────────

  /**
   * Sets the trust tier for an extension (platform admin only).
   * @param {string} extensionId
   * @param {string} tier - TrustTier value
   * @returns {{ ok: boolean, error?: string }}
   */
  setTrustTier(extensionId, tier) {
    const listing = this._listings.get(extensionId);
    if (!listing) return { ok: false, error: `Extension "${extensionId}" not found` };
    const validTiers = Object.values(TrustTier);
    if (!validTiers.includes(tier)) {
      return { ok: false, error: `Invalid trust tier: "${tier}"` };
    }
    listing.trustTier  = tier;
    listing.updatedAt  = new Date().toISOString();
    return { ok: true };
  }

  // ─── Compatibility Matrix ─────────────────────────────────────────────────

  /**
   * Returns the compatible versions of an extension for the current Nuvra version.
   * @param {string} extensionId
   * @returns {object[]} Compatible version entries
   */
  getCompatibleVersions(extensionId) {
    const listing = this._listings.get(extensionId);
    if (!listing) return [];
    return listing.versions.filter(v => this._isCompatible(v.nuvraCoreVersion));
  }

  /**
   * Returns the latest compatible version of an extension.
   * @param {string} extensionId
   * @returns {object|null}
   */
  getLatestCompatibleVersion(extensionId) {
    const compatible = this.getCompatibleVersions(extensionId);
    if (compatible.length === 0) return null;
    // Sort by version descending (simple string sort works for semver with same major)
    return compatible.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
  }

  /**
   * Checks if a nuvraCoreVersion range string is compatible with the current version.
   * Supports simple range patterns: ">=7.0.0", ">=7.0.0 <9.0.0", "^8.0.0"
   * @param {string} rangeStr
   * @returns {boolean}
   */
  _isCompatible(rangeStr) {
    if (!rangeStr) return true;
    const [major] = this._coreVersion.split('.').map(Number);

    // Handle "^X.Y.Z" — compatible with same major
    if (rangeStr.startsWith('^')) {
      const [reqMajor] = rangeStr.slice(1).split('.').map(Number);
      return major === reqMajor;
    }

    // Handle ">=X.Y.Z <A.B.C" — range
    const parts = rangeStr.split(' ').filter(Boolean);
    for (const part of parts) {
      if (part.startsWith('>=')) {
        const [reqMajor] = part.slice(2).split('.').map(Number);
        if (major < reqMajor) return false;
      } else if (part.startsWith('<')) {
        const [reqMajor] = part.slice(1).split('.').map(Number);
        if (major >= reqMajor) return false;
      } else if (part.startsWith('<=')) {
        const [reqMajor] = part.slice(2).split('.').map(Number);
        if (major > reqMajor) return false;
      }
    }
    return true;
  }

  // ─── Search & Filter ─────────────────────────────────────────────────────

  /**
   * Searches the catalog.
   * @param {object} [query]
   * @param {string}   [query.q]          - Text search (name, description, tags)
   * @param {string}   [query.type]       - Filter by extension type
   * @param {string}   [query.category]   - Filter by category
   * @param {string}   [query.trustTier]  - Filter by trust tier
   * @param {string}   [query.pricing]    - Filter by pricing model
   * @param {boolean}  [query.compatible] - Only return compatible extensions
   * @param {string}   [query.sortBy]     - 'installs' | 'rating' | 'updated' | 'name'
   * @param {number}   [query.limit]      - Max results
   * @param {number}   [query.offset]     - Pagination offset
   * @returns {{ results: object[], total: number }}
   */
  search(query = {}) {
    let results = [...this._listings.values()].filter(l => l.status === 'published');

    if (query.q) {
      const q = query.q.toLowerCase();
      results = results.filter(l =>
        l.name.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q) ||
        l.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    if (query.type)      results = results.filter(l => l.type      === query.type);
    if (query.category)  results = results.filter(l => l.categories.includes(query.category));
    if (query.trustTier) results = results.filter(l => l.trustTier === query.trustTier);
    if (query.pricing)   results = results.filter(l => l.pricing?.model === query.pricing);

    if (query.compatible) {
      results = results.filter(l => this.getCompatibleVersions(l.id).length > 0);
    }

    // Sort
    const sortBy = query.sortBy || 'installs';
    results.sort((a, b) => {
      if (sortBy === 'installs') return b.installCount - a.installCount;
      if (sortBy === 'rating')   return (b.rating || 0) - (a.rating || 0);
      if (sortBy === 'updated')  return b.updatedAt.localeCompare(a.updatedAt);
      if (sortBy === 'name')     return a.name.localeCompare(b.name);
      return 0;
    });

    const total   = results.length;
    const offset  = query.offset || 0;
    const limit   = query.limit  || 20;
    const paged   = results.slice(offset, offset + limit);

    return { results: paged, total };
  }

  /**
   * Returns featured extensions.
   * @returns {object[]}
   */
  getFeatured() {
    return this._featured
      .map(id => this._listings.get(id))
      .filter(Boolean);
  }

  /**
   * Sets the featured extensions list.
   * @param {string[]} extensionIds
   */
  setFeatured(extensionIds) {
    this._featured = extensionIds;
  }

  // ─── Getters ─────────────────────────────────────────────────────────────

  getById(extensionId) {
    return this._listings.get(extensionId) ?? null;
  }

  getAll() {
    return [...this._listings.values()];
  }

  getAllCategories() {
    return [...this._categories.keys()].sort();
  }

  getCount() {
    return this._listings.size;
  }

  // ─── Hydration ────────────────────────────────────────────────────────────

  /**
   * Hydrates the catalog from a JSON feed (array of listing objects).
   * @param {object[]} listings
   */
  hydrate(listings) {
    for (const listing of listings) {
      this.publish(listing);
    }
    this._log('info', `Catalog hydrated with ${listings.length} listings`);
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  _indexCategories(listing) {
    for (const cat of listing.categories) {
      if (!this._categories.has(cat)) this._categories.set(cat, new Set());
      this._categories.get(cat).add(listing.id);
    }
  }

  _log(level, message) {
    if (this._logger) this._logger[level]?.(`[MarketplaceCatalog] ${message}`);
  }
}

export { MarketplaceCatalog };
export default MarketplaceCatalog;
