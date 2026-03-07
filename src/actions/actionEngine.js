/**
 * Nuvra Builder — Action Engine
 *
 * A lightweight event-driven action system for Nuvra apps.
 * Connects UI events (button clicks, form submits) to data operations.
 *
 * Supported actions:
 *  - submit:  Insert a new record into a collection from a form
 *  - fetch:   Load records from a collection into a component
 *  - update:  Update an existing record
 *  - delete:  Delete a record
 *  - setState: Set a state value
 *  - navigate: Switch to a different page
 *
 * Actions are defined as plain JSON schemas, making them:
 *  - Serializable (stored with the project)
 *  - AI-generatable
 *  - Testable without a UI
 *
 * ActionSchema:
 * {
 *   id:         string,
 *   type:       ActionType,
 *   trigger:    'click' | 'submit' | 'load' | 'change',
 *   collection: string,   // for data actions
 *   fields:     string[], // for submit/update
 *   target:     string,   // component ID to update after action
 *   stateKey:   string,   // for setState
 *   stateValue: *,        // for setState
 *   pageId:     string,   // for navigate
 * }
 */

'use strict';

import { dataStore }    from '../data/dataModel.js';
import { stateManager } from '../state/stateManager.js';

// ─── Action Types ─────────────────────────────────────────────────────────────

export const ACTION_TYPES = {
  SUBMIT:     'submit',
  FETCH:      'fetch',
  UPDATE:     'update',
  DELETE:     'delete',
  SET_STATE:  'setState',
  NAVIGATE:   'navigate',
};

// ─── Action Registry ──────────────────────────────────────────────────────────

/** @type {Map<string, ActionSchema>} */
const _registry = new Map();

/**
 * Register an action schema.
 * @param {ActionSchema} action
 */
export function registerAction(action) {
  if (!action.id) throw new Error('[ActionEngine] Action must have an id.');
  _registry.set(action.id, action);
}

/**
 * Get a registered action by ID.
 * @param {string} id
 * @returns {ActionSchema|undefined}
 */
export function getAction(id) {
  return _registry.get(id);
}

/**
 * Get all registered actions.
 * @returns {ActionSchema[]}
 */
export function getAllActions() {
  return [..._registry.values()];
}

/**
 * Remove an action from the registry.
 * @param {string} id
 */
export function unregisterAction(id) {
  _registry.delete(id);
}

// ─── Action Executor ──────────────────────────────────────────────────────────

/**
 * Execute an action by ID.
 *
 * @param {string} actionId
 * @param {object} [context]  - Runtime context (e.g. { formData, recordId, pageId })
 * @returns {Promise<ActionResult>}
 */
export async function executeAction(actionId, context = {}) {
  const action = _registry.get(actionId);
  if (!action) {
    throw new Error(`[ActionEngine] Action "${actionId}" is not registered.`);
  }

  return _dispatch(action, context);
}

/**
 * Execute an action schema directly (without registration).
 * Useful for one-off actions from the preview runtime.
 *
 * @param {ActionSchema} action
 * @param {object} [context]
 * @returns {Promise<ActionResult>}
 */
