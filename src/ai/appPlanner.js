/**
 * Nuvra Builder — App Planner (Phase A)
 *
 * Two modules:
 *
 * 1. analyseAppPrompt()
 *    Extracts structured intent from a user's app-building prompt.
 *    Now delegates to the unified PromptAnalyser and enriches the result
 *    with app-specific fields.
 *
 * 2. planApp()
 *    Takes the extracted intent and produces a deterministic AppPlan.
 *    Used by the MockProvider when no real AI key is configured.
 *    Real AI providers receive the AppPlan format directly from the LLM.
 *
 * Phase A improvements:
 * - Delegates to the unified PromptAnalyser (no duplicate signal detection).
 * - Stronger app type disambiguation (CRM vs CRUD, kanban vs tracker).
 * - Richer field templates (10 entity types).
 * - CRM and inventory templates added.
 * - All templates produce valid AppPlan shapes that pass validateAppPlan().
 */

'use strict';

import { analysePrompt } from './promptAnalyser.js';
import { validateAppPlan } from './appSchema.js';

// ─── Public: analyseAppPrompt ─────────────────────────────────────────────────

/**
 * Analyse a user prompt and extract structured app intent.
 * Delegates to the unified PromptAnalyser and maps the result to AppIntent.
 *
 * @param {string} prompt
 * @returns {AppIntent}
 */
export function analyseAppPrompt(prompt) {
  const intent = analysePrompt(prompt);

  return {
    raw:       prompt,
    appType:   intent.appType || 'crud',
    entities:  intent.entities && intent.entities.length > 0 ? intent.entities : ['item'],
    features:  intent.features || [],
    brandName: intent.brand || intent.brandName || null,
    accent:    intent.accent || '#7c6af7',
    industry:  intent.industry || 'general',
    tone:      intent.tone || 'professional',
    confidence: intent.confidence || {},
  };
}

// ─── Public: planApp ──────────────────────────────────────────────────────────

/**
 * Generate a deterministic AppPlan from extracted AppIntent.
 * Used by the MockProvider when no real AI key is configured.
 *
 * @param {AppIntent} intent
 * @returns {AppPlan}
 */
export function planApp(intent) {
  const templateFn = APP_TEMPLATES[intent.appType] || APP_TEMPLATES['crud'];
  const raw = templateFn(intent);

  // Ensure brand accent is propagated
  if (raw.brand && !raw.brand.accent) {
    raw.brand.accent = intent.accent;
  }

  return validateAppPlan(raw);
}

// ─── App Templates ────────────────────────────────────────────────────────────
// Each template is a function: (AppIntent) → raw AppPlan object.
// All templates must produce a shape that passes validateAppPlan().

