/**
 * Nuvra Builder — App Schema Renderer (Phase A)
 *
 * Converts an AppPageSchema (from the AI) into HTML and CSS
 * suitable for loading into GrapesJS.
 *
 * Phase A improvements:
 * - Added 'chart-widget' component type for dashboards.
 * - Data table now renders column headers from the schema's field
 *   definitions when available (not just "Loading…").
 * - Added 'kpi-row' layout helper for dashboard stat rows.
 * - renderAppPageWithFallback() exported for safe use in providers.
 * - Each component render is wrapped in try/catch.
 *
 * Each component type has a dedicated render function that produces
 * semantic HTML with data-nv-* attributes. These attributes are used
 * by the AppRuntime (in preview) and the ProductionRuntime (in publish)
 * to hydrate the components with live data.
 *
 * Design principle: the renderer owns all HTML. The AI only provides
 * structured data (component type, collection binding, config).
 */

'use strict';

// ─── App Schema Renderer ──────────────────────────────────────────────────────

/**
 * Render an AppPageSchema into { html, css }.
 *
 * @param {object} appPage    - Validated AppPageSchema
 * @param {object} appPlan    - The full AppPlan (for brand/accent access)
 * @returns {{ html: string, css: string }}
 */
export function renderAppPage(appPage, appPlan = {}) {
  const accent  = appPlan.brand?.accent || '#7c6af7';
  const appName = appPlan.appName || 'App';
  const layout  = appPage.layout || 'topbar';

  // Separate stat-cards from other components for dashboard KPI rows
  const statCards = (appPage.components || []).filter((c) => c.componentType === 'stat-card');
  const others    = (appPage.components || []).filter((c) => c.componentType !== 'stat-card');

  let componentsHtml = '';

  // Render stat cards as a KPI row if there are multiple
  if (statCards.length > 1) {
    componentsHtml += `<div class="nv-kpi-row">\n${statCards.map((c) => _safeRenderComponent(c, accent)).join('\n')}\n</div>\n`;
  } else if (statCards.length === 1) {
    componentsHtml += _safeRenderComponent(statCards[0], accent) + '\n';
  }

  componentsHtml += others.map((comp) => _safeRenderComponent(comp, accent)).join('\n');

  const html = _wrapInLayout(componentsHtml, { layout, appName, accent, pageName: appPage.pageName });
  const css  = _getAppPageCss(accent);

  return { html, css };
}

/**
 * Render an AppPageSchema with a guaranteed fallback.
 * If the schema itself is invalid, a minimal fallback page is returned.
 *
 * @param {object|any} appPage
 * @param {object} appPlan
 * @returns {{ html: string, css: string }}
 */
export function renderAppPageWithFallback(appPage, appPlan = {}) {
  try {
    if (!appPage || !Array.isArray(appPage.components)) {
      throw new Error('Invalid AppPageSchema');
    }
    return renderAppPage(appPage, appPlan);
  } catch (err) {
    console.error('[Nuvra AppSchemaRenderer] renderAppPageWithFallback caught error:', err);
    const accent = appPlan.brand?.accent || '#7c6af7';
    return {
      html: `<div class="nv-app-layout nv-layout-topbar">
  <header class="nv-topbar"><div class="nv-topbar-brand">${_esc(appPlan.appName || 'App')}</div></header>
  <main class="nv-main-content">
    <div class="nv-page-header"><h1 class="nv-page-title">${_esc(appPage?.pageName || 'Page')}</h1></div>
    <div class="nv-components-grid">
      <div class="nv-component" style="padding:24px;text-align:center;color:#6b7280;">
        <p>This page was generated but could not be fully rendered. Please try again.</p>
      </div>
    </div>
  </main>
</div>`,
      css: _getAppPageCss(accent),
    };
  }
}

// ─── Layout Wrappers ──────────────────────────────────────────────────────────

function _wrapInLayout(content, { layout, appName, accent, pageName }) {
  if (layout === 'sidebar') {
    return `<div class="nv-app-layout nv-layout-sidebar">
  <aside class="nv-sidebar">
    <div class="nv-sidebar-brand">${_esc(appName)}</div>
    <nav class="nv-sidebar-nav">
      <a href="#" class="nv-sidebar-link active">${_esc(pageName)}</a>
    </nav>
  </aside>
  <main class="nv-main-content">
    <div class="nv-page-header">
      <h1 class="nv-page-title">${_esc(pageName)}</h1>
    </div>
    <div class="nv-components-grid">
      ${content}
    </div>
  </main>
</div>`;
  }

  // Default: topbar layout
  return `<div class="nv-app-layout nv-layout-topbar">
  <header class="nv-topbar">
    <div class="nv-topbar-brand">${_esc(appName)}</div>
    <nav class="nv-topbar-nav">
      <a href="#" class="nv-topbar-link active">${_esc(pageName)}</a>
    </nav>
  </header>
  <main class="nv-main-content">
    <div class="nv-page-header">
      <h1 class="nv-page-title">${_esc(pageName)}</h1>
    </div>
    <div class="nv-components-grid">
      ${content}
    </div>
  </main>
</div>`;
}

