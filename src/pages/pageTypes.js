/**
 * pageTypes.js — Nuvra Foundation (Phase 0–1)
 *
 * Canonical definitions for page types and the page record factory.
 *
 * A PageRecord is the single source of truth for a page's metadata and content.
 * It is stored in the state store (pages.byId) and persisted by the StorageEngine.
 *
 * PageRecord shape:
 * {
 *   id:          string   — unique, stable identifier
 *   type:        string   — page type (see PageType enum)
 *   name:        string   — human-readable display name
 *   slug:        string   — URL-safe path segment (e.g. 'about-us')
 *   title:       string   — <title> tag content
 *   description: string   — meta description
 *   content:     object   — page content (GrapesJS JSON or custom schema)
 *   meta:        object   — arbitrary key-value metadata
 *   createdAt:   number   — Unix ms
 *   updatedAt:   number   — Unix ms
 * }
 *
 * @module pages/pageTypes
 */
'use strict';

import { generateId, slugify, now } from '../runtime/utils.js';

// ─── Page Types ───────────────────────────────────────────────────────────────
export const PageType = Object.freeze({
  BLANK:     'blank',
  LANDING:   'landing',
  BLOG_POST: 'blog_post',
  ABOUT:     'about',
  CONTACT:   'contact',
  PORTFOLIO: 'portfolio',
  CUSTOM:    'custom',
});

// ─── Default Content ──────────────────────────────────────────────────────────
const DEFAULT_CONTENT = Object.freeze({
  components: [],
  styles:     [],
  assets:     [],
});

// ─── Factory ──────────────────────────────────────────────────────────────────
/**
 * Create a new PageRecord with validated, normalized fields.
 * @param {object} params
 * @param {string} params.name
 * @param {string} [params.type]
 * @param {string} [params.slug]
 * @param {string} [params.title]
 * @param {string} [params.description]
 * @param {object} [params.content]
 * @param {object} [params.meta]
 * @returns {object} PageRecord
 */
export function createPage({
  name,
  type        = PageType.BLANK,
  slug        = null,
  title       = null,
  description = '',
  content     = null,
  meta        = {},
} = {}) {
  if (!name || typeof name !== 'string') {
    throw new TypeError('createPage: name must be a non-empty string');
  }
  if (!Object.values(PageType).includes(type)) {
    throw new TypeError(`createPage: unknown page type "${type}"`);
  }

  const ts = now();
  return {
    id:          generateId('page'),
    type,
    name:        name.trim(),
    slug:        slug ? slugify(slug) : slugify(name),
    title:       title ?? name.trim(),
    description,
    content:     content ? { ...DEFAULT_CONTENT, ...content } : { ...DEFAULT_CONTENT },
    meta:        { ...meta },
    createdAt:   ts,
    updatedAt:   ts,
  };
}

/**
 * Validate a PageRecord. Returns an array of error strings (empty = valid).
 * @param {object} page
 * @returns {string[]}
 */
export function validatePage(page) {
  const errors = [];
  if (!page || typeof page !== 'object') { errors.push('page must be an object'); return errors; }
  if (!page.id)          errors.push('page.id is required');
  if (!page.name)        errors.push('page.name is required');
  if (!page.slug)        errors.push('page.slug is required');
  if (!page.type)        errors.push('page.type is required');
  if (!page.content)     errors.push('page.content is required');
  if (!page.createdAt)   errors.push('page.createdAt is required');
  if (!page.updatedAt)   errors.push('page.updatedAt is required');
  return errors;
}

/**
 * Normalize a page record — fills in any missing fields with defaults.
 * Used when loading persisted state that may be from an older schema.
 * @param {object} page
 * @returns {object}
 */
export function normalizePage(page) {
  const ts = now();
  return {
    id:          page.id          || generateId('page'),
    type:        page.type        || PageType.BLANK,
    name:        page.name        || 'Untitled',
    slug:        page.slug        || slugify(page.name || 'untitled'),
    title:       page.title       || page.name || 'Untitled',
    description: page.description || '',
    content:     page.content     || { ...DEFAULT_CONTENT },
    meta:        page.meta        || {},
    createdAt:   page.createdAt   || ts,
    updatedAt:   page.updatedAt   || ts,
  };
}
