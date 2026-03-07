/**
 * Nuvra — deployPanel.js (Phase 13)
 *
 * The one-click deploy panel UI.
 *
 * Tabs:
 *  1. Deploy     — one-click deploy button, environment selector, active pack list
 *  2. History    — deploy history with rollback buttons
 *  3. Domains    — custom domain management with DNS verification
 *  4. Monitoring — uptime, build log, traffic stats
 *
 * @module deployPanel
 */
'use strict';

import { hostingManager }       from '../hosting/hostingManager.js';
import { deployHistory }        from '../hosting/deployHistory.js';
import { domainManager }        from '../hosting/domainManager.js';
import { observabilityService } from '../hosting/observabilityService.js';
import { packRuntime }          from '../design-packs/packRuntime.js';

// ─── DeployPanel ─────────────────────────────────────────────────────────────

class DeployPanel {
  constructor() {
    this._projectId   = null;
    this._projectMeta = null;
    this._el          = null;
    this._activeTab   = 'deploy';
    this._deploying   = false;
  }

  // ─── Initialization ──────────────────────────────────────────────────────────

  init({ projectId, projectMeta }) {
    this._projectId   = projectId;
    this._projectMeta = projectMeta;
    this._render();
    this._bindEvents();
  }

  show() {
    if (!this._el) return;
    this._el.classList.add('open');
    this._refreshActiveTab();
  }

  hide() {
    if (!this._el) return;
    this._el.classList.remove('open');
  }

  toggle() {
    if (!this._el) return;
    if (this._el.classList.contains('open')) this.hide();
    else this.show();
  }

