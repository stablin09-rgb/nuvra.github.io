/**
 * capabilityDeclarationSystem.js - Nuvra Phase 9
 *
 * Implements a governed capability graph for mobile applications.
 * Each capability declares its properties, ensuring transparency and compliance
 * with platform-specific rules and user consent requirements.
 */

class CapabilityDeclarationSystem {
  constructor() {
    this.capabilities = {};
    this._initializeDefaultCapabilities();
  }

  _initializeDefaultCapabilities() {
    this.declareCapability('camera', {
      purpose: 'Capture photos and videos for user-generated content.',
      dataSensitivity: 'high',
      platformSupport: { ios: true, android: true, pwa: false },
      storePolicyImpact: 'privacy, user experience',
      offlineCompatibility: false,
      consentRequirements: 'explicit user consent at runtime',
    });

    this.declareCapability('files', {
      purpose: 'Access local file system for reading and writing user data.',
      dataSensitivity: 'high',
      platformSupport: { ios: true, android: true, pwa: true },
      storePolicyImpact: 'privacy, data security',
      offlineCompatibility: true,
      consentRequirements: 'explicit user consent for specific file types/locations',
    });

    this.declareCapability('location', {
      purpose: 'Access device\'s geographical location for location-aware features.',
      dataSensitivity: 'high',
      platformSupport: { ios: true, android: true, pwa: true },
      storePolicyImpact: 'privacy, battery usage',
      offlineCompatibility: false,
      consentRequirements: 'explicit user consent (foreground/background)',
    });

    this.declareCapability('pushNotifications', {
      purpose: 'Send notifications to the user for important updates or alerts.',
      dataSensitivity: 'medium',
      platformSupport: { ios: true, android: true, pwa: true },
      storePolicyImpact: 'user experience, privacy',
      offlineCompatibility: true,
      consentRequirements: 'explicit user opt-in',
    });

    this.declareCapability('biometricAuth', {
      purpose: 'Authenticate users using biometric data (fingerprint, face ID).',
      dataSensitivity: 'high',
      platformSupport: { ios: true, android: true, pwa: false },
      storePolicyImpact: 'security, privacy',
      offlineCompatibility: true,
      consentRequirements: 'explicit user enrollment and consent',
    });

    this.declareCapability('healthData', {
      purpose: 'Access and integrate with health-related data (e.g., Apple HealthKit, Google Fit).',
      dataSensitivity: 'critical',
      platformSupport: { ios: true, android: true, pwa: false },
      storePolicyImpact: 'health data privacy, regulatory compliance',
      offlineCompatibility: false,
      consentRequirements: 'explicit user authorization and strict data handling',
    });

    this.declareCapability('payments', {
      purpose: 'Process in-app purchases or external payment transactions.',
      dataSensitivity: 'critical',
      platformSupport: { ios: true, android: true, pwa: true },
      storePolicyImpact: 'financial compliance, user trust',
      offlineCompatibility: false,
      consentRequirements: 'explicit user confirmation for each transaction',
    });

    this.declareCapability('sensors', {
      purpose: 'Access device sensors (accelerometer, gyroscope, etc.) for interactive features.',
      dataSensitivity: 'low',
      platformSupport: { ios: true, android: true, pwa: false },
      storePolicyImpact: 'battery usage',
      offlineCompatibility: true,
      consentRequirements: 'implicit (often no explicit prompt, but usage should be transparent)',
    });

    this.declareCapability('backgroundTasks', {
      purpose: 'Execute tasks in the background when the app is not actively in use.',
      dataSensitivity: 'medium',
      platformSupport: { ios: true, android: true, pwa: true },
      storePolicyImpact: 'battery usage, resource management',
      offlineCompatibility: true,
      consentRequirements: 'explicit user permission for prolonged background activity',
    });
  }

  /**
   * Declares a new capability or updates an existing one.
   * @param {string} name - The unique name of the capability (e.g., 'camera', 'location').
   * @param {object} properties - An object defining the capability's properties.
   * @param {string} properties.purpose - A brief description of the capability's use case.
   * @param {string} properties.dataSensitivity - Level of data sensitivity (e.g., 'low', 'medium', 'high', 'critical').
   * @param {object} properties.platformSupport - Object indicating support across platforms (ios, android, pwa).
   * @param {string} properties.storePolicyImpact - Description of impact on app store policies.
   * @param {boolean} properties.offlineCompatibility - Whether the capability functions offline.
   * @param {string} properties.consentRequirements - Details on user consent requirements.
   */
  declareCapability(name, properties) {
    if (!name || typeof name !== 'string') {
      throw new Error('Capability name must be a non-empty string.');
    }
    if (!properties || typeof properties !== 'object') {
      throw new Error('Capability properties must be an object.');
    }
    this.capabilities[name] = { ...properties, name };
    console.log(`Capability '${name}' declared.`);
  }

  /**
   * Retrieves the definition of a specific capability.
   * @param {string} name - The name of the capability to retrieve.
   * @returns {object|undefined} The capability object, or undefined if not found.
   */
  getCapability(name) {
    return this.capabilities[name];
  }

  /**
   * Returns a list of all declared capabilities.
   * @returns {object[]} An array of all capability objects.
   */
  getAllCapabilities() {
    return Object.values(this.capabilities);
  }

  /**
   * Checks if a given capability is declared.
   * @param {string} name - The name of the capability to check.
   * @returns {boolean} True if the capability is declared, false otherwise.
   */
  hasCapability(name) {
    return !!this.capabilities[name];
  }
}

export { CapabilityDeclarationSystem };
export default CapabilityDeclarationSystem;
