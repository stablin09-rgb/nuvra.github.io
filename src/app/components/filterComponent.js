/**
 * filterComponent.js — Nuvra Phase 3
 *
 * The Filter Component.
 *
 * A state-driven filter bar. Each filter control writes to a state path.
 * Other components (Table, List) read from those state paths in their queries.
 *
 * Props:
 *   filters — array of filter definitions:
 *     { id, label, type: 'select'|'text'|'boolean', options?, statePath }
 *   onFilter — optional action ID to dispatch when any filter changes
 *
 * @module app/components/filterComponent
 */
'use strict';

export function FilterComponent({ container, props, context, componentId }) {
  let _props = props;

  function _render() {
    const { filters = [] } = _props;

    container.innerHTML = `
      <div class="nv-filter-bar" data-component-id="${componentId}">
        ${filters.map(f => _renderFilter(f)).join('')}
        <button class="nv-btn nv-btn--ghost nv-btn--sm nv-filter-bar__clear" data-clear>
          Clear filters
        </button>
      </div>
    `;

    _bindEvents();
  }

  function _renderFilter(f) {
    const currentValue = f.statePath ? (context.getState(f.statePath) ?? '') : '';

    switch (f.type) {
      case 'select':
        return `
          <div class="nv-filter-bar__item">
            <label class="nv-filter-bar__label">${_esc(f.label)}</label>
            <select class="nv-form__select nv-filter-bar__select" data-filter-id="${f.id}" data-state-path="${f.statePath || ''}">
              <option value="">All</option>
              ${(f.options || []).map(opt =>
                `<option value="${_esc(opt)}" ${currentValue === opt ? 'selected' : ''}>${_esc(opt)}</option>`
              ).join('')}
            </select>
          </div>`;

      case 'text':
        return `
          <div class="nv-filter-bar__item">
            <label class="nv-filter-bar__label">${_esc(f.label)}</label>
            <input class="nv-form__input nv-filter-bar__input" type="text"
              data-filter-id="${f.id}" data-state-path="${f.statePath || ''}"
              value="${_esc(String(currentValue))}"
              placeholder="${_esc(f.placeholder || 'Search…')}"
            />
          </div>`;

      case 'boolean':
        return `
          <div class="nv-filter-bar__item nv-filter-bar__item--checkbox">
            <label class="nv-form__label nv-form__label--checkbox">
              <input class="nv-form__checkbox" type="checkbox"
                data-filter-id="${f.id}" data-state-path="${f.statePath || ''}"
                ${currentValue ? 'checked' : ''}
              />
              ${_esc(f.label)}
            </label>
          </div>`;

      default:
        return '';
    }
  }

  function _bindEvents() {
    container.querySelectorAll('[data-filter-id]').forEach(el => {
      const statePath = el.getAttribute('data-state-path');
      const event = el.type === 'checkbox' ? 'change' : 'input';

      el.addEventListener(event, () => {
        const value = el.type === 'checkbox' ? el.checked : el.value;
        if (statePath) context.setState(statePath, value || null);
        if (_props.onFilter) {
          context.dispatch(_props.onFilter, { filterId: el.getAttribute('data-filter-id'), value });
        }
      });
    });

    container.querySelector('[data-clear]')?.addEventListener('click', () => {
      for (const f of (_props.filters || [])) {
        if (f.statePath) context.setState(f.statePath, null);
      }
      _render();
    });
  }

  function _esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  _render();

  return {
    update(newProps) { _props = newProps; _render(); },
    destroy() { container.innerHTML = ''; },
  };
}

export default FilterComponent;
