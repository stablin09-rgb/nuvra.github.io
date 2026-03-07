/**
 * Nuvra — domainManager.js (Phase 13)
 *
 * Manages all domain routing for deployed projects.
 *
 * Features:
 *  - Nuvra subdomains: {slug}.nuvra.app (automatic, no setup)
 *  - Custom domains: user-provided, with DNS verification
 *  - HTTPS: automatic via the hosting provider
 *  - Route configuration: per-page path routing
 *  - Environment routing: production vs. preview URLs
 *
 * Domain Verification Flow:
 *  1. User adds a custom domain
 *  2. System generates a DNS TXT verification record
 *  3. User adds the TXT record to their DNS provider
 *  4. System polls for DNS propagation
 *  5. Domain is marked as verified and routing is activated
 *
 * @module domainManager
 */
'use strict';

const STORAGE_KEY = (projectId) => `nuvra-domains-${projectId}`;
const NUVRA_SUBDOMAIN_BASE = 'nuvra.app';

// ─── DomainManager ────────────────────────────────────────────────────────────

class DomainManager {

  // ─── Custom Domain Management ────────────────────────────────────────────────

  /**
   * Add a custom domain to a project.
   * Returns a DNS verification record the user must add.
   *
   * @param {string} projectId
   * @param {string} domain - e.g. "myapp.com"
   * @returns {Promise<DomainRecord>}
   */
  async addCustomDomain(projectId, domain) {
    const domains = this._load(projectId);
    const normalized = domain.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/$/, '');

    if (domains.find(d => d.domain === normalized)) {
      return { ok: false, error: 'Domain already added.' };
    }

    const verificationToken = _uuid().replace(/-/g, '').slice(0, 24);
    const record = {
      id:                _uuid(),
      domain:            normalized,
      status:            'pending_verification',
      verificationToken,
      dnsRecord: {
        type:  'TXT',
        name:  `_nuvra-verify.${normalized}`,
        value: `nuvra-verify=${verificationToken}`,
      },
      httpsEnabled:  false,
      isPrimary:     domains.length === 0,
      addedAt:       new Date().toISOString(),
      verifiedAt:    null,
    };

    domains.push(record);
    this._save(projectId, domains);

    // Persist to cloud if available
    await this._syncToCloud(projectId, record, 'add');

    return { ok: true, record };
  }

  /**
   * Remove a custom domain from a project.
   */
  async removeCustomDomain(projectId, domain) {
    const domains = this._load(projectId);
    const idx = domains.findIndex(d => d.domain === domain);
    if (idx === -1) return { ok: false, error: 'Domain not found.' };

    const [removed] = domains.splice(idx, 1);
    this._save(projectId, domains);
    await this._syncToCloud(projectId, removed, 'remove');

    return { ok: true };
  }

  /**
   * Check DNS verification status for a domain.
   * In production, this would call a server-side DNS lookup.
   * Here we simulate it and allow manual verification.
   */
  async checkVerification(projectId, domain) {
    const domains = this._load(projectId);
    const record = domains.find(d => d.domain === domain);
    if (!record) return { ok: false, error: 'Domain not found.' };

    // In production: call an Edge Function to do a real DNS TXT lookup
    // For now, simulate: after 30s, mark as verified
    const addedMs = new Date(record.addedAt).getTime();
    const isVerified = (Date.now() - addedMs) > 30_000;

    if (isVerified && record.status === 'pending_verification') {
      record.status     = 'active';
      record.verifiedAt = new Date().toISOString();
      record.httpsEnabled = true;
      this._save(projectId, domains);
      await this._syncToCloud(projectId, record, 'verify');
    }

    return { ok: true, record };
  }

  /**
   * Set a domain as the primary domain for a project.
   */
  setPrimaryDomain(projectId, domain) {
    const domains = this._load(projectId);
    for (const d of domains) d.isPrimary = (d.domain === domain);
    this._save(projectId, domains);
  }

  /**
   * Get all custom domains for a project.
   */
  getCustomDomains(projectId) {
    return this._load(projectId);
  }

  /**
   * Get the primary URL for a project (custom domain if set, else Nuvra subdomain).
   */
  getPrimaryUrl(projectId, slug) {
    const domains = this._load(projectId);
    const primary = domains.find(d => d.isPrimary && d.status === 'active');
    if (primary) return `https://${primary.domain}`;
    return `https://${slug || projectId.slice(0, 8)}.${NUVRA_SUBDOMAIN_BASE}`;
  }

  // ─── Deploy Binding ──────────────────────────────────────────────────────────

  /**
   * Bind a new deployment to all active domains for this project.
   * Called after a successful deploy activation.
   */
  async bindDeployment({ projectId, deployId, liveUrl, environment }) {
    const domains = this._load(projectId);
    const activeDomains = domains.filter(d => d.status === 'active');

    // In production: call an Edge Function to update routing rules
    // For now: store the binding locally
    for (const domain of activeDomains) {
      domain.currentDeployId = deployId;
      domain.currentLiveUrl  = liveUrl;
      domain.lastDeployedAt  = new Date().toISOString();
    }

    if (activeDomains.length > 0) {
      this._save(projectId, domains);
    }

    return { ok: true, boundDomains: activeDomains.map(d => d.domain) };
  }

  // ─── Route Configuration ─────────────────────────────────────────────────────

  /**
   * Get the route configuration for a project.
   * Maps page paths to their serving rules.
   */
  getRouteConfig(projectId, pages) {
    return pages.map((page, i) => ({
      path:     i === 0 ? '/' : `/${(page.slug || page.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}/`,
      file:     i === 0 ? 'index.html' : `${(page.slug || page.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}/index.html`,
      pageName: page.name,
      isHome:   i === 0,
    }));
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  _load(projectId) {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY(projectId)) || '[]');
    } catch { return []; }
  }

  _save(projectId, domains) {
    try {
      localStorage.setItem(STORAGE_KEY(projectId), JSON.stringify(domains));
    } catch { /* Storage full */ }
  }

  async _syncToCloud(projectId, record, action) {
    try {
      const { supabase } = await import('../cloud/cloud.js');
      if (!supabase) return;

      if (action === 'add' || action === 'verify') {
        await supabase.from('nuvra_domains').upsert({
          id:         record.id,
          project_id: projectId,
          domain:     record.domain,
          status:     record.status,
          is_primary: record.isPrimary,
          verified_at: record.verifiedAt,
        });
      } else if (action === 'remove') {
        await supabase.from('nuvra_domains').delete().eq('id', record.id);
      }
    } catch { /* Non-fatal */ }
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function _uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const domainManager = new DomainManager();
