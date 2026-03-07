/**
 * Nuvra Builder — Blueprint Registry (Phase 11)
 *
 * Store Blueprints are the most powerful asset type in Nuvra.
 * A Blueprint is a complete, deployable business — not just a template.
 *
 * Blueprint anatomy:
 *  {
 *    blueprintId:    string,
 *    name:           string,
 *    description:    string,
 *    category:       'saas' | 'ecommerce' | 'dashboard' | 'marketplace' | 'internal-tool' | 'portfolio',
 *    version:        string,
 *    author:         CreatorProfile,
 *    pricing:        PricingModel,
 *    license:        LicenseDefinition,
 *
 *    // The complete project definition
 *    project: {
 *      name:         string,
 *      pages:        Page[],          // Full GrapesJS page definitions
 *      collections:  Collection[],    // Data model definitions
 *      aiSettings:   AISettings,      // Pre-configured AI behavior
 *      aiSchemas:    AISchema[],       // AI generation schemas
 *    },
 *
 *    // Dependencies
 *    requiredExtensions: string[],    // Extension IDs that must be installed
 *    optionalExtensions: string[],    // Recommended but not required
 *
 *    // Monetization logic (for revenue-share blueprints)
 *    monetization: {
 *      model:        'free' | 'one-time' | 'revenue-share',
 *      revenueShare: number,          // % of store revenue shared with blueprint creator
 *    },
 *
 *    // Runtime configuration
 *    config: {
 *      variables: ConfigVariable[],  // User-configurable variables (API keys, brand colors, etc.)
 *    },
 *
 *    screenshots: string[],
 *    tags:        string[],
 *    createdAt:   ISO string,
 *    updatedAt:   ISO string,
 *  }
 *
 * Blueprints are stored in the catalog and installed like any other asset.
 * Installation creates a new project pre-populated with all blueprint content.
 */
'use strict';

const REGISTRY_KEY = 'nuvra-blueprint-registry';
const INSTALLED_KEY = (uid) => `nuvra-blueprints-installed-${uid || 'anon'}`;

let _userId = null;

function _read(key) { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } }
function _write(key, data) { try { localStorage.setItem(key, JSON.stringify(data)); } catch {} }

// ─── Built-in Blueprint Catalog ───────────────────────────────────────────────

