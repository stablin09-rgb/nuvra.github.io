/**
 * Nuvra Builder — Extension Sandbox (Phase 10)
 *
 * Provides a secure, isolated execution environment for extension code.
 *
 * SECURITY MODEL:
 *  Extensions run in a sandboxed iframe with:
 *    - sandbox="allow-scripts" (no allow-same-origin — critical)
 *    - No access to window, document, localStorage, or editor internals
 *    - Communication only via postMessage with a structured protocol
 *    - All API calls are proxied through the ExtensionHost
 *    - Timeouts enforced on all async calls
 *
 * COMMUNICATION PROTOCOL:
 *  Host → Sandbox:  { type: 'init', extensionId, permissions, config }
 *  Host → Sandbox:  { type: 'call', callId, method, args }
 *  Host → Sandbox:  { type: 'event', event, data }
 *  Sandbox → Host:  { type: 'ready', extensionId }
 *  Sandbox → Host:  { type: 'api', callId, method, args }
 *  Sandbox → Host:  { type: 'result', callId, result, error }
 *
 * NOTE: For Phase 10 (local-first), extensions run as ES modules loaded
 * from localStorage bundles. The sandbox uses a blob URL for the iframe src.
 * In Phase 11, extensions will load from the cloud CDN.
 */
'use strict';

const SANDBOX_TIMEOUT_MS = 10_000; // 10 seconds for any API call
const INIT_TIMEOUT_MS    = 5_000;  // 5 seconds for extension init

/**
 * The HTML template injected into the sandbox iframe.
 * The extension bundle is injected as a <script type="module">.
 * The global `nuvra` object is the ONLY API surface available.
 */
const SANDBOX_HTML_TEMPLATE = (extensionId, bundleCode) => `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
<script>
'use strict';
// ── Nuvra Extension API Surface ──────────────────────────────────────────────
// This is the ONLY object available to extension code.
// All calls are proxied to the host via postMessage.

const _pending = new Map();
let   _callId  = 0;

function _call(method, ...args) {
  return new Promise((resolve, reject) => {
    const callId = ++_callId;
    _pending.set(callId, { resolve, reject });
    parent.postMessage({ type: 'api', callId, method, args }, '*');
    setTimeout(() => {
      if (_pending.has(callId)) {
        _pending.delete(callId);
        reject(new Error('Nuvra API timeout: ' + method));
      }
    }, ${SANDBOX_TIMEOUT_MS});
  });
}

// Handle results from host
window.addEventListener('message', (e) => {
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'result' && _pending.has(msg.callId)) {
    const { resolve, reject } = _pending.get(msg.callId);
    _pending.delete(msg.callId);
    if (msg.error) reject(new Error(msg.error));
    else resolve(msg.result);
  }

  if (msg.type === 'event' && window.__nuvraEventHandlers) {
    const handlers = window.__nuvraEventHandlers[msg.event] || [];
    handlers.forEach(h => { try { h(msg.data); } catch(e) { console.error(e); } });
  }
});

// The public Nuvra API for extensions
window.nuvra = Object.freeze({
  // ── Editor API ──────────────────────────────────────────────────────────────
  editor: Object.freeze({
    getHtml:          ()           => _call('editor.getHtml'),
    getCss:           ()           => _call('editor.getCss'),
    addBlock:         (def)        => _call('editor.addBlock', def),
    removeBlock:      (id)         => _call('editor.removeBlock', id),
    addComponent:     (def)        => _call('editor.addComponent', def),
    injectStyle:      (css)        => _call('editor.injectStyle', css),
    getComponents:    ()           => _call('editor.getComponents'),
  }),
  // ── Data API ────────────────────────────────────────────────────────────────
  data: Object.freeze({
    getCollections:   ()           => _call('data.getCollections'),
    getSchema:        (name)       => _call('data.getSchema', name),
    query:            (name, q)    => _call('data.query', name, q),
    insert:           (name, rec)  => _call('data.insert', name, rec),
    update:           (name,id,d)  => _call('data.update', name, id, d),
    remove:           (name, id)   => _call('data.remove', name, id),
    addCollection:    (schema)     => _call('data.addCollection', schema),
  }),
  // ── AI API ──────────────────────────────────────────────────────────────────
  ai: Object.freeze({
    registerPlanner:  (def)        => _call('ai.registerPlanner', def),
    extendPrompt:     (fn)         => {
      // fn is serialised as a string and sent to the host
      _call('ai.extendPrompt', fn.toString());
    },
    registerHook:     (when, fn)   => _call('ai.registerHook', when, fn.toString()),
    generate:         (prompt, o)  => _call('ai.generate', prompt, o),
  }),
  // ── Project API ─────────────────────────────────────────────────────────────
  project: Object.freeze({
    getMeta:          ()           => _call('project.getMeta'),
    getPages:         ()           => _call('project.getPages'),
    addPage:          (name, html) => _call('project.addPage', name, html),
  }),
  // ── Storage API (scoped to this extension) ──────────────────────────────────
  storage: Object.freeze({
    get:              (key)        => _call('storage.get', key),
    set:              (key, val)   => _call('storage.set', key, val),
    remove:           (key)        => _call('storage.remove', key),
  }),
  // ── Network API (declared URLs only) ────────────────────────────────────────
  network: Object.freeze({
    fetch:            (url, opts)  => _call('network.fetch', url, opts),
  }),
  // ── Event API ───────────────────────────────────────────────────────────────
  on: (event, handler) => {
    if (!window.__nuvraEventHandlers) window.__nuvraEventHandlers = {};
    if (!window.__nuvraEventHandlers[event]) window.__nuvraEventHandlers[event] = [];
    window.__nuvraEventHandlers[event].push(handler);
  },
  // ── Extension metadata ───────────────────────────────────────────────────────
  extensionId: '${extensionId}',
});

// Freeze the global to prevent extension from overwriting nuvra
Object.freeze(window.nuvra);
</script>

<script type="module">
// ── Extension Bundle ──────────────────────────────────────────────────────────
// The extension code runs here. It has access ONLY to window.nuvra.
// No window, document, localStorage, or fetch are available directly.
try {
${bundleCode}
  // Signal ready to host
  parent.postMessage({ type: 'ready', extensionId: '${extensionId}' }, '*');
} catch (err) {
  parent.postMessage({ type: 'error', extensionId: '${extensionId}', error: err.message }, '*');
}
</script>
</body>
</html>`;