// ─── Safe Component Render ────────────────────────────────────────────────────

function _safeRenderComponent(comp, accent) {
  try {
    return _renderComponent(comp, accent);
  } catch (err) {
    console.error(`[Nuvra AppSchemaRenderer] Error rendering component "${comp?.componentType}":`, err);
    return `<!-- Component "${_esc(comp?.componentType || 'unknown')}" failed to render -->`;
  }
}

// ─── Component Renderers ──────────────────────────────────────────────────────

function _renderComponent(comp, accent) {
  switch (comp.componentType) {
    case 'data-table':   return _renderDataTable(comp, accent);
    case 'data-form':    return _renderDataForm(comp, accent);
    case 'data-list':    return _renderDataList(comp, accent);
    case 'stat-card':    return _renderStatCard(comp, accent);
    case 'chart-widget': return _renderChartWidget(comp, accent);
    case 'conditional':  return _renderConditional(comp);
    default:             return `<!-- Unknown component: ${_esc(comp.componentType)} -->`;
  }
}

function _renderDataTable(comp, accent) {
  const title      = comp.title || 'Records';
  const collection = comp.collection || '';
  // If the component has explicit columns defined (from the schema), render them
  const columns    = comp.config?.columns || comp.columns || [];

  const headerCells = columns.length > 0
    ? columns.map((col) => `<th>${_esc(typeof col === 'string' ? col : col.label || col.field)}</th>`).join('')
    : '';

  return `<div class="nv-component nv-data-table-wrap" data-nv-component="data-table" data-nv-collection="${_esc(collection)}">
  <div class="nv-component-header">
    <h3 class="nv-component-title">${_esc(title)}</h3>
    <span class="nv-record-count" data-nv-bind="count:${_esc(collection)}">0 records</span>
  </div>
  <div class="nv-table-container">
    <table class="nv-table">
      <thead><tr data-nv-table-header>${headerCells}</tr></thead>
      <tbody data-nv-table-body>
        <tr><td class="nv-table-empty" colspan="${Math.max(columns.length, 1) + 1}">Loading…</td></tr>
      </tbody>
    </table>
  </div>
</div>`;
}

function _renderDataForm(comp, accent) {
  const title        = comp.title || 'Add Record';
  const collection   = comp.collection || '';
  const submitLabel  = comp.config?.submitLabel   || 'Submit';
  const successMsg   = comp.config?.successMessage || 'Saved!';
  // If the component has explicit fields defined, render them
  const fields       = comp.config?.fields || comp.fields || [];

  const fieldHtml = fields.length > 0
    ? fields.map((f) => {
        const fieldName  = typeof f === 'string' ? f : f.field || f.name;
        const fieldLabel = typeof f === 'string' ? f : f.label || fieldName;
        const fieldType  = typeof f === 'object' ? (f.type || 'text') : 'text';
        const inputType  = fieldType === 'number' ? 'number' : fieldType === 'date' ? 'date' : fieldType === 'boolean' ? 'checkbox' : 'text';
        if (inputType === 'checkbox') {
          return `<div class="nv-form-field"><label class="nv-form-label"><input type="checkbox" name="${_esc(fieldName)}" data-nv-field="${_esc(fieldName)}" /> ${_esc(fieldLabel)}</label></div>`;
        }
        return `<div class="nv-form-field">
        <label class="nv-form-label">${_esc(fieldLabel)}</label>
        <input type="${inputType}" name="${_esc(fieldName)}" placeholder="${_esc(fieldLabel)}" data-nv-field="${_esc(fieldName)}" class="nv-form-input" />
      </div>`;
      }).join('\n      ')
    : '<p class="nv-form-loading">Loading fields…</p>';

  return `<div class="nv-component nv-data-form-wrap" data-nv-component="data-form" data-nv-collection="${_esc(collection)}">
  <div class="nv-component-header">
    <h3 class="nv-component-title">${_esc(title)}</h3>
  </div>
  <form class="nv-form" data-nv-success-message="${_esc(successMsg)}">
    <div class="nv-form-fields" data-nv-form-fields>
      ${fieldHtml}
    </div>
    <div class="nv-form-footer">
      <button type="submit" class="nv-btn-primary" style="background:${accent};">${_esc(submitLabel)}</button>
    </div>
  </form>
</div>`;
}

