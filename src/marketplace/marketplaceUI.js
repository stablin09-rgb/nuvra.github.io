/**
 * Nuvra Builder — Marketplace UI (Phase 10)
 *
 * The full marketplace panel UI controller.
 * Renders the extension catalog, handles search/filter,
 * and wires all install/enable/disable/remove actions.
 *
 * DESIGN: This is a pure UI module. All data operations
 * are delegated to marketplaceManager.js.
 */
'use strict';

import {
  loadCatalog,
  searchCatalog,
  getCategories,
  getExtension,
  installFromCatalog,
  enableExtension,
  disableExtension,
  removeExtension,
  updateExtension,
  rollbackExtension,
  getInstalledExtensions,
} from './marketplaceManager.js';

// ─── State ────────────────────────────────────────────────────────────────────

let _panel        = null;
let _isOpen       = false;
let _currentView  = 'browse'; // 'browse' | 'installed' | 'detail'
let _detailExtId  = null;
let _searchQuery  = '';
let _filterType   = '';
let _filterCat    = '';
let _busyIds      = new Set(); // Extension IDs currently being processed

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialise the marketplace UI (creates the panel DOM).
 * Call once after the editor is ready.
 */
export function init() {
  _createPanel();
  _attachGlobalListeners();
}

/**
 * Open the marketplace panel.
 */
export async function open() {
  if (!_panel) init();
  _isOpen = true;
  _panel.classList.add('open');
  document.body.classList.add('nv-marketplace-open');
  await _renderBrowse();
}

/**
 * Close the marketplace panel.
 */
export function close() {
  _isOpen = false;
  _panel?.classList.remove('open');
  document.body.classList.remove('nv-marketplace-open');
}

/**
 * Toggle the marketplace panel.
 */
export async function toggle() {
  if (_isOpen) close();
  else await open();
}

// ─── Panel Creation ───────────────────────────────────────────────────────────

function _createPanel() {
  _panel = document.createElement('div');
  _panel.id        = 'nv-marketplace-panel';
  _panel.className = 'nv-marketplace-panel';
  _panel.innerHTML = `
    <div class="nv-mp-header">
      <div class="nv-mp-title-row">
        <h2 class="nv-mp-title">🧩 Marketplace</h2>
        <button class="nv-mp-close" id="nv-mp-close" title="Close">✕</button>
      </div>
      <div class="nv-mp-tabs">
        <button class="nv-mp-tab active" data-view="browse">Browse</button>
        <button class="nv-mp-tab" data-view="installed">Installed</button>
      </div>
      <div class="nv-mp-search-row" id="nv-mp-search-row">
        <input class="nv-mp-search" id="nv-mp-search" type="text" placeholder="Search extensions…" />
        <select class="nv-mp-filter" id="nv-mp-filter-type">
          <option value="">All Types</option>
          <option value="template">Templates</option>
          <option value="block">Blocks</option>
          <option value="integration">Integrations</option>
          <option value="ai-pack">AI Packs</option>
        </select>
      </div>
    </div>
    <div class="nv-mp-body" id="nv-mp-body">
      <div class="nv-mp-loading">Loading catalog…</div>
    </div>
  `;
  document.body.appendChild(_panel);
}

function _attachGlobalListeners() {
  _panel.querySelector('#nv-mp-close').addEventListener('click', close);

  // Tab switching
  _panel.querySelectorAll('.nv-mp-tab').forEach(tab => {
    tab.addEventListener('click', async () => {
      _panel.querySelectorAll('.nv-mp-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      _currentView = tab.dataset.view;
      if (_currentView === 'browse') await _renderBrowse();
      else await _renderInstalled();
    });
  });

  // Search
  const searchInput = _panel.querySelector('#nv-mp-search');
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    _searchQuery = searchInput.value;
    searchTimer = setTimeout(() => _renderBrowse(), 300);
  });

  // Type filter
  _panel.querySelector('#nv-mp-filter-type').addEventListener('change', async (e) => {
    _filterType = e.target.value;
    await _renderBrowse();
  });

  // Close on backdrop click
  _panel.addEventListener('click', (e) => {
    if (e.target === _panel) close();
  });
}

