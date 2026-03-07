/**
 * Nuvra Enterprise — Admin Console UI (Phase 12)
 *
 * A full-featured Admin Console panel with the following sections:
 *
 *   Overview      — Org stats, plan, member count, storage usage
 *   Members       — Invite, manage, remove members; assign roles
 *   Teams         — Create and manage teams
 *   Policies      — View, create, edit, delete governance policies
 *   AI Governance — Configure approved models, redaction, logging, caps
 *   White Label   — Branding, domain, feature flags, custom CSS
 *   Audit Log     — Query, filter, export audit trail
 *   Deployment    — Deployment model, feature flags, data residency
 *   SSO / SCIM    — Configure SSO, generate SCIM tokens
 *   Billing       — Plan, usage, invoices (links to billing portal)
 *
 * This is a slide-in panel (not a separate page) so the editor remains
 * accessible behind it. Admins access it via the account menu.
 *
 * @module adminConsole
 */
'use strict';

import { orgService, ROLES }          from '../org/orgService.js';
import { identityService }            from '../org/identityService.js';
import { policyEngine, ACTIONS }      from '../org/policyEngine.js';
import { auditService }               from '../org/auditService.js';
import { whiteLabelService }          from '../cloud/whiteLabelService.js';
import { deploymentManager, FLAGS }   from '../cloud/deploymentManager.js';
import { aiGovernance }               from '../ai/aiGovernance.js';

// ─── Internal State ───────────────────────────────────────────────────────────

let _panel       = null;
let _activeTab   = 'overview';
let _initialized = false;

// ─── Init ─────────────────────────────────────────────────────────────────────

export function init() {
  if (_initialized) return;
  _initialized = true;
  _createPanel();
  _bindGlobalButton();
}

// ─── Open / Close ─────────────────────────────────────────────────────────────

export function open(tab = 'overview') {
  if (!orgService.hasRole(ROLES.ADMIN)) {
    _showToast('Admin access required.', 'error');
    return;
  }
  _activeTab = tab;
  _panel.classList.add('nv-admin-open');
  _renderTab(tab);
}

export function close() {
  _panel.classList.remove('nv-admin-open');
}

export function toggle() {
  if (_panel.classList.contains('nv-admin-open')) close();
  else open(_activeTab);
}

// ─── Panel Creation ───────────────────────────────────────────────────────────

function _createPanel() {
  _panel = document.createElement('div');
  _panel.id = 'nv-admin-console';
  _panel.className = 'nv-admin-console';
  _panel.innerHTML = `
    <div class="nv-admin-header">
      <div class="nv-admin-title">
        <span class="nv-admin-icon">⚙️</span>
        <span id="nv-admin-org-name">Admin Console</span>
        <span class="nv-admin-plan-badge" id="nv-admin-plan-badge"></span>
      </div>
      <button class="nv-admin-close" id="nv-admin-close">✕</button>
    </div>
    <div class="nv-admin-layout">
      <nav class="nv-admin-nav" id="nv-admin-nav"></nav>
      <div class="nv-admin-content" id="nv-admin-content">
        <div class="nv-admin-loading">Loading...</div>
      </div>
    </div>
  `;
  document.body.appendChild(_panel);

  document.getElementById('nv-admin-close').addEventListener('click', close);
  _renderNav();
}

function _renderNav() {
  const tabs = [
    { id: 'overview',    icon: '📊', label: 'Overview' },
    { id: 'members',     icon: '👥', label: 'Members' },
    { id: 'teams',       icon: '🏷️', label: 'Teams' },
    { id: 'policies',    icon: '🛡️', label: 'Policies' },
    { id: 'ai',          icon: '🤖', label: 'AI Governance' },
    { id: 'whitelabel',  icon: '🎨', label: 'White Label' },
    { id: 'audit',       icon: '📋', label: 'Audit Log' },
    { id: 'deployment',  icon: '🌐', label: 'Deployment' },
    { id: 'sso',         icon: '🔐', label: 'SSO / SCIM' },
    { id: 'billing',     icon: '💳', label: 'Billing' },
  ];

  const nav = document.getElementById('nv-admin-nav');
  nav.innerHTML = tabs.map(t => `
    <button class="nv-admin-nav-item ${t.id === _activeTab ? 'active' : ''}"
            data-tab="${t.id}">
      <span class="nv-admin-nav-icon">${t.icon}</span>
      <span class="nv-admin-nav-label">${t.label}</span>
    </button>
  `).join('');

  nav.querySelectorAll('.nv-admin-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeTab = btn.dataset.tab;
      nav.querySelectorAll('.nv-admin-nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _renderTab(_activeTab);
    });
  });
}

