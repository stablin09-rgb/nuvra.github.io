/**
 * Nuvra Builder — Marketplace Store UI (Phase 11)
 *
 * The full marketplace panel with:
 *  - Discover tab (AI-recommended + featured + trending)
 *  - Browse tab (all assets, filterable by type/category/price)
 *  - Blueprints tab (Store Blueprints with config installer)
 *  - Installed tab (manage installed assets)
 *  - Creator tab (publish assets, view earnings)
 *
 * This replaces the Phase 10 marketplaceUI.js with a full cloud-connected version.
 */
'use strict';

import { marketplaceService }  from '../cloud/marketplaceService.js';
import { assetRegistry }       from '../cloud/assetRegistry.js';
import { licenseEngine }       from '../cloud/licenseEngine.js';
import { revenueEngine }       from '../cloud/revenueEngine.js';
import { analyticsService }    from '../cloud/analyticsService.js';
import { marketplaceAdvisor }  from '../ai/marketplaceAdvisor.js';
import { trustEngine }         from '../governance/trust/trustEngine.js';
import { blueprintRegistry }   from '../blueprints/blueprintRegistry.js';
import { blueprintInstaller }  from '../blueprints/blueprintInstaller.js';
import { creatorService }      from '../cloud/creatorService.js';
import { versionResolver }     from '../cloud/versionResolver.js';

let _activeTab      = 'discover';
let _searchQuery    = '';
let _typeFilter     = 'all';
let _priceFilter    = 'all';
let _catalog        = [];
let _recommendations = [];
let _userId         = null;
let _projectId      = null;
let _userPlan       = 'free';
let _onProjectOpen  = null;

const NUVRA_VERSION = '11.0.0';

export const marketplaceStore = {

  init({ userId, projectId, userPlan = 'free', onProjectOpen } = {}) {
    _userId       = userId;
    _projectId    = projectId;
    _userPlan     = userPlan;
    _onProjectOpen = onProjectOpen;
    _injectStyles();
    _buildPanel();
  },

  setProject(projectId) {
    _projectId = projectId;
  },

  setUserPlan(plan) {
    _userPlan = plan;
  },

  async open() {
    const panel = document.getElementById('nv-marketplace-store');
    if (!panel) return;
    panel.classList.add('open');
    analyticsService.trackMarketplaceOpen();
    await this.refresh();
  },

  close() {
    const panel = document.getElementById('nv-marketplace-store');
    if (panel) panel.classList.remove('open');
  },

  async refresh() {
    try {
      _catalog = await marketplaceService.getCatalog();
    } catch {
      _catalog = [];
    }

    // Get AI recommendations
    const installed = assetRegistry.getAllInstalled().map(a => a.assetId);
    try {
      _recommendations = await marketplaceAdvisor.getPersonalisedRecommendations({
        installedAssets: installed,
        userPlan: _userPlan,
      });
    } catch {
      _recommendations = [];
    }

    _renderActiveTab();
  },
};

// ─── Panel Builder ────────────────────────────────────────────────────────────

