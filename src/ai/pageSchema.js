/**
 * Nuvra Builder — Page Schema Type System (Phase A)
 *
 * Defines the structured schema that all AI providers must return.
 * The AI never returns raw HTML — it returns a PageSchema, which is then
 * rendered into HTML/CSS by the SchemaRenderer.
 *
 * Phase A improvements:
 * - validatePageSchema() now REPAIRS instead of throwing.
 *   A broken or partial AI response is repaired to a valid fallback schema,
 *   never causing a hard failure.
 * - repairPageSchema() is exported for explicit use in providers.
 * - validateSitePlan() repairs each page individually.
 * - All known section types are validated; unknown types are stripped.
 *
 * PageSchema shape:
 * {
 *   pageId:    string,
 *   pageName:  string,
 *   pageType:  PageType,
 *   brand: { name, tagline, accent },
 *   sections:  SectionSchema[],
 * }
 *
 * SectionSchema shape:
 * {
 *   type: SectionType,
 *   data: object,
 * }
 */

'use strict';

// ─── Page Types ───────────────────────────────────────────────────────────────

export const PAGE_TYPES = {
  LANDING:    'landing',
  SAAS:       'saas',
  PORTFOLIO:  'portfolio',
  BLOG:       'blog',
  ABOUT:      'about',
  CONTACT:    'contact',
  DASHBOARD:  'dashboard',
  CRUD:       'crud',
  INTERNAL:   'internal',
};

// ─── Section Types ────────────────────────────────────────────────────────────

export const SECTION_TYPES = {
  HERO:         'hero',
  FEATURES:     'features',
  BENEFITS:     'benefits',
  TESTIMONIALS: 'testimonials',
  PRICING:      'pricing',
  FAQ:          'faq',
  CTA:          'cta',
  FOOTER:       'footer',
  NAVBAR:       'navbar',
  ABOUT:        'about',
  TEAM:         'team',
  STATS:        'stats',
  GALLERY:      'gallery',
  BLOG_LIST:    'blog-list',
  CONTACT_FORM: 'contact-form',
};

// Set of all valid section type values for fast lookup
const VALID_SECTION_TYPES = new Set(Object.values(SECTION_TYPES));

// ─── Fallback Schema ──────────────────────────────────────────────────────────

const FALLBACK_SCHEMA = {
  pageId:   'generated-page',
  pageName: 'Generated Page',
  pageType: PAGE_TYPES.LANDING,
  brand: { name: 'Nuvra', tagline: 'Built with Nuvra.', accent: '#7c6af7' },
  sections: [
    {
      type: SECTION_TYPES.NAVBAR,
      data: { brand: 'Nuvra', links: [{ label: 'Home', href: '#' }, { label: 'About', href: '#' }] },
    },
    {
      type: SECTION_TYPES.HERO,
      data: { headline: 'Welcome to Nuvra', subheadline: 'Build anything with AI.', cta: { label: 'Get Started', href: '#' } },
    },
    {
      type: SECTION_TYPES.FEATURES,
      data: {
        headline: 'Key Features',
        items: [
          { icon: '⚡', title: 'Fast', description: 'Build in minutes.' },
          { icon: '🎨', title: 'Beautiful', description: 'Stunning designs out of the box.' },
          { icon: '🔌', title: 'Extensible', description: 'Plug in any AI provider.' },
        ],
      },
    },
    {
      type: SECTION_TYPES.CTA,
      data: { headline: 'Ready to build?', cta: { label: 'Start Now', href: '#' } },
    },
    {
      type: SECTION_TYPES.FOOTER,
      data: { brand: 'Nuvra', links: [{ label: 'Privacy', href: '#' }] },
    },
  ],
};

// ─── Schema Validation & Repair ───────────────────────────────────────────────

/**
 * Validate and normalise a raw PageSchema object.
 *
 * In Phase A this function NEVER throws. If the schema is broken or empty,
 * it repairs it to a valid fallback. This ensures AI generation always
 * produces a renderable result, even if the provider returns garbage.
 *
 * @param {object} raw
 * @returns {PageSchema}
 */
export function validatePageSchema(raw) {
  if (!raw || typeof raw !== 'object') {
    console.warn('[Nuvra] validatePageSchema: received non-object, using fallback.');
    return _deepClone(FALLBACK_SCHEMA);
  }

  // Repair sections
  let sections = [];
  if (Array.isArray(raw.sections) && raw.sections.length > 0) {
    sections = raw.sections
      .map(_normaliseSection)
      .filter(Boolean);
  }

  // If no valid sections survived, use the fallback sections
  if (sections.length === 0) {
    console.warn('[Nuvra] validatePageSchema: no valid sections found, using fallback sections.');
    sections = _deepClone(FALLBACK_SCHEMA.sections);
  }

  // Ensure NAVBAR is first if not present
  if (!sections.find((s) => s.type === SECTION_TYPES.NAVBAR)) {
    sections.unshift({
      type: SECTION_TYPES.NAVBAR,
      data: { brand: raw.brand?.name || 'Nuvra', links: [] },
    });
  }

  // Ensure FOOTER is last if not present
  if (!sections.find((s) => s.type === SECTION_TYPES.FOOTER)) {
    sections.push({
      type: SECTION_TYPES.FOOTER,
      data: { brand: raw.brand?.name || 'Nuvra', links: [] },
    });
  }

  return {
    pageId:   _safeString(raw.pageId,   'generated-page'),
    pageName: _safeString(raw.pageName, 'Generated Page'),
    pageType: _safePageType(raw.pageType),
    brand: {
      name:    _safeString(raw.brand?.name,    'Nuvra'),
      tagline: _safeString(raw.brand?.tagline, ''),
      accent:  _safeColor(raw.brand?.accent,   '#7c6af7'),
    },
    sections,
  };
}

/**
 * Explicitly repair a PageSchema that may have come from an AI provider.
 * Alias for validatePageSchema — use this name in provider code for clarity.
 *
 * @param {object} raw
 * @returns {PageSchema}
 */
export function repairPageSchema(raw) {
  return validatePageSchema(raw);
}

/**
 * Validate a SitePlan — an object with a pages array of PageSchema objects.
 * Each page is repaired individually; the plan never fails as a whole.
 *
 * @param {object} raw
 * @returns {{ pages: PageSchema[] }}
 */
export function validateSitePlan(raw) {
  if (!raw || !Array.isArray(raw.pages) || raw.pages.length === 0) {
    console.warn('[Nuvra] validateSitePlan: no pages found, returning single fallback page.');
    return { pages: [_deepClone(FALLBACK_SCHEMA)] };
  }
  return { pages: raw.pages.map(validatePageSchema) };
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

function _normaliseSection(section) {
  if (!section || typeof section !== 'object') return null;

  const type = section.type;

  // Strip sections with unknown types (they cannot be rendered)
  if (!VALID_SECTION_TYPES.has(type)) {
    console.warn(`[Nuvra] Unknown section type "${type}" — stripped from schema.`);
    return null;
  }

  return {
    type,
    data: (section.data && typeof section.data === 'object') ? section.data : {},
  };
}

function _safeString(val, fallback) {
  return (typeof val === 'string' && val.trim().length > 0) ? val.trim() : fallback;
}

function _safePageType(val) {
  const valid = new Set(Object.values(PAGE_TYPES));
  return valid.has(val) ? val : PAGE_TYPES.LANDING;
}

function _safeColor(val, fallback) {
  return (typeof val === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(val.trim())) ? val.trim() : fallback;
}

function _deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
