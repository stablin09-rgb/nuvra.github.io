/**
 * manifestGenerator.js — Nuvra Phase 4
 *
 * The Manifest Generator.
 *
 * Generates the nuvra.manifest.json file that accompanies every published output.
 * The manifest is the machine-readable contract for:
 *  - Hosting providers (what pages exist, what routes to serve)
 *  - Mobile wrappers (Capacitor, React Native Web)
 *  - Marketplace listings (capabilities, permissions)
 *  - CI/CD pipelines (build metadata, version)
 *  - Compliance systems (data models, permissions)
 *  - Future Nuvra Cloud (deployment configuration)
 *
 * @module manifest/manifestGenerator
 */
'use strict';

import { RenderTarget, getRenderTargetDef } from '../renderer/renderTarget.js';

// ─── ManifestGenerator ────────────────────────────────────────────────────────
export class ManifestGenerator {
  constructor() {
    this._name = 'ManifestGenerator';
  }

  /**
   * Generate a nuvra.manifest.json from an AppSchema.
   *
   * @param {object} opts
   * @param {object}  opts.appSchema  - The AppSchema
   * @param {string}  opts.target     - The render target ID
   * @param {object}  [opts.config]   - Build configuration
   * @returns {object} The manifest object
   */
  generate(opts = {}) {
    const { appSchema, target, config = {} } = opts;

    if (!appSchema) throw new Error('ManifestGenerator.generate: appSchema is required');

    const targetDef = getRenderTargetDef(target);

    return {
      // ── Identity ─────────────────────────────────────────────────────────────
      _type:       'NuvraManifest',
      _version:    1,
      schemaVersion: appSchema._schemaVersion || 1,

      // ── App Identity ─────────────────────────────────────────────────────────
      id:          appSchema.id,
      name:        appSchema.name,
      description: appSchema.description || '',
      version:     config.version || appSchema.version || '1.0.0',

      // ── Build Metadata ────────────────────────────────────────────────────────
      builtAt:     Date.now(),
      builtWith:   'Nuvra v4',
      target:      target,
      targetLabel: targetDef?.label || target,

      // ── Pages ─────────────────────────────────────────────────────────────────
      pages: (appSchema.pages || []).map(p => ({
        id:          p.id,
        name:        p.name,
        slug:        p.slug || _slugify(p.name),
        mode:        p.mode || 'app',
        description: p.description || '',
        isHome:      p.isHome || false,
        componentCount: (p.layout || []).length,
      })),

      // ── Collections ───────────────────────────────────────────────────────────
      collections: (appSchema.collections || []).map(c => ({
        id:         c.id,
        name:       c.name,
        fieldCount: (c.fields || []).length,
        fields:     (c.fields || []).map(f => ({
          id:       f.id,
          label:    f.label,
          type:     f.type,
          required: f.rules?.required || false,
        })),
      })),

      // ── Actions ───────────────────────────────────────────────────────────────
      actions: (appSchema.actions || []).map(a => ({
        id:        a.id,
        name:      a.name,
        stepCount: (a.steps || []).length,
      })),

      // ── Capabilities ─────────────────────────────────────────────────────────
      // Derived from the schema — what does this app actually use?
      capabilities: this._deriveCapabilities(appSchema),

      // ── Permissions ──────────────────────────────────────────────────────────
      // Future: required permissions (camera, location, notifications, etc.)
      permissions: [],

      // ── State ─────────────────────────────────────────────────────────────────
      stateVars: {
        global:  (appSchema.state?.global  || []).map(s => ({ id: s.id, type: s.type })),
        page:    (appSchema.state?.page    || []).map(s => ({ id: s.id, type: s.type })),
        derived: (appSchema.state?.derived || []).map(s => ({ id: s.id })),
      },

      // ── Target Flags ──────────────────────────────────────────────────────────
      mobileReady:  targetDef?.mobileReady  || false,
      cloudReady:   targetDef?.cloudReady   || false,

      // ── Hooks (Future) ────────────────────────────────────────────────────────
      hooks: {
        auth:         null,  // Future: authentication provider
        env:          null,  // Future: environment variable injection
        plugins:      [],    // Future: plugin injection points
        marketplace:  null,  // Future: marketplace packaging metadata
      },

      // ── Routing ───────────────────────────────────────────────────────────────
      routing: {
        type:      'hash',  // 'hash' | 'history' (future)
        baseUrl:   config.baseUrl || '/',
        indexPage: appSchema.pages?.[0]?.id || null,
      },
    };
  }

  /**
   * Validate a manifest against an AppSchema.
   * @param {object} manifest
   * @param {object} appSchema
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate(manifest, appSchema) {
    const errors = [];
    if (!manifest || manifest._type !== 'NuvraManifest') errors.push('Invalid manifest type');
    if (manifest?.id !== appSchema?.id) errors.push('Manifest ID does not match schema ID');
    if (!manifest?.pages?.length) errors.push('Manifest has no pages');
    return { valid: errors.length === 0, errors };
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  _deriveCapabilities(appSchema) {
    const caps = new Set();

    // Check page modes
    for (const page of (appSchema.pages || [])) {
      if (page.mode === 'app')     caps.add('app_pages');
      if (page.mode === 'marketing') caps.add('marketing_pages');
      if (page.mode === 'hybrid')  caps.add('hybrid_pages');
    }

    // Check component types
    for (const page of (appSchema.pages || [])) {
      for (const comp of (page.layout || [])) {
        switch (comp.componentType) {
          case 'form':      caps.add('forms');      break;
          case 'table':     caps.add('tables');     break;
          case 'list':      caps.add('lists');      break;
          case 'filter':    caps.add('filters');    break;
          case 'stat-card': caps.add('stat_cards'); break;
          case 'chart':     caps.add('charts');     break;
        }
      }
    }

    // Check data
    if (appSchema.collections?.length) caps.add('data_collections');

    // Check actions
    if (appSchema.actions?.length) caps.add('actions');

    // Check state
    if (appSchema.state?.global?.length)  caps.add('global_state');
    if (appSchema.state?.derived?.length) caps.add('derived_state');

    return Array.from(caps).sort();
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────
export const manifestGenerator = new ManifestGenerator();
export default manifestGenerator;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