function _buildPanel() {
  if (document.getElementById('nv-marketplace-store')) return;

  const panel = document.createElement('div');
  panel.id = 'nv-marketplace-store';
  panel.className = 'nv-mp-store';
  panel.innerHTML = `
    <div class="nv-mp-store-header">
      <div class="nv-mp-store-title">
        <span class="nv-mp-store-icon">🏪</span>
        <span>Nuvra Marketplace</span>
      </div>
      <div class="nv-mp-store-search">
        <input type="text" id="nv-mp-search" placeholder="Search extensions, templates, AI packs…" />
      </div>
      <button class="nv-mp-store-close" id="nv-mp-close">✕</button>
    </div>

    <div class="nv-mp-store-tabs">
      <button class="nv-mp-tab active" data-tab="discover">✨ Discover</button>
      <button class="nv-mp-tab" data-tab="browse">Browse</button>
      <button class="nv-mp-tab" data-tab="blueprints">📐 Blueprints</button>
      <button class="nv-mp-tab" data-tab="installed">Installed</button>
      <button class="nv-mp-tab" data-tab="creator">Creator</button>
    </div>

    <div class="nv-mp-store-filters" id="nv-mp-filters">
      <select id="nv-mp-type-filter">
        <option value="all">All Types</option>
        <option value="template">Templates</option>
        <option value="plugin">Plugins</option>
        <option value="integration">Integrations</option>
        <option value="ai-pack">AI Packs</option>
        <option value="blueprint">Blueprints</option>
      </select>
      <select id="nv-mp-price-filter">
        <option value="all">All Prices</option>
        <option value="free">Free</option>
        <option value="paid">Paid</option>
        <option value="my-plan">Included in my plan</option>
      </select>
    </div>

    <div class="nv-mp-store-body" id="nv-mp-body">
      <div class="nv-mp-loading">Loading marketplace…</div>
    </div>
  `;

  document.body.appendChild(panel);

  // Overlay
  const overlay = document.createElement('div');
  overlay.id = 'nv-mp-overlay';
  overlay.className = 'nv-mp-overlay';
  document.body.appendChild(overlay);

  // Event listeners
  document.getElementById('nv-mp-close').addEventListener('click', () => marketplaceStore.close());
  overlay.addEventListener('click', () => marketplaceStore.close());

  panel.querySelectorAll('.nv-mp-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      panel.querySelectorAll('.nv-mp-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      _activeTab = tab.dataset.tab;
      const filters = document.getElementById('nv-mp-filters');
      if (filters) filters.style.display = _activeTab === 'browse' ? 'flex' : 'none';
      _renderActiveTab();
    });
  });

  document.getElementById('nv-mp-search').addEventListener('input', (e) => {
    _searchQuery = e.target.value;
    _renderActiveTab();
  });

  document.getElementById('nv-mp-type-filter').addEventListener('change', (e) => {
    _typeFilter = e.target.value;
    _renderActiveTab();
  });

  document.getElementById('nv-mp-price-filter').addEventListener('change', (e) => {
    _priceFilter = e.target.value;
    _renderActiveTab();
  });
}

function _renderActiveTab() {
  const body = document.getElementById('nv-mp-body');
  if (!body) return;

  switch (_activeTab) {
    case 'discover':  _renderDiscover(body);   break;
    case 'browse':    _renderBrowse(body);     break;
    case 'blueprints': _renderBlueprints(body); break;
    case 'installed': _renderInstalled(body);  break;
    case 'creator':   _renderCreator(body);    break;
  }
}

// ─── Tab Renderers ────────────────────────────────────────────────────────────

function _renderDiscover(body) {
  const featured = _catalog.filter(a => a.featured).slice(0, 6);
  const trending = [..._catalog].sort((a, b) => (b.stats?.installs || 0) - (a.stats?.installs || 0)).slice(0, 6);

  body.innerHTML = `
    ${_recommendations.length ? `
      <div class="nv-mp-section">
        <h3 class="nv-mp-section-title">✨ Recommended for You</h3>
        <div class="nv-mp-grid">${_recommendations.slice(0, 4).map(_renderAssetCard).join('')}</div>
      </div>
    ` : ''}
    ${featured.length ? `
      <div class="nv-mp-section">
        <h3 class="nv-mp-section-title">⭐ Featured</h3>
        <div class="nv-mp-grid">${featured.map(_renderAssetCard).join('')}</div>
      </div>
    ` : ''}
    <div class="nv-mp-section">
      <h3 class="nv-mp-section-title">🔥 Trending</h3>
      <div class="nv-mp-grid">${trending.length ? trending.map(_renderAssetCard).join('') : '<p class="nv-mp-empty">No assets available yet.</p>'}</div>
    </div>
  `;
  _attachCardListeners(body);
}

