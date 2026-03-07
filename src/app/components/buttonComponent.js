/**
 * buttonComponent.js — Nuvra Phase 3
 *
 * The Button Component.
 * Dispatches a named action when clicked.
 *
 * Props:
 *   label     — button label
 *   actionId  — action ID to dispatch on click
 *   payload   — optional static payload to pass to the action
 *   variant   — 'primary' | 'secondary' | 'danger' | 'ghost' (default: 'primary')
 *   disabled  — boolean
 *   size      — 'sm' | 'md' | 'lg' (default: 'md')
 *
 * @module app/components/buttonComponent
 */
'use strict';

export function ButtonComponent({ container, props, context, componentId }) {
  let _props = props;

  function _render() {
    const { label = 'Button', variant = 'primary', disabled = false, size = 'md' } = _props;

    container.innerHTML = `
      <button class="nv-btn nv-btn--${variant} nv-btn--${size}"
        data-component-id="${componentId}"
        ${disabled ? 'disabled' : ''}>
        ${_esc(label)}
      </button>
    `;

    container.querySelector('button')?.addEventListener('click', async () => {
      if (!_props.actionId) return;
      const btn = container.querySelector('button');
      if (btn) btn.disabled = true;
      try {
        await context.dispatch(_props.actionId, _props.payload || {});
      } finally {
        if (btn) btn.disabled = !!_props.disabled;
      }
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

export default ButtonComponent;
