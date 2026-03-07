/**
 * Nuvra Builder — App Schema (Phase A)
 *
 * Defines the structured schema types for AI-generated web applications.
 *
 * Phase A improvements:
 * - validateAppPlan() now REPAIRS instead of throwing.
 *   A broken or partial AI response is repaired to a valid fallback plan,
 *   never causing a hard failure.
 * - repairAppPlan() is exported for explicit use in providers.
 * - Fallback AppPlan produces a working CRUD app with one collection.
 * - Extended APP_TYPES to include 'crm' and 'inventory'.
 *
 * Three schema types:
 *  - AiCollectionSchema  — describes a data collection the AI wants to create
 *  - AppComponentSchema  — describes a single UI component on an app page
 *  - AppPageSchema       — describes a full app page with layout and components
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

export const AI_FIELD_TYPES = [
  'text', 'number', 'boolean', 'date', 'select', 'email', 'url', 'textarea',
];

export const APP_TYPES = [
  'dashboard', 'crud', 'internal-tool', 'tracker', 'directory',
  'kanban', 'crm', 'inventory',
];

export const APP_COMPONENT_TYPES = [
  'data-table', 'data-form', 'data-list', 'stat-card', 'conditional',
];

export const APP_LAYOUTS = ['sidebar', 'topbar', 'fullwidth'];

// ─── Fallback AppPlan ─────────────────────────────────────────────────────────

const FALLBACK_APP_PLAN = {
  appName: 'My App',
  appType: 'crud',
  brand:   { name: 'My App', accent: '#7c6af7' },
  collections: [
    {
      id:   'items',
      name: 'Items',
      fields: [
        { id: '_id',        name: 'ID',          type: 'text', system: true,  required: false },
        { id: '_createdAt', name: 'Created At',  type: 'date', system: true,  required: false },
        { id: '_updatedAt', name: 'Updated At',  type: 'date', system: true,  required: false },
        { id: 'name',       name: 'Name',        type: 'text', system: false, required: true  },
        { id: 'description', name: 'Description', type: 'textarea', system: false, required: false },
      ],
    },
  ],
  pages: [
    {
      pageId:   'dashboard',
      pageName: 'Dashboard',
      pageType: 'dashboard',
      layout:   'topbar',
      components: [
        { componentType: 'stat-card',   collection: 'items', title: 'Total Items', config: { aggregation: 'count', label: 'Items', icon: '📊', color: '#7c6af7' } },
      ],
    },
    {
      pageId:   'items',
      pageName: 'Items',
      pageType: 'crud',
      layout:   'topbar',
      components: [
        { componentType: 'data-form',  collection: 'items', title: 'Add Item',   config: { submitLabel: 'Add Item' } },
        { componentType: 'data-table', collection: 'items', title: 'All Items',  config: { allowDelete: true } },
      ],
    },
  ],
};

// ─── Validators ───────────────────────────────────────────────────────────────

/**
 * Validate and normalise an AI-generated AppPlan.
 *
 * In Phase A this function NEVER throws. If the plan is broken or empty,
 * it repairs it to a valid fallback. This ensures AI generation always
 * produces a runnable result, even if the provider returns garbage.
 *
 * @param {object} raw - Raw object from the AI provider
 * @returns {AppPlan}  - Validated and normalised AppPlan
 */
export function validateAppPlan(raw) {
  if (!raw || typeof raw !== 'object') {
    console.warn('[Nuvra] validateAppPlan: received non-object, using fallback.');
    return _deepClone(FALLBACK_APP_PLAN);
  }

  const collections = _validateCollections(raw.collections);
  let   pages       = _validateAppPages(raw.pages, collections);

  // If no valid pages survived, use the fallback pages
  if (pages.length === 0) {
    console.warn('[Nuvra] validateAppPlan: no valid pages found, using fallback pages.');
    pages = _deepClone(FALLBACK_APP_PLAN.pages);
  }

  // If no valid collections survived, use the fallback collections
  const finalCollections = collections.length > 0
    ? collections
    : _deepClone(FALLBACK_APP_PLAN.collections);

  return {
    appName:     _safeString(raw.appName, 'My App'),
    appType:     APP_TYPES.includes(raw.appType) ? raw.appType : 'crud',
    brand: {
      name:   _safeString(raw.brand?.name || raw.appName, 'My App'),
      accent: _validHex(raw.brand?.accent) || '#7c6af7',
    },
    collections: finalCollections,
    pages,
  };
}

/**
 * Explicitly repair an AppPlan that may have come from an AI provider.
 * Alias for validateAppPlan — use this name in provider code for clarity.
 *
 * @param {object} raw
 * @returns {AppPlan}
 */
export function repairAppPlan(raw) {
  return validateAppPlan(raw);
}

// ─── Collection Validation ────────────────────────────────────────────────────

function _validateCollections(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  return raw
    .filter((col) => col && (col.id || col.name))
    .map((col) => ({
      id:     _slugify(col.id || col.name),
      name:   _safeString(col.name || col.id, 'Collection'),
      fields: _validateFields(col.fields),
    }));
}

function _validateFields(raw) {
  const systemFields = [
    { id: '_id',        name: 'ID',         type: 'text', system: true, required: false },
    { id: '_createdAt', name: 'Created At', type: 'date', system: true, required: false },
    { id: '_updatedAt', name: 'Updated At', type: 'date', system: true, required: false },
  ];

  if (!Array.isArray(raw) || raw.length === 0) return systemFields;

  const userFields = raw
    .filter((f) => f && (f.id || f.name))
    .filter((f) => !f.system) // strip any system fields the AI may have included
    .map((f) => ({
      id:       _slugify(f.id || f.name),
      name:     _safeString(f.name || f.id, 'Field'),
      type:     AI_FIELD_TYPES.includes(f.type) ? f.type : 'text',
      required: Boolean(f.required),
      options:  Array.isArray(f.options) ? f.options.map(String) : undefined,
      system:   false,
    }));

  return [...systemFields, ...userFields];
}

// ─── App Page Validation ──────────────────────────────────────────────────────

function _validateAppPages(raw, collections) {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  // Build a set of valid collection IDs for cross-reference validation
  const validCollectionIds = new Set(collections.map((c) => c.id));

  return raw
    .filter((page) => page && (page.pageId || page.pageName))
    .map((page) => ({
      pageId:     _slugify(page.pageId || page.pageName),
      pageName:   _safeString(page.pageName || page.pageId, 'Page'),
      pageType:   ['dashboard', 'crud', 'app'].includes(page.pageType) ? page.pageType : 'app',
      layout:     APP_LAYOUTS.includes(page.layout) ? page.layout : 'topbar',
      components: _validateAppComponents(page.components, validCollectionIds),
    }));
}

function _validateAppComponents(raw, validCollectionIds) {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  return raw
    .filter((c) => c && APP_COMPONENT_TYPES.includes(c.componentType))
    .map((c) => ({
      componentType: c.componentType,
      // If the referenced collection doesn't exist, keep it — the renderer will handle it gracefully
      collection:    _safeString(c.collection, ''),
      title:         _safeString(c.title, ''),
      config:        (c.config && typeof c.config === 'object') ? c.config : {},
    }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'item';
}

function _safeString(val, fallback) {
  return (typeof val === 'string' && val.trim().length > 0) ? val.trim() : fallback;
}

function _validHex(val) {
  if (typeof val === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(val.trim())) return val.trim();
  return null;
}

function _deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
