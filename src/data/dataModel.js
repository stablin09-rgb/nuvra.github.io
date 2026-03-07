/**
 * Nuvra Builder — Data Model System
 *
 * Defines the core data primitives for Nuvra's app-building layer:
 *  - Field types (text, number, boolean, date, select, relation)
 *  - Collection schemas (like database tables)
 *  - An in-memory DataStore with CRUD operations
 *
 * Architecture:
 *  ┌─────────────────────────────────────────────────────┐
 *  │  dataModel.js  (types + store)                      │
 *  │    └── FIELD_TYPES    — field type definitions      │
 *  │    └── DataStore      — in-memory CRUD engine       │
 *  │    └── createCollection() — schema factory          │
 *  └─────────────────────────────────────────────────────┘
 *
 * All data is serializable to JSON for project persistence.
 * This module has no UI dependencies — it is pure data logic.
 */

'use strict';

// ─── Field Types ──────────────────────────────────────────────────────────────

export const FIELD_TYPES = {
  TEXT:     'text',
  NUMBER:   'number',
  BOOLEAN:  'boolean',
  DATE:     'date',
  SELECT:   'select',
  EMAIL:    'email',
  URL:      'url',
  TEXTAREA: 'textarea',
  RELATION: 'relation',
};

/**
 * Field type metadata — used for UI rendering and validation.
 */
export const FIELD_TYPE_META = {
  [FIELD_TYPES.TEXT]:     { label: 'Text',     icon: '𝐓',  inputType: 'text'     },
  [FIELD_TYPES.NUMBER]:   { label: 'Number',   icon: '#',  inputType: 'number'   },
  [FIELD_TYPES.BOOLEAN]:  { label: 'Boolean',  icon: '◉',  inputType: 'checkbox' },
  [FIELD_TYPES.DATE]:     { label: 'Date',     icon: '📅', inputType: 'date'     },
  [FIELD_TYPES.SELECT]:   { label: 'Select',   icon: '▾',  inputType: 'select'   },
  [FIELD_TYPES.EMAIL]:    { label: 'Email',    icon: '@',  inputType: 'email'    },
  [FIELD_TYPES.URL]:      { label: 'URL',      icon: '🔗', inputType: 'url'      },
  [FIELD_TYPES.TEXTAREA]: { label: 'Long Text',icon: '¶',  inputType: 'textarea' },
  [FIELD_TYPES.RELATION]: { label: 'Relation', icon: '↔',  inputType: 'select'   },
};

// ─── Collection Schema Factory ────────────────────────────────────────────────

/**
 * Create a new collection schema.
 *
 * @param {string} id     - URL-safe identifier (e.g. 'tasks')
 * @param {string} name   - Human-readable name (e.g. 'Tasks')
 * @param {FieldDef[]} fields
 * @returns {CollectionSchema}
 */
export function createCollection(id, name, fields = []) {
  return {
    id,
    name,
    fields: [
      // Every collection has a built-in ID field
      { id: '_id', name: 'ID', type: FIELD_TYPES.TEXT, required: true, system: true },
      ...fields,
    ],
    createdAt: new Date().toISOString(),
  };
}

/**
 * Create a field definition.
 *
 * @param {string} id
 * @param {string} name
 * @param {string} type   - One of FIELD_TYPES
 * @param {object} [opts] - { required, defaultValue, options (for select), relatedCollection }
 * @returns {FieldDef}
 */
export function createField(id, name, type, opts = {}) {
  return {
    id,
    name,
    type:             type || FIELD_TYPES.TEXT,
    required:         opts.required         ?? false,
    defaultValue:     opts.defaultValue     ?? null,
    options:          opts.options          ?? [],   // for SELECT type
    relatedCollection: opts.relatedCollection ?? null, // for RELATION type
  };
}

// ─── In-Memory Data Store ─────────────────────────────────────────────────────

/**
 * DataStore — manages collections and their records in memory.
 *
 * All operations are synchronous and return plain objects.
 * The store is serializable via toJSON() for project persistence.
 */
export class DataStore {
  constructor() {
    /** @type {Map<string, CollectionSchema>} */
    this._schemas = new Map();

    /** @type {Map<string, Map<string, object>>} */
    this._records = new Map();

    /** @type {Map<string, Function[]>} */
    this._listeners = new Map();

    this._idCounter = 1;
  }

  // ── Schema Management ──────────────────────────────────────────────────────

  /**
   * Register a collection schema.
   * @param {CollectionSchema} schema
   */
  registerCollection(schema) {
    this._schemas.set(schema.id, schema);
    if (!this._records.has(schema.id)) {
      this._records.set(schema.id, new Map());
    }
  }

  /**
   * Get a collection schema by ID.
   * @param {string} collectionId
   * @returns {CollectionSchema|undefined}
   */
  getSchema(collectionId) {
    return this._schemas.get(collectionId);
  }

  /**
   * Get all registered collection schemas.
   * @returns {CollectionSchema[]}
   */
  getAllSchemas() {
    return [...this._schemas.values()];
  }

