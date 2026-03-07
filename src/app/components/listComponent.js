/**
 * listComponent.js — Nuvra Phase 3
 *
 * The List Component.
 *
 * A reactive list that renders records from a collection.
 * Each item can have a template (title, subtitle, badge, actions).
 *
 * Props:
 *   collection   — collection ID to query
 *   query        — optional query object
 *   itemTemplate — { titleField, subtitleField, badgeField, badgeColorField }
 *   onItemClick  — action ID to dispatch when an item is clicked
 *   itemActions  — array of { label, actionId, variant? }
 *   emptyMessage — message when no records exist
 *   title        — list title
 *
 * @module app/components/listComponent
 */
'use strict';

export function ListComponent({ container, props, context, componentId }) {
  let _props = props;
  let _unsub = null;

  function _getData() {
    const { collection, query = {} } = _props;
    if (!collection) return [];
    return context.query(collection, query);
  }

  function _render() {
    const { itemTemplate = {}, itemActions = [], title, emptyMessage = 'No items.' } = _props;
    const records = _getData();

    container.innerHTML = `
      <div class="nv-list" data-component-id="${componentId}">
        ${title ? `<div class="nv-list__header"><h3 class="nv-list__title">${_esc(title)}</h3></div>` : ''}
        <ul class="nv-list__items">
          ${records.length === 0
            ? `<li class="nv-list__empty">${_esc(emptyMessage)}</li>`
            : records.map(record => `
              <li class="nv-list__item" data-record-id="${_esc(record._id)}">
                <div class="nv-list__item-content">
                  <div class="nv-list__item-main">
                    ${itemTemplate.titleField
                      ? `<span class="nv-list__item-title">${_esc(String(record[itemTemplate.titleField] ?? ''))}</span>`
                      : ''}
                    ${itemTemplate.subtitleField
                      ? `<span class="nv-list__item-subtitle">${_esc(String(record[itemTemplate.subtitleField] ?? ''))}</span>`
                      : ''}
                  </div>
                  ${itemTemplate.badgeField
                    ? `<span class="nv-badge nv-badge--${record[itemTemplate.badgeColorField] || 'neutral'}">
                        ${_esc(String(record[itemTemplate.badgeField] ?? ''))}
                       </span>`
                    : ''}
                </div>
                ${itemActions.length > 0 ? `
                  <div class="nv-list__item-actions">
                    ${itemActions.map(action => `
                      <button class="nv-btn nv-btn--xs nv-btn--${action.variant || 'ghost'}"
                        data-action="${action.actionId}"
                        data-record-id="${_esc(record._id)}">
                        ${_esc(action.label)}
                      </button>
                    `).join('')}
                  </div>
                ` : ''}
              </li>
            `).join('')}
        </ul>
      </div>
    `;

    _bindEvents();
  }

  function _bindEvents() {
    if (_props.onItemClick) {
      container.querySelectorAll('.nv-list__item').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.closest('[data-action]')) return;
          const recordId = item.getAttribute('data-record-id');
          const record = _getData().find(r => r._id === recordId);
          context.dispatch(_props.onItemClick, { record, recordId });
        });
      });
    }

    container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const actionId = btn.getAttribute('data-action');
        const recordId = btn.getAttribute('data-record-id');
        const record   = _getData().find(r => r._id === recordId);
        context.dispatch(actionId, { record, recordId });
      });
    });
  }

  function _esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

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

export default ListComponent;
