/**
 * manifestValidator.js — Nuvra Extension System
 *
 * Validates extension manifests before installation or publishing.
 * Checks required fields, permission declarations, version compatibility,
 * and security constraints.
 */

import { TrustTier, Permission } from './extensionTypes.js';

// ─── Constants ────────────────────────────────────────────────────────────────

export const NUVRA_CURRENT_VERSION = '10.0.0';
export const MIN_SUPPORTED_EXTENSION_API = '8.0.0';

const REQUIRED_FIELDS = ['id', 'name', 'version', 'description', 'author', 'nuvraCoreVersion'];
const KNOWN_PERMISSIONS = new Set(Object.values(Permission));
const KNOWN_TRUST_TIERS = new Set(Object.values(TrustTier));

// ─── ManifestValidator ────────────────────────────────────────────────────────

export class ManifestValidator {
  constructor({ logger = null } = {}) {
    this._logger = logger;
  }

  /**
   * Validate a manifest object.
   * @param {object} manifest
   * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
   */
  validate(manifest) {
    const errors = [];
    const warnings = [];

    if (!manifest || typeof manifest !== 'object') {
      return { valid: false, errors: ['Manifest must be a non-null object'], warnings };
    }

    // Required fields
    for (const field of REQUIRED_FIELDS) {
      if (!manifest[field]) {
        errors.push(`Missing required field: "${field}"`);
      }
    }

    // ID format
    if (manifest.id && !/^[a-z0-9-_.]+$/.test(manifest.id)) {
      errors.push('Extension ID must contain only lowercase letters, numbers, hyphens, underscores, and dots');
    }

    // Version format (semver-like)
    if (manifest.version && !/^\d+\.\d+\.\d+/.test(manifest.version)) {
      errors.push('Extension version must follow semver format (e.g. 1.0.0)');
    }

    // Permissions
    if (manifest.permissions) {
      if (!Array.isArray(manifest.permissions)) {
        errors.push('Permissions must be an array');
      } else {
        for (const perm of manifest.permissions) {
          if (!KNOWN_PERMISSIONS.has(perm)) {
            warnings.push(`Unknown permission: "${perm}"`);
          }
        }
      }
    }

    // Trust tier
    if (manifest.trustTier && !KNOWN_TRUST_TIERS.has(manifest.trustTier)) {
      warnings.push(`Unknown trust tier: "${manifest.trustTier}"`);
    }

    // Entry point
    if (!manifest.main) {
      warnings.push('No entry point (main) specified — extension may not load correctly');
    }

    const valid = errors.length === 0;
    if (this._logger) {
      if (!valid) this._logger.warn?.('[ManifestValidator] Validation failed', { errors });
      else this._logger.info?.('[ManifestValidator] Manifest valid');
    }

    return { valid, errors, warnings };
  }

  /**
   * Check if a manifest is compatible with the current Nuvra version.
   * @param {object} manifest
   * @returns {{ compatible: boolean, reason?: string }}
   */
  checkCompatibility(manifest) {
    if (!manifest?.nuvraCoreVersion) {
      return { compatible: true }; // Assume compatible if not specified
    }

    // Simple semver major version check
    const required = parseInt(manifest.nuvraCoreVersion.split('.')[0], 10);
    const current  = parseInt(NUVRA_CURRENT_VERSION.split('.')[0], 10);

    if (required > current) {
      return {
        compatible: false,
        reason: `Extension requires Nuvra ${manifest.nuvraCoreVersion}, current version is ${NUVRA_CURRENT_VERSION}`,
      };
    }

    return { compatible: true };
  }
}

export default ManifestValidator;
