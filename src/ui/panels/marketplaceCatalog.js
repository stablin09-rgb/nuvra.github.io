/**
 * marketplaceCatalog.js - Nuvra Phase 8
 *
 * Implements the UI for the Marketplace Catalog UI panel.
 * This panel allows users to browse and install extensions and templates.
 */
'use strict';

import { store } from '../../state/store.js';
import { logger } from '../../diagnostics/logger.js';
import { runtime } from '../../runtime/lifecycle.js';

export const marketplaceCatalog = {
  _el: null,

  mount(el) {
    if (!el) return;
    this._el = el;
    this.render();
  },

  unmount() {
    this._el = null;
  },

  render() {
    if (!this._el) return;
    
    const marketplaceCatalogModule = runtime.getModule('marketplaceCatalog');
    if (!marketplaceCatalogModule) {
      this._el.innerHTML = '<div class="nv-panel-placeholder">Marketplace Catalog not initialized.</div>';
      return;
    }

    const extensions = marketplaceCatalogModule.listExtensions() || [];

    this._el.innerHTML = `
      <div class="marketplace-catalog" style="padding: 1rem; color: #fff;">
        <h2 style="margin-top: 0;">Marketplace Catalog</h2>
        
        <div class="search-bar" style="margin-bottom: 1rem;">
          <input type="text" placeholder="Search extensions..." style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid #444; background: #2a2a2a; color: #fff;">
        </div>

        <div class="extension-list" style="display: flex; flex-direction: column; gap: 1rem;">
          ${extensions.length > 0 
            ? extensions.map(ext => `
              <div class="extension-card" style="background: #2a2a2a; padding: 1rem; border-radius: 4px; border: 1px solid #444;">
                <h3 style="margin: 0 0 5px 0;">${ext.name}</h3>
                <p style="margin: 0; font-size: 0.85rem; color: #aaa;">${ext.description || 'No description available.'}</p>
                <div style="margin-top: 10px; display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 0.75rem; color: #4caf50;">${ext.price || 'Free'}</span>
                  <button class="nv-btn nv-btn-primary" style="padding: 4px 12px; font-size: 0.8rem;">Install</button>
                </div>
              </div>
            `).join('')
            : '<p>No extensions available in the catalog yet.</p>'}
        </div>

        <div class="section" style="margin-top: 2rem;">
          <h3 style="border-bottom: 1px solid #444; padding-bottom: 5px;">Featured Templates</h3>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px;">
            <div style="background: #333; padding: 10px; border-radius: 4px; text-align: center;">SaaS Landing</div>
            <div style="background: #333; padding: 10px; border-radius: 4px; text-align: center;">E-commerce</div>
            <div style="background: #333; padding: 10px; border-radius: 4px; text-align: center;">Portfolio</div>
            <div style="background: #333; padding: 10px; border-radius: 4px; text-align: center;">Dashboard</div>
          </div>
        </div>
      </div>
    `;
  }
};

export default marketplaceCatalog;
