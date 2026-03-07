'use strict';

/**
 * extensionDevTools.js — Nuvra Phase 8
 *
 * Developer Experience (DX) Tooling for extension development.
 *
 * Provides:
 * - Local testing harness: run an extension locally without publishing
 * - Schema validation: validate a manifest before submitting
 * - Permission simulator: test what an extension can and cannot do
 * - Hot reload: re-activate an extension with updated code without full reinstall
 * - Compatibility checker: verify extension works with current Nuvra version
 * - DX report: comprehensive report of extension health and issues
 */

const { ManifestValidator } = require('../manifest/manifestValidator');
const { ExtensionGovernance } = require('../../governance/extensions/extensionGovernance');

// ─── ExtensionDevTools ────────────────────────────────────────────────────────

class ExtensionDevTools {
  /**
   * @param {object} options
   * @param {object}   options.registry   - The ExtensionRegistry
   * @param {object}   options.governance - The ExtensionGovernance
   * @param {object}   options.catalog    - The MarketplaceCatalog
   * @param {object}   [options.logger]
   */
  constructor({ registry, governance, catalog, logger = null }) {
    this._registry   = registry;
    this._governance = governance;
    this._catalog    = catalog;
    this._logger     = logger;
    this._validator  = new ManifestValidator();
    this._devSessions = new Map(); // extensionId → DevSession
  }

  // ─── Manifest Validation ─────────────────────────────────────────────────

  /**
   * Validates a manifest and returns a detailed report.
   * @param {object} manifest
   * @returns {object} Validation report
   */
  validateManifest(manifest) {
    const validation  = this._validator.validate(manifest);
    const govScan     = this._governance.scanManifest(manifest);

    return {
      valid:        validation.valid,
      errors:       validation.errors,
      warnings:     validation.warnings,
      securityScan: {
        threatLevel: govScan.threatLevel,
        findings:    govScan.findings,
      },
      summary: {
        permissionCount: (manifest.permissions || []).length,
        capabilityCount: (manifest.capabilities || []).length,
        hasNetworkAccess: (manifest.permissions || []).includes('network:fetch'),
        hasAIAccess:      (manifest.permissions || []).some(p => p.startsWith('ai:')),
        hasDataAccess:    (manifest.permissions || []).some(p => p.startsWith('data:')),
      },
    };
  }

  // ─── Code Security Scan ───────────────────────────────────────────────────

  /**
   * Scans extension source code for security issues.
   * @param {string} extensionId
   * @param {string} code
   * @returns {object} Scan result
   */
  scanCode(extensionId, code) {
    return this._governance.scanCode(extensionId, code);
  }

  // ─── Permission Simulator ─────────────────────────────────────────────────

  /**
   * Simulates whether an extension with given permissions can perform an action.
   * @param {string[]} permissions - The extension's declared permissions
   * @param {string}   action      - The action to test (e.g. 'data:read', 'network:fetch')
   * @returns {{ allowed: boolean, reason: string }}
   */
  simulatePermission(permissions, action) {
    const permSet = new Set(permissions);

    // Direct match
    if (permSet.has(action)) {
      return { allowed: true, reason: `Permission "${action}" is explicitly declared` };
    }

    // Wildcard match (e.g. 'data:*' covers 'data:read')
    const [ns] = action.split(':');
    if (permSet.has(`${ns}:*`)) {
      return { allowed: true, reason: `Wildcard permission "${ns}:*" covers "${action}"` };
    }

    return {
      allowed: false,
      reason:  `Permission "${action}" is not declared. Add it to the manifest permissions array.`,
    };
  }

  /**
   * Runs a batch of permission checks and returns a report.
   * @param {string[]} permissions
   * @param {string[]} actions
   * @returns {object[]}
   */
  simulatePermissions(permissions, actions) {
    return actions.map(action => ({
      action,
      ...this.simulatePermission(permissions, action),
    }));
  }

  // ─── Local Test Harness ───────────────────────────────────────────────────

