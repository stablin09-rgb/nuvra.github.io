/**
 * Nuvra Builder — App Components
 *
 * A library of data-aware components for building web applications.
 * These components are distinct from GrapesJS blocks — they are
 * schema-driven and connect to the DataStore and StateManager.
 *
 * Each component:
 *  - Has a schema definition (type, fields, actions)
 *  - Renders to HTML with data-nv-* attributes for runtime hydration
 *  - Is registered as a GrapesJS block for drag-and-drop use
 *
 * Component types:
 *  - data-table:   Display records from a collection in a table
 *  - data-form:    Create or update records in a collection
 *  - data-list:    Display records as a card list
 *  - stat-card:    Display a single aggregate value
 *  - conditional:  Show/hide content based on state
 */

'use strict';

import { dataStore }    from '../data/dataModel.js';
import { stateManager } from '../state/stateManager.js';

// ─── Component Type Registry ──────────────────────────────────────────────────

export const APP_COMPONENT_TYPES = {
  DATA_TABLE:   'data-table',
  DATA_FORM:    'data-form',
  DATA_LIST:    'data-list',
  STAT_CARD:    'stat-card',
  CONDITIONAL:  'conditional',
};

// ─── HTML Templates ───────────────────────────────────────────────────────────

/**
 * Generate the HTML template for a data-table component.
 *
 * @param {object} config
 * @param {string} config.collection  - Collection ID
 * @param {string[]} [config.columns] - Field IDs to display
 * @param {string} [config.title]
 * @returns {string} HTML
 */
export function renderDataTable(config = {}) {
  const { collection = '', columns = [], title = 'Records' } = config;
  const colsAttr = columns.length ? columns.join(',') : '';

  return `
<div
  data-nv-component="data-table"
  data-nv-collection="${collection}"
  data-nv-columns="${colsAttr}"
  style="background:#fff; border:1px solid #e5e7eb; border-radius:10px; overflow:hidden; font-family:system-ui,sans-serif;"
>
  <div style="padding:16px 20px; border-bottom:1px solid #f0f0f0; display:flex; justify-content:space-between; align-items:center;">
    <h3 style="margin:0; font-size:15px; font-weight:600; color:#111;">${title}</h3>
    <span data-nv-bind="count:${collection}" style="font-size:12px; color:#888; background:#f5f5f5; padding:2px 8px; border-radius:20px;">0 records</span>
  </div>
  <div style="overflow-x:auto;">
    <table style="width:100%; border-collapse:collapse; font-size:13px;">
      <thead>
        <tr data-nv-table-header style="background:#f9fafb;">
          <th style="padding:10px 16px; text-align:left; font-weight:600; color:#374151; border-bottom:1px solid #e5e7eb;">Loading…</th>
        </tr>
      </thead>
      <tbody data-nv-table-body>
        <tr>
          <td style="padding:12px 16px; color:#9ca3af; text-align:center;">No data yet</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>`.trim();
}

/**
 * Generate the HTML template for a data-form component.
 *
 * @param {object} config
 * @param {string} config.collection  - Collection ID
 * @param {string} [config.title]
 * @param {string} [config.submitLabel]
 * @returns {string} HTML
 */
export function renderDataForm(config = {}) {
  const { collection = '', title = 'Add Record', submitLabel = 'Submit' } = config;

  return `
<div
  data-nv-component="data-form"
  data-nv-collection="${collection}"
  style="background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:24px; font-family:system-ui,sans-serif;"
>
  <h3 style="margin:0 0 20px; font-size:15px; font-weight:600; color:#111;">${title}</h3>
  <form data-nv-action-type="submit" data-nv-collection="${collection}">
    <div data-nv-form-fields style="display:flex; flex-direction:column; gap:14px;">
      <p style="color:#9ca3af; font-size:13px; margin:0;">Fields will appear here based on the collection schema.</p>
    </div>
    <div style="margin-top:20px; display:flex; gap:10px; justify-content:flex-end;">
      <button type="reset" style="padding:8px 16px; background:#f5f5f5; border:1px solid #e0e0e0; border-radius:6px; font-size:13px; cursor:pointer;">Clear</button>
      <button type="submit" style="padding:8px 20px; background:#7c6af7; color:#fff; border:none; border-radius:6px; font-size:13px; font-weight:600; cursor:pointer;">${submitLabel}</button>
    </div>
  </form>
</div>`.trim();
}

