/**
 * renderTarget.js — Nuvra Phase 4
 *
 * Canonical Render Target definitions.
 *
 * The Unified Runtime Renderer produces the same output for all targets.
 * The target only determines the *wrapper* around the compiled output,
 * not the output itself.
 *
 * Targets:
 *
 *  PREVIEW      — Renders into a sandboxed iframe within the editor.
 *                 State is isolated. Mutations do not affect the editor.
 *                 This is real execution, not a mock.
 *
 *  STATIC_SITE  — Produces a ZIP of clean HTML/CSS/JS files.
 *                 No editor code. No Nuvra branding. Self-contained.
 *                 Can be hosted on any static host (Netlify, S3, GitHub Pages).
 *
 *  LIVE_PREVIEW — Produces a Blob URL for instant in-browser preview.
 *                 Same output as STATIC_SITE, served from memory.
 *
 *  APP_READY    — Produces the same bundle as STATIC_SITE, flagged for
 *                 mobile wrapping (Capacitor, React Native Web, etc.).
 *                 Includes a `nuvra.manifest.json` with mobile metadata.
 *
 *  CLOUD_HOST   — (Future) Produces a deployment package for Nuvra Cloud.
 *
 * @module renderer/renderTarget
 */
'use strict';

export const RenderTarget = Object.freeze({
  PREVIEW:      'preview',
  STATIC_SITE:  'static_site',
  LIVE_PREVIEW: 'live_preview',
  APP_READY:    'app_ready',
  CLOUD_HOST:   'cloud_host', // Future
});

export const RENDER_TARGET_DEFINITIONS = {
  [RenderTarget.PREVIEW]: {
    id:            RenderTarget.PREVIEW,
    label:         'Preview',
    description:   'Sandboxed execution inside the editor. Real runtime, isolated state.',
    outputFormat:  'dom',        // renders into a DOM element (iframe)
    includesEditor: false,
    includesManifest: false,
    mobileReady:   false,
    cloudReady:    false,
  },
  [RenderTarget.STATIC_SITE]: {
    id:            RenderTarget.STATIC_SITE,
    label:         'Static Site (ZIP)',
    description:   'Clean HTML/CSS/JS ZIP. Host anywhere.',
    outputFormat:  'zip',
    includesEditor: false,
    includesManifest: true,
    mobileReady:   false,
    cloudReady:    true,
  },
  [RenderTarget.LIVE_PREVIEW]: {
    id:            RenderTarget.LIVE_PREVIEW,
    label:         'Live Preview (Blob URL)',
    description:   'Instant in-browser preview via Blob URL.',
    outputFormat:  'blob_url',
    includesEditor: false,
    includesManifest: false,
    mobileReady:   false,
    cloudReady:    false,
  },
  [RenderTarget.APP_READY]: {
    id:            RenderTarget.APP_READY,
    label:         'App-Ready Output',
    description:   'Bundle flagged for mobile wrapping (Capacitor, etc.).',
    outputFormat:  'zip',
    includesEditor: false,
    includesManifest: true,
    mobileReady:   true,
    cloudReady:    true,
  },
  [RenderTarget.CLOUD_HOST]: {
    id:            RenderTarget.CLOUD_HOST,
    label:         'Nuvra Cloud (Future)',
    description:   'Deployment package for Nuvra Cloud hosting.',
    outputFormat:  'cloud_package',
    includesEditor: false,
    includesManifest: true,
    mobileReady:   true,
    cloudReady:    true,
  },
};

/**
 * Get the definition for a render target.
 * @param {string} targetId
 * @returns {object|null}
 */
export function getRenderTargetDef(targetId) {
  return RENDER_TARGET_DEFINITIONS[targetId] || null;
}

export default RenderTarget;
