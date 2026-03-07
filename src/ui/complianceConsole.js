/**
 * Nuvra — complianceConsole.js (Phase 15)
 *
 * The Compliance Console — a full-screen management UI for:
 *   - Compliance Dashboard (risk score, framework status, active violations)
 *   - Violation Viewer (filterable, actionable, with remediation guidance)
 *   - Policy Editor (enable/disable frameworks, configure rules)
 *   - Forensics & Audit Log (hash-chain verification, export, legal hold)
 *   - Data Classification Map (what data classes exist, where they are used)
 *   - Supply Chain Security (installed plugin trust scores, threat analysis)
 *
 * @module ui/complianceConsole
 */
'use strict';

// ─── Internal State ───────────────────────────────────────────────────────────
let _complianceEngine  = null;
let _auditLogger       = null;
let _threatModeler     = null;
let _supplyChainSec    = null;
let _dataClassifier    = null;
let _jurisdictionRules = null;
let _policyRegistry    = null;
let _currentTab        = 'dashboard';
let _panelEl           = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _el(id) { return document.getElementById(id); }

function _formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

function _severityBadge(severity) {
  const map = {
    blocker:  { label: 'Blocker',  bg: '#dc2626', color: '#fff' },
    critical: { label: 'Critical', bg: '#dc2626', color: '#fff' },
    high:     { label: 'High',     bg: '#ea580c', color: '#fff' },
    medium:   { label: 'Medium',   bg: '#d97706', color: '#fff' },
    low:      { label: 'Low',      bg: '#65a30d', color: '#fff' },
    info:     { label: 'Info',     bg: '#6b7280', color: '#fff' },
    warn:     { label: 'Warn',     bg: '#d97706', color: '#fff' },
    error:    { label: 'Error',    bg: '#dc2626', color: '#fff' },
  };
  const s = map[severity] || map.info;
  return `<span class="nv-badge" style="background:${s.bg};color:${s.color}">${s.label}</span>`;
}

// ─── Tab Renderers ────────────────────────────────────────────────────────────
function _renderDashboard() {
  const report    = _complianceEngine?.generateReport?.() || {};
  const riskScore = report.overallRiskScore ?? 0;
  const riskColor = riskScore >= 70 ? '#dc2626' : riskScore >= 40 ? '#d97706' : '#16a34a';
  const frameworks = report.frameworks || [];
  const violations = report.violations || [];
  const blockers   = violations.filter(v => v.severity === 'blocker' && !v.acknowledged);
  const warnings   = violations.filter(v => v.severity !== 'blocker' && !v.acknowledged);

  return `
    <div class="nv-cc-section">
      <h3 class="nv-cc-section-title">Compliance Overview</h3>
      <div class="nv-cc-kpi-row">
        <div class="nv-cc-kpi" style="border-color:${riskColor}">
          <div class="nv-cc-kpi-value" style="color:${riskColor}">${riskScore}</div>
          <div class="nv-cc-kpi-label">Risk Score</div>
        </div>
        <div class="nv-cc-kpi">
          <div class="nv-cc-kpi-value" style="color:#dc2626">${blockers.length}</div>
          <div class="nv-cc-kpi-label">Blockers</div>
        </div>
        <div class="nv-cc-kpi">
          <div class="nv-cc-kpi-value" style="color:#d97706">${warnings.length}</div>
          <div class="nv-cc-kpi-label">Warnings</div>
        </div>
        <div class="nv-cc-kpi">
          <div class="nv-cc-kpi-value">${frameworks.filter(f => f.enabled).length}</div>
          <div class="nv-cc-kpi-label">Active Frameworks</div>
        </div>
      </div>
    </div>

    <div class="nv-cc-section">
      <h3 class="nv-cc-section-title">Active Frameworks</h3>
      <div class="nv-cc-framework-grid">
        ${frameworks.map(f => `
          <div class="nv-cc-framework-card ${f.enabled ? 'enabled' : 'disabled'}">
            <div class="nv-cc-fw-name">${f.name}</div>
            <div class="nv-cc-fw-status">${f.enabled ? '✓ Active' : '○ Inactive'}</div>
            <div class="nv-cc-fw-score">Score: ${f.score ?? '—'}</div>
          </div>
        `).join('')}
        ${frameworks.length === 0 ? '<div class="nv-cc-empty">No frameworks configured. Go to Policy Editor to enable frameworks.</div>' : ''}
      </div>
    </div>

    ${blockers.length > 0 ? `
    <div class="nv-cc-section nv-cc-section-alert">
      <h3 class="nv-cc-section-title">⚠ Active Blockers</h3>
      ${blockers.slice(0, 5).map(v => `
        <div class="nv-cc-violation-row blocker">
          ${_severityBadge('blocker')}
          <span class="nv-cc-viol-desc">${v.description}</span>
          <span class="nv-cc-viol-rule">${v.ruleId}</span>
          <button class="nv-cc-btn-sm" onclick="window.__nuvraComplianceConsole.acknowledgeViolation('${v.ruleId}')">Acknowledge</button>
        </div>
      `).join('')}
      ${blockers.length > 5 ? `<div class="nv-cc-more">+${blockers.length - 5} more — see Violations tab</div>` : ''}
    </div>
    ` : ''}

    <div class="nv-cc-section">
      <h3 class="nv-cc-section-title">Audit Log Summary</h3>
      <div class="nv-cc-audit-summary">
        <span>Total entries: <strong>${_auditLogger?.count?.() ?? 0}</strong></span>
        <button class="nv-cc-btn-sm" onclick="window.__nuvraComplianceConsole.switchTab('forensics')">View Full Log →</button>
      </div>
    </div>
  `;
}

