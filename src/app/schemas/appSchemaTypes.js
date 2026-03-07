/**
 * appSchemaTypes.js — Nuvra Phase 3
 *
 * Canonical schema factories for the Nuvra App Builder.
 *
 * These factories produce the schema objects that define every aspect
 * of a Nuvra application. They are the single source of truth.
 * The DOM is a projection of these schemas.
 *
 * Schema hierarchy:
 *
 *   AppSchema
 *   ├── identity
 *   ├── state (StateSchema)
 *   │   ├── global[]  (StateVarSchema)
 *   │   ├── page[]    (StateVarSchema)
 *   │   └── derived[] (DerivedStateSchema)
 *   ├── collections[] (CollectionSchema)
 *   │   └── fields[]  (FieldSchema)
 *   ├── actions[]     (ActionSchema)
 *   │   └── steps[]   (ActionStepSchema)
 *   └── pages[]       (AppPageSchema)
 *       └── layout[]  (ComponentRefSchema)
 *
 * @module app/schemas/appSchemaTypes
 */
'use strict';

import { generateId, now } from '../../runtime/utils.js';

// ─── AppSchema ────────────────────────────────────────────────────────────────
/**
 * The top-level schema for a Nuvra application.
 * @param {object} opts
 * @returns {object} AppSchema
 */
export function createAppSchema(opts = {}) {
  return {
    _schemaType:  'AppSchema',
    _schemaVersion: 1,
    id:           opts.id          || generateId('app'),
    name:         opts.name        || 'Untitled App',
    description:  opts.description || '',
    version:      opts.version     || '1.0.0',
    createdAt:    opts.createdAt   || now(),
    updatedAt:    now(),
    state:        opts.state       || createStateSchema(),
    collections:  opts.collections || [],
    actions:      opts.actions     || [],
    pages:        opts.pages       || [],
    meta:         opts.meta        || {},
  };
}

// ─── StateSchema ──────────────────────────────────────────────────────────────
/**
 * The state section of an AppSchema.
 */
export function createStateSchema(opts = {}) {
  return {
    global:  opts.global  || [],
    page:    opts.page    || [],
    derived: opts.derived || [],
  };
}

/**
 * A single state variable declaration.
 * @param {object} opts
 * @returns {object} StateVarSchema
 */
export function createStateVar(opts = {}) {
  return {
    _schemaType:  'StateVarSchema',
    id:           opts.id           || generateId('sv'),
    label:        opts.label        || opts.id || '',
    type:         opts.type         || 'any',   // 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any'
    defaultValue: opts.defaultValue !== undefined ? opts.defaultValue : null,
    scope:        opts.scope        || 'global', // 'global' | 'page'
    description:  opts.description  || '',
  };
}

/**
 * A derived (computed) state variable.
 * @param {object} opts
 * @returns {object} DerivedStateSchema
 */
export function createDerivedState(opts = {}) {
  return {
    _schemaType: 'DerivedStateSchema',
    id:          opts.id         || generateId('ds'),
    label:       opts.label      || opts.id || '',
    deps:        opts.deps       || [],   // array of state paths this depends on
    expression:  opts.expression || null, // declarative expression object
    description: opts.description || '',
  };
}

// ─── CollectionSchema ─────────────────────────────────────────────────────────
/**
 * A data collection (table) schema.
 * @param {object} opts
 * @returns {object} CollectionSchema
 */
export function createCollectionSchema(opts = {}) {
  return {
    _schemaType:  'CollectionSchema',
    id:           opts.id          || generateId('coll'),
    name:         opts.name        || 'Untitled Collection',
    description:  opts.description || '',
    fields:       opts.fields      || [],
    seedData:     opts.seedData    || [],
    relations:    opts.relations   || [],
    createdAt:    now(),
  };
}

/**
 * A field definition within a collection.
 * @param {object} opts
 * @returns {object} FieldSchema
 */
export function createFieldSchema(opts = {}) {
  return {
    _schemaType:  'FieldSchema',
    id:           opts.id           || generateId('field'),
    label:        opts.label        || opts.id || '',
    type:         opts.type         || 'text',
    defaultValue: opts.defaultValue !== undefined ? opts.defaultValue : undefined,
    placeholder:  opts.placeholder  || '',
    rules:        opts.rules        || {},
    description:  opts.description  || '',
  };
}

/**
 * A relationship between two collections.
 * @param {object} opts
 * @returns {object} RelationSchema
 */
export function createRelationSchema(opts = {}) {
  return {
    _schemaType:     'RelationSchema',
    id:              opts.id              || generateId('rel'),
    type:            opts.type            || 'many-to-one', // 'one-to-many' | 'many-to-one' | 'many-to-many'
    targetCollection: opts.targetCollection || '',
    foreignKey:      opts.foreignKey      || '',
    label:           opts.label           || '',
  };
}

// ─── ActionSchema ─────────────────────────────────────────────────────────────
/**
 * An action schema — a named, declarative sequence of steps.
 * @param {object} opts
 * @returns {object} ActionSchema
 */