function _bindGlobalButton() {
  document.addEventListener('click', e => {
    if (e.target.id === 'btn-admin-console' || e.target.closest('#btn-admin-console')) {
      toggle();
    }
  });
}

// ─── Tab Renderers ────────────────────────────────────────────────────────────

async function _renderTab(tab) {
  const content = document.getElementById('nv-admin-content');
  content.innerHTML = '<div class="nv-admin-loading">Loading...</div>';

  // Update org name and plan badge
  const org = orgService.getActiveOrg();
  if (org) {
    document.getElementById('nv-admin-org-name').textContent = org.name + ' — Admin Console';
    const badge = document.getElementById('nv-admin-plan-badge');
    badge.textContent = org.plan?.toUpperCase() || 'FREE';
    badge.className   = `nv-admin-plan-badge nv-plan-${org.plan || 'free'}`;
  }

  try {
    switch (tab) {
      case 'overview':   await _renderOverview(content);   break;
      case 'members':    await _renderMembers(content);    break;
      case 'teams':      await _renderTeams(content);      break;
      case 'policies':   await _renderPolicies(content);   break;
      case 'ai':         await _renderAIGovernance(content); break;
      case 'whitelabel': await _renderWhiteLabel(content); break;
      case 'audit':      await _renderAuditLog(content);   break;
      case 'deployment': await _renderDeployment(content); break;
      case 'sso':        await _renderSSO(content);        break;
      case 'billing':    await _renderBilling(content);    break;
      default:           content.innerHTML = '<p>Unknown tab.</p>';
    }
  } catch (err) {
    content.innerHTML = `<div class="nv-admin-error">Error loading tab: ${err.message}</div>`;
  }
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

async function _renderOverview(el) {
  const org     = orgService.getActiveOrg();
  const members = await orgService.listMembers();
  const teams   = await orgService.listTeams();

  el.innerHTML = `
    <div class="nv-admin-section">
      <h2 class="nv-admin-section-title">Organization Overview</h2>
      <div class="nv-admin-stats-grid">
        <div class="nv-admin-stat">
          <div class="nv-admin-stat-value">${members.length}</div>
          <div class="nv-admin-stat-label">Members</div>
        </div>
        <div class="nv-admin-stat">
          <div class="nv-admin-stat-value">${teams.length}</div>
          <div class="nv-admin-stat-label">Teams</div>
        </div>
        <div class="nv-admin-stat">
          <div class="nv-admin-stat-value">${org?.plan?.toUpperCase() || 'FREE'}</div>
          <div class="nv-admin-stat-label">Plan</div>
        </div>
        <div class="nv-admin-stat">
          <div class="nv-admin-stat-value">${deploymentManager.getModel().replace('_', ' ').toUpperCase()}</div>
          <div class="nv-admin-stat-label">Deployment</div>
        </div>
      </div>
      <div class="nv-admin-info-grid">
        <div class="nv-admin-info-row">
          <span class="nv-admin-info-label">Organization ID</span>
          <span class="nv-admin-info-value nv-mono">${org?.id || '—'}</span>
        </div>
        <div class="nv-admin-info-row">
          <span class="nv-admin-info-label">Created</span>
          <span class="nv-admin-info-value">${org?.createdAt ? new Date(org.createdAt).toLocaleDateString() : '—'}</span>
        </div>
        <div class="nv-admin-info-row">
          <span class="nv-admin-info-label">Region</span>
          <span class="nv-admin-info-value">${deploymentManager.getRegion()}</span>
        </div>
        <div class="nv-admin-info-row">
          <span class="nv-admin-info-label">Data Residency</span>
          <span class="nv-admin-info-value">${deploymentManager.getDataResidency()}</span>
        </div>
      </div>
    </div>
  `;
}

// ─── Members Tab ──────────────────────────────────────────────────────────────

async function _renderMembers(el) {
  const members = await orgService.listMembers();
  const isOwner = orgService.hasRole(ROLES.OWNER);

  el.innerHTML = `
    <div class="nv-admin-section">
      <div class="nv-admin-section-header">
        <h2 class="nv-admin-section-title">Members (${members.length})</h2>
        <button class="nv-btn nv-btn-primary" id="nv-admin-invite-btn">+ Invite Member</button>
      </div>
      <div id="nv-admin-invite-form" class="nv-admin-invite-form" style="display:none">
        <input type="email" id="nv-admin-invite-email" placeholder="Email address" class="nv-admin-input">
        <select id="nv-admin-invite-role" class="nv-admin-select">
          <option value="viewer">Viewer</option>
          <option value="editor" selected>Editor</option>
          <option value="developer">Developer</option>
          <option value="admin">Admin</option>
        </select>
        <button class="nv-btn nv-btn-primary" id="nv-admin-invite-submit">Send Invite</button>
        <button class="nv-btn nv-btn-ghost" id="nv-admin-invite-cancel">Cancel</button>
      </div>
      <table class="nv-admin-table">
        <thead>
          <tr><th>Email</th><th>Role</th><th>Joined</th>${isOwner ? '<th>Actions</th>' : ''}</tr>
        </thead>
        <tbody>
          ${members.map(m => `
            <tr>
              <td>${m.email || m.userId}</td>
              <td><span class="nv-role-badge nv-role-${m.role}">${m.role}</span></td>
              <td>${m.joinedAt ? new Date(m.joinedAt).toLocaleDateString() : '—'}</td>
              ${isOwner ? `<td>
                <button class="nv-btn-icon" data-action="remove-member" data-id="${m.id}" title="Remove">🗑️</button>
              </td>` : ''}
            </tr>
          `).join('') || '<tr><td colspan="4" class="nv-admin-empty">No members found.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  // Invite form toggle
  el.querySelector('#nv-admin-invite-btn')?.addEventListener('click', () => {
    el.querySelector('#nv-admin-invite-form').style.display = 'flex';
  });
  el.querySelector('#nv-admin-invite-cancel')?.addEventListener('click', () => {
    el.querySelector('#nv-admin-invite-form').style.display = 'none';
  });
  el.querySelector('#nv-admin-invite-submit')?.addEventListener('click', async () => {
    const email = el.querySelector('#nv-admin-invite-email').value.trim();
    const role  = el.querySelector('#nv-admin-invite-role').value;
    if (!email) return;
    try {
      await orgService.inviteMember(email, role);
      _showToast(`Invite sent to ${email}`, 'success');
      _renderTab('members');
    } catch (err) {
      _showToast(err.message, 'error');
    }
  });

  // Remove member buttons
  el.querySelectorAll('[data-action="remove-member"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this member?')) return;
      try {
        await orgService.removeMember(btn.dataset.id);
        _showToast('Member removed.', 'success');
        _renderTab('members');
      } catch (err) {
        _showToast(err.message, 'error');
      }
    });
  });
}

// ─── Teams Tab ────────────────────────────────────────────────────────────────

async function _renderTeams(el) {
  const teams = await orgService.listTeams();

  el.innerHTML = `
    <div class="nv-admin-section">
      <div class="nv-admin-section-header">
        <h2 class="nv-admin-section-title">Teams (${teams.length})</h2>
        <button class="nv-btn nv-btn-primary" id="nv-admin-create-team-btn">+ Create Team</button>
      </div>
      <div id="nv-admin-team-form" class="nv-admin-invite-form" style="display:none">
        <input type="text" id="nv-admin-team-name" placeholder="Team name" class="nv-admin-input">
        <button class="nv-btn nv-btn-primary" id="nv-admin-team-submit">Create</button>
        <button class="nv-btn nv-btn-ghost" id="nv-admin-team-cancel">Cancel</button>
      </div>
      <div class="nv-admin-cards">
        ${teams.map(t => `
          <div class="nv-admin-card">
            <div class="nv-admin-card-title">${t.name}</div>
            <div class="nv-admin-card-meta">${(t.memberIds || []).length} members</div>
          </div>
        `).join('') || '<p class="nv-admin-empty">No teams yet. Create your first team.</p>'}
      </div>
    </div>
  `;

  el.querySelector('#nv-admin-create-team-btn')?.addEventListener('click', () => {
    el.querySelector('#nv-admin-team-form').style.display = 'flex';
  });
  el.querySelector('#nv-admin-team-cancel')?.addEventListener('click', () => {
    el.querySelector('#nv-admin-team-form').style.display = 'none';
  });
  el.querySelector('#nv-admin-team-submit')?.addEventListener('click', async () => {
    const name = el.querySelector('#nv-admin-team-name').value.trim();
    if (!name) return;
    try {
      await orgService.createTeam(name);
      _showToast(`Team '${name}' created.`, 'success');
      _renderTab('teams');
    } catch (err) {
      _showToast(err.message, 'error');
    }
  });
}

// ─── Policies Tab ─────────────────────────────────────────────────────────────

async function _renderPolicies(el) {
  const policies  = policyEngine.listPolicies();
  const templates = policyEngine.getBuiltinTemplates();

  el.innerHTML = `
    <div class="nv-admin-section">
      <div class="nv-admin-section-header">
        <h2 class="nv-admin-section-title">Governance Policies (${policies.length})</h2>
        <button class="nv-btn nv-btn-primary" id="nv-admin-add-policy-btn">+ Add Policy</button>
      </div>
      ${policies.length === 0 ? `
        <div class="nv-admin-empty-state">
          <p>No policies configured. Use a template to get started.</p>
          <div class="nv-admin-templates">
            ${templates.map(t => `
              <div class="nv-admin-template-card">
                <div class="nv-admin-template-name">${t.name}</div>
                <div class="nv-admin-template-desc">${t.description}</div>
                <button class="nv-btn nv-btn-secondary nv-btn-sm" data-template="${t.name}">Apply Template</button>
              </div>
            `).join('')}
          </div>
        </div>
      ` : `
        <div class="nv-admin-policy-list">
          ${policies.map(p => `
            <div class="nv-admin-policy-card">
              <div class="nv-admin-policy-header">
                <span class="nv-admin-policy-name">${p.name}</span>
                <span class="nv-admin-policy-version">v${p.version}</span>
                <span class="nv-admin-policy-scope nv-scope-${p.scope}">${p.scope}</span>
              </div>
              <div class="nv-admin-policy-desc">${p.description || ''}</div>
              <div class="nv-admin-policy-rules">${(p.rules || []).length} rules</div>
              <div class="nv-admin-policy-actions">
                <button class="nv-btn-icon" data-action="delete-policy" data-id="${p.id}" title="Delete">🗑️</button>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;

  // Apply template buttons
  el.querySelectorAll('[data-template]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const template = templates.find(t => t.name === btn.dataset.template);
      if (!template) return;
      try {
        await policyEngine.createPolicy({
          name:        template.name,
          description: template.description,
          scope:       'org',
          scopeId:     orgService.getActiveOrg()?.id,
          rules:       template.rules,
        });
        _showToast(`Policy '${template.name}' applied.`, 'success');
        _renderTab('policies');
      } catch (err) {
        _showToast(err.message, 'error');
      }
    });
  });

  // Delete policy buttons
  el.querySelectorAll('[data-action="delete-policy"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this policy?')) return;
      try {
        await policyEngine.deletePolicy(btn.dataset.id);
        _showToast('Policy deleted.', 'success');
        _renderTab('policies');
      } catch (err) {
        _showToast(err.message, 'error');
      }
    });
  });
}

