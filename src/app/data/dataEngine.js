/**
 * dataEngine.js — Nuvra Phase 3
 *
 * The Data Engine.
 *
 * Manages all data collections for a running Nuvra app.
 * This is a local-first, in-memory data store that:
 *
 *  - Boots from collection schemas (not from a database)
 *  - Enforces typed fields and validation rules on every write
 *  - Supports relationships between collections (one-to-many, many-to-one)
 *  - Is observable (emits events on every change)
 *  - Is serializable (snapshot/restore for persistence and undo)
 *  - Is portable (can later sync to Supabase, Firebase, or any backend)
 *
 * This is not a database. It is a portable data abstraction.
 *
 * @module app/data/dataEngine
 */
'use strict';

import { generateId, now, deepClone } from '../../runtime/utils.js';
import { validateField, coerceField, getDefaultValue } from './fieldTypes.js';

// ─── DataEngine ───────────────────────────────────────────────────────────────
export class DataEngine {
  /**
   * @param {object} opts
   * @param {object[]} opts.collections - Array of CollectionSchema objects
   * @param {object}   opts.eventBus    - AppEventBus instance
   */
  constructor({ collections, eventBus }) {
    this._schemas   = new Map(); // collectionId → CollectionSchema
    this._data      = new Map(); // collectionId → Map<recordId, record>
    this._eventBus  = eventBus;
    this._rawSchemas = collections || [];
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  async boot() {
    for (const schema of this._rawSchemas) {
      this._schemas.set(schema.id, schema);
      this._data.set(schema.id, new Map());

      // Seed with initial data if provided
      if (Array.isArray(schema.seedData)) {
        for (const record of schema.seedData) {
          const result = this._insertRaw(schema.id, record);
          if (!result.ok) {
            console.warn(`DataEngine: seed data error in "${schema.id}": ${result.error}`);
          }
        }
      }
    }
  }

  // ── Query ──────────────────────────────────────────────────────────────────
  /**
   * Query a collection.
   * @param {string} collectionId
   * @param {object} [query]
   * @param {object}   [query.where]   - Field conditions
   * @param {string}   [query.orderBy] - Field to sort by
   * @param {'asc'|'desc'} [query.order] - Sort direction
   * @param {number}   [query.limit]   - Max records to return
   * @param {number}   [query.offset]  - Skip N records
   * @returns {object[]}
   */
  query(collectionId, query = {}) {
    const collection = this._data.get(collectionId);
    if (!collection) return [];

    let records = Array.from(collection.values());

    // Filter
    if (query.where) {
      records = records.filter(r => this._matchWhere(r, query.where));
    }

    // Sort
    if (query.orderBy) {
      const dir = query.order === 'desc' ? -1 : 1;
      records = records.sort((a, b) => {
        const av = a[query.orderBy];
        const bv = b[query.orderBy];
        if (av < bv) return -1 * dir;
        if (av > bv) return  1 * dir;
        return 0;
      });
    }

    // Pagination
    const offset = query.offset || 0;
    if (offset > 0) records = records.slice(offset);
    if (query.limit) records = records.slice(0, query.limit);

    return records.map(r => deepClone(r));
  }

  /**
   * Get a single record by ID.
   * @param {string} collectionId
   * @param {string} recordId
   * @returns {object|null}
   */
  getById(collectionId, recordId) {
    const record = this._data.get(collectionId)?.get(recordId);
    return record ? deepClone(record) : null;
  }

  /**
   * Count records in a collection.
   * @param {string} collectionId
   * @param {object} [where]
   * @returns {number}
   */
  count(collectionId, where = null) {
    const collection = this._data.get(collectionId);
    if (!collection) return 0;
    if (!where) return collection.size;
    return Array.from(collection.values()).filter(r => this._matchWhere(r, where)).length;
  }

  // ── Insert ─────────────────────────────────────────────────────────────────
  /**
   * Insert a new record into a collection.
   * @param {string} collectionId
   * @param {object} record
   * @returns {{ ok: boolean, record?: object, errors?: object, error?: string }}
   */
  insert(collectionId, record) {
    const result = this._insertRaw(collectionId, record);
    if (result.ok) {
      this._eventBus.emit(`data:changed:${collectionId}`, {
        type:   'insert',
        record: result.record,
      });
    }
    return result;
  }

  _insertRaw(collectionId, record) {
    const schema = this._schemas.get(collectionId);
    if (!schema) return { ok: false, error: `Unknown collection: ${collectionId}` };

    // Build a complete record with defaults and coercion
    const built = this._buildRecord(schema, record);
    if (!built.ok) return built;

    // Validate
    const validation = this._validateRecord(schema, built.record);
    if (!validation.ok) return { ok: false, errors: validation.errors };

    // Assign system fields
    const id = built.record._id || generateId('rec');
    const now_ = now();
    const final = {
      ...built.record,
      _id:        id,
      _createdAt: built.record._createdAt || now_,
      _updatedAt: now_,
    };

    this._data.get(collectionId).set(id, final);
    return { ok: true, record: deepClone(final) };
  }

  // ── Update ─────────────────────────────────────────────────────────────────
  /**
   * Update a record in a collection.
   * @param {string} collectionId
   * @param {string} recordId
   * @param {object} patch
   * @returns {{ ok: boolean, record?: object, errors?: object, error?: string }}
   */
  update(collectionId, recordId, patch) {
    const schema = this._schemas.get(collectionId);
    if (!schema) return { ok: false, error: `Unknown collection: ${collectionId}` };

    const collection = this._data.get(collectionId);
    const existing = collection?.get(recordId);
    if (!existing) return { ok: false, error: `Record not found: ${recordId}` };

    // Merge patch into existing
    const merged = { ...existing, ...patch, _id: recordId, _updatedAt: now() };

    // Validate the merged record
    const validation = this._validateRecord(schema, merged);
    if (!validation.ok) return { ok: false, errors: validation.errors };

    collection.set(recordId, merged);

    this._eventBus.emit(`data:changed:${collectionId}`, {
      type:   'update',
      record: deepClone(merged),
    });

    return { ok: true, record: deepClone(merged) };
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  /**
   * Delete a record from a collection.
   * @param {string} collectionId
   * @param {string} recordId
   * @returns {{ ok: boolean, error?: string }}
   */
  delete(collectionId, recordId) {
    const collection = this._data.get(collectionId);
    if (!collection) return { ok: false, error: `Unknown collection: ${collectionId}` };
    if (!collection.has(recordId)) return { ok: false, error: `Record not found: ${recordId}` };

    collection.delete(recordId);

    this._eventBus.emit(`data:changed:${collectionId}`, {
      type:     'delete',
      recordId,
    });

    return { ok: true };
  }

  // ── Internal ───────────────────────────────────────────────────────────────
  _buildRecord(schema, raw) {
    const record = {};
    for (const fieldDef of (schema.fields || [])) {
      const rawValue = raw[fieldDef.id];
      if (rawValue === undefined || rawValue === null) {
        record[fieldDef.id] = getDefaultValue(fieldDef);
      } else {
        record[fieldDef.id] = coerceField(rawValue, fieldDef);
      }
    }
    // Preserve _id if provided (for seeding)
    if (raw._id) record._id = raw._id;
    return { ok: true, record };
  }

  _validateRecord(schema, record) {
    const errors = {};
    let hasErrors = false;
    for (const fieldDef of (schema.fields || [])) {
      const result = validateField(record[fieldDef.id], fieldDef);
      if (!result.ok) {
        errors[fieldDef.id] = result.error;
        hasErrors = true;
      }
    }
    return hasErrors ? { ok: false, errors } : { ok: true };
  }

  _matchWhere(record, where) {
    for (const [field, condition] of Object.entries(where)) {
      if (typeof condition === 'object' && condition !== null) {
        if ('eq'       in condition && record[field] !== condition.eq)       return false;
        if ('neq'      in condition && record[field] === condition.neq)      return false;
        if ('gt'       in condition && !(record[field] > condition.gt))      return false;
        if ('gte'      in condition && !(record[field] >= condition.gte))    return false;
        if ('lt'       in condition && !(record[field] < condition.lt))      return false;
        if ('lte'      in condition && !(record[field] <= condition.lte))    return false;
        if ('contains' in condition && !String(record[field]).toLowerCase().includes(String(condition.contains).toLowerCase())) return false;
        if ('in'       in condition && !condition.in.includes(record[field])) return false;
        if ('notIn'    in condition && condition.notIn.includes(record[field])) return false;
      } else {
        if (record[field] !== condition) return false;
      }
    }
    return true;
  }

  // ── Snapshot / Restore ─────────────────────────────────────────────────────
  snapshot() {
    const snap = {};
    for (const [collId, collection] of this._data) {
      snap[collId] = Array.from(collection.values()).map(r => deepClone(r));
    }
    return snap;
  }

  restore(snap) {
    for (const [collId, records] of Object.entries(snap)) {
      const collection = this._data.get(collId);
      if (!collection) continue;
      collection.clear();
      for (const record of records) {
        collection.set(record._id, deepClone(record));
      }
    }
  }

  // ── Destroy ────────────────────────────────────────────────────────────────
  destroy() {
    this._data.clear();
    this._schemas.clear();
  }
}

export default DataEngine;