  /**
   * Starts a local dev session for an extension.
   * Installs and activates the extension in dev mode (bypasses review requirements).
   *
   * @param {object} manifest
   * @param {string} code
   * @returns {{ ok: boolean, sessionId?: string, error?: string, warnings?: string[] }}
   */
  startDevSession(manifest, code) {
    // Validate manifest first
    const validation = this._validator.validate(manifest);
    if (!validation.valid) {
      return { ok: false, error: `Manifest validation failed: ${validation.errors.join('; ')}` };
    }

    // Scan code
    const codeScan = this._governance.scanCode(manifest.id, code);
    if (codeScan.threatLevel === 'critical') {
      return {
        ok:    false,
        error: `Code scan failed with CRITICAL threat: ${codeScan.findings.map(f => f.reason).join('; ')}`,
      };
    }

    // Uninstall if already installed (for re-runs)
    if (this._registry.isInstalled(manifest.id)) {
      this._registry.uninstall(manifest.id, { retainData: false });
    }

    // Install and activate
    const installResult = this._registry.install(manifest, code);
    if (!installResult.ok) {
      return { ok: false, error: `Install failed: ${installResult.errors?.join('; ')}` };
    }

    const sessionId = `dev_${manifest.id}_${Date.now()}`;
    this._devSessions.set(manifest.id, {
      sessionId,
      manifest,
      startedAt: new Date().toISOString(),
      reloads:   0,
    });

    this._log('info', `Dev session started: ${sessionId}`);
    return {
      ok:       true,
      sessionId,
      warnings: [...(validation.warnings || []), ...(codeScan.findings.map(f => `[${f.threat}] ${f.reason}`))],
    };
  }

  /**
   * Hot-reloads an extension with updated code.
   * @param {string} extensionId
   * @param {string} newCode
   * @returns {{ ok: boolean, error?: string }}
   */
  hotReload(extensionId, newCode) {
    const session = this._devSessions.get(extensionId);
    if (!session) {
      return { ok: false, error: `No dev session found for "${extensionId}". Call startDevSession() first.` };
    }

    // Scan new code
    const codeScan = this._governance.scanCode(extensionId, newCode);
    if (codeScan.threatLevel === 'critical') {
      return {
        ok:    false,
        error: `Hot reload blocked: CRITICAL threat in new code: ${codeScan.findings.map(f => f.reason).join('; ')}`,
      };
    }

    // Deactivate and re-activate with new code
    this._registry.deactivate(extensionId);
    const result = this._registry.activate(extensionId, newCode);

    if (result.ok) {
      session.reloads++;
      session.lastReloadAt = new Date().toISOString();
      this._log('info', `Hot reload #${session.reloads} for "${extensionId}"`);
    }

    return result;
  }

  /**
   * Ends a dev session and uninstalls the extension.
   * @param {string} extensionId
   * @returns {{ ok: boolean }}
   */
  endDevSession(extensionId) {
    this._devSessions.delete(extensionId);
    if (this._registry.isInstalled(extensionId)) {
      this._registry.uninstall(extensionId, { retainData: false });
    }
    this._log('info', `Dev session ended: ${extensionId}`);
    return { ok: true };
  }

  // ─── Compatibility Checker ────────────────────────────────────────────────

  /**
   * Checks if an extension is compatible with the current Nuvra version.
   * @param {string} extensionId
   * @returns {{ compatible: boolean, versions: object[], reason?: string }}
   */
  checkCompatibility(extensionId) {
    if (!this._catalog) {
      return { compatible: false, reason: 'No catalog available' };
    }
    const versions = this._catalog.getCompatibleVersions(extensionId);
    return {
      compatible: versions.length > 0,
      versions,
      reason: versions.length === 0 ? 'No compatible versions found for the current Nuvra core version' : undefined,
    };
  }

  // ─── DX Report ────────────────────────────────────────────────────────────

  /**
   * Generates a comprehensive DX report for an installed extension.
   * @param {string} extensionId
   * @returns {object}
   */
  getDXReport(extensionId) {
    const record   = this._registry.getById(extensionId);
    const sandbox  = this._registry.getSandbox(extensionId);
    const review   = this._governance.getReview(extensionId);
    const session  = this._devSessions.get(extensionId);
    const behaviorLog = this._governance.getBehaviorLog(extensionId);

    return {
      extensionId,
      installed:    !!record,
      active:       this._registry.isActive(extensionId),
      devMode:      !!session,
      sandboxState: sandbox?.getState() ?? 'not_loaded',
      errors:       sandbox?.getErrors() ?? [],
      review: review ? {
        status:      review.status,
        threatLevel: review.threatLevel,
        findings:    review.manifestScan?.findings ?? [],
      } : null,
      behaviorLog: {
        totalCalls: behaviorLog.length,
        recentCalls: behaviorLog.slice(-10),
      },
      session: session ? {
        sessionId:    session.sessionId,
        startedAt:    session.startedAt,
        reloads:      session.reloads,
        lastReloadAt: session.lastReloadAt ?? null,
      } : null,
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  _log(level, message) {
    if (this._logger) this._logger[level]?.(`[ExtensionDevTools] ${message}`);
  }
}

export { ExtensionDevTools };
export default ExtensionDevTools;