/**
 * Generate the HTML template for a data-list component.
 *
 * @param {object} config
 * @param {string} config.collection
 * @param {string} [config.titleField]  - Field to use as card title
 * @param {string} [config.bodyField]   - Field to use as card body
 * @param {string} [config.title]
 * @returns {string} HTML
 */
export function renderDataList(config = {}) {
  const { collection = '', titleField = '', bodyField = '', title = 'Items' } = config;

  return `
<div
  data-nv-component="data-list"
  data-nv-collection="${collection}"
  data-nv-title-field="${titleField}"
  data-nv-body-field="${bodyField}"
  style="font-family:system-ui,sans-serif;"
>
  <h3 style="margin:0 0 16px; font-size:15px; font-weight:600; color:#111;">${title}</h3>
  <div data-nv-list-body style="display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:14px;">
    <div style="background:#f9fafb; border:1px dashed #e0e0e0; border-radius:8px; padding:20px; text-align:center; color:#9ca3af; font-size:13px;">
      No records yet
    </div>
  </div>
</div>`.trim();
}

/**
 * Generate the HTML template for a stat-card component.
 *
 * @param {object} config
 * @param {string} config.collection
 * @param {string} [config.aggregation]  - 'count' | 'sum' | 'avg'
 * @param {string} [config.field]        - Field to aggregate (for sum/avg)
 * @param {string} [config.label]
 * @param {string} [config.icon]
 * @param {string} [config.color]
 * @returns {string} HTML
 */
export function renderStatCard(config = {}) {
  const {
    collection  = '',
    aggregation = 'count',
    field       = '',
    label       = 'Total Records',
    icon        = '📊',
    color       = '#7c6af7',
  } = config;

  return `
<div
  data-nv-component="stat-card"
  data-nv-collection="${collection}"
  data-nv-aggregation="${aggregation}"
  data-nv-field="${field}"
  style="background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:24px; font-family:system-ui,sans-serif; display:flex; align-items:center; gap:16px;"
>
  <div style="width:48px; height:48px; background:${color}20; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:24px; flex-shrink:0;">${icon}</div>
  <div>
    <div data-nv-stat-value style="font-size:32px; font-weight:800; color:#111; line-height:1;">—</div>
    <div style="font-size:13px; color:#6b7280; margin-top:4px;">${label}</div>
  </div>
</div>`.trim();
}

/**
 * Generate the HTML template for a conditional component.
 *
 * @param {object} config
 * @param {string} config.stateKey    - State key to check
 * @param {*}      config.stateValue  - Value to compare against
 * @param {string} [config.operator]  - 'eq' | 'neq' | 'gt' | 'lt' | 'truthy'
 * @returns {string} HTML
 */
export function renderConditional(config = {}) {
  const { stateKey = '', stateValue = '', operator = 'truthy' } = config;

  return `
<div
  data-nv-component="conditional"
  data-nv-state-key="${stateKey}"
  data-nv-state-value="${stateValue}"
  data-nv-operator="${operator}"
  style="border:2px dashed #e5e7eb; border-radius:8px; padding:16px; min-height:60px;"
>
  <p style="color:#9ca3af; font-size:12px; margin:0; text-align:center;">
    Conditional block — shows when <strong>${stateKey}</strong> is <strong>${operator === 'truthy' ? 'truthy' : `${operator} "${stateValue}"`}</strong>
  </p>
</div>`.trim();
}

// ─── GrapesJS Block Registration ─────────────────────────────────────────────

/**
 * Register all app components as GrapesJS blocks.
 *
 * @param {object} editor - GrapesJS editor instance
 */
