/**
 * Nuvra Builder — Manifest Builder
 *
 * Generates the nuvra.manifest.json file for a published project.
 *
 * The manifest is a machine-readable description of the site that:
 *  - Describes all pages and their types
 *  - Lists all data collections and their schemas
 *  - Records the required runtime modules
 *  - Provides version and build metadata
 *
 * The manifest is used by:
 *  - The publish pipeline (to know what to build)
 *  - Future cloud hosting (to know how to serve the site)
 *  - Future mobile builds (to know what data models exist)
 *  - Future CI/CD pipelines (for incremental builds)
 */

'use strict';

const NUVRA_VERSION = '0.5.0';

/**
 * Build the nuvra.manifest.json object.
 *
 * @param {object}   opts
 * @param {object[]} opts.pages       - All page objects from pageManager
 * @param {object}   opts.dataStore   - Serialized DataStore snapshot
 * @param {object}   opts.projectMeta - { name, accent }
 * @returns {object} The manifest object (JSON-serializable)
 */
export function buildManifest({ pages, dataStore, projectMeta = {} }) {
  const now = new Date().toISOString();

  const pageManifests = pages.map((page) => ({
    id:       page.id,
    name:     page.name,
    slug:     page.slug || _slugify(page.name),
    pageType: page.pageType || 'marketing',
    isHome:   page.isHome || false,
    hasRuntime: _pageNeedsRuntime(page),
  }));

  const collections = Object.values(dataStore.schemas || {}).map((schema) => ({
    id:     schema.id,
    name:   schema.name,
    fields: (schema.fields || []).filter((f) => !f.system).map((f) => ({
      id:       f.id,
      name:     f.name,
      type:     f.type,
      required: f.required || false,
    })),
  }));

  const requiredModules = _detectRequiredModules(pages);

  return {
    nuvra:     NUVRA_VERSION,
    builtAt:   now,
    project: {
      name:   projectMeta.name   || 'Nuvra Project',
      accent: projectMeta.accent || '#7c6af7',
    },
    pages:       pageManifests,
    collections,
    modules:     requiredModules,
    entryPoint:  _findEntryPoint(pageManifests),
    pageCount:   pages.length,
    hasAppPages: pages.some((p) => _pageNeedsRuntime(p)),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _pageNeedsRuntime(page) {
  const appTypes = ['app', 'dashboard', 'crud', 'internal-tool'];
  return appTypes.includes(page.pageType);
}

function _detectRequiredModules(pages) {
  const modules = new Set(['core']);
  const hasApp  = pages.some((p) => _pageNeedsRuntime(p));
  if (hasApp) {
    modules.add('data-store');
    modules.add('app-runtime');
    modules.add('action-engine');
  }
  return [...modules];
}

function _findEntryPoint(pageManifests) {
  const home = pageManifests.find((p) => p.isHome);
  if (home) return home.slug + '.html';
  if (pageManifests.length > 0) return pageManifests[0].slug + '.html';
  return 'index.html';
}

function _slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'page';
}
