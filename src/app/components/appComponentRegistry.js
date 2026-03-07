/**
 * appComponentRegistry.js — Nuvra Phase 3
 *
 * The App Component Registry.
 *
 * Maps component type IDs (from schemas) to factory functions.
 * All built-in components are registered here.
 * Custom components can be registered via register().
 *
 * A component factory is a function:
 *   factory({ container, props, context, componentId }) → ComponentInstance
 *
 * A ComponentInstance has:
 *   update(newProps) — called when bound state changes
 *   destroy()       — called when the component is unmounted
 *
 * @module app/components/appComponentRegistry
 */
'use strict';

import { FormComponent }     from './formComponent.js';
import { TableComponent }    from './tableComponent.js';
import { ListComponent }     from './listComponent.js';
import { FilterComponent }   from './filterComponent.js';
import { StatCardComponent } from './statCardComponent.js';
import { TextComponent }     from './textComponent.js';
import { ButtonComponent }   from './buttonComponent.js';

// ─── Registry ─────────────────────────────────────────────────────────────────
const _registry = new Map();

function register(typeId, factory) {
  _registry.set(typeId, factory);
}

function get(typeId) {
  return _registry.get(typeId) || null;
}

function list() {
  return Array.from(_registry.keys());
}

// ─── Built-in Components ──────────────────────────────────────────────────────
register('form',      FormComponent);
register('table',     TableComponent);
register('list',      ListComponent);
register('filter',    FilterComponent);
register('stat-card', StatCardComponent);
register('text',      TextComponent);
register('button',    ButtonComponent);

export const AppComponentRegistry = { register, get, list };
export default AppComponentRegistry;