const BUILTIN_BLUEPRINTS = [
  {
    blueprintId:  'saas-starter',
    name:         'SaaS Starter',
    description:  'A complete SaaS application with landing page, pricing, dashboard, and user account pages.',
    category:     'saas',
    version:      '1.0.0',
    author:       { name: 'Nuvra Team', verified: true },
    pricing:      { model: 'free' },
    license:      { type: 'commercial', commercial: true },
    tags:         ['saas', 'dashboard', 'pricing', 'landing-page'],
    screenshots:  [],
    requiredExtensions: [],
    optionalExtensions: ['stripe-integration', 'mailchimp-integration'],
    monetization: { model: 'free' },
    config: {
      variables: [
        { key: 'BRAND_NAME',    label: 'Brand Name',    type: 'text',   default: 'My SaaS' },
        { key: 'BRAND_COLOR',   label: 'Brand Color',   type: 'color',  default: '#7c3aed' },
        { key: 'TAGLINE',       label: 'Tagline',       type: 'text',   default: 'The best tool for your business' },
        { key: 'PRICING_BASIC', label: 'Basic Plan Price', type: 'number', default: 29 },
        { key: 'PRICING_PRO',   label: 'Pro Plan Price',   type: 'number', default: 79 },
      ],
    },
    project: {
      name: 'SaaS Starter',
      pages: [
        { name: 'Landing Page', path: '/', html: '<section style="padding:80px 40px;text-align:center;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;"><h1 style="font-size:48px;margin:0 0 16px;">{{BRAND_NAME}}</h1><p style="font-size:20px;opacity:0.9;margin:0 0 32px;">{{TAGLINE}}</p><a href="/pricing" style="background:#fff;color:#764ba2;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;">Get Started Free</a></section>' },
        { name: 'Pricing',      path: '/pricing', html: '<section style="padding:80px 40px;text-align:center;"><h2 style="font-size:36px;margin:0 0 48px;">Simple, Transparent Pricing</h2><div style="display:flex;gap:24px;justify-content:center;flex-wrap:wrap;"></div></section>' },
        { name: 'Dashboard',    path: '/dashboard', html: '<div style="display:flex;min-height:100vh;"><nav style="width:240px;background:#1a1a2e;padding:24px;color:#fff;"></nav><main style="flex:1;padding:32px;background:#f8f9fa;"></main></div>' },
        { name: 'Account',      path: '/account', html: '<div style="max-width:600px;margin:80px auto;padding:0 24px;"><h2>Account Settings</h2></div>' },
      ],
      collections: [
        { name: 'users',        fields: [{ name: 'email', type: 'text' }, { name: 'plan', type: 'text', default: 'free' }] },
        { name: 'subscriptions', fields: [{ name: 'userId', type: 'text' }, { name: 'plan', type: 'text' }, { name: 'status', type: 'text' }] },
      ],
      aiSettings: { systemPrompt: 'You are building a SaaS application. Focus on professional, conversion-optimized design.' },
    },
  },
  {
    blueprintId:  'ecommerce-store',
    name:         'E-Commerce Store',
    description:  'A complete online store with product catalog, cart, checkout, and order management.',
    category:     'ecommerce',
    version:      '1.0.0',
    author:       { name: 'Nuvra Team', verified: true },
    pricing:      { model: 'free' },
    license:      { type: 'commercial', commercial: true },
    tags:         ['ecommerce', 'shop', 'products', 'cart', 'checkout'],
    screenshots:  [],
    requiredExtensions: [],
    optionalExtensions: ['stripe-integration', 'ecommerce-ai-pack'],
    monetization: { model: 'free' },
    config: {
      variables: [
        { key: 'STORE_NAME',   label: 'Store Name',  type: 'text',  default: 'My Store' },
        { key: 'BRAND_COLOR',  label: 'Brand Color', type: 'color', default: '#e11d48' },
        { key: 'CURRENCY',     label: 'Currency',    type: 'text',  default: 'USD' },
      ],
    },
    project: {
      name: 'E-Commerce Store',
      pages: [
        { name: 'Home',     path: '/',         html: '<section style="padding:80px 40px;text-align:center;"><h1>{{STORE_NAME}}</h1><p>Discover our products</p></section>' },
        { name: 'Products', path: '/products', html: '<div style="padding:40px;"><h2>Products</h2><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:24px;"></div></div>' },
        { name: 'Cart',     path: '/cart',     html: '<div style="max-width:800px;margin:40px auto;padding:0 24px;"><h2>Your Cart</h2></div>' },
        { name: 'Checkout', path: '/checkout', html: '<div style="max-width:600px;margin:40px auto;padding:0 24px;"><h2>Checkout</h2></div>' },
      ],
      collections: [
        { name: 'products', fields: [{ name: 'name', type: 'text' }, { name: 'price', type: 'number' }, { name: 'stock', type: 'number' }] },
        { name: 'orders',   fields: [{ name: 'total', type: 'number' }, { name: 'status', type: 'text', default: 'pending' }] },
      ],
      aiSettings: { systemPrompt: 'You are building an e-commerce store. Focus on product presentation and conversion.' },
    },
  },
  {
    blueprintId:  'internal-tool',
    name:         'Internal Tool / Admin Panel',
    description:  'A data-driven internal tool with CRUD tables, filters, and role-based views.',
    category:     'internal-tool',
    version:      '1.0.0',
    author:       { name: 'Nuvra Team', verified: true },
    pricing:      { model: 'free' },
    license:      { type: 'commercial', commercial: true },
    tags:         ['admin', 'dashboard', 'crud', 'internal-tool', 'data'],
    screenshots:  [],
    requiredExtensions: [],
    optionalExtensions: ['chart-blocks'],
    monetization: { model: 'free' },
    config: {
      variables: [
        { key: 'APP_NAME',    label: 'App Name',    type: 'text',  default: 'Admin Panel' },
        { key: 'BRAND_COLOR', label: 'Brand Color', type: 'color', default: '#0f172a' },
      ],
    },
    project: {
      name: 'Internal Tool',
      pages: [
        { name: 'Dashboard', path: '/',         html: '<div style="display:flex;min-height:100vh;"><nav style="width:220px;background:#0f172a;padding:20px;color:#fff;"><h3 style="margin:0 0 24px;">{{APP_NAME}}</h3></nav><main style="flex:1;padding:32px;background:#f1f5f9;"></main></div>' },
        { name: 'Records',   path: '/records',  html: '<div style="padding:32px;"><h2>Records</h2><table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);"></table></div>' },
        { name: 'Settings',  path: '/settings', html: '<div style="max-width:600px;margin:40px auto;padding:0 24px;"><h2>Settings</h2></div>' },
      ],
      collections: [
        { name: 'records', fields: [{ name: 'title', type: 'text' }, { name: 'status', type: 'text', default: 'active' }, { name: 'createdAt', type: 'date' }] },
      ],
      aiSettings: { systemPrompt: 'You are building an internal admin tool. Focus on data clarity and efficient workflows.' },
    },
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────

export const blueprintRegistry = {

  init(userId) {
    _userId = userId;
    // Register built-in blueprints
    const registry = _read(REGISTRY_KEY);
    for (const bp of BUILTIN_BLUEPRINTS) {
      if (!registry[bp.blueprintId]) {
        registry[bp.blueprintId] = bp;
      }
    }
    _write(REGISTRY_KEY, registry);
  },

  getAll() {
    return Object.values(_read(REGISTRY_KEY));
  },

  getById(blueprintId) {
    return _read(REGISTRY_KEY)[blueprintId] || null;
  },

  getByCategory(category) {
    return this.getAll().filter(bp => bp.category === category);
  },

  search(query) {
    const q = (query || '').toLowerCase();
    return this.getAll().filter(bp =>
      bp.name.toLowerCase().includes(q) ||
      bp.description.toLowerCase().includes(q) ||
      (bp.tags || []).some(t => t.toLowerCase().includes(q))
    );
  },

  /**
   * Register a custom blueprint (from marketplace or creator publishing).
   */
  register(blueprint) {
    const registry = _read(REGISTRY_KEY);
    registry[blueprint.blueprintId] = blueprint;
    _write(REGISTRY_KEY, registry);
  },

  /**
   * Record that a blueprint was installed for a user.
   */
  recordInstall(blueprintId, projectId) {
    const installed = _read(INSTALLED_KEY(_userId));
    installed[blueprintId] = {
      blueprintId,
      projectId,
      installedAt: new Date().toISOString(),
    };
    _write(INSTALLED_KEY(_userId), installed);
  },

  getInstalledBlueprints() {
    return Object.values(_read(INSTALLED_KEY(_userId)));
  },

  isInstalled(blueprintId) {
    return !!_read(INSTALLED_KEY(_userId))[blueprintId];
  },
};
