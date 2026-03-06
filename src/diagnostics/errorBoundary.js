/**
 * errorBoundary.js — Nuvra Foundation (Phase 0–1)
 *
 * Central error capture and reporting system.
 *
 * Responsibilities:
 *  - Catch unhandled errors and promise rejections globally
 *  - Classify errors by severity and source
 *  - Report errors to the logger and eventBus
 *  - Display a visible dev overlay for critical errors
 *  - Never swallow errors silently
 *
 * Every subsystem that catches an error should call:
 *   errorBoundary.capture(error, { module: 'myModule', context: 'what was happening' })
 *
 * @module diagnostics/errorBoundary
 */
'use strict';

import { eventBus } from '../runtime/eventBus.js';
import { logger, LogLevel } from './logger.js';
import { now, generateId } from '../runtime/utils.js';

// ─── Error Severity ───────────────────────────────────────────────────────────
export const ErrorSeverity = Object.freeze({
  LOW:      'low',      // degraded feature, app continues
  MEDIUM:   'medium',   // important feature broken, app continues
  HIGH:     'high',     // major feature broken, partial recovery possible
  CRITICAL: 'critical', // app cannot continue, requires reload
});

// ─── ErrorBoundary ────────────────────────────────────────────────────────────
class ErrorBoundary {
  constructor() {
    this._errors       = [];
    this._maxErrors    = 200;
    this._overlayEl    = null;
    this._globalBound  = false;
  }

  // ── Setup ────────────────────────────────────────────────────────────────────
  /**
   * Install global error handlers (window.onerror, unhandledrejection).
   * Call once during boot.
   */
  installGlobalHandlers() {
    if (this._globalBound || typeof window === 'undefined') return;
    this._globalBound = true;

    window.addEventListener('error', (event) => {
      this.capture(event.error || new Error(event.message), {
        module:   'window',
        context:  `${event.filename}:${event.lineno}:${event.colno}`,
        severity: ErrorSeverity.HIGH,
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      const err = event.reason instanceof Error
        ? event.reason
        : new Error(String(event.reason));
      this.capture(err, {
        module:   'promise',
        context:  'Unhandled promise rejection',
        severity: ErrorSeverity.HIGH,
      });
    });
  }

  // ── Capture ──────────────────────────────────────────────────────────────────
  /**
   * Capture and report an error.
   * @param {Error|string} error
   * @param {object} [opts]
   * @param {string} [opts.module]
   * @param {string} [opts.context]
   * @param {string} [opts.severity]
   * @param {object} [opts.data]
   * @returns {object} the error record
   */
  capture(error, {
    module   = 'unknown',
    context  = '',
    severity = ErrorSeverity.MEDIUM,
    data     = null,
  } = {}) {
    const err = error instanceof Error ? error : new Error(String(error));

    const record = {
      id:        generateId('err'),
      ts:        now(),
      module,
      context,
      severity,
      message:   err.message,
      stack:     err.stack || null,
      data,
    };

    // Store in history
    this._errors.push(record);
    if (this._errors.length > this._maxErrors) this._errors.shift();

    // Log it
    const level = severity === ErrorSeverity.CRITICAL || severity === ErrorSeverity.HIGH
      ? LogLevel.ERROR
      : LogLevel.WARN;
    logger._log(level, module, `[${severity.toUpperCase()}] ${err.message}`, { context, data });

    // Emit on event bus
    eventBus.emit('diagnostics:error', record);

    // Show dev overlay for critical errors
    if (severity === ErrorSeverity.CRITICAL) {
      this._showCriticalOverlay(record);
    }

    return record;
  }

  // ── History ──────────────────────────────────────────────────────────────────
  getErrors(severity = null) {
    if (severity) return this._errors.filter(e => e.severity === severity);
    return [...this._errors];
  }

  getErrorCount() { return this._errors.length; }
  clearErrors()   { this._errors.length = 0; }

  hasErrors(minSeverity = ErrorSeverity.MEDIUM) {
    const order = [ErrorSeverity.LOW, ErrorSeverity.MEDIUM, ErrorSeverity.HIGH, ErrorSeverity.CRITICAL];
    const minIdx = order.indexOf(minSeverity);
    return this._errors.some(e => order.indexOf(e.severity) >= minIdx);
  }

  // ── Dev Overlay ──────────────────────────────────────────────────────────────
  _showCriticalOverlay(record) {
    if (typeof document === 'undefined') return;

    // Remove existing overlay
    this._overlayEl?.remove();

    const el = document.createElement('div');
    el.id = 'nv-error-overlay';
    el.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
      'background:rgba(13,17,23,0.97)', 'z-index:999999',
      'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
      'font-family:monospace', 'padding:40px', 'box-sizing:border-box',
    ].join(';');

    el.innerHTML = `
      <div style="max-width:640px;width:100%;text-align:left;">
        <div style="color:#f85149;font-size:18px;font-weight:bold;margin-bottom:12px;">
          &#9888; Critical Error — Nuvra
        </div>
        <div style="color:#f0f6fc;font-size:14px;margin-bottom:16px;line-height:1.6;">
          ${this._escapeHtml(record.message)}
        </div>
        <div style="color:#8b949e;font-size:12px;margin-bottom:8px;">
          Module: ${this._escapeHtml(record.module)} &nbsp;|&nbsp; ${this._escapeHtml(record.context)}
        </div>
        ${record.stack ? `
        <pre style="color:#6e7681;font-size:11px;background:#161b22;padding:12px;border-radius:6px;
          overflow:auto;max-height:200px;border:1px solid #21262d;margin-bottom:16px;">${this._escapeHtml(record.stack)}</pre>
        ` : ''}
        <button onclick="location.reload()"
          style="padding:8px 20px;background:#da3633;color:#fff;border:none;border-radius:6px;
          font-size:13px;font-weight:600;cursor:pointer;margin-right:10px;">
          Reload App
        </button>
        <button onclick="document.getElementById('nv-error-overlay').remove()"
          style="padding:8px 20px;background:#21262d;color:#c9d1d9;border:1px solid #30363d;
          border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">
          Dismiss
        </button>
      </div>
    `;

    document.body.appendChild(el);
    this._overlayEl = el;
  }

  _escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const errorBoundary = new ErrorBoundary();
export default errorBoundary;
