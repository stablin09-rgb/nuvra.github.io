/**
 * Nuvra Builder — Site Planner (Phase A)
 *
 * Takes a PromptIntent (from the PromptAnalyser) and produces a SitePlan:
 * a structured description of which pages to create and which sections
 * each page should contain, in the correct order.
 *
 * Key improvements in Phase A:
 * - Dynamic section selection: sections are chosen based on detected features,
 *   not just hardcoded blueprints.
 * - Industry-aware taglines and accent colors.
 * - Richer multi-page site blueprints (up to 5 pages).
 * - Deduplication: requested features are never added twice.
 * - Correct section ordering: features always appear before CTA/footer.
 *
 * SitePlan shape:
 * {
 *   appName:  string,
 *   brand:    { name, tagline, accent },
 *   pages: [
 *     {
 *       pageId:   string,
 *       pageName: string,
 *       pageType: string,
 *       sections: string[],   // ordered section types
 *     }
 *   ],
 *   intent:   PromptIntent,
 * }
 */

'use strict';

import { PAGE_TYPES, SECTION_TYPES } from './pageSchema.js';

// ─── Core Section Blueprints ──────────────────────────────────────────────────
// Defines the minimal required sections for each page type.
// Optional sections are injected dynamically based on detected features.

const CORE_SECTIONS = {
  [PAGE_TYPES.SAAS]: [
    SECTION_TYPES.NAVBAR,
    SECTION_TYPES.HERO,
    SECTION_TYPES.FEATURES,
    SECTION_TYPES.CTA,
    SECTION_TYPES.FOOTER,
  ],
  [PAGE_TYPES.LANDING]: [
    SECTION_TYPES.NAVBAR,
    SECTION_TYPES.HERO,
    SECTION_TYPES.FEATURES,
    SECTION_TYPES.CTA,
    SECTION_TYPES.FOOTER,
  ],
  [PAGE_TYPES.PORTFOLIO]: [
    SECTION_TYPES.NAVBAR,
    SECTION_TYPES.HERO,
    SECTION_TYPES.GALLERY,
    SECTION_TYPES.ABOUT,
    SECTION_TYPES.FOOTER,
  ],
  [PAGE_TYPES.BLOG]: [
    SECTION_TYPES.NAVBAR,
    SECTION_TYPES.HERO,
    SECTION_TYPES.BLOG_LIST,
    SECTION_TYPES.FOOTER,
  ],
  [PAGE_TYPES.ABOUT]: [
    SECTION_TYPES.NAVBAR,
    SECTION_TYPES.HERO,
    SECTION_TYPES.ABOUT,
    SECTION_TYPES.TEAM,
    SECTION_TYPES.CTA,
    SECTION_TYPES.FOOTER,
  ],
  [PAGE_TYPES.CONTACT]: [
    SECTION_TYPES.NAVBAR,
    SECTION_TYPES.HERO,
    SECTION_TYPES.CONTACT_FORM,
    SECTION_TYPES.FOOTER,
  ],
  [PAGE_TYPES.DASHBOARD]: [
    SECTION_TYPES.STATS,
    SECTION_TYPES.FEATURES,
  ],
};

// ─── Optional Section Priority ────────────────────────────────────────────────
// When a feature is detected, it is inserted at the correct position.
// Higher priority = inserted earlier in the page.

const OPTIONAL_SECTION_PRIORITY = {
  [SECTION_TYPES.STATS]:        10,
  [SECTION_TYPES.TESTIMONIALS]: 20,
  [SECTION_TYPES.PRICING]:      30,
  [SECTION_TYPES.TEAM]:         40,
  [SECTION_TYPES.FAQ]:          50,
  [SECTION_TYPES.GALLERY]:      60,
  [SECTION_TYPES.BLOG_LIST]:    70,
  [SECTION_TYPES.CONTACT_FORM]: 80,
};

// ─── Multi-Page Site Blueprints ───────────────────────────────────────────────

const SITE_BLUEPRINTS = {
  [PAGE_TYPES.SAAS]: [
    { pageType: PAGE_TYPES.SAAS,    pageName: 'Home',     suffix: '' },
    { pageType: PAGE_TYPES.ABOUT,   pageName: 'About',    suffix: '-about' },
    { pageType: PAGE_TYPES.BLOG,    pageName: 'Blog',     suffix: '-blog' },
    { pageType: PAGE_TYPES.CONTACT, pageName: 'Contact',  suffix: '-contact' },
  ],
  [PAGE_TYPES.PORTFOLIO]: [
    { pageType: PAGE_TYPES.PORTFOLIO, pageName: 'Work',    suffix: '' },
    { pageType: PAGE_TYPES.ABOUT,     pageName: 'About',   suffix: '-about' },
    { pageType: PAGE_TYPES.CONTACT,   pageName: 'Contact', suffix: '-contact' },
  ],
  [PAGE_TYPES.BLOG]: [
    { pageType: PAGE_TYPES.BLOG,    pageName: 'Blog',    suffix: '' },
    { pageType: PAGE_TYPES.ABOUT,   pageName: 'About',   suffix: '-about' },
    { pageType: PAGE_TYPES.CONTACT, pageName: 'Contact', suffix: '-contact' },
  ],
  [PAGE_TYPES.LANDING]: [
    { pageType: PAGE_TYPES.LANDING, pageName: 'Home',    suffix: '' },
    { pageType: PAGE_TYPES.ABOUT,   pageName: 'About',   suffix: '-about' },
    { pageType: PAGE_TYPES.CONTACT, pageName: 'Contact', suffix: '-contact' },
  ],
};

