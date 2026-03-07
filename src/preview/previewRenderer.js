/**
 * Nuvra Builder — Preview Renderer
 *
 * Assembles a complete, self-contained HTML document for preview.
 * This document is loaded into a sandboxed iframe in Preview Mode.
 *
 * Two rendering paths:
 *  - Marketing pages: Clean static HTML + CSS, no runtime needed.
 *  - App pages:       HTML + CSS + embedded data snapshot + PreviewRuntime IIFE.
 *
 * The output of this renderer is the canonical "what the user will get"
 * representation. The PublishRenderer derives from this but strips
 * all editor-facing artifacts.
 */

'use strict';

import { dataStore }    from '../data/dataModel.js';
import { stateManager } from '../state/stateManager.js';
import { PAGE_TYPES }   from '../core/pageSemantics.js';

// ─── Preview Renderer ─────────────────────────────────────────────────────────

/**
 * Build a complete preview HTML document for a page.
 *
 * @param {object} page         - Page object from pageManager
 * @param {object} projectMeta  - { name, accent }
 * @returns {string}            - Full HTML document string
 */
export function buildPreviewDocument(page, projectMeta = {}) {
  const isApp = page.pageType === PAGE_TYPES.APP ||
                page.pageType === PAGE_TYPES.DASHBOARD ||
                page.pageType === PAGE_TYPES.CRUD;

  const html    = page.html    || '<p style="padding:40px;color:#888;text-align:center;">This page is empty.</p>';
  const css     = page.css     || '';
  const title   = page.name    || 'Page';
  const accent  = projectMeta.accent || '#7c6af7';

  const baseStyles = `
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }
    img  { max-width: 100%; height: auto; }
    a    { color: ${accent}; }
  `;

  if (!isApp) {
    // ── Marketing page: pure static render ──────────────────────────────────
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${_escape(title)}</title>
  <style>${baseStyles}${css}</style>
</head>
<body>
${html}
</body>
</html>`;
  }

  // ── App page: include data snapshot + runtime ────────────────────────────
  const dataSnapshot  = JSON.stringify(dataStore.toJSON());
  const stateSnapshot = JSON.stringify(stateManager.toJSON());
  const runtimeScript = _getPreviewRuntimeScript();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${_escape(title)}</title>
  <style>${baseStyles}${css}</style>
</head>
<body>
${html}

<!-- Nuvra Preview Runtime -->
<script id="nv-data-snapshot" type="application/json">${dataSnapshot}</script>
<script id="nv-state-snapshot" type="application/json">${stateSnapshot}</script>
<script>
/* Nuvra Preview Runtime v1 */
${runtimeScript}
</script>
</body>
</html>`;
}

// ─── Inline Preview Runtime ───────────────────────────────────────────────────
// A minimal, self-contained runtime that runs inside the preview iframe.
// It reads the data/state snapshots and hydrates the app components.

function _getPreviewRuntimeScript() {
  return `
(function() {
  'use strict';

  // ── Restore data store ───────────────────────────────────────────────────
  var dataSnapshotEl  = document.getElementById('nv-data-snapshot');
  var stateSnapshotEl = document.getElementById('nv-state-snapshot');
  var dataSnapshot    = dataSnapshotEl  ? JSON.parse(dataSnapshotEl.textContent)  : {};
  var stateSnapshot   = stateSnapshotEl ? JSON.parse(stateSnapshotEl.textContent) : {};

  // In-memory store (simplified for preview)
  var _schemas = dataSnapshot.schemas || {};
  var _records = {};
  var _state   = stateSnapshot.app || {};
  var _idCounter = dataSnapshot.idCounter || 1;
  var _listeners = {};

  Object.keys(dataSnapshot.records || {}).forEach(function(id) {
    _records[id] = {};
    (dataSnapshot.records[id] || []).forEach(function(r) { _records[id][r._id] = r; });
  });

  function _getRecords(cid) {
    if (!_records[cid]) _records[cid] = {};
    return _records[cid];
  }

  function _emit(cid, type, record) {
    (_listeners[cid] || []).forEach(function(fn) { try { fn({ collectionId: cid, type: type, record: record }); } catch(e) {} });
    (_listeners['*'] || []).forEach(function(fn) { try { fn({ collectionId: cid, type: type, record: record }); } catch(e) {} });
  }

  var store = {
    getSchema: function(cid) { return _schemas[cid]; },
    findAll:   function(cid) { return Object.values(_getRecords(cid)); },
    count:     function(cid) { return Object.keys(_getRecords(cid)).length; },
    insert:    function(cid, data) {
      var r = Object.assign({}, data, { _id: cid + '-' + (_idCounter++), _createdAt: new Date().toISOString(), _updatedAt: new Date().toISOString() });
      _getRecords(cid)[r._id] = r;
      _emit(cid, 'insert', r);
      return r;
    },
    delete: function(cid, id) {
      delete _getRecords(cid)[id];
      _emit(cid, 'delete', { _id: id });
    },
    subscribe: function(cid, fn) {
      if (!_listeners[cid]) _listeners[cid] = [];
      _listeners[cid].push(fn);
    },
  };

  var stateListeners = {};
  var state = {
    get: function(key) { return _state[key]; },
    set: function(key, val) {
      _state[key] = val;
      (_stateListeners[key] || []).forEach(function(fn) { try { fn(val); } catch(e) {} });
    },
    subscribe: function(key, fn) {
      if (!_stateListeners[key]) _stateListeners[key] = [];
      _stateListeners[key].push(fn);
    },
  };
  var _stateListeners = {};

  // ── Hydrate components ───────────────────────────────────────────────────

  function hydrateTable(el) {
    var cid     = el.dataset.nvCollection;
    var schema  = store.getSchema(cid);
    var records = store.findAll(cid);
    var header  = el.querySelector('[data-nv-table-header]');
    var tbody   = el.querySelector('[data-nv-table-body]');
    var countEl = el.querySelector('[data-nv-bind]');

    if (!schema) {
      if (tbody) tbody.innerHTML = '<tr><td style="padding:12px;color:#9ca3af;text-align:center;" colspan="99">Collection not found.</td></tr>';
      return;
    }

    var fields = (schema.fields || []).filter(function(f) { return !f.system; });

    if (header) {
      header.innerHTML = fields.map(function(f) {
        return '<th style="padding:10px 16px;text-align:left;font-weight:600;color:#374151;border-bottom:1px solid #e5e7eb;">' + f.name + '</th>';
      }).join('') + '<th style="padding:10px 16px;border-bottom:1px solid #e5e7eb;"></th>';
    }

    if (tbody) {
      if (records.length === 0) {
        tbody.innerHTML = '<tr><td style="padding:16px;color:#9ca3af;text-align:center;" colspan="' + (fields.length + 1) + '">No records yet.</td></tr>';
      } else {
        tbody.innerHTML = records.map(function(r) {
          return '<tr style="border-bottom:1px solid #f5f5f5;">' +
            fields.map(function(f) { return '<td style="padding:10px 16px;color:#374151;font-size:13px;">' + (r[f.id] !== undefined ? r[f.id] : '—') + '</td>'; }).join('') +
            '<td style="padding:10px 16px;text-align:right;"><button data-nv-action-type="delete" data-nv-collection="' + cid + '" data-nv-record-id="' + r._id + '" style="padding:4px 10px;background:#fee2e2;color:#dc2626;border:none;border-radius:4px;font-size:11px;cursor:pointer;">Delete</button></td>' +
            '</tr>';
        }).join('');
      }
    }

    if (countEl) countEl.textContent = records.length + ' record' + (records.length !== 1 ? 's' : '');
    store.subscribe(cid, function() { hydrateTable(el); });
  }

  function hydrateForm(el) {
    var cid    = el.dataset.nvCollection;
    var schema = store.getSchema(cid);
    var fields_div = el.querySelector('[data-nv-form-fields]');
    var form   = el.querySelector('form');
    if (!schema || !fields_div) return;

    var fields = (schema.fields || []).filter(function(f) { return !f.system; });
    fields_div.innerHTML = fields.map(function(f) {
      return '<div><label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">' + f.name + (f.required ? ' *' : '') + '</label>' +
        '<input type="' + (f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : 'text') + '" name="' + f.id + '" placeholder="' + f.name + '" ' + (f.required ? 'required' : '') + ' style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;"/></div>';
    }).join('');

    if (form) {
      form.addEventListener('submit', function(e) {
        e.preventDefault();
        var data = {};
        new FormData(form).forEach(function(v, k) { data[k] = v; });
        store.insert(cid, data);
        form.reset();
        // Refresh all tables bound to this collection
        document.querySelectorAll('[data-nv-component="data-table"][data-nv-collection="' + cid + '"]').forEach(hydrateTable);
        document.querySelectorAll('[data-nv-component="stat-card"][data-nv-collection="' + cid + '"]').forEach(hydrateStatCard);
      });
    }
  }

  function hydrateStatCard(el) {
    var cid     = el.dataset.nvCollection;
    var agg     = el.dataset.nvAggregation || 'count';
    var field   = el.dataset.nvField;
    var valueEl = el.querySelector('[data-nv-stat-value]');
    if (!valueEl) return;
    var records = store.findAll(cid);
    var value;
    if (agg === 'count')     value = records.length;
    else if (agg === 'sum')  value = records.reduce(function(a, r) { return a + (Number(r[field]) || 0); }, 0);
    else if (agg === 'avg')  value = records.length ? (records.reduce(function(a, r) { return a + (Number(r[field]) || 0); }, 0) / records.length).toFixed(1) : 0;
    else                     value = records.length;
    valueEl.textContent = value;
    store.subscribe(cid, function() { hydrateStatCard(el); });
  }

  function hydrateConditional(el) {
    var key      = el.dataset.nvStateKey;
    var val      = el.dataset.nvStateValue;
    var operator = el.dataset.nvOperator || 'truthy';
    if (!key) return;
    var evaluate = function() {
      var current = state.get(key);
      var show = false;
      if (operator === 'truthy')    show = !!current;
      else if (operator === 'eq')   show = String(current) === String(val);
      else if (operator === 'neq')  show = String(current) !== String(val);
      else if (operator === 'gt')   show = Number(current) > Number(val);
      else if (operator === 'lt')   show = Number(current) < Number(val);
      else                          show = !!current;
      el.style.opacity       = show ? '1' : '0.3';
      el.style.pointerEvents = show ? '' : 'none';
    };
    evaluate();
    state.subscribe(key, evaluate);
  }

  // ── Delete button delegation ─────────────────────────────────────────────
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-nv-action-type="delete"]');
    if (!btn) return;
    var cid = btn.dataset.nvCollection;
    var rid = btn.dataset.nvRecordId;
    if (cid && rid) {
      store.delete(cid, rid);
      document.querySelectorAll('[data-nv-component="data-table"][data-nv-collection="' + cid + '"]').forEach(hydrateTable);
      document.querySelectorAll('[data-nv-component="stat-card"][data-nv-collection="' + cid + '"]').forEach(hydrateStatCard);
    }
  });

  // ── Run hydration ────────────────────────────────────────────────────────
  document.querySelectorAll('[data-nv-component="data-table"]').forEach(hydrateTable);
  document.querySelectorAll('[data-nv-component="data-form"]').forEach(hydrateForm);
  document.querySelectorAll('[data-nv-component="stat-card"]').forEach(hydrateStatCard);
  document.querySelectorAll('[data-nv-component="conditional"]').forEach(hydrateConditional);

})();
`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _escape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
