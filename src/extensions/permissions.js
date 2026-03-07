/**
 * Nuvra Builder — Extension Permission System (Phase 10)
 *
 * Defines the permission model for the extension system.
 * Every capability an extension can request must be declared here.
 * Extensions cannot access anything not in their declared permissions.
 *
 * DESIGN PRINCIPLES:
 *  - Least privilege: extensions get only what they declare
 *  - Explicit consent: user-visible permissions require approval
 *  - Auditable: all permission checks are logged
 *  - Immutable: permissions are set at install time, not at runtime
 *
 * Permission Categories:
 *  - EDITOR:  Access to the GrapesJS editor (read-only or read-write)
 *  - DATA:    Access to project data collections
 *  - AI:      Access to AI generation hooks
 *  - NETWORK: Access to external network requests
 *  - PROJECT: Access to project metadata
 *  - STORAGE: Access to localStorage (scoped, never raw)
 */
'use strict';

// ─── Permission Definitions ───────────────────────────────────────────────────

/**
 * All valid permissions an extension can declare.
 * Each permission has:
 *  - id:          Unique identifier
 *  - label:       Human-readable name
 *  - description: What the extension can do with this permission
 *  - requiresApproval: Whether the user must explicitly approve this
 *  - category:    Grouping for UI display
 */
export const PERMISSIONS = {
  // ── Editor permissions ──────────────────────────────────────────────────────
  'editor.read': {
    id:               'editor.read',
    label:            'Read editor state',
    description:      'Read the current page HTML, CSS, and component tree.',
    requiresApproval: false,
    category:         'editor',
  },
  'editor.blocks.add': {
    id:               'editor.blocks.add',
    label:            'Add custom blocks',
    description:      'Register new drag-and-drop blocks in the editor block panel.',
    requiresApproval: false,
    category:         'editor',
  },
  'editor.blocks.remove': {
    id:               'editor.blocks.remove',
    label:            'Remove blocks',
    description:      'Remove existing blocks from the editor block panel.',
    requiresApproval: true,
    category:         'editor',
  },
  'editor.components.add': {
    id:               'editor.components.add',
    label:            'Add custom components',
    description:      'Register new component types in the GrapesJS component model.',
    requiresApproval: false,
    category:         'editor',
  },
  'editor.styles.inject': {
    id:               'editor.styles.inject',
    label:            'Inject CSS styles',
    description:      'Inject CSS into the editor canvas for custom block styling.',
    requiresApproval: false,
    category:         'editor',
  },
  'editor.canvas.inject': {
    id:               'editor.canvas.inject',
    label:            'Inject canvas scripts',
    description:      'Inject JavaScript into the editor canvas (sandboxed).',
    requiresApproval: true,
    category:         'editor',
  },

  // ── Data permissions ────────────────────────────────────────────────────────
  'data.read': {
    id:               'data.read',
    label:            'Read project data',
    description:      'Read data from project collections.',
    requiresApproval: false,
    category:         'data',
  },
  'data.write': {
    id:               'data.write',
    label:            'Write project data',
    description:      'Create, update, and delete records in project collections.',
    requiresApproval: true,
    category:         'data',
  },
  'data.schema.read': {
    id:               'data.schema.read',
    label:            'Read data schemas',
    description:      'Read the schema definitions of project collections.',
    requiresApproval: false,
    category:         'data',
  },
  'data.schema.write': {
    id:               'data.schema.write',
    label:            'Modify data schemas',
    description:      'Add, modify, or remove fields in project collections.',
    requiresApproval: true,
    category:         'data',
  },

  // ── AI permissions ──────────────────────────────────────────────────────────
  'ai.prompt.extend': {
    id:               'ai.prompt.extend',
    label:            'Extend AI prompts',
    description:      'Add domain-specific context to AI generation prompts.',
    requiresApproval: false,
    category:         'ai',
  },
  'ai.planner.register': {
    id:               'ai.planner.register',
    label:            'Register AI planner',
    description:      'Register a custom AI planning strategy for a specific domain.',
    requiresApproval: false,
    category:         'ai',
  },
  'ai.schema.generate': {
    id:               'ai.schema.generate',
    label:            'Generate schemas with AI',
    description:      'Use the AI engine to generate page or app schemas.',
    requiresApproval: false,
    category:         'ai',
  },
  'ai.hooks.before': {
    id:               'ai.hooks.before',
    label:            'AI pre-generation hook',
    description:      'Run code before AI generation starts (can modify the prompt).',
    requiresApproval: true,
    category:         'ai',
  },
  'ai.hooks.after': {
    id:               'ai.hooks.after',
    label:            'AI post-generation hook',
    description:      'Run code after AI generation completes (can modify the result).',
    requiresApproval: true,
    category:         'ai',
  },

  // ── Network permissions ─────────────────────────────────────────────────────
  'network.fetch': {
    id:               'network.fetch',
    label:            'Make network requests',
    description:      'Fetch data from external URLs declared in the extension manifest.',
    requiresApproval: true,
    category:         'network',
  },

  // ── Project permissions ─────────────────────────────────────────────────────
  'project.meta.read': {
    id:               'project.meta.read',
    label:            'Read project metadata',
    description:      'Read the project name, ID, and settings.',
    requiresApproval: false,
    category:         'project',
  },
  'project.pages.read': {
    id:               'project.pages.read',
    label:            'Read project pages',
    description:      'Read the list of pages and their content.',
    requiresApproval: false,
    category:         'project',
  },
  'project.pages.add': {
    id:               'project.pages.add',
    label:            'Add pages to project',
    description:      'Add new pages to the project (used by template extensions).',
    requiresApproval: true,
    category:         'project',
  },

  // ── Storage permissions ─────────────────────────────────────────────────────
  'storage.extension': {
    id:               'storage.extension',
    label:            'Extension-scoped storage',
    description:      'Store extension-specific data in a sandboxed localStorage namespace.',
    requiresApproval: false,
    category:         'storage',
  },
};

// ─── Permission Validator ─────────────────────────────────────────────────────

/**
 * Validate that a set of declared permissions are all known.
 * @param {string[]} declared - Permission IDs declared in the manifest
 * @returns {{ valid: boolean, unknown: string[] }}
 */
export function validatePermissions(declared) {
  const unknown = declared.filter(p => !PERMISSIONS[p]);
  return { valid: unknown.length === 0, unknown };
}

/**
 * Get all permissions that require user approval from a declared set.
 * @param {string[]} declared
 * @returns {object[]} Permission definitions requiring approval
 */
export function getApprovalRequired(declared) {
  return declared
    .filter(p => PERMISSIONS[p]?.requiresApproval)
    .map(p => PERMISSIONS[p]);
}

/**
 * Check whether a specific permission is in a declared set.
 * @param {string[]} declared - Permissions the extension has
 * @param {string}   required - Permission being checked
 * @returns {boolean}
 */
export function hasPermission(declared, required) {
  return Array.isArray(declared) && declared.includes(required);
}

/**
 * Get the display-friendly permission list for the install dialog.
 * @param {string[]} declared
 * @returns {{ category: string, items: object[] }[]}
 */
export function getPermissionsByCategory(declared) {
  const byCategory = {};
  for (const id of declared) {
    const perm = PERMISSIONS[id];
    if (!perm) continue;
    if (!byCategory[perm.category]) byCategory[perm.category] = [];
    byCategory[perm.category].push(perm);
  }
  return Object.entries(byCategory).map(([category, items]) => ({ category, items }));
}
