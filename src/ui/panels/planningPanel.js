/**
 * planningPanel.js — Nuvra Phase 2–2.5
 *
 * The Explainability & Introspection UI Panel.
 *
 * This panel exposes the AI's reasoning to the user.
 * It is "AI you can argue with, not magic."
 *
 * The panel has four tabs:
 *   1. Prompt — enter/edit the user prompt, run analysis
 *   2. Intent — inspect the analyzed intent, accept/edit/reject
 *   3. Plan — inspect the site plan, section by section, with reasons
 *   4. History — view all plan versions and their diffs
 *
 * All user actions dispatch to the planning engine, not to the DOM.
 *
 * @module ui/panels/planningPanel
 */
'use strict';

import { store }         from '../../state/store.js';
import { eventBus }      from '../../runtime/eventBus.js';
import { schemaStore }   from '../../ai/schemas/schemaStore.js';
import { planningEngine } from '../../ai/planningEngine.js';

const TABS = [
  { id: 'prompt',  label: 'Prompt'  },
  { id: 'intent',  label: 'Intent'  },
  { id: 'plan',    label: 'Plan'    },
  { id: 'history', label: 'History' },
];

export const planningPanel = {
  _el:          null,
  _activeTab:   'prompt',
  _unsub:       null,
  _storeUnsub:  null,

  mount(el) {
    if (!el) return;
    this._el = el;
    this._el.addEventListener('click',  this._onClick.bind(this));
    this._el.addEventListener('submit', this._onSubmit.bind(this));
    this._el.addEventListener('change', this._onChange.bind(this));

    // Re-render when schema store changes
    this._unsub = schemaStore.subscribe(() => this.render());
  },

  unmount() {
    this._unsub?.();
    this._el = null;
  },

  render() {
    if (!this._el) return;
    const intent = schemaStore.getIntent();
    const site   = schemaStore.getSiteSchema();
    const state  = store.getState();
    const isPlanning = state.ai?.isPlanning || false;

    this._el.innerHTML = `
      <div class="nv-planning-panel">
        <!-- Tab Bar -->
        <div class="nv-ptabs" role="tablist">
          ${TABS.map(t => `
            <button class="nv-ptab ${t.id === this._activeTab ? 'active' : ''}"
              data-tab="${t.id}" role="tab" aria-selected="${t.id === this._activeTab}">
              ${t.label}
              ${t.id === 'intent' && intent ? `<span class="nv-badge">${Math.round(intent.confidence * 100)}%</span>` : ''}
              ${t.id === 'plan'   && site   ? `<span class="nv-badge">${site.pages.length}p</span>` : ''}
            </button>
          `).join('')}
        </div>

        <!-- Tab Content -->
        <div class="nv-ptab-content">
          ${this._activeTab === 'prompt'  ? this._renderPromptTab(intent, isPlanning)  : ''}
          ${this._activeTab === 'intent'  ? this._renderIntentTab(intent)  : ''}
          ${this._activeTab === 'plan'    ? this._renderPlanTab(site)      : ''}
          ${this._activeTab === 'history' ? this._renderHistoryTab()       : ''}
        </div>
      </div>
    `;
  },

  // ── Tab Renderers ──────────────────────────────────────────────────────────
  _renderPromptTab(intent, isPlanning) {
    return `
      <div class="nv-ptab-pane">
        <p class="nv-ptab-desc">
          Describe what you want to build. The AI will analyze your intent and create a structured plan.
        </p>
        <form data-form="prompt" class="nv-prompt-form">
          <textarea
            name="prompt"
            class="nv-prompt-textarea"
            placeholder="e.g. A SaaS landing page for a project management tool targeting remote teams. Needs pricing, testimonials, and a free trial CTA."
            rows="6"
            ${isPlanning ? 'disabled' : ''}
          >${intent?.rawPrompt || ''}</textarea>
          <div class="nv-prompt-actions">
            <button type="submit" class="nv-btn nv-btn-primary" ${isPlanning ? 'disabled' : ''}>
              ${isPlanning ? '&#9881; Planning…' : intent ? '&#8635; Re-plan' : '&#9654; Analyze & Plan'}
            </button>
            ${intent ? `
              <span class="nv-confidence-badge">
                Confidence: ${Math.round(intent.confidence * 100)}%
              </span>
            ` : ''}
          </div>
        </form>
        ${intent?.ambiguities?.length > 0 ? `
          <div class="nv-ambiguities">
            <h4>&#9888; Ambiguities detected</h4>
            ${intent.ambiguities.map(a => `
              <div class="nv-ambiguity">
                <strong>${this._esc(a.field)}</strong>: ${this._esc(a.description)}
                <span class="nv-suggestion">Suggestion: ${this._esc(a.suggestion)}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
  },

  _renderIntentTab(intent) {
    if (!intent) {
      return `<div class="nv-ptab-pane nv-empty">No intent analyzed yet. Use the Prompt tab to get started.</div>`;
    }
    return `
      <div class="nv-ptab-pane">
        <div class="nv-intent-header">
          <span class="nv-intent-id">Intent: ${intent.id}</span>
          <span class="nv-confidence-badge">Confidence: ${Math.round(intent.confidence * 100)}%</span>
        </div>

        ${this._renderIntentSection('Product', [
          ['Type',       intent.product.type],
          ['Domain',     intent.product.domain],
          ['Sub-domain', intent.product.subDomain],
        ])}

        ${this._renderIntentSection('Audience', [
          ['Primary',     intent.audience.primary],
          ['Pain Points', intent.audience.painPoints.join(', ')],
          ['Goals',       intent.audience.goals.join(', ')],
        ])}

        ${this._renderIntentSection('Brand', [
          ['Name',        intent.brand.name || '—'],
          ['Tone',        intent.brand.tone.join(', ')],
          ['Personality', intent.brand.personality.join(', ')],
          ['Avoid',       intent.brand.avoid.join(', ') || '—'],
        ])}

        ${this._renderIntentSection('Goals', [
          ['Primary',   intent.goals.primary],
          ['Secondary', intent.goals.secondary.join(', ')],
          ['KPIs',      intent.goals.kpis.join(', ')],
        ])}

        ${this._renderIntentSection('Features', [
          ['Required', intent.features.required.join(', ')],
          ['Implied',  intent.features.implied.join(', ')],
          ['Excluded', intent.features.excluded.join(', ') || '—'],
        ])}

        ${intent.assumptions.length > 0 ? `
          <div class="nv-intent-section">
            <h4>Assumptions</h4>
            ${intent.assumptions.map(a => `
              <div class="nv-assumption">
                <strong>${this._esc(a.field)}</strong>: "${this._esc(a.value)}"
                <span class="nv-reason">— ${this._esc(a.reason)}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <div class="nv-intent-actions">
          <button class="nv-btn" data-action="edit-intent">Edit Intent</button>
          <button class="nv-btn nv-btn-danger" data-action="reject-intent">Reject & Re-prompt</button>
        </div>
      </div>
    `;
  },

  _renderPlanTab(site) {
    if (!site) {
      return `<div class="nv-ptab-pane nv-empty">No plan generated yet. Use the Prompt tab to get started.</div>`;
    }
    return `
      <div class="nv-ptab-pane">
        <div class="nv-plan-header">
          <span class="nv-plan-id">Plan: ${site.id}</span>
          <span class="nv-plan-meta">${site.pages.length} pages · ${site.meta.sectionCount} sections</span>
        </div>

        ${site.pages.map(page => `
          <div class="nv-plan-page">
            <div class="nv-plan-page-header">
              <span class="nv-plan-page-name">${this._esc(page.name)}</span>
              <span class="nv-plan-page-slug">/${this._esc(page.slug)}</span>
              ${page.meta.userEdited ? '<span class="nv-badge-edited">Edited</span>' : ''}
            </div>
            <p class="nv-plan-page-purpose">${this._esc(page.purpose)}</p>
            <p class="nv-plan-page-reason nv-reason">Why: ${this._esc(page.reason)}</p>

            <div class="nv-plan-sections">
              ${page.sections.map((sec, idx) => `
                <div class="nv-plan-section ${sec.meta.locked ? 'locked' : ''} ${sec.meta.userEdited ? 'edited' : ''}">
                  <div class="nv-plan-section-header">
                    <span class="nv-section-order">${idx + 1}</span>
                    <span class="nv-section-type">${this._esc(sec.type)}</span>
                    <span class="nv-section-priority">P${sec.priority}</span>
                    ${sec.meta.locked ? '<span class="nv-badge-locked">&#128274; Locked</span>' : ''}
                    ${sec.meta.userEdited ? '<span class="nv-badge-edited">Edited</span>' : ''}
                  </div>
                  <p class="nv-section-purpose">${this._esc(sec.purpose)}</p>
                  <p class="nv-section-reason nv-reason">Why here: ${this._esc(sec.reason)}</p>
                  <div class="nv-section-intent">
                    <span class="nv-ci-label">Content intent:</span>
                    <span class="nv-ci-headline">${this._esc(sec.contentIntent.headline)}</span>
                  </div>
                  <div class="nv-section-actions">
                    <button class="nv-btn nv-btn-xs" data-action="edit-section"   data-section-id="${sec.id}">Edit</button>
                    <button class="nv-btn nv-btn-xs" data-action="${sec.meta.locked ? 'unlock-section' : 'lock-section'}" data-section-id="${sec.id}">
                      ${sec.meta.locked ? 'Unlock' : 'Lock'}
                    </button>
                    <button class="nv-btn nv-btn-xs" data-action="replan-section" data-section-id="${sec.id}">Re-plan</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },

  _renderHistoryTab() {
    const history = schemaStore.getHistory();
    if (history.length === 0) {
      return `<div class="nv-ptab-pane nv-empty">No plan history yet.</div>`;
    }
    return `
      <div class="nv-ptab-pane">
        <div class="nv-history-list">
          ${[...history].reverse().map(h => `
            <div class="nv-history-entry">
              <div class="nv-history-header">
                <span class="nv-history-version">v${h.version}</span>
                <span class="nv-history-source nv-badge">${h.source}</span>
                <span class="nv-history-time">${new Date(h.savedAt).toLocaleTimeString()}</span>
              </div>
              <p class="nv-history-diff">${this._esc(h.diff?.summary || 'No diff available')}</p>
              ${h.diff?.changes?.length > 0 ? `
                <ul class="nv-history-changes">
                  ${h.diff.changes.slice(0, 5).map(c => `
                    <li class="nv-change-${c.type}">${this._esc(c.type.replace(/_/g, ' '))}${c.pageName ? `: ${this._esc(c.pageName)}` : ''}${c.sectionType ? ` → ${this._esc(c.sectionType)}` : ''}</li>
                  `).join('')}
                  ${h.diff.changes.length > 5 ? `<li>…and ${h.diff.changes.length - 5} more</li>` : ''}
                </ul>
              ` : ''}
              <button class="nv-btn nv-btn-xs" data-action="restore-version" data-version="${h.version}">
                Restore v${h.version}
              </button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  // ── Event Handlers ─────────────────────────────────────────────────────────
  _onClick(e) {
    const action    = e.target.closest('[data-action]')?.dataset.action;
    const tab       = e.target.closest('[data-tab]')?.dataset.tab;
    const sectionId = e.target.closest('[data-section-id]')?.dataset.sectionId;
    const version   = e.target.closest('[data-version]')?.dataset.version;

    if (tab) {
      this._activeTab = tab;
      this.render();
      return;
    }

    switch (action) {
      case 'reject-intent':
        store.dispatch({ type: 'AI/CLEAR_INTENT' });
        this._activeTab = 'prompt';
        this.render();
        break;

      case 'lock-section':
        if (sectionId) schemaStore.lockSection(sectionId);
        break;

      case 'unlock-section':
        if (sectionId) schemaStore.unlockSection(sectionId);
        break;

      case 'replan-section':
        if (sectionId) eventBus.emit('ai:replan_section_requested', { sectionId });
        break;

      case 'restore-version':
        if (version) {
          schemaStore.restoreVersion(Number(version));
          this._activeTab = 'plan';
        }
        break;
    }
  },

  async _onSubmit(e) {
    e.preventDefault();
    const form = e.target.closest('[data-form="prompt"]');
    if (!form) return;
    const prompt = form.querySelector('textarea[name="prompt"]')?.value?.trim();
    if (!prompt) return;

    store.dispatch({ type: 'AI/SET_PLANNING', payload: true });
    this.render();

    try {
      await planningEngine.run(prompt);
      this._activeTab = 'plan';
    } finally {
      store.dispatch({ type: 'AI/SET_PLANNING', payload: false });
      this.render();
    }
  },

  _onChange() {},

  // ── Helpers ────────────────────────────────────────────────────────────────
  _renderIntentSection(title, rows) {
    return `
      <div class="nv-intent-section">
        <h4>${title}</h4>
        <table class="nv-intent-table">
          ${rows.filter(([, v]) => v).map(([label, value]) => `
            <tr>
              <td class="nv-it-label">${label}</td>
              <td class="nv-it-value">${this._esc(String(value))}</td>
            </tr>
          `).join('')}
        </table>
      </div>
    `;
  },

  _esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  },
};

export default planningPanel;
