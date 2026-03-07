/**
 * Nuvra Builder — Prompt Builder
 *
 * Centralises the construction of system prompts and user messages
 * for all AI generation modes.
 *
 * All prompts enforce structured JSON output — the AI must never
 * return raw HTML. This is the core of Nuvra's schema-driven approach.
 *
 * Three prompt types:
 *  - buildPageSystemPrompt  / buildPageUserMessage
 *  - buildSiteSystemPrompt  / buildSiteUserMessage
 *  - buildAppSystemPrompt   / buildAppUserMessage
 */

'use strict';

// ─── Page Generation Prompts ──────────────────────────────────────────────────

/**
 * Build the system prompt for single-page generation.
 * @param {object} [context] - { availableSections, brand }
 * @returns {string}
 */
export function buildPageSystemPrompt(context = {}) {
  const sections = context.availableSections || DEFAULT_SECTIONS;

  return `You are Nuvra's AI page generation engine.
Your job is to generate a structured PageSchema JSON object based on the user's prompt.

RULES:
1. You MUST return ONLY valid JSON. No markdown, no explanation, no code blocks.
2. The JSON must conform exactly to the PageSchema format below.
3. Never generate raw HTML. All content is expressed as structured data.
4. Choose sections that make sense for the page type and user's intent.
5. Write real, specific content — not placeholder text like "Lorem ipsum".
6. Infer the brand name, industry, and tone from the prompt.

AVAILABLE SECTION TYPES:
${sections.map((s) => `- "${s.type}": ${s.description}`).join('\n')}

PAGESCHEMA FORMAT:
{
  "pageId":   "string (url-safe, e.g. 'home')",
  "pageName": "string (e.g. 'Home')",
  "pageType": "marketing | landing | blog | portfolio | about | contact",
  "brand": {
    "name":    "string",
    "tagline": "string",
    "accent":  "hex color (e.g. '#7c6af7')"
  },
  "sections": [
    {
      "type": "one of the available section types",
      "data": { ... section-specific data ... }
    }
  ]
}

SECTION DATA SHAPES:
- navbar:       { logo, links: string[], cta }
- hero:         { headline, subheadline, primaryCta, secondaryCta, badge }
- features:     { headline, subheadline, items: [{ icon, title, description }] }
- stats:        { stats: [{ value, label }] }
- pricing:      { headline, subheadline, plans: [{ name, price, period, features: string[], cta, featured? }] }
- testimonials: { headline, items: [{ quote, author, role }] }
- faq:          { headline, items: [{ question, answer }] }
- cta:          { headline, subheadline, cta }
- footer:       { copyright, links: string[] }

Respond with ONLY the JSON object. No other text.`;
}

/**
 * Build the user message for single-page generation.
 * @param {string} prompt
 * @param {object} [intent] - Extracted intent from PromptAnalyser
 * @returns {string}
 */
export function buildPageUserMessage(prompt, intent = {}) {
  let msg = `Generate a page for: "${prompt}"`;
  if (intent.pageType)  msg += `\nPage type: ${intent.pageType}`;
  if (intent.industry)  msg += `\nIndustry: ${intent.industry}`;
  if (intent.tone)      msg += `\nTone: ${intent.tone}`;
  if (intent.features?.length) msg += `\nMust include sections: ${intent.features.join(', ')}`;
  return msg;
}

// ─── Site Generation Prompts ──────────────────────────────────────────────────

/**
 * Build the system prompt for multi-page site generation.
 * @returns {string}
 */
export function buildSiteSystemPrompt() {
  return `You are Nuvra's AI site generation engine.
Your job is to generate a structured SitePlan JSON object for a complete multi-page website.

RULES:
1. You MUST return ONLY valid JSON. No markdown, no explanation, no code blocks.
2. The JSON must conform exactly to the SitePlan format below.
3. Generate between 2 and 6 pages depending on the site type.
4. Each page must have appropriate sections for its purpose.
5. Write real, specific content — not placeholder text.
6. The first page in the array is the home page.

SITEPLAN FORMAT:
{
  "siteName": "string",
  "brand": {
    "name":    "string",
    "tagline": "string",
    "accent":  "hex color"
  },
  "pages": [
    {
      "pageId":   "url-safe string",
      "pageName": "string",
      "pageType": "marketing | landing | about | contact | blog | portfolio",
      "sections": [
        { "type": "section type", "data": { ... } }
      ]
    }
  ]
}

Use the same section types and data shapes as for single-page generation.
Respond with ONLY the JSON object. No other text.`;
}

/**
 * Build the user message for site generation.
 * @param {string} prompt
 * @param {object} [intent]
 * @returns {string}
 */
export function buildSiteUserMessage(prompt, intent = {}) {
  let msg = `Generate a complete website for: "${prompt}"`;
  if (intent.industry) msg += `\nIndustry: ${intent.industry}`;
  if (intent.tone)     msg += `\nTone: ${intent.tone}`;
  return msg;
}

