/**
 * runtimeBundle.js — Nuvra Phase 4
 *
 * The Runtime Bundle Generator.
 *
 * Produces the self-contained JavaScript runtime that is embedded in every
 * published output. This is the code that runs in the browser when a user
 * visits a published Nuvra site or app.
 *
 * The bundle contains:
 *  - The AppRuntime (Phase 3)
 *  - The AppStateEngine
 *  - The DataEngine
 *  - The ActionDispatcher
 *  - All built-in components
 *  - The AppRenderer
 *  - The boot sequence
 *
 * Critically, the bundle does NOT contain:
 *  - Any editor code
 *  - Any planning/AI code
 *  - Any Nuvra branding (unless opted in)
 *  - Any development-only diagnostics
 *
 * In Phase 4, the bundle is generated as a self-contained inline script
 * (since we do not have a bundler like Webpack/Vite in this environment).
 * In a production build, this would be replaced by a proper bundler output.
 *
 * @module renderer/runtimeBundle
 */
'use strict';

/**
 * Generate the runtime boot script for a published output.
 *
 * @param {object} opts
 * @param {object}  opts.appSchema     - The AppSchema to embed
 * @param {object}  opts.snapshot      - The data/state snapshot to embed
 * @param {string}  opts.target        - The render target ID
 * @param {object}  [opts.config]      - Optional runtime configuration
 * @returns {string} The JavaScript source code for the runtime bundle
 */
