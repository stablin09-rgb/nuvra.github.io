/**
 * extensionTypes.js — Nuvra Extension System
 *
 * Shared type definitions and enumerations for the extension system.
 * Used by marketplace catalog, governance, revenue engine, and other modules.
 */

// ─── Trust Tier ───────────────────────────────────────────────────────────────

export const TrustTier = Object.freeze({
  /** Officially reviewed and approved by the Nuvra team */
  VERIFIED:     'verified',
  /** Community-submitted, passes automated checks */
  COMMUNITY:    'community',
  /** Experimental / developer preview — use at your own risk */
  EXPERIMENTAL: 'experimental',
});

// ─── Permission ───────────────────────────────────────────────────────────────

export const Permission = Object.freeze({
  // Network
  NETWORK_FETCH:               'network:fetch',
  NETWORK_WEBSOCKET:           'network:websocket',

  // Storage
  STORAGE_SCOPED:              'storage:scoped',
  STORAGE_GLOBAL:              'storage:global',

  // Data
  DATA_READ:                   'data:read',
  DATA_WRITE:                  'data:write',
  DATA_CREATE_COLLECTION:      'data:create_collection',

  // AI
  AI_REGISTER_PLANNER:         'ai:register_planner',
  AI_REGISTER_SCHEMA_MODIFIER: 'ai:register_schema_modifier',
  AI_CALL_PROVIDER:            'ai:call_provider',

  // Runtime
  RUNTIME_PUBLISH_HOOK:        'runtime:publish_hook',
  RUNTIME_MOBILE_HOOK:         'runtime:mobile_hook',
  RUNTIME_LIFECYCLE_HOOK:      'runtime:lifecycle_hook',

  // UI
  UI_REGISTER_BLOCK:           'ui:register_block',
  UI_REGISTER_PANEL:           'ui:register_panel',
  UI_INJECT_TOOLBAR:           'ui:inject_toolbar',
});

// ─── Extension Status ─────────────────────────────────────────────────────────

export const ExtensionStatus = Object.freeze({
  PENDING:   'pending',
  APPROVED:  'approved',
  REJECTED:  'rejected',
  SUSPENDED: 'suspended',
  ARCHIVED:  'archived',
});

// ─── Extension Category ───────────────────────────────────────────────────────

export const ExtensionCategory = Object.freeze({
  BLOCKS:      'blocks',
  AI:          'ai',
  INTEGRATIONS:'integrations',
  ANALYTICS:   'analytics',
  PUBLISHING:  'publishing',
  UTILITIES:   'utilities',
  THEMES:      'themes',
});
