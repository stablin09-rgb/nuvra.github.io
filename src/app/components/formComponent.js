/**
 * formComponent.js — Nuvra Phase 3
 *
 * The Form Component.
 *
 * A schema-bound form that:
 *  - Renders fields from a CollectionSchema or an explicit fields array
 *  - Validates input on submit using the field type validators
 *  - Dispatches a named action on submit (e.g., 'createTask')
 *  - Shows inline validation errors
 *  - Supports create and update modes
 *
 * Props:
 *   fields       — array of field definitions (from collection schema or explicit)
 *   submitAction — the action ID to dispatch on submit
 *   initialData  — pre-fill values (for update mode)
 *   title        — form title
 *   submitLabel  — submit button label (default: 'Submit')
 *   resetOnSubmit — clear form after successful submit (default: true)
 *
 * @module app/components/formComponent
 */
'use strict';

import { validateField } from '../data/fieldTypes.js';

export function FormComponent({ container, props, context, componentId }) {
  let _props = props;
  let _formData = {};
  let _errors = {};

  function _render() {
    const { fields = [], title, submitLabel = 'Submit', initialData = {} } = _props;

    // Initialize form data from initialData
    if (Object.keys(_formData).length === 0 && Object.keys(initialData).length > 0) {
      _formData = { ...initialData };
    }

    container.innerHTML = `
      <div class="nv-form" data-component-id="${componentId}">
        ${title ? `<h3 class="nv-form__title">${_escHtml(title)}</h3>` : ''}
        <form class="nv-form__body" novalidate>
          ${fields.map(field => _renderField(field)).join('')}
          <div class="nv-form__actions">
            <button type="submit" class="nv-btn nv-btn--primary">${_escHtml(submitLabel)}</button>
            <button type="reset"  class="nv-btn nv-btn--ghost">Clear</button>
          </div>
        </form>
      </div>
    `;

    _bindEvents();
  }

  function _renderField(field) {
    const value = _formData[field.id] ?? (field.defaultValue ?? '');
    const error = _errors[field.id];
    const errorHtml = error ? `<span class="nv-form__field-error">${_escHtml(error)}</span>` : '';

    switch (field.type) {
      case 'text':
      case 'email':
      case 'url':
        return `
          <div class="nv-form__field ${error ? 'nv-form__field--error' : ''}">
            <label class="nv-form__label" for="${componentId}_${field.id}">
              ${_escHtml(field.label || field.id)}
              ${field.rules?.required ? '<span class="nv-form__required">*</span>' : ''}
            </label>
            <input class="nv-form__input" type="${field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'text'}"
              id="${componentId}_${field.id}" name="${field.id}"
              value="${_escHtml(String(value))}"
              placeholder="${_escHtml(field.placeholder || '')}"
              ${field.rules?.required ? 'required' : ''}
            />
            ${errorHtml}
          </div>`;

      case 'number':
        return `
          <div class="nv-form__field ${error ? 'nv-form__field--error' : ''}">
            <label class="nv-form__label" for="${componentId}_${field.id}">
              ${_escHtml(field.label || field.id)}
              ${field.rules?.required ? '<span class="nv-form__required">*</span>' : ''}
            </label>
            <input class="nv-form__input" type="number"
              id="${componentId}_${field.id}" name="${field.id}"
              value="${value}"
              ${field.rules?.min !== undefined ? `min="${field.rules.min}"` : ''}
              ${field.rules?.max !== undefined ? `max="${field.rules.max}"` : ''}
            />
            ${errorHtml}
          </div>`;

      case 'boolean':
        return `
          <div class="nv-form__field nv-form__field--checkbox ${error ? 'nv-form__field--error' : ''}">
            <label class="nv-form__label nv-form__label--checkbox">
              <input class="nv-form__checkbox" type="checkbox"
                name="${field.id}" ${value ? 'checked' : ''}
              />
              ${_escHtml(field.label || field.id)}
            </label>
            ${errorHtml}
          </div>`;

      case 'select':
        return `
          <div class="nv-form__field ${error ? 'nv-form__field--error' : ''}">
            <label class="nv-form__label" for="${componentId}_${field.id}">
              ${_escHtml(field.label || field.id)}
              ${field.rules?.required ? '<span class="nv-form__required">*</span>' : ''}
            </label>
            <select class="nv-form__select" id="${componentId}_${field.id}" name="${field.id}">
              <option value="">— Select —</option>
              ${(field.rules?.options || []).map(opt =>
                `<option value="${_escHtml(opt)}" ${value === opt ? 'selected' : ''}>${_escHtml(opt)}</option>`
              ).join('')}
            </select>
            ${errorHtml}
          </div>`;

      case 'date':
        return `
          <div class="nv-form__field ${error ? 'nv-form__field--error' : ''}">
            <label class="nv-form__label" for="${componentId}_${field.id}">
              ${_escHtml(field.label || field.id)}
              ${field.rules?.required ? '<span class="nv-form__required">*</span>' : ''}
            </label>
            <input class="nv-form__input" type="date"
              id="${componentId}_${field.id}" name="${field.id}"
              value="${value ? String(value).slice(0, 10) : ''}"
            />
            ${errorHtml}
          </div>`;

      default:
        return `
          <div class="nv-form__field">
            <label class="nv-form__label">${_escHtml(field.label || field.id)}</label>
            <input class="nv-form__input" type="text" name="${field.id}" value="${_escHtml(String(value))}"/>
          </div>`;
    }
  }

  function _bindEvents() {
    const form = container.querySelector('form');
    if (!form) return;

    // Track input changes
    form.addEventListener('input', (e) => {
      const { name, value, type, checked } = e.target;
      if (!name) return;
      _formData[name] = type === 'checkbox' ? checked : value;
      // Clear error on change
      if (_errors[name]) {
        delete _errors[name];
        const fieldEl = container.querySelector(`[name="${name}"]`)?.closest('.nv-form__field');
        fieldEl?.classList.remove('nv-form__field--error');
        fieldEl?.querySelector('.nv-form__field-error')?.remove();
      }
    });

    // Submit
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      _errors = _validate();
      if (Object.keys(_errors).length > 0) {
        _render(); // re-render to show errors
        return;
      }

      const submitAction = _props.submitAction;
      if (!submitAction) return;

      const btn = form.querySelector('[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

      try {
        const result = await context.dispatch(submitAction, { ..._formData });
        if (result.ok) {
          if (_props.resetOnSubmit !== false) {
            _formData = {};
            _errors   = {};
            _render();
          }
        } else {
          // Show server-side errors
          if (result.errors) {
            _errors = result.errors;
            _render();
          }
        }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = _props.submitLabel || 'Submit'; }
      }
    });

    // Reset
    form.addEventListener('reset', () => {
      _formData = {};
      _errors   = {};
      _render();
    });
  }

  function _validate() {
    const errors = {};
    for (const field of (_props.fields || [])) {
      const result = validateField(_formData[field.id], field);
      if (!result.ok) errors[field.id] = result.error;
    }
    return errors;
  }

  function _escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Initial render
  _render();

  return {
    update(newProps) {
      _props = newProps;
      _render();
    },
    destroy() {
      container.innerHTML = '';
    },
  };
}

export default FormComponent;