const APP_TEMPLATES = {

  // ── Generic CRUD ────────────────────────────────────────────────────────────
  crud: (intent) => {
    const entity     = intent.entities[0] || 'item';
    const entityCap  = _cap(entity);
    const appName    = intent.brandName || `${entityCap} Manager`;
    const collection = entity + 's';

    return {
      appName,
      appType: 'crud',
      brand:   { name: appName, accent: intent.accent },
      collections: [
        { id: collection, name: entityCap + 's', fields: _fieldsFor(entity) },
      ],
      pages: [
        {
          pageId:   'dashboard',
          pageName: 'Dashboard',
          pageType: 'dashboard',
          layout:   'topbar',
          components: [
            _statCard(collection, `Total ${entityCap}s`, { aggregation: 'count', label: `${entityCap}s`, icon: '📊', color: intent.accent }),
          ],
        },
        {
          pageId:   collection,
          pageName: entityCap + 's',
          pageType: 'crud',
          layout:   'topbar',
          components: [
            _form(collection, `Add ${entityCap}`, { submitLabel: `Add ${entityCap}`, successMessage: `${entityCap} added!` }),
            _table(collection, `All ${entityCap}s`, { allowDelete: true }),
          ],
        },
      ],
    };
  },

  // ── Analytics Dashboard ──────────────────────────────────────────────────────
  dashboard: (intent) => {
    const entity    = intent.entities[0] || 'item';
    const entityCap = _cap(entity);
    const appName   = intent.brandName || `${entityCap} Dashboard`;
    const col1      = entity + 's';
    const col2      = intent.entities[1] ? intent.entities[1] + 's' : 'events';
    const col2Cap   = _cap(intent.entities[1] || 'event');

    return {
      appName,
      appType: 'dashboard',
      brand:   { name: appName, accent: intent.accent },
      collections: [
        { id: col1, name: entityCap + 's', fields: _fieldsFor(entity) },
        { id: col2, name: col2Cap + 's',   fields: _fieldsFor(intent.entities[1] || 'event') },
      ],
      pages: [
        {
          pageId:   'overview',
          pageName: 'Overview',
          pageType: 'dashboard',
          layout:   'topbar',
          components: [
            _statCard(col1, `Total ${entityCap}s`, { aggregation: 'count', label: entityCap + 's', icon: '📦', color: intent.accent }),
            _statCard(col2, `Total ${col2Cap}s`,   { aggregation: 'count', label: col2Cap + 's',   icon: '📅', color: '#10b981' }),
            _list(col1, `Recent ${entityCap}s`, { titleField: 'name', bodyField: 'description' }),
          ],
        },
        {
          pageId:   col1,
          pageName: entityCap + 's',
          pageType: 'crud',
          layout:   'topbar',
          components: [
            _form(col1, `Add ${entityCap}`, { submitLabel: `Add ${entityCap}` }),
            _table(col1, `All ${entityCap}s`, { allowDelete: true }),
          ],
        },
      ],
    };
  },

  // ── Team Directory ───────────────────────────────────────────────────────────
  directory: (intent) => {
    const appName = intent.brandName || 'Team Directory';
    return {
      appName,
      appType: 'directory',
      brand:   { name: appName, accent: intent.accent },
      collections: [
        {
          id:   'members',
          name: 'Members',
          fields: [
            ..._systemFields(),
            { id: 'name',       name: 'Full Name',  type: 'text',   required: true },
            { id: 'role',       name: 'Role',       type: 'text',   required: true },
            { id: 'email',      name: 'Email',      type: 'email',  required: true },
            { id: 'department', name: 'Department', type: 'select', required: false, options: ['Engineering', 'Design', 'Marketing', 'Operations', 'Sales'] },
          ],
        },
      ],
      pages: [
        {
          pageId:   'directory',
          pageName: 'Directory',
          pageType: 'app',
          layout:   'topbar',
          components: [
            _statCard('members', 'Team Size', { aggregation: 'count', label: 'Members', icon: '👥', color: intent.accent }),
            _list('members', 'All Members', { titleField: 'name', bodyField: 'role' }),
          ],
        },
        {
          pageId:   'add-member',
          pageName: 'Add Member',
          pageType: 'app',
          layout:   'topbar',
          components: [
            _form('members', 'Add Team Member', { submitLabel: 'Add Member', successMessage: 'Member added!' }),
          ],
        },
      ],
    };
  },

  // ── Goal / Habit Tracker ─────────────────────────────────────────────────────
  tracker: (intent) => {
    const entity    = intent.entities[0] || 'goal';
    const entityCap = _cap(entity);
    const appName   = intent.brandName || `${entityCap} Tracker`;
    const col       = entity + 's';

    return {
      appName,
      appType: 'tracker',
      brand:   { name: appName, accent: intent.accent },
      collections: [
        {
          id:   col,
          name: entityCap + 's',
          fields: [
            ..._systemFields(),
            { id: 'title',    name: 'Title',    type: 'text',     required: true },
            { id: 'status',   name: 'Status',   type: 'select',   required: true, options: ['Not Started', 'In Progress', 'Done'] },
            { id: 'due_date', name: 'Due Date', type: 'date',     required: false },
            { id: 'notes',    name: 'Notes',    type: 'textarea', required: false },
          ],
        },
      ],
      pages: [
        {
          pageId:   'tracker',
          pageName: entityCap + ' Tracker',
          pageType: 'app',
          layout:   'topbar',
          components: [
            _statCard(col, `Total ${entityCap}s`, { aggregation: 'count', label: entityCap + 's', icon: '🎯', color: intent.accent }),
            _form(col, `Add ${entityCap}`, { submitLabel: `Add ${entityCap}` }),
            _table(col, `All ${entityCap}s`, { allowDelete: true }),
          ],
        },
      ],
    };
  },

  // ── CRM / Sales Pipeline ─────────────────────────────────────────────────────
  crm: (intent) => {
    const appName = intent.brandName || 'CRM';
    return {
      appName,
      appType: 'crm',
      brand:   { name: appName, accent: intent.accent },
      collections: [
        {
          id:   'leads',
          name: 'Leads',
          fields: [
            ..._systemFields(),
            { id: 'name',    name: 'Name',    type: 'text',   required: true },
            { id: 'email',   name: 'Email',   type: 'email',  required: true },
            { id: 'company', name: 'Company', type: 'text',   required: false },
            { id: 'status',  name: 'Status',  type: 'select', required: true, options: ['New', 'Contacted', 'Qualified', 'Proposal', 'Closed Won', 'Closed Lost'] },
            { id: 'value',   name: 'Deal Value', type: 'number', required: false },
          ],
        },
      ],
      pages: [
        {
          pageId:   'pipeline',
          pageName: 'Pipeline',
          pageType: 'dashboard',
          layout:   'topbar',
          components: [
            _statCard('leads', 'Total Leads',  { aggregation: 'count', label: 'Leads',  icon: '🎯', color: intent.accent }),
            _statCard('leads', 'Qualified',    { aggregation: 'count', label: 'Qualified', icon: '✅', color: '#10b981', filterField: 'status', filterValue: 'Qualified' }),
            _table('leads', 'All Leads', { allowDelete: true }),
          ],
        },
        {
          pageId:   'add-lead',
          pageName: 'Add Lead',
          pageType: 'app',
          layout:   'topbar',
          components: [
            _form('leads', 'Add Lead', { submitLabel: 'Add Lead', successMessage: 'Lead added to pipeline!' }),
          ],
        },
      ],
    };
  },

  // ── Inventory Manager ────────────────────────────────────────────────────────
  inventory: (intent) => {
    const appName = intent.brandName || 'Inventory Manager';
    return {
      appName,
      appType: 'inventory',
      brand:   { name: appName, accent: intent.accent },
      collections: [
        {
          id:   'products',
          name: 'Products',
          fields: [
            ..._systemFields(),
            { id: 'name',     name: 'Product Name', type: 'text',   required: true },
            { id: 'sku',      name: 'SKU',          type: 'text',   required: false },
            { id: 'price',    name: 'Price',        type: 'number', required: true },
            { id: 'stock',    name: 'Stock',        type: 'number', required: true },
            { id: 'category', name: 'Category',     type: 'select', required: false, options: ['Electronics', 'Clothing', 'Food', 'Tools', 'Other'] },
          ],
        },
      ],
      pages: [
        {
          pageId:   'inventory',
          pageName: 'Inventory',
          pageType: 'dashboard',
          layout:   'topbar',
          components: [
            _statCard('products', 'Total Products', { aggregation: 'count', label: 'Products', icon: '📦', color: intent.accent }),
            _table('products', 'All Products', { allowDelete: true }),
          ],
        },
        {
          pageId:   'add-product',
          pageName: 'Add Product',
          pageType: 'app',
          layout:   'topbar',
          components: [
            _form('products', 'Add Product', { submitLabel: 'Add Product', successMessage: 'Product added!' }),
          ],
        },
      ],
    };
  },

  // ── Aliases ──────────────────────────────────────────────────────────────────
  'internal-tool': (intent) => APP_TEMPLATES.crud(intent),
  kanban:          (intent) => APP_TEMPLATES.tracker(intent),
};

