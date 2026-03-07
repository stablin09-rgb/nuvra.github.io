'use strict';

/**
 * compatibilityMatrix.js — Nuvra Phase 8
 *
 * Compatibility & Versioning Strategy for the Nuvra Extension System.
 *
 * Responsibilities:
 * - Core version matrix: maps Nuvra core versions to supported extension API versions
 * - Deprecation registry: tracks deprecated APIs with sunset dates and migration guides
 * - Migration warnings: emits warnings when extensions use deprecated APIs
 * - Breaking change detection: identifies incompatible manifest changes between versions
 * - Extension API changelog: records what changed in each extension API version
 *
 * Versioning contract:
 * - Extension API version follows Nuvra core major version (e.g. core 8.x → API v8)
 * - Extensions declare a nuvraCoreVersion range in their manifest
 * - Breaking changes only happen on major version bumps
 * - Minor/patch versions are always backwards compatible within the same major
 */


// ─── Extension API Versions ───────────────────────────────────────────────────

import { NUVRA_CURRENT_VERSION } from '../manifest/manifestValidator.js';
const API_VERSIONS = Object.freeze({
  'v1': {
    coreRange:    '>=1.0.0 <2.0.0',
    status:       'eol',
    eolDate:      '2024-01-01',
    capabilities: ['ui:panel', 'ui:toolbar_button'],
    permissions:  ['storage:scoped', 'events:subscribe'],
  },
  'v2': {
    coreRange:    '>=2.0.0 <4.0.0',
    status:       'deprecated',
    deprecatedDate: '2025-01-01',
    sunsetDate:   '2026-06-01',
    capabilities: ['ui:panel', 'ui:toolbar_button', 'data:read'],
    permissions:  ['storage:scoped', 'events:subscribe', 'data:read'],
  },
  'v3': {
    coreRange:    '>=4.0.0 <7.0.0',
    status:       'deprecated',
    deprecatedDate: '2025-06-01',
    sunsetDate:   '2026-12-01',
    capabilities: ['ui:panel', 'ui:toolbar_button', 'data:read', 'data:write', 'ai:prompt_layer'],
    permissions:  ['storage:scoped', 'events:subscribe', 'data:read', 'data:write', 'ai:prompt_layer'],
  },
  'v8': {
    coreRange:    '>=8.0.0 <9.0.0',
    status:       'current',
    capabilities: [
      'ui:panel', 'ui:toolbar_button', 'ui:canvas_overlay', 'ui:sidebar_tab',
      'data:read', 'data:write', 'data:create_collection',
      'ai:prompt_layer', 'ai:planner_override', 'ai:schema_modifier', 'ai:output_validator',
      'runtime:publish_hook', 'runtime:mobile_hook',
    ],
    permissions: [
      'storage:scoped', 'events:subscribe', 'events:emit',
      'data:read', 'data:write', 'data:create_collection',
      'network:fetch',
      'ai:prompt_layer', 'ai:planner_override', 'ai:schema_modifier', 'ai:output_validator',
      'runtime:publish_hook', 'runtime:mobile_hook',
    ],
  },
});

// ─── Deprecated APIs ──────────────────────────────────────────────────────────

const DEPRECATED_APIS = [
  {
    api:          'sdk.getState',
    deprecatedIn: 'v3',
    removedIn:    'v8',
    replacement:  'sdk.store.getState()',
    reason:       'Direct state access replaced by typed store API',
  },
  {
    api:          'sdk.emit',
    deprecatedIn: 'v2',
    removedIn:    'v8',
    replacement:  'sdk.events.emit()',
    reason:       'Namespaced events API introduced in v3',
  },
  {
    api:          'manifest.apiVersion',
    deprecatedIn: 'v3',
    removedIn:    'v8',
    replacement:  'manifest.nuvraCoreVersion range string',
    reason:       'API version replaced by core version range for finer-grained compatibility',
  },
  {
    api:          'manifest.hooks',
    deprecatedIn: 'v2',
    removedIn:    'v8',
    replacement:  'manifest.capabilities array',
    reason:       'Hooks replaced by declarative capabilities',
  },
];

// ─── Breaking Changes Log ─────────────────────────────────────────────────────

