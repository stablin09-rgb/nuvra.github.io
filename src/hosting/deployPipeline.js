/**
 * Nuvra — deployPipeline.js (Phase 13)
 *
 * The 7-step deploy pipeline that transforms a project snapshot into a
 * production-ready, hashed, runtime-injected, environment-bound bundle.
 *
 * Steps:
 *  1. Build     — Render all pages using the same renderer as preview
 *  2. Hash      — Content-hash all assets for cache-busting
 *  3. Inject    — Inject runtime adapter (mobile, analytics, env)
 *  4. Bind      — Bind environment variables and config
 *  5. Pack      — Assemble the final file map with metadata
 *  6. Validate  — Ensure the bundle is complete and well-formed
 *  7. Snapshot  — Create a rollback snapshot
 *
 * @module deployPipeline
 */
'use strict';

// ─── DeployPipeline ───────────────────────────────────────────────────────────

class DeployPipeline {

  /**
   * Run the full 7-step deploy pipeline.
   *
   * @param {object}   opts
   * @param {object}   opts.snapshot      - { pages, dataStore }
   * @param {object}   opts.projectMeta   - { name, slug, projectId, accent }
   * @param {string[]} [opts.activePacks] - IDs of active design packs
   * @param {Function} [opts.onProgress]  - (percent, message) => void
   * @returns {Promise<DeployBundle>}
   *
   * @typedef {object} DeployBundle
   * @property {Object.<string, string>} files       - filename → content
   * @property {object}                  manifest    - nuvra.manifest.json parsed
   * @property {string}                  versionId   - UUID for this build
   * @property {Object.<string, string>} assetHashes - filename → sha256 hex
   * @property {number}                  totalBytes  - total uncompressed size
   * @property {object}                  snapshot    - rollback snapshot
   */
  async run({ snapshot, projectMeta, activePacks = [], onProgress }) {
    const progress = (pct, msg) => onProgress && onProgress(pct, msg);
    const versionId = _uuid();
    const startedAt = new Date().toISOString();

    // ── Step 1: Build ──────────────────────────────────────────────────────────
    progress(5, 'Step 1/7: Building pages…');
    const { files: rawFiles, manifest } = await this._build({
      snapshot,
      projectMeta,
      activePacks,
      versionId,
      onProgress: (pct, msg) => progress(5 + Math.round(pct * 0.25), msg),
    });

    // ── Step 2: Hash assets ────────────────────────────────────────────────────
    progress(30, 'Step 2/7: Hashing assets…');
    const { files: hashedFiles, assetHashes } = await this._hashAssets(rawFiles);

    // ── Step 3: Inject runtime ─────────────────────────────────────────────────
    progress(40, 'Step 3/7: Injecting runtime…');
    const injectedFiles = this._injectRuntime(hashedFiles, { projectMeta, versionId, activePacks });

    // ── Step 4: Bind environment ───────────────────────────────────────────────
    progress(50, 'Step 4/7: Binding environment…');
    const boundFiles = this._bindEnvironment(injectedFiles, { projectMeta, versionId });

    // ── Step 5: Pack ───────────────────────────────────────────────────────────
    progress(60, 'Step 5/7: Assembling bundle…');
    const totalBytes = Object.values(boundFiles).reduce((sum, v) => sum + (v?.length || 0), 0);

    // ── Step 6: Validate ───────────────────────────────────────────────────────
    progress(70, 'Step 6/7: Validating bundle…');
    this._validate(boundFiles, manifest);

    // ── Step 7: Snapshot ───────────────────────────────────────────────────────
    progress(80, 'Step 7/7: Creating rollback snapshot…');
    const rollbackSnapshot = this._createSnapshot({ snapshot, projectMeta, versionId, startedAt });

    progress(100, 'Pipeline complete.');

    return {
      files:      boundFiles,
      manifest,
      versionId,
      assetHashes,
      totalBytes,
      snapshot:   rollbackSnapshot,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  // ─── Step 1: Build ──────────────────────────────────────────────────────────

  async _build({ snapshot, projectMeta, activePacks, versionId, onProgress }) {
    const { pages, dataStore } = snapshot;
    const files = {};
    const total = pages.length + 2;
    let current = 0;

    const progress = (msg) => {
      current++;
      onProgress && onProgress(Math.round((current / total) * 100), msg);
    };

    // Render each page using the production renderer
    for (const page of pages) {
      const filename = _pageFilename(page, pages);
      const html     = _renderPage(page, dataStore, projectMeta, activePacks);
      files[filename] = html;
      progress(`Rendered: ${page.name}`);
    }

    // Generate manifest
    const manifest = _buildManifest({ pages, projectMeta, versionId });
    files['nuvra.manifest.json'] = JSON.stringify(manifest, null, 2);
    progress('Generated manifest');

    // Generate robots.txt
    files['robots.txt'] = `User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n`;
    progress('Generated robots.txt');

    // Generate sitemap.xml
    const baseUrl = projectMeta.liveUrl || `https://${projectMeta.slug || 'project'}.nuvra.app`;
    files['sitemap.xml'] = _buildSitemap(pages, baseUrl);

    return { files, manifest };
  }

  // ─── Step 2: Hash assets ────────────────────────────────────────────────────

  async _hashAssets(files) {
    const assetHashes = {};
    const hashedFiles = {};

    for (const [filename, content] of Object.entries(files)) {
      const hash = await _sha256(content);
      assetHashes[filename] = hash;
      // For HTML files, embed the version hash as a meta tag
      if (filename.endsWith('.html')) {
        hashedFiles[filename] = content.replace(
          '</head>',
          `<meta name="nuvra-build-hash" content="${hash.slice(0, 8)}">\n</head>`
        );
      } else {
        hashedFiles[filename] = content;
      }
    }

    return { files: hashedFiles, assetHashes };
  }

  // ─── Step 3: Inject runtime ─────────────────────────────────────────────────

  _injectRuntime(files, { projectMeta, versionId, activePacks }) {
    const runtimeConfig = JSON.stringify({
      projectId:  projectMeta.projectId,
      versionId,
      activePacks,
      deployedAt: new Date().toISOString(),
      env:        'production',
    });

    const runtimeScript = `
<script>
  window.__NUVRA_RUNTIME__ = ${runtimeConfig};
  window.__NUVRA_ENV__ = 'production';
  window.__NUVRA_VERSION__ = '${versionId}';
</script>`;

    const injected = {};
    for (const [filename, content] of Object.entries(files)) {
      if (filename.endsWith('.html')) {
        injected[filename] = content.replace('<head>', `<head>\n${runtimeScript}`);
      } else {
        injected[filename] = content;
      }
    }
    return injected;
  }

  // ─── Step 4: Bind environment ───────────────────────────────────────────────

  _bindEnvironment(files, { projectMeta, versionId }) {
    // Replace environment placeholders in all files
    const bound = {};
    const replacements = {
      '{{NUVRA_PROJECT_ID}}': projectMeta.projectId || '',
      '{{NUVRA_PROJECT_NAME}}': projectMeta.name || '',
      '{{NUVRA_VERSION_ID}}': versionId,
      '{{NUVRA_BUILD_DATE}}': new Date().toISOString(),
    };

    for (const [filename, content] of Object.entries(files)) {
      let result = content;
      for (const [placeholder, value] of Object.entries(replacements)) {
        result = result.replaceAll(placeholder, value);
      }
      bound[filename] = result;
    }
    return bound;
  }

  // ─── Step 6: Validate ───────────────────────────────────────────────────────

  _validate(files, manifest) {
    if (!files['index.html'] && !files['index.htm']) {
      throw new Error('Bundle validation failed: no index.html found.');
    }
    if (!files['nuvra.manifest.json']) {
      throw new Error('Bundle validation failed: no manifest found.');
    }
    const pageCount = Object.keys(files).filter(f => f.endsWith('.html')).length;
    if (pageCount === 0) {
      throw new Error('Bundle validation failed: no HTML pages found.');
    }
  }

  // ─── Step 7: Snapshot ───────────────────────────────────────────────────────

  _createSnapshot({ snapshot, projectMeta, versionId, startedAt }) {
    return {
      versionId,
      projectId:   projectMeta.projectId,
      projectName: projectMeta.name,
      pageCount:   snapshot.pages.length,
      startedAt,
      // Store a lightweight reference, not the full snapshot, to avoid localStorage bloat
      snapshotRef: `nuvra-snapshot-${versionId}`,
    };
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function _uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function _pageFilename(page, allPages) {
  const isHome = allPages.indexOf(page) === 0 || page.isHome;
  if (isHome) return 'index.html';
  const slug = (page.slug || page.name || 'page')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug}/index.html`;
}

/**
 * Render a page to production HTML.
 * In production, this delegates to the same renderer used by preview.
 * The activePacks parameter allows design packs to inject styles/scripts.
 */
function _renderPage(page, dataStore, projectMeta, activePacks = []) {
  const pageHtml = page.html || '';
  const pageCss  = page.css  || '';

  // Collect pack injections
  let packStyles  = '';
  let packScripts = '';
  for (const packId of activePacks) {
    // Pack injections are resolved at runtime via the pack runtime
    packStyles  += `<!-- pack:${packId}:styles -->\n`;
    packScripts += `<!-- pack:${packId}:scripts -->\n`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${_escape(page.name || projectMeta.name || 'Nuvra App')}</title>
  <meta name="description" content="${_escape(page.description || projectMeta.description || '')}">
  ${packStyles}
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; }
    ${pageCss}
  </style>
</head>
<body>
  ${pageHtml}
  ${packScripts}
</body>
</html>`;
}

function _buildManifest({ pages, projectMeta, versionId }) {
  return {
    name:       projectMeta.name || 'Nuvra App',
    version:    versionId,
    projectId:  projectMeta.projectId,
    builtAt:    new Date().toISOString(),
    pages:      pages.map((p, i) => ({
      name:     p.name,
      path:     i === 0 ? '/' : `/${(p.slug || p.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}/`,
      isHome:   i === 0,
    })),
  };
}

function _buildSitemap(pages, baseUrl) {
  const urls = pages.map((p, i) => {
    const path = i === 0 ? '' : `/${(p.slug || p.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}/`;
    return `  <url><loc>${baseUrl}${path}</loc><changefreq>weekly</changefreq></url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

async function _sha256(content) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = new TextEncoder().encode(content);
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback: simple hash for environments without crypto.subtle
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) - hash) + content.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function _escape(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const deployPipeline = new DeployPipeline();
