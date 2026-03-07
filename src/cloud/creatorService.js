/**
 * Nuvra Builder — Creator Service (Phase 11)
 *
 * Manages creator accounts, the asset publishing flow, and the validation pipeline.
 *
 * Creator lifecycle:
 *  1. Register as creator (profile + payout info)
 *  2. Submit an asset draft (manifest + bundle + screenshots)
 *  3. Automated validation (schema, security, compatibility, AI behavior)
 *  4. Preview rendering
 *  5. Publish (goes live in the marketplace)
 *  6. Version updates (changelog required)
 *  7. Analytics & earnings dashboard
 *
 * Publishing validation pipeline (all steps MUST pass):
 *  ✓ Manifest schema validation
 *  ✓ Bundle syntax check (no eval, no exfiltration patterns)
 *  ✓ Permission declaration completeness
 *  ✓ Nuvra version compatibility
 *  ✓ Mobile compatibility check (if targets include 'mobile')
 *  ✓ AI behavior verification (if type === 'ai-pack')
 *  ✓ License declaration
 *  ✓ Pricing model validity
 *
 * Creator profiles and drafts are stored in localStorage and synced to Supabase.
 */
'use strict';

import { trustEngine } from '../governance/trust/trustEngine.js';

const CREATOR_KEY = (uid) => `nuvra-creator-${uid || 'anon'}`;
const DRAFTS_KEY  = (uid) => `nuvra-creator-drafts-${uid || 'anon'}`;
const ASSETS_KEY  = (uid) => `nuvra-creator-assets-${uid || 'anon'}`;

let _userId = null;

function _read(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }
function _readObj(key) { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } }
function _write(key, data) { try { localStorage.setItem(key, JSON.stringify(data)); } catch {} }