// ─── AI Governance Tab ────────────────────────────────────────────────────────

async function _renderAIGovernance(el) {
  const cfg     = aiGovernance.getConfig();
  const summary = aiGovernance.getGovernanceSummary();

  el.innerHTML = `
    <div class="nv-admin-section">
      <h2 class="nv-admin-section-title">AI Governance</h2>
      <div class="nv-admin-governance-summary">
        ${Object.entries(summary).map(([k, v]) => `
          <div class="nv-admin-info-row">
            <span class="nv-admin-info-label">${k.replace(/([A-Z])/g, ' $1').trim()}</span>
            <span class="nv-admin-info-value">${v}</span>
          </div>
        `).join('')}
      </div>
      <div class="nv-admin-governance-controls">
        <div class="nv-admin-toggle-row">
          <label>Training Opt-Out</label>
          <label class="nv-toggle">
            <input type="checkbox" id="nv-gov-training-optout" ${cfg.trainingOptOut ? 'checked' : ''}>
            <span class="nv-toggle-slider"></span>
          </label>
          <span class="nv-admin-toggle-desc">All AI requests will include opt-out headers</span>
        </div>
        <div class="nv-admin-toggle-row">
          <label>Prompt Redaction</label>
          <label class="nv-toggle">
            <input type="checkbox" id="nv-gov-redaction" ${cfg.promptRedaction?.enabled ? 'checked' : ''}>
            <span class="nv-toggle-slider"></span>
          </label>
          <span class="nv-admin-toggle-desc">Strip PII from prompts before sending to AI</span>
        </div>
        <div class="nv-admin-toggle-row">
          <label>Prompt Logging</label>
          <label class="nv-toggle">
            <input type="checkbox" id="nv-gov-logging" ${cfg.promptLogging?.enabled ? 'checked' : ''}>
            <span class="nv-toggle-slider"></span>
          </label>
          <span class="nv-admin-toggle-desc">Log all AI prompts to the audit trail</span>
        </div>
        <div class="nv-admin-toggle-row">
          <label>Content Filtering</label>
          <label class="nv-toggle">
            <input type="checkbox" id="nv-gov-content-filter" ${cfg.contentFiltering?.enabled ? 'checked' : ''}>
            <span class="nv-toggle-slider"></span>
          </label>
          <span class="nv-admin-toggle-desc">Block prompts matching forbidden patterns</span>
        </div>
        <button class="nv-btn nv-btn-primary" id="nv-gov-save">Save AI Governance Settings</button>
      </div>
    </div>
  `;

  el.querySelector('#nv-gov-save')?.addEventListener('click', async () => {
    try {
      await aiGovernance.updateConfig({
        trainingOptOut:   el.querySelector('#nv-gov-training-optout').checked,
        promptRedaction:  { ...cfg.promptRedaction,  enabled: el.querySelector('#nv-gov-redaction').checked },
        promptLogging:    { ...cfg.promptLogging,    enabled: el.querySelector('#nv-gov-logging').checked },
        contentFiltering: { ...cfg.contentFiltering, enabled: el.querySelector('#nv-gov-content-filter').checked },
      });
      _showToast('AI governance settings saved.', 'success');
    } catch (err) {
      _showToast(err.message, 'error');
    }
  });
}

