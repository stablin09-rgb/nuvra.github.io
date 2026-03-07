/**
 * Nuvra Runtime Kernel — runtimeConsole.js (Phase 16)
 *
 * The Runtime Console. The OS-layer control panel for the Nuvra Runtime Kernel.
 * Provides a unified interface for:
 *   - Kernel status and system health
 *   - AI Gatekeeper configuration and decision log
 *   - Compliance simulation runner and results
 *   - SOC 2 readiness assessment and roadmap
 *   - Evidence vault browser and export
 *   - Trust graph visualization
 *   - Audit replay tool
 *
 * This panel is accessible to org admins only. It is separate from the
 * Compliance Console (Phase 15) which focuses on regulatory frameworks.
 * The Runtime Console focuses on the NRK itself.
 *
 * @module ui/runtimeConsole
 */
'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let _kernel           = null;
let _gatekeeper       = null;
let _simulationEngine = null;
let _auditReplayer    = null;
let _evidenceVault    = null;
let _trustGraph       = null;
let _soc2Mapper       = null;
let _certReadiness    = null;
let _activeTab        = 'overview';
let _lastSimReport    = null;
let _lastCertReport   = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
export function init(options = {}) {
  _kernel           = options.kernel           || null;
  _gatekeeper       = options.gatekeeper       || null;
  _simulationEngine = options.simulationEngine || null;
  _auditReplayer    = options.auditReplayer    || null;
  _evidenceVault    = options.evidenceVault    || null;
  _trustGraph       = options.trustGraph       || null;
  _soc2Mapper       = options.soc2Mapper       || null;
  _certReadiness    = options.certReadiness    || null;

  _injectStyles();
  _buildPanel();
  _attachEventListeners();
}

// ─── Show / Hide ──────────────────────────────────────────────────────────────
export function show() {
  const panel = document.getElementById('nv-runtime-console');
  if (panel) {
    panel.classList.add('open');
    _renderTab(_activeTab);
  }
}

export function hide() {
  const panel = document.getElementById('nv-runtime-console');
  if (panel) panel.classList.remove('open');
}

export function toggle() {
  const panel = document.getElementById('nv-runtime-console');
  if (panel?.classList.contains('open')) hide();
  else show();
}

// ─── Panel Construction ───────────────────────────────────────────────────────
function _buildPanel() {
  if (document.getElementById('nv-runtime-console')) return;

  const panel = document.createElement('div');
  panel.id        = 'nv-runtime-console';
  panel.className = 'nv-runtime-console';
  panel.innerHTML = `
    <div class="nv-rc-header">
      <div class="nv-rc-title">
        <span class="nv-rc-icon">⚙️</span>
        <span>Runtime Console</span>
        <span class="nv-rc-subtitle">Nuvra Runtime Kernel</span>
      </div>
      <div class="nv-rc-header-actions">
        <button class="nv-rc-btn nv-rc-btn-ghost" id="nv-rc-refresh">↻ Refresh</button>
        <button class="nv-rc-close" id="nv-rc-close">✕</button>
      </div>
    </div>

    <div class="nv-rc-tabs">
      <button class="nv-rc-tab active" data-tab="overview">Overview</button>
      <button class="nv-rc-tab" data-tab="gatekeeper">AI Gatekeeper</button>
      <button class="nv-rc-tab" data-tab="simulation">Simulation</button>
      <button class="nv-rc-tab" data-tab="soc2">SOC 2</button>
      <button class="nv-rc-tab" data-tab="evidence">Evidence Vault</button>
      <button class="nv-rc-tab" data-tab="trust">Trust Graph</button>
    </div>

    <div class="nv-rc-body" id="nv-rc-body">
      <div class="nv-rc-loading">Loading...</div>
    </div>
  `;

  document.body.appendChild(panel);
}

