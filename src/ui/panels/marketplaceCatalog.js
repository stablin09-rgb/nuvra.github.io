/**
 * marketplaceCatalog.js
 * Placeholder for the Marketplace Catalog UI panel.
 */
'use strict';

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
    this._el.innerHTML = `
      <div class="nv-panel-placeholder">
        Marketplace Catalog - Content coming soon!
      </div>
    `;
  },
};

export default marketplaceCatalog;
