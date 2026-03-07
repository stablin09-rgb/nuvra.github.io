/**
 * Nuvra — packRuntime.js (Phase 13)
 *
 * Manages the lifecycle of active Design AI Packs within the editor.
 *
 * Responsibilities:
 *  - Load, activate, deactivate, and remove packs per project
 *  - Inject pack CSS into the editor and preview iframes
 *  - Register pack section blueprints with the GrapesJS block library
 *  - Provide the active pack context to the AI engine
 *  - Enforce pack isolation: packs cannot access each other's state
 *  - Respect org policies: blocked packs are not activated
 *
 * Pack Isolation Model:
 *  - Each pack's CSS is scoped with a [data-pack-id] attribute
 *  - Packs cannot modify the DOM directly (no script execution)
 *  - Pack AI extensions are merged, not replaced (composable)
 *  - Pack removal is non-destructive: project content is preserved
 *
 * @module packRuntime
 */
'use strict';

import { packSDK } from './packSDK.js';

const STORAGE_KEY = (projectId) => `nuvra-active-packs-${projectId}`;

// ─── PackRuntime ──────────────────────────────────────────────────────────────

class PackRuntime {
  constructor() {
    this._projectId   = null;
    this._editor      = null;
    this._activePacks = new Map(); // packId → { manifest, css, blueprints, aiExtension }
    this._styleEl     = null;
    this._listeners   = new Set();
  }

  // ─── Initialization ──────────────────────────────────────────────────────────

  /**
   * Initialize the pack runtime for a project.
   *
   * @param {object} opts
   * @param {string}   opts.projectId
   * @param {object}   opts.editor     - GrapesJS editor instance
   * @param {object[]} [opts.policies] - Active org policies (for pack blocking)
   */
  init({ projectId, editor, policies = [] }) {
    this._projectId = projectId;
    this._editor    = editor;
    this._policies  = policies;
    this._activePacks.clear();

    // Create a dedicated <style> element for pack CSS
    if (this._styleEl) this._styleEl.remove();
    this._styleEl = document.createElement('style');
    this._styleEl.id = 'nuvra-pack-styles';
    document.head.appendChild(this._styleEl);

    // Restore previously active packs for this project
    this._restoreActivePacks();
  }

  // ─── Pack Activation ─────────────────────────────────────────────────────────

  /**
   * Activate a pack for the current project.
   *
   * @param {object} manifest - A validated pack manifest
   * @returns {{ ok: boolean, error?: string }}
   */
  activate(manifest) {
    const { valid, errors } = packSDK.validate(manifest);
    if (!valid) {
      return { ok: false, error: `Invalid pack manifest: ${errors.join(', ')}` };
    }

    if (this._isPolicyBlocked(manifest.id)) {
      return { ok: false, error: `Pack "${manifest.name}" is blocked by organizational policy.` };
    }

    if (this._activePacks.has(manifest.id)) {
      return { ok: true }; // Already active
    }

    // Generate CSS from design tokens
    const css = packSDK.generateCSS(manifest);

    // Get section blueprints
    const blueprints = packSDK.getSectionBlueprints(manifest);

    // Get AI extension
    const aiExtension = packSDK.getAIExtension(manifest);

    // Store in active packs
    this._activePacks.set(manifest.id, { manifest, css, blueprints, aiExtension });

    // Inject CSS into the document
    this._rebuildPackStyles();

    // Register blocks with GrapesJS
    this._registerBlocks(manifest.id, blueprints);

    // Persist active pack list
    this._persistActivePacks();

    this._emit('pack:activated', { packId: manifest.id, packName: manifest.name });
    return { ok: true };
  }

  /**
   * Deactivate a pack (non-destructive: project content is preserved).
   */
  deactivate(packId) {
    if (!this._activePacks.has(packId)) return { ok: true };

    const { manifest, blueprints } = this._activePacks.get(packId);

    // Remove GrapesJS blocks for this pack
    this._unregisterBlocks(packId, blueprints);

    // Remove from active packs
    this._activePacks.delete(packId);

    // Rebuild CSS (removes this pack's tokens)
    this._rebuildPackStyles();

    // Persist
    this._persistActivePacks();

    this._emit('pack:deactivated', { packId, packName: manifest.name });
    return { ok: true };
  }

  // ─── Queries ─────────────────────────────────────────────────────────────────

  getActivePacks() {
    return Array.from(this._activePacks.values()).map(p => packSDK.getSummary(p.manifest));
  }

  getActivePackIds() {
    return Array.from(this._activePacks.keys());
  }

