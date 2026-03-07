/**
 * textComponent.js — Nuvra Phase 3
 *
 * The Text Component.
 * Renders a text block. Content can be bound to state.
 *
 * Props:
 *   content  — the text content (may contain binding expressions)
 *   tag      — HTML tag: 'p' | 'h1' | 'h2' | 'h3' | 'span' (default: 'p')
 *   className — additional CSS class
 *
 * @module app/components/textComponent
 */
'use strict';

export function TextComponent({ container, props, context, componentId }) {
  let _props = props;

  function _render() {
    const { content = '', tag = 'p', className = '' } = _props;
    const el = document.createElement(tag);
    el.className = `nv-text ${className}`.trim();
    el.setAttribute('data-component-id', componentId);
    el.textContent = content;
    container.innerHTML = '';
    container.appendChild(el);
  }

  _render();

  return {
    update(newProps) { _props = newProps; _render(); },
    destroy() { container.innerHTML = ''; },
  };
}

export default TextComponent;