function _renderBrowse(body) {
  let assets = _catalog;

  if (_searchQuery) {
    const q = _searchQuery.toLowerCase();
    assets = assets.filter(a =>
      a.name.toLowerCase().includes(q) ||
      (a.description || '').toLowerCase().includes(q) ||
      (a.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }

  if (_typeFilter !== 'all') assets = assets.filter(a => a.type === _typeFilter);

  if (_priceFilter === 'free') assets = assets.filter(a => (a.pricing?.model || 'free') === 'free');
  if (_priceFilter === 'paid') assets = assets.filter(a => (a.pricing?.model || 'free') !== 'free');

  body.innerHTML = assets.length
    ? `<div class="nv-mp-grid">${assets.map(_renderAssetCard).join('')}</div>`
    : `<div class="nv-mp-empty-state"><p>No assets match your search.</p></div>`;

  _attachCardListeners(body);
}

function _renderBlueprints(body) {
  const blueprints = blueprintRegistry.getAll();
  body.innerHTML = `
    <div class="nv-mp-section">
      <p class="nv-mp-section-desc">Blueprints are complete, deployable business templates — pages, data models, and integrations included. Installing a Blueprint creates a new project.</p>
    </div>
    <div class="nv-mp-grid">
      ${blueprints.map(bp => `
        <div class="nv-mp-card nv-mp-blueprint-card" data-blueprint-id="${bp.blueprintId}">
          <div class="nv-mp-card-header">
            <span class="nv-mp-type-badge blueprint">Blueprint</span>
            ${bp.pricing?.model === 'free' ? '<span class="nv-mp-price-badge free">Free</span>' : `<span class="nv-mp-price-badge paid">$${bp.pricing?.price || '?'}</span>`}
          </div>
          <h4 class="nv-mp-card-name">${_esc(bp.name)}</h4>
          <p class="nv-mp-card-desc">${_esc(bp.description || '')}</p>
          <div class="nv-mp-card-meta">
            <span>${(bp.project?.pages || []).length} pages</span>
            <span>${(bp.project?.collections || []).length} collections</span>
            ${bp.author?.verified ? '<span class="nv-mp-verified">✓ Verified</span>' : ''}
          </div>
          <div class="nv-mp-card-actions">
            ${blueprintRegistry.isInstalled(bp.blueprintId)
              ? '<button class="nv-mp-btn-secondary" disabled>✓ Used</button>'
              : `<button class="nv-mp-btn-primary nv-mp-install-blueprint" data-blueprint-id="${bp.blueprintId}">Use Blueprint</button>`
            }
          </div>
        </div>
      `).join('')}
    </div>
  `;

  body.querySelectorAll('.nv-mp-install-blueprint').forEach(btn => {
    btn.addEventListener('click', () => _showBlueprintInstaller(btn.dataset.blueprintId));
  });
}

function _renderInstalled(body) {
  const installed = assetRegistry.getAllInstalled();
  if (!installed.length) {
    body.innerHTML = `<div class="nv-mp-empty-state"><p>No extensions installed yet.</p><p>Browse the marketplace to find extensions for your project.</p></div>`;
    return;
  }

  body.innerHTML = `
    <div class="nv-mp-installed-list">
      ${installed.map(asset => {
        const trust = trustEngine.getTrustScore(asset.assetId);
        return `
          <div class="nv-mp-installed-item" data-asset-id="${asset.assetId}">
            <div class="nv-mp-installed-info">
              <span class="nv-mp-type-badge ${asset.type}">${asset.type}</span>
              <strong>${_esc(asset.name)}</strong>
              <span class="nv-mp-version">v${asset.version}</span>
              ${trust ? `<span class="nv-mp-trust-badge nv-mp-trust-${trust.level}">${trust.badge}</span>` : ''}
            </div>
            <div class="nv-mp-installed-actions">
              <button class="nv-mp-btn-danger nv-mp-remove-asset" data-asset-id="${asset.assetId}">Remove</button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  body.querySelectorAll('.nv-mp-remove-asset').forEach(btn => {
    btn.addEventListener('click', async () => {
      const assetId = btn.dataset.assetId;
      if (confirm('Remove this extension? It will be uninstalled from all projects.')) {
        await assetRegistry.remove(assetId, _projectId);
        analyticsService.track('asset.uninstalled', { assetId });
        await marketplaceStore.refresh();
      }
    });
  });
}

function _renderCreator(body) {
  const isCreator = creatorService.isCreator(_userId);
  if (!isCreator) {
    body.innerHTML = `
      <div class="nv-mp-creator-register">
        <h3>Become a Creator</h3>
        <p>Publish extensions, templates, and AI packs to the Nuvra Marketplace. Earn 80% of every sale.</p>
        <form id="nv-mp-creator-form">
          <input type="text" name="name" placeholder="Display Name" required />
          <input type="text" name="bio" placeholder="Short bio (optional)" />
          <input type="url" name="website" placeholder="Website URL (optional)" />
          <input type="email" name="payoutEmail" placeholder="Payout email" required />
          <button type="submit" class="nv-mp-btn-primary">Register as Creator</button>
        </form>
      </div>
    `;
    body.querySelector('#nv-mp-creator-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      creatorService.registerCreator(Object.fromEntries(fd));
      _renderCreator(body);
    });
    return;
  }

  const profile  = creatorService.getCreatorProfile(_userId);
  const assets   = creatorService.getPublishedAssets();
  const drafts   = creatorService.getAllDrafts();
  const earnings = revenueEngine.getCreatorEarnings(_userId);

  body.innerHTML = `
    <div class="nv-mp-creator-dashboard">
      <div class="nv-mp-creator-header">
        <div>
          <h3>${_esc(profile.name)}</h3>
          <span class="nv-mp-creator-tier">${profile.verified ? '✓ Verified Creator' : 'Standard Creator'}</span>
        </div>
        <div class="nv-mp-creator-stats">
          <div class="nv-mp-stat"><strong>${assets.length}</strong><span>Assets</span></div>
          <div class="nv-mp-stat"><strong>${earnings.totalSales}</strong><span>Sales</span></div>
          <div class="nv-mp-stat"><strong>$${earnings.earnings.toFixed(2)}</strong><span>Earned</span></div>
        </div>
      </div>

      <div class="nv-mp-creator-actions">
        <button class="nv-mp-btn-primary" id="nv-mp-new-draft">+ New Asset</button>
      </div>

      ${drafts.length ? `
        <div class="nv-mp-section">
          <h4>Drafts (${drafts.length})</h4>
          ${drafts.map(d => `
            <div class="nv-mp-draft-item">
              <span>${_esc(d.name || 'Untitled Draft')}</span>
              <span class="nv-mp-draft-status">${d.status}</span>
              <button class="nv-mp-btn-secondary nv-mp-validate-draft" data-draft-id="${d.draftId}">Validate & Publish</button>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${assets.length ? `
        <div class="nv-mp-section">
          <h4>Published Assets (${assets.length})</h4>
          ${assets.map(a => `
            <div class="nv-mp-published-item">
              <span class="nv-mp-type-badge ${a.type}">${a.type}</span>
              <strong>${_esc(a.name)}</strong>
              <span class="nv-mp-version">v${a.latestVersion}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;

  body.getElementById?.('nv-mp-new-draft') || body.querySelector('#nv-mp-new-draft')?.addEventListener('click', () => {
    _showDraftEditor();
  });

  body.querySelectorAll('.nv-mp-validate-draft').forEach(btn => {
    btn.addEventListener('click', async () => {
      const draftId = btn.dataset.draftId;
      btn.textContent = 'Validating…';
      btn.disabled = true;
      const result = await creatorService.validateDraft(draftId);
      if (result.valid) {
        const pub = await creatorService.publishDraft(draftId);
        if (pub.success) {
          alert(`✓ Asset published! ID: ${pub.assetId}`);
          _renderCreator(body);
        }
      } else {
        alert('Validation failed:\n' + result.errors.join('\n'));
        btn.textContent = 'Validate & Publish';
        btn.disabled = false;
      }
    });
  });
}

// ─── Asset Card ───────────────────────────────────────────────────────────────

function _renderAssetCard(asset) {
  const installed = assetRegistry.isInstalled(asset.assetId);
  const trust     = trustEngine.computeTrustScore(asset);
  const pricing   = asset.pricing || { model: 'free' };
  const priceLabel = pricing.model === 'free' ? 'Free'
    : pricing.model === 'one-time' ? `$${pricing.price}`
    : pricing.model === 'subscription' ? `${pricing.requiredPlan || 'Pro'} plan`
    : pricing.model;

  return `
    <div class="nv-mp-card" data-asset-id="${asset.assetId}">
      <div class="nv-mp-card-header">
        <span class="nv-mp-type-badge ${asset.type}">${asset.type}</span>
        <span class="nv-mp-price-badge ${pricing.model === 'free' ? 'free' : 'paid'}">${priceLabel}</span>
      </div>
      <h4 class="nv-mp-card-name">${_esc(asset.name)}</h4>
      <p class="nv-mp-card-desc">${_esc((asset.description || '').slice(0, 80))}${(asset.description || '').length > 80 ? '…' : ''}</p>
      <div class="nv-mp-card-meta">
        ${asset.stats?.rating ? `<span>⭐ ${asset.stats.rating.toFixed(1)}</span>` : ''}
        ${asset.stats?.installs ? `<span>${_formatNumber(asset.stats.installs)} installs</span>` : ''}
        <span class="nv-mp-trust-badge nv-mp-trust-${trust.level}">${trust.badge}</span>
      </div>
      <div class="nv-mp-card-actions">
        ${installed
          ? '<button class="nv-mp-btn-secondary" disabled>✓ Installed</button>'
          : `<button class="nv-mp-btn-primary nv-mp-install-asset" data-asset-id="${asset.assetId}">Install</button>`
        }
        <button class="nv-mp-btn-ghost nv-mp-view-asset" data-asset-id="${asset.assetId}">Details</button>
      </div>
    </div>
  `;
}

function _attachCardListeners(body) {
  body.querySelectorAll('.nv-mp-install-asset').forEach(btn => {
    btn.addEventListener('click', () => _installAsset(btn.dataset.assetId, btn));
  });
  body.querySelectorAll('.nv-mp-view-asset').forEach(btn => {
    btn.addEventListener('click', () => _viewAsset(btn.dataset.assetId));
  });
}

// ─── Install Flow ─────────────────────────────────────────────────────────────

async function _installAsset(assetId, btn) {
  const asset = _catalog.find(a => a.assetId === assetId);
  if (!asset) return;

  btn.textContent = 'Installing…';
  btn.disabled = true;

  try {
    // License check
    const licenseCheck = await licenseEngine.checkAccess(asset, _userId);
    if (!licenseCheck.allowed) {
      alert(`License required:\n${licenseCheck.message}`);
      btn.textContent = 'Install';
      btn.disabled = false;
      return;
    }

    // Entitlement check
    const entitlement = await revenueEngine.checkEntitlement(asset, _userId);
    if (!entitlement.allowed) {
      alert(`Upgrade required:\n${entitlement.message}`);
      btn.textContent = 'Install';
      btn.disabled = false;
      return;
    }

    // Resolve version
    const versionSpec = versionResolver.resolve(asset, 'latest');
    if (!versionSpec) {
      alert('No compatible version found.');
      btn.textContent = 'Install';
      btn.disabled = false;
      return;
    }

    // Compatibility check
    const compat = versionResolver.checkCompatibility(versionSpec, NUVRA_VERSION);
    if (!compat.compatible) {
      alert(`Compatibility issue:\n${compat.message}`);
      btn.textContent = 'Install';
      btn.disabled = false;
      return;
    }

    // Install
    await assetRegistry.install(asset, versionSpec, { projectId: _projectId });
    await revenueEngine.recordInstall(asset, _userId, { version: versionSpec.version });
    analyticsService.trackInstall(assetId, asset.type, versionSpec.version);

    btn.textContent = '✓ Installed';
    btn.classList.remove('nv-mp-btn-primary');
    btn.classList.add('nv-mp-btn-secondary');

  } catch (err) {
    console.error('[Marketplace] Install failed:', err);
    alert('Installation failed. Please try again.');
    btn.textContent = 'Install';
    btn.disabled = false;
  }
}

async function _viewAsset(assetId) {
  const asset = _catalog.find(a => a.assetId === assetId);
  if (!asset) return;
  analyticsService.trackAssetView(assetId, asset.type);
  // Show a simple detail modal
  const trust = trustEngine.computeTrustScore(asset);
  const modal = document.createElement('div');
  modal.className = 'nv-mp-detail-modal';
  modal.innerHTML = `
    <div class="nv-mp-detail-content">
      <button class="nv-mp-detail-close">✕</button>
      <div class="nv-mp-detail-header">
        <span class="nv-mp-type-badge ${asset.type}">${asset.type}</span>
        <h2>${_esc(asset.name)}</h2>
        <span class="nv-mp-trust-badge nv-mp-trust-${trust.level}">${trust.badge}</span>
      </div>
      <p>${_esc(asset.description || '')}</p>
      <div class="nv-mp-detail-meta">
        <div><strong>Author</strong><span>${_esc(asset.author?.name || 'Unknown')}</span></div>
        <div><strong>Version</strong><span>v${asset.latestVersion || '1.0.0'}</span></div>
        <div><strong>License</strong><span>${licenseEngine.getLicenseSummary(asset)}</span></div>
        ${asset.stats?.installs ? `<div><strong>Installs</strong><span>${_formatNumber(asset.stats.installs)}</span></div>` : ''}
        ${asset.stats?.rating ? `<div><strong>Rating</strong><span>⭐ ${asset.stats.rating.toFixed(1)}/5</span></div>` : ''}
      </div>
      ${(asset.permissions || []).length ? `
        <div class="nv-mp-detail-permissions">
          <strong>Required Permissions</strong>
          <ul>${asset.permissions.map(p => `<li>${_esc(p)}</li>`).join('')}</ul>
        </div>
      ` : ''}
      <div class="nv-mp-detail-actions">
        ${assetRegistry.isInstalled(asset.assetId)
          ? '<button class="nv-mp-btn-secondary" disabled>✓ Installed</button>'
          : `<button class="nv-mp-btn-primary nv-mp-install-from-detail" data-asset-id="${asset.assetId}">Install</button>`
        }
        <button class="nv-mp-btn-ghost nv-mp-report-abuse" data-asset-id="${asset.assetId}">Report</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.nv-mp-detail-close').addEventListener('click', () => modal.remove());
  modal.querySelector('.nv-mp-install-from-detail')?.addEventListener('click', async (e) => {
    await _installAsset(asset.assetId, e.target);
  });
  modal.querySelector('.nv-mp-report-abuse')?.addEventListener('click', () => {
    const reason = prompt('Reason for report (malware, spam, misleading, copyright, other):');
    if (reason) {
      trustEngine.reportAbuse(asset.assetId, reason);
      alert('Report submitted. Thank you.');
    }
  });
}

async function _showBlueprintInstaller(blueprintId) {
  const blueprint = blueprintRegistry.getById(blueprintId);
  if (!blueprint) return;

  const variables = blueprintInstaller.getConfigVariables(blueprintId);
  const modal = document.createElement('div');
  modal.className = 'nv-mp-detail-modal';
  modal.innerHTML = `
    <div class="nv-mp-detail-content">
      <button class="nv-mp-detail-close">✕</button>
      <h2>Install Blueprint: ${_esc(blueprint.name)}</h2>
      <p>${_esc(blueprint.description || '')}</p>
      ${variables.length ? `
        <form id="nv-mp-blueprint-config-form">
          <h4>Configuration</h4>
          ${variables.map(v => `
            <div class="nv-mp-config-field">
              <label>${_esc(v.label)}</label>
              ${v.type === 'color'
                ? `<input type="color" name="${v.key}" value="${v.default || '#000000'}" />`
                : v.type === 'number'
                  ? `<input type="number" name="${v.key}" value="${v.default || 0}" />`
                  : `<input type="text" name="${v.key}" value="${_esc(String(v.default || ''))}" placeholder="${_esc(v.label)}" />`
              }
            </div>
          `).join('')}
          <div class="nv-mp-blueprint-progress" id="nv-mp-bp-progress" style="display:none;">
            <div class="nv-mp-progress-bar"><div class="nv-mp-progress-fill" id="nv-mp-bp-fill"></div></div>
            <p id="nv-mp-bp-status">Installing…</p>
          </div>
          <button type="submit" class="nv-mp-btn-primary">Create Project from Blueprint</button>
        </form>
      ` : `
        <button class="nv-mp-btn-primary" id="nv-mp-bp-install-btn">Create Project from Blueprint</button>
      `}
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.nv-mp-detail-close').addEventListener('click', () => modal.remove());

  const doInstall = async (configValues) => {
    const progressEl = modal.querySelector('#nv-mp-bp-progress');
    const fillEl     = modal.querySelector('#nv-mp-bp-fill');
    const statusEl   = modal.querySelector('#nv-mp-bp-status');
    if (progressEl) progressEl.style.display = 'block';

    const result = await blueprintInstaller.install(blueprintId, configValues, (step, total, msg) => {
      if (fillEl) fillEl.style.width = `${(step / total) * 100}%`;
      if (statusEl) statusEl.textContent = msg;
    });

    if (result.success) {
      modal.remove();
      alert(`✓ Project "${result.projectName}" created from blueprint!`);
      if (_onProjectOpen) _onProjectOpen(result.projectId);
    } else {
      alert(`Installation failed: ${result.message}`);
    }
  };

  const form = modal.querySelector('#nv-mp-blueprint-config-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      await doInstall(Object.fromEntries(fd));
    });
  } else {
    modal.querySelector('#nv-mp-bp-install-btn')?.addEventListener('click', () => doInstall({}));
  }
}

function _showDraftEditor() {
  const modal = document.createElement('div');
  modal.className = 'nv-mp-detail-modal';
  modal.innerHTML = `
    <div class="nv-mp-detail-content">
      <button class="nv-mp-detail-close">✕</button>
      <h2>New Asset Draft</h2>
      <form id="nv-mp-draft-form">
        <input type="text" name="name" placeholder="Asset name" required />
        <select name="type">
          <option value="plugin">Plugin</option>
          <option value="template">Template</option>
          <option value="integration">Integration</option>
          <option value="ai-pack">AI Pack</option>
        </select>
        <textarea name="description" placeholder="Description (min 20 chars)" rows="3" required></textarea>
        <input type="text" name="version" placeholder="Version (e.g. 1.0.0)" value="1.0.0" required />
        <textarea name="bundle" placeholder="Extension bundle code (JavaScript)" rows="8"></textarea>
        <button type="submit" class="nv-mp-btn-primary">Save Draft</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.nv-mp-detail-close').addEventListener('click', () => modal.remove());
  modal.querySelector('#nv-mp-draft-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const draftId = creatorService.saveDraft(Object.fromEntries(fd));
    modal.remove();
    alert(`Draft saved (ID: ${draftId}). Go to the Creator tab to validate and publish.`);
    _activeTab = 'creator';
    document.querySelectorAll('.nv-mp-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === 'creator');
    });
    _renderCreator(document.getElementById('nv-mp-body'));
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function _esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _formatNumber(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function _injectStyles() {
  if (document.getElementById('nv-mp-store-styles')) return;
  // Styles are in styles.css — this is a no-op placeholder
}