export function generateRuntimeScript(opts = {}) {
  const { appSchema, snapshot, target, config = {} } = opts;

  const schemaJson   = JSON.stringify(appSchema,  null, 0);
  const snapshotJson = JSON.stringify(snapshot || {}, null, 0);
  const configJson   = JSON.stringify({
    target,
    debug:    config.debug   || false,
    version:  config.version || '1.0.0',
    ...config,
  }, null, 0);

  // The runtime script is a self-executing function that:
  // 1. Defines the minimal runtime inline (no external dependencies)
  // 2. Boots from the embedded schema and snapshot
  // 3. Renders the app into #nv-app
  return `
/* Nuvra Runtime v4 — target: ${target} */
(function(global) {
  'use strict';

  // ── Embedded Schema & Snapshot ──────────────────────────────────────────────
  const __NUVRA_SCHEMA__   = ${schemaJson};
  const __NUVRA_SNAPSHOT__ = ${snapshotJson};
  const __NUVRA_CONFIG__   = ${configJson};

  // ── Minimal Utilities ────────────────────────────────────────────────────────
  function generateId(prefix) {
    return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 10);
  }

  function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; }
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Minimal Event Bus ────────────────────────────────────────────────────────
  function createEventBus() {
    const listeners = new Map();
    return {
      on(event, handler) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(handler);
        return () => listeners.get(event)?.delete(handler);
      },
      emit(event, data) {
        listeners.get(event)?.forEach(h => { try { h(data); } catch {} });
        listeners.get('*')?.forEach(h => { try { h({ event, data }); } catch {} });
      },
      destroy() { listeners.clear(); }
    };
  }

  // ── Minimal State Engine ─────────────────────────────────────────────────────
  function createStateEngine(stateSchema, eventBus) {
    const state = { global: {}, page: {}, component: {}, derived: {} };

    // Initialize from schema defaults
    for (const def of (stateSchema?.global || [])) {
      state.global[def.id] = deepClone(def.defaultValue ?? null);
    }
    for (const def of (stateSchema?.page || [])) {
      state.page[def.id] = deepClone(def.defaultValue ?? null);
    }

    // Restore from snapshot if provided
    if (__NUVRA_SNAPSHOT__.state) {
      Object.assign(state.global, deepClone(__NUVRA_SNAPSHOT__.state.global || {}));
      Object.assign(state.page,   deepClone(__NUVRA_SNAPSHOT__.state.page   || {}));
    }

    const listeners = new Map();

    function getByPath(path) {
      const parts = path.split('.');
      let cur = state;
      for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; }
      return cur;
    }

    function setByPath(path, value) {
      const parts = path.split('.');
      let cur = state;
      for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      const prev = cur[parts[parts.length - 1]];
      cur[parts[parts.length - 1]] = value;
      listeners.get(path)?.forEach(h => { try { h(value, prev); } catch {} });
      eventBus.emit('state:changed:' + path, { path, value, prev });
    }

    return {
      get: getByPath,
      set: setByPath,
      subscribe(path, handler) {
        if (!listeners.has(path)) listeners.set(path, new Set());
        listeners.get(path).add(handler);
        return () => listeners.get(path)?.delete(handler);
      },
      snapshot() { return deepClone(state); },
    };
  }

  // ── Minimal Data Engine ──────────────────────────────────────────────────────
  function createDataEngine(collections, eventBus) {
    const data = new Map();
    const schemas = new Map();

    for (const schema of (collections || [])) {
      schemas.set(schema.id, schema);
      const coll = new Map();
      data.set(schema.id, coll);

      // Restore from snapshot first
      const snapRecords = __NUVRA_SNAPSHOT__.data?.[schema.id] || [];
      for (const r of snapRecords) { coll.set(r._id, deepClone(r)); }

      // Seed only if no snapshot data
      if (snapRecords.length === 0) {
        for (const r of (schema.seedData || [])) {
          const id = r._id || generateId('rec');
          coll.set(id, { ...deepClone(r), _id: id, _createdAt: Date.now(), _updatedAt: Date.now() });
        }
      }
    }

    return {
      query(collectionId, query = {}) {
        const coll = data.get(collectionId);
        if (!coll) return [];
        let records = Array.from(coll.values());
        if (query.where) {
          records = records.filter(r => {
            for (const [f, c] of Object.entries(query.where)) {
              if (typeof c === 'object') {
                if ('eq' in c && r[f] !== c.eq) return false;
                if ('neq' in c && r[f] === c.neq) return false;
              } else if (r[f] !== c) return false;
            }
            return true;
          });
        }
        if (query.orderBy) {
          const dir = query.order === 'desc' ? -1 : 1;
          records.sort((a, b) => (a[query.orderBy] < b[query.orderBy] ? -1 : 1) * dir);
        }
        if (query.limit) records = records.slice(query.offset || 0, (query.offset || 0) + query.limit);
        return records.map(r => deepClone(r));
      },
      insert(collectionId, record) {
        const coll = data.get(collectionId);
        if (!coll) return { ok: false, error: 'Unknown collection: ' + collectionId };
        const id = record._id || generateId('rec');
        const final = { ...deepClone(record), _id: id, _createdAt: Date.now(), _updatedAt: Date.now() };
        coll.set(id, final);
        eventBus.emit('data:changed:' + collectionId, { type: 'insert', record: deepClone(final) });
        return { ok: true, record: deepClone(final) };
      },
      update(collectionId, recordId, patch) {
        const coll = data.get(collectionId);
        const existing = coll?.get(recordId);
        if (!existing) return { ok: false, error: 'Record not found: ' + recordId };
        const merged = { ...existing, ...patch, _id: recordId, _updatedAt: Date.now() };
        coll.set(recordId, merged);
        eventBus.emit('data:changed:' + collectionId, { type: 'update', record: deepClone(merged) });
        return { ok: true, record: deepClone(merged) };
      },
      delete(collectionId, recordId) {
        const coll = data.get(collectionId);
        if (!coll?.has(recordId)) return { ok: false, error: 'Record not found: ' + recordId };
        coll.delete(recordId);
        eventBus.emit('data:changed:' + collectionId, { type: 'delete', recordId });
        return { ok: true };
      },
    };
  }

  // ── Minimal Action Dispatcher ────────────────────────────────────────────────
  function createActionDispatcher(actions, ctx) {
    const actionMap = new Map();
    for (const a of (actions || [])) actionMap.set(a.id, a);

    async function executeStep(step, prev) {
      switch (step.type) {
        case 'data.insert': {
          const record = resolveParams(step.record, prev);
          return ctx.dataEngine.insert(step.collection, record);
        }
        case 'data.update': {
          const recordId = resolveValue(step.recordId, prev);
          const patch    = resolveParams(step.patch, prev);
          return ctx.dataEngine.update(step.collection, recordId, patch);
        }
        case 'data.delete': {
          const recordId = resolveValue(step.recordId, prev);
          return ctx.dataEngine.delete(step.collection, recordId);
        }
        case 'state.set': {
          ctx.stateEngine.set(step.path, resolveValue(step.value, prev));
          return { ok: true };
        }
        case 'state.toggle': {
          ctx.stateEngine.set(step.path, !ctx.stateEngine.get(step.path));
          return { ok: true };
        }
        case 'navigate': {
          const pageId = resolveValue(step.pageId, prev);
          ctx.eventBus.emit('runtime:navigate', { pageId });
          return { ok: true };
        }
        case 'notify': {
          const message = resolveValue(step.message, prev);
          ctx.eventBus.emit('runtime:notify', { message, type: step.notificationType || 'info', duration: step.duration || 3000 });
          return { ok: true };
        }
        case 'validate': {
          const d = resolveValue(step.data, prev) || {};
          const errors = {};
          let hasErrors = false;
          for (const [field, rule] of Object.entries(step.rules || {})) {
            if (rule.required && !d[field]) { errors[field] = rule.message || field + ' is required'; hasErrors = true; }
          }
          if (hasErrors) {
            if (step.errorsPath) ctx.stateEngine.set(step.errorsPath, errors);
            return { ok: false, errors };
          }
          return { ok: true, result: d };
        }
        default:
          return { ok: true };
      }
    }

    function resolveValue(expr, prev) {
      if (typeof expr !== 'string') return expr;
      if (expr === 'prev') return prev?.result;
      if (expr.startsWith('prev.')) return expr.slice(5).split('.').reduce((o, k) => o?.[k], prev?.result);
      if (expr.startsWith('state:')) return ctx.stateEngine.get(expr.slice(6));
      if (expr.startsWith('payload.')) return expr.slice(8).split('.').reduce((o, k) => o?.[k], ctx._payload);
      return expr;
    }

    function resolveParams(params, prev) {
      if (!params || typeof params !== 'object') return params;
      const r = {};
      for (const [k, v] of Object.entries(params)) r[k] = resolveValue(v, prev);
      return r;
    }

    return {
      async dispatch(actionId, payload) {
        const action = actionMap.get(actionId);
        if (!action) return { ok: false, error: 'Unknown action: ' + actionId };
        ctx._payload = payload;
        let prev = { ok: true, result: payload };
        for (const step of (action.steps || [])) {
          try { prev = await executeStep(step, prev); }
          catch (err) { prev = { ok: false, error: err.message }; }
          if (!prev.ok && step.haltOnError !== false) break;
        }
        ctx._payload = null;
        return prev;
      }
    };
  }

  // ── Component Renderers ──────────────────────────────────────────────────────
  const COMPONENTS = {
    'text': ({ container, props }) => {
      const el = document.createElement(props.tag || 'p');
      el.className = 'nv-text ' + (props.className || '');
      el.textContent = props.content || '';
      container.appendChild(el);
      return { update(p) { el.textContent = p.content || ''; } };
    },
    'button': ({ container, props, ctx, componentId }) => {
      const btn = document.createElement('button');
      btn.className = 'nv-btn nv-btn--' + (props.variant || 'primary') + ' nv-btn--' + (props.size || 'md');
      btn.textContent = props.label || 'Button';
      btn.addEventListener('click', async () => {
        if (!props.actionId) return;
        btn.disabled = true;
        try { await ctx.dispatcher.dispatch(props.actionId, props.payload || {}); }
        finally { btn.disabled = false; }
      });
      container.appendChild(btn);
      return { update(p) { btn.textContent = p.label || 'Button'; } };
    },
    'stat-card': ({ container, props }) => {
      const card = document.createElement('div');
      card.className = 'nv-stat-card nv-stat-card--' + (props.variant || 'default');
      function render(p) {
        card.innerHTML = '<div class="nv-stat-card__header">' +
          (p.icon ? '<span class="nv-stat-card__icon">' + escHtml(p.icon) + '</span>' : '') +
          '<span class="nv-stat-card__label">' + escHtml(p.label || '') + '</span></div>' +
          '<div class="nv-stat-card__value">' + escHtml(String(p.value ?? 0)) +
          (p.unit ? '<span class="nv-stat-card__unit">' + escHtml(p.unit) + '</span>' : '') + '</div>';
      }
      render(props);
      container.appendChild(card);
      return { update(p) { render(p); } };
    },
    'form': ({ container, props, ctx }) => {
      function render(p) {
        container.innerHTML = '<div class="nv-form">' +
          (p.title ? '<h3 class="nv-form__title">' + escHtml(p.title) + '</h3>' : '') +
          '<form class="nv-form__body" novalidate>' +
          (p.fields || []).map(f => {
            const type = f.type === 'select'
              ? '<select class="nv-form__select" name="' + f.id + '">' +
                '<option value="">— Select —</option>' +
                (f.rules?.options || []).map(o => '<option value="' + escHtml(o) + '">' + escHtml(o) + '</option>').join('') +
                '</select>'
              : '<input class="nv-form__input" type="' + (f.type === 'email' ? 'email' : 'text') + '" name="' + f.id + '" placeholder="' + escHtml(f.placeholder || '') + '"/>';
            return '<div class="nv-form__field"><label class="nv-form__label">' + escHtml(f.label || f.id) + '</label>' + type + '</div>';
          }).join('') +
          '<div class="nv-form__actions"><button type="submit" class="nv-btn nv-btn--primary">' + escHtml(p.submitLabel || 'Submit') + '</button></div>' +
          '</form></div>';

        container.querySelector('form')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const formData = {};
          new FormData(e.target).forEach((v, k) => { formData[k] = v; });
          if (p.submitAction) {
            const btn = container.querySelector('[type="submit"]');
            if (btn) btn.disabled = true;
            try { await ctx.dispatcher.dispatch(p.submitAction, formData); e.target.reset(); }
            finally { if (btn) btn.disabled = false; }
          }
        });
      }
      render(props);
      return { update: render };
    },
    'table': ({ container, props, ctx }) => {
      let _unsub = null;
      function render(p) {
        const records = ctx.dataEngine.query(p.collection || '', p.query || {});
        const cols = p.columns || [];
        container.innerHTML = '<div class="nv-table-wrapper">' +
          (p.title ? '<div class="nv-table__header"><h3 class="nv-table__title">' + escHtml(p.title) + '</h3></div>' : '') +
          (records.length === 0
            ? '<div class="nv-table__empty">' + escHtml(p.emptyMessage || 'No records.') + '</div>'
            : '<div class="nv-table__scroll"><table class="nv-table"><thead><tr>' +
              cols.map(c => '<th class="nv-table__th">' + escHtml(c.label || c.id) + '</th>').join('') +
              (p.rowActions?.length ? '<th class="nv-table__th">Actions</th>' : '') +
              '</tr></thead><tbody>' +
              records.map(r => '<tr class="nv-table__row" data-id="' + escHtml(r._id) + '">' +
                cols.map(c => '<td class="nv-table__td">' + escHtml(String(r[c.id] ?? '—')) + '</td>').join('') +
                (p.rowActions?.length ? '<td class="nv-table__td">' +
                  p.rowActions.map(a => '<button class="nv-btn nv-btn--xs nv-btn--' + (a.variant || 'ghost') + '" data-action="' + a.actionId + '" data-id="' + escHtml(r._id) + '">' + escHtml(a.label) + '</button>').join('') +
                  '</td>' : '') +
                '</tr>').join('') +
              '</tbody></table></div>') +
          '</div>';

        container.querySelectorAll('[data-action]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const actionId = btn.getAttribute('data-action');
            const recordId = btn.getAttribute('data-id');
            ctx.dispatcher.dispatch(actionId, { recordId });
          });
        });
      }
      if (_unsub) _unsub();
      if (props.collection) _unsub = ctx.eventBus.on('data:changed:' + props.collection, () => render(props));
      render(props);
      return { update(p) { if (_unsub) _unsub(); if (p.collection) _unsub = ctx.eventBus.on('data:changed:' + p.collection, () => render(p)); render(p); } };
    },
    'list': ({ container, props, ctx }) => {
      let _unsub = null;
      function render(p) {
        const records = ctx.dataEngine.query(p.collection || '', p.query || {});
        const t = p.itemTemplate || {};
        container.innerHTML = '<div class="nv-list">' +
          (p.title ? '<div class="nv-list__header"><h3 class="nv-list__title">' + escHtml(p.title) + '</h3></div>' : '') +
          '<ul class="nv-list__items">' +
          (records.length === 0
            ? '<li class="nv-list__empty">' + escHtml(p.emptyMessage || 'No items.') + '</li>'
            : records.map(r => '<li class="nv-list__item" data-id="' + escHtml(r._id) + '">' +
                '<div class="nv-list__item-content"><div class="nv-list__item-main">' +
                (t.titleField ? '<span class="nv-list__item-title">' + escHtml(String(r[t.titleField] ?? '')) + '</span>' : '') +
                (t.subtitleField ? '<span class="nv-list__item-subtitle">' + escHtml(String(r[t.subtitleField] ?? '')) + '</span>' : '') +
                '</div>' +
                (t.badgeField ? '<span class="nv-badge">' + escHtml(String(r[t.badgeField] ?? '')) + '</span>' : '') +
                '</div>' +
                (p.itemActions?.length ? '<div class="nv-list__item-actions">' +
                  p.itemActions.map(a => '<button class="nv-btn nv-btn--xs nv-btn--' + (a.variant || 'ghost') + '" data-action="' + a.actionId + '" data-id="' + escHtml(r._id) + '">' + escHtml(a.label) + '</button>').join('') +
                  '</div>' : '') +
                '</li>').join('')) +
          '</ul></div>';

        container.querySelectorAll('[data-action]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            ctx.dispatcher.dispatch(btn.getAttribute('data-action'), { recordId: btn.getAttribute('data-id') });
          });
        });
      }
      if (_unsub) _unsub();
      if (props.collection) _unsub = ctx.eventBus.on('data:changed:' + props.collection, () => render(props));
      render(props);
      return { update(p) { if (_unsub) _unsub(); if (p.collection) _unsub = ctx.eventBus.on('data:changed:' + p.collection, () => render(p)); render(p); } };
    },
    'filter': ({ container, props, ctx }) => {
      function render(p) {
        container.innerHTML = '<div class="nv-filter-bar">' +
          (p.filters || []).map(f => {
            if (f.type === 'select') {
              return '<div class="nv-filter-bar__item"><label class="nv-filter-bar__label">' + escHtml(f.label) + '</label>' +
                '<select class="nv-form__select" data-state-path="' + (f.statePath || '') + '">' +
                '<option value="">All</option>' +
                (f.options || []).map(o => '<option value="' + escHtml(o) + '">' + escHtml(o) + '</option>').join('') +
                '</select></div>';
            }
            return '<div class="nv-filter-bar__item"><label class="nv-filter-bar__label">' + escHtml(f.label) + '</label>' +
              '<input class="nv-form__input" type="text" data-state-path="' + (f.statePath || '') + '" placeholder="' + escHtml(f.placeholder || 'Search…') + '"/></div>';
          }).join('') +
          '</div>';
        container.querySelectorAll('[data-state-path]').forEach(el => {
          el.addEventListener('input', () => {
            const path = el.getAttribute('data-state-path');
            if (path) ctx.stateEngine.set(path, el.value || null);
          });
        });
      }
      render(props);
      return { update: render };
    },
  };

  // ── Toast Notification ───────────────────────────────────────────────────────
  function setupToast(eventBus) {
    const container = document.createElement('div');
    container.className = 'nv-toast-container';
    document.body.appendChild(container);

    eventBus.on('runtime:notify', ({ message, type, duration }) => {
      const toast = document.createElement('div');
      toast.className = 'nv-toast nv-toast--' + (type || 'info');
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(() => toast.remove(), duration || 3000);
    });
  }

  // ── Binding Resolution ───────────────────────────────────────────────────────
  function resolveBindings(props, bindings, ctx) {
    const resolved = { ...props };
    for (const [propKey, expr] of Object.entries(bindings || {})) {
      if (typeof expr !== 'string') { resolved[propKey] = expr; continue; }
      if (expr.startsWith('state:')) resolved[propKey] = ctx.stateEngine.get(expr.slice(6));
      else if (expr.startsWith('data:')) resolved[propKey] = ctx.dataEngine.query(expr.slice(5), {});
      else if (expr.startsWith('literal:')) resolved[propKey] = expr.slice(8);
      else resolved[propKey] = expr;
    }
    return resolved;
  }

  // ── Page Renderer ────────────────────────────────────────────────────────────
  function renderPage(page, mountEl, ctx) {
    mountEl.innerHTML = '';
    mountEl.setAttribute('data-page-id', page.id);
    for (const ref of (page.layout || [])) {
      const factory = COMPONENTS[ref.componentType];
      if (!factory) {
        const err = document.createElement('div');
        err.className = 'nv-component-error';
        err.textContent = 'Unknown component: ' + ref.componentType;
        mountEl.appendChild(err);
        continue;
      }
      const wrapper = document.createElement('div');
      wrapper.className = 'nv-component';
      wrapper.setAttribute('data-component-id', ref.componentId);
      const resolvedProps = resolveBindings(ref.props || {}, ref.bindings || {}, ctx);
      factory({ container: wrapper, props: resolvedProps, ctx, componentId: ref.componentId });
      mountEl.appendChild(wrapper);
    }
  }

  // ── Main Boot ────────────────────────────────────────────────────────────────
  function boot() {
    const mountEl = document.getElementById('nv-app');
    if (!mountEl) { console.error('[Nuvra] #nv-app not found'); return; }

    const schema = __NUVRA_SCHEMA__;
    const eventBus = createEventBus();
    const stateEngine = createStateEngine(schema.state, eventBus);
    const dataEngine = createDataEngine(schema.collections, eventBus);

    const ctx = { stateEngine, dataEngine, eventBus, _payload: null };
    ctx.dispatcher = createActionDispatcher(schema.actions, ctx);

    setupToast(eventBus);

    const pageEl = document.createElement('div');
    pageEl.className = 'nv-app-page';
    mountEl.appendChild(pageEl);

    // Render first page
    const firstPage = schema.pages?.[0];
    if (firstPage) renderPage(firstPage, pageEl, ctx);

    // Handle navigation
    eventBus.on('runtime:navigate', ({ pageId }) => {
      const page = schema.pages?.find(p => p.id === pageId);
      if (page) renderPage(page, pageEl, ctx);
    });

    if (__NUVRA_CONFIG__.debug) {
      console.log('[Nuvra Runtime] Booted', { schema: schema.name, target: __NUVRA_CONFIG__.target });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(typeof window !== 'undefined' ? window : globalThis);
`;
}

export default generateRuntimeScript;
