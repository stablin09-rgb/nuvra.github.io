/**
 * Nuvra — packManager.js (Phase 13)
 *
 * Manages the full lifecycle of Design AI Packs from the user's perspective.
 *
 * Responsibilities:
 *  - Browse available packs (from local catalog + cloud marketplace)
 *  - Install, activate, deactivate, update, and remove packs
 *  - Restore active packs when a project is opened
 *  - Provide the pack management UI panel
 *
 * @module packManager
 */
'use strict';

import { packSDK }     from './packSDK.js';
import { packRuntime } from './packRuntime.js';

const INSTALLED_KEY = (userId) => `nuvra-installed-packs-${userId}`;

// ─── Built-in Pack Catalog ────────────────────────────────────────────────────
// These are the built-in packs. Cloud marketplace packs are fetched dynamically.

const BUILT_IN_PACKS = [
  {
    id: 'com.nuvra.minimal-pro',
    name: 'Minimal Pro',
    version: '1.0.0',
    description: 'Clean, whitespace-driven design system for modern SaaS and portfolio sites.',
    author: 'Nuvra',
    category: 'saas',
    tags: ['minimal', 'clean', 'saas', 'portfolio'],
    price: 'free',
    thumbnail: null,
    tokens: {
      colors: {
        primary: '#0f172a',
        secondary: '#64748b',
        accent: '#6366f1',
        background: '#ffffff',
        surface: '#f8fafc',
        border: '#e2e8f0',
        text: '#0f172a',
        textMuted: '#64748b',
      },
      typography: {
        fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
        headingFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
        baseSize: '16px',
        scale: 1.25,
      },
      spacing: { unit: '8' },
      radii: { sm: '4px', md: '8px', lg: '16px', full: '9999px' },
      shadows: {
        sm: '0 1px 2px rgba(0,0,0,0.05)',
        md: '0 4px 6px rgba(0,0,0,0.07)',
        lg: '0 10px 15px rgba(0,0,0,0.1)',
      },
    },
    ai: {
      systemPrompt: 'Use a minimal, clean design aesthetic. Prioritize whitespace and typography. Avoid decorative elements. Use a monochromatic color palette with a single accent color.',
      toneModifiers: ['professional', 'clean', 'modern'],
      layoutRules: [
        'Use generous whitespace between sections (min 80px padding)',
        'Prefer single-column layouts for content sections',
        'Use a max-width of 1200px for content containers',
      ],
      colorRules: [
        'Use the primary color (#0f172a) for headings and key text',
        'Use the accent color (#6366f1) sparingly for CTAs only',
        'Backgrounds should be white or very light gray (#f8fafc)',
      ],
      typographyRules: [
        'Use Inter font for all text',
        'Heading sizes: h1=48px, h2=36px, h3=24px',
        'Body text: 16px with 1.6 line height',
      ],
      sectionOrder: ['hero', 'features', 'social-proof', 'pricing', 'cta', 'footer'],
    },
    interactions: {
      transitions: { fast: '150ms ease', normal: '200ms ease', slow: '350ms ease' },
    },
  },
  {
    id: 'com.nuvra.bold-agency',
    name: 'Bold Agency',
    version: '1.0.0',
    description: 'High-impact, visually bold design system for creative agencies and brands.',
    author: 'Nuvra',
    category: 'creative',
    tags: ['bold', 'creative', 'agency', 'brand'],
    price: 'free',
    thumbnail: null,
    tokens: {
      colors: {
        primary: '#ff3b00',
        secondary: '#1a1a1a',
        accent: '#ffd700',
        background: '#0d0d0d',
        surface: '#1a1a1a',
        border: '#333333',
        text: '#ffffff',
        textMuted: '#999999',
      },
      typography: {
        fontFamily: "'DM Sans', 'Helvetica Neue', Arial, sans-serif",
        headingFamily: "'Syne', 'Helvetica Neue', Arial, sans-serif",
        baseSize: '17px',
        scale: 1.333,
      },
      spacing: { unit: '8' },
      radii: { sm: '2px', md: '4px', lg: '8px', full: '9999px' },
      shadows: {
        sm: '2px 2px 0 #ff3b00',
        md: '4px 4px 0 #ff3b00',
        lg: '8px 8px 0 #ff3b00',
      },
    },
    ai: {
      systemPrompt: 'Use a bold, high-contrast design aesthetic. Use large typography, strong visual hierarchy, and dramatic color contrasts. Dark backgrounds with bright accent colors. Think editorial and impactful.',
      toneModifiers: ['bold', 'creative', 'impactful', 'dramatic'],
      layoutRules: [
        'Use full-width sections with dark backgrounds',
        'Use large, oversized headings (60px+ for h1)',
        'Use asymmetric layouts and overlapping elements',
      ],
      colorRules: [
        'Dark backgrounds (#0d0d0d or #1a1a1a) for most sections',
        'Use the primary color (#ff3b00) for key CTAs and highlights',
        'Use the accent color (#ffd700) for secondary highlights',
      ],
      sectionOrder: ['hero', 'work', 'services', 'about', 'contact', 'footer'],
    },
  },
  {
    id: 'com.nuvra.fintech-trust',
    name: 'FinTech Trust',
    version: '1.0.0',
    description: 'Professional, trust-building design system for financial products and services.',
    author: 'Nuvra',
    category: 'business',
    tags: ['fintech', 'finance', 'trust', 'professional'],
    price: 'free',
    thumbnail: null,
    tokens: {
      colors: {
        primary: '#1e40af',
        secondary: '#1e3a5f',
        accent: '#10b981',
        background: '#ffffff',
        surface: '#f0f4f8',
        border: '#cbd5e1',
        text: '#1e293b',
        textMuted: '#64748b',
        success: '#10b981',
        warning: '#f59e0b',
        danger: '#ef4444',
      },
      typography: {
        fontFamily: "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif",
        headingFamily: "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif",
        baseSize: '16px',
        scale: 1.2,
      },
      spacing: { unit: '8' },
      radii: { sm: '4px', md: '6px', lg: '12px', full: '9999px' },
      shadows: {
        sm: '0 1px 3px rgba(0,0,0,0.1)',
        md: '0 4px 12px rgba(0,0,0,0.08)',
        lg: '0 8px 24px rgba(0,0,0,0.12)',
      },
    },
    ai: {
      systemPrompt: 'Use a professional, trust-building design aesthetic. Prioritize clarity, credibility, and security signals. Use blue tones, clean layouts, and data-driven content. Include trust badges, security indicators, and clear value propositions.',
      toneModifiers: ['professional', 'trustworthy', 'authoritative', 'clear'],
      layoutRules: [
        'Use structured, grid-based layouts',
        'Include security/trust badges near CTAs',
        'Use clear data visualizations for metrics',
      ],
      colorRules: [
        'Primary blue (#1e40af) for key actions and headings',
        'Green (#10b981) for success states and positive metrics',
        'Avoid red except for error states',
      ],
      sectionOrder: ['hero', 'trust-signals', 'features', 'how-it-works', 'pricing', 'testimonials', 'cta', 'footer'],
    },
  },
];

