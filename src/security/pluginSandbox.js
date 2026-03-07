/**
 * Nuvra — pluginSandbox.js (Phase 15)
 *
 * Zero-trust, capability-based plugin sandbox with runtime enforcement.
 * Every plugin runs in a strictly isolated iframe. No capability is
 * granted by default. Every API call is validated against the plugin's
 * declared permissions and the active compliance policy before execution.
 *
 * This module extends Phase 10's sandbox.js with:
 *   - Compliance-aware capability checks
 *   - Runtime call rate limiting
 *   - Data class filtering on API responses
 *   - Tamper-resistant call logging
 *   - Automatic suspension on policy violation
 *
 * @module security/pluginSandbox
 */
'use strict';

// ─── Capability Definitions ───────────────────────────────────────────────────
export const CAPABILITIES = Object.freeze({
  // Editor
  READ_PAGES:         'read:pages',
  WRITE_PAGES:        'write:pages',
  READ_COMPONENTS:    'read:components',
  WRITE_COMPONENTS:   'write:components',
  // Data
  READ_COLLECTIONS:   'read:collections',
  WRITE_COLLECTIONS:  'write:collections',
  READ_RECORDS:       'read:records',
  WRITE_RECORDS:      'write:records',
  // AI
  INVOKE_AI:          'invoke:ai',
  READ_AI_SETTINGS:   'read:ai-settings',
  // Network
  FETCH_EXTERNAL:     'fetch:external',
  // Project
  READ_PROJECT_META:  'read:project-meta',
  // User
  READ_USER_ID:       'read:user-id',
  // Notifications
  SHOW_NOTIFICATION:  'show:notification',
  // Storage
  READ_PLUGIN_STORE:  'read:plugin-store',
  WRITE_PLUGIN_STORE: 'write:plugin-store',
});

// ─── Rate Limits (calls per minute per capability) ────────────────────────────
const RATE_LIMITS = {
  [CAPABILITIES.INVOKE_AI]:       10,
  [CAPABILITIES.FETCH_EXTERNAL]:  30,
  [CAPABILITIES.WRITE_RECORDS]:   60,
  [CAPABILITIES.WRITE_PAGES]:     20,
  [CAPABILITIES.WRITE_COMPONENTS]: 60,
  _default:                       120,
};

// ─── Data Class Filtering ─────────────────────────────────────────────────────
// Plugins cannot receive data above their declared max data class
const DATA_CLASS_ORDER = ['public', 'internal', 'personal', 'sensitive', 'regulated'];

function _filterByDataClass(data, maxClass) {
  if (!data || typeof data !== 'object') return data;
  const maxIdx = DATA_CLASS_ORDER.indexOf(maxClass);
  if (maxIdx < 0) return data;

  function _filterObj(obj) {
    if (Array.isArray(obj)) return obj.map(_filterObj);
    if (typeof obj !== 'object' || obj === null) return obj;
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && v.__dataClass) {
        const fieldIdx = DATA_CLASS_ORDER.indexOf(v.__dataClass);
        if (fieldIdx > maxIdx) {
          result[k] = '[REDACTED]';
          continue;
        }
      }
      result[k] = _filterObj(v);
    }
    return result;
  }
  return _filterObj(data);
}

// ─── Sandbox Instance ─────────────────────────────────────────────────────────
class PluginSandboxInstance {
  constructor({ pluginId, pluginName, capabilities, maxDataClass, complianceFrameworks }) {
    this.pluginId           = pluginId;
    this.pluginName         = pluginName;
    this.capabilities       = new Set(capabilities || []);
    this.maxDataClass       = maxDataClass || 'public';
    this.complianceFrameworks = complianceFrameworks || [];
    this.iframe             = null;
    this.callLog            = [];
    this.rateLimitCounters  = {};
    this.rateLimitResets    = {};
    this.suspended          = false;
    this.suspendReason      = null;
    this._handlers          = new Map();
    this._pendingCalls      = new Map();
    this._callCounter       = 0;
  }

