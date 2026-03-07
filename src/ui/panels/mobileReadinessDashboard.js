/**
 * mobileReadinessDashboard.js - Nuvra Phase 9
 *
 * Implements the UI for the Mobile Readiness Dashboard and Capability Inspector.
 * This dashboard provides developers with a clear overview of their app's mobile
 * compatibility, policy compliance, and potential issues, along with guidance.
 */
'use strict';

import { store } from '../../state/store.js';
import { logger } from '../../diagnostics/logger.js';
import { runtime } from '../../runtime/coreRuntime.js';

export const mobileReadinessDashboard = {
  _el: null,

  mount(el) {
    if (!el) return;
    this._el = el;
    this.render();
  },

  unmount() {
    this._el = null;
  },

  render() {
    if (!this._el) return;
    
    const state = store.getState();
    const targetPlatform = state.editor?.deviceMode === 'mobile' ? 'ios' : 'web';
    
    // In a real scenario, we'd get the current app schema from the active page
    const activePage = state.pages?.byId[state.editor?.activePageId];
    const appManifest = activePage?.content || {};

    const mobilePolicyEngine = runtime.has('mobilePolicyEngine') ? runtime.get('mobilePolicyEngine') : null;
    const mobileAwarePlanner = runtime.has('mobileAwarePlanner') ? runtime.get('mobileAwarePlanner') : null;

    if (!mobilePolicyEngine || !mobileAwarePlanner) {
      this._el.innerHTML = '<div class="nv-panel-placeholder">Mobile Governance modules not initialized.</div>';
      return;
    }

    const { isValid, warnings, errors } = mobilePolicyEngine.evaluateApp(appManifest, targetPlatform);
    const planResult = mobileAwarePlanner.enhancePlanWithMobileConstraints({}, appManifest, targetPlatform);
    const mobileReadiness = planResult.mobileReadiness || { score: 0 };

    this._el.innerHTML = `
      <div class="mobile-readiness-dashboard" style="padding: 1rem; color: #fff;">
        <h2 style="margin-top: 0;">Mobile Readiness - ${targetPlatform.toUpperCase()}</h2>
        
        <div class="score-card" style="background: #2a2a2a; padding: 1rem; border-radius: 4px; margin-bottom: 1rem;">
          <h3 style="margin: 0;">Readiness Score: ${mobileReadiness.score}%</h3>
          <p style="margin: 5px 0 0 0; color: ${isValid ? '#4caf50' : '#f44336'}">
            Status: ${isValid ? '✅ Compliant' : '❌ Non-Compliant'}
          </p>
        </div>

        <div class="section" style="margin-bottom: 1rem;">
          <h3 style="border-bottom: 1px solid #444; padding-bottom: 5px;">Policy Status</h3>
          ${errors.length > 0 ? `<div class="errors" style="color: #f44336;">${errors.map(e => `<p style="margin: 5px 0;">❌ ${e}</p>`).join('')}</div>` : ''}
          ${warnings.length > 0 ? `<div class="warnings" style="color: #ffeb3b;">${warnings.map(w => `<p style="margin: 5px 0;">⚠️ ${w}</p>`).join('')}</div>` : ''}
          ${errors.length === 0 && warnings.length === 0 ? '<p style="color: #4caf50;">✅ No policy issues detected.</p>' : ''}
        </div>

        <div class="section" style="margin-bottom: 1rem;">
          <h3 style="border-bottom: 1px solid #444; padding-bottom: 5px;">AI Mobile Insights</h3>
          <p><strong>Offline Compatibility:</strong></p>
          <ul style="padding-left: 20px;">
            ${Object.entries(mobileReadiness.offlineCompatibilitySummary || {}).length > 0 
              ? Object.entries(mobileReadiness.offlineCompatibilitySummary).map(([cap, status]) => `<li>${cap}: ${status}</li>`).join('')
              : '<li>No offline constraints identified.</li>'}
          </ul>
        </div>

        <div class="section">
          <h3 style="border-bottom: 1px solid #444; padding-bottom: 5px;">Capability Inspector</h3>
          ${appManifest.declaredCapabilities && appManifest.declaredCapabilities.length > 0
            ? `<ul style="padding-left: 20px;">${appManifest.declaredCapabilities.map(cap => {
                const capability = mobilePolicyEngine.capabilitySystem.getCapability(cap);
                return `<li><strong>${cap}</strong>: ${capability ? capability.purpose : 'Unknown'}</li>`;
              }).join('')}</ul>`
            : '<p>No specific capabilities declared in current page.</p>'
          }
        </div>
      </div>
    `;
  }
};

export default mobileReadinessDashboard;
