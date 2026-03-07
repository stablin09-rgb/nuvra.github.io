/**
 * Nuvra Builder — Application Entry Point
 *
 * Bootstraps the entire application in the correct order:
 *  1. Load saved project from storage
 *  2. Initialise GrapesJS editor
 *  3. Register block library
 *  4. Initialise page manager with restored state
 *  5. Configure AI engine from saved settings
 *  6. Bind all top-bar button events
 *
 * This file should remain thin — it wires modules together
 * and delegates all logic to the appropriate module.
 */

'use strict';

import { loadProject }                       from './storage.js';
import { init as initPages, addPage, renamePage, deletePage, getSnapshot, addGeneratedPage } from './pageManager.js';
import { exportCurrentPage, exportFullSite, exportProjectJson, importProjectJson }           from './exportImport.js';
import { registerBlocks }                    from '../blocks/blockLibrary.js';
import { generatePage, generateSite, generateApp } from '../ai/aiEngine.js';
import { initAI, openAISettings }            from '../ai/aiSettings.js';
import { slugify, showToast }                from '../utils/helpers.js';

// ─── 1. Restore saved project (or create default) ────────────────────────────

const saved = loadProject();

const initialPages = saved?.pages ?? {
  home: {
    name: 'Home',
    html: `<section style="padding:100px 40px; text-align:center; background:linear-gradient(135deg,#0b0b0f,#1a1a2e); color:#fff;">
  <h1 style="font-size:52px; font-weight:800; margin:0 0 20px;">Welcome to Nuvra</h1>
  <p style="font-size:18px; color:#aaa; max-width:540px; margin:0 auto 36px;">Drag blocks from the left panel, or use AI to generate a full page instantly.</p>
  <button style="padding:14px 32px; background:#7c6af7; color:#fff; border:none; border-radius:8px; font-size:16px; font-weight:600; cursor:pointer;">Get Started</button>
</section>`,
    css:  '',
    meta: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  },
};

const initialCurrentPage = saved?.currentPage ?? 'home';

// ─── 2. Initialise GrapesJS ───────────────────────────────────────────────────

const editor = grapesjs.init({
  container:  '#gjs',
  height:     '100%',
  fromElement: false,

  // Disable GrapesJS's built-in storage — Nuvra manages its own
  storageManager: false,

  // Disable default panels (Nuvra provides its own top bar)
  panels: { defaults: [] },

  blockManager: {
    appendTo: '#blocks',
    blocks:   [],
  },

  styleManager: {
    appendTo: '#style-panel',
    sectors: [
      {
        name: 'Typography',
        open: false,
        properties: ['font-family', 'font-size', 'font-weight', 'color', 'line-height', 'text-align'],
      },
      {
        name: 'Spacing',
        open: false,
        properties: ['margin', 'padding'],
      },
      {
        name: 'Dimensions',
        open: false,
        properties: ['width', 'height', 'max-width'],
      },
      {
        name: 'Background',
        open: false,
        properties: ['background-color', 'background'],
      },
      {
        name: 'Border',
        open: false,
        properties: ['border', 'border-radius'],
      },
    ],
  },

  canvas: {
    styles: [
      // Inject a minimal reset so canvas content looks clean
      'https://unpkg.com/normalize.css@8.0.1/normalize.css',
    ],
  },
});

// ─── 3. Register blocks ───────────────────────────────────────────────────────

registerBlocks(editor);

// ─── 4. Initialise page manager ───────────────────────────────────────────────

initPages(editor, initialPages, initialCurrentPage);

// ─── 5. Configure AI engine ───────────────────────────────────────────────────

initAI();

// ─── 6. Bind top-bar events ───────────────────────────────────────────────────

document.getElementById('btn-add-page').addEventListener('click',    addPage);
document.getElementById('btn-rename-page').addEventListener('click', renamePage);
document.getElementById('btn-delete-page').addEventListener('click', deletePage);

document.getElementById('btn-export-page').addEventListener('click',    () => exportCurrentPage(editor));
document.getElementById('btn-export-site').addEventListener('click',    () => exportFullSite(editor));
document.getElementById('btn-export-project').addEventListener('click', exportProjectJson);
document.getElementById('btn-import-project').addEventListener('click', importProjectJson);

document.getElementById('btn-ai-settings').addEventListener('click', openAISettings);

// ─── 7. AI Generation — Three-Mode System ────────────────────────────────────
//
//  Mode A: Generate Page  — single marketing/landing page
//  Mode B: Generate Site  — multi-page marketing site
//  Mode C: Generate App   — full data-driven application
//
// The active mode is controlled by the dropdown button in the AI panel.

let _generateMode = 'page'; // 'page' | 'site' | 'app'

// Mode selector dropdown
const modeDropdownBtn  = document.getElementById('btn-generate-mode');
const modeDropdownMenu = document.getElementById('generate-mode-menu');