// ─── Industry-Aware Taglines ──────────────────────────────────────────────────

const INDUSTRY_TAGLINES = {
  fintech:    'Smarter money, built for you.',
  health:     'Your health, your way.',
  education:  'Learn without limits.',
  saas:       'The platform that scales with you.',
  ecommerce:  'Shop smarter, live better.',
  creative:   'Crafting experiences that matter.',
  realestate: 'Find your perfect space.',
  legal:      'Trusted counsel, clear results.',
  food:       'Good food, great moments.',
  travel:     'Your journey starts here.',
  nonprofit:  'Making a difference, together.',
  devtools:   'Build better, ship faster.',
  general:    'Built with purpose.',
};

const PAGE_TYPE_TAGLINES = {
  [PAGE_TYPES.SAAS]:      'The smarter way to build.',
  [PAGE_TYPES.PORTFOLIO]: 'Crafting digital experiences.',
  [PAGE_TYPES.BLOG]:      'Ideas worth sharing.',
  [PAGE_TYPES.LANDING]:   'Something great is coming.',
  [PAGE_TYPES.ABOUT]:     'Our story, our mission.',
  [PAGE_TYPES.CONTACT]:   "Let's work together.",
  [PAGE_TYPES.DASHBOARD]: 'Your data, at a glance.',
};

// ─── Industry Accent Colors ───────────────────────────────────────────────────

const INDUSTRY_ACCENTS = {
  fintech:    '#3b82f6',
  health:     '#10b981',
  education:  '#f59e0b',
  saas:       '#7c6af7',
  ecommerce:  '#f97316',
  creative:   '#ec4899',
  realestate: '#14b8a6',
  legal:      '#6366f1',
  food:       '#ef4444',
  travel:     '#0ea5e9',
  nonprofit:  '#10b981',
  devtools:   '#6366f1',
  general:    '#7c6af7',
};

// ─── Section Builder ──────────────────────────────────────────────────────────

/**
 * Build an ordered section list for a page, merging the core blueprint
 * with any optional sections detected from the prompt.
 *
 * @param {string} pageType
 * @param {string[]} detectedFeatures - section types detected in the prompt
 * @returns {string[]}
 */
function _buildSections(pageType, detectedFeatures = []) {
  const core = [...(CORE_SECTIONS[pageType] || CORE_SECTIONS[PAGE_TYPES.LANDING])];

  // Determine the insertion zone: between the last non-footer section and footer/CTA
  const footerIdx = core.indexOf(SECTION_TYPES.FOOTER);
  const ctaIdx    = core.indexOf(SECTION_TYPES.CTA);
  const insertAt  = ctaIdx > -1 ? ctaIdx : (footerIdx > -1 ? footerIdx : core.length);

  // Collect optional sections that are not already in core, sorted by priority
  const toInsert = detectedFeatures
    .filter((f) => !core.includes(f) && OPTIONAL_SECTION_PRIORITY[f] !== undefined)
    .sort((a, b) => (OPTIONAL_SECTION_PRIORITY[a] || 99) - (OPTIONAL_SECTION_PRIORITY[b] || 99));

  // Insert them before the CTA/footer
  core.splice(insertAt, 0, ...toInsert);

  return core;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a SitePlan from a PromptIntent.
 *
 * @param {PromptIntent} intent
 * @returns {SitePlan}
 */
export function planSite(intent) {
  const brandName = intent.brand || intent.brandName || _inferBrandName(intent.rawPrompt || intent.raw || '');
  const accent    = intent.accent || INDUSTRY_ACCENTS[intent.industry] || INDUSTRY_ACCENTS.general;
  const tagline   = INDUSTRY_TAGLINES[intent.industry]
                 || PAGE_TYPE_TAGLINES[intent.pageType]
                 || 'Built with Nuvra.';
  const baseId    = _slugify(brandName || intent.pageType);

  const brand = { name: brandName, tagline, accent };

  // ── Determine pages ──────────────────────────────────────────────────────
  let pageSpecs;

  if (intent.isMultiPage) {
    pageSpecs = SITE_BLUEPRINTS[intent.pageType] || SITE_BLUEPRINTS[PAGE_TYPES.LANDING];
  } else {
    pageSpecs = [{ pageType: intent.pageType, pageName: brandName || 'Home', suffix: '' }];
  }

  // ── Build page plans ─────────────────────────────────────────────────────
  const pages = pageSpecs.map(({ pageType, pageName, suffix }) => {
    // Only inject detected features into the home/main page, not sub-pages
    const featuresForPage = suffix === '' ? (intent.features || []) : [];
    const sections = _buildSections(pageType, featuresForPage);

    return {
      pageId:   `${baseId}${suffix}`,
      pageName: pageName || brandName || 'Home',
      pageType,
      sections,
    };
  });

  return {
    appName: brandName || 'My Site',
    brand,
    pages,
    intent,
  };
}

/**
 * Plan a single page (convenience wrapper around planSite).
 *
 * @param {PromptIntent} intent
 * @returns {PagePlan}  — the first page from the SitePlan
 */
export function planPage(intent) {
  const sitePlan = planSite({ ...intent, isMultiPage: false });
  return sitePlan.pages[0];
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

function _slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'page';
}

function _inferBrandName(prompt) {
  const words = prompt.split(/\s+/).filter((w) => w.length > 3);
  if (words.length > 0) {
    return words[0].charAt(0).toUpperCase() + words[0].slice(1);
  }
  return 'Nuvra';
}
