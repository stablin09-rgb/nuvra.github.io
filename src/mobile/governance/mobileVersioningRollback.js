/**
 * mobileVersioningRollback.js - Nuvra Phase 9
 *
 * Implements mobile build versioning, rollback capabilities, and compatibility checks.
 * This ensures that users are never trapped in broken builds and provides mechanisms
 * for safe updates and migrations.
 */

const { logger } = require("../../diagnostics/logger");

class MobileVersioningRollback {
  /**
   * @param {object} options
   * @param {object} options.logger - Logger instance.
   */
  constructor({ logger }) {
    this.logger = logger;
    this.buildHistory = []; // Stores records of past builds
    this.currentVersion = null;
  }

  /**
   * Records a new successful mobile build.
   * @param {object} buildDetails - Details of the completed build.
   * @param {string} buildDetails.version - Semantic version string (e.g., "1.0.0").
   * @param {string} buildDetails.buildId - Unique identifier for the build.
   * @param {string} buildDetails.appPackagePath - Path to the generated app package.
   * @param {object} buildDetails.compatibilityMatrix - Compatibility info for this build.
   */
  recordNewBuild(buildDetails) {
    this.buildHistory.push({ ...buildDetails, timestamp: new Date().toISOString() });
    this.currentVersion = buildDetails.version;
    this.logger.info(`New mobile build recorded: Version ${buildDetails.version}, Build ID: ${buildDetails.buildId}`);
  }

  /**
   * Retrieves the history of all recorded builds.
   * @returns {object[]}
   */
  getBuildHistory() {
    return [...this.buildHistory];
  }

  /**
   * Initiates a rollback to a previous stable build.
   * @param {string} versionOrBuildId - The version string or build ID to roll back to.
   * @returns {object|null} The details of the build rolled back to, or null if not found.
   */
  rollbackToBuild(versionOrBuildId) {
    const targetBuild = this.buildHistory.find(
      (build) => build.version === versionOrBuildId || build.buildId === versionOrBuildId
    );

    if (targetBuild) {
      this.currentVersion = targetBuild.version;
      this.logger.warn(`Initiating rollback to Version ${targetBuild.version}, Build ID: ${targetBuild.buildId}.`);
      // In a real system, this would trigger deployment of the old package.
      return targetBuild;
    } else {
      this.logger.error(`Rollback failed: Build with version or ID \'${versionOrBuildId}\' not found.`);
      return null;
    }
  }

  /**
   * Checks compatibility between a new app version and existing user data/settings.
   * @param {string} newVersion - The version string of the new app.
   * @param {string} currentInstalledVersion - The version currently installed on the user\'s device.
   * @returns {{ compatible: boolean, warning: string|null, migrationRequired: boolean }}
   */
  checkCompatibility(newVersion, currentInstalledVersion) {
    this.logger.debug(`Checking compatibility: New ${newVersion}, Current ${currentInstalledVersion}`);

    // Simple semantic version comparison for demonstration.
    // A real system would have a more robust compatibility matrix.
    const [newMajor, newMinor, newPatch] = newVersion.split(".").map(Number);
    const [currentMajor, currentMinor, currentPatch] = currentInstalledVersion.split(".").map(Number);

    if (newMajor > currentMajor) {
      return { compatible: true, warning: "Major update detected. Data migration may be required.", migrationRequired: true };
    } else if (newMajor === currentMajor && newMinor > currentMinor) {
      return { compatible: true, warning: "Minor update detected. Check for new features.", migrationRequired: false };
    } else if (newMajor === currentMajor && newMinor === currentMinor && newPatch > currentPatch) {
      return { compatible: true, warning: null, migrationRequired: false };
    } else if (newVersion === currentInstalledVersion) {
      return { compatible: true, warning: "Same version. No update needed.", migrationRequired: false };
    } else if (newMajor < currentMajor || (newMajor === currentMajor && newMinor < currentMinor)) {
      return { compatible: false, warning: "Downgrade detected. This is generally not recommended and may lead to data loss.", migrationRequired: true };
    }

    return { compatible: true, warning: null, migrationRequired: false };
  }

  /**
   * Generates a warning message for runtime migration.
   * @param {string} oldVersion
   * @param {string} newVersion
   * @returns {string}
   */
  generateMigrationWarning(oldVersion, newVersion) {
    return `A significant update from version ${oldVersion} to ${newVersion} has been detected. ` +
           `Please back up your data before proceeding, as some features or data structures may have changed.`;
  }
}

export { MobileVersioningRollback };
export default MobileVersioningRollback;
