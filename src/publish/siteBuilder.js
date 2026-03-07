/**
 * Nuvra Builder — Site Builder
 *
 * Orchestrates the production build of a complete multi-page site.
 *
 * Responsibilities:
 *  - Iterate all pages and render each to a production HTML document
 *  - Generate the nuvra.manifest.json
 *  - Return a SiteBundle: { files: { filename: content }, manifest }
 *
 * The SiteBundle is consumed by the PublishManager which packages
 * it into a ZIP or serves it locally.
 *
 * This module has no UI dependencies.
 */

'use strict';

import { buildPublishDocument } from './publishRenderer.js';
import { buildManifest }        from './manifestBuilder.js';

// ─── Site Builder ─────────────────────────────────────────────────────────────

/**
 * Build a complete site bundle from the current project state.
 *
 * @param {object}   opts
 * @param {object[]} opts.pages       - All page objects from pageManager
 * @param {object}   opts.dataStore   - Serialized DataStore snapshot
 * @param {object}   opts.projectMeta - { name, accent }
 * @param {Function} [opts.onProgress] - (percent: number, message: string) => void
 * @returns {Promise<SiteBundle>}
 */
export async function buildSite({ pages, dataStore, projectMeta = {}, onProgress }) {
  const files   = {};
  const total   = pages.length + 2; // pages + manifest + readme
  let   current = 0;

  const progress = (msg) => {
    current++;
    onProgress && onProgress(Math.round((current / total) * 100), msg);
  };

  // ── Render each page ──────────────────────────────────────────────────────
  for (const page of pages) {
    const filename = _pageFilename(page, pages);
    const html     = buildPublishDocument(page, dataStore, projectMeta);
    files[filename] = html;
    progress(`Rendered: ${page.name}`);
  }

  // ── Generate manifest ─────────────────────────────────────────────────────
  const manifest = buildManifest({ pages, dataStore, projectMeta });
  files['nuvra.manifest.json'] = JSON.stringify(manifest, null, 2);
  progress('Generated manifest');

  // ── Generate README ───────────────────────────────────────────────────────
  files['README.md'] = _buildReadme(manifest, projectMeta);
  progress('Generated README');

  return { files, manifest };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _pageFilename(page, allPages) {
  const slug = page.slug || _slugify(page.name);

  // The first page or the page marked as home becomes index.html
  const isHome = page.isHome || allPages.indexOf(page) === 0;
  if (isHome) return 'index.html';

  return `${slug}.html`;
}

function _slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'page';
}

function _buildReadme(manifest, projectMeta) {
  const name  = projectMeta.name || 'Nuvra Project';
  const date  = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
  const pages = manifest.pages.map((p) => `- \`${p.slug}.html\` — ${p.name} (${p.pageType})`).join('\n');

  return `# ${name}

Built with [Nuvra](https://nuvra.io) on ${date}.

## Pages

${pages}

## Deployment

This site is ready to deploy to any static hosting provider:

- **Netlify**: Drag and drop this folder into [app.netlify.com/drop](https://app.netlify.com/drop)
- **Vercel**: Run \`vercel deploy\` in this directory
- **GitHub Pages**: Push to a \`gh-pages\` branch
- **Any web server**: Upload all files to your \`public_html\` or \`www\` directory

## Notes

- Built with Nuvra v${manifest.nuvra}
- Entry point: \`${manifest.entryPoint}\`
${manifest.hasAppPages ? '- This site includes app pages with an embedded runtime for data operations.' : ''}
`;
}