// ─── Browse View ──────────────────────────────────────────────────────────────

async function _renderBrowse() {
  const body = _panel.querySelector('#nv-mp-body');
  body.innerHTML = '<div class="nv-mp-loading">Loading…</div>';

  try {
    const results = await searchCatalog({
      query:    _searchQuery,
      type:     _filterType,
      category: _filterCat,
      sort:     'popular',
    });

    if (results.length === 0) {
      body.innerHTML = `
        <div class="nv-mp-empty">
          <div class="nv-mp-empty-icon">🔍</div>
          <p>No extensions found for "<strong>${_htmlEscape(_searchQuery)}</strong>"</p>
        </div>`;
      return;
    }

    // Group by category
    const groups = {};
    for (const ext of results) {
      if (!groups[ext.category]) groups[ext.category] = [];
      groups[ext.category].push(ext);
    }

    let html = '';
    for (const [category, exts] of Object.entries(groups)) {
      html += `<div class="nv-mp-group">
        <h3 class="nv-mp-group-title">${_htmlEscape(category)}</h3>
        <div class="nv-mp-grid">
          ${exts.map(e => _renderCard(e)).join('')}
        </div>
      </div>`;
    }

    body.innerHTML = html;
    _attachCardListeners();
  } catch (err) {
    body.innerHTML = `<div class="nv-mp-error">Failed to load catalog: ${_htmlEscape(err.message)}</div>`;
  }
}

// ─── Installed View ───────────────────────────────────────────────────────────

async function _renderInstalled() {
  const body = _panel.querySelector('#nv-mp-body');
  const installed = getInstalledExtensions();

  if (installed.length === 0) {
    body.innerHTML = `
      <div class="nv-mp-empty">
        <div class="nv-mp-empty-icon">📦</div>
        <p>No extensions installed yet.</p>
        <button class="nuvra-btn primary" id="nv-mp-go-browse">Browse Marketplace</button>
      </div>`;
    body.querySelector('#nv-mp-go-browse')?.addEventListener('click', async () => {
      _panel.querySelectorAll('.nv-mp-tab').forEach(t => t.classList.remove('active'));
      _panel.querySelector('[data-view="browse"]').classList.add('active');
      _currentView = 'browse';
      await _renderBrowse();
    });
    return;
  }

  body.innerHTML = `
    <div class="nv-mp-group">
      <div class="nv-mp-grid">
        ${installed.map(e => _renderCard(e)).join('')}
      </div>
    </div>`;
  _attachCardListeners();
}

// ─── Extension Card ───────────────────────────────────────────────────────────