  updateProject(projectId, projectMeta) {
    this._projectId   = projectId;
    this._projectMeta = projectMeta;
    if (this._el) this._refreshActiveTab();
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  _render() {
    // Remove any existing panel
    const existing = document.getElementById('nv-deploy-panel');
    if (existing) existing.remove();

    this._el = document.createElement('div');
    this._el.id = 'nv-deploy-panel';
    this._el.className = 'nv-deploy-panel';
    this._el.innerHTML = `
      <div class="nv-deploy-panel__header">
        <h2 class="nv-deploy-panel__title">Deploy</h2>
        <button class="nv-deploy-panel__close" id="nv-deploy-panel-close" aria-label="Close">✕</button>
      </div>
      <nav class="nv-deploy-panel__tabs" role="tablist">
        <button class="nv-deploy-tab active" data-tab="deploy"      role="tab">🚀 Deploy</button>
        <button class="nv-deploy-tab"        data-tab="history"     role="tab">📋 History</button>
        <button class="nv-deploy-tab"        data-tab="domains"     role="tab">🌐 Domains</button>
        <button class="nv-deploy-tab"        data-tab="monitoring"  role="tab">📊 Monitoring</button>
      </nav>
      <div class="nv-deploy-panel__body" id="nv-deploy-panel-body">
        <!-- Tab content rendered dynamically -->
      </div>
    `;

    document.body.appendChild(this._el);
  }

  _bindEvents() {
    if (!this._el) return;

    // Close button
    this._el.querySelector('#nv-deploy-panel-close')?.addEventListener('click', () => this.hide());

    // Tab switching
    this._el.querySelectorAll('.nv-deploy-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this._activeTab = btn.dataset.tab;
        this._el.querySelectorAll('.nv-deploy-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._refreshActiveTab();
      });
    });
  }

  _refreshActiveTab() {
    const body = this._el?.querySelector('#nv-deploy-panel-body');
    if (!body) return;

    switch (this._activeTab) {
      case 'deploy':     body.innerHTML = this._renderDeployTab();     this._bindDeployTab(body);     break;
      case 'history':    body.innerHTML = this._renderHistoryTab();    this._bindHistoryTab(body);    break;
      case 'domains':    body.innerHTML = this._renderDomainsTab();    this._bindDomainsTab(body);    break;
      case 'monitoring': body.innerHTML = this._renderMonitoringTab(); this._bindMonitoringTab(body); break;
    }
  }

  // ─── Deploy Tab ──────────────────────────────────────────────────────────────

  _renderDeployTab() {
    const latest = deployHistory.getLatest(this._projectId);
    const activePacks = packRuntime.getActivePacks();

    const latestHtml = latest
      ? `<div class="nv-deploy-latest">
           <span class="nv-deploy-status-dot ${latest.status === 'live' ? 'live' : 'down'}"></span>
           <span>Last deploy: ${_relativeTime(latest.deployedAt)}</span>
           ${latest.liveUrl ? `<a href="${latest.liveUrl}" target="_blank" class="nv-deploy-link">View live ↗</a>` : ''}
         </div>`
      : `<div class="nv-deploy-latest nv-deploy-latest--none">No deployments yet</div>`;

    const packsHtml = activePacks.length > 0
      ? `<div class="nv-deploy-packs">
           <p class="nv-deploy-section-label">Active Design Packs</p>
           ${activePacks.map(p => `<span class="nv-pack-badge">${p.name}</span>`).join('')}
         </div>`
      : '';

    return `
      <div class="nv-deploy-tab-content">
        ${latestHtml}
        <div class="nv-deploy-env-row">
          <label class="nv-deploy-section-label" for="nv-deploy-env">Environment</label>
          <select id="nv-deploy-env" class="nv-deploy-select">
            <option value="production">Production</option>
            <option value="preview">Preview</option>
          </select>
          <label class="nv-deploy-section-label" for="nv-deploy-region">Region</label>
          <select id="nv-deploy-region" class="nv-deploy-select">
            <option value="auto">Auto (nearest)</option>
            <option value="us-east-1">US East</option>
            <option value="eu-west-1">EU West</option>
            <option value="ap-southeast-1">Asia Pacific</option>
          </select>
        </div>
        ${packsHtml}
        <div class="nv-deploy-progress" id="nv-deploy-progress" style="display:none">
          <div class="nv-deploy-progress__bar" id="nv-deploy-progress-bar" style="width:0%"></div>
          <p class="nv-deploy-progress__msg" id="nv-deploy-progress-msg">Preparing…</p>
        </div>
        <div class="nv-deploy-step-log" id="nv-deploy-step-log" style="display:none"></div>
        <button class="nv-deploy-btn" id="nv-deploy-btn" ${this._deploying ? 'disabled' : ''}>
          ${this._deploying ? '⏳ Deploying…' : '🚀 Deploy Now'}
        </button>
      </div>
    `;
  }

  _bindDeployTab(body) {
    const deployBtn = body.querySelector('#nv-deploy-btn');
    if (!deployBtn) return;

    deployBtn.addEventListener('click', async () => {
      if (this._deploying) return;
      this._deploying = true;
      deployBtn.disabled = true;
      deployBtn.textContent = '⏳ Deploying…';

      const env    = body.querySelector('#nv-deploy-env')?.value    || 'production';
      const region = body.querySelector('#nv-deploy-region')?.value || 'auto';

      const progressEl = body.querySelector('#nv-deploy-progress');
      const progressBar = body.querySelector('#nv-deploy-progress-bar');
      const progressMsg = body.querySelector('#nv-deploy-progress-msg');
      const stepLog     = body.querySelector('#nv-deploy-step-log');

      if (progressEl) progressEl.style.display = 'block';
      if (stepLog)    stepLog.style.display    = 'block';

      const result = await hostingManager.deploy({
        projectId:   this._projectId,
        projectMeta: this._projectMeta,
        environment: env,
        region,
        onProgress: (pct, msg) => {
          if (progressBar) progressBar.style.width = `${pct}%`;
          if (progressMsg) progressMsg.textContent = msg;
          if (stepLog) {
            const line = document.createElement('div');
            line.className = 'nv-deploy-log-line';
            line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
            stepLog.appendChild(line);
            stepLog.scrollTop = stepLog.scrollHeight;
          }
        },
      });

      this._deploying = false;
      deployBtn.disabled = false;

      if (result.ok) {
        deployBtn.textContent = '✅ Deployed!';
        if (progressMsg) progressMsg.textContent = `Live at: ${result.liveUrl || 'local preview'}`;
        setTimeout(() => {
          deployBtn.textContent = '🚀 Deploy Now';
          this._refreshActiveTab();
        }, 3000);
      } else {
        deployBtn.textContent = '❌ Deploy Failed';
        if (progressMsg) progressMsg.textContent = result.error || 'Unknown error';
        setTimeout(() => {
          deployBtn.textContent = '🚀 Deploy Now';
        }, 5000);
      }
    });
  }

  // ─── History Tab ─────────────────────────────────────────────────────────────

  _renderHistoryTab() {
    const history = deployHistory.getAll(this._projectId);
    if (history.length === 0) {
      return `<div class="nv-deploy-tab-content"><p class="nv-deploy-empty">No deployments yet.</p></div>`;
    }

    const rows = history.map(d => `
      <div class="nv-deploy-history-row ${d.status === 'live' ? 'live' : ''}">
        <div class="nv-deploy-history-meta">
          <span class="nv-deploy-status-dot ${d.status === 'live' ? 'live' : d.status === 'failed' ? 'error' : 'down'}"></span>
          <span class="nv-deploy-history-time">${_relativeTime(d.deployedAt)}</span>
          <span class="nv-deploy-history-env">${d.environment || '—'}</span>
          <span class="nv-deploy-history-region">${d.region || '—'}</span>
          ${d.liveUrl ? `<a href="${d.liveUrl}" target="_blank" class="nv-deploy-link">↗</a>` : ''}
        </div>
        <div class="nv-deploy-history-actions">
          ${d.status !== 'live' && d.status !== 'failed'
            ? `<button class="nv-btn-sm" data-rollback="${d.deployId}">Rollback</button>`
            : d.status === 'live' ? '<span class="nv-deploy-badge-live">LIVE</span>' : '<span class="nv-deploy-badge-failed">FAILED</span>'}
        </div>
      </div>
    `).join('');

    return `<div class="nv-deploy-tab-content"><div class="nv-deploy-history">${rows}</div></div>`;
  }

  _bindHistoryTab(body) {
    body.querySelectorAll('[data-rollback]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const deployId = btn.dataset.rollback;
        btn.disabled = true;
        btn.textContent = 'Rolling back…';
        const result = await hostingManager.rollback({ projectId: this._projectId, deployId });
        if (result.ok) {
          this._refreshActiveTab();
        } else {
          btn.textContent = 'Failed';
          setTimeout(() => { btn.disabled = false; btn.textContent = 'Rollback'; }, 3000);
        }
      });
    });
  }

  // ─── Domains Tab ─────────────────────────────────────────────────────────────

  _renderDomainsTab() {
    const domains = domainManager.getCustomDomains(this._projectId);
    const primaryUrl = domainManager.getPrimaryUrl(this._projectId, this._projectMeta?.slug);

    const domainRows = domains.map(d => `
      <div class="nv-domain-row">
        <div class="nv-domain-info">
          <span class="nv-domain-name">${d.domain}</span>
          <span class="nv-domain-status nv-domain-status--${d.status}">${d.status.replace('_', ' ')}</span>
          ${d.isPrimary ? '<span class="nv-domain-primary-badge">PRIMARY</span>' : ''}
        </div>
        ${d.status === 'pending_verification' ? `
          <div class="nv-domain-dns-record">
            <p class="nv-domain-dns-label">Add this DNS TXT record:</p>
            <code class="nv-domain-dns-code">Name: ${d.dnsRecord.name}<br>Value: ${d.dnsRecord.value}</code>
            <button class="nv-btn-sm" data-check-domain="${d.domain}">Check Verification</button>
          </div>
        ` : ''}
        <div class="nv-domain-actions">
          ${!d.isPrimary && d.status === 'active' ? `<button class="nv-btn-sm" data-set-primary="${d.domain}">Set Primary</button>` : ''}
          <button class="nv-btn-sm nv-btn-danger" data-remove-domain="${d.domain}">Remove</button>
        </div>
      </div>
    `).join('');

    return `
      <div class="nv-deploy-tab-content">
        <div class="nv-domain-primary-url">
          <p class="nv-deploy-section-label">Live URL</p>
          <a href="${primaryUrl}" target="_blank" class="nv-domain-primary-link">${primaryUrl}</a>
        </div>
        <div class="nv-domain-list">${domainRows || '<p class="nv-deploy-empty">No custom domains added.</p>'}</div>
        <div class="nv-domain-add-row">
          <input type="text" id="nv-domain-input" class="nv-domain-input" placeholder="yourdomain.com">
          <button class="nv-btn-sm" id="nv-domain-add-btn">Add Domain</button>
        </div>
      </div>
    `;
  }

  _bindDomainsTab(body) {
    body.querySelector('#nv-domain-add-btn')?.addEventListener('click', async () => {
      const input = body.querySelector('#nv-domain-input');
      const domain = input?.value?.trim();
      if (!domain) return;
      const result = await domainManager.addCustomDomain(this._projectId, domain);
      if (result.ok) {
        if (input) input.value = '';
        this._refreshActiveTab();
      } else {
        alert(result.error || 'Failed to add domain.');
      }
    });

    body.querySelectorAll('[data-check-domain]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const result = await domainManager.checkVerification(this._projectId, btn.dataset.checkDomain);
        this._refreshActiveTab();
      });
    });

    body.querySelectorAll('[data-set-primary]').forEach(btn => {
      btn.addEventListener('click', () => {
        domainManager.setPrimaryDomain(this._projectId, btn.dataset.setPrimary);
        this._refreshActiveTab();
      });
    });

    body.querySelectorAll('[data-remove-domain]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Remove domain "${btn.dataset.removeDomain}"?`)) return;
        await domainManager.removeCustomDomain(this._projectId, btn.dataset.removeDomain);
        this._refreshActiveTab();
      });
    });
  }

  // ─── Monitoring Tab ──────────────────────────────────────────────────────────

  _renderMonitoringTab() {
    const snapshot = observabilityService.getSnapshot(this._projectId);
    const uptime   = snapshot.uptime;

    const uptimeHtml = uptime
      ? `<div class="nv-monitor-uptime">
           <span class="nv-deploy-status-dot ${uptime.isUp ? 'live' : 'down'}"></span>
           <span>${uptime.isUp ? 'Site is live' : 'Site is down'}</span>
           <span class="nv-monitor-checked">Checked ${_relativeTime(uptime.lastChecked)}</span>
         </div>`
      : `<div class="nv-monitor-uptime"><span class="nv-deploy-status-dot down"></span> Not yet deployed</div>`;

    const trafficHtml = snapshot.traffic.last7Days.length > 0
      ? `<div class="nv-monitor-traffic">
           <p class="nv-deploy-section-label">Page Views (last 7 days)</p>
           <p class="nv-monitor-total">${snapshot.traffic.totalViews.toLocaleString()} total views</p>
           <div class="nv-monitor-chart">
             ${snapshot.traffic.last7Days.map(d => `
               <div class="nv-monitor-bar-wrap" title="${d.date}: ${d.views} views">
                 <div class="nv-monitor-bar" style="height:${Math.max(4, (d.views / Math.max(...snapshot.traffic.last7Days.map(x => x.views), 1)) * 60)}px"></div>
                 <span class="nv-monitor-bar-label">${d.date.slice(5)}</span>
               </div>
             `).join('')}
           </div>
         </div>`
      : `<p class="nv-deploy-empty">No traffic data yet.</p>`;

    const buildLogHtml = snapshot.buildLog.length > 0
      ? `<div class="nv-monitor-log">
           <p class="nv-deploy-section-label">Build Log</p>
           <div class="nv-deploy-step-log">
             ${snapshot.buildLog.slice(-20).map(l =>
               `<div class="nv-deploy-log-line nv-deploy-log-${l.level}">[${l.timestamp.slice(11, 19)}] ${l.message}</div>`
             ).join('')}
           </div>
         </div>`
      : '';

    return `
      <div class="nv-deploy-tab-content">
        ${uptimeHtml}
        ${trafficHtml}
        ${buildLogHtml}
      </div>
    `;
  }

  _bindMonitoringTab(body) {
    // Auto-refresh every 30s when panel is open
    const interval = setInterval(() => {
      if (!this._el?.classList.contains('open') || this._activeTab !== 'monitoring') {
        clearInterval(interval);
        return;
      }
      this._refreshActiveTab();
    }, 30_000);
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function _relativeTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000)   return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const deployPanel = new DeployPanel();
