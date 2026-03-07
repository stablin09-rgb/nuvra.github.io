/**
 * runtimeStyles.js — Nuvra Phase 4
 *
 * The canonical CSS for the published runtime.
 * This is the only CSS that ships in the published output.
 * It is the same CSS used in Preview Mode.
 *
 * @module renderer/runtimeStyles
 */
'use strict';

export function generateRuntimeCSS() {
  return `
/* Nuvra Runtime v4 — Canonical Styles */

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --nv-color-bg:        #0f1117;
  --nv-color-surface:   #1a1d27;
  --nv-color-border:    #2a2d3a;
  --nv-color-text:      #e8eaf0;
  --nv-color-muted:     #8b8fa8;
  --nv-color-primary:   #6366f1;
  --nv-color-primary-h: #818cf8;
  --nv-color-success:   #22c55e;
  --nv-color-warning:   #f59e0b;
  --nv-color-danger:    #ef4444;
  --nv-color-info:      #3b82f6;
  --nv-radius-sm:       4px;
  --nv-radius-md:       8px;
  --nv-radius-lg:       12px;
  --nv-shadow-sm:       0 1px 3px rgba(0,0,0,.4);
  --nv-shadow-md:       0 4px 12px rgba(0,0,0,.5);
  --nv-font-sans:       -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --nv-font-mono:       'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
}

body {
  font-family: var(--nv-font-sans);
  background: var(--nv-color-bg);
  color: var(--nv-color-text);
  line-height: 1.6;
  min-height: 100vh;
}

#nv-app {
  min-height: 100vh;
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.nv-app-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* ── Components ─────────────────────────────────────────────────────────────── */

.nv-component { width: 100%; }

/* Stat Card */
.nv-stat-card {
  background: var(--nv-color-surface);
  border: 1px solid var(--nv-color-border);
  border-radius: var(--nv-radius-lg);
  padding: 20px 24px;
  display: inline-flex;
  flex-direction: column;
  gap: 8px;
  min-width: 160px;
}
.nv-stat-card--success { border-color: var(--nv-color-success); }
.nv-stat-card--warning { border-color: var(--nv-color-warning); }
.nv-stat-card--danger  { border-color: var(--nv-color-danger);  }
.nv-stat-card__header  { display: flex; align-items: center; gap: 8px; }
.nv-stat-card__icon    { font-size: 1.2rem; }
.nv-stat-card__label   { font-size: .75rem; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--nv-color-muted); }
.nv-stat-card__value   { font-size: 2rem; font-weight: 700; line-height: 1; }
.nv-stat-card__unit    { font-size: 1rem; font-weight: 400; color: var(--nv-color-muted); margin-left: 2px; }

/* Buttons */
.nv-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border: none; border-radius: var(--nv-radius-md); cursor: pointer;
  font-family: inherit; font-weight: 500; transition: all .15s ease;
  text-decoration: none; white-space: nowrap;
}
.nv-btn:disabled { opacity: .5; cursor: not-allowed; }
.nv-btn--md  { padding: 8px 16px; font-size: .875rem; }
.nv-btn--sm  { padding: 6px 12px; font-size: .8rem; }
.nv-btn--xs  { padding: 3px 8px;  font-size: .75rem; border-radius: var(--nv-radius-sm); }
.nv-btn--primary { background: var(--nv-color-primary); color: #fff; }
.nv-btn--primary:hover:not(:disabled) { background: var(--nv-color-primary-h); }
.nv-btn--secondary { background: var(--nv-color-surface); color: var(--nv-color-text); border: 1px solid var(--nv-color-border); }
.nv-btn--secondary:hover:not(:disabled) { border-color: var(--nv-color-primary); }
.nv-btn--danger { background: transparent; color: var(--nv-color-danger); border: 1px solid var(--nv-color-danger); }
.nv-btn--danger:hover:not(:disabled) { background: var(--nv-color-danger); color: #fff; }
.nv-btn--ghost { background: transparent; color: var(--nv-color-muted); }
.nv-btn--ghost:hover:not(:disabled) { color: var(--nv-color-text); background: rgba(255,255,255,.05); }

/* Forms */
.nv-form { background: var(--nv-color-surface); border: 1px solid var(--nv-color-border); border-radius: var(--nv-radius-lg); padding: 24px; }
.nv-form__title { font-size: 1rem; font-weight: 600; margin-bottom: 16px; }
.nv-form__body  { display: flex; flex-direction: column; gap: 12px; }
.nv-form__field { display: flex; flex-direction: column; gap: 4px; }
.nv-form__label { font-size: .8rem; font-weight: 500; color: var(--nv-color-muted); }
.nv-form__input, .nv-form__select {
  background: var(--nv-color-bg); border: 1px solid var(--nv-color-border);
  border-radius: var(--nv-radius-md); color: var(--nv-color-text);
  font-family: inherit; font-size: .875rem; padding: 8px 12px; width: 100%;
  transition: border-color .15s;
}
.nv-form__input:focus, .nv-form__select:focus {
  outline: none; border-color: var(--nv-color-primary);
}
.nv-form__actions { margin-top: 8px; }

/* Table */
.nv-table-wrapper { background: var(--nv-color-surface); border: 1px solid var(--nv-color-border); border-radius: var(--nv-radius-lg); overflow: hidden; }
.nv-table__header { padding: 16px 20px; border-bottom: 1px solid var(--nv-color-border); }
.nv-table__title  { font-size: 1rem; font-weight: 600; }
.nv-table__scroll { overflow-x: auto; }
.nv-table         { width: 100%; border-collapse: collapse; }
.nv-table__th     { padding: 10px 16px; text-align: left; font-size: .75rem; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--nv-color-muted); border-bottom: 1px solid var(--nv-color-border); }
.nv-table__td     { padding: 10px 16px; font-size: .875rem; border-bottom: 1px solid rgba(42,45,58,.5); }
.nv-table__row:last-child .nv-table__td { border-bottom: none; }
.nv-table__row:hover { background: rgba(255,255,255,.02); }
.nv-table__empty  { padding: 32px; text-align: center; color: var(--nv-color-muted); font-size: .875rem; }

/* List */
.nv-list { background: var(--nv-color-surface); border: 1px solid var(--nv-color-border); border-radius: var(--nv-radius-lg); overflow: hidden; }
.nv-list__header { padding: 16px 20px; border-bottom: 1px solid var(--nv-color-border); }
.nv-list__title  { font-size: 1rem; font-weight: 600; }
.nv-list__items  { list-style: none; }
.nv-list__item   { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-bottom: 1px solid rgba(42,45,58,.5); }
.nv-list__item:last-child { border-bottom: none; }
.nv-list__item:hover { background: rgba(255,255,255,.02); }
.nv-list__item-content { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
.nv-list__item-main    { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.nv-list__item-title   { font-size: .875rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nv-list__item-subtitle{ font-size: .75rem; color: var(--nv-color-muted); }
.nv-list__item-actions { display: flex; gap: 6px; flex-shrink: 0; }
.nv-list__empty  { padding: 32px; text-align: center; color: var(--nv-color-muted); font-size: .875rem; list-style: none; }

/* Badge */
.nv-badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: .7rem; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; background: rgba(99,102,241,.15); color: var(--nv-color-primary-h); }

/* Filter Bar */
.nv-filter-bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
.nv-filter-bar__item  { display: flex; flex-direction: column; gap: 4px; }
.nv-filter-bar__label { font-size: .75rem; font-weight: 500; color: var(--nv-color-muted); }

/* Text */
.nv-text { color: var(--nv-color-text); }

/* Toast */
.nv-toast-container { position: fixed; bottom: 24px; right: 24px; z-index: 9999; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
.nv-toast { padding: 10px 16px; border-radius: var(--nv-radius-md); font-size: .875rem; font-weight: 500; box-shadow: var(--nv-shadow-md); animation: nv-toast-in .2s ease; pointer-events: auto; }
.nv-toast--success { background: var(--nv-color-success); color: #fff; }
.nv-toast--error   { background: var(--nv-color-danger);  color: #fff; }
.nv-toast--warning { background: var(--nv-color-warning); color: #000; }
.nv-toast--info    { background: var(--nv-color-info);    color: #fff; }
@keyframes nv-toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

/* Component Error */
.nv-component-error { background: rgba(239,68,68,.1); border: 1px solid var(--nv-color-danger); border-radius: var(--nv-radius-md); padding: 12px 16px; font-size: .8rem; color: var(--nv-color-danger); font-family: var(--nv-font-mono); }

/* Responsive */
@media (max-width: 768px) {
  #nv-app { padding: 16px; }
  .nv-stat-card { min-width: 120px; }
  .nv-stat-card__value { font-size: 1.5rem; }
}
`;
}

export default generateRuntimeCSS;