function _renderDataList(comp, accent) {
  const title       = comp.title || 'Records';
  const collection  = comp.collection || '';
  const titleField  = comp.config?.titleField || 'name';
  const bodyField   = comp.config?.bodyField  || 'description';

  return `<div class="nv-component nv-data-list-wrap" data-nv-component="data-list" data-nv-collection="${_esc(collection)}" data-nv-title-field="${_esc(titleField)}" data-nv-body-field="${_esc(bodyField)}">
  <div class="nv-component-header">
    <h3 class="nv-component-title">${_esc(title)}</h3>
    <span class="nv-record-count" data-nv-bind="count:${_esc(collection)}">0 records</span>
  </div>
  <div class="nv-list-items" data-nv-list-body>
    <p class="nv-list-empty">No records yet.</p>
  </div>
</div>`;
}

function _renderStatCard(comp, accent) {
  const title       = comp.title || 'Stat';
  const collection  = comp.collection || '';
  const aggregation = comp.config?.aggregation || 'count';
  const label       = comp.config?.label       || title;
  const icon        = comp.config?.icon        || '📊';
  const color       = comp.config?.color       || accent;

  return `<div class="nv-component nv-stat-card" data-nv-component="stat-card" data-nv-collection="${_esc(collection)}" data-nv-aggregation="${_esc(aggregation)}" style="border-top:3px solid ${color};">
  <div class="nv-stat-icon">${icon}</div>
  <div class="nv-stat-body">
    <div class="nv-stat-value" data-nv-stat-value>—</div>
    <div class="nv-stat-label">${_esc(label)}</div>
  </div>
</div>`;
}

function _renderChartWidget(comp, accent) {
  const title      = comp.title || 'Chart';
  const collection = comp.collection || '';
  const chartType  = comp.config?.chartType || 'bar';  // bar | line | pie | donut
  const xField     = comp.config?.xField   || 'label';
  const yField     = comp.config?.yField   || 'value';

  const chartIcons = { bar: '📊', line: '📈', pie: '🥧', donut: '🍩' };
  const icon = chartIcons[chartType] || '📊';

  return `<div class="nv-component nv-chart-widget" data-nv-component="chart-widget" data-nv-collection="${_esc(collection)}" data-nv-chart-type="${_esc(chartType)}" data-nv-x-field="${_esc(xField)}" data-nv-y-field="${_esc(yField)}">
  <div class="nv-component-header">
    <h3 class="nv-component-title">${_esc(title)}</h3>
    <span class="nv-chart-type-badge">${_esc(chartType)}</span>
  </div>
  <div class="nv-chart-area">
    <div class="nv-chart-placeholder">
      <span class="nv-chart-icon">${icon}</span>
      <span class="nv-chart-hint">${_esc(chartType)} chart — ${_esc(collection)}</span>
    </div>
    <canvas class="nv-chart-canvas" data-nv-chart-canvas style="display:none;"></canvas>
  </div>
</div>`;
}

function _renderConditional(comp) {
  const stateKey   = comp.config?.stateKey   || '';
  const stateValue = comp.config?.stateValue || '';
  const operator   = comp.config?.operator   || 'truthy';

  return `<div class="nv-component nv-conditional" data-nv-component="conditional" data-nv-state-key="${_esc(stateKey)}" data-nv-state-value="${_esc(stateValue)}" data-nv-operator="${_esc(operator)}" style="display:none;">
  <div class="nv-conditional-content">
    <!-- Conditional block: visible when ${_esc(stateKey)} ${_esc(operator)} ${_esc(stateValue)} -->
    <p style="color:#6b7280;font-size:13px;padding:12px;">Conditional block — add components here.</p>
  </div>
</div>`;
}

// ─── App Page CSS ─────────────────────────────────────────────────────────────

