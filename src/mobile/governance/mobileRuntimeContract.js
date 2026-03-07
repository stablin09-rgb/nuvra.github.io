/**
 * mobileRuntimeContract.js - Nuvra Phase 9
 *
 * Defines the formal Mobile Runtime Contract for Nuvra applications.
 * This contract specifies the allowed behaviors and features within mobile execution environments
 * to ensure parity, compliance, and safety across different mobile platforms.
 */

const MobileRuntimeContract = {
  // Supported APIs and their usage guidelines
  supportedApis: {
    // Example: Camera API
    camera: {
      description: "Access to device camera for photo and video capture.",
      platformSupport: { ios: true, android: true, pwa: false },
      consentRequired: true,
      dataSensitivity: "high", // e.g., personal identifiable information
      storePolicyImpact: "privacy", // e.g., App Store privacy guidelines
    },
    // Add other APIs as needed (e.g., Geolocation, Notifications, etc.)
  },

  // Allowed DOM features and their restrictions
  allowedDomFeatures: {
    // Example: Web Workers for background processing
    webWorkers: {
      description: "Execution of scripts in background threads.",
      restrictions: "Limited to CPU-bound tasks; no direct DOM access.",
      offlineCompatible: true,
    },
    // Example: Local Storage
    localStorage: {
      description: "Persistent client-side storage.",
      restrictions: "Size limits apply; sensitive data must be encrypted.",
      offlineCompatible: true,
    },
    // Add other DOM features and their restrictions
  },

  // CSS constraints for consistent rendering across platforms
  cssConstraints: {
    units: "Prefer `rem` and `em` for scalability; avoid fixed `px` where possible.",
    animations: "Limit complex animations for performance on lower-end devices.",
    // Add other CSS guidelines
  },

  // Storage limits and guidelines
  storageLimits: {
    localStorage: "5MB per origin.",
    indexedDB: "Dynamic, up to 50% of disk space, with user prompts for large quotas.",
    // Add other storage limits
  },

  // Network behavior rules
  networkBehavior: {
    offlineGuarantees: "Service Workers must be used for critical offline functionality.",
    backgroundSync: "Allowed for data synchronization, subject to OS battery optimizations.",
    // Add other network rules
  },

  // Background execution rules
  backgroundExecution: {
    allowedTasks: "Only short-lived, essential tasks (e.g., data sync, notification processing).",
    restrictions: "Strict OS limitations apply; avoid continuous background activity.",
  },
};

module.exports = MobileRuntimeContract;