  isActive(packId) {
    return this._activePacks.has(packId);
  }

  /**
   * Get the merged AI extension context for all active packs.
   * This is what gets injected into the AI system prompt.
   */
  getMergedAIContext() {
    const extensions = Array.from(this._activePacks.values()).map(p => p.aiExtension);
    if (extensions.length === 0) return null;

    // Merge all extensions: system prompts are concatenated, arrays are merged
    return {
      packCount:      extensions.length,
      packNames:      extensions.map(e => e.packName),
      systemPrompts:  extensions.map(e => e.systemPrompt).filter(Boolean),
      toneModifiers:  extensions.flatMap(e => e.toneModifiers),
      layoutRules:    extensions.flatMap(e => e.layoutRules),
      colorRules:     extensions.flatMap(e => e.colorRules),
      typographyRules: extensions.flatMap(e => e.typographyRules),
      contentRules:   extensions.flatMap(e => e.contentRules),
      sectionOrders:  extensions.map(e => e.sectionOrder).filter(a => a.length > 0),
      constraints:    Object.assign({}, ...extensions.map(e => e.constraints)),
      forbiddenPatterns: extensions.flatMap(e => e.forbiddenPatterns),
    };
  }

  /**
   * Get the combined CSS for all active packs.
   * Used by the deploy pipeline to inject pack styles into published pages.
   */
  getCombinedCSS() {
    return Array.from(this._activePacks.values())
      .map(p => `/* Pack: ${p.manifest.name} (${p.manifest.id}) */\n${p.css}`)
      .join('\n\n');
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  _rebuildPackStyles() {
    if (!this._styleEl) return;
    const allCSS = Array.from(this._activePacks.values()).map(p => p.css).join('\n\n');
    this._styleEl.textContent = allCSS;

    // Also inject into the GrapesJS canvas iframe
    if (this._editor) {
      try {
        const iframe = this._editor.Canvas.getFrameEl();
        if (iframe && iframe.contentDocument) {
          let packStyle = iframe.contentDocument.getElementById('nuvra-pack-styles');
          if (!packStyle) {
            packStyle = iframe.contentDocument.createElement('style');
            packStyle.id = 'nuvra-pack-styles';
            iframe.contentDocument.head.appendChild(packStyle);
          }
          packStyle.textContent = allCSS;
        }
      } catch { /* Canvas not ready */ }
    }
  }

  _registerBlocks(packId, blueprints) {
    if (!this._editor) return;
    const bm = this._editor.BlockManager;
    for (const bp of blueprints) {
      try {
        bm.add(bp.id, {
          label:    bp.name,
          category: `Pack: ${this._activePacks.get(packId)?.manifest.name || packId}`,
          content:  { type: 'text', content: bp.html || `<section class="pack-section">${bp.name}</section>` },
          attributes: { class: 'fa fa-puzzle-piece' },
        });
      } catch { /* Block already registered */ }
    }
  }

  _unregisterBlocks(packId, blueprints) {
    if (!this._editor) return;
    const bm = this._editor.BlockManager;
    for (const bp of blueprints) {
      try { bm.remove(bp.id); } catch { /* Already removed */ }
    }
  }

  _isPolicyBlocked(packId) {
    // Check org policies for blocked packs
    return this._policies.some(p =>
      p.effect === 'deny' &&
      p.action === 'pack.activate' &&
      (p.resource === packId || p.resource === '*')
    );
  }

  _persistActivePacks() {
    try {
      const ids = Array.from(this._activePacks.keys());
      localStorage.setItem(STORAGE_KEY(this._projectId), JSON.stringify(ids));
    } catch { /* Storage full */ }
  }

  _restoreActivePacks() {
    // Active pack IDs are restored; manifests are loaded from the asset registry
    // This is a lightweight restore — full manifest loading happens via packManager
    try {
      const ids = JSON.parse(localStorage.getItem(STORAGE_KEY(this._projectId)) || '[]');
      this._pendingRestoreIds = ids; // Resolved by packManager.restoreActivePacks()
    } catch {
      this._pendingRestoreIds = [];
    }
  }

  getPendingRestoreIds() {
    return this._pendingRestoreIds || [];
  }

  // ─── Event System ────────────────────────────────────────────────────────────

  on(event, fn)  { this._listeners.add({ event, fn }); return this; }
  off(event, fn) { this._listeners.forEach(l => { if (l.event === event && l.fn === fn) this._listeners.delete(l); }); }
  _emit(event, data) { this._listeners.forEach(l => { if (l.event === event) l.fn(data); }); }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const packRuntime = new PackRuntime();
