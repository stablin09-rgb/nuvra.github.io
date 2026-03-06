/**
 * toast.js — Nuvra Foundation (Phase 0–1)
 *
 * Toast notification control.
 * Toasts are driven by the store's ui.notifications slice.
 * They can also be triggered imperatively via toastManager.show().
 *
 * @module ui/controls/toast
 */
'use strict';

import { store }    from '../../state/store.js';
import { generateId } from '../../runtime/utils.js';

const DEFAULT_DURATION = 4000;

export const toastManager = {
  _el:     null,
  _timers: new Map(),

  mount(el) {
    if (!el) return;
    this._el = el;
    this._el.addEventListener('click', this._onClick.bind(this));
  },

  unmount() {
    for (const t of this._timers.values()) clearTimeout(t);
    this._timers.clear();
    this._el = null;
  },

  /**
   * Show a toast imperatively.
   * @param {string} message
   * @param {'info'|'success'|'warning'|'error'} [type]
   * @param {number} [duration]
   */
  show(message, type = 'info', duration = DEFAULT_DURATION) {
    store.dispatch({
      type: 'UI/SHOW_NOTIFICATION',
      payload: { message, type },
    });
    // Auto-dismiss
    const state = store.getState();
    const notes = state.ui.notifications;
    const note  = notes[notes.length - 1];
    if (note) {
      const timer = setTimeout(() => {
        store.dispatch({ type: 'UI/DISMISS_NOTIFICATION', payload: note.id });
      }, duration);
      this._timers.set(note.id, timer);
    }
  },

  syncFromState(state) {
    if (!this._el) return;
    const notes = state.ui.notifications;
    this._el.innerHTML = notes.map(n => `
      <div class="nv-toast nv-toast-${n.type || 'info'}" data-id="${n.id}" role="alert">
        <span class="nv-toast-msg">${this._esc(n.message)}</span>
        <button class="nv-toast-close" data-dismiss="${n.id}" aria-label="Dismiss">&#10005;</button>
      </div>
    `).join('');
  },

  _onClick(e) {
    const id = e.target.closest('[data-dismiss]')?.dataset.dismiss;
    if (id) {
      clearTimeout(this._timers.get(id));
      this._timers.delete(id);
      store.dispatch({ type: 'UI/DISMISS_NOTIFICATION', payload: id });
    }
  },

  _esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  },
};

export default toastManager;
