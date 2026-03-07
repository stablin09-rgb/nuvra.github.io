/**
 * Nuvra Builder — Version Resolver (Phase 11)
 *
 * Handles semantic versioning, dependency resolution, and compatibility checks.
 * Uses a simplified semver implementation (no external dependencies).
 *
 * Supports:
 *  - Exact version: "1.2.3"
 *  - Range: "^1.2.3" (compatible), "~1.2.3" (patch), ">=1.0.0"
 *  - Latest: "latest"
 *  - Pinned: exact match only
 *
 * Dependency resolution algorithm:
 *  1. For each dependency in the asset's manifest, find the best matching version
 *  2. If a dependency is already installed, check if the installed version satisfies the range
 *  3. If not, flag as a conflict (not silently upgraded)
 *  4. Return resolved, missing, and conflicting dependency lists
 */
'use strict';

export const versionResolver = {

  /**
   * Resolve a specific version of an asset.
   * @param {CloudAsset} asset
   * @param {string} targetVersion - 'latest' or a specific version string
   * @returns {AssetVersion|null}
   */
  resolve(asset, targetVersion = 'latest') {
    const versions = asset.versions || [];
    if (!versions.length) {
      // Synthetic version from top-level fields
      return {
        version:    asset.latestVersion || asset.version || '1.0.0',
        bundle:     asset.bundle || '',
        bundleUrl:  asset.bundleUrl || null,
        changelog:  '',
        minNuvraVersion: asset.compatibility?.minNuvraVersion || '1.0.0',
        dependencies: asset.dependencies || [],
        targets:    asset.compatibility?.targets || ['web'],
      };
    }

    if (targetVersion === 'latest') {
      // Return the highest version
      return versions.reduce((best, v) =>
        !best || this._compareVersions(v.version, best.version) > 0 ? v : best
      , null);
    }

    // Exact match first
    const exact = versions.find(v => v.version === targetVersion);
    if (exact) return exact;

    // Range match
    const matching = versions.filter(v => this._satisfies(v.version, targetVersion));
    if (!matching.length) return null;

    // Return highest matching
    return matching.reduce((best, v) =>
      this._compareVersions(v.version, best.version) > 0 ? v : best
    );
  },

  /**
   * Check if a version spec is compatible with the current Nuvra version.
   * @param {AssetVersion} versionSpec
   * @param {string} nuvraVersion
   * @returns {{ compatible: boolean, message: string }}
   */
  checkCompatibility(versionSpec, nuvraVersion) {
    const minRequired = versionSpec.minNuvraVersion || '1.0.0';
    if (this._compareVersions(nuvraVersion, minRequired) < 0) {
      return {
        compatible: false,
        message: `This asset requires Nuvra ${minRequired} or higher (current: ${nuvraVersion})`,
      };
    }
    const maxAllowed = versionSpec.maxNuvraVersion;
    if (maxAllowed && this._compareVersions(nuvraVersion, maxAllowed) > 0) {
      return {
        compatible: false,
        message: `This asset is not compatible with Nuvra ${nuvraVersion} (max: ${maxAllowed})`,
      };
    }
    return { compatible: true, message: '' };
  },

  /**
   * Resolve all dependencies for a version spec.
   * @param {AssetVersion} versionSpec
   * @param {object} marketplaceService - the marketplace service for catalog lookups
   * @returns {Promise<{ resolved: string[], missing: string[], conflicts: object[] }>}
   */
  async resolveDependencies(versionSpec, marketplaceService) {
    const deps     = versionSpec.dependencies || [];
    const resolved = [];
    const missing  = [];
    const conflicts = [];

    for (const dep of deps) {
      const depId      = typeof dep === 'string' ? dep : dep.assetId;
      const depRange   = typeof dep === 'string' ? 'latest' : (dep.version || 'latest');
      const depAsset   = await marketplaceService.getAsset(depId);

      if (!depAsset) {
        missing.push(depId);
        continue;
      }

      // Check if already installed
      const installed = marketplaceService.isInstalled(depId);
      if (installed) {
        const installedEntry = marketplaceService.getInstalled
          ? marketplaceService.getInstalled().find(a => a.assetId === depId)
          : null;
        if (installedEntry && !this._satisfies(installedEntry.version, depRange)) {
          conflicts.push({
            assetId:          depId,
            required:         depRange,
            installed:        installedEntry.version,
            message:          `Installed version ${installedEntry.version} does not satisfy required range ${depRange}`,
          });
        } else {
          resolved.push(depId);
        }
      } else {
        // Not installed — will need to be installed
        resolved.push(depId);
      }
    }

    return { resolved, missing, conflicts };
  },

  /**
   * Check if versionA is newer than versionB.
   * @returns {boolean}
   */
  isNewer(versionA, versionB) {
    return this._compareVersions(versionA, versionB) > 0;
  },

  /**
   * Get a human-readable changelog diff between two versions.
   * @param {CloudAsset} asset
   * @param {string} fromVersion
   * @param {string} toVersion
   * @returns {string[]} Array of changelog entries
   */
  getChangelog(asset, fromVersion, toVersion) {
    const versions = (asset.versions || []).filter(v => {
      const cmp = this._compareVersions(v.version, fromVersion);
      return cmp > 0 && this._compareVersions(v.version, toVersion) <= 0;
    });
    versions.sort((a, b) => this._compareVersions(b.version, a.version));
    return versions.map(v => `v${v.version}: ${v.changelog || 'No changelog provided'}`);
  },

  // ─── Semver Helpers ─────────────────────────────────────────────────────────

  /**
   * Compare two version strings.
   * @returns {number} -1, 0, or 1
   */
  _compareVersions(a, b) {
    const pa = this._parseSemver(a);
    const pb = this._parseSemver(b);
    for (let i = 0; i < 3; i++) {
      if (pa[i] > pb[i]) return 1;
      if (pa[i] < pb[i]) return -1;
    }
    return 0;
  },

  _parseSemver(v) {
    if (!v || v === 'latest') return [Infinity, 0, 0];
    const parts = String(v).replace(/^[^0-9]*/, '').split('.').map(Number);
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  },

  /**
   * Check if a version satisfies a range.
   * Supports: ^, ~, >=, <=, >, <, =, exact, latest
   */
  _satisfies(version, range) {
    if (!range || range === 'latest' || range === '*') return true;
    if (range === version) return true;

    const v = this._parseSemver(version);

    // ^1.2.3 — compatible (same major)
    if (range.startsWith('^')) {
      const r = this._parseSemver(range.slice(1));
      return v[0] === r[0] && this._compareVersions(version, range.slice(1)) >= 0;
    }

    // ~1.2.3 — patch-compatible (same major.minor)
    if (range.startsWith('~')) {
      const r = this._parseSemver(range.slice(1));
      return v[0] === r[0] && v[1] === r[1] && this._compareVersions(version, range.slice(1)) >= 0;
    }

    // >=1.2.3
    if (range.startsWith('>=')) {
      return this._compareVersions(version, range.slice(2)) >= 0;
    }

    // <=1.2.3
    if (range.startsWith('<=')) {
      return this._compareVersions(version, range.slice(2)) <= 0;
    }

    // >1.2.3
    if (range.startsWith('>')) {
      return this._compareVersions(version, range.slice(1)) > 0;
    }

    // <1.2.3
    if (range.startsWith('<')) {
      return this._compareVersions(version, range.slice(1)) < 0;
    }

    // =1.2.3 or exact
    const clean = range.replace(/^=/, '');
    return version === clean;
  },
};
