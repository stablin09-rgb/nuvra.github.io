/**
 * capabilityInspector.js - Nuvra Phase 9
 *
 * Implements the UI component for inspecting declared capabilities.
 * This allows developers to view details of each capability, including purpose,
 * data sensitivity, platform support, and consent requirements.
 */

const { logger } = require("../../diagnostics/logger");
const CapabilityDeclarationSystem = require("../../mobile/governance/capabilityDeclarationSystem");

class CapabilityInspector {
  /**
   * @param {object} options
   * @param {object} options.logger - Logger instance.
   * @param {object} options.capabilitySystem - Instance of CapabilityDeclarationSystem.
   */
  constructor({ logger, capabilitySystem }) {
    this.logger = logger;
    this.capabilitySystem = capabilitySystem;
    this.inspectorElement = null; // Reference to the DOM element for the inspector
  }

  /**
   * Initializes and renders the capability inspector.
   * @param {HTMLElement} parentElement - The DOM element to attach the inspector to.
   * @param {string[]} declaredCapabilities - List of capabilities declared by the app.
   */
  render(parentElement, declaredCapabilities) {
    this.inspectorElement = parentElement;
    this.inspectorElement.innerHTML = ""; // Clear previous content

    this.logger.info("Rendering Capability Inspector.");

    const html = `
      <div class=\"capability-inspector\">
        <h3>Declared Capabilities</h3>
        ${declaredCapabilities && declaredCapabilities.length > 0
          ? `<ul>${declaredCapabilities.map(capName => {
              const capability = this.capabilitySystem.getCapability(capName);
              if (!capability) {
                return `<li><strong>${capName}</strong>: <span class=\"error\">Undeclared capability</span></li>`;
              }
              return `
                <li>
                  <h4>${capability.name}</h4>
                  <p><strong>Purpose:</strong> ${capability.purpose}</p>
                  <p><strong>Data Sensitivity:</strong> ${capability.dataSensitivity}</p>
                  <p><strong>Platform Support:</strong> ${JSON.stringify(capability.platformSupport)}</p>
                  <p><strong>Store Policy Impact:</strong> ${capability.storePolicyImpact}</p>
                  <p><strong>Offline Compatibility:</strong> ${capability.offlineCompatibility ? "Yes" : "No"}</p>
                  <p><strong>Consent Requirements:</strong> ${capability.consentRequirements}</p>
                </li>
              `;
            }).join("")}</ul>`
          : "<p>No capabilities declared for this application.</p>"
        }
      </div>
    `;
    this.inspectorElement.innerHTML = html;
  }

  /**
   * Updates the inspector with new data.
   * @param {string[]} declaredCapabilities - The updated list of declared capabilities.
   */
  update(declaredCapabilities) {
    if (this.inspectorElement) {
      this.render(this.inspectorElement, declaredCapabilities);
    }
  }
}

export { CapabilityInspector };
export default CapabilityInspector;