// ─── PackManager ──────────────────────────────────────────────────────────────

class PackManager {
  constructor() {
    this._userId    = null;
    this._projectId = null;
    this._el        = null;
  }

  // ─── Initialization ──────────────────────────────────────────────────────────

  init({ userId, projectId, editor, policies = [] }) {
    this._userId    = userId;
    this._projectId = projectId;
    packRuntime.init({ projectId, editor, policies });
    this._restoreActivePacks();
  }

  // ─── Pack Lifecycle ──────────────────────────────────────────────────────────

  async installAndActivate(packId) {
    const manifest = this._findManifest(packId);
    if (!manifest) return { ok: false, error: 'Pack not found.' };

    // Validate
    const { valid, errors } = packSDK.validate(manifest);
    if (!valid) return { ok: false, error: errors.join(', ') };

    // Save to installed list
    this._saveInstalled(packId, manifest);

    // Activate in runtime
    const result = packRuntime.activate(manifest);
    return result;
  }

  deactivate(packId) {
    return packRuntime.deactivate(packId);
  }

  uninstall(packId) {
    packRuntime.deactivate(packId);
    this._removeInstalled(packId);
    return { ok: true };
  }

  // ─── Catalog ─────────────────────────────────────────────────────────────────

  getCatalog() {
    return BUILT_IN_PACKS.map(p => ({
      ...packSDK.getSummary(p),
      isInstalled: this._isInstalled(p.id),
      isActive:    packRuntime.isActive(p.id),
    }));
  }

  getActivePacks() {
    return packRuntime.getActivePacks();
  }

  // ─── UI Panel ────────────────────────────────────────────────────────────────

  showPanel() {
    if (!this._el) this._renderPanel();
    this._el.classList.add('open');
    this._refreshPanel();
  }

  hidePanel() {
    this._el?.classList.remove('open');
  }