// ─── White Label Tab ──────────────────────────────────────────────────────────

async function _renderWhiteLabel(el) {
  const cfg = whiteLabelService.getConfig();

  el.innerHTML = `
    <div class="nv-admin-section">
      <h2 class="nv-admin-section-title">White Label</h2>
      <div class="nv-admin-form">
        <div class="nv-admin-form-row">
          <label>App Name</label>
          <input type="text" id="nv-wl-name" value="${cfg.appName || ''}" class="nv-admin-input">
        </div>
        <div class="nv-admin-form-row">
          <label>App Tagline</label>
          <input type="text" id="nv-wl-tagline" value="${cfg.appTagline || ''}" class="nv-admin-input">
        </div>
        <div class="nv-admin-form-row">
          <label>Logo URL</label>
          <input type="url" id="nv-wl-logo" value="${cfg.logoUrl || ''}" class="nv-admin-input" placeholder="https://...">
        </div>
        <div class="nv-admin-form-row">
          <label>Primary Color</label>
          <input type="color" id="nv-wl-primary" value="${cfg.brandColors?.primary || '#6366f1'}" class="nv-admin-color">
        </div>
        <div class="nv-admin-form-row">
          <label>Custom Domain</label>
          <input type="text" id="nv-wl-domain" value="${cfg.domain || ''}" class="nv-admin-input" placeholder="builder.yourcompany.com">
        </div>
        <div class="nv-admin-toggle-row">
          <label>Hide "Powered by Nuvra"</label>
          <label class="nv-toggle">
            <input type="checkbox" id="nv-wl-hide-credit" ${cfg.hideNuvraCredit ? 'checked' : ''}>
            <span class="nv-toggle-slider"></span>
          </label>
        </div>
        <div class="nv-admin-form-row">
          <label>Custom CSS</label>
          <textarea id="nv-wl-css" class="nv-admin-textarea" placeholder="/* Custom CSS */">${cfg.customCss || ''}</textarea>
        </div>
        <button class="nv-btn nv-btn-primary" id="nv-wl-save">Save White Label Settings</button>
        <button class="nv-btn nv-btn-ghost" id="nv-wl-reset">Reset to Defaults</button>
      </div>
    </div>
  `;

  el.querySelector('#nv-wl-save')?.addEventListener('click', async () => {
    try {
      await whiteLabelService.updateConfig({
        appName:         el.querySelector('#nv-wl-name').value,
        appTagline:      el.querySelector('#nv-wl-tagline').value,
        logoUrl:         el.querySelector('#nv-wl-logo').value || null,
        domain:          el.querySelector('#nv-wl-domain').value || null,
        hideNuvraCredit: el.querySelector('#nv-wl-hide-credit').checked,
        customCss:       el.querySelector('#nv-wl-css').value || null,
        brandColors:     { ...cfg.brandColors, primary: el.querySelector('#nv-wl-primary').value },
      });
      _showToast('White label settings saved.', 'success');
    } catch (err) {
      _showToast(err.message, 'error');
    }
  });

  el.querySelector('#nv-wl-reset')?.addEventListener('click', async () => {
    if (!confirm('Reset all white label settings to Nuvra defaults?')) return;
    await whiteLabelService.resetToDefaults();
    _showToast('Reset to defaults.', 'success');
    _renderTab('whitelabel');
  });
}