export function registerAppBlocks(editor) {
  const bm = editor.BlockManager;

  bm.add('nv-data-table', {
    label:    'Data Table',
    category: 'App Components',
    content:  renderDataTable({ collection: '', title: 'My Table' }),
    attributes: { class: 'fa fa-table' },
  });

  bm.add('nv-data-form', {
    label:    'Data Form',
    category: 'App Components',
    content:  renderDataForm({ collection: '', title: 'Add Record' }),
    attributes: { class: 'fa fa-wpforms' },
  });

  bm.add('nv-data-list', {
    label:    'Data List',
    category: 'App Components',
    content:  renderDataList({ collection: '', title: 'Records' }),
    attributes: { class: 'fa fa-list' },
  });

  bm.add('nv-stat-card', {
    label:    'Stat Card',
    category: 'App Components',
    content:  renderStatCard({ collection: '', label: 'Total Records' }),
    attributes: { class: 'fa fa-bar-chart' },
  });

  bm.add('nv-conditional', {
    label:    'Conditional Block',
    category: 'App Components',
    content:  renderConditional({ stateKey: 'isLoggedIn' }),
    attributes: { class: 'fa fa-code-fork' },
  });
}

// ─── Runtime Hydration ────────────────────────────────────────────────────────

/**
 * Hydrate all app components on a page.
 * Called by the AppRuntime when a page is loaded.
 *
 * @param {HTMLElement} container - The page container element
 * @param {string} pageId
 */
export function hydrateAppComponents(container, pageId) {
  const components = container.querySelectorAll('[data-nv-component]');

  components.forEach((el) => {
    const type = el.dataset.nvComponent;
    switch (type) {
      case APP_COMPONENT_TYPES.DATA_TABLE:   _hydrateTable(el);       break;
      case APP_COMPONENT_TYPES.DATA_FORM:    _hydrateForm(el);        break;
      case APP_COMPONENT_TYPES.DATA_LIST:    _hydrateList(el);        break;
      case APP_COMPONENT_TYPES.STAT_CARD:    _hydrateStatCard(el);    break;
      case APP_COMPONENT_TYPES.CONDITIONAL:  _hydrateConditional(el); break;
    }
  });
}

// ─── Private Hydration Helpers ────────────────────────────────────────────────

function _hydrateTable(el) {
  const collectionId = el.dataset.nvCollection;
  if (!collectionId) return;

  const schema  = dataStore.getSchema(collectionId);
  const records = dataStore.findAll(collectionId);

  const headerRow = el.querySelector('[data-nv-table-header]');
  const tbody     = el.querySelector('[data-nv-table-body]');
  const countEl   = el.querySelector('[data-nv-bind]');

  if (!schema) {
    if (tbody) tbody.innerHTML = `<tr><td style="padding:12px;color:#9ca3af;text-align:center;" colspan="99">Collection "${collectionId}" not found.</td></tr>`;
    return;
  }

  const displayFields = schema.fields.filter((f) => !f.system);

  // Render header
  if (headerRow) {
    headerRow.innerHTML = displayFields.map((f) =>
      `<th style="padding:10px 16px; text-align:left; font-weight:600; color:#374151; border-bottom:1px solid #e5e7eb;">${f.name}</th>`
    ).join('') + '<th style="padding:10px 16px; border-bottom:1px solid #e5e7eb;"></th>';
  }

  // Render body
  if (tbody) {
    if (records.length === 0) {
      tbody.innerHTML = `<tr><td style="padding:16px; color:#9ca3af; text-align:center;" colspan="${displayFields.length + 1}">No records yet. Use a form to add data.</td></tr>`;
    } else {
      tbody.innerHTML = records.map((r) => `
        <tr style="border-bottom:1px solid #f5f5f5;">
          ${displayFields.map((f) => `<td style="padding:10px 16px; color:#374151; font-size:13px;">${r[f.id] ?? '—'}</td>`).join('')}
          <td style="padding:10px 16px; text-align:right;">
            <button
              data-nv-action-type="delete"
              data-nv-collection="${collectionId}"
              data-nv-record-id="${r._id}"
              style="padding:4px 10px; background:#fee2e2; color:#dc2626; border:none; border-radius:4px; font-size:11px; cursor:pointer;"
            >Delete</button>
          </td>
        </tr>`).join('');
    }
  }

  // Update count badge
  if (countEl) countEl.textContent = `${records.length} record${records.length !== 1 ? 's' : ''}`;

  // Subscribe to future changes
  dataStore.subscribe(collectionId, () => _hydrateTable(el));
}