if (modeDropdownBtn && modeDropdownMenu) {
  modeDropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    modeDropdownMenu.classList.toggle('open');
  });

  document.addEventListener('click', () => {
    modeDropdownMenu?.classList.remove('open');
  });

  modeDropdownMenu.querySelectorAll('[data-mode]').forEach((item) => {
    item.addEventListener('click', () => {
      _generateMode = item.dataset.mode;
      const label   = item.dataset.label || item.textContent.trim();

      // Update the dropdown button label
      const labelEl = document.getElementById('generate-mode-label');
      if (labelEl) labelEl.textContent = label;

      // Update the placeholder text
      const promptInput = document.getElementById('aiPrompt');
      if (promptInput) {
        const placeholders = {
          page: 'Describe a landing page, blog, or portfolio…',
          site: 'Describe a full website (Home, About, Contact)…',
          app:  'Describe an app: "task manager", "CRM for leads"…',
        };
        promptInput.placeholder = placeholders[_generateMode] || placeholders.page;
      }

      modeDropdownMenu.classList.remove('open');
    });
  });
}

// Main generate button
const btnGenerate = document.getElementById('btn-generate-ai');
const statusEl    = document.getElementById('aiStatus');

if (btnGenerate) {
  btnGenerate.addEventListener('click', async () => {
    const promptInput = document.getElementById('aiPrompt');
    const prompt      = promptInput?.value.trim();

    if (!prompt) {
      showToast('Please describe what you want to generate.', 'error');
      return;
    }

    // Disable button and show loading state
    btnGenerate.disabled    = true;
    btnGenerate.textContent = 'Generating…';
    if (statusEl) {
      statusEl.textContent = _getModeStatusText(_generateMode);
      statusEl.classList.add('visible');
    }

    try {
      if (_generateMode === 'page') {
        await _handleGeneratePage(prompt);
      } else if (_generateMode === 'site') {
        await _handleGenerateSite(prompt);
      } else if (_generateMode === 'app') {
        await _handleGenerateApp(prompt);
      }

      if (promptInput) promptInput.value = '';
    } catch (err) {
      console.error('[Nuvra AI] Generation failed:', err);
      showToast(`AI generation failed: ${err.message}`, 'error');
    } finally {
      btnGenerate.disabled    = false;
      btnGenerate.textContent = 'Generate';
      if (statusEl) statusEl.classList.remove('visible');
    }
  });

  // Allow Enter key in prompt field
  document.getElementById('aiPrompt')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnGenerate.click();
  });
}

// ─── Generation Handlers ──────────────────────────────────────────────────────

async function _handleGeneratePage(prompt) {
  const { pages } = getSnapshot();
  const id        = slugify(prompt);

  if (pages[id]) {
    showToast('A page with this name already exists. Try a different description.', 'error');
    return;
  }

  const result = await generatePage(prompt, { pageType: 'website page' });
  addGeneratedPage(id, result.name, result.html, result.css, result.schema);
  showToast(`Page "${result.name}" generated.`, 'success');
  _logMeta(result.meta);
}

async function _handleGenerateSite(prompt) {
  const pages = await generateSite(prompt);

  if (!pages || pages.length === 0) {
    showToast('No pages were generated. Please try a different prompt.', 'error');
    return;
  }

  for (const result of pages) {
    const id = slugify(result.name);
    addGeneratedPage(id, result.name, result.html, result.css, result.schema);
  }

  showToast(`Site generated: ${pages.length} pages created.`, 'success');
  _logMeta(pages[0]?.meta);
}

async function _handleGenerateApp(prompt) {
  const result = await generateApp(prompt);

  if (!result || !result.pages || result.pages.length === 0) {
    showToast('No app pages were generated. Please try a different prompt.', 'error');
    return;
  }

  // Add each app page to the project
  for (const page of result.pages) {
    const id = slugify(page.name);
    addGeneratedPage(id, page.name, page.html, page.css, page.schema, {
      pageType:    page.pageType || 'app',
      collections: result.collections || [],
    });
  }

  showToast(
    `App "${result.plan?.appName || 'App'}" generated: ${result.pages.length} pages, ${result.collections?.length || 0} collections.`,
    'success',
  );
  _logMeta(result.meta);
}

// ─── Sidebar Tab Switching ────────────────────────────────────────────────────

document.querySelectorAll('.sidebar-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.sidebar-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');

    const target = tab.dataset.panel;
    document.querySelectorAll('.sidebar-panel').forEach((panel) => {
      panel.style.display = panel.id === target ? '' : 'none';
    });
  });
});

// ─── Private Helpers ──────────────────────────────────────────────────────────

function _getModeStatusText(mode) {
  const texts = {
    page: 'AI is building your page…',
    site: 'AI is planning your site…',
    app:  'AI is designing your app…',
  };
  return texts[mode] || 'AI is generating…';
}

function _logMeta(meta) {
  if (!meta) return;
  if (meta.provider !== 'mock') {
    console.info(`[Nuvra AI] Generated via ${meta.provider}/${meta.model} — ${meta.tokens ?? '?'} tokens`);
  }
}