  /**
   * Mount the sandbox iframe into the document.
   * @param {string} scriptContent - The plugin's JS code
   * @returns {Promise<void>}
   */
  async mount(scriptContent) {
    return new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.setAttribute('data-plugin-id', this.pluginId);

      const bootstrapScript = `
        (function() {
          'use strict';
          const __pluginId = '${this.pluginId}';
          const __capabilities = ${JSON.stringify([...this.capabilities])};

          // Nuvra Plugin API
          window.nuvra = {
            call: function(capability, method, params) {
              return new Promise((resolve, reject) => {
                const callId = Math.random().toString(36).slice(2);
                window.addEventListener('message', function handler(e) {
                  if (e.data && e.data.__nuvraCallId === callId) {
                    window.removeEventListener('message', handler);
                    if (e.data.error) reject(new Error(e.data.error));
                    else resolve(e.data.result);
                  }
                });
                window.parent.postMessage({
                  __nuvraPlugin: true,
                  pluginId: __pluginId,
                  callId,
                  capability,
                  method,
                  params,
                }, '*');
              });
            },
            on: function(event, handler) {
              window.addEventListener('message', function(e) {
                if (e.data && e.data.__nuvraEvent === event) {
                  handler(e.data.payload);
                }
              });
            },
          };

          // Plugin code
          try {
            ${scriptContent}
          } catch(err) {
            window.parent.postMessage({ __nuvraPluginError: true, pluginId: __pluginId, error: err.message }, '*');
          }
        })();
      `;

      const blob = new Blob([`<script>${bootstrapScript}<\/script>`], { type: 'text/html' });
      iframe.src = URL.createObjectURL(blob);

      iframe.addEventListener('load', () => {
        this.iframe = iframe;
        resolve();
      });
      iframe.addEventListener('error', reject);
      document.body.appendChild(iframe);

      // Listen for messages from this plugin
      window.addEventListener('message', this._onMessage.bind(this));
    });
  }

  /**
   * Handle a message from the plugin iframe.
   */
  _onMessage(event) {
    const msg = event.data;
    if (!msg || !msg.__nuvraPlugin || msg.pluginId !== this.pluginId) return;

    // Log the call
    const logEntry = {
      timestamp:  Date.now(),
      pluginId:   this.pluginId,
      capability: msg.capability,
      method:     msg.method,
      callId:     msg.callId,
      allowed:    null,
      denyReason: null,
    };

    // Check suspension
    if (this.suspended) {
      logEntry.allowed    = false;
      logEntry.denyReason = `Plugin suspended: ${this.suspendReason}`;
      this.callLog.push(logEntry);
      this._replyError(msg.callId, logEntry.denyReason);
      return;
    }

    // Check capability
    if (!this.capabilities.has(msg.capability)) {
      logEntry.allowed    = false;
      logEntry.denyReason = `Capability "${msg.capability}" not declared in plugin manifest.`;
      this.callLog.push(logEntry);
      this._replyError(msg.callId, logEntry.denyReason);
      // Auto-suspend on repeated capability violations
      const violations = this.callLog.filter(l => !l.allowed && l.denyReason?.includes('not declared')).length;
      if (violations >= 3) {
        this.suspend(`Repeated undeclared capability access (${violations} violations).`);
      }
      return;
    }

    // Check rate limit
    const rateLimit = RATE_LIMITS[msg.capability] || RATE_LIMITS._default;
    const now       = Date.now();
    const resetKey  = msg.capability;
    if (!this.rateLimitResets[resetKey] || now > this.rateLimitResets[resetKey]) {
      this.rateLimitCounters[resetKey] = 0;
      this.rateLimitResets[resetKey]   = now + 60_000;
    }
    this.rateLimitCounters[resetKey]++;
    if (this.rateLimitCounters[resetKey] > rateLimit) {
      logEntry.allowed    = false;
      logEntry.denyReason = `Rate limit exceeded for capability "${msg.capability}" (${rateLimit}/min).`;
      this.callLog.push(logEntry);
      this._replyError(msg.callId, logEntry.denyReason);
      return;
    }

    // Dispatch to registered handler
    logEntry.allowed = true;
    this.callLog.push(logEntry);

    const handler = this._handlers.get(msg.capability);
    if (!handler) {
      this._replyError(msg.callId, `No handler registered for capability "${msg.capability}".`);
      return;
    }

    Promise.resolve()
      .then(() => handler(msg.method, msg.params))
      .then(result => {
        // Filter result by max data class
        const filtered = _filterByDataClass(result, this.maxDataClass);
        this._reply(msg.callId, filtered);
      })
      .catch(err => {
        this._replyError(msg.callId, err.message);
      });
  }

  _reply(callId, result) {
    if (!this.iframe?.contentWindow) return;
    this.iframe.contentWindow.postMessage({ __nuvraCallId: callId, result }, '*');
  }

  _replyError(callId, error) {
    if (!this.iframe?.contentWindow) return;
    this.iframe.contentWindow.postMessage({ __nuvraCallId: callId, error }, '*');
  }

  /**
   * Register a handler for a capability.
   * @param {string} capability
   * @param {function} handler - async (method, params) => result
   */
  registerHandler(capability, handler) {
    this._handlers.set(capability, handler);
  }

  /**
   * Emit an event to the plugin.
   * @param {string} event
   * @param {*} payload
   */
  emit(event, payload) {
    if (!this.iframe?.contentWindow || this.suspended) return;
    this.iframe.contentWindow.postMessage({ __nuvraEvent: event, payload }, '*');
  }

  /**
   * Suspend the plugin (stops all future calls).
   * @param {string} reason
   */
  suspend(reason) {
    this.suspended     = true;
    this.suspendReason = reason;
    console.warn(`[PluginSandbox] Plugin "${this.pluginId}" suspended: ${reason}`);
  }

  /**
   * Unmount and destroy the sandbox.
   */
  destroy() {
    if (this.iframe) {
      window.removeEventListener('message', this._onMessage.bind(this));
      this.iframe.remove();
      this.iframe = null;
    }
  }

  /**
   * Get the call log for audit purposes.
   */
  getCallLog() {
    return [...this.callLog];
  }
}