  togglePanel() {
    if (!this._el) this._renderPanel();
    if (this._el.classList.contains('open')) this.hidePanel();
    else this.showPanel();
  }

  _renderPanel() {
    const existing = document.getElementById('nv-pack-panel');
    if (existing) { this._el = existing; return; }

    this._el = document.createElement('div');
    this._el.id = 'nv-pack-panel';
    this._el.className = 'nv-pack-panel';
    this._el.innerHTML = `
      <div class="nv-pack-panel__header">
        <h2 class="nv-pack-panel__title">Design AI Packs</h2>
        <button class="nv-pack-panel__close" id="nv-pack-panel-close">✕</button>
      </div>
      <div class="nv-pack-panel__body" id="nv-pack-panel-body"></div>
    `;
    document.body.appendChild(this._el);
    this._el.querySelector('#nv-pack-panel-close')?.addEventListener('click', () => this.hidePanel());
  }

  _refreshPanel() {
    const body = this._el?.querySelector('#nv-pack-panel-body');
    if (!body) return;

    const catalog = this.getCatalog();
    const activePacks = packRuntime.getActivePacks();

    const activeSection = activePacks.length > 0
      ? `<div class="nv-pack-section">
           <p class="nv-pack-section-label">Active Packs (${activePacks.length})</p>
           ${activePacks.map(p => `
             <div class="nv-pack-card nv-pack-card--active">
               <div class="nv-pack-card__info">
                 <span class="nv-pack-card__name">${p.name}</span>
                 <span class="nv-pack-card__version">v${p.version}</span>
               </div>
               <button class="nv-btn-sm nv-btn-ghost" data-deactivate="${p.id}">Deactivate</button>
             </div>
           `).join('')}
         </div>`
      : '';

    const catalogSection = `
      <div class="nv-pack-section">
        <p class="nv-pack-section-label">Available Packs</p>
        ${catalog.map(p => `
          <div class="nv-pack-card ${p.isActive ? 'nv-pack-card--active' : ''}">
            <div class="nv-pack-card__info">
              <span class="nv-pack-card__name">${p.name}</span>
              <span class="nv-pack-card__category">${p.category}</span>
              <p class="nv-pack-card__desc">${p.description}</p>
            </div>
            <div class="nv-pack-card__actions">
              ${p.isActive
                ? `<span class="nv-pack-badge-active">Active</span>
                   <button class="nv-btn-sm nv-btn-ghost" data-deactivate="${p.id}">Remove</button>`
                : `<button class="nv-btn-sm nv-btn-primary" data-activate="${p.id}">Apply Pack</button>`
              }
            </div>
          </div>
        `).join('')}
      </div>
    `;

    body.innerHTML = activeSection + catalogSection;

    // Bind buttons
    body.querySelectorAll('[data-activate]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Applying…';
        const result = await this.installAndActivate(btn.dataset.activate);
        if (result.ok) {
          this._refreshPanel();
        } else {
          btn.textContent = 'Failed';
          setTimeout(() => { btn.disabled = false; btn.textContent = 'Apply Pack'; }, 3000);
        }
      });
    });

    body.querySelectorAll('[data-deactivate]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.deactivate(btn.dataset.deactivate);
        this._refreshPanel();
      });
    });
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  _findManifest(packId) {
    return BUILT_IN_PACKS.find(p => p.id === packId) || null;
  }

  _isInstalled(packId) {
    const installed = this._loadInstalled();
    return installed.some(p => p.id === packId);
  }

  _loadInstalled() {
    try {
      return JSON.parse(localStorage.getItem(INSTALLED_KEY(this._userId)) || '[]');
    } catch { return []; }
  }

  _saveInstalled(packId, manifest) {
    const installed = this._loadInstalled();
    if (!installed.find(p => p.id === packId)) {
      installed.push({ id: packId, version: manifest.version, installedAt: new Date().toISOString() });
      try {
        localStorage.setItem(INSTALLED_KEY(this._userId), JSON.stringify(installed));
      } catch { /* Storage full */ }
    }
  }

  _removeInstalled(packId) {
    const installed = this._loadInstalled().filter(p => p.id !== packId);
    try {
      localStorage.setItem(INSTALLED_KEY(this._userId), JSON.stringify(installed));
    } catch { /* Storage full */ }
  }

  async _restoreActivePacks() {
    const pendingIds = packRuntime.getPendingRestoreIds();
    for (const packId of pendingIds) {
      await this.installAndActivate(packId);
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const packManager = new PackManager();