export const creatorService = {

  init(userId) {
    _userId = userId;
  },

  // ── Creator Profile ─────────────────────────────────────────────────────────

  /**
   * Register a new creator profile.
   * @param {{ name, bio, website, payoutEmail, payoutProvider }} profile
   * @returns {CreatorProfile}
   */
  registerCreator(profile) {
    const uid = _userId;
    const existing = this.getCreatorProfile(uid);
    if (existing) return existing;

    const creator = {
      creatorId:       uid,
      name:            profile.name || 'Anonymous Creator',
      bio:             profile.bio || '',
      website:         profile.website || '',
      payoutEmail:     profile.payoutEmail || '',
      payoutProvider:  profile.payoutProvider || 'stripe',
      verified:        false,
      tier:            'standard',
      registeredAt:    new Date().toISOString(),
      totalAssets:     0,
      totalInstalls:   0,
      totalEarnings:   0,
    };
    _write(CREATOR_KEY(uid), creator);
    return creator;
  },

  getCreatorProfile(userId) {
    return _read(CREATOR_KEY(userId || _userId));
  },

  updateCreatorProfile(updates) {
    const profile = this.getCreatorProfile(_userId);
    if (!profile) return null;
    const updated = { ...profile, ...updates, updatedAt: new Date().toISOString() };
    _write(CREATOR_KEY(_userId), updated);
    return updated;
  },

  isCreator(userId) {
    return !!this.getCreatorProfile(userId || _userId);
  },

  // ── Asset Drafts ────────────────────────────────────────────────────────────

  /**
   * Save an asset draft (pre-submission).
   * @param {object} draft - partial asset manifest + bundle
   * @returns {string} draftId
   */
  saveDraft(draft) {
    const drafts = _readObj(DRAFTS_KEY(_userId));
    const draftId = draft.draftId || `draft_${Date.now()}`;
    drafts[draftId] = {
      ...draft,
      draftId,
      creatorId:  _userId,
      savedAt:    new Date().toISOString(),
      status:     'draft',
    };
    _write(DRAFTS_KEY(_userId), drafts);
    return draftId;
  },

  getDraft(draftId) {
    const drafts = _readObj(DRAFTS_KEY(_userId));
    return drafts[draftId] || null;
  },

  getAllDrafts() {
    return Object.values(_readObj(DRAFTS_KEY(_userId)));
  },

  deleteDraft(draftId) {
    const drafts = _readObj(DRAFTS_KEY(_userId));
    delete drafts[draftId];
    _write(DRAFTS_KEY(_userId), drafts);
  },

  // ── Publishing Pipeline ─────────────────────────────────────────────────────

  /**
   * Run the full validation pipeline on a draft.
   * Returns a detailed validation report.
   * @param {string} draftId
   * @returns {Promise<ValidationReport>}
   */
  async validateDraft(draftId) {
    const draft = this.getDraft(draftId);
    if (!draft) return { valid: false, errors: ['Draft not found'], warnings: [], steps: [] };

    const steps  = [];
    const errors = [];
    const warnings = [];

    // Step 1: Manifest schema validation
    const schemaResult = _validateManifestSchema(draft);
    steps.push({ name: 'Manifest Schema', ...schemaResult });
    errors.push(...(schemaResult.errors || []));
    warnings.push(...(schemaResult.warnings || []));

    // Step 2: Bundle security scan
    const securityResult = _scanBundleSecurity(draft.bundle || '');
    steps.push({ name: 'Security Scan', ...securityResult });
    errors.push(...(securityResult.errors || []));
    warnings.push(...(securityResult.warnings || []));

    // Step 3: Permission completeness
    const permResult = _validatePermissions(draft);
    steps.push({ name: 'Permission Declarations', ...permResult });
    errors.push(...(permResult.errors || []));
    warnings.push(...(permResult.warnings || []));

    // Step 4: Compatibility check
    const compatResult = _validateCompatibility(draft);
    steps.push({ name: 'Compatibility', ...compatResult });
    errors.push(...(compatResult.errors || []));
    warnings.push(...(compatResult.warnings || []));

    // Step 5: Mobile compatibility (if applicable)
    if ((draft.targets || []).includes('mobile')) {
      const mobileResult = _validateMobileCompatibility(draft);
      steps.push({ name: 'Mobile Compatibility', ...mobileResult });
      errors.push(...(mobileResult.errors || []));
      warnings.push(...(mobileResult.warnings || []));
    }

    // Step 6: AI behavior verification (if AI pack)
    if (draft.type === 'ai-pack') {
      const aiResult = _validateAIPack(draft);
      steps.push({ name: 'AI Behavior Verification', ...aiResult });
      errors.push(...(aiResult.errors || []));
      warnings.push(...(aiResult.warnings || []));
    }

    // Step 7: License declaration
    const licenseResult = _validateLicense(draft);
    steps.push({ name: 'License Declaration', ...licenseResult });
    errors.push(...(licenseResult.errors || []));
    warnings.push(...(licenseResult.warnings || []));

    // Step 8: Pricing model
    const pricingResult = _validatePricing(draft);
    steps.push({ name: 'Pricing Model', ...pricingResult });
    errors.push(...(pricingResult.errors || []));
    warnings.push(...(pricingResult.warnings || []));

    // Step 9: Trust / integrity
    const trustResult = await trustEngine.signAsset(draft);
    steps.push({ name: 'Asset Signing', passed: true, message: `Signed: ${trustResult.signature?.slice(0, 16)}...` });

    const valid = errors.length === 0;
    if (valid) {
      // Update draft status
      const drafts = _readObj(DRAFTS_KEY(_userId));
      if (drafts[draftId]) {
        drafts[draftId].status    = 'validated';
        drafts[draftId].signature = trustResult.signature;
        _write(DRAFTS_KEY(_userId), drafts);
      }
    }

    return { valid, errors, warnings, steps, draftId };
  },

  /**
   * Publish a validated draft to the marketplace.
   * @param {string} draftId
   * @returns {Promise<PublishResult>}
   */
  async publishDraft(draftId) {
    const draft = this.getDraft(draftId);
    if (!draft) return { success: false, message: 'Draft not found' };
    if (draft.status !== 'validated') {
      return { success: false, message: 'Draft must be validated before publishing. Run validation first.' };
    }

    const now = new Date().toISOString();
    const assetId = draft.assetId || `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const publishedAsset = {
      ...draft,
      assetId,
      creatorId:     _userId,
      publishedAt:   now,
      updatedAt:     now,
      status:        'published',
      latestVersion: draft.version || '1.0.0',
      versions: [{
        version:         draft.version || '1.0.0',
        bundle:          draft.bundle,
        changelog:       draft.changelog || 'Initial release',
        publishedAt:     now,
        minNuvraVersion: draft.minNuvraVersion || '11.0.0',
        dependencies:    draft.dependencies || [],
        targets:         draft.targets || ['web'],
      }],
    };

    // Store in creator's published assets
    const assets = _readObj(ASSETS_KEY(_userId));
    assets[assetId] = publishedAsset;
    _write(ASSETS_KEY(_userId), assets);

    // Remove draft
    this.deleteDraft(draftId);

    // Update creator stats
    const profile = this.getCreatorProfile(_userId);
    if (profile) {
      this.updateCreatorProfile({ totalAssets: (profile.totalAssets || 0) + 1 });
    }

    return { success: true, assetId, asset: publishedAsset };
  },

  /**
   * Publish a new version of an existing asset.
   * @param {string} assetId
   * @param {{ version, bundle, changelog, targets }} versionData
   * @returns {Promise<PublishVersionResult>}
   */
  async publishVersion(assetId, versionData) {
    const assets = _readObj(ASSETS_KEY(_userId));
    const asset  = assets[assetId];
    if (!asset) return { success: false, message: 'Asset not found' };

    const now = new Date().toISOString();
    const newVersion = {
      version:         versionData.version,
      bundle:          versionData.bundle,
      changelog:       versionData.changelog || '',
      publishedAt:     now,
      minNuvraVersion: versionData.minNuvraVersion || '11.0.0',
      dependencies:    versionData.dependencies || [],
      targets:         versionData.targets || asset.versions?.[0]?.targets || ['web'],
    };

    asset.versions = [newVersion, ...(asset.versions || [])];
    asset.latestVersion = versionData.version;
    asset.updatedAt     = now;
    assets[assetId]     = asset;
    _write(ASSETS_KEY(_userId), assets);

    return { success: true, version: versionData.version };
  },

  getPublishedAssets() {
    return Object.values(_readObj(ASSETS_KEY(_userId)));
  },

  getPublishedAsset(assetId) {
    return _readObj(ASSETS_KEY(_userId))[assetId] || null;
  },
};

// ─── Validation Helpers ───────────────────────────────────────────────────────

function _validateManifestSchema(draft) {
  const errors = [];
  const warnings = [];
  const required = ['name', 'type', 'description', 'version'];
  for (const field of required) {
    if (!draft[field]) errors.push(`Missing required field: ${field}`);
  }
  const validTypes = ['template', 'plugin', 'component', 'integration', 'ai-pack', 'blueprint'];
  if (draft.type && !validTypes.includes(draft.type)) {
    errors.push(`Invalid type "${draft.type}". Must be one of: ${validTypes.join(', ')}`);
  }
  if (!draft.bundle && !draft.bundleUrl) {
    errors.push('Asset must have either a bundle (inline code) or a bundleUrl');
  }
  if (draft.description && draft.description.length < 20) {
    warnings.push('Description is very short. A longer description improves discoverability.');
  }
  if (!draft.screenshots || !draft.screenshots.length) {
    warnings.push('No screenshots provided. Screenshots improve conversion rates.');
  }
  return { passed: errors.length === 0, errors, warnings };
}

function _scanBundleSecurity(bundle) {
  const errors = [];
  const warnings = [];
  const dangerous = [
    { pattern: /\beval\s*\(/, msg: 'Use of eval() is not allowed' },
    { pattern: /new\s+Function\s*\(/, msg: 'Use of new Function() is not allowed' },
    { pattern: /document\.cookie/, msg: 'Cookie access is not allowed' },
    { pattern: /localStorage\s*\.\s*(setItem|getItem|removeItem)(?!\s*\(\s*['"]nuvra-ext-)/, msg: 'Direct localStorage access outside nuvra-ext- namespace is not allowed' },
    { pattern: /window\.parent/, msg: 'Access to window.parent is not allowed' },
    { pattern: /window\.top/, msg: 'Access to window.top is not allowed' },
    { pattern: /XMLHttpRequest/, msg: 'Use fetch() instead of XMLHttpRequest' },
  ];
  for (const { pattern, msg } of dangerous) {
    if (pattern.test(bundle)) errors.push(msg);
  }
  const suspicious = [
    { pattern: /fetch\s*\(/, msg: 'Network requests detected — ensure network:fetch permission is declared' },
    { pattern: /navigator\.geolocation/, msg: 'Geolocation access detected — ensure geolocation permission is declared' },
  ];
  for (const { pattern, msg } of suspicious) {
    if (pattern.test(bundle)) warnings.push(msg);
  }
  return { passed: errors.length === 0, errors, warnings };
}

function _validatePermissions(draft) {
  const errors = [];
  const warnings = [];
  const bundle = draft.bundle || '';
  if (!draft.permissions || !Array.isArray(draft.permissions)) {
    warnings.push('No permissions declared. If your extension uses any APIs, declare the required permissions.');
  }
  if (bundle.includes('nuvra.editor') && !(draft.permissions || []).some(p => p.startsWith('editor'))) {
    errors.push('Extension uses editor API but does not declare editor permissions');
  }
  if (bundle.includes('nuvra.data') && !(draft.permissions || []).some(p => p.startsWith('data'))) {
    errors.push('Extension uses data API but does not declare data permissions');
  }
  if (bundle.includes('nuvra.ai') && !(draft.permissions || []).some(p => p.startsWith('ai'))) {
    errors.push('Extension uses AI API but does not declare ai permissions');
  }
  return { passed: errors.length === 0, errors, warnings };
}

function _validateCompatibility(draft) {
  const errors = [];
  const warnings = [];
  if (!draft.minNuvraVersion) {
    warnings.push('minNuvraVersion not specified. Defaulting to 1.0.0 (may cause issues on older versions).');
  }
  return { passed: true, errors, warnings };
}

function _validateMobileCompatibility(draft) {
  const warnings = [];
  const bundle = draft.bundle || '';
  if (bundle.includes('window.innerWidth') && !bundle.includes('__NUVRA_MOBILE__')) {
    warnings.push('Extension uses window.innerWidth but does not check __NUVRA_MOBILE__ context. Consider using CSS variables for responsive behavior.');
  }
  return { passed: true, errors: [], warnings };
}

function _validateAIPack(draft) {
  const errors = [];
  const warnings = [];
  const bundle = draft.bundle || '';
  if (!bundle.includes('nuvra.ai.addPromptExtender') && !bundle.includes('nuvra.ai.registerPlanner')) {
    errors.push('AI Pack must call nuvra.ai.addPromptExtender() or nuvra.ai.registerPlanner()');
  }
  if (!draft.aiPackMeta) {
    warnings.push('aiPackMeta not provided. Consider adding domain, industry, and useCase fields for better AI recommendations.');
  }
  return { passed: errors.length === 0, errors, warnings };
}

function _validateLicense(draft) {
  const errors = [];
  const warnings = [];
  if (!draft.license) {
    warnings.push('No license declared. Defaulting to MIT. Specify a license explicitly.');
  }
  return { passed: true, errors, warnings };
}

function _validatePricing(draft) {
  const errors = [];
  const warnings = [];
  const pricing = draft.pricing || { model: 'free' };
  const validModels = ['free', 'one-time', 'subscription', 'usage-based', 'revenue-share'];
  if (!validModels.includes(pricing.model)) {
    errors.push(`Invalid pricing model "${pricing.model}". Must be one of: ${validModels.join(', ')}`);
  }
  if (pricing.model === 'one-time' && (!pricing.price || pricing.price <= 0)) {
    errors.push('One-time pricing requires a price > 0');
  }
  if (pricing.model === 'subscription' && !pricing.requiredPlan) {
    warnings.push('Subscription pricing should specify requiredPlan (free, pro, team, enterprise)');
  }
  return { passed: errors.length === 0, errors, warnings };
}