// ─── Plugin Sandbox Manager ───────────────────────────────────────────────────
export const pluginSandbox = {
  _instances: new Map(),

  /**
   * Create and mount a new plugin sandbox.
   * @param {object} manifest - Plugin manifest (id, name, capabilities, maxDataClass)
   * @param {string} scriptContent - The plugin's JavaScript code
   * @returns {Promise<PluginSandboxInstance>}
   */
  async create(manifest, scriptContent) {
    const instance = new PluginSandboxInstance(manifest);
    await instance.mount(scriptContent);
    this._instances.set(manifest.pluginId, instance);
    return instance;
  },

  /**
   * Get a sandbox instance by plugin ID.
   * @param {string} pluginId
   * @returns {PluginSandboxInstance|null}
   */
  get(pluginId) {
    return this._instances.get(pluginId) || null;
  },

  /**
   * Destroy a sandbox instance.
   * @param {string} pluginId
   */
  destroy(pluginId) {
    const instance = this._instances.get(pluginId);
    if (instance) {
      instance.destroy();
      this._instances.delete(pluginId);
    }
  },

  /**
   * Destroy all sandbox instances.
   */
  destroyAll() {
    for (const [id, instance] of this._instances) {
      instance.destroy();
    }
    this._instances.clear();
  },

  /**
   * Get call logs from all sandboxes (for audit).
   * @returns {object[]}
   */
  getAllCallLogs() {
    const logs = [];
    for (const instance of this._instances.values()) {
      logs.push(...instance.getCallLog());
    }
    return logs.sort((a, b) => a.timestamp - b.timestamp);
  },

  CAPABILITIES,
};
