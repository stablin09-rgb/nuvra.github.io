/**
 * Nuvra Builder — Component Schema Registry
 *
 * Defines the data-driven schema for Nuvra's component system.
 * This is the foundation for generating web apps, dashboards, and CRUD tools,
 * not just static pages.
 *
 * Each schema entry describes:
 *  - The component's visual template (HTML string with {{mustache}} bindings)
 *  - The data model it consumes (dataSchema)
 *  - Any interactive actions it exposes (actions)
 *  - The category it belongs to (for AI context and UI grouping)
 *
 * The AI engine is given access to these schemas so it can select and
 * compose components intelligently when generating app pages.
 *
 * Future: This registry will be loaded dynamically, allowing third-party
 * component packs to be installed into Nuvra.
 */

'use strict';

/**
 * @typedef {Object} FieldSchema
 * @property {'string'|'number'|'boolean'|'image'|'url'|'color'|'date'} type
 * @property {*}      default   - Default value
 * @property {string} [label]   - Human-readable label for the properties panel
 * @property {boolean} [required]
 */

/**
 * @typedef {Object} ActionSchema
 * @property {string} description - What the action does
 * @property {string} [event]     - DOM event that triggers it (e.g., 'click')
 */

/**
 * @typedef {Object} ComponentSchema
 * @property {string}                    id          - Unique identifier
 * @property {string}                    name        - Human-readable name
 * @property {string}                    category    - UI grouping category
 * @property {string}                    description - Short description for AI context
 * @property {string}                    template    - HTML template with {{field}} bindings
 * @property {string}                    [styles]    - Scoped CSS for this component
 * @property {Object.<string, FieldSchema>} dataSchema - Data fields this component accepts
 * @property {Object.<string, ActionSchema>} [actions] - Interactive actions
 */

