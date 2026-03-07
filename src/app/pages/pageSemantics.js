/**
 * pageSemantics.js — Nuvra Phase 3
 *
 * Page Semantics & Modes.
 *
 * Every page in Nuvra has an explicit semantic role that determines:
 *  - Whether the App Runtime activates for this page
 *  - Which rendering pipeline is used
 *  - How the page is exported (static HTML vs. app bundle)
 *  - Whether mobile compatibility is available
 *
 * Page Modes:
 *
 *  MARKETING  — A static, content-driven page (landing page, about, blog).
 *               The App Runtime does NOT activate. Rendered as static HTML.
 *               Exported as a standalone HTML file.
 *
 *  APP        — A dynamic, stateful, data-driven page (dashboard, CRUD tool,
 *               workflow). The App Runtime ACTIVATES. Rendered by AppRenderer.
 *               Exported as part of the app bundle.
 *
 *  HYBRID     — A page that has both static content sections and dynamic
 *               app components (e.g., a pricing page with a live calculator).
 *               The App Runtime activates only for the dynamic sections.
 *               (Future — not fully implemented in Phase 3.)
 *
 * @module app/pages/pageSemantics
 */
'use strict';

// ─── Page Mode Constants ──────────────────────────────────────────────────────
export const PageMode = Object.freeze({
  MARKETING: 'marketing',
  APP:       'app',
  HYBRID:    'hybrid',
});

// ─── Page Mode Definitions ────────────────────────────────────────────────────
export const PAGE_MODE_DEFINITIONS = {
  [PageMode.MARKETING]: {
    id:                 PageMode.MARKETING,
    label:              'Marketing Page',
    description:        'Static, content-driven page. No app runtime. Exported as HTML.',
    runtimeActivates:   false,
    renderingPipeline:  'static',
    exportFormat:       'html',
    mobileCompatible:   true,
    icon:               '📄',
  },
  [PageMode.APP]: {
    id:                 PageMode.APP,
    label:              'App Page',
    description:        'Dynamic, stateful, data-driven page. App runtime activates.',
    runtimeActivates:   true,
    renderingPipeline:  'app',
    exportFormat:       'app-bundle',
    mobileCompatible:   true,
    icon:               '⚡',
  },
  [PageMode.HYBRID]: {
    id:                 PageMode.HYBRID,
    label:              'Hybrid Page',
    description:        'Static content + dynamic app sections. Partial runtime activation.',
    runtimeActivates:   true,
    renderingPipeline:  'hybrid',
    exportFormat:       'hybrid-bundle',
    mobileCompatible:   false, // Future
    icon:               '🔀',
  },
};

// ─── Semantic Utilities ───────────────────────────────────────────────────────
/**
 * Determine if the App Runtime should activate for a given page.
 * @param {object} pageSchema
 * @returns {boolean}
 */
export function shouldActivateRuntime(pageSchema) {
  const mode = pageSchema?.mode || PageMode.MARKETING;
  return PAGE_MODE_DEFINITIONS[mode]?.runtimeActivates ?? false;
}

/**
 * Get the rendering pipeline for a page.
 * @param {object} pageSchema
 * @returns {'static'|'app'|'hybrid'}
 */
export function getRenderingPipeline(pageSchema) {
  const mode = pageSchema?.mode || PageMode.MARKETING;
  return PAGE_MODE_DEFINITIONS[mode]?.renderingPipeline ?? 'static';
}

/**
 * Get the export format for a page.
 * @param {object} pageSchema
 * @returns {'html'|'app-bundle'|'hybrid-bundle'}
 */
export function getExportFormat(pageSchema) {
  const mode = pageSchema?.mode || PageMode.MARKETING;
  return PAGE_MODE_DEFINITIONS[mode]?.exportFormat ?? 'html';
}

/**
 * Validate that a page schema has a valid mode.
 * @param {object} pageSchema
 * @returns {{ ok: boolean, error?: string }}
 */
export function validatePageMode(pageSchema) {
  const mode = pageSchema?.mode;
  if (!mode) return { ok: false, error: 'Page is missing a mode declaration' };
  if (!PAGE_MODE_DEFINITIONS[mode]) {
    return { ok: false, error: `Unknown page mode: "${mode}". Must be one of: ${Object.keys(PAGE_MODE_DEFINITIONS).join(', ')}` };
  }
  return { ok: true };
}

/**
 * Get all page mode definitions as an array (for UI rendering).
 * @returns {object[]}
 */
export function getAllPageModes() {
  return Object.values(PAGE_MODE_DEFINITIONS);
}

export default PageMode;
