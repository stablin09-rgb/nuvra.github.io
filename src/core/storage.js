/**
 * Nuvra Builder — Storage Module
 *
 * Handles all project persistence to localStorage.
 * Abstracted so it can be swapped for a backend API in the future
 * without touching any other module.
 *
 * Schema (v1):
 * {
 *   version: 1,
 *   currentPage: string,
 *   pages: {
 *     [pageId: string]: {
 *       name: string,
 *       html: string,
 *       css:  string,
 *       meta: { createdAt: string, updatedAt: string }
 *     }
 *   }
 * }
 */

'use strict';

const STORAGE_KEY    = 'nuvra-project-v1';
const SCHEMA_VERSION = 1;

/**
 * Load the saved project from localStorage.
 * Returns null if nothing is saved or the schema is incompatible.
 *
 * @returns {object|null}
 */
export function loadProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const project = JSON.parse(raw);

    // Basic schema validation
    if (
      !project ||
      typeof project !== 'object' ||
      !project.pages ||
      typeof project.pages !== 'object' ||
      !project.currentPage
    ) {
      console.warn('[Nuvra] Saved project has invalid structure — discarding.');
      return null;
    }

    return project;
  } catch (err) {
    console.error('[Nuvra] Failed to load project from storage:', err);
    return null;
  }
}

/**
 * Persist the current project state to localStorage.
 *
 * @param {object} pages       - Map of pageId → page data
 * @param {string} currentPage - ID of the currently active page
 */
export function saveProject(pages, currentPage) {
  try {
    const project = {
      version:     SCHEMA_VERSION,
      currentPage,
      pages,
      savedAt:     new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch (err) {
    console.error('[Nuvra] Failed to save project:', err);
  }
}

/**
 * Clear the saved project from localStorage.
 * Used when importing a new project to avoid stale data.
 */
export function clearProject() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Serialize the current project to a JSON string suitable for download.
 *
 * @param {object} pages
 * @param {string} currentPage
 * @returns {string} JSON string
 */
export function serializeProject(pages, currentPage) {
  return JSON.stringify(
    {
      version:     SCHEMA_VERSION,
      currentPage,
      pages,
      exportedAt:  new Date().toISOString(),
    },
    null,
    2
  );
}

/**
 * Parse and validate a project JSON string from an imported file.
 * Returns the project object or throws an Error with a user-friendly message.
 *
 * @param {string} jsonString
 * @returns {object}
 */
export function deserializeProject(jsonString) {
  let project;

  try {
    project = JSON.parse(jsonString);
  } catch {
    throw new Error('The file is not valid JSON.');
  }

  if (!project || typeof project !== 'object') {
    throw new Error('Invalid project file structure.');
  }

  if (!project.pages || typeof project.pages !== 'object') {
    throw new Error('Project file is missing page data.');
  }

  const pageIds = Object.keys(project.pages);
  if (pageIds.length === 0) {
    throw new Error('Project file contains no pages.');
  }

  // Ensure currentPage points to a real page
  if (!project.currentPage || !project.pages[project.currentPage]) {
    project.currentPage = pageIds[0];
  }

  return project;
}
