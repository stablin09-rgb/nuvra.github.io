/**
 * logger.js — Nuvra Foundation (Phase 0–1)
 *
 * Structured, leveled logging system.
 *
 * All modules log through this system — never directly to console.
 * This ensures:
 *  - Consistent log format
 *  - Log level filtering
 *  - Log history for diagnostics overlay
 *  - EventBus integration (logs are observable)
 *  - Easy to swap transport (console → remote → file)
 *
 * Log levels (ascending severity):
 *   DEBUG < INFO < WARN < ERROR < FATAL
 *
 * @module diagnostics/logger
 */
'use strict';

import { eventBus } from '../runtime/eventBus.js';
import { now, formatTs } from '../runtime/utils.js';

// ─── Log Levels ───────────────────────────────────────────────────────────────
export const LogLevel = Object.freeze({
  DEBUG: 0,
  INFO:  1,
  WARN:  2,
  ERROR: 3,
  FATAL: 4,
});

const LEVEL_NAMES = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
const LEVEL_STYLES = {
  DEBUG: 'color:#8b949e',
  INFO:  'color:#58a6ff',
  WARN:  'color:#d29922',
  ERROR: 'color:#f85149',
  FATAL: 'color:#ff7b72;font-weight:bold',
};

// ─── Logger ───────────────────────────────────────────────────────────────────
class Logger {
  constructor({ minLevel = LogLevel.DEBUG, historySize = 500 } = {}) {
    this._minLevel   = minLevel;
    this._history    = [];
    this._historySize = historySize;
    this._transports = [this._consoleTransport.bind(this)];
  }

  // ── Log Methods ──────────────────────────────────────────────────────────────
  debug(module, message, data)  { this._log(LogLevel.DEBUG, module, message, data); }
  info (module, message, data)  { this._log(LogLevel.INFO,  module, message, data); }
  warn (module, message, data)  { this._log(LogLevel.WARN,  module, message, data); }
  error(module, message, data)  { this._log(LogLevel.ERROR, module, message, data); }
  fatal(module, message, data)  { this._log(LogLevel.FATAL, module, message, data); }

  // ── Configuration ────────────────────────────────────────────────────────────
  setMinLevel(level) {
    if (typeof level !== 'number') throw new TypeError('Logger.setMinLevel: level must be a number');
    this._minLevel = level;
  }

  addTransport(fn) {
    if (typeof fn !== 'function') throw new TypeError('Logger.addTransport: transport must be a function');
    this._transports.push(fn);
  }

  // ── History ──────────────────────────────────────────────────────────────────
  getHistory(minLevel = LogLevel.DEBUG, limit = 100) {
    return this._history
      .filter(e => e.level >= minLevel)
      .slice(-limit);
  }

  clearHistory() {
    this._history.length = 0;
  }

  // ── Private ───────────────────────────────────────────────────────────────────
  _log(level, module, message, data) {
    if (level < this._minLevel) return;

    const entry = {
      level,
      levelName: LEVEL_NAMES[level],
      module:    module || 'app',
      message:   String(message),
      data:      data !== undefined ? data : null,
      ts:        now(),
    };

    // Add to history
    this._history.push(entry);
    if (this._history.length > this._historySize) this._history.shift();

    // Deliver to all transports
    for (const transport of this._transports) {
      try { transport(entry); } catch {}
    }

    // Emit on event bus for diagnostics overlay
    eventBus.emit('diagnostics:log', entry);
  }

  _consoleTransport(entry) {
    const prefix = `%c[${entry.levelName}] [${entry.module}]`;
    const style  = LEVEL_STYLES[entry.levelName] || '';
    const msg    = `${formatTs(entry.ts)} ${entry.message}`;

    if (entry.data !== null) {
      console[entry.level >= LogLevel.ERROR ? 'error' : entry.level >= LogLevel.WARN ? 'warn' : 'log'](
        prefix, style, msg, entry.data
      );
    } else {
      console[entry.level >= LogLevel.ERROR ? 'error' : entry.level >= LogLevel.WARN ? 'warn' : 'log'](
        prefix, style, msg
      );
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const logger = new Logger();
export default logger;
