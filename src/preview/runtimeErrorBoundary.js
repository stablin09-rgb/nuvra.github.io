/**
 * runtimeErrorBoundary.js — Nuvra Phase 4
 *
 * Runtime Error Containment & Recovery.
 *
 * Captures errors from the preview runtime and publish pipeline.
 * Provides structured diagnostics that point to:
 *  - The schema location (page ID, component ID, action ID)
 *  - The component type
 *  - The action chain step
 *
 * Guarantees:
 *  - Preview failure ≠ project corruption
 *  - Editor never crashes due to preview errors
 *  - All errors are captured, classified, and displayed
 *  - No silent failures
 *
 * @module preview/runtimeErrorBoundary
 */
'use strict';

import { eventBus }  from '../runtime/eventBus.js';
import { store }     from '../state/store.js';
import { logger }    from '../diagnostics/logger.js';

// ─── Error Classes ─────────────────────────────────────────────────────────────
export const RuntimeErrorClass = Object.freeze({
  SCHEMA_INVALID:    'schema_invalid',    // Schema failed validation
  RENDER_FAILED:     'render_failed',     // Renderer threw an error
  COMPONENT_ERROR:   'component_error',   // A component failed to render
  ACTION_ERROR:      'action_error',      // An action step failed
  DATA_ERROR:        'data_error',        // A data operation failed
  STATE_ERROR:       'state_error',       // A state operation failed
  PUBLISH_ERROR:     'publish_error',     // Publish pipeline failed
  SNAPSHOT_ERROR:    'snapshot_error',    // Snapshot creation failed
  UNKNOWN:           'unknown',           // Uncategorized error
});

// ─── RuntimeErrorBoundary ─────────────────────────────────────────────────────
export class RuntimeErrorBoundary {
  constructor() {
    this._name   = 'RuntimeErrorBoundary';
    this._errors = []; // Rolling error log
    this._maxErrors = 100;
  }

  /**
   * Capture a runtime error.
   *
   * @param {Error|string} err       - The error
   * @param {object}       [context] - Diagnostic context
   * @param {string}  [context.errorClass]   - RuntimeErrorClass
   * @param {string}  [context.pageId]       - The page where the error occurred
   * @param {string}  [context.componentId]  - The component where the error occurred
   * @param {string}  [context.componentType]- The component type
   * @param {string}  [context.actionId]     - The action where the error occurred
   * @param {string}  [context.stepId]       - The action step where the error occurred
   * @param {string}  [context.module]       - The module that threw the error
   * @returns {object} The captured error record
   */
  capture(err, context = {}) {
    const message = err instanceof Error ? err.message : String(err);
    const stack   = err instanceof Error ? err.stack   : null;

    const record = {
      id:         _generateId('err'),
      ts:         Date.now(),
      message,
      stack,
      errorClass: context.errorClass || this._classify(message),
      pageId:       context.pageId       || null,
      componentId:  context.componentId  || null,
      componentType:context.componentType|| null,
      actionId:     context.actionId     || null,
      stepId:       context.stepId       || null,
      module:       context.module       || 'unknown',
      recovered:    false,
    };

    this._errors.push(record);
    if (this._errors.length > this._maxErrors) this._errors.shift();

    // Log to the foundation logger
    logger.error('RuntimeErrorBoundary', `[${record.errorClass}] ${message}`, {
      pageId:      record.pageId,
      componentId: record.componentId,
      actionId:    record.actionId,
    });

    // Dispatch to store for UI display
    store.dispatch({ type: 'RUNTIME/ADD_ERROR', payload: record });

    // Emit event for any listeners
    eventBus.emit('runtime:error', record);

    return record;
  }

  /**
   * Mark an error as recovered.
   * @param {string} errorId
   */
  markRecovered(errorId) {
    const record = this._errors.find(e => e.id === errorId);
    if (record) {
      record.recovered = true;
      store.dispatch({ type: 'RUNTIME/MARK_ERROR_RECOVERED', payload: errorId });
    }
  }

  /**
   * Clear all captured errors.
   */
  clear() {
    this._errors = [];
    store.dispatch({ type: 'RUNTIME/CLEAR_ERRORS' });
  }

  /**
   * Get all captured errors.
   * @returns {object[]}
   */
  getErrors() { return [...this._errors]; }

  /**
   * Get the most recent error.
   * @returns {object|null}
   */
  getLatest() { return this._errors[this._errors.length - 1] || null; }

  /**
   * Format an error record into a human-readable diagnostic message.
   * Points to the exact schema location.
   *
   * @param {object} record
   * @returns {string}
   */
  format(record) {
    const lines = [
      `Error: ${record.message}`,
      `Class: ${record.errorClass}`,
      `Module: ${record.module}`,
    ];
    if (record.pageId)        lines.push(`Page: ${record.pageId}`);
    if (record.componentId)   lines.push(`Component: ${record.componentId} (${record.componentType || 'unknown type'})`);
    if (record.actionId)      lines.push(`Action: ${record.actionId}`);
    if (record.stepId)        lines.push(`Step: ${record.stepId}`);
    if (record.stack) {
      const firstLine = record.stack.split('\n').slice(0, 3).join('\n');
      lines.push(`Stack:\n${firstLine}`);
    }
    return lines.join('\n');
  }

  /**
   * Wrap a function call in an error boundary.
   * If the function throws, the error is captured and the fallback is returned.
   *
   * @param {Function} fn
   * @param {object}   context
   * @param {*}        fallback
   * @returns {*}
   */
  wrap(fn, context = {}, fallback = null) {
    try {
      return fn();
    } catch (err) {
      this.capture(err, context);
      return fallback;
    }
  }

  /**
   * Wrap an async function call in an error boundary.
   * @param {Function} fn
   * @param {object}   context
   * @param {*}        fallback
   * @returns {Promise<*>}
   */
  async wrapAsync(fn, context = {}, fallback = null) {
    try {
      return await fn();
    } catch (err) {
      this.capture(err, context);
      return fallback;
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  _classify(message) {
    const m = String(message).toLowerCase();
    if (m.includes('schema') || m.includes('invalid') || m.includes('required')) return RuntimeErrorClass.SCHEMA_INVALID;
    if (m.includes('render') || m.includes('html'))   return RuntimeErrorClass.RENDER_FAILED;
    if (m.includes('component'))                       return RuntimeErrorClass.COMPONENT_ERROR;
    if (m.includes('action') || m.includes('dispatch'))return RuntimeErrorClass.ACTION_ERROR;
    if (m.includes('collection') || m.includes('record') || m.includes('data')) return RuntimeErrorClass.DATA_ERROR;
    if (m.includes('state') || m.includes('path'))    return RuntimeErrorClass.STATE_ERROR;
    if (m.includes('publish') || m.includes('pipeline')) return RuntimeErrorClass.PUBLISH_ERROR;
    if (m.includes('snapshot'))                        return RuntimeErrorClass.SNAPSHOT_ERROR;
    return RuntimeErrorClass.UNKNOWN;
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────
export const runtimeErrorBoundary = new RuntimeErrorBoundary();
export default runtimeErrorBoundary;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _generateId(prefix) {
  return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 10);
}
