/**
 * mobileReadinessDashboard.js - Nuvra Phase 9
 *
 * Implements the UI for the Mobile Readiness Dashboard and Capability Inspector.
 * This dashboard provides developers with a clear overview of their app's mobile
 * compatibility, policy compliance, and potential issues, along with guidance.
 */

const { logger } = require("../../diagnostics/logger");
const MobilePolicyEngine = require("../../mobile/governance/mobilePolicyEngine");
const MobileAwarePlanner = require("../../ai/planning/mobileAwarePlanner");

class MobileReadinessDashboard {
  /**
   * @param {object} options
   * @param {object} options.logger - Logger instance.
   * @param {object} options.mobilePolicyEngine - Instance of MobilePolicyEngine.
   * @param {object} options.mobileAwarePlanner - Instance of MobileAwarePlanner.
   */
  constructor({ logger, mobilePolicyEngine, mobileAwarePlanner }) {
    this.logger = logger;
    this.mobilePolicyEngine = mobilePolicyEngine;
    this.mobileAwarePlanner = mobileAwarePlanner;
    this.dashboardElement = null; // Reference to the DOM element for the dashboard
  }

  /**
   * Initializes and renders the mobile readiness dashboard.
   * @param {HTMLElement} parentElement - The DOM element to attach the dashboard to.
   * @param {object} appManifest - The current application manifest.
   * @param {string} targetPlatform - The selected target mobile platform.
   */
  render(parentElement, appManifest, targetPlatform) {
    this.dashboardElement = parentElement;
    this.dashboardElement.innerHTML = ''; // Clear previous content

    this.logger.info(`Rendering Mobile Readiness Dashboard for ${targetPlatform}.`);

    const { isValid, warnings, errors } = this.mobilePolicyEngine.evaluateApp(appManifest, targetPlatform);
    const mobileReadiness = this.mobileAwarePlanner.enhancePlanWithMobileConstraints({}, appManifest, targetPlatform).mobileReadiness;

    const html = `
      <div class="mobile-readiness-dashboard">
        <h2>Mobile Readiness Dashboard - ${targetPlatform.toUpperCase()}</h2>
        <div class="score-card">
          <h3>Readiness Score: ${mobileReadiness.score || 'N/A'}</h3>
          <p>${isValid ? 'Compliant' : 'Non-Compliant'}</p>
        </div>

        <div class="section">
          <h3>Policy Warnings & Errors</h3>
          ${errors.length > 0 ? `<div class="errors">${errors.map(e => `<p>❌ ${e}</p>`).join('')}</div>` : ''}
          ${warnings.length > 0 ? `<div class="warnings">${warnings.map(w => `<p>⚠️ ${w}</p>`).join('')}</div>` : ''}
          ${errors.length === 0 && warnings.length === 0 ? '<p>✅ No policy issues detected.</p>' : ''}
        </div>

        <div class="section">
          <h3>Capability Inspector</h3>
          ${appManifest.declaredCapabilities && appManifest.declaredCapabilities.length > 0
            ? `<ul>${appManifest.declaredCapabilities.map(cap => {
                const capability = this.mobilePolicyEngine.capabilitySystem.getCapability(cap);
                return `<li><strong>${cap}</strong>: ${capability ? capability.purpose : 'Unknown capability'}
                        <br><em>Platform Support:</em> ${capability ? JSON.stringify(capability.platformSupport) : 'N/A'}
                        <br><em>Consent:</em> ${capability ? capability.consentRequirements : 'N/A'}
                        </li>`;
              }).join('')}</ul>`
            : '<p>No capabilities declared.</p>'
          }
        </div>

        <div class="section">
          <h3>AI Mobile Planning Insights</h3>
          <p><strong>Offline Compatibility:</strong></p>
          <ul>
            ${Object.entries(mobileReadiness.offlineCompatibilitySummary || {}).map(([cap, status]) => `<li>${cap}: ${status}</li>`).join('')}
          </ul>
          <p><strong>Capability Justifications:</strong></p>
          <ul>
            ${Object.entries(mobileReadiness.capabilityJustifications || {}).map(([cap, justification]) => `<li>${cap}: ${justification}</li>`).join('')}
          </ul>
        </div>

        ${errors.length > 0 ? `
          <div class="section">
            <h3>Guidance & Alternatives</h3>
            ${errors.map(e => {
              const capabilityName = e.match(/Capability '(.*?)'/)?.[1];
              if (capabilityName) {
                const suggestion = this.mobilePolicyEngine.suggestAlternative(capabilityName, targetPlatform);
                return suggestion ? `<p>💡 For ${capabilityName}: ${suggestion}</p>` : '';
              }
              return '';
            }).join('')}
            ${errors.length > 0 && errors.every(e => !e.match(/Capability '(.*?)'/)) ? '<p>Review policy errors for specific guidance.</p>' : ''}
          </div>
        ` : ''}
      </div>
    `;
    this.dashboardElement.innerHTML = html;
  }

  /**
   * Updates the dashboard with new data (e.g., after a change in app manifest).
   * @param {object} appManifest - The updated application manifest.
   * @param {string} targetPlatform - The selected target mobile platform.
   */
  update(appManifest, targetPlatform) {
    if (this.dashboardElement) {
      this.render(this.dashboardElement, appManifest, targetPlatform);
    }
  }
}

module.exports = MobileReadinessDashboard;
