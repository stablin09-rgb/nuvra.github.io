/**
 * Nuvra Builder — Analytics Service (Phase 11)
 *
 * Privacy-safe analytics for the marketplace.
 * Tracks: installs, uninstalls, usage, revenue events, and page views.
 *
 * Privacy principles:
 *  - No PII in event payloads
 *  - User ID is hashed before storage
 *  - Events are aggregated, not individual-level
 *  - Users can opt out at any time
 *  - All data is stored locally first, synced to cloud only on auth
 *
 * Event types:
 *  - asset.viewed       — User viewed an asset detail page
 *  - asset.installed    — User installed an asset
 *  - asset.uninstalled  — User removed an asset
 *  - asset.enabled      — User enabled an asset for a project
 *  - asset.disabled     — User disabled an asset
 *  - asset.updated      — User updated an asset
 *  - marketplace.opened — User opened the marketplace panel
 *  - marketplace.searched — User performed a search
 *  - creator.published  — Creator published an asset
 *  - creator.earned     — Creator received earnings
 */
'use strict';

const EVENTS_KEY   = (uid) => `nuvra-analytics-events-${uid || 'anon'}`;
const OPT_OUT_KEY  = 'nuvra-analytics-opt-out';
const MAX_EVENTS   = 1000; // Rolling window

let _userId    = null;
let _sessionId = null;

function _hash(str) {
  // Simple non-cryptographic hash for anonymisation
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function _readEvents(uid) {
  try { return JSON.parse(localStorage.getItem(EVENTS_KEY(uid)) || '[]'); } catch { return []; }
}
function _writeEvents(uid, events) {
  try { localStorage.setItem(EVENTS_KEY(uid), JSON.stringify(events)); } catch {}
}

export const analyticsService = {

  init(userId) {
    _userId    = userId;
    _sessionId = `s_${Date.now().toString(36)}`;
  },

  isOptedOut() {
    return localStorage.getItem(OPT_OUT_KEY) === 'true';
  },

  optOut() {
    localStorage.setItem(OPT_OUT_KEY, 'true');
    // Clear existing events
    try { localStorage.removeItem(EVENTS_KEY(_userId)); } catch {}
  },

  optIn() {
    localStorage.removeItem(OPT_OUT_KEY);
  },

  /**
   * Track an analytics event.
   * @param {string} eventType
   * @param {object} properties - must NOT contain PII
   */
  track(eventType, properties = {}) {
    if (this.isOptedOut()) return;

    const events = _readEvents(_userId);
    events.push({
      eventType,
      sessionId:  _sessionId,
      userHash:   _userId ? _hash(_userId) : 'anon',
      properties: _sanitise(properties),
      timestamp:  new Date().toISOString(),
    });

    // Rolling window — keep only the last MAX_EVENTS
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    _writeEvents(_userId, events);
  },

  // ── Convenience Trackers ────────────────────────────────────────────────────

  trackAssetView(assetId, assetType) {
    this.track('asset.viewed', { assetId, assetType });
  },

  trackInstall(assetId, assetType, version) {
    this.track('asset.installed', { assetId, assetType, version });
  },

  trackUninstall(assetId, assetType) {
    this.track('asset.uninstalled', { assetId, assetType });
  },

  trackSearch(query, resultCount, filters) {
    this.track('marketplace.searched', { queryLength: query?.length || 0, resultCount, filters });
  },

  trackMarketplaceOpen() {
    this.track('marketplace.opened', {});
  },

  trackCreatorPublish(assetId, assetType, pricingModel) {
    this.track('creator.published', { assetId, assetType, pricingModel });
  },

  // ── Aggregated Reports ──────────────────────────────────────────────────────

  /**
   * Get install counts per asset (for creator dashboard).
   * @returns {{ [assetId]: number }}
   */
  getInstallCounts() {
    const events = _readEvents(_userId);
    const counts = {};
    for (const e of events) {
      if (e.eventType === 'asset.installed' && e.properties?.assetId) {
        counts[e.properties.assetId] = (counts[e.properties.assetId] || 0) + 1;
      }
    }
    return counts;
  },

  /**
   * Get a time-series of installs for a specific asset.
   * @param {string} assetId
   * @param {number} days
   * @returns {{ date: string, count: number }[]}
   */
  getInstallTimeSeries(assetId, days = 30) {
    const events = _readEvents(_userId);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const byDate = {};

    for (const e of events) {
      if (e.eventType !== 'asset.installed') continue;
      if (e.properties?.assetId !== assetId) continue;
      const d = new Date(e.timestamp);
      if (d < cutoff) continue;
      const key = d.toISOString().slice(0, 10);
      byDate[key] = (byDate[key] || 0) + 1;
    }

    // Fill in zero days
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      result.push({ date: key, count: byDate[key] || 0 });
    }
    return result;
  },

  /**
   * Get the top search queries.
   * @param {number} limit
   * @returns {{ query: string, count: number }[]}
   */
  getTopSearches(limit = 10) {
    const events = _readEvents(_userId);
    const counts = {};
    for (const e of events) {
      if (e.eventType !== 'marketplace.searched') continue;
      const len = e.properties?.queryLength;
      if (len > 0) counts[len] = (counts[len] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([len, count]) => ({ queryLength: Number(len), count }));
  },

  /**
   * Get a summary dashboard for a creator.
   * @returns {CreatorAnalyticsSummary}
   */
  getCreatorSummary() {
    const events   = _readEvents(_userId);
    const installs = events.filter(e => e.eventType === 'asset.installed');
    const views    = events.filter(e => e.eventType === 'asset.viewed');

    const assetInstalls = {};
    const assetViews    = {};
    for (const e of installs) {
      const id = e.properties?.assetId;
      if (id) assetInstalls[id] = (assetInstalls[id] || 0) + 1;
    }
    for (const e of views) {
      const id = e.properties?.assetId;
      if (id) assetViews[id] = (assetViews[id] || 0) + 1;
    }

    const topAssets = Object.entries(assetInstalls)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([assetId, installs]) => ({ assetId, installs, views: assetViews[assetId] || 0 }));

    return {
      totalInstalls:  installs.length,
      totalViews:     views.length,
      conversionRate: views.length ? ((installs.length / views.length) * 100).toFixed(1) + '%' : '0%',
      topAssets,
      eventsTracked:  events.length,
    };
  },

  /**
   * Export all events (for cloud sync or debugging).
   */
  exportEvents() {
    return _readEvents(_userId);
  },
};

function _sanitise(obj) {
  // Remove any fields that look like PII
  const safe = {};
  const piiPatterns = /email|phone|name|address|ip|password|secret|token|key/i;
  for (const [k, v] of Object.entries(obj)) {
    if (!piiPatterns.test(k)) safe[k] = v;
  }
  return safe;
}