const BREAKING_CHANGES = [
  {
    fromVersion: 'v3',
    toVersion:   'v8',
    changes: [
      'manifest.hooks removed — use manifest.capabilities',
      'sdk.getState() removed — use sdk.store.getState()',
      'sdk.emit() removed — use sdk.events.emit()',
      'manifest.apiVersion removed — use manifest.nuvraCoreVersion',
      'Permission "data:write_all" split into "data:write" and "data:create_collection"',
      'Network access now requires explicit domain whitelist in manifest.networkDomains',
    ],
  },
];

// ─── CompatibilityMatrix ──────────────────────────────────────────────────────

class CompatibilityMatrix {
  /**
   * @param {object} [options]
   * @param {string} [options.nuvraCoreVersion] - The current Nuvra core version
   * @param {object} [options.logger]
   */
  constructor({ nuvraCoreVersion = NUVRA_CURRENT_VERSION, logger = null } = {}) {
    this._coreVersion = nuvraCoreVersion;
    this._logger      = logger;
  }

  // ─── API Version Resolution ───────────────────────────────────────────────

  /**
   * Returns the current extension API version for the running Nuvra core.
   * @returns {string} e.g. 'v8'
   */
  getCurrentAPIVersion() {
    const [major] = this._coreVersion.split('.').map(Number);
    return `v${major}`;
  }

  /**
   * Returns the API version record for a given version string.
   * @param {string} version - e.g. 'v8'
   * @returns {object|null}
   */
  getAPIVersion(version) {
    return API_VERSIONS[version] ?? null;
  }

  /**
   * Returns all API versions.
   * @returns {object}
   */
  getAllAPIVersions() {
    return { ...API_VERSIONS };
  }

  // ─── Compatibility Check ─────────────────────────────────────────────────

  /**
   * Checks if a manifest's nuvraCoreVersion range is compatible with the current core.
   * @param {object} manifest
   * @returns {{ compatible: boolean, reason?: string, apiVersion?: string }}
   */
  checkManifestCompatibility(manifest) {
    const range = manifest.nuvraCoreVersion;
    if (!range) {
      return {
        compatible: false,
        reason:     'Manifest is missing required field: nuvraCoreVersion',
      };
    }

    const compatible = this._isCompatible(range);
    const apiVersion = this.getCurrentAPIVersion();

    if (!compatible) {
      return {
        compatible: false,
        reason:     `Extension requires Nuvra core ${range}, but current version is ${this._coreVersion}`,
        apiVersion,
      };
    }

    // Check if the API version is deprecated or EOL
    const apiRecord = this.getAPIVersion(apiVersion);
    if (apiRecord?.status === 'eol') {
      return {
        compatible: false,
        reason:     `Extension API ${apiVersion} has reached end-of-life. Please update to v${this.getCurrentAPIVersion()}.`,
        apiVersion,
      };
    }

    return { compatible: true, apiVersion };
  }

  // ─── Deprecation Warnings ─────────────────────────────────────────────────

  /**
   * Returns deprecation warnings for a manifest.
   * @param {object} manifest
   * @returns {object[]} Array of deprecation warning objects
   */
  getDeprecationWarnings(manifest) {
    const warnings = [];
    const apiVersion = this.getCurrentAPIVersion();
    const apiRecord  = this.getAPIVersion(apiVersion);

    // Check if the API version itself is deprecated
    if (apiRecord?.status === 'deprecated') {
      warnings.push({
        type:        'api_version_deprecated',
        api:         apiVersion,
        sunsetDate:  apiRecord.sunsetDate,
        replacement: `Update nuvraCoreVersion to target Nuvra core v${this.getCurrentAPIVersion()}`,
        severity:    'warning',
      });
    }

    // Check for deprecated capability/permission usage
    for (const deprecated of DEPRECATED_APIS) {
      // Check if the manifest uses any deprecated field patterns
      if (manifest.hooks && deprecated.api === 'manifest.hooks') {
        warnings.push({
          type:        'deprecated_api',
          api:         deprecated.api,
          deprecatedIn:deprecated.deprecatedIn,
          removedIn:   deprecated.removedIn,
          replacement: deprecated.replacement,
          reason:      deprecated.reason,
          severity:    'error', // Already removed
        });
      }
      if (manifest.apiVersion && deprecated.api === 'manifest.apiVersion') {
        warnings.push({
          type:        'deprecated_api',
          api:         deprecated.api,
          deprecatedIn:deprecated.deprecatedIn,
          removedIn:   deprecated.removedIn,
          replacement: deprecated.replacement,
          reason:      deprecated.reason,
          severity:    'error',
        });
      }
    }

    return warnings;
  }