function _getAppPageCss(accent) {
  return `
/* Nuvra App Page Styles */
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; color: #111827; }

/* Layouts */
.nv-app-layout { display: flex; min-height: 100vh; }
.nv-layout-topbar { flex-direction: column; }
.nv-layout-sidebar { flex-direction: row; }

/* Topbar */
.nv-topbar { display: flex; align-items: center; gap: 24px; padding: 0 24px; height: 56px; background: #fff; border-bottom: 1px solid #e5e7eb; }
.nv-topbar-brand { font-weight: 700; font-size: 16px; color: ${accent}; }
.nv-topbar-nav { display: flex; gap: 4px; }
.nv-topbar-link { padding: 6px 12px; border-radius: 6px; font-size: 13px; color: #6b7280; text-decoration: none; }
.nv-topbar-link.active { background: ${accent}18; color: ${accent}; font-weight: 600; }

/* Sidebar */
.nv-sidebar { width: 220px; background: #fff; border-right: 1px solid #e5e7eb; padding: 20px 12px; flex-shrink: 0; }
.nv-sidebar-brand { font-weight: 700; font-size: 15px; color: ${accent}; padding: 0 8px 16px; border-bottom: 1px solid #e5e7eb; margin-bottom: 12px; }
.nv-sidebar-nav { display: flex; flex-direction: column; gap: 2px; }
.nv-sidebar-link { padding: 8px 12px; border-radius: 6px; font-size: 13px; color: #6b7280; text-decoration: none; }
.nv-sidebar-link.active { background: ${accent}18; color: ${accent}; font-weight: 600; }

/* Main content */
.nv-main-content { flex: 1; padding: 24px; overflow-y: auto; }
.nv-page-header { margin-bottom: 24px; }
.nv-page-title { margin: 0; font-size: 22px; font-weight: 700; color: #111827; }

/* KPI row */
.nv-kpi-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; margin-bottom: 20px; }
.nv-kpi-row .nv-stat-card { margin: 0; }

/* Components grid */
.nv-components-grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
.nv-component { background: #fff; border-radius: 10px; border: 1px solid #e5e7eb; overflow: hidden; }
.nv-component-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid #f3f4f6; }
.nv-component-title { margin: 0; font-size: 14px; font-weight: 600; color: #111827; }
.nv-record-count { font-size: 11px; color: #9ca3af; background: #f3f4f6; padding: 2px 8px; border-radius: 10px; }

/* Data table */
.nv-data-table-wrap { grid-column: 1 / -1; }
.nv-table-container { overflow-x: auto; }
.nv-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.nv-table thead th { padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; background: #f9fafb; border-bottom: 1px solid #e5e7eb; }
.nv-table tbody td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; color: #374151; }
.nv-table tbody tr:last-child td { border-bottom: none; }
.nv-table-empty { padding: 24px; text-align: center; color: #9ca3af; }

/* Data form */
.nv-form { padding: 16px; }
.nv-form-fields { display: flex; flex-direction: column; gap: 12px; }
.nv-form-field { display: flex; flex-direction: column; gap: 4px; }
.nv-form-label { font-size: 12px; font-weight: 600; color: #374151; }
.nv-form-input { padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; color: #111827; }
.nv-form-input:focus { outline: none; border-color: ${accent}; box-shadow: 0 0 0 2px ${accent}22; }
.nv-form-footer { margin-top: 16px; }
.nv-btn-primary { padding: 9px 20px; border: none; border-radius: 6px; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; }
.nv-btn-primary:hover { opacity: 0.9; }
.nv-form-loading { color: #9ca3af; font-size: 13px; margin: 0; }

/* Data list */
.nv-list-items { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.nv-list-empty { color: #9ca3af; font-size: 13px; text-align: center; padding: 16px; margin: 0; }
.nv-list-card { padding: 12px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb; }
.nv-list-card-title { font-weight: 600; font-size: 13px; color: #111827; margin: 0 0 4px; }
.nv-list-card-body  { font-size: 12px; color: #6b7280; margin: 0; }

/* Stat card */
.nv-stat-card { display: flex; align-items: center; gap: 16px; padding: 20px; }
.nv-stat-icon  { font-size: 32px; line-height: 1; }
.nv-stat-value { font-size: 32px; font-weight: 700; color: #111827; line-height: 1; }
.nv-stat-label { font-size: 12px; color: #6b7280; margin-top: 4px; }

/* Chart widget */
.nv-chart-widget { grid-column: span 2; }
.nv-chart-area { padding: 16px; min-height: 180px; display: flex; align-items: center; justify-content: center; }
.nv-chart-placeholder { display: flex; flex-direction: column; align-items: center; gap: 8px; color: #9ca3af; }
.nv-chart-icon { font-size: 40px; }
.nv-chart-hint { font-size: 12px; }
.nv-chart-type-badge { font-size: 10px; background: #f3f4f6; color: #6b7280; padding: 2px 8px; border-radius: 10px; text-transform: capitalize; }
.nv-chart-canvas { width: 100%; }
`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