export async function executeActionSchema(action, context = {}) {
  return _dispatch(action, context);
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

async function _dispatch(action, context) {
  switch (action.type) {

    case ACTION_TYPES.SUBMIT: {
      const data = context.formData || {};
      if (!action.collection) throw new Error('[ActionEngine] submit action requires a collection.');
      const record = dataStore.insert(action.collection, data);
      return { success: true, type: 'submit', record };
    }

    case ACTION_TYPES.FETCH: {
      if (!action.collection) throw new Error('[ActionEngine] fetch action requires a collection.');
      const filter  = context.filter || null;
      const records = dataStore.findAll(action.collection, filter);
      return { success: true, type: 'fetch', records };
    }

    case ACTION_TYPES.UPDATE: {
      const id      = context.recordId;
      const updates = context.formData || {};
      if (!action.collection) throw new Error('[ActionEngine] update action requires a collection.');
      if (!id) throw new Error('[ActionEngine] update action requires context.recordId.');
      const record = dataStore.update(action.collection, id, updates);
      return { success: true, type: 'update', record };
    }

    case ACTION_TYPES.DELETE: {
      const id = context.recordId;
      if (!action.collection) throw new Error('[ActionEngine] delete action requires a collection.');
      if (!id) throw new Error('[ActionEngine] delete action requires context.recordId.');
      const deleted = dataStore.delete(action.collection, id);
      return { success: true, type: 'delete', deleted };
    }

    case ACTION_TYPES.SET_STATE: {
      const key   = action.stateKey;
      const value = action.stateValue !== undefined ? action.stateValue : context.value;
      if (!key) throw new Error('[ActionEngine] setState action requires a stateKey.');
      stateManager.setApp(key, value);
      return { success: true, type: 'setState', key, value };
    }

    case ACTION_TYPES.NAVIGATE: {
      const pageId = action.pageId || context.pageId;
      if (!pageId) throw new Error('[ActionEngine] navigate action requires a pageId.');
      // Navigation is handled by the page manager — emit a custom event
      window.dispatchEvent(new CustomEvent('nuvra:navigate', { detail: { pageId } }));
      return { success: true, type: 'navigate', pageId };
    }

    default:
      throw new Error(`[ActionEngine] Unknown action type: "${action.type}".`);
  }
}

// ─── DOM Binding ──────────────────────────────────────────────────────────────

/**
 * Bind a DOM element to an action.
 * Reads the action schema from data-nv-action attributes.
 *
 * @param {HTMLElement} el
 * @param {string} pageId  - Current page ID (for state scoping)
 * @returns {Function} Cleanup function
 */
export function bindElementToAction(el, pageId) {
  const actionId   = el.dataset.nvAction;
  const actionType = el.dataset.nvActionType;

  if (!actionId && !actionType) return () => {};

  const triggerEvent = el.dataset.nvTrigger || (el.tagName === 'FORM' ? 'submit' : 'click');

  const handler = async (e) => {
    if (triggerEvent === 'submit') e.preventDefault();

    // Build context from the element
    const context = _buildContext(el, pageId);

    try {
      let result;
      if (actionId) {
        result = await executeAction(actionId, context);
      } else {
        // Inline action from data attributes
        const inlineAction = _parseInlineAction(el);
        result = await executeActionSchema(inlineAction, context);
      }

      // Dispatch result event for components to react to
      el.dispatchEvent(new CustomEvent('nuvra:action:result', {
        bubbles: true,
        detail:  result,
      }));
    } catch (err) {
      console.error('[ActionEngine] Action failed:', err);
      el.dispatchEvent(new CustomEvent('nuvra:action:error', {
        bubbles: true,
        detail:  { error: err.message },
      }));
    }
  };

  el.addEventListener(triggerEvent, handler);
  return () => el.removeEventListener(triggerEvent, handler);
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

function _buildContext(el, pageId) {
  const context = { pageId };

  // Collect form data if the element is a form or inside a form
  const form = el.tagName === 'FORM' ? el : el.closest('form');
  if (form) {
    const formData = {};
    new FormData(form).forEach((value, key) => { formData[key] = value; });
    context.formData = formData;
  }

  // Record ID from data attribute
  if (el.dataset.nvRecordId) {
    context.recordId = el.dataset.nvRecordId;
  }

  return context;
}

function _parseInlineAction(el) {
  return {
    id:         el.dataset.nvActionId || `inline-${Date.now()}`,
    type:       el.dataset.nvActionType,
    collection: el.dataset.nvCollection,
    stateKey:   el.dataset.nvStateKey,
    stateValue: el.dataset.nvStateValue,
    pageId:     el.dataset.nvPageId,
  };
}
