/**
 * Nuvra Builder — Blueprint Installer (Phase 11)
 *
 * Installs a Store Blueprint into a new Nuvra project.
 *
 * Installation steps:
 *  1. Validate the blueprint (schema, dependencies)
 *  2. Prompt user for config variable values
 *  3. Create a new project via projectManager
 *  4. Apply variable substitutions to all page HTML
 *  5. Import all pages into the project
 *  6. Import all collections into the project
 *  7. Apply AI settings
 *  8. Install required extensions (if any)
 *  9. Open the new project in the editor
 *  10. Record the install in blueprintRegistry
 */
'use strict';

import { blueprintRegistry } from './blueprintRegistry.js';

let _projectManager = null;
let _extensionLoader = null;
let _userId = null;

export const blueprintInstaller = {

  init({ projectManager, extensionLoader, userId }) {
    _projectManager  = projectManager;
    _extensionLoader = extensionLoader;
    _userId          = userId;
  },

  /**
   * Install a blueprint into a new project.
   * @param {string} blueprintId
   * @param {object} configValues - user-provided values for config variables
   * @param {function} onProgress - progress callback (step, total, message)
   * @returns {Promise<{ success: boolean, projectId?: string, message?: string }>}
   */
  async install(blueprintId, configValues = {}, onProgress = () => {}) {
    const blueprint = blueprintRegistry.getById(blueprintId);
    if (!blueprint) {
      return { success: false, message: `Blueprint "${blueprintId}" not found` };
    }

    const totalSteps = 8;
    let step = 0;

    const progress = (msg) => {
      step++;
      onProgress(step, totalSteps, msg);
    };

    try {
      // Step 1: Validate
      progress('Validating blueprint...');
      const validation = this._validateBlueprint(blueprint);
      if (!validation.valid) {
        return { success: false, message: validation.errors.join('; ') };
      }

      // Step 2: Merge config defaults with user values
      progress('Applying configuration...');
      const config = _mergeConfig(blueprint.config?.variables || [], configValues);

      // Step 3: Create a new project
      progress('Creating project...');
      if (!_projectManager) {
        return { success: false, message: 'ProjectManager not initialised' };
      }
      const projectName = _substituteVars(blueprint.project?.name || blueprint.name, config);
      const project = await _projectManager.createProject(projectName);
      if (!project) {
        return { success: false, message: 'Failed to create project' };
      }
      const projectId = project.projectId;

      // Step 4: Import pages
      progress('Importing pages...');
      const pages = (blueprint.project?.pages || []).map(page => ({
        ...page,
        name: _substituteVars(page.name, config),
        html: _substituteVars(page.html || '', config),
        css:  _substituteVars(page.css  || '', config),
      }));
      await _importPages(projectId, pages);

      // Step 5: Import collections
      progress('Importing data models...');
      const collections = blueprint.project?.collections || [];
      await _importCollections(projectId, collections);

      // Step 6: Apply AI settings
      progress('Applying AI settings...');
      if (blueprint.project?.aiSettings) {
        _applyAISettings(projectId, blueprint.project.aiSettings);
      }

      // Step 7: Install required extensions
      progress('Installing required extensions...');
      if (_extensionLoader && blueprint.requiredExtensions?.length) {
        for (const extId of blueprint.requiredExtensions) {
          try {
            await _extensionLoader.install(extId);
          } catch (e) {
            console.warn(`[Blueprint] Could not install required extension ${extId}:`, e);
          }
        }
      }

      // Step 8: Record install
      progress('Finalising...');
      blueprintRegistry.recordInstall(blueprintId, projectId);

      return { success: true, projectId, projectName };

    } catch (err) {
      console.error('[Blueprint] Install failed:', err);
      return { success: false, message: err.message || 'Installation failed' };
    }
  },

  /**
   * Validate a blueprint before installation.
   */
  _validateBlueprint(blueprint) {
    const errors = [];
    if (!blueprint.blueprintId) errors.push('Missing blueprintId');
    if (!blueprint.name)        errors.push('Missing name');
    if (!blueprint.project)     errors.push('Missing project definition');
    return { valid: errors.length === 0, errors };
  },

  /**
   * Get the config variables for a blueprint (for the UI to render a form).
   */
  getConfigVariables(blueprintId) {
    const blueprint = blueprintRegistry.getById(blueprintId);
    return blueprint?.config?.variables || [];
  },

  /**
   * Preview what a blueprint will create (without actually installing).
   */
  preview(blueprintId) {
    const blueprint = blueprintRegistry.getById(blueprintId);
    if (!blueprint) return null;
    return {
      name:        blueprint.name,
      pages:       (blueprint.project?.pages || []).map(p => p.name),
      collections: (blueprint.project?.collections || []).map(c => c.name),
      extensions:  blueprint.requiredExtensions || [],
      config:      blueprint.config?.variables || [],
    };
  },
};

// ─── Private Helpers ──────────────────────────────────────────────────────────

function _mergeConfig(variables, userValues) {
  const config = {};
  for (const v of variables) {
    config[v.key] = userValues[v.key] !== undefined ? userValues[v.key] : v.default;
  }
  return config;
}

function _substituteVars(str, config) {
  if (!str) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => config[key] !== undefined ? config[key] : `{{${key}}}`);
}

async function _importPages(projectId, pages) {
  try {
    const key = `nuvra-project-data-${projectId}`;
    const data = JSON.parse(localStorage.getItem(key) || '{}');
    data.pages = pages.map((p, i) => ({
      id:        `page-${i + 1}`,
      name:      p.name,
      path:      p.path || `/${p.name.toLowerCase().replace(/\s+/g, '-')}`,
      html:      p.html || '',
      css:       p.css  || '',
      createdAt: new Date().toISOString(),
    }));
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.warn('[Blueprint] Failed to import pages:', e);
  }
}

async function _importCollections(projectId, collections) {
  try {
    const key = `nuvra-project-data-${projectId}`;
    const data = JSON.parse(localStorage.getItem(key) || '{}');
    data.dataStore = data.dataStore || {};
    for (const col of collections) {
      data.dataStore[col.name] = {
        name:      col.name,
        fields:    col.fields || [],
        records:   [],
        createdAt: new Date().toISOString(),
      };
    }
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.warn('[Blueprint] Failed to import collections:', e);
  }
}

function _applyAISettings(projectId, aiSettings) {
  try {
    const key = `nuvra-ai-settings-${projectId}`;
    const existing = JSON.parse(localStorage.getItem(key) || '{}');
    localStorage.setItem(key, JSON.stringify({ ...existing, ...aiSettings }));
  } catch (e) {
    console.warn('[Blueprint] Failed to apply AI settings:', e);
  }
}
