/**
 * Nuvra Builder — Extension Editor API (Phase 10)
 *
 * The scoped editor API surface available to extensions.
 * All calls from the sandbox are routed through this module.
 *
 * SECURITY: This module receives the GrapesJS editor instance
 * from the host (app.js). Extensions never get a direct reference
 * to the editor — only the results of these controlled operations.
 */
'use strict';

import { hasPermission } from '../permissions.js';

let _editor = null;
const _injectedStyles = new Map(); // extensionId → Set<styleId>

/**
 * Set the GrapesJS editor instance.
 * Called once by app.js after editor initialisation.
 */
export function setEditor(editorInstance) {
  _editor = editorInstance;
}

/**
 * Dispatch an editor API call from an extension.
 * @param {string}   method       - The API method name (e.g., 'editor.getHtml')
 * @param {any[]}    args         - Arguments from the sandbox
 * @param {string}   extensionId  - The calling extension's ID
 * @param {string[]} permissions  - The extension's approved permissions
 * @returns {Promise<any>}
 */
export async function dispatchEditorCall(method, args, extensionId, permissions) {
  if (!_editor) throw new Error('Editor not initialised');

  switch (method) {
    case 'editor.getHtml': {
      _requirePermission(permissions, 'editor.read', method);
      return _editor.getHtml();
    }

    case 'editor.getCss': {
      _requirePermission(permissions, 'editor.read', method);
      return _editor.getCss();
    }

    case 'editor.getComponents': {
      _requirePermission(permissions, 'editor.read', method);
      // Return a safe, serialisable representation
      return _editor.getComponents().map(c => ({
        id:      c.getId(),
        type:    c.get('type'),
        tagName: c.get('tagName'),
      }));
    }

    case 'editor.addBlock': {
      _requirePermission(permissions, 'editor.blocks.add', method);
      const [blockDef] = args;
      _validateBlockDef(blockDef);
      // Namespace the block ID to avoid conflicts
      const scopedId = `ext-${extensionId}-${blockDef.id}`;
      _editor.BlockManager.add(scopedId, {
        label:    blockDef.label    || 'Extension Block',
        category: blockDef.category || `Extension: ${extensionId}`,
        media:    blockDef.media    || '',
        content:  blockDef.content  || '<div>Extension Block</div>',
        attributes: { class: 'nuvra-block nuvra-ext-block', 'data-ext': extensionId },
      });
      return { id: scopedId };
    }

    case 'editor.removeBlock': {
      _requirePermission(permissions, 'editor.blocks.remove', method);
      const [blockId] = args;
      // Extensions can only remove their own blocks
      const scopedId = `ext-${extensionId}-${blockId}`;
      _editor.BlockManager.remove(scopedId);
      return true;
    }

    case 'editor.addComponent': {
      _requirePermission(permissions, 'editor.components.add', method);
      const [compDef] = args;
      _validateComponentDef(compDef);
      const scopedType = `ext-${extensionId}-${compDef.type}`;
      _editor.DomComponents.addType(scopedType, {
        isComponent: compDef.isComponent || (() => false),
        model: {
          defaults: {
            tagName:    compDef.tagName    || 'div',
            attributes: compDef.attributes || {},
            components:  compDef.components || compDef.content || '',
            styles:     compDef.styles     || '',
          },
        },
        view: {},
      });
      return { type: scopedType };
    }

    case 'editor.injectStyle': {
      _requirePermission(permissions, 'editor.styles.inject', method);
      const [css] = args;
      if (typeof css !== 'string') throw new Error('CSS must be a string');
      if (css.length > 50_000) throw new Error('CSS too large (max 50KB)');
      // Inject into the editor canvas document
      const canvasDoc = _editor.Canvas.getDocument();
      if (canvasDoc) {
        const styleId = `nuvra-ext-style-${extensionId}`;
        let el = canvasDoc.getElementById(styleId);
        if (!el) {
          el = canvasDoc.createElement('style');
          el.id = styleId;
          canvasDoc.head.appendChild(el);
        }
        el.textContent = css;
      }
      return true;
    }

    default:
      throw new Error(`Unknown editor API method: ${method}`);
  }
}

/**
 * Remove all blocks and styles registered by an extension.
 * Called on extension disable or uninstall.
 */
export function cleanupExtension(extensionId) {
  if (!_editor) return;
  // Remove all blocks with this extension's prefix
  const allBlocks = _editor.BlockManager.getAll();
  allBlocks.forEach(block => {
    if (block.id.startsWith(`ext-${extensionId}-`)) {
      _editor.BlockManager.remove(block.id);
    }
  });
  // Remove injected styles from canvas
  const canvasDoc = _editor.Canvas.getDocument();
  if (canvasDoc) {
    const styleEl = canvasDoc.getElementById(`nuvra-ext-style-${extensionId}`);
    if (styleEl) styleEl.remove();
  }
}

// ─── Validators ───────────────────────────────────────────────────────────────

function _requirePermission(permissions, required, method) {
  if (!hasPermission(permissions, required)) {
    throw new Error(`Permission denied: "${required}" required for ${method}`);
  }
}

function _validateBlockDef(def) {
  if (!def || typeof def !== 'object') throw new Error('Block definition must be an object');
  if (!def.id || typeof def.id !== 'string') throw new Error('Block must have a string id');
  if (!def.content || typeof def.content !== 'string') throw new Error('Block must have string content');
  if (def.content.length > 100_000) throw new Error('Block content too large (max 100KB)');
  // Prevent script injection
  if (/<script/i.test(def.content)) throw new Error('Block content must not contain <script> tags');
}

function _validateComponentDef(def) {
  if (!def || typeof def !== 'object') throw new Error('Component definition must be an object');
  if (!def.type || typeof def.type !== 'string') throw new Error('Component must have a string type');
}