// ─── Component Builders ───────────────────────────────────────────────────────

function _statCard(collection, title, config = {}) {
  return { componentType: 'stat-card', collection, title, config };
}

function _form(collection, title, config = {}) {
  return { componentType: 'data-form', collection, title, config };
}

function _table(collection, title, config = {}) {
  return { componentType: 'data-table', collection, title, config };
}

function _list(collection, title, config = {}) {
  return { componentType: 'data-list', collection, title, config };
}

// ─── Field Helpers ────────────────────────────────────────────────────────────

function _systemFields() {
  return [
    { id: '_id',        name: 'ID',         type: 'text', system: true, required: false },
    { id: '_createdAt', name: 'Created At', type: 'date', system: true, required: false },
    { id: '_updatedAt', name: 'Updated At', type: 'date', system: true, required: false },
  ];
}

const ENTITY_FIELDS = {
  task:    [{ id: 'title', name: 'Title', type: 'text', required: true }, { id: 'status', name: 'Status', type: 'select', required: true, options: ['Todo', 'In Progress', 'Done'] }, { id: 'priority', name: 'Priority', type: 'select', required: false, options: ['Low', 'Medium', 'High'] }],
  project: [{ id: 'name', name: 'Name', type: 'text', required: true }, { id: 'status', name: 'Status', type: 'select', required: true, options: ['Planning', 'Active', 'Complete'] }, { id: 'owner', name: 'Owner', type: 'text', required: false }],
  contact: [{ id: 'name', name: 'Name', type: 'text', required: true }, { id: 'email', name: 'Email', type: 'email', required: true }, { id: 'company', name: 'Company', type: 'text', required: false }],
  product: [{ id: 'name', name: 'Name', type: 'text', required: true }, { id: 'price', name: 'Price', type: 'number', required: true }, { id: 'stock', name: 'Stock', type: 'number', required: false }],
  event:   [{ id: 'title', name: 'Title', type: 'text', required: true }, { id: 'date', name: 'Date', type: 'date', required: true }, { id: 'location', name: 'Location', type: 'text', required: false }],
  note:    [{ id: 'title', name: 'Title', type: 'text', required: true }, { id: 'body', name: 'Body', type: 'textarea', required: false }, { id: 'tag', name: 'Tag', type: 'text', required: false }],
  lead:    [{ id: 'name', name: 'Name', type: 'text', required: true }, { id: 'email', name: 'Email', type: 'email', required: true }, { id: 'status', name: 'Status', type: 'select', required: true, options: ['New', 'Contacted', 'Qualified', 'Closed'] }],
  goal:    [{ id: 'title', name: 'Title', type: 'text', required: true }, { id: 'status', name: 'Status', type: 'select', required: true, options: ['Not Started', 'In Progress', 'Done'] }, { id: 'due_date', name: 'Due Date', type: 'date', required: false }],
  expense: [{ id: 'description', name: 'Description', type: 'text', required: true }, { id: 'amount', name: 'Amount', type: 'number', required: true }, { id: 'category', name: 'Category', type: 'select', required: false, options: ['Travel', 'Food', 'Software', 'Equipment', 'Other'] }],
  order:   [{ id: 'customer', name: 'Customer', type: 'text', required: true }, { id: 'amount', name: 'Amount', type: 'number', required: true }, { id: 'status', name: 'Status', type: 'select', required: true, options: ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'] }],
};

function _fieldsFor(entity) {
  return [
    ..._systemFields(),
    ...(ENTITY_FIELDS[entity] || [
      { id: 'name',        name: 'Name',        type: 'text',     required: true },
      { id: 'description', name: 'Description', type: 'textarea', required: false },
    ]),
  ];
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function _cap(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