// ─── Sandbox Class ────────────────────────────────────────────────────────────

export class ExtensionSandbox {
  /**
   * @param {string} extensionId
   * @param {string} bundleCode   - The extension JS code to run
   * @param {object} hostApi      - The host-side API dispatcher
   */
  constructor(extensionId, bundleCode, hostApi) {
    this.extensionId = extensionId;
    this.bundleCode  = bundleCode;
    this.hostApi     = hostApi;
    this._iframe     = null;
    this._ready      = false;
    this._destroyed  = false;
    this._messageHandler = this._onMessage.bind(this);
  }

  /**
   * Create the sandbox iframe and load the extension.
   * @returns {Promise<void>} Resolves when the extension signals ready.
   */
  async mount() {
    return new Promise((resolve, reject) => {
      const html     = SANDBOX_HTML_TEMPLATE(this.extensionId, this.bundleCode);
      const blob     = new Blob([html], { type: 'text/html' });
      const blobUrl  = URL.createObjectURL(blob);

      const iframe   = document.createElement('iframe');
      iframe.sandbox = 'allow-scripts';
      iframe.style.cssText = 'display:none;width:0;height:0;border:none;position:absolute;';
      iframe.src     = blobUrl;

      const timeout = setTimeout(() => {
        reject(new Error(`Extension "${this.extensionId}" failed to initialise within ${INIT_TIMEOUT_MS}ms`));
        this.destroy();
      }, INIT_TIMEOUT_MS);

      window.addEventListener('message', this._messageHandler);

      iframe.onload = () => URL.revokeObjectURL(blobUrl);
      document.body.appendChild(iframe);
      this._iframe = iframe;

      // Override message handler to capture the ready signal
      const originalHandler = this._messageHandler;
      const readyHandler = (e) => {
        const msg = e.data;
        if (!msg || msg.extensionId !== this.extensionId) return;
        if (msg.type === 'ready') {
          clearTimeout(timeout);
          window.removeEventListener('message', readyHandler);
          window.addEventListener('message', originalHandler);
          this._ready = true;
          resolve();
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          window.removeEventListener('message', readyHandler);
          reject(new Error(`Extension "${this.extensionId}" init error: ${msg.error}`));
          this.destroy();
        }
      };
      window.removeEventListener('message', this._messageHandler);
      window.addEventListener('message', readyHandler);
    });
  }

  /**
   * Handle messages from the sandboxed extension.
   * Routes API calls to the hostApi dispatcher.
   */
  async _onMessage(e) {
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.extensionId && msg.extensionId !== this.extensionId) return;
    if (this._destroyed) return;

    if (msg.type === 'api') {
      const { callId, method, args } = msg;
      try {
        const result = await this.hostApi.dispatch(method, args, this.extensionId);
        this._postToSandbox({ type: 'result', callId, result });
      } catch (err) {
        this._postToSandbox({ type: 'result', callId, error: err.message });
      }
    }
  }

  /**
   * Send a message to the sandboxed extension.
   */
  _postToSandbox(msg) {
    if (this._iframe?.contentWindow && !this._destroyed) {
      this._iframe.contentWindow.postMessage(msg, '*');
    }
  }

  /**
   * Dispatch an event to the extension (e.g., 'project.changed').
   */
  dispatchEvent(event, data) {
    this._postToSandbox({ type: 'event', event, data });
  }

  /**
   * Destroy the sandbox — removes the iframe and cleans up listeners.
   */
  destroy() {
    this._destroyed = true;
    this._ready     = false;
    window.removeEventListener('message', this._messageHandler);
    if (this._iframe) {
      this._iframe.remove();
      this._iframe = null;
    }
  }

  get isReady() { return this._ready; }
}
