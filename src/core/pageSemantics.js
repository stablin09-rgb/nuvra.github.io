/**
 * Nuvra Builder — Page Semantics
 *
 * Defines the canonical page type constants used throughout the builder.
 * This module is the single source of truth for page type identifiers.
 *
 * Imported by:
 *  - previewRenderer.js  (to determine marketing vs app rendering path)
 *  - publishRenderer.js  (same)
 *  - pageManager.js      (to tag pages with a type on creation)
 *  - appPlanner.js       (to assign types to planned pages)
 */
'use strict';

// ─── Page Type Constants ──────────────────────────────────────────────────────

/**
 * All supported page types in Nuvra.
 *
 * Marketing types render as clean static HTML/CSS.
 * App types include the embedded runtime and data snapshot.
 */
export const PAGE_TYPES = {
  // ── Marketing page types ──────────────────────────────────────────────────
  LANDING:    'landing',
  SAAS:       'saas',
  PORTFOLIO:  'portfolio',
  BLOG:       'blog',
  ABOUT:      'about',
  CONTACT:    'contact',

  // ── App page types ────────────────────────────────────────────────────────
  APP:        'app',
  DASHBOARD:  'dashboard',
  CRUD:       'crud',
  INTERNAL:   'internal',
};

/**
 * Set of page types that require the app runtime.
 * Used by renderers to determine which rendering path to use.
 */
export const APP_PAGE_TYPES = new Set([
  PAGE_TYPES.APP,
  PAGE_TYPES.DASHBOARD,
  PAGE_TYPES.CRUD,
  PAGE_TYPES.INTERNAL,
]);

/**
 * Set of page types that render as clean static HTML/CSS.
 */
export const MARKETING_PAGE_TYPES = new Set([
  PAGE_TYPES.LANDING,
  PAGE_TYPES.SAAS,
  PAGE_TYPES.PORTFOLIO,
  PAGE_TYPES.BLOG,
  PAGE_TYPES.ABOUT,
  PAGE_TYPES.CONTACT,
]);

/**
 * Returns true if the given pageType requires the app runtime.
 * @param {string} pageType
 * @returns {boolean}
 */
export function isAppPage(pageType) {
  return APP_PAGE_TYPES.has(pageType);
}

/**
 * Returns true if the given pageType is a marketing page.
 * @param {string} pageType
 * @returns {boolean}
 */
export function isMarketingPage(pageType) {
  return MARKETING_PAGE_TYPES.has(pageType) || !pageType;
}

/**
 * Human-readable labels for each page type.
 * Used in the UI (page type selector, page list).
 */
export const PAGE_TYPE_LABELS = {
  [PAGE_TYPES.LANDING]:   'Landing Page',
  [PAGE_TYPES.SAAS]:      'SaaS Page',
  [PAGE_TYPES.PORTFOLIO]: 'Portfolio',
  [PAGE_TYPES.BLOG]:      'Blog',
  [PAGE_TYPES.ABOUT]:     'About Page',
  [PAGE_TYPES.CONTACT]:   'Contact Page',
  [PAGE_TYPES.APP]:       'App Page',
  [PAGE_TYPES.DASHBOARD]: 'Dashboard',
  [PAGE_TYPES.CRUD]:      'CRUD Tool',
  [PAGE_TYPES.INTERNAL]:  'Internal Tool',
};

/**
 * Default layout configuration for each page type.
 * Used by the page renderer and the app runtime.
 */
export const PAGE_TYPE_CONFIG = {
  [PAGE_TYPES.LANDING]:   { layout: 'fullwidth', runtime: false },
  [PAGE_TYPES.SAAS]:      { layout: 'fullwidth', runtime: false },
  [PAGE_TYPES.PORTFOLIO]: { layout: 'fullwidth', runtime: false },
  [PAGE_TYPES.BLOG]:      { layout: 'content',   runtime: false },
  [PAGE_TYPES.ABOUT]:     { layout: 'content',   runtime: false },
  [PAGE_TYPES.CONTACT]:   { layout: 'content',   runtime: false },
  [PAGE_TYPES.APP]:       { layout: 'sidebar',   runtime: true  },
  [PAGE_TYPES.DASHBOARD]: { layout: 'sidebar',   runtime: true  },
  [PAGE_TYPES.CRUD]:      { layout: 'topbar',    runtime: true  },
  [PAGE_TYPES.INTERNAL]:  { layout: 'topbar',    runtime: true  },
};
