/**
 * Nuvra — agentConsole.js (Phase 14)
 *
 * The Agent Console is the primary UI for the autonomous agent system.
 * It provides:
 *   - A goal input field (natural language)
 *   - Real-time plan visualization (steps, status, progress)
 *   - Proposal review cards (approve/reject with diff preview)
 *   - Pause/Resume/Cancel controls
 *   - Project memory viewer and editor
 *   - Auto-approve rule manager
 *   - Dry-run mode toggle
 *   - Agent timeline (all events, scrollable, filterable)
 *
 * @module agentConsole
 */
'use strict';

import { agentManager } from '../agents/agentManager.js';
import { MEMORY_CATEGORY } from '../agents/agentMemory.js';

// ─── AgentConsole class ───────────────────────────────────────────────────────
class AgentConsole {
  constructor() {
    this._panel         = null;
    this._unsubscribe   = null;
    this._events        = [];
    this._activePlanId  = null;
    this._currentTab    = 'run';
  }

  /**
   * Initialize the console (call after agentManager.init()).
   */
  init() {
    this._ensureDOM();
    this._bindEvents();
    this._unsubscribe = agentManager.on(event => this._handleAgentEvent(event));
  }

  /**
   * Open the agent console panel.
   */
  open() {
    this._panel?.classList.add('nv-agent-console--open');
    this._refreshMemoryTab();
    this._refreshRulesTab();
  }

  /**
   * Close the agent console panel.
   */
  close() {
    this._panel?.classList.remove('nv-agent-console--open');
  }

  /**
   * Toggle the agent console panel.
   */
  toggle() {
    if (this._panel?.classList.contains('nv-agent-console--open')) {
      this.close();
    } else {
      this.open();
    }
  }

  // ─── DOM construction ──────────────────────────────────────────────────────

  _ensureDOM() {
    if (document.getElementById('nv-agent-console')) {
      this._panel = document.getElementById('nv-agent-console');
      return;
    }

    this._panel = document.createElement('div');
    this._panel.id = 'nv-agent-console';
    this._panel.className = 'nv-agent-console';
    this._panel.innerHTML = `
      <div class="nv-agent-console__header">
        <div class="nv-agent-console__title">
          <span class="nv-agent-console__icon">🤖</span>
          <span>AI Agent</span>
          <span class="nv-agent-badge nv-agent-badge--idle" id="nv-agent-status-badge">Idle</span>
        </div>
        <div class="nv-agent-console__header-actions">
          <label class="nv-agent-toggle" title="Dry-run mode: preview changes without applying them">
            <input type="checkbox" id="nv-agent-dryrun">
            <span class="nv-agent-toggle__label">Dry Run</span>
          </label>
          <button class="nv-agent-close-btn" id="nv-agent-close-btn" title="Close">✕</button>
        </div>
      </div>

      <div class="nv-agent-console__tabs">
        <button class="nv-agent-tab nv-agent-tab--active" data-tab="run">Run</button>
        <button class="nv-agent-tab" data-tab="timeline">Timeline</button>
        <button class="nv-agent-tab" data-tab="memory">Memory</button>
        <button class="nv-agent-tab" data-tab="rules">Auto-Approve</button>
      </div>

      <!-- RUN TAB -->
      <div class="nv-agent-tab-panel nv-agent-tab-panel--active" id="nv-agent-tab-run">
        <div class="nv-agent-goal-input-area">
          <textarea
            id="nv-agent-goal-input"
            class="nv-agent-goal-input"
            placeholder="Describe your goal... e.g. 'Build a landing page for my SaaS product with a hero, features, and pricing section'"
            rows="3"
          ></textarea>
          <button class="nv-agent-run-btn" id="nv-agent-run-btn">
            <span id="nv-agent-run-btn-text">▶ Run Agent</span>
          </button>
        </div>

        <div class="nv-agent-plan-area" id="nv-agent-plan-area" style="display:none">
          <div class="nv-agent-plan-header">
            <div class="nv-agent-plan-title" id="nv-agent-plan-title">Planning...</div>
            <div class="nv-agent-plan-controls">
              <button class="nv-agent-ctrl-btn nv-agent-ctrl-btn--pause" id="nv-agent-pause-btn" title="Pause">⏸</button>
              <button class="nv-agent-ctrl-btn nv-agent-ctrl-btn--cancel" id="nv-agent-cancel-btn" title="Cancel">✕</button>
            </div>
          </div>
          <div class="nv-agent-steps" id="nv-agent-steps"></div>
        </div>

        <div class="nv-agent-proposals" id="nv-agent-proposals"></div>
      </div>

      <!-- TIMELINE TAB -->
      <div class="nv-agent-tab-panel" id="nv-agent-tab-timeline">
        <div class="nv-agent-timeline-toolbar">
          <input type="text" class="nv-agent-filter-input" id="nv-agent-timeline-filter" placeholder="Filter events...">
          <button class="nv-agent-clear-btn" id="nv-agent-clear-timeline">Clear</button>
        </div>
        <div class="nv-agent-timeline" id="nv-agent-timeline"></div>
      </div>

      <!-- MEMORY TAB -->
      <div class="nv-agent-tab-panel" id="nv-agent-tab-memory">
        <div class="nv-agent-memory-toolbar">
          <button class="nv-agent-clear-btn" id="nv-agent-clear-memory">Clear All Memory</button>
        </div>
        <div class="nv-agent-memory-sections" id="nv-agent-memory-sections"></div>
      </div>

      <!-- AUTO-APPROVE RULES TAB -->
      <div class="nv-agent-tab-panel" id="nv-agent-tab-rules">
        <div class="nv-agent-rules-info">
          Auto-approve rules let the agent apply changes without asking.
          Use with care — only for low-risk, reversible actions.
        </div>
        <div class="nv-agent-rules-list" id="nv-agent-rules-list"></div>
        <div class="nv-agent-add-rule">
          <select id="nv-agent-rule-tool" class="nv-agent-select">
            <option value="project.write.page">Write Page</option>
            <option value="project.write.data">Write Data Model</option>
            <option value="memory.write">Write Memory</option>
          </select>
          <button class="nv-agent-add-rule-btn" id="nv-agent-add-rule-btn">+ Add Rule</button>
        </div>
      </div>
    `;

    document.body.appendChild(this._panel);
  }

