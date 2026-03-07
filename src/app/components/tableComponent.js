/**
 * tableComponent.js — Nuvra Phase 3
 *
 * The Table Component.
 *
 * A query-driven, reactive table that:
 *  - Reads data from a collection via the DataEngine
 *  - Re-renders automatically when the collection changes
 *  - Supports column definitions, sorting, and row actions
 *  - Dispatches actions on row events (select, delete, edit)
 *
 * Props:
 *   collection    — collection ID to query
 *   columns       — array of { id, label, type? } column definitions
 *   query         — optional DataEngine query object
 *   rowActions    — array of { label, actionId, variant? } per-row actions
 *   onRowSelect   — action ID to dispatch when a row is clicked
 *   emptyMessage  — message when no records exist
 *   title         — table title
 *
 * @module app/components/tableComponent
 */
'use strict';

export function TableComponent({ container, props, context, componentId }) {
  let _props = props;
  let _sortField = null;
  let _sortDir   = 'asc';
  let _unsub     = null;

  function _getData() {
    const { collection, query = {} } = _props;
    if (!collection) return [];
    const q = { ...query };
    if (_sortField) { q.orderBy = _sortField; q.order = _sortDir; }
    return context.query(collection, q);
  }

  function _render() {
    const { columns = [], rowActions = [], title, emptyMessage = 'No records found.' } = _props;
    const records = _getData();

    container.innerHTML = `
      <div class="nv-table-wrapper" data-component-id="${componentId}">
        ${title ? `<div class="nv-table__header"><h3 class="nv-table__title">${_esc(title)}</h3></div>` : ''}
        ${records.length === 0
          ? `<div class="nv-table__empty">${_esc(emptyMessage)}</div>`
          : `<div class="nv-table__scroll">
              <table class="nv-table">
                <thead>
                  <tr>
                    ${columns.map(col => `
                      <th class="nv-table__th ${_sortField === col.id ? 'nv-table__th--sorted' : ''}"
                          data-sort="${col.id}">
                        ${_esc(col.label || col.id)}
                        ${_sortField === col.id ? (_sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                      </th>
                    `).join('')}
                    ${rowActions.length > 0 ? '<th class="nv-table__th nv-table__th--actions">Actions</th>' : ''}
                  </tr>
                </thead>
                <tbody>
                  ${records.map(record => `
                    <tr class="nv-table__row" data-record-id="${_esc(record._id)}">
                      ${columns.map(col => `
                        <td class="nv-table__td">${_renderCell(record[col.id], col)}</td>
                      `).join('')}
                      ${rowActions.length > 0 ? `
                        <td class="nv-table__td nv-table__td--actions">
                          ${rowActions.map(action => `
                            <button class="nv-btn nv-btn--xs nv-btn--${action.variant || 'ghost'}"
                              data-action="${action.actionId}"
                              data-record-id="${_esc(record._id)}">
                              ${_esc(action.label)}
                            </button>
                          `).join('')}
                        </td>
                      ` : ''}
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>`
        }
      </div>
    `;

    _bindEvents();
  }

  function _renderCell(value, col) {
    if (value === null || value === undefined) return '<span class="nv-table__null">—</span>';
    switch (col.type) {
      case 'boolean':
        return value
          ? '<span class="nv-badge nv-badge--success">Yes</span>'
          : '<span class="nv-badge nv-badge--neutral">No</span>';
      case 'date':
        return value ? new Date(value).toLocaleDateString() : '—';
      case 'select':
        return `<span class="nv-badge">${_esc(String(value))}</span>`;
      default:
        return _esc(String(value));
    }
  }

  function _bindEvents() {
    // Sort headers
    container.querySelectorAll('[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const field = th.getAttribute('data-sort');
        if (_sortField === field) {
          _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          _sortField = field;
          _sortDir   = 'asc';
        }
        _render();
      });
    });

    // Row click → onRowSelect action
    if (_props.onRowSelect) {
      container.querySelectorAll('.nv-table__row').forEach(row => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('[data-action]')) return; // don't fire for action buttons
          const recordId = row.getAttribute('data-record-id');
          const record = context.query(_props.collection, {}).find(r => r._id === recordId);
          context.dispatch(_props.onRowSelect, { record, recordId });
        });
      });
    }

    // Row action buttons
    container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const actionId  = btn.getAttribute('data-action');
        const recordId  = btn.getAttribute('data-record-id');
        const record    = context.query(_props.collection, {}).find(r => r._id === recordId);
        context.dispatch(actionId, { record, recordId });
      });
    });
  }

  function _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Subscribe to collection changes for reactive re-render
  if (_props.collection) {
    _unsub = context.on(`data:changed:${_props.collection}`, () => _render());
  }

  _render();

  return {
    update(newProps) {
      if (_unsub) _unsub();
      _props = newProps;
      if (_props.collection) {
        _unsub = context.on(`data:changed:${_props.collection}`, () => _render());
      }
      _render();
    },
    destroy() {
      if (_unsub) _unsub();
      container.innerHTML = '';
    },
  };
}

export default TableComponent;