function _renderViolations() {
  const report     = _complianceEngine?.generateReport?.() || {};
  const violations = report.violations || [];
  if (violations.length === 0) {
    return '<div class="nv-cc-empty">No compliance violations detected. Your project is compliant with all active frameworks.</div>';
  }
  return `
    <div class="nv-cc-section">
      <h3 class="nv-cc-section-title">Violations (${violations.length})</h3>
      <div class="nv-cc-filter-row">
        <select id="nv-cc-viol-filter" onchange="window.__nuvraComplianceConsole.filterViolations(this.value)">
          <option value="all">All Severities</option>
          <option value="blocker">Blockers Only</option>
          <option value="high">High+</option>
          <option value="unacknowledged">Unacknowledged</option>
        </select>
      </div>
      <div id="nv-cc-viol-list">
        ${violations.map(v => `
          <div class="nv-cc-violation-card ${v.acknowledged ? 'acknowledged' : ''}" data-severity="${v.severity}">
            <div class="nv-cc-viol-header">
              ${_severityBadge(v.severity)}
              <span class="nv-cc-viol-rule-id">${v.ruleId}</span>
              <span class="nv-cc-viol-framework">${v.framework || ''}</span>
              ${v.acknowledged ? '<span class="nv-cc-ack-badge">Acknowledged</span>' : ''}
            </div>
            <div class="nv-cc-viol-desc">${v.description}</div>
            ${v.remediation ? `<div class="nv-cc-viol-remediation">💡 ${v.remediation}</div>` : ''}
            ${!v.acknowledged ? `
              <div class="nv-cc-viol-actions">
                <button class="nv-cc-btn-sm" onclick="window.__nuvraComplianceConsole.acknowledgeViolation('${v.ruleId}')">Acknowledge</button>
                <button class="nv-cc-btn-sm nv-cc-btn-secondary" onclick="window.__nuvraComplianceConsole.copyRemediation('${v.ruleId}')">Copy Remediation</button>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function _renderPolicyEditor() {
  const frameworks = _policyRegistry?.getAllFrameworks?.() || [];
  return `
    <div class="nv-cc-section">
      <h3 class="nv-cc-section-title">Regulatory Frameworks</h3>
      <p class="nv-cc-desc">Enable the frameworks that apply to your project. Each framework adds compliance rules that are continuously evaluated.</p>
      <div class="nv-cc-policy-list">
        ${frameworks.map(f => `
          <div class="nv-cc-policy-row">
            <div class="nv-cc-policy-info">
              <div class="nv-cc-policy-name">${f.name}</div>
              <div class="nv-cc-policy-desc">${f.description}</div>
              <div class="nv-cc-policy-meta">
                ${f.region ? `<span class="nv-cc-meta-tag">${f.region}</span>` : ''}
                ${f.industry ? `<span class="nv-cc-meta-tag">${f.industry}</span>` : ''}
                <span class="nv-cc-meta-tag">${f.rules?.length || 0} rules</span>
              </div>
            </div>
            <label class="nv-cc-toggle">
              <input type="checkbox" ${f.enabled ? 'checked' : ''}
                onchange="window.__nuvraComplianceConsole.toggleFramework('${f.id}', this.checked)">
              <span class="nv-cc-toggle-slider"></span>
            </label>
          </div>
        `).join('')}
        ${frameworks.length === 0 ? '<div class="nv-cc-empty">No frameworks available.</div>' : ''}
      </div>
    </div>

    <div class="nv-cc-section">
      <h3 class="nv-cc-section-title">Data Residency</h3>
      <div class="nv-cc-policy-row">
        <div class="nv-cc-policy-info">
          <div class="nv-cc-policy-name">Primary Jurisdiction</div>
          <div class="nv-cc-policy-desc">Where project data is stored and processed.</div>
        </div>
        <select class="nv-cc-select" onchange="window.__nuvraComplianceConsole.setJurisdiction(this.value)">
          <option value="global">Global (No Restriction)</option>
          <option value="eu">European Union (GDPR)</option>
          <option value="us">United States</option>
          <option value="us-gov">US Government (FedRAMP)</option>
          <option value="uk">United Kingdom</option>
          <option value="ca">Canada (PIPEDA)</option>
          <option value="au">Australia (Privacy Act)</option>
        </select>
      </div>
    </div>
  `;
}

function _renderForensics() {
  const entries = _auditLogger?.query?.({ limit: 100 }) || [];
  return `
    <div class="nv-cc-section">
      <h3 class="nv-cc-section-title">Audit Log</h3>
      <div class="nv-cc-forensics-toolbar">
        <button class="nv-cc-btn-sm" onclick="window.__nuvraComplianceConsole.verifyChain()">Verify Chain Integrity</button>
        <button class="nv-cc-btn-sm" onclick="window.__nuvraComplianceConsole.exportLog('json')">Export JSON</button>
        <button class="nv-cc-btn-sm" onclick="window.__nuvraComplianceConsole.exportLog('csv')">Export CSV</button>
        <button class="nv-cc-btn-sm" onclick="window.__nuvraComplianceConsole.exportLog('siem')">Export SIEM (CEF)</button>
      </div>
      <div id="nv-cc-chain-status" class="nv-cc-chain-status"></div>
      <div class="nv-cc-audit-table-wrap">
        <table class="nv-cc-audit-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Category</th>
              <th>Action</th>
              <th>Severity</th>
              <th>Actor</th>
              <th>Outcome</th>
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            ${entries.map(e => `
              <tr class="nv-cc-audit-row ${e.outcome?.success === false ? 'denied' : ''}">
                <td class="nv-cc-audit-time">${_formatDate(e.timestamp)}</td>
                <td><span class="nv-cc-cat-badge">${e.category}</span></td>
                <td class="nv-cc-audit-action">${e.action}</td>
                <td>${_severityBadge(e.severity)}</td>
                <td class="nv-cc-audit-actor">${e.actor?.id || '—'}</td>
                <td>${e.outcome?.success ? '✓' : `✗ ${e.outcome?.reason || ''}`}</td>
                <td class="nv-cc-audit-hash" title="${e.hash}">${(e.hash || '').slice(0, 8)}…</td>
              </tr>
            `).join('')}
            ${entries.length === 0 ? '<tr><td colspan="7" class="nv-cc-empty">No audit log entries yet.</td></tr>' : ''}
          </tbody>
        </table>
      </div>
      ${entries.length >= 100 ? '<div class="nv-cc-more">Showing latest 100 entries. Export for full log.</div>' : ''}
    </div>
  `;
}

function _renderSupplyChain() {
  return `
    <div class="nv-cc-section">
      <h3 class="nv-cc-section-title">Installed Plugin Security</h3>
      <p class="nv-cc-desc">Each installed plugin is analyzed for STRIDE threats. Plugins with Critical or Blocked status cannot be activated.</p>
      <div id="nv-cc-plugin-list" class="nv-cc-plugin-list">
        <div class="nv-cc-empty">Loading plugin security analysis…</div>
      </div>
    </div>
    <div class="nv-cc-section">
      <h3 class="nv-cc-section-title">Verify Asset Integrity</h3>
      <div class="nv-cc-verify-form">
        <textarea id="nv-cc-manifest-input" class="nv-cc-textarea" placeholder='Paste plugin manifest JSON here…' rows="6"></textarea>
        <textarea id="nv-cc-script-input" class="nv-cc-textarea" placeholder='Paste plugin script content here…' rows="6"></textarea>
        <button class="nv-cc-btn" onclick="window.__nuvraComplianceConsole.verifyAsset()">Verify Integrity</button>
        <div id="nv-cc-verify-result" class="nv-cc-verify-result"></div>
      </div>
    </div>
  `;
}

// ─── Public API ───────────────────────────────────────────────────────────────
export const complianceConsole = {
  /**
   * Initialize the compliance console.
   * @param {object} deps - All Phase 15 module instances
   */
  init(deps = {}) {
    _complianceEngine  = deps.complianceEngine  || null;
    _auditLogger       = deps.auditLogger       || null;
    _threatModeler     = deps.threatModeler     || null;
    _supplyChainSec    = deps.supplyChainSecurity || null;
    _dataClassifier    = deps.dataClassifier    || null;
    _jurisdictionRules = deps.jurisdictionRules || null;
    _policyRegistry    = deps.policyRegistry    || null;

    // Expose global API for inline onclick handlers
    window.__nuvraComplianceConsole = {
      switchTab:            (tab) => this.switchTab(tab),
      acknowledgeViolation: (id)  => this.acknowledgeViolation(id),
      copyRemediation:      (id)  => this.copyRemediation(id),
      filterViolations:     (f)   => this.filterViolations(f),
      toggleFramework:      (id, enabled) => this.toggleFramework(id, enabled),
      setJurisdiction:      (j)   => this.setJurisdiction(j),
      verifyChain:          ()    => this.verifyChain(),
      exportLog:            (fmt) => this.exportLog(fmt),
      verifyAsset:          ()    => this.verifyAssetFromUI(),
    };
  },

  /**
   * Open the compliance console panel.
   */
  open() {
    let panel = _el('nv-compliance-console');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'nv-compliance-console';
      panel.className = 'nv-compliance-console';
      panel.innerHTML = `
        <div class="nv-cc-header">
          <div class="nv-cc-title">🛡 Compliance Console</div>
          <div class="nv-cc-tabs">
            <button class="nv-cc-tab active" data-tab="dashboard"  onclick="window.__nuvraComplianceConsole.switchTab('dashboard')">Dashboard</button>
            <button class="nv-cc-tab"        data-tab="violations" onclick="window.__nuvraComplianceConsole.switchTab('violations')">Violations</button>
            <button class="nv-cc-tab"        data-tab="policy"     onclick="window.__nuvraComplianceConsole.switchTab('policy')">Policy Editor</button>
            <button class="nv-cc-tab"        data-tab="forensics"  onclick="window.__nuvraComplianceConsole.switchTab('forensics')">Forensics</button>
            <button class="nv-cc-tab"        data-tab="supply"     onclick="window.__nuvraComplianceConsole.switchTab('supply')">Supply Chain</button>
          </div>
          <button class="nv-cc-close" onclick="window.__nuvraComplianceConsole.switchTab('close')">✕</button>
        </div>
        <div id="nv-cc-body" class="nv-cc-body"></div>
      `;
      document.body.appendChild(panel);
    }
    _panelEl = panel;
    panel.style.display = 'flex';
    this.switchTab('dashboard');
  },

  /**
   * Close the compliance console panel.
   */
  close() {
    if (_panelEl) _panelEl.style.display = 'none';
  },

  /**
   * Switch to a tab.
   * @param {string} tab
   */
  switchTab(tab) {
    if (tab === 'close') { this.close(); return; }
    _currentTab = tab;

    // Update tab buttons
    document.querySelectorAll('.nv-cc-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Render content
    const body = _el('nv-cc-body');
    if (!body) return;
    const renderers = {
      dashboard:  _renderDashboard,
      violations: _renderViolations,
      policy:     _renderPolicyEditor,
      forensics:  _renderForensics,
      supply:     _renderSupplyChain,
    };
    body.innerHTML = (renderers[tab] || (() => ''))();
  },

  /**
   * Acknowledge a compliance violation.
   * @param {string} ruleId
   */
  acknowledgeViolation(ruleId) {
    _complianceEngine?.acknowledgeViolation?.(ruleId);
    _auditLogger?.log?.({
      category: 'compliance',
      action:   `compliance.violation.acknowledged.${ruleId}`,
      severity: 'info',
      outcome:  { success: true },
    });
    this.switchTab(_currentTab);
  },

  /**
   * Copy remediation guidance to clipboard.
   * @param {string} ruleId
   */
  copyRemediation(ruleId) {
    const report     = _complianceEngine?.generateReport?.() || {};
    const violations = report.violations || [];
    const v          = violations.find(v => v.ruleId === ruleId);
    if (v?.remediation) {
      navigator.clipboard?.writeText?.(v.remediation);
    }
  },

  /**
   * Filter violations by severity.
   * @param {string} filter
   */
  filterViolations(filter) {
    const list = _el('nv-cc-viol-list');
    if (!list) return;
    list.querySelectorAll('.nv-cc-violation-card').forEach(card => {
      const sev = card.dataset.severity;
      let show  = true;
      if (filter === 'blocker')       show = sev === 'blocker';
      if (filter === 'high')          show = ['blocker', 'critical', 'high'].includes(sev);
      if (filter === 'unacknowledged') show = !card.classList.contains('acknowledged');
      card.style.display = show ? '' : 'none';
    });
  },

  /**
   * Toggle a compliance framework on/off.
   * @param {string} frameworkId
   * @param {boolean} enabled
   */
  toggleFramework(frameworkId, enabled) {
    if (enabled) {
      _complianceEngine?.enableFramework?.(frameworkId);
    } else {
      _complianceEngine?.disableFramework?.(frameworkId);
    }
    _auditLogger?.log?.({
      category: 'compliance',
      action:   `compliance.framework.${enabled ? 'enabled' : 'disabled'}.${frameworkId}`,
      severity: 'info',
      outcome:  { success: true },
    });
  },

  /**
   * Set the primary jurisdiction for data residency.
   * @param {string} jurisdiction
   */
  setJurisdiction(jurisdiction) {
    _jurisdictionRules?.setPrimaryJurisdiction?.(jurisdiction);
    _auditLogger?.log?.({
      category: 'compliance',
      action:   `compliance.jurisdiction.set.${jurisdiction}`,
      severity: 'warn',
      outcome:  { success: true },
    });
  },

  /**
   * Verify the audit log hash chain.
   */
  async verifyChain() {
    const statusEl = _el('nv-cc-chain-status');
    if (statusEl) statusEl.innerHTML = '<span class="nv-cc-verifying">Verifying chain integrity…</span>';
    const result = await _auditLogger?.verifyChain?.();
    if (statusEl) {
      if (result?.valid) {
        statusEl.innerHTML = '<span class="nv-cc-chain-ok">✓ Chain integrity verified — no tampering detected.</span>';
      } else {
        statusEl.innerHTML = `<span class="nv-cc-chain-fail">✗ Chain integrity FAILED at entry: ${result?.brokenAt || 'unknown'}. The audit log may have been tampered with.</span>`;
      }
    }
  },

  /**
   * Export the audit log.
   * @param {'json'|'csv'|'siem'} format
   */
  exportLog(format) {
    const content  = _auditLogger?.export?.(format) || '';
    const mimeMap  = { json: 'application/json', csv: 'text/csv', siem: 'text/plain' };
    const extMap   = { json: 'json', csv: 'csv', siem: 'txt' };
    const blob     = new Blob([content], { type: mimeMap[format] || 'text/plain' });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    a.href         = url;
    a.download     = `nuvra-audit-log-${Date.now()}.${extMap[format] || 'txt'}`;
    a.click();
    URL.revokeObjectURL(url);
  },

  /**
   * Verify an asset from the UI form.
   */
  async verifyAssetFromUI() {
    const manifestInput = _el('nv-cc-manifest-input');
    const scriptInput   = _el('nv-cc-script-input');
    const resultEl      = _el('nv-cc-verify-result');
    if (!manifestInput || !scriptInput || !resultEl) return;

    let manifest;
    try {
      manifest = JSON.parse(manifestInput.value);
    } catch (_) {
      resultEl.innerHTML = '<span class="nv-cc-verify-fail">Invalid manifest JSON.</span>';
      return;
    }

    resultEl.innerHTML = '<span class="nv-cc-verifying">Verifying…</span>';
    const result = await _supplyChainSec?.verifyAsset?.(manifest, scriptInput.value);
    if (result?.verified) {
      const threat = _threatModeler?.analyzePlugin?.(manifest);
      resultEl.innerHTML = `
        <div class="nv-cc-verify-ok">
          ✓ Integrity verified. Hash: <code>${result.hash}</code>
          ${threat ? `<br>Threat score: <strong>${threat.riskScore}</strong> — ${threat.threats.length} threat(s) detected.` : ''}
        </div>
      `;
    } else {
      resultEl.innerHTML = `<div class="nv-cc-verify-fail">✗ Verification failed: ${result?.reason || 'Unknown error'}</div>`;
    }
  },
};
