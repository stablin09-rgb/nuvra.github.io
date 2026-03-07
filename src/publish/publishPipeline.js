/**
 * publishPipeline.js — Nuvra Phase 4
 *
 * The Publish Pipeline — Compilation Engine.
 *
 * Publishing is compilation, not export.
 *
 * The pipeline takes an AppSchema and produces a complete, self-contained
 * output package. The output is identical to what Preview Mode runs.
 *
 * Pipeline stages:
 *  1. VALIDATE    — Validate the schema and all referenced resources
 *  2. SNAPSHOT    — Create a data/state snapshot (optional, for seeded apps)
 *  3. MANIFEST    — Generate the nuvra.manifest.json
 *  4. RENDER      — Invoke the UnifiedRenderer to produce HTML/CSS/JS
 *  5. ASSEMBLE    — Assemble the output package (files map)
 *  6. TARGET      — Apply target-specific wrapper (ZIP, Blob URL, etc.)
 *  7. COMPLETE    — Emit completion event with the output package
 *
 * @module publish/publishPipeline
 */
'use strict';

import { unifiedRenderer }  from '../renderer/unifiedRenderer.js';
import { snapshotEngine }   from '../snapshot/snapshotEngine.js';
import { RenderTarget }     from '../renderer/renderTarget.js';
import { manifestGenerator } from '../manifest/manifestGenerator.js';
import { eventBus }         from '../runtime/eventBus.js';
import { store }            from '../state/store.js';
import { logger }           from '../diagnostics/logger.js';
import { errorBoundary, ErrorSeverity } from '../diagnostics/errorBoundary.js';

// ─── Pipeline Stages ───────────────────────────────────────────────────────────
export const PipelineStage = Object.freeze({
  IDLE:      'idle',
  VALIDATE:  'validate',
  SNAPSHOT:  'snapshot',
  MANIFEST:  'manifest',
  RENDER:    'render',
  ASSEMBLE:  'assemble',
  TARGET:    'target',
  COMPLETE:  'complete',
  ERROR:     'error',
});

// ─── PublishPipeline ───────────────────────────────────────────────────────────
export class PublishPipeline {
  constructor() {
    this._name  = 'PublishPipeline';
    this._stage = PipelineStage.IDLE;
    this._log   = [];
  }

  /**
   * Run the publish pipeline.
   *
   * @param {object} opts
   * @param {object}  opts.appSchema    - The AppSchema to publish
   * @param {string}  opts.target       - RenderTarget ID
   * @param {object}  [opts.snapshot]   - Optional pre-built snapshot
   * @param {boolean} [opts.embedData]  - Whether to embed seed data in the output (default: true)
   * @param {object}  [opts.config]     - Build configuration overrides
   * @returns {Promise<PublishResult>}
   */
  async run(opts = {}) {
    const {
      appSchema,
      target     = RenderTarget.STATIC_SITE,
      snapshot   = null,
      embedData  = true,
      config     = {},
    } = opts;

    this._log = [];
    this._stage = PipelineStage.IDLE;

    try {
      // ── Stage 1: Validate ────────────────────────────────────────────────────
      this._advance(PipelineStage.VALIDATE);
      const validation = this._validate(appSchema, target);
      if (!validation.ok) {
        return this._fail(validation.error);
      }
      this._log.push(`Validation passed (${appSchema.pages?.length || 0} pages, ${appSchema.collections?.length || 0} collections)`);

      // ── Stage 2: Snapshot ────────────────────────────────────────────────────
      this._advance(PipelineStage.SNAPSHOT);
      const snap = embedData
        ? (snapshot || snapshotEngine.createFromSchema(appSchema))
        : null;
      this._log.push(snap
        ? `Snapshot created (${Object.keys(snap.data || {}).length} collections)`
        : 'Snapshot skipped (embedData=false)');

      // ── Stage 3: Manifest ────────────────────────────────────────────────────
      this._advance(PipelineStage.MANIFEST);
      const manifest = manifestGenerator.generate({ appSchema, target, config });
      this._log.push(`Manifest generated (${manifest.pages.length} pages)`);

      // ── Stage 4: Render ──────────────────────────────────────────────────────
      this._advance(PipelineStage.RENDER);
      const renderResult = unifiedRenderer.render({
        appSchema,
        snapshot:  snap,
        target,
        config: {
          title:   config.title   || appSchema.name,
          version: config.version || appSchema.version || '1.0.0',
          debug:   config.debug   || false,
          ...config,
        },
      });

      if (!renderResult.ok) {
        return this._fail('Render failed: ' + renderResult.error);
      }
      this._log.push(`Render complete (HTML: ${renderResult.html.length} chars, JS: ${renderResult.js.length} chars)`);

      // ── Stage 5: Assemble ────────────────────────────────────────────────────
      this._advance(PipelineStage.ASSEMBLE);
      const files = this._assemble({ renderResult, manifest, snap, appSchema });
      this._log.push(`Assembled ${Object.keys(files).length} files`);

      // ── Stage 6: Target ──────────────────────────────────────────────────────
      this._advance(PipelineStage.TARGET);
      const output = await this._applyTarget({ files, target, appSchema });
      this._log.push(`Target "${target}" applied`);

      // ── Stage 7: Complete ────────────────────────────────────────────────────
      this._advance(PipelineStage.COMPLETE);

      const result = {
        ok:       true,
        target,
        appId:    appSchema.id,
        appName:  appSchema.name,
        files,
        output,
        manifest,
        renderMeta: renderResult.meta,
        buildLog:   [...this._log],
        builtAt:    Date.now(),
      };

      store.dispatch({ type: 'PUBLISH/SET_RESULT', payload: result });
      eventBus.emit('publish:complete', result);
      logger.info('PublishPipeline', `Build complete for "${appSchema.name}" → ${target}`);

      return result;

    } catch (err) {
      errorBoundary.capture(err, {
        module:   'PublishPipeline',
        context:  this._stage,
        severity: ErrorSeverity.HIGH,
      });
      return this._fail(err.message);
    }
  }