function _hydrateForm(el) {
  const collectionId = el.dataset.nvCollection;
  if (!collectionId) return;

  const schema     = dataStore.getSchema(collectionId);
  const fieldsDiv  = el.querySelector('[data-nv-form-fields]');
  const form       = el.querySelector('form');

  if (!schema || !fieldsDiv) return;

  const displayFields = schema.fields.filter((f) => !f.system);

  fieldsDiv.innerHTML = displayFields.map((f) => `
    <div>
      <label style="display:block; font-size:12px; font-weight:600; color:#374151; margin-bottom:4px;">${f.name}${f.required ? ' *' : ''}</label>
      <input
        type="${f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : 'text'}"
        name="${f.id}"
        placeholder="${f.name}"
        ${f.required ? 'required' : ''}
        style="width:100%; padding:8px 12px; border:1px solid #d1d5db; border-radius:6px; font-size:13px; box-sizing:border-box;"
      />
    </div>`).join('');

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = {};
      new FormData(form).forEach((value, key) => { formData[key] = value; });
      dataStore.insert(collectionId, formData);
      form.reset();
    });
  }
}

function _hydrateList(el) {
  const collectionId = el.dataset.nvCollection;
  const titleField   = el.dataset.nvTitleField;
  const bodyField    = el.dataset.nvBodyField;
  if (!collectionId) return;

  const records  = dataStore.findAll(collectionId);
  const listBody = el.querySelector('[data-nv-list-body]');
  if (!listBody) return;

  if (records.length === 0) {
    listBody.innerHTML = `<div style="background:#f9fafb; border:1px dashed #e0e0e0; border-radius:8px; padding:20px; text-align:center; color:#9ca3af; font-size:13px;">No records yet</div>`;
    return;
  }

  listBody.innerHTML = records.map((r) => `
    <div style="background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:16px;">
      <div style="font-weight:600; font-size:14px; color:#111; margin-bottom:6px;">${r[titleField] || r._id}</div>
      ${bodyField && r[bodyField] ? `<div style="font-size:13px; color:#6b7280;">${r[bodyField]}</div>` : ''}
    </div>`).join('');

  dataStore.subscribe(collectionId, () => _hydrateList(el));
}

function _hydrateStatCard(el) {
  const collectionId = el.dataset.nvCollection;
  const aggregation  = el.dataset.nvAggregation || 'count';
  const field        = el.dataset.nvField;
  const valueEl      = el.querySelector('[data-nv-stat-value]');
  if (!valueEl) return;

  const records = dataStore.findAll(collectionId);

  let value;
  switch (aggregation) {
    case 'count': value = records.length; break;
    case 'sum':   value = records.reduce((acc, r) => acc + (Number(r[field]) || 0), 0); break;
    case 'avg':   value = records.length ? (records.reduce((acc, r) => acc + (Number(r[field]) || 0), 0) / records.length).toFixed(1) : 0; break;
    default:      value = records.length;
  }

  valueEl.textContent = value;
  dataStore.subscribe(collectionId, () => _hydrateStatCard(el));
}

function _hydrateConditional(el) {
  const stateKey   = el.dataset.nvStateKey;
  const stateValue = el.dataset.nvStateValue;
  const operator   = el.dataset.nvOperator || 'truthy';

  if (!stateKey) return;

  const evaluate = () => {
    const current = stateManager.getApp(stateKey);
    let show = false;

    switch (operator) {
      case 'truthy': show = !!current; break;
      case 'eq':     show = String(current) === String(stateValue); break;
      case 'neq':    show = String(current) !== String(stateValue); break;
      case 'gt':     show = Number(current) > Number(stateValue); break;
      case 'lt':     show = Number(current) < Number(stateValue); break;
      default:       show = !!current;
    }

    // Hide the dashed placeholder text; show/hide the actual content
    const placeholder = el.querySelector('p');
    if (placeholder) placeholder.style.display = 'none';
    el.style.opacity = show ? '1' : '0.3';
    el.style.pointerEvents = show ? '' : 'none';
  };

  evaluate();
  stateManager.subscribeApp(stateKey, evaluate);
}