  // ─── Event binding ─────────────────────────────────────────────────────────

  _bindEvents() {
    // Close button
    this._panel.querySelector('#nv-agent-close-btn')?.addEventListener('click', () => this.close());

    // Tab switching
    this._panel.querySelectorAll('.nv-agent-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this._currentTab = tab.dataset.tab;
        this._panel.querySelectorAll('.nv-agent-tab').forEach(t => t.classList.remove('nv-agent-tab--active'));
        this._panel.querySelectorAll('.nv-agent-tab-panel').forEach(p => p.classList.remove('nv-agent-tab-panel--active'));
        tab.classList.add('nv-agent-tab--active');
        this._panel.querySelector(`#nv-agent-tab-${tab.dataset.tab}`)?.classList.add('nv-agent-tab-panel--active');
        if (tab.dataset.tab === 'memory') this._refreshMemoryTab();
        if (tab.dataset.tab === 'rules')  this._refreshRulesTab();
      });
    });

    // Run button
    this._panel.querySelector('#nv-agent-run-btn')?.addEventListener('click', () => this._runGoal());

    // Goal input — Ctrl+Enter to run
    this._panel.querySelector('#nv-agent-goal-input')?.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') this._runGoal();
    });

    // Pause/Cancel buttons
    this._panel.querySelector('#nv-agent-pause-btn')?.addEventListener('click', () => {
      if (this._activePlanId) agentManager.pause(this._activePlanId);
    });
    this._panel.querySelector('#nv-agent-cancel-btn')?.addEventListener('click', () => {
      if (this._activePlanId && confirm('Cancel the current agent run?')) {
        agentManager.cancel(this._activePlanId);
      }
    });

    // Dry-run toggle
    this._panel.querySelector('#nv-agent-dryrun')?.addEventListener('change', (e) => {
      agentManager.setDryRun(e.target.checked);
    });

    // Timeline filter
    this._panel.querySelector('#nv-agent-timeline-filter')?.addEventListener('input', (e) => {
      this._renderTimeline(e.target.value);
    });

    // Clear timeline
    this._panel.querySelector('#nv-agent-clear-timeline')?.addEventListener('click', () => {
      this._events = [];
      this._renderTimeline('');
    });

    // Clear memory
    this._panel.querySelector('#nv-agent-clear-memory')?.addEventListener('click', () => {
      if (confirm('Clear all project memory? This cannot be undone.')) {
        agentManager.writeMemory({ category: 'all', key: '__clear__', value: null });
        this._refreshMemoryTab();
      }
    });

    // Add auto-approve rule
    this._panel.querySelector('#nv-agent-add-rule-btn')?.addEventListener('click', () => {
      const toolName = this._panel.querySelector('#nv-agent-rule-tool')?.value;
      if (toolName) {
        agentManager.addAutoApproveRule({ toolName, toolLevel: 'suggest' });
        this._refreshRulesTab();
      }
    });
  }

  // ─── Run goal ──────────────────────────────────────────────────────────────

  async _runGoal() {
    const input = this._panel.querySelector('#nv-agent-goal-input');
    const goal  = input?.value?.trim();
    if (!goal) return;

    const runBtn = this._panel.querySelector('#nv-agent-run-btn');
    const runBtnText = this._panel.querySelector('#nv-agent-run-btn-text');
    runBtn.disabled = true;
    runBtnText.textContent = '⏳ Planning...';

    try {
      const plan = await agentManager.runGoal(goal);
      this._activePlanId = plan.id;
      this._renderPlan(plan);
    } catch (err) {
      this._addTimelineEvent({ type: 'agent:error', message: err.message });
      runBtn.disabled = false;
      runBtnText.textContent = '▶ Run Agent';
    }
  }

  // ─── Plan rendering ────────────────────────────────────────────────────────

  _renderPlan(plan) {
    const planArea = this._panel.querySelector('#nv-agent-plan-area');
    const titleEl  = this._panel.querySelector('#nv-agent-plan-title');
    const stepsEl  = this._panel.querySelector('#nv-agent-steps');

    planArea.style.display = 'block';
    titleEl.textContent = plan.goal || 'Running plan...';

    stepsEl.innerHTML = plan.steps.map(step => `
      <div class="nv-agent-step nv-agent-step--pending" id="nv-agent-step-${step.id}">
        <div class="nv-agent-step__icon">${this._agentIcon(step.agentType)}</div>
        <div class="nv-agent-step__body">
          <div class="nv-agent-step__title">${this._escHtml(step.title)}</div>
          <div class="nv-agent-step__meta">${step.agentType} · ${step.risk || 'low'} risk</div>
        </div>
        <div class="nv-agent-step__status" id="nv-agent-step-status-${step.id}">
          <span class="nv-agent-step__dot nv-agent-step__dot--pending"></span>
        </div>
      </div>
    `).join('');
  }

  _updateStepStatus(stepId, status) {
    const stepEl = this._panel.querySelector(`#nv-agent-step-${stepId}`);
    const dotEl  = this._panel.querySelector(`#nv-agent-step-status-${stepId}`);
    if (!stepEl) return;

    stepEl.className = `nv-agent-step nv-agent-step--${status}`;
    const icons = {
      running:   '<span class="nv-agent-step__dot nv-agent-step__dot--running nv-agent-spin">⟳</span>',
      complete:  '<span class="nv-agent-step__dot nv-agent-step__dot--complete">✓</span>',
      failed:    '<span class="nv-agent-step__dot nv-agent-step__dot--failed">✗</span>',
      skipped:   '<span class="nv-agent-step__dot nv-agent-step__dot--skipped">—</span>',
      pending:   '<span class="nv-agent-step__dot nv-agent-step__dot--pending"></span>',
    };
    if (dotEl) dotEl.innerHTML = icons[status] || icons.pending;
  }

  // ─── Proposal cards ────────────────────────────────────────────────────────

  _renderProposal(proposal, planId) {
    const container = this._panel.querySelector('#nv-agent-proposals');
    if (!container) return;

    const card = document.createElement('div');
    card.className = 'nv-agent-proposal-card';
    card.id = `nv-agent-proposal-${proposal.id}`;

    const toolLabel = this._toolLabel(proposal.toolName);
    const preview   = this._proposalPreview(proposal);

    card.innerHTML = `
      <div class="nv-agent-proposal-card__header">
        <span class="nv-agent-proposal-card__tool">${toolLabel}</span>
        <span class="nv-agent-proposal-card__agent">${this._agentIcon(proposal.agentType)} ${proposal.agentType}</span>
      </div>
      <div class="nv-agent-proposal-card__preview">${preview}</div>
      <div class="nv-agent-proposal-card__actions">
        <button class="nv-agent-btn nv-agent-btn--approve" data-plan="${planId}" data-proposal="${proposal.id}">
          ✓ Apply
        </button>
        <button class="nv-agent-btn nv-agent-btn--reject" data-plan="${planId}" data-proposal="${proposal.id}">
          ✗ Skip
        </button>
      </div>
    `;

    card.querySelector('.nv-agent-btn--approve').addEventListener('click', async (e) => {
      const { plan, proposal: pid } = e.target.dataset;
      await agentManager.approveProposal(plan, pid);
      card.remove();
    });

    card.querySelector('.nv-agent-btn--reject').addEventListener('click', (e) => {
      const { plan, proposal: pid } = e.target.dataset;
      const reason = prompt('Reason for skipping (optional):') || 'User skipped';
      agentManager.rejectProposal(plan, pid, reason, proposal.agentType);
      card.remove();
    });

    container.prepend(card);
  }

  // ─── Agent event handler ───────────────────────────────────────────────────

  _handleAgentEvent(event) {
    this._addTimelineEvent(event);

    const runBtn     = this._panel.querySelector('#nv-agent-run-btn');
    const runBtnText = this._panel.querySelector('#nv-agent-run-btn-text');
    const statusBadge = this._panel.querySelector('#nv-agent-status-badge');

    switch (event.type) {
      case 'agent:plan-created':
        this._activePlanId = event.plan?.id;
        this._renderPlan(event.plan);
        this._setBadge(statusBadge, 'running', 'Running');
        break;

      case 'step:start':
        this._updateStepStatus(event.step?.id, 'running');
        break;

      case 'step:complete':
        this._updateStepStatus(event.step?.id, 'complete');
        break;

      case 'step:failed':
        this._updateStepStatus(event.stepId, 'failed');
        break;

      case 'step:skipped':
        this._updateStepStatus(event.stepId, 'skipped');
        break;

      case 'plan:awaiting-approval':
        this._setBadge(statusBadge, 'awaiting', 'Awaiting Approval');
        for (const proposal of (event.proposals || [])) {
          this._renderProposal(proposal, event.planId);
        }
        // Switch to run tab if not already there
        if (this._currentTab !== 'run') {
          this._panel.querySelector('[data-tab="run"]')?.click();
        }
        break;

      case 'plan:paused':
        this._setBadge(statusBadge, 'paused', 'Paused');
        this._panel.querySelector('#nv-agent-pause-btn').textContent = '▶';
        this._panel.querySelector('#nv-agent-pause-btn').title = 'Resume';
        this._panel.querySelector('#nv-agent-pause-btn').onclick = () => {
          agentManager.resume(this._activePlanId);
        };
        break;

      case 'plan:resumed':
        this._setBadge(statusBadge, 'running', 'Running');
        this._panel.querySelector('#nv-agent-pause-btn').textContent = '⏸';
        this._panel.querySelector('#nv-agent-pause-btn').title = 'Pause';
        this._panel.querySelector('#nv-agent-pause-btn').onclick = () => {
          agentManager.pause(this._activePlanId);
        };
        break;

      case 'plan:complete':
        this._setBadge(statusBadge, 'complete', 'Complete');
        runBtn.disabled = false;
        runBtnText.textContent = '▶ Run Agent';
        this._activePlanId = null;
        break;

      case 'plan:failed':
        this._setBadge(statusBadge, 'failed', 'Failed');
        runBtn.disabled = false;
        runBtnText.textContent = '▶ Run Agent';
        this._activePlanId = null;
        break;

      case 'plan:cancelled':
        this._setBadge(statusBadge, 'idle', 'Idle');
        runBtn.disabled = false;
        runBtnText.textContent = '▶ Run Agent';
        this._activePlanId = null;
        break;
    }
  }

  // ─── Timeline ──────────────────────────────────────────────────────────────

  _addTimelineEvent(event) {
    this._events.unshift({ ...event, _ts: new Date().toLocaleTimeString() });
    if (this._events.length > 200) this._events.pop();
    if (this._currentTab === 'timeline') {
      this._renderTimeline(this._panel.querySelector('#nv-agent-timeline-filter')?.value || '');
    }
  }

  _renderTimeline(filter = '') {
    const container = this._panel.querySelector('#nv-agent-timeline');
    if (!container) return;

    const filtered = filter
      ? this._events.filter(e => JSON.stringify(e).toLowerCase().includes(filter.toLowerCase()))
      : this._events;

    container.innerHTML = filtered.slice(0, 100).map(event => `
      <div class="nv-agent-timeline-event nv-agent-timeline-event--${this._eventClass(event.type)}">
        <span class="nv-agent-timeline-event__time">${event._ts}</span>
        <span class="nv-agent-timeline-event__type">${event.type}</span>
        <span class="nv-agent-timeline-event__detail">${this._eventDetail(event)}</span>
      </div>
    `).join('');
  }

  // ─── Memory tab ────────────────────────────────────────────────────────────

  _refreshMemoryTab() {
    const container = this._panel.querySelector('#nv-agent-memory-sections');
    if (!container) return;

    const memory = agentManager.getMemory();
    const sections = [
      { key: 'intent',      label: '🎯 Intent',      icon: '🎯' },
      { key: 'brand',       label: '🎨 Brand',       icon: '🎨' },
      { key: 'decisions',   label: '🧠 Decisions',   icon: '🧠' },
      { key: 'preferences', label: '⚙️ Preferences', icon: '⚙️' },
      { key: 'rejections',  label: '✗ Rejections',   icon: '✗' },
    ];

    container.innerHTML = sections.map(({ key, label }) => {
      const entries = memory[key] || [];
      return `
        <div class="nv-agent-memory-section">
          <div class="nv-agent-memory-section__title">${label} (${entries.length})</div>
          ${entries.length
            ? entries.map(e => `
              <div class="nv-agent-memory-entry">
                <span class="nv-agent-memory-entry__key">${this._escHtml(e.key)}</span>
                <span class="nv-agent-memory-entry__value">${this._escHtml(
                  typeof e.value === 'object' ? JSON.stringify(e.value) : String(e.value || '')
                ).slice(0, 120)}</span>
              </div>
            `).join('')
            : '<div class="nv-agent-memory-empty">No entries</div>'
          }
        </div>
      `;
    }).join('');
  }

  // ─── Auto-approve rules tab ────────────────────────────────────────────────

  _refreshRulesTab() {
    const container = this._panel.querySelector('#nv-agent-rules-list');
    if (!container) return;

    const rules = agentManager.getAutoApproveRules();
    if (!rules.length) {
      container.innerHTML = '<div class="nv-agent-rules-empty">No auto-approve rules. All changes require approval.</div>';
      return;
    }

    container.innerHTML = rules.map((rule, idx) => `
      <div class="nv-agent-rule-row">
        <span class="nv-agent-rule-row__tool">${this._toolLabel(rule.toolName)}</span>
        <span class="nv-agent-rule-row__level">${rule.toolLevel}</span>
        <button class="nv-agent-rule-row__remove" data-idx="${idx}" title="Remove rule">✕</button>
      </div>
    `).join('');

    container.querySelectorAll('.nv-agent-rule-row__remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        agentManager.removeAutoApproveRule(parseInt(e.target.dataset.idx, 10));
        this._refreshRulesTab();
      });
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  _setBadge(el, status, label) {
    if (!el) return;
    el.className = `nv-agent-badge nv-agent-badge--${status}`;
    el.textContent = label;
  }

  _agentIcon(agentType) {
    const icons = {
      planner:     '🗺️',
      builder:     '🔨',
      design:      '🎨',
      growth:      '📈',
      maintenance: '🔧',
      deployment:  '🚀',
    };
    return icons[agentType] || '🤖';
  }

  _toolLabel(toolName) {
    const labels = {
      'project.write.page':  'Write Page',
      'project.write.data':  'Write Data Model',
      'memory.write':        'Write Memory',
      'hosting.deploy':      'Deploy',
      'hosting.rollback':    'Rollback',
    };
    return labels[toolName] || toolName;
  }

  _proposalPreview(proposal) {
    const params = proposal.params || {};
    if (proposal.toolName === 'project.write.page') {
      const changes = params.diff?.join(', ') || '';
      return `<strong>${this._escHtml(params.name || 'Unnamed page')}</strong>${changes ? `<br><small>${this._escHtml(changes)}</small>` : ''}`;
    }
    if (proposal.toolName === 'hosting.deploy') {
      return `Deploy to <strong>${params.environment || 'staging'}</strong>`;
    }
    return `<code>${this._escHtml(JSON.stringify(params).slice(0, 200))}</code>`;
  }

  _eventClass(type) {
    if (type?.includes('failed') || type?.includes('error')) return 'error';
    if (type?.includes('complete') || type?.includes('approved')) return 'success';
    if (type?.includes('awaiting') || type?.includes('paused')) return 'warning';
    return 'info';
  }

  _eventDetail(event) {
    if (event.goal)    return this._escHtml(event.goal.slice(0, 80));
    if (event.step)    return this._escHtml(event.step.title || '');
    if (event.stepId)  return `step: ${event.stepId}`;
    if (event.planId)  return `plan: ${event.planId?.slice(0, 8)}`;
    if (event.message) return this._escHtml(event.message.slice(0, 80));
    if (event.error)   return this._escHtml(String(event.error).slice(0, 80));
    return '';
  }

  _escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

export const agentConsole = new AgentConsole();
