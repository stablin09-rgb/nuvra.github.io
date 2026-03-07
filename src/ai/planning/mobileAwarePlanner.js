/**
 * mobileAwarePlanner.js - Nuvra Phase 9
 *
 * Extends the AI planning pipeline to incorporate mobile-specific constraints,
 * capabilities, and design considerations. This ensures that AI-generated plans
 * are inherently mobile-friendly and compliant.
 */

const MobileRuntimeContract = require("../../mobile/governance/mobileRuntimeContract");
const CapabilityDeclarationSystem = require("../../mobile/governance/capabilityDeclarationSystem");

class MobileAwarePlanner {
  /**
   * @param {object} options
   * @param {object} options.logger - Logger instance.
   * @param {object} options.planningGraph - The core AI planning graph.
   */
  constructor({ logger, planningGraph }) {
    this.logger = logger;
    this.planningGraph = planningGraph;
    this.mobileRuntimeContract = MobileRuntimeContract;
    this.capabilitySystem = new CapabilityDeclarationSystem();
  }

  /**
   * Enhances the AI planning process with mobile-specific considerations.
   * This method should be integrated into the main AI planning pipeline.
   * @param {object} currentPlan - The AI-generated plan so far.
   * @param {object} intentSchema - The schema representing the user's intent.
   * @param {string} targetPlatform - The target mobile platform (e.g., 'ios', 'android').
   * @returns {object} The mobile-aware enhanced plan.
   */
  enhancePlanWithMobileConstraints(currentPlan, intentSchema, targetPlatform) {
    this.logger.info(`Enhancing plan for mobile platform: ${targetPlatform}`);

    let enhancedPlan = { ...currentPlan };
    let mobileReadinessScore = 100; // Start with a perfect score
    const capabilityJustifications = {};
    const offlineCompatibilitySummary = {};

    // 1. Analyze intentSchema for mobile-specific features and requirements
    const requiredCapabilities = this._identifyRequiredCapabilities(intentSchema);

    // 2. Evaluate required capabilities against Mobile Runtime Contract and platform support
    for (const capName of requiredCapabilities) {
      const capability = this.capabilitySystem.getCapability(capName);
      if (!capability) {
        this.logger.warn(`Unknown capability '${capName}' identified in intent. Skipping mobile-aware planning for it. Current score: ${mobileReadinessScore}`);
        mobileReadinessScore -= 10; // Penalize for unknown capabilities
        continue;
      }

      capabilityJustifications[capName] = capability.purpose;

      if (!capability.platformSupport[targetPlatform]) {
        this.logger.warn(`Capability '${capName}' is not fully supported on ${targetPlatform}. Adjusting plan. Current score: ${mobileReadinessScore}`);
        mobileReadinessScore -= 20; // Significant penalty for unsupported features
        this.logger.debug(`Score reduced by 20 for unsupported capability '${capName}'. New score: ${mobileReadinessScore}`);
        // Suggest alternatives or modify plan to avoid this capability
        enhancedPlan = this._adjustPlanForUnsupportedCapability(enhancedPlan, capName, targetPlatform);
      }

      if (!capability.offlineCompatibility) {
        offlineCompatibilitySummary[capName] = "Requires network connection.";
      } else {
        offlineCompatibilitySummary[capName] = "Offline compatible.";
      }

      // Apply runtime contract rules (e.g., storage limits, network behavior)
      // This is a simplified example; a real implementation would be more detailed.
      if (capName === 'files' && this.mobileRuntimeContract.storageLimits.localStorage) {
        this.logger.info(`Plan considers local storage limits: ${this.mobileRuntimeContract.storageLimits.localStorage}`);
      }
    }

    // 3. Select mobile-friendly layouts and components
    enhancedPlan = this._selectMobileFriendlyLayouts(enhancedPlan, targetPlatform);

    // 4. Automatically declare required capabilities in the plan/manifest
    enhancedPlan.declaredMobileCapabilities = requiredCapabilities;

    // 5. Explain trade-offs to users (add to plan metadata)
    enhancedPlan.mobileReadiness = {
      score: mobileReadinessScore,
      capabilityJustifications,
      offlineCompatibilitySummary,
      warnings: [], // Populate with warnings from policy engine later
      suggestions: [], // Populate with suggestions from policy engine later
    };

    this.logger.info(`Mobile-aware planning complete. Readiness score: ${mobileReadinessScore}`);
    return enhancedPlan;
  }

  /**
   * Identifies capabilities required by the intent schema.
   * This is a placeholder and would involve deeper analysis of the schema.
   * @param {object} intentSchema
   * @returns {string[]}
   * @private
   */
  _identifyRequiredCapabilities(intentSchema) {
    const capabilities = [];
    // Example: if schema contains a 'camera' field, add 'camera' capability
    if (intentSchema.features && Array.isArray(intentSchema.features)) {
      if (intentSchema.features.includes('healthData')) {
        capabilities.push('healthData');
      }
      if (intentSchema.features.includes('payments')) {
        capabilities.push('payments');
      }
    }
    if (JSON.stringify(intentSchema).includes('camera')) {
      capabilities.push('camera');
    }
    if (JSON.stringify(intentSchema).includes('location')) {
      capabilities.push('location');
    }
    // More sophisticated logic would parse the schema for specific keywords or structures
    return capabilities;
  }

  /**
   * Adjusts the plan if an unsupported capability is detected.
   * @param {object} plan
   * @param {string} capabilityName
   * @param {string} targetPlatform
   * @returns {object}
   * @private
   */
  _adjustPlanForUnsupportedCapability(plan, capabilityName, targetPlatform) {
    this.logger.warn(`Attempting to adjust plan for unsupported capability '${capabilityName}' on ${targetPlatform}.`);
    // Example: if camera is unsupported, remove camera-related UI components from the plan
    if (capabilityName === 'camera' && targetPlatform === 'pwa') {
      // This would involve modifying the plan's UI component list or actions
      this.logger.info("Removing camera-related features from PWA plan.");
      // plan.uiComponents = plan.uiComponents.filter(comp => comp.type !== 'cameraInput');
    }
    return plan;
  }

  /**
   * Selects mobile-friendly layouts and components.
   * @param {object} plan
   * @param {string} targetPlatform
   * @returns {object}
   * @private
   */
  _selectMobileFriendlyLayouts(plan, targetPlatform) {
    this.logger.info(`Selecting mobile-friendly layouts for ${targetPlatform}.`);
    // This would involve applying mobile-specific design system rules or component choices
    // For example, preferring bottom navigation for iOS, or responsive grid layouts.
    return plan;
  }
}

export { MobileAwarePlanner };
export default MobileAwarePlanner;