// ─── Audit Log Tab ────────────────────────────────────────────────────────────

async function _renderAuditLog(el) {
  el.innerHTML = `
    <div class="nv-admin-section">
      <div class="nv-admin-section-header">
        <h2 class="nv-admin-section-title">Audit Log</h2>
        <div class="nv-admin-audit-actions">
          <button class="nv-btn nv-btn-secondary" id="nv-audit-export-json">Export JSON</button>
          <button class="nv-btn nv-btn-secondary" id="nv-audit-export-csv">Export CSV</button>
          <button class="nv-btn nv-btn-secondary" id="nv-audit-verify">Verify Chain</button>
        </div>
      </div>
      <div class="nv-admin-audit-filters">
        <input type="text" id="nv-audit-action-filter" placeholder="Filter by action..." class="nv-admin-input nv-admin-input-sm">
        <select id="nv-audit-severity-filter" class="nv-admin-select nv-admin-select-sm">
          <option value="">All severities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
        <button class="nv-btn nv-btn-secondary nv-btn-sm" id="nv-audit-search">Search</button>
      </div>
      <div id="nv-audit-results" class="nv-admin-audit-results">
        <div class="nv-admin-loading">Loading audit log...</div>
      </div>
    </div>
  `;

  const _loadAudit = async () => {
    const action   = el.querySelector('#nv-audit-action-filter').value.trim() || undefined;
    const severity = el.querySelector('#nv-audit-severity-filter').value || undefined;
    const { entries, total } = await auditService.query({ action, severity, limit: 50 });
    const results = el.querySelector('#nv-audit-results');
    results.innerHTML = `
      <div class="nv-audit-count">${total} total entries (showing ${entries.length})</div>
      <table class="nv-admin-table nv-admin-table-sm">
        <thead><tr><th>Time</th><th>Action</th><th>User</th><th>Severity</th></tr></thead>
        <tbody>
          ${entries.map(e => `
            <tr class="nv-audit-row nv-severity-${e.severity}">
              <td class="nv-mono">${new Date(e.timestamp).toLocaleString()}</td>
              <td class="nv-mono">${e.action}</td>
              <td class="nv-mono">${(e.userId || '—').slice(0, 8)}</td>
              <td><span class="nv-severity-badge nv-severity-${e.severity}">${e.severity}</span></td>
            </tr>
          `).join('') || '<tr><td colspan="4" class="nv-admin-empty">No audit entries found.</td></tr>'}
        </tbody>
      </table>
    `;
  };

  await _loadAudit();

  el.querySelector('#nv-audit-search')?.addEventListener('click', _loadAudit);
  el.querySelector('#nv-audit-export-json')?.addEventListener('click', () => auditService.downloadExport({}, 'json'));
  el.querySelector('#nv-audit-export-csv')?.addEventListener('click',  () => auditService.downloadExport({}, 'csv'));
  el.querySelector('#nv-audit-verify')?.addEventListener('click', async () => {
    const result = await auditService.verifyChain();
    if (result.valid) {
      _showToast('Audit chain verified — no tampering detected.', 'success');
    } else {
      _showToast(`Chain broken at entry ${result.firstBrokenAt?.id?.slice(0, 8)}`, 'error');
    }
  });
}