  /**
   * Get the current pipeline stage.
   * @returns {string}
   */
  getStage() { return this._stage; }

  /**
   * Get the build log from the last run.
   * @returns {string[]}
   */
  getBuildLog() { return [...this._log]; }

  // ─── Private ─────────────────────────────────────────────────────────────────

  _validate(appSchema, target) {
    if (!appSchema)         return { ok: false, error: 'appSchema is required' };
    if (!appSchema.id)      return { ok: false, error: 'appSchema.id is required' };
    if (!appSchema.name)    return { ok: false, error: 'appSchema.name is required' };
    if (!appSchema.pages?.length) return { ok: false, error: 'appSchema must have at least one page' };
    if (!Object.values(RenderTarget).includes(target)) {
      return { ok: false, error: `Unknown render target: "${target}"` };
    }
    return { ok: true };
  }

  _assemble({ renderResult, manifest, snap, appSchema }) {
    const files = {};

    // Main HTML entry point
    files['index.html'] = renderResult.html;

    // Separate CSS file (for reference; also inlined in HTML)
    files['nuvra-runtime.css'] = renderResult.css;

    // Separate JS file (for reference; also inlined in HTML)
    files['nuvra-runtime.js'] = renderResult.js;

    // Manifest
    files['nuvra.manifest.json'] = JSON.stringify(manifest, null, 2);

    // Snapshot (if embedded)
    if (snap) {
      files['nuvra.snapshot.json'] = JSON.stringify(snap, null, 2);
    }

    // README
    files['README.md'] = this._generateReadme(appSchema, manifest);

    return files;
  }

  async _applyTarget({ files, target, appSchema }) {
    switch (target) {
      case RenderTarget.STATIC_SITE:
      case RenderTarget.APP_READY:
        // In a browser environment, produce a Blob URL for the ZIP.
        // In a Node.js environment (tests), return the files map directly.
        return { type: 'files', files };

      case RenderTarget.LIVE_PREVIEW: {
        // Produce a Blob URL for instant in-browser preview
        const html = files['index.html'];
        if (typeof Blob !== 'undefined') {
          const blob = new Blob([html], { type: 'text/html' });
          return { type: 'blob_url', url: URL.createObjectURL(blob) };
        }
        return { type: 'html', html };
      }

      case RenderTarget.PREVIEW:
        return { type: 'html', html: files['index.html'] };

      default:
        return { type: 'files', files };
    }
  }

  _generateReadme(appSchema, manifest) {
    return `# ${appSchema.name}

Built with [Nuvra](https://nuvra.io) — v4

## About

${appSchema.description || 'A Nuvra application.'}

## Pages

${manifest.pages.map(p => `- **${p.name}** (\`${p.slug}\`) — ${p.mode} page`).join('\n')}

## Collections

${manifest.collections.map(c => `- **${c.name}** (\`${c.id}\`) — ${c.fieldCount} fields`).join('\n') || 'None'}

## Hosting

This is a self-contained static site. Drop \`index.html\` and the accompanying files
into any static host (Netlify, Vercel, GitHub Pages, S3, etc.) and it will work.

No server required. No build step required.

## Build Info

- **App ID:** \`${appSchema.id}\`
- **Version:** \`${appSchema.version || '1.0.0'}\`
- **Built at:** ${new Date(manifest.builtAt).toISOString()}
- **Nuvra Runtime:** v4
`;
  }

  _advance(stage) {
    this._stage = stage;
    store.dispatch({ type: 'PUBLISH/SET_STAGE', payload: stage });
    eventBus.emit('publish:stage', { stage });
    logger.info('PublishPipeline', `Stage: ${stage}`);
  }

  _fail(error) {
    this._stage = PipelineStage.ERROR;
    store.dispatch({ type: 'PUBLISH/SET_ERROR', payload: error });
    eventBus.emit('publish:error', { error });
    logger.error('PublishPipeline', error);
    return { ok: false, error, buildLog: [...this._log] };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────
export const publishPipeline = new PublishPipeline();
export default publishPipeline;