function _renderCard(ext) {
  const typeIcon  = _typeIcon(ext.type);
  const typeBadge = `<span class="nv-mp-type-badge ${ext.type}">${_typeLabel(ext.type)}</span>`;
  const isBusy    = _busyIds.has(ext.id);

  const badges = (ext.badges || []).map(b => `<span class="nv-mp-badge ${b}">${_badgeLabel(b)}</span>`).join('');

  let actionBtn;
  if (isBusy) {
    actionBtn = `<button class="nuvra-btn" disabled>⏳ Working…</button>`;
  } else if (!ext.isInstalled) {
    actionBtn = `<button class="nuvra-btn primary nv-mp-action" data-action="install" data-id="${ext.id}">Install</button>`;
  } else if (ext.isEnabledForProject) {
    actionBtn = `<button class="nuvra-btn nv-mp-action" data-action="disable" data-id="${ext.id}">Disable</button>`;
  } else {
    actionBtn = `<button class="nuvra-btn primary nv-mp-action" data-action="enable" data-id="${ext.id}">Enable</button>`;
  }

  const updateBtn = ext.hasUpdate && !isBusy
    ? `<button class="nuvra-btn accent nv-mp-action" data-action="update" data-id="${ext.id}" title="Update to v${ext.version}">↑ Update</button>`
    : '';

  const removeBtn = ext.isInstalled && !isBusy
    ? `<button class="nuvra-btn danger nv-mp-action" data-action="remove" data-id="${ext.id}" title="Remove extension">Remove</button>`
    : '';

  const statusDot = ext.isInstalled
    ? `<span class="nv-mp-status-dot ${ext.isEnabledForProject ? 'enabled' : 'disabled'}" title="${ext.isEnabledForProject ? 'Enabled' : 'Disabled'}"></span>`
    : '';

  return `
    <div class="nv-mp-card ${ext.isInstalled ? 'installed' : ''}" data-id="${ext.id}">
      <div class="nv-mp-card-header">
        <div class="nv-mp-card-icon">${typeIcon}</div>
        <div class="nv-mp-card-meta">
          <div class="nv-mp-card-name-row">
            ${statusDot}
            <span class="nv-mp-card-name">${_htmlEscape(ext.name)}</span>
          </div>
          <div class="nv-mp-card-sub">
            ${typeBadge}
            <span class="nv-mp-card-version">v${_htmlEscape(ext.version)}</span>
            ${ext.hasUpdate ? `<span class="nv-mp-update-badge">Update available</span>` : ''}
          </div>
        </div>
      </div>
      <p class="nv-mp-card-desc">${_htmlEscape(ext.description)}</p>
      <div class="nv-mp-card-badges">${badges}</div>
      <div class="nv-mp-card-actions">
        ${actionBtn}
        ${updateBtn}
        ${removeBtn}
        <button class="nuvra-btn nv-mp-action" data-action="detail" data-id="${ext.id}">Details</button>
      </div>
    </div>`;
}

function _attachCardListeners() {
  _panel.querySelectorAll('.nv-mp-action').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id     = btn.dataset.id;
      await _handleAction(action, id);
    });
  });
}

// ─── Action Handler ───────────────────────────────────────────────────────────

async function _handleAction(action, extensionId) {
  if (action === 'detail') {
    await _renderDetail(extensionId);
    return;
  }

  if (_busyIds.has(extensionId)) return;
  _busyIds.add(extensionId);

  // Re-render to show busy state
  if (_currentView === 'browse') await _renderBrowse();
  else await _renderInstalled();

  try {
    switch (action) {
      case 'install':
        await installFromCatalog(extensionId, { enableAfterInstall: true });
        _showToast(`✅ Extension installed and enabled`);
        break;
      case 'enable':
        await enableExtension(extensionId);
        _showToast(`✅ Extension enabled`);
        break;
      case 'disable':
        await disableExtension(extensionId);
        _showToast(`⏸️ Extension disabled`);
        break;
      case 'remove':
        if (!confirm(`Remove this extension? This cannot be undone.`)) break;
        await removeExtension(extensionId);
        _showToast(`🗑️ Extension removed`);
        break;
      case 'update':
        await updateExtension(extensionId);
        _showToast(`✅ Extension updated`);
        break;
      case 'rollback':
        await rollbackExtension(extensionId);
        _showToast(`↩️ Extension rolled back`);
        break;
    }
  } catch (err) {
    _showToast(`❌ ${err.message}`, 'error');
  } finally {
    _busyIds.delete(extensionId);
    if (_currentView === 'browse') await _renderBrowse();
    else await _renderInstalled();
  }
}

// ─── Detail View ──────────────────────────────────────────────────────────────