/** @type {ComponentSchema[]} */
const COMPONENT_SCHEMAS = [

  // ── Static Content ────────────────────────────────────────────────────────
  {
    id:          'stat-card',
    name:        'Stat Card',
    category:    'Dashboard',
    description: 'Displays a single KPI metric with a label, value, and trend indicator.',
    template: `
<div class="nuvra-stat-card">
  <div class="nuvra-stat-label">{{label}}</div>
  <div class="nuvra-stat-value">{{value}}</div>
  <div class="nuvra-stat-trend {{trendDirection}}">{{trend}}</div>
</div>`,
    styles: `
.nuvra-stat-card { padding: 24px; background: #fff; border: 1px solid #eee; border-radius: 12px; }
.nuvra-stat-label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
.nuvra-stat-value { font-size: 32px; font-weight: 800; color: #111; }
.nuvra-stat-trend { font-size: 12px; margin-top: 4px; }
.nuvra-stat-trend.up   { color: #16a34a; }
.nuvra-stat-trend.down { color: #dc2626; }`,
    dataSchema: {
      label:          { type: 'string',  default: 'Total Users',  label: 'Metric Label' },
      value:          { type: 'string',  default: '12,480',       label: 'Value' },
      trend:          { type: 'string',  default: '+8.2% this month', label: 'Trend Text' },
      trendDirection: { type: 'string',  default: 'up',           label: 'Trend Direction (up/down)' },
    },
  },

  // ── User / Profile ────────────────────────────────────────────────────────
  {
    id:          'user-card',
    name:        'User Profile Card',
    category:    'Application',
    description: 'Displays a user profile with avatar, name, role, and email.',
    template: `
<div class="nuvra-user-card">
  <img src="{{avatar}}" alt="{{name}}" class="nuvra-user-avatar" />
  <div class="nuvra-user-info">
    <h3 class="nuvra-user-name">{{name}}</h3>
    <span class="nuvra-user-role">{{role}}</span>
    <a href="mailto:{{email}}" class="nuvra-user-email">{{email}}</a>
  </div>
</div>`,
    styles: `
.nuvra-user-card { display: flex; align-items: center; gap: 16px; padding: 20px; border: 1px solid #eee; border-radius: 12px; background: #fff; }
.nuvra-user-avatar { width: 56px; height: 56px; border-radius: 50%; object-fit: cover; }
.nuvra-user-name { margin: 0 0 4px; font-size: 16px; font-weight: 600; }
.nuvra-user-role { display: block; font-size: 12px; color: #7c6af7; font-weight: 500; margin-bottom: 4px; }
.nuvra-user-email { font-size: 13px; color: #888; text-decoration: none; }`,
    dataSchema: {
      name:   { type: 'string', default: 'Jane Doe',                          label: 'Full Name',  required: true },
      role:   { type: 'string', default: 'Product Designer',                  label: 'Job Title' },
      email:  { type: 'string', default: 'jane.doe@example.com',              label: 'Email' },
      avatar: { type: 'image',  default: 'https://i.pravatar.cc/150?img=47',  label: 'Avatar URL' },
    },
    actions: {
      onClick: { description: 'Triggered when the card is clicked', event: 'click' },
    },
  },

  // ── Table Row ─────────────────────────────────────────────────────────────
  {
    id:          'table-row',
    name:        'Table Row',
    category:    'Data',
    description: 'A single row in a data table. Used by the AI to generate CRUD listing views.',
    template: `
<tr class="nuvra-table-row">
  <td class="nuvra-td">{{col1}}</td>
  <td class="nuvra-td">{{col2}}</td>
  <td class="nuvra-td"><span class="nuvra-badge nuvra-badge-{{statusType}}">{{status}}</span></td>
  <td class="nuvra-td nuvra-td-actions">
    <button class="nuvra-action-btn" data-action="edit">Edit</button>
    <button class="nuvra-action-btn danger" data-action="delete">Delete</button>
  </td>
</tr>`,
    styles: `
.nuvra-table-row:hover { background: #f9f9f9; }
.nuvra-td { padding: 12px 16px; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
.nuvra-td-actions { display: flex; gap: 8px; }
.nuvra-badge { padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 500; }
.nuvra-badge-success { background: #dcfce7; color: #16a34a; }
.nuvra-badge-warning { background: #fef9c3; color: #ca8a04; }
.nuvra-badge-danger  { background: #fee2e2; color: #dc2626; }
.nuvra-action-btn { padding: 4px 12px; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; font-size: 12px; background: #fff; }
.nuvra-action-btn.danger { color: #dc2626; border-color: #fca5a5; }`,
    dataSchema: {
      col1:       { type: 'string', default: 'Alice Johnson',  label: 'Column 1' },
      col2:       { type: 'string', default: 'Jan 12, 2025',   label: 'Column 2' },
      status:     { type: 'string', default: 'Active',         label: 'Status Text' },
      statusType: { type: 'string', default: 'success',        label: 'Status Type (success/warning/danger)' },
    },
    actions: {
      onEdit:   { description: 'Triggered when the Edit button is clicked',   event: 'click' },
      onDelete: { description: 'Triggered when the Delete button is clicked', event: 'click' },
    },
  },

  // ── Blog Post Card ────────────────────────────────────────────────────────
  {
    id:          'blog-card',
    name:        'Blog Post Card',
    category:    'Content',
    description: 'A card for displaying a blog post preview with thumbnail, title, excerpt, and date.',
    template: `
<article class="nuvra-blog-card">
  <img src="{{thumbnail}}" alt="{{title}}" class="nuvra-blog-thumb" />
  <div class="nuvra-blog-body">
    <span class="nuvra-blog-category">{{category}}</span>
    <h3 class="nuvra-blog-title">{{title}}</h3>
    <p class="nuvra-blog-excerpt">{{excerpt}}</p>
    <div class="nuvra-blog-meta">
      <span>{{author}}</span>
      <span>{{date}}</span>
    </div>
  </div>
</article>`,
    styles: `
.nuvra-blog-card { border: 1px solid #eee; border-radius: 12px; overflow: hidden; background: #fff; }
.nuvra-blog-thumb { width: 100%; height: 200px; object-fit: cover; }
.nuvra-blog-body { padding: 20px; }
.nuvra-blog-category { font-size: 11px; font-weight: 600; color: #7c6af7; text-transform: uppercase; letter-spacing: 0.5px; }
.nuvra-blog-title { font-size: 18px; font-weight: 700; margin: 8px 0; line-height: 1.3; }
.nuvra-blog-excerpt { font-size: 14px; color: #666; line-height: 1.6; margin: 0 0 16px; }
.nuvra-blog-meta { display: flex; justify-content: space-between; font-size: 12px; color: #aaa; }`,
    dataSchema: {
      title:     { type: 'string', default: 'How to Build Faster Websites',                   label: 'Post Title',   required: true },
      excerpt:   { type: 'string', default: 'A deep dive into modern web performance...',     label: 'Excerpt' },
      category:  { type: 'string', default: 'Engineering',                                    label: 'Category' },
      author:    { type: 'string', default: 'Jane Doe',                                       label: 'Author Name' },
      date:      { type: 'date',   default: 'Feb 26, 2026',                                   label: 'Publish Date' },
      thumbnail: { type: 'image',  default: 'https://picsum.photos/seed/blog1/600/300',       label: 'Thumbnail URL' },
    },
    actions: {
      onClick: { description: 'Triggered when the card is clicked', event: 'click' },
    },
  },

  // ── Pricing Card ──────────────────────────────────────────────────────────
  {
    id:          'pricing-card',
    name:        'Pricing Card',
    category:    'Marketing',
    description: 'A pricing tier card with a plan name, price, feature list, and CTA button.',
    template: `
<div class="nuvra-pricing-card {{featured}}">
  <h3 class="nuvra-plan-name">{{planName}}</h3>
  <div class="nuvra-plan-price">{{price}}<span>/{{period}}</span></div>
  <p class="nuvra-plan-desc">{{description}}</p>
  <button class="nuvra-plan-cta">{{ctaText}}</button>
</div>`,
    styles: `
.nuvra-pricing-card { padding: 32px; border: 1px solid #eee; border-radius: 12px; text-align: center; background: #fff; }
.nuvra-pricing-card.featured { border-color: #7c6af7; border-width: 2px; background: #faf9ff; }
.nuvra-plan-name { font-size: 18px; font-weight: 700; margin: 0 0 16px; }
.nuvra-plan-price { font-size: 40px; font-weight: 800; margin: 0 0 4px; }
.nuvra-plan-price span { font-size: 16px; font-weight: 400; color: #888; }
.nuvra-plan-desc { font-size: 14px; color: #666; margin: 0 0 24px; }
.nuvra-plan-cta { width: 100%; padding: 12px; background: #7c6af7; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; }
.nuvra-pricing-card:not(.featured) .nuvra-plan-cta { background: #f5f5f5; color: #333; }`,
    dataSchema: {
      planName:    { type: 'string', default: 'Pro',          label: 'Plan Name',    required: true },
      price:       { type: 'string', default: '$19',          label: 'Price',        required: true },
      period:      { type: 'string', default: 'month',        label: 'Billing Period' },
      description: { type: 'string', default: 'For growing teams and businesses.', label: 'Description' },
      ctaText:     { type: 'string', default: 'Get Started',  label: 'Button Text' },
      featured:    { type: 'string', default: 'featured',     label: 'Featured (add "featured" class or leave empty)' },
    },
    actions: {
      onCtaClick: { description: 'Triggered when the CTA button is clicked', event: 'click' },
    },
  },
];

// ─── Registry API ─────────────────────────────────────────────────────────────

/**
 * Get all registered component schemas.
 * @returns {ComponentSchema[]}
 */
export function getAllSchemas() {
  return COMPONENT_SCHEMAS;
}

/**
 * Find a schema by its ID.
 * @param {string} id
 * @returns {ComponentSchema|undefined}
 */
export function getSchemaById(id) {
  return COMPONENT_SCHEMAS.find((s) => s.id === id);
}

/**
 * Get all schemas for a given category.
 * @param {string} category
 * @returns {ComponentSchema[]}
 */
export function getSchemasByCategory(category) {
  return COMPONENT_SCHEMAS.filter((s) => s.category === category);
}

/**
 * Build a compact summary of all schemas for injection into AI prompts.
 * This gives the LLM awareness of available components.
 *
 * @returns {string} A formatted string listing all components and their descriptions.
 */
export function buildSchemaContextForAI() {
  return COMPONENT_SCHEMAS.map(
    (s) => `- ${s.id} (${s.category}): ${s.description}`
  ).join('\n');
}