  /**
   * Remove a collection and all its records.
   * @param {string} collectionId
   */
  dropCollection(collectionId) {
    this._schemas.delete(collectionId);
    this._records.delete(collectionId);
    this._emit(collectionId, 'drop', null);
  }

  // ── CRUD Operations ────────────────────────────────────────────────────────

  /**
   * Insert a new record into a collection.
   * @param {string} collectionId
   * @param {object} data
   * @returns {object} The inserted record (with generated _id)
   */
  insert(collectionId, data) {
    const records = this._getRecords(collectionId);
    const record  = {
      ...data,
      _id:        `${collectionId}-${this._idCounter++}`,
      _createdAt: new Date().toISOString(),
      _updatedAt: new Date().toISOString(),
    };
    records.set(record._id, record);
    this._emit(collectionId, 'insert', record);
    return { ...record };
  }

  /**
   * Get all records from a collection.
   * @param {string} collectionId
   * @param {object} [filter] - Simple equality filter { field: value }
   * @returns {object[]}
   */
  findAll(collectionId, filter = null) {
    const records = this._getRecords(collectionId);
    let results   = [...records.values()];

    if (filter) {
      results = results.filter((r) =>
        Object.entries(filter).every(([k, v]) => r[k] === v)
      );
    }

    return results.map((r) => ({ ...r }));
  }

  /**
   * Get a single record by ID.
   * @param {string} collectionId
   * @param {string} id
   * @returns {object|null}
   */
  findById(collectionId, id) {
    const records = this._getRecords(collectionId);
    const record  = records.get(id);
    return record ? { ...record } : null;
  }

  /**
   * Update a record by ID.
   * @param {string} collectionId
   * @param {string} id
   * @param {object} updates
   * @returns {object|null} Updated record, or null if not found
   */
  update(collectionId, id, updates) {
    const records = this._getRecords(collectionId);
    const existing = records.get(id);
    if (!existing) return null;

    const updated = {
      ...existing,
      ...updates,
      _id:        existing._id,
      _createdAt: existing._createdAt,
      _updatedAt: new Date().toISOString(),
    };
    records.set(id, updated);
    this._emit(collectionId, 'update', updated);
    return { ...updated };
  }

  /**
   * Delete a record by ID.
   * @param {string} collectionId
   * @param {string} id
   * @returns {boolean}
   */
  delete(collectionId, id) {
    const records = this._getRecords(collectionId);
    const existed = records.delete(id);
    if (existed) this._emit(collectionId, 'delete', { _id: id });
    return existed;
  }

  /**
   * Count records in a collection.
   * @param {string} collectionId
   * @returns {number}
   */
  count(collectionId) {
    return this._getRecords(collectionId).size;
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────

  /**
   * Subscribe to changes on a collection.
   * @param {string} collectionId
   * @param {Function} callback  (event: { type, record }) => void
   * @returns {Function} Unsubscribe function
   */
  subscribe(collectionId, callback) {
    if (!this._listeners.has(collectionId)) {
      this._listeners.set(collectionId, []);
    }
    this._listeners.get(collectionId).push(callback);

    return () => {
      const listeners = this._listeners.get(collectionId) || [];
      const idx = listeners.indexOf(callback);
      if (idx > -1) listeners.splice(idx, 1);
    };
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  /**
   * Serialize the entire store to a plain JSON-compatible object.
   * @returns {object}
   */
  toJSON() {
    const schemas = {};
    const records = {};

    for (const [id, schema] of this._schemas) {
      schemas[id] = schema;
    }
    for (const [id, recordMap] of this._records) {
      records[id] = [...recordMap.values()];
    }

    return { schemas, records, idCounter: this._idCounter };
  }

  /**
   * Restore the store from a serialized snapshot.
   * @param {object} snapshot
   */
  fromJSON(snapshot) {
    if (!snapshot) return;

    this._schemas.clear();
    this._records.clear();

    for (const [id, schema] of Object.entries(snapshot.schemas || {})) {
      this._schemas.set(id, schema);
    }
    for (const [id, recordArray] of Object.entries(snapshot.records || {})) {
      const map = new Map();
      (recordArray || []).forEach((r) => map.set(r._id, r));
      this._records.set(id, map);
    }

    this._idCounter = snapshot.idCounter || 1;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _getRecords(collectionId) {
    if (!this._records.has(collectionId)) {
      this._records.set(collectionId, new Map());
    }
    return this._records.get(collectionId);
  }

  _emit(collectionId, type, record) {
    const listeners = this._listeners.get(collectionId) || [];
    const globalListeners = this._listeners.get('*') || [];
    const event = { collectionId, type, record };
    [...listeners, ...globalListeners].forEach((fn) => {
      try { fn(event); } catch (e) { console.error('[DataStore] Listener error:', e); }
    });
  }
}

// ─── Singleton Instance ───────────────────────────────────────────────────────

export const dataStore = new DataStore();
