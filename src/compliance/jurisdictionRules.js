/**
 * Nuvra — jurisdictionRules.js (Phase 15)
 *
 * Data residency enforcement and cross-border transfer rules.
 * Maps cloud regions to jurisdictions and enforces data residency
 * requirements based on the project's active compliance frameworks.
 *
 * @module compliance/jurisdictionRules
 */
'use strict';

// ─── Region → Jurisdiction Map ────────────────────────────────────────────────
export const REGION_JURISDICTIONS = Object.freeze({
  // AWS regions
  'us-east-1':      { country: 'US', zone: 'US', continent: 'NA' },
  'us-east-2':      { country: 'US', zone: 'US', continent: 'NA' },
  'us-west-1':      { country: 'US', zone: 'US', continent: 'NA' },
  'us-west-2':      { country: 'US', zone: 'US', continent: 'NA' },
  'us-gov-west-1':  { country: 'US', zone: 'US_GOV', continent: 'NA' },
  'us-gov-east-1':  { country: 'US', zone: 'US_GOV', continent: 'NA' },
  'ca-central-1':   { country: 'CA', zone: 'CA', continent: 'NA' },
  'eu-west-1':      { country: 'IE', zone: 'EEA', continent: 'EU' },
  'eu-west-2':      { country: 'GB', zone: 'UK', continent: 'EU' },
  'eu-west-3':      { country: 'FR', zone: 'EEA', continent: 'EU' },
  'eu-central-1':   { country: 'DE', zone: 'EEA', continent: 'EU' },
  'eu-north-1':     { country: 'SE', zone: 'EEA', continent: 'EU' },
  'eu-south-1':     { country: 'IT', zone: 'EEA', continent: 'EU' },
  'ap-southeast-1': { country: 'SG', zone: 'APAC', continent: 'AS' },
  'ap-southeast-2': { country: 'AU', zone: 'AU', continent: 'OC' },
  'ap-northeast-1': { country: 'JP', zone: 'JP', continent: 'AS' },
  'ap-northeast-2': { country: 'KR', zone: 'KR', continent: 'AS' },
  'ap-south-1':     { country: 'IN', zone: 'IN', continent: 'AS' },
  'sa-east-1':      { country: 'BR', zone: 'BR', continent: 'SA' },
  'me-south-1':     { country: 'BH', zone: 'ME', continent: 'AS' },
  'af-south-1':     { country: 'ZA', zone: 'AF', continent: 'AF' },
  // Supabase regions (mapped to underlying AWS)
  'supabase-us-east-1':   { country: 'US', zone: 'US', continent: 'NA' },
  'supabase-eu-west-1':   { country: 'IE', zone: 'EEA', continent: 'EU' },
  'supabase-eu-central-1':{ country: 'DE', zone: 'EEA', continent: 'EU' },
  'supabase-ap-southeast-1': { country: 'SG', zone: 'APAC', continent: 'AS' },
  // Generic fallback
  'local':          { country: 'LOCAL', zone: 'LOCAL', continent: 'LOCAL' },
});

// ─── Framework → Residency Requirements ──────────────────────────────────────
const FRAMEWORK_RESIDENCY = {
  gdpr: {
    allowedZones:    ['EEA', 'UK'],
    adequacyCountries: ['US', 'CA', 'JP', 'AU', 'NZ', 'KR', 'IL', 'CH', 'AR', 'UY'],
    safeguards:      ['standardContractualClauses', 'bindingCorporateRules', 'adequacyDecision'],
    description:     'GDPR requires personal data to remain in the EEA or countries with adequacy decisions, or be protected by appropriate safeguards.',
  },
  hipaa: {
    allowedZones:    ['US', 'US_GOV'],
    adequacyCountries: [],
    safeguards:      ['businessAssociateAgreement'],
    description:     'HIPAA requires PHI to be stored and processed within the United States.',
  },
  'pci-dss': {
    allowedZones:    ['US', 'EEA', 'UK', 'AU', 'CA', 'JP'],
    adequacyCountries: [],
    safeguards:      ['networkIsolation', 'encryptionInTransit', 'encryptionAtRest'],
    description:     'PCI-DSS requires cardholder data to be stored in compliant environments with network isolation.',
  },
};

// ─── Public API ───────────────────────────────────────────────────────────────
export const jurisdictionRules = {
  /**
   * Get the jurisdiction info for a cloud region.
   * @param {string} region
   * @returns {object|null}
   */
  getJurisdiction(region) {
    return REGION_JURISDICTIONS[region] || null;
  },

  /**
   * Check whether a deployment config satisfies residency requirements
   * for a given set of active compliance frameworks.
   * @param {object} deployConfig - { region, dataClasses, regulatedTypes, ...safeguards }
   * @param {string[]} activeFrameworks
   * @returns {{ allowed: boolean, violations: string[], warnings: string[] }}
   */
  checkResidency(deployConfig, activeFrameworks) {
    const violations = [];
    const warnings   = [];
    const region     = deployConfig.region || 'us-east-1';
    const jurisdiction = this.getJurisdiction(region);

    if (!jurisdiction) {
      warnings.push(`Unknown region "${region}" — residency cannot be verified.`);
      return { allowed: true, violations, warnings };
    }

    for (const fwId of activeFrameworks) {
      const req = FRAMEWORK_RESIDENCY[fwId];
      if (!req) continue;

      const inAllowedZone = req.allowedZones.includes(jurisdiction.zone);
      const hasAdequacy   = req.adequacyCountries.includes(jurisdiction.country);
      const hasSafeguard  = req.safeguards.some(s => deployConfig[s] === true);

      if (!inAllowedZone && !hasAdequacy && !hasSafeguard) {
        violations.push(
          `[${fwId.toUpperCase()}] Region "${region}" (${jurisdiction.country}) does not satisfy residency requirements. ` +
          `Allowed zones: ${req.allowedZones.join(', ')}. ` +
          `Safeguards accepted: ${req.safeguards.join(', ')}.`
        );
      } else if (!inAllowedZone && (hasAdequacy || hasSafeguard)) {
        warnings.push(
          `[${fwId.toUpperCase()}] Region "${region}" is outside the preferred zone but is permitted via ${hasAdequacy ? 'adequacy decision' : 'safeguard'}.`
        );
      }
    }

    return {
      allowed:    violations.length === 0,
      violations,
      warnings,
    };
  },

  /**
   * Get recommended regions for a set of active frameworks.
   * @param {string[]} activeFrameworks
   * @returns {string[]} Recommended region IDs
   */
  getRecommendedRegions(activeFrameworks) {
    const allRegions = Object.entries(REGION_JURISDICTIONS);
    return allRegions
      .filter(([regionId, jurisdiction]) => {
        return activeFrameworks.every(fwId => {
          const req = FRAMEWORK_RESIDENCY[fwId];
          if (!req) return true;
          return req.allowedZones.includes(jurisdiction.zone);
        });
      })
      .map(([regionId]) => regionId);
  },

  /**
   * Get a human-readable summary of residency requirements for a framework.
   * @param {string} frameworkId
   * @returns {string}
   */
  getResidencySummary(frameworkId) {
    const req = FRAMEWORK_RESIDENCY[frameworkId];
    if (!req) return 'No specific residency requirements for this framework.';
    return req.description;
  },

  REGION_JURISDICTIONS,
  FRAMEWORK_RESIDENCY,
};
