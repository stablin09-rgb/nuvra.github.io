/**
 * utils.js — Nuvra Foundation (Phase 0–1)
 *
 * Shared, pure utility functions.
 * No side effects. No imports from other Nuvra modules.
 *
 * @module runtime/utils
 */
'use strict';

// ─── ID Generation ────────────────────────────────────────────────────────────
let _counter = 0;

/**
 * Generate a short, unique, prefixed ID.
 * Not cryptographically random — use for UI/state IDs only.
 * @param {string} [prefix='id']
 * @returns {string}
 */
export function generateId(prefix = 'id') {
  _counter++;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}_${_counter}`;
}

// ─── Deep Clone ───────────────────────────────────────────────────────────────
/**
 * Deep clone a JSON-serializable value.
 * @param {*} value
 * @returns {*}
 */
export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

// ─── Deep Merge ───────────────────────────────────────────────────────────────
/**
 * Deep merge source into target. Returns a new object.
 * Arrays are replaced, not merged.
 * @param {object} target
 * @param {object} source
 * @returns {object}
 */
export function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      typeof target[key] === 'object' &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

// ─── Debounce ─────────────────────────────────────────────────────────────────
/**
 * Returns a debounced version of fn.
 * @param {Function} fn
 * @param {number} wait - milliseconds
 * @returns {Function}
 */
export function debounce(fn, wait) {
  let timer;
  function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  }
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

// ─── Throttle ─────────────────────────────────────────────────────────────────
/**
 * Returns a throttled version of fn.
 * @param {Function} fn
 * @param {number} wait - milliseconds
 * @returns {Function}
 */
export function throttle(fn, wait) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= wait) {
      last = now;
      return fn.apply(this, args);
    }
  };
}

// ─── Assertion ────────────────────────────────────────────────────────────────
/**
 * Assert a condition. Throws if false.
 * @param {boolean} condition
 * @param {string} message
 */
export function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// ─── Safe JSON ────────────────────────────────────────────────────────────────
/**
 * Parse JSON safely. Returns null on failure.
 * @param {string} str
 * @returns {*}
 */
export function safeJsonParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

/**
 * Stringify JSON safely. Returns null on failure.
 * @param {*} value
 * @returns {string|null}
 */
export function safeJsonStringify(value) {
  try { return JSON.stringify(value); } catch { return null; }
}

// ─── Timestamp ────────────────────────────────────────────────────────────────
/**
 * Return the current Unix timestamp in milliseconds.
 * @returns {number}
 */
export function now() { return Date.now(); }

/**
 * Format a timestamp as a human-readable string.
 * @param {number} ts
 * @returns {string}
 */
export function formatTs(ts) {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}

// ─── String Helpers ───────────────────────────────────────────────────────────
/**
 * Slugify a string (lowercase, hyphens, no special chars).
 * @param {string} str
 * @returns {string}
 */
export function slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Capitalize the first letter of a string.
 * @param {string} str
 * @returns {string}
 */
export function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