  /**
   * Returns all deprecated APIs.
   * @returns {object[]}
   */
  getDeprecatedAPIs() {
    return [...DEPRECATED_APIS];
  }

  // ─── Breaking Changes ─────────────────────────────────────────────────────

  /**
   * Returns breaking changes between two API versions.
   * @param {string} fromVersion - e.g. 'v3'
   * @param {string} toVersion   - e.g. 'v8'
   * @returns {object[]}
   */
  getBreakingChanges(fromVersion, toVersion) {
    return BREAKING_CHANGES.filter(
      c => c.fromVersion === fromVersion && c.toVersion === toVersion
    );
  }

  /**
   * Returns a migration guide for upgrading from one version to another.
   * @param {string} fromVersion
   * @param {string} toVersion
   * @returns {object}
   */
  getMigrationGuide(fromVersion, toVersion) {
    const breaking = this.getBreakingChanges(fromVersion, toVersion);
    const deprecated = this.getDeprecatedAPIs().filter(d =>
      d.deprecatedIn === fromVersion || d.removedIn === toVersion
    );

    return {
      fromVersion,
      toVersion,
      breakingChanges: breaking.flatMap(b => b.changes),
      deprecatedAPIs:  deprecated,
      steps: [
        `1. Update manifest.nuvraCoreVersion to target Nuvra core ${API_VERSIONS[toVersion]?.coreRange || toVersion}`,
        `2. Replace all deprecated APIs listed above`,
        `3. Test with the ExtensionDevTools permission simulator`,
        `4. Run the DX report to verify no remaining issues`,
        `5. Re-submit for marketplace review`,
      ],
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── Capability/Permission Validation ────────────────────────────────────

  /**
   * Validates that a manifest's capabilities and permissions are supported in the current API version.
   * @param {object} manifest
   * @returns {{ valid: boolean, unsupportedCapabilities: string[], unsupportedPermissions: string[] }}
   */
  validateCapabilitiesAndPermissions(manifest) {
    const apiVersion = this.getCurrentAPIVersion();
    const apiRecord  = this.getAPIVersion(apiVersion);
    if (!apiRecord) {
      return { valid: false, unsupportedCapabilities: [], unsupportedPermissions: [], reason: 'Unknown API version' };
    }

    const supportedCaps  = new Set(apiRecord.capabilities);
    const supportedPerms = new Set(apiRecord.permissions);

    const unsupportedCapabilities = (manifest.capabilities || []).filter(c => !supportedCaps.has(c));
    const unsupportedPermissions  = (manifest.permissions  || []).filter(p => !supportedPerms.has(p));

    return {
      valid: unsupportedCapabilities.length === 0 && unsupportedPermissions.length === 0,
      unsupportedCapabilities,
      unsupportedPermissions,
    };
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  _isCompatible(rangeStr) {
    if (!rangeStr) return true;
    const [major] = this._coreVersion.split('.').map(Number);

    if (rangeStr.startsWith('^')) {
      const [reqMajor] = rangeStr.slice(1).split('.').map(Number);
      return major === reqMajor;
    }

    const parts = rangeStr.split(' ').filter(Boolean);
    for (const part of parts) {
      if (part.startsWith('>=')) {
        const [reqMajor] = part.slice(2).split('.').map(Number);
        if (major < reqMajor) return false;
      } else if (part.startsWith('<')) {
        const [reqMajor] = part.slice(1).split('.').map(Number);
        if (major >= reqMajor) return false;
      } else if (part.startsWith('<=')) {
        const [reqMajor] = part.slice(2).split('.').map(Number);
        if (major > reqMajor) return false;
      }
    }
    return true;
  }

  _log(level, message) {
    if (this._logger) this._logger[level]?.(`[CompatibilityMatrix] ${message}`);
  }
}

export { CompatibilityMatrix, API_VERSIONS, DEPRECATED_APIS, BREAKING_CHANGES };
export default CompatibilityMatrix;