// ─── Deployment Tab ───────────────────────────────────────────────────────────

async function _renderDeployment(el) {
  const flags = deploymentManager.getAllFlags();

  el.innerHTML = `
    <div class="nv-admin-section">
      <h2 class="nv-admin-section-title">Deployment Configuration</h2>
      <div class="nv-admin-info-grid">
        <div class="nv-admin-info-row">
          <span class="nv-admin-info-label">Deployment Model</span>
          <span class="nv-admin-info-value">${deploymentManager.getModel().replace('_', ' ').toUpperCase()}</span>
        </div>
        <div class="nv-admin-info-row">
          <span class="nv-admin-info-label">Region</span>
          <span class="nv-admin-info-value">${deploymentManager.getRegion()}</span>
        </div>
        <div class="nv-admin-info-row">
          <span class="nv-admin-info-label">Data Residency</span>
          <span class="nv-admin-info-value">${deploymentManager.getDataResidency()}</span>
        </div>
        <div class="nv-admin-info-row">
          <span class="nv-admin-info-label">Connectivity</span>
          <span class="nv-admin-info-value">${deploymentManager.getConnectivity()}</span>
        </div>
      </div>
      <h3 class="nv-admin-subsection-title">Feature Flags</h3>
      <div class="nv-admin-flags-grid">
        ${Object.entries(flags).map(([flag, value]) => `
          <div class="nv-admin-flag-row">
            <span class="nv-admin-flag-name nv-mono">${flag}</span>
            <span class="nv-admin-flag-value ${value ? 'nv-flag-on' : 'nv-flag-off'}">${value ? 'ON' : 'OFF'}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ─── SSO / SCIM Tab ───────────────────────────────────────────────────────────

async function _renderSSO(el) {
  const ssoConfig = orgService.getSsoConfig();

  el.innerHTML = `
    <div class="nv-admin-section">
      <h2 class="nv-admin-section-title">SSO / SCIM</h2>
      <div class="nv-admin-sso-status ${ssoConfig ? 'nv-sso-active' : 'nv-sso-inactive'}">
        ${ssoConfig ? `✓ SSO Active — ${ssoConfig.provider?.toUpperCase()} (${ssoConfig.domain})` : 'SSO not configured'}
      </div>
      <div class="nv-admin-form">
        <div class="nv-admin-form-row">
          <label>SSO Provider</label>
          <select id="nv-sso-provider" class="nv-admin-select">
            <option value="">— Select provider —</option>
            <option value="saml" ${ssoConfig?.provider === 'saml' ? 'selected' : ''}>SAML 2.0</option>
            <option value="oidc" ${ssoConfig?.provider === 'oidc' ? 'selected' : ''}>OIDC / OAuth 2.0</option>
          </select>
        </div>
        <div class="nv-admin-form-row">
          <label>Metadata URL</label>
          <input type="url" id="nv-sso-metadata" value="${ssoConfig?.metadataUrl || ''}" class="nv-admin-input" placeholder="https://...">
        </div>
        <div class="nv-admin-form-row">
          <label>Email Domain</label>
          <input type="text" id="nv-sso-domain" value="${ssoConfig?.domain || ''}" class="nv-admin-input" placeholder="acme.com">
        </div>
        <button class="nv-btn nv-btn-primary" id="nv-sso-save">Save SSO Configuration</button>
      </div>
      <div class="nv-admin-scim-section">
        <h3 class="nv-admin-subsection-title">SCIM Provisioning</h3>
        <p class="nv-admin-help-text">Generate a SCIM token to enable automated user provisioning via Okta, Azure AD, or other identity providers.</p>
        <button class="nv-btn nv-btn-secondary" id="nv-scim-generate">Generate SCIM Token</button>
        <div id="nv-scim-token-display" style="display:none" class="nv-admin-token-display"></div>
      </div>
    </div>
  `;

  el.querySelector('#nv-sso-save')?.addEventListener('click', async () => {
    const provider    = el.querySelector('#nv-sso-provider').value;
    const metadataUrl = el.querySelector('#nv-sso-metadata').value;
    const domain      = el.querySelector('#nv-sso-domain').value;
    if (!provider || !metadataUrl || !domain) {
      _showToast('Please fill in all SSO fields.', 'error');
      return;
    }
    try {
      await orgService.configureSso({ provider, metadataUrl, domain });
      _showToast('SSO configuration saved.', 'success');
      _renderTab('sso');
    } catch (err) {
      _showToast(err.message, 'error');
    }
  });

  el.querySelector('#nv-scim-generate')?.addEventListener('click', async () => {
    try {
      const token = await orgService.generateScimToken();
      const display = el.querySelector('#nv-scim-token-display');
      display.style.display = 'block';
      display.innerHTML = `
        <p class="nv-admin-help-text">Copy this token — it will not be shown again.</p>
        <code class="nv-admin-token">${token}</code>
        <button class="nv-btn nv-btn-ghost nv-btn-sm" onclick="navigator.clipboard.writeText('${token}')">Copy</button>
      `;
    } catch (err) {
      _showToast(err.message, 'error');
    }
  });
}

// ─── Billing Tab ──────────────────────────────────────────────────────────────

async function _renderBilling(el) {
  const org = orgService.getActiveOrg();

  el.innerHTML = `
    <div class="nv-admin-section">
      <h2 class="nv-admin-section-title">Billing</h2>
      <div class="nv-admin-billing-plan">
        <div class="nv-admin-plan-card">
          <div class="nv-admin-plan-name">${org?.plan?.toUpperCase() || 'FREE'}</div>
          <div class="nv-admin-plan-desc">Current plan</div>
        </div>
      </div>
      <div class="nv-admin-billing-actions">
        <button class="nv-btn nv-btn-primary" id="nv-billing-portal">Manage Subscription</button>
        <button class="nv-btn nv-btn-secondary" id="nv-billing-upgrade">Upgrade Plan</button>
      </div>
      <p class="nv-admin-help-text">Manage your subscription, invoices, and payment methods in the billing portal.</p>
    </div>
  `;

  el.querySelector('#nv-billing-portal')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('nuvra:open-billing-portal'));
  });
  el.querySelector('#nv-billing-upgrade')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('nuvra:open-upgrade-modal'));
  });
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function _showToast(message, type = 'info') {
  // Delegate to the global showToast helper if available
  if (typeof window.showToast === 'function') {
    window.showToast(message, type);
    return;
  }
  const toast = document.createElement('div');
  toast.className = `nv-toast nv-toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const adminConsole = { init, open, close, toggle };