// ─── App Generation Prompts ───────────────────────────────────────────────────

/**
 * Build the system prompt for app generation.
 * @param {object} [context] - { availableComponents, existingCollections }
 * @returns {string}
 */
export function buildAppSystemPrompt(context = {}) {
  const components   = context.availableComponents   || DEFAULT_APP_COMPONENTS;
  const collections  = context.existingCollections   || [];

  const existingCollectionsNote = collections.length > 0
    ? `\nEXISTING COLLECTIONS (you may reference these):\n${collections.map((c) => `- "${c.id}": ${c.name} (fields: ${c.fields.filter((f) => !f.system).map((f) => f.id).join(', ')})`).join('\n')}`
    : '';

  return `You are Nuvra's AI app generation engine.
Your job is to generate a structured AppPlan JSON object for a data-driven web application.

RULES:
1. You MUST return ONLY valid JSON. No markdown, no explanation, no code blocks.
2. The JSON must conform exactly to the AppPlan format below.
3. Never generate raw HTML. All structure is expressed as component schemas.
4. Design real data models — think about what fields the user actually needs.
5. Generate between 1 and 4 app pages depending on the app's complexity.
6. Each page must have a clear purpose (e.g. dashboard, list view, form, detail view).

AVAILABLE APP COMPONENT TYPES:
${components.map((c) => `- "${c.type}": ${c.description}`).join('\n')}
${existingCollectionsNote}

APPPLAN FORMAT:
{
  "appName": "string",
  "appType": "dashboard | crud | internal-tool | tracker | directory | kanban",
  "brand": {
    "name":    "string",
    "accent":  "hex color"
  },
  "collections": [
    {
      "id":     "url-safe string (e.g. 'tasks')",
      "name":   "string (e.g. 'Tasks')",
      "fields": [
        {
          "id":       "url-safe string",
          "name":     "string",
          "type":     "text | number | boolean | date | select | email | url | textarea",
          "required": true | false,
          "options":  ["option1", "option2"]  // only for 'select' type
        }
      ]
    }
  ],
  "pages": [
    {
      "pageId":   "url-safe string",
      "pageName": "string",
      "pageType": "dashboard | crud | app",
      "layout":   "sidebar | topbar | fullwidth",
      "components": [
        {
          "componentType": "one of the available component types",
          "collection":    "collection id this component is bound to",
          "title":         "string",
          "config": {
            // component-specific configuration
          }
        }
      ]
    }
  ]
}

COMPONENT CONFIG SHAPES:
- data-table:  { columns: ["fieldId1", "fieldId2"], allowDelete: true }
- data-form:   { submitLabel: "string", successMessage: "string" }
- data-list:   { titleField: "fieldId", bodyField: "fieldId" }
- stat-card:   { aggregation: "count|sum|avg", field: "fieldId", label: "string", icon: "emoji", color: "hex" }
- conditional: { stateKey: "string", stateValue: "string", operator: "eq|neq|gt|lt|truthy" }

Respond with ONLY the JSON object. No other text.`;
}

/**
 * Build the user message for app generation.
 * @param {string} prompt
 * @param {object} [intent] - Extracted intent from AppPromptAnalyser
 * @returns {string}
 */
export function buildAppUserMessage(prompt, intent = {}) {
  let msg = `Generate a web app for: "${prompt}"`;
  if (intent.appType)    msg += `\nApp type: ${intent.appType}`;
  if (intent.entities?.length) msg += `\nKey entities/data: ${intent.entities.join(', ')}`;
  if (intent.features?.length) msg += `\nRequired features: ${intent.features.join(', ')}`;
  return msg;
}

// ─── Default Section / Component Catalogues ───────────────────────────────────

const DEFAULT_SECTIONS = [
  { type: 'navbar',       description: 'Navigation bar with logo and links' },
  { type: 'hero',         description: 'Large hero section with headline and CTA' },
  { type: 'features',     description: 'Feature grid with icons, titles, and descriptions' },
  { type: 'stats',        description: 'Key statistics or social proof numbers' },
  { type: 'pricing',      description: 'Pricing plans table' },
  { type: 'testimonials', description: 'Customer testimonials / quotes' },
  { type: 'faq',          description: 'Frequently asked questions accordion' },
  { type: 'cta',          description: 'Call-to-action banner' },
  { type: 'footer',       description: 'Page footer with links and copyright' },
];

const DEFAULT_APP_COMPONENTS = [
  { type: 'data-table',  description: 'Display records from a collection in a sortable table with delete actions' },
  { type: 'data-form',   description: 'Form to create new records in a collection' },
  { type: 'data-list',   description: 'Card-based list view of collection records' },
  { type: 'stat-card',   description: 'Single aggregate value (count, sum, average) from a collection' },
  { type: 'conditional', description: 'Show/hide content based on a state value' },
];