async function _renderDetail(extensionId) {
  const body = _panel.querySelector('#nv-mp-body');
  body.innerHTML = '<div class="nv-mp-loading">Loading…</div>';

  const ext = await getExtension(extensionId);
  if (!ext) {
    body.innerHTML = '<div class="nv-mp-error">Extension not found</div>';
    return;
  }

  const perms = (ext.permissions || []).map(p =>
    `<li class="nv-mp-perm-item"><code>${_htmlEscape(p)}</code></li>`
  ).join('');

  const configFields = (ext.configSchema || []).map(f => `
    <div class="nv-mp-config-field">
      <label>${_htmlEscape(f.label)}</label>
      <input type="${f.type || 'text'}" placeholder="${_htmlEscape(f.placeholder || '')}" data-config-key="${_htmlEscape(f.key)}" />
    </div>`).join('');

  body.innerHTML = `
    <div class="nv-mp-detail">
      <button class="nv-mp-back" id="nv-mp-back">← Back</button>
      <div class="nv-mp-detail-header">
        <div class="nv-mp-detail-icon">${_typeIcon(ext.type)}</div>
        <div>
          <h2 class="nv-mp-detail-name">${_htmlEscape(ext.name)}</h2>
          <p class="nv-mp-detail-meta">v${_htmlEscape(ext.version)} · by ${_htmlEscape(ext.author)} · ${_typeLabel(ext.type)}</p>
        </div>
      </div>
      <p class="nv-mp-detail-desc">${_htmlEscape(ext.longDescription || ext.description)}</p>

      ${configFields ? `<div class="nv-mp-config-section"><h4>Configuration</h4>${configFields}</div>` : ''}

      <div class="nv-mp-permissions">
        <h4>Permissions Required</h4>
        <ul class="nv-mp-perm-list">${perms}</ul>
      </div>

      <div class="nv-mp-detail-actions">
        ${!ext.isInstalled
          ? `<button class="nuvra-btn primary" id="nv-mp-detail-install">Install Extension</button>`
          : ext.isEnabledForProject
            ? `<button class="nuvra-btn" id="nv-mp-detail-disable">Disable</button>`
            : `<button class="nuvra-btn primary" id="nv-mp-detail-enable">Enable</button>`
        }
        ${ext.hasUpdate ? `<button class="nuvra-btn accent" id="nv-mp-detail-update">Update to v${_htmlEscape(ext.version)}</button>` : ''}
        ${ext.canRollback ? `<button class="nuvra-btn" id="nv-mp-detail-rollback">Rollback to v${_htmlEscape(ext.rollbackVersion)}</button>` : ''}
        ${ext.isInstalled ? `<button class="nuvra-btn danger" id="nv-mp-detail-remove">Remove</button>` : ''}
      </div>
    </div>`;

  body.querySelector('#nv-mp-back')?.addEventListener('click', async () => {
    if (_currentView === 'installed') await _renderInstalled();
    else await _renderBrowse();
  });

  body.querySelector('#nv-mp-detail-install')?.addEventListener('click', async () => {
    await _handleAction('install', extensionId);
    await _renderDetail(extensionId);
  });
  body.querySelector('#nv-mp-detail-enable')?.addEventListener('click', async () => {
    await _handleAction('enable', extensionId);
    await _renderDetail(extensionId);
  });
  body.querySelector('#nv-mp-detail-disable')?.addEventListener('click', async () => {
    await _handleAction('disable', extensionId);
    await _renderDetail(extensionId);
  });
  body.querySelector('#nv-mp-detail-update')?.addEventListener('click', async () => {
    await _handleAction('update', extensionId);
    await _renderDetail(extensionId);
  });
  body.querySelector('#nv-mp-detail-rollback')?.addEventListener('click', async () => {
    await _handleAction('rollback', extensionId);
    await _renderDetail(extensionId);
  });
  body.querySelector('#nv-mp-detail-remove')?.addEventListener('click', async () => {
    await _handleAction('remove', extensionId);
    if (_currentView === 'installed') await _renderInstalled();
    else await _renderBrowse();
  });
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function _showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `nv-mp-toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _htmlEscape(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _typeIcon(type) {
  const icons = {
    'template':      '📄',
    'block':         '🧱',
    'integration':   '🔌',
    'ai-pack':       '🤖',
    'app-component': '⚙️',
  };
  return icons[type] || '📦';
}

function _typeLabel(type) {
  const labels = {
    'template':      'Template',
    'block':         'Block Pack',
    'integration':   'Integration',
    'ai-pack':       'AI Pack',
    'app-component': 'Component',
  };
  return labels[type] || type;
}

function _badgeLabel(badge) {
  const labels = {
    'mobile-ready': '📱 Mobile',
    'uses-ai':      '🤖 AI',
    'new':          '✨ New',
    'popular':      '🔥 Popular',
  };
  return labels[badge] || badge;
}