// ─── Tab Rendering ────────────────────────────────────────────────────────────
function _renderTab(tab) {
  _activeTab = tab;
  const body = document.getElementById('nv-rc-body');
  if (!body) return;

  // Update tab active state
  document.querySelectorAll('.nv-rc-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });

  switch (tab) {
    case 'overview':    body.innerHTML = _renderOverview();    break;
    case 'gatekeeper':  body.innerHTML = _renderGatekeeper();  break;
    case 'simulation':  body.innerHTML = _renderSimulation();  break;
    case 'soc2':        body.innerHTML = _renderSOC2();        break;
    case 'evidence':    body.innerHTML = _renderEvidence();    break;
    case 'trust':       body.innerHTML = _renderTrust();       break;
    default:            body.innerHTML = '<p>Unknown tab.</p>';
  }

  _attachTabListeners(tab);
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function _renderOverview() {
  const kernelStatus  = _kernel?.getStatus()  || { initialized: false };
  const gatekeeperCfg = _gatekeeper?.getConfig() || { mode: 'unknown', rules: [] };
  const vaultStats    = _evidenceVault?.getStats() || { total: 0 };

  const systemState = _buildSystemState();
  const soc2Result  = _soc2Mapper?.evaluate(systemState);
  const score       = soc2Result?.score || '0.0';
  const level       = soc2Result?.readinessLevel || 'not-ready';

  const levelColors = {
    'not-ready':   '#ef4444',
    'in-progress': '#f59e0b',
    'type1-ready': '#3b82f6',
    'type2-ready': '#10b981',
  };
  const levelColor = levelColors[level] || '#6b7280';

  return `
    <div class="nv-rc-overview">
      <div class="nv-rc-status-grid">
        <div class="nv-rc-status-card ${kernelStatus.initialized ? 'ok' : 'error'}">
          <div class="nv-rc-status-icon">${kernelStatus.initialized ? '✅' : '❌'}</div>
          <div class="nv-rc-status-label">Runtime Kernel</div>
          <div class="nv-rc-status-value">${kernelStatus.initialized ? 'Active' : 'Not Initialized'}</div>
        </div>
        <div class="nv-rc-status-card ${gatekeeperCfg.mode !== 'unknown' ? 'ok' : 'warning'}">
          <div class="nv-rc-status-icon">${gatekeeperCfg.mode !== 'unknown' ? '🛡️' : '⚠️'}</div>
          <div class="nv-rc-status-label">AI Gatekeeper</div>
          <div class="nv-rc-status-value">${gatekeeperCfg.mode !== 'unknown' ? `Mode: ${gatekeeperCfg.mode}` : 'Not Configured'}</div>
        </div>
        <div class="nv-rc-status-card ok">
          <div class="nv-rc-status-icon">📦</div>
          <div class="nv-rc-status-label">Evidence Vault</div>
          <div class="nv-rc-status-value">${vaultStats.total} entries</div>
        </div>
        <div class="nv-rc-status-card" style="border-color: ${levelColor}">
          <div class="nv-rc-status-icon">🏆</div>
          <div class="nv-rc-status-label">SOC 2 Readiness</div>
          <div class="nv-rc-status-value" style="color: ${levelColor}">${score}% — ${level.replace(/-/g, ' ')}</div>
        </div>
      </div>

      <div class="nv-rc-section">
        <h3>Active Rules</h3>
        <div class="nv-rc-rules-list">
          ${(gatekeeperCfg.rules || []).slice(0, 5).map(r => `
            <div class="nv-rc-rule-row">
              <span class="nv-rc-rule-id">${r.id}</span>
              <span class="nv-rc-rule-desc">${r.description || r.id}</span>
              <span class="nv-rc-rule-action nv-rc-action-${r.action}">${r.action}</span>
            </div>
          `).join('') || '<p class="nv-rc-empty">No rules configured.</p>'}
          ${(gatekeeperCfg.rules || []).length > 5 ? `<p class="nv-rc-more">+${(gatekeeperCfg.rules || []).length - 5} more rules</p>` : ''}
        </div>
      </div>

      <div class="nv-rc-section">
        <h3>Quick Actions</h3>
        <div class="nv-rc-quick-actions">
          <button class="nv-rc-btn" id="nv-rc-run-sim-quick">▶ Run Simulation Suite</button>
          <button class="nv-rc-btn" id="nv-rc-assess-soc2-quick">📋 Assess SOC 2 Readiness</button>
          <button class="nv-rc-btn" id="nv-rc-export-evidence-quick">📤 Export Evidence Package</button>
        </div>
      </div>
    </div>
  `;
}

// ─── Gatekeeper Tab ───────────────────────────────────────────────────────────
function _renderGatekeeper() {
  const cfg     = _gatekeeper?.getConfig() || { mode: 'permissive', rules: [] };
  const ledger  = _gatekeeper?.getLedger?.() || null;
  const entries = ledger ? ledger.query({ limit: 20 }) : [];

  return `
    <div class="nv-rc-gatekeeper">
      <div class="nv-rc-section">
        <h3>Configuration</h3>
        <div class="nv-rc-config-grid">
          <label>Mode</label>
          <select id="nv-rc-gk-mode" class="nv-rc-select">
            <option value="permissive" ${cfg.mode === 'permissive' ? 'selected' : ''}>Permissive (allow by default)</option>
            <option value="strict"     ${cfg.mode === 'strict'     ? 'selected' : ''}>Strict (deny by default)</option>
            <option value="audit"      ${cfg.mode === 'audit'      ? 'selected' : ''}>Audit only (log, don't block)</option>
          </select>
          <label>Rules</label>
          <div class="nv-rc-rule-count">${(cfg.rules || []).length} rules active</div>
        </div>
        <button class="nv-rc-btn nv-rc-btn-primary" id="nv-rc-gk-save">Save Configuration</button>
      </div>

      <div class="nv-rc-section">
        <h3>Recent Decisions (last 20)</h3>
        <div class="nv-rc-decision-log">
          ${entries.length ? entries.map(e => `
            <div class="nv-rc-decision-row nv-rc-decision-${e.decision}">
              <span class="nv-rc-decision-time">${new Date(e.timestamp).toLocaleTimeString()}</span>
              <span class="nv-rc-decision-actor">${e.actorId || 'unknown'}</span>
              <span class="nv-rc-decision-intent">${e.intent || '?'}</span>
              <span class="nv-rc-decision-badge">${e.decision}</span>
              <span class="nv-rc-decision-rule">${e.appliedRule || ''}</span>
            </div>
          `).join('') : '<p class="nv-rc-empty">No decisions recorded yet.</p>'}
        </div>
      </div>
    </div>
  `;
}

// ─── Simulation Tab ───────────────────────────────────────────────────────────
function _renderSimulation() {
  const scenarios = _simulationEngine?.listScenarios() || [];
  const report    = _lastSimReport;

  return `
    <div class="nv-rc-simulation">
      <div class="nv-rc-section">
        <h3>Compliance Simulation Suite</h3>
        <p class="nv-rc-desc">Run synthetic stress-test scenarios against the current policy configuration to validate that all controls behave correctly.</p>
        <div class="nv-rc-sim-controls">
          <button class="nv-rc-btn nv-rc-btn-primary" id="nv-rc-run-sim">▶ Run All Scenarios (${scenarios.length})</button>
          <button class="nv-rc-btn" id="nv-rc-run-sim-gdpr">Run GDPR Only</button>
          <button class="nv-rc-btn" id="nv-rc-run-sim-hipaa">Run HIPAA Only</button>
        </div>
        <div id="nv-rc-sim-progress" class="nv-rc-sim-progress" style="display:none">
          <div class="nv-rc-progress-bar"><div class="nv-rc-progress-fill" id="nv-rc-sim-fill"></div></div>
          <div id="nv-rc-sim-status" class="nv-rc-sim-status">Running...</div>
        </div>
      </div>

      ${report ? `
        <div class="nv-rc-section">
          <h3>Last Run Results</h3>
          <div class="nv-rc-sim-summary nv-rc-sim-${report.overallStatus}">
            <div class="nv-rc-sim-stat"><span>${report.passed}</span><label>Passed</label></div>
            <div class="nv-rc-sim-stat"><span>${report.failed}</span><label>Failed</label></div>
            <div class="nv-rc-sim-stat"><span>${report.criticalFailures}</span><label>Critical</label></div>
            <div class="nv-rc-sim-stat"><span>${report.passRate}%</span><label>Pass Rate</label></div>
          </div>
          <div class="nv-rc-sim-results">
            ${report.results.map(r => `
              <div class="nv-rc-sim-result nv-rc-sim-result-${r.status}">
                <span class="nv-rc-sim-result-icon">${r.status === 'pass' ? '✅' : r.status === 'warning' ? '⚠️' : '❌'}</span>
                <div class="nv-rc-sim-result-info">
                  <div class="nv-rc-sim-result-name">${r.scenarioName}</div>
                  <div class="nv-rc-sim-result-msg">${r.message}</div>
                </div>
                <span class="nv-rc-sim-result-severity">${r.severity}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : '<p class="nv-rc-empty nv-rc-section">No simulation results yet. Run the suite above.</p>'}
    </div>
  `;
}

// ─── SOC 2 Tab ────────────────────────────────────────────────────────────────
function _renderSOC2() {
  const systemState = _buildSystemState();
  const report      = _lastCertReport || (_certReadiness ? _certReadiness.assess(systemState) : null);

  if (!report) {
    return `
      <div class="nv-rc-section">
        <h3>SOC 2 Readiness Assessment</h3>
        <p>Certification readiness module not initialized.</p>
      </div>
    `;
  }

  const levelColors = {
    'not-ready':   '#ef4444',
    'in-progress': '#f59e0b',
    'type1-ready': '#3b82f6',
    'type2-ready': '#10b981',
  };
  const levelColor = levelColors[report.readinessLevel] || '#6b7280';

  return `
    <div class="nv-rc-soc2">
      <div class="nv-rc-section">
        <div class="nv-rc-soc2-header">
          <div class="nv-rc-soc2-score" style="color: ${levelColor}">${report.score}%</div>
          <div class="nv-rc-soc2-level" style="color: ${levelColor}">${report.readinessLevel.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</div>
          <div class="nv-rc-soc2-meta">${report.metCriteria}/${report.totalCriteria} criteria met</div>
        </div>
        <button class="nv-rc-btn" id="nv-rc-soc2-reassess">↻ Re-assess</button>
      </div>

      <div class="nv-rc-section">
        <h3>By Category</h3>
        <div class="nv-rc-soc2-categories">
          ${Object.entries(report.byCategory).map(([cat, data]) => `
            <div class="nv-rc-soc2-category">
              <div class="nv-rc-soc2-cat-header">
                <span class="nv-rc-soc2-cat-name">${_categoryName(cat)}</span>
                <span class="nv-rc-soc2-cat-score">${data.met}/${data.total}</span>
              </div>
              <div class="nv-rc-progress-bar">
                <div class="nv-rc-progress-fill" style="width: ${data.total ? (data.met/data.total*100).toFixed(0) : 0}%; background: ${data.met === data.total ? '#10b981' : '#f59e0b'}"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      ${report.remediationSteps.length > 0 ? `
        <div class="nv-rc-section">
          <h3>Remediation Roadmap (${report.estimatedDaysToType1} days to Type I)</h3>
          <div class="nv-rc-remediation">
            ${report.remediationSteps.map((step, i) => `
              <div class="nv-rc-remediation-step">
                <div class="nv-rc-remediation-num">${i + 1}</div>
                <div class="nv-rc-remediation-info">
                  <div class="nv-rc-remediation-desc">${step.description}</div>
                  <div class="nv-rc-remediation-meta">Affects: ${step.affectedCriteria.join(', ')} · Est. ${step.estimatedDays}d</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : `<div class="nv-rc-section"><p class="nv-rc-success">✅ All SOC 2 criteria are met. Ready for audit.</p></div>`}

      <div class="nv-rc-section">
        <h3>Evidence Checklist</h3>
        <div class="nv-rc-checklist">
          ${report.evidenceChecklist.map(item => `
            <div class="nv-rc-checklist-item ${item.available ? 'available' : 'unavailable'}">
              <span>${item.available ? '✅' : '⬜'}</span>
              <div>
                <div class="nv-rc-checklist-name">${item.item}</div>
                <div class="nv-rc-checklist-desc">${item.description}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

// ─── Evidence Vault Tab ───────────────────────────────────────────────────────
function _renderEvidence() {
  const stats   = _evidenceVault?.getStats() || { total: 0, byType: {} };
  const entries = _evidenceVault?.query({ limit: 30 }) || [];

  return `
    <div class="nv-rc-evidence">
      <div class="nv-rc-section">
        <h3>Evidence Vault</h3>
        <div class="nv-rc-evidence-stats">
          <div class="nv-rc-evidence-stat"><span>${stats.total}</span><label>Total Entries</label></div>
          <div class="nv-rc-evidence-stat"><span>${stats.legalHold || 0}</span><label>Legal Hold</label></div>
          ${Object.entries(stats.byType || {}).slice(0, 3).map(([type, count]) => `
            <div class="nv-rc-evidence-stat"><span>${count}</span><label>${type.replace(/_/g, ' ')}</label></div>
          `).join('')}
        </div>
        <button class="nv-rc-btn" id="nv-rc-export-evidence">📤 Export Evidence Package</button>
      </div>

      <div class="nv-rc-section">
        <h3>Recent Entries</h3>
        <div class="nv-rc-evidence-list">
          ${entries.length ? entries.map(e => `
            <div class="nv-rc-evidence-entry">
              <span class="nv-rc-evidence-type">${e.type}</span>
              <span class="nv-rc-evidence-time">${new Date(e.timestamp).toLocaleString()}</span>
              ${e.legalHold ? '<span class="nv-rc-legal-hold">⚖️ Legal Hold</span>' : ''}
            </div>
          `).join('') : '<p class="nv-rc-empty">No evidence entries yet.</p>'}
        </div>
      </div>
    </div>
  `;
}

// ─── Trust Graph Tab ──────────────────────────────────────────────────────────
function _renderTrust() {
  const nodes = _trustGraph?.getAllNodes() || [];

  const levelColors = {
    verified:  '#10b981',
    high:      '#3b82f6',
    medium:    '#f59e0b',
    low:       '#ef4444',
    untrusted: '#6b7280',
  };

  return `
    <div class="nv-rc-trust">
      <div class="nv-rc-section">
        <h3>Zero-Trust Graph</h3>
        <p class="nv-rc-desc">Trust is never assumed — it is always computed from evidence. Every actor's trust score is derived from their verification status, behavioral history, and role.</p>
      </div>
      <div class="nv-rc-section">
        <h3>Actor Trust Scores (${nodes.length} actors)</h3>
        <div class="nv-rc-trust-nodes">
          ${nodes.length ? nodes.map(node => `
            <div class="nv-rc-trust-node">
              <div class="nv-rc-trust-actor">
                <span class="nv-rc-trust-type">${node.actorType}</span>
                <span class="nv-rc-trust-id">${node.actorId}</span>
              </div>
              <div class="nv-rc-trust-score-bar">
                <div class="nv-rc-progress-bar">
                  <div class="nv-rc-progress-fill" style="width: ${node.score}%; background: ${levelColors[node.level] || '#6b7280'}"></div>
                </div>
                <span class="nv-rc-trust-score-val" style="color: ${levelColors[node.level] || '#6b7280'}">${node.score} — ${node.level}</span>
              </div>
            </div>
          `).join('') : '<p class="nv-rc-empty">No trust nodes recorded yet. Trust scores are built as actors interact with the system.</p>'}
        </div>
      </div>
    </div>
  `;
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
function _attachEventListeners() {
  document.addEventListener('click', (e) => {
    if (e.target.id === 'nv-rc-close') hide();
    if (e.target.id === 'nv-rc-refresh') _renderTab(_activeTab);
    if (e.target.classList.contains('nv-rc-tab')) _renderTab(e.target.dataset.tab);
  });
}

function _attachTabListeners(tab) {
  // Overview quick actions
  document.getElementById('nv-rc-run-sim-quick')?.addEventListener('click', () => _renderTab('simulation'));
  document.getElementById('nv-rc-assess-soc2-quick')?.addEventListener('click', () => _renderTab('soc2'));
  document.getElementById('nv-rc-export-evidence-quick')?.addEventListener('click', () => _exportEvidence());

  // Simulation tab
  document.getElementById('nv-rc-run-sim')?.addEventListener('click', () => _runSimulation());
  document.getElementById('nv-rc-run-sim-gdpr')?.addEventListener('click', () => _runSimulation({ frameworks: ['gdpr'] }));
  document.getElementById('nv-rc-run-sim-hipaa')?.addEventListener('click', () => _runSimulation({ frameworks: ['hipaa'] }));

  // SOC 2 tab
  document.getElementById('nv-rc-soc2-reassess')?.addEventListener('click', () => {
    _lastCertReport = null;
    _renderTab('soc2');
  });

  // Evidence tab
  document.getElementById('nv-rc-export-evidence')?.addEventListener('click', () => _exportEvidence());

  // Gatekeeper tab
  document.getElementById('nv-rc-gk-save')?.addEventListener('click', () => {
    const mode = document.getElementById('nv-rc-gk-mode')?.value;
    if (_gatekeeper && mode) {
      _gatekeeper.setMode?.(mode);
      _showToast('Gatekeeper configuration saved.');
    }
  });
}

// ─── Actions ──────────────────────────────────────────────────────────────────
async function _runSimulation(options = {}) {
  if (!_simulationEngine) return _showToast('Simulation engine not initialized.', 'error');

  const progressBar = document.getElementById('nv-rc-sim-progress');
  const fillBar     = document.getElementById('nv-rc-sim-fill');
  const statusEl    = document.getElementById('nv-rc-sim-status');

  if (progressBar) progressBar.style.display = 'block';

  const scenarios = _simulationEngine.listScenarios();
  let completed   = 0;

  try {
    _lastSimReport = await _simulationEngine.runAll({
      ...options,
      onProgress: (scenario, result) => {
        completed++;
        const pct = (completed / scenarios.length * 100).toFixed(0);
        if (fillBar)  fillBar.style.width = `${pct}%`;
        if (statusEl) statusEl.textContent = `Running: ${scenario.name} (${pct}%)`;
      },
    });
  } catch (e) {
    _showToast(`Simulation error: ${e.message}`, 'error');
  }

  if (progressBar) progressBar.style.display = 'none';
  _renderTab('simulation');
}

function _exportEvidence() {
  if (!_evidenceVault) return _showToast('Evidence vault not initialized.', 'error');
  const pkg  = _evidenceVault.generatePackage({ projectId: null });
  const blob = new Blob([pkg], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `nuvra-evidence-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  _showToast('Evidence package exported.');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _buildSystemState() {
  return {
    policyEngine:         { active: !!_kernel },
    auditLogger:          { active: true },
    complianceEngine:     { active: true, lastEvaluation: Date.now(), frameworks: ['gdpr'] },
    aiGatekeeper:         { active: !!_gatekeeper },
    authManager:          { active: true },
    identityService:      { active: false },
    dataClassifier:       { active: true },
    observabilityService: { active: false },
    supplyChainSecurity:  { active: true },
    explainabilityLedger: { active: !!_gatekeeper },
    permissionModel:      { active: true },
    pluginSandbox:        { active: true },
  };
}

function _categoryName(cat) {
  const names = { CC: 'Common Criteria (Security)', A: 'Availability', C: 'Confidentiality', PI: 'Processing Integrity', P: 'Privacy' };
  return names[cat] || cat;
}

function _showToast(msg, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `nv-toast nv-toast-${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ─── CSS Injection ────────────────────────────────────────────────────────────
function _injectStyles() {
  if (document.getElementById('nv-rc-styles')) return;
  // Styles are in styles.css; this is a no-op guard
}

export const runtimeConsole = { init, show, hide, toggle };
export default runtimeConsole;