export function createActionSchema(opts = {}) {
  return {
    _schemaType:  'ActionSchema',
    id:           opts.id          || generateId('action'),
    name:         opts.name        || 'Untitled Action',
    description:  opts.description || '',
    trigger:      opts.trigger     || null,  // optional event trigger
    steps:        opts.steps       || [],
    createdAt:    now(),
  };
}

/**
 * A single step within an action.
 * @param {object} opts
 * @returns {object} ActionStepSchema
 */
export function createActionStep(opts = {}) {
  const base = {
    _schemaType:  'ActionStepSchema',
    id:           opts.id          || generateId('step'),
    type:         opts.type        || 'state.set',
    haltOnError:  opts.haltOnError !== undefined ? opts.haltOnError : true,
    description:  opts.description || '',
  };
  // Merge all other opts (type-specific fields)
  const { id, type, haltOnError, description, ...rest } = opts;
  return { ...base, ...rest };
}

// ─── AppPageSchema ────────────────────────────────────────────────────────────
/**
 * A page within a Nuvra app.
 * @param {object} opts
 * @returns {object} AppPageSchema
 */
export function createAppPageSchema(opts = {}) {
  return {
    _schemaType:  'AppPageSchema',
    id:           opts.id          || generateId('page'),
    name:         opts.name        || 'Untitled Page',
    slug:         opts.slug        || 'page',
    mode:         opts.mode        || 'app',   // 'marketing' | 'app' | 'hybrid'
    description:  opts.description || '',
    layout:       opts.layout      || [],      // array of ComponentRefSchema
    onLoad:       opts.onLoad      || [],      // array of { actionId, payload? }
    meta:         opts.meta        || {},
  };
}

/**
 * A component reference within a page layout.
 * @param {object} opts
 * @returns {object} ComponentRefSchema
 */
export function createComponentRef(opts = {}) {
  return {
    _schemaType:   'ComponentRefSchema',
    componentId:   opts.componentId   || generateId('comp'),
    componentType: opts.componentType || 'text',
    props:         opts.props         || {},
    bindings:      opts.bindings      || {},
    events:        opts.events        || {},  // { eventName: actionId }
    layout:        opts.layout        || {},  // { col, row, colSpan, rowSpan }
  };
}

// ─── BindingSchema ────────────────────────────────────────────────────────────
/**
 * A binding expression that connects a component prop to a state or data source.
 *
 * Binding expression syntax:
 *   "state:<path>"          → reads from app state
 *   "data:<collectionId>"   → queries a collection
 *   "literal:<value>"       → a static literal value
 *
 * @param {object} opts
 * @returns {object} BindingSchema
 */
export function createBinding(opts = {}) {
  return {
    _schemaType: 'BindingSchema',
    propKey:     opts.propKey     || '',
    expression:  opts.expression  || '',
    description: opts.description || '',
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────
/**
 * Validate an AppSchema for structural correctness.
 * @param {object} schema
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateAppSchema(schema) {
  const errors = [];

  if (!schema) { errors.push('Schema is null or undefined'); return { ok: false, errors }; }
  if (!schema.id) errors.push('AppSchema is missing id');
  if (!schema.name) errors.push('AppSchema is missing name');
  if (!Array.isArray(schema.collections)) errors.push('AppSchema.collections must be an array');
  if (!Array.isArray(schema.actions)) errors.push('AppSchema.actions must be an array');
  if (!Array.isArray(schema.pages)) errors.push('AppSchema.pages must be an array');

  // Validate collections
  for (const coll of (schema.collections || [])) {
    if (!coll.id) errors.push(`Collection is missing id`);
    if (!Array.isArray(coll.fields)) errors.push(`Collection "${coll.id}" fields must be an array`);
    for (const field of (coll.fields || [])) {
      if (!field.id) errors.push(`Field in collection "${coll.id}" is missing id`);
      if (!field.type) errors.push(`Field "${field.id}" in collection "${coll.id}" is missing type`);
    }
  }

  // Validate actions
  for (const action of (schema.actions || [])) {
    if (!action.id) errors.push(`Action is missing id`);
    if (!Array.isArray(action.steps)) errors.push(`Action "${action.id}" steps must be an array`);
    for (const step of (action.steps || [])) {
      if (!step.type) errors.push(`Step in action "${action.id}" is missing type`);
    }
  }

  // Validate pages
  for (const page of (schema.pages || [])) {
    if (!page.id) errors.push(`Page is missing id`);
    if (!page.mode) errors.push(`Page "${page.id}" is missing mode declaration`);
    if (!Array.isArray(page.layout)) errors.push(`Page "${page.id}" layout must be an array`);
  }

  return { ok: errors.length === 0, errors };
}

export default {
  createAppSchema,
  createStateSchema,
  createStateVar,
  createDerivedState,
  createCollectionSchema,
  createFieldSchema,
  createRelationSchema,
  createActionSchema,
  createActionStep,
  createAppPageSchema,
  createComponentRef,
  createBinding,
  validateAppSchema,
};
