/**
 * statCardComponent.js — Nuvra Phase 3
 *
 * The Stat Card Component.
 *
 * Displays a single metric with a label, value, and optional trend.
 * The value can be bound to a state path or a collection count/sum.
 *
 * Props:
 *   label      — the metric label
 *   value      — the metric value (resolved via binding)
 *   unit       — optional unit suffix (e.g., '%', 'ms', '$')
 *   trend      — optional { value: number, direction: 'up'|'down', label: string }
 *   variant    — 'default' | 'success' | 'warning' | 'danger'
 *   icon       — optional emoji or icon character
 *
 * @module app/components/statCardComponent
 */
'use strict';

export function StatCardComponent({ container, props, context, componentId }) {
  let _props = props;

  function _render() {
    const { label = '', value = 0, unit = '', trend, variant = 'default', icon = '' } = _props;

    const trendHtml = trend
      ? `<div class="nv-stat-card__trend nv-stat-card__trend--${trend.direction || 'neutral'}">
           ${trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'}
           ${_esc(String(trend.value))}${unit ? _esc(unit) : ''}
           ${trend.label ? `<span class="nv-stat-card__trend-label">${_esc(trend.label)}</span>` : ''}
         </div>`
      : '';

    container.innerHTML = `
      <div class="nv-stat-card nv-stat-card--${variant}" data-component-id="${componentId}">
        <div class="nv-stat-card__header">
          ${icon ? `<span class="nv-stat-card__icon">${_esc(icon)}</span>` : ''}
          <span class="nv-stat-card__label">${_esc(label)}</span>
        </div>
        <div class="nv-stat-card__value">
          ${_esc(String(value))}${unit ? `<span class="nv-stat-card__unit">${_esc(unit)}</span>` : ''}
        </div>
        ${trendHtml}
      </div>
    `;
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

export default StatCardComponent;
