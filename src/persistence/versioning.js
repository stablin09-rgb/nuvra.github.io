/**
 * versioning.js — Nuvra Foundation (Phase 0–1)
 *
 * Schema versioning and migration system for the persistence layer.
 *
 * When the persisted state schema changes, a migration function is
 * registered here. On load, the StorageEngine detects the stored
 * schema version and runs all migrations in order to bring the
 * snapshot up to the current version.
 *
 * Migration contract:
 *   migrate(snapshot: object): object
 *   - Receives the snapshot at the previous version
 *   - Returns the snapshot at the new version
 *   - MUST be pure (no side effects)
 *   - MUST NOT throw — return the snapshot unchanged on error
 *
 * @module persistence/versioning
 */
'use strict';

// ─── Current Schema Version ───────────────────────────────────────────────────
export const CURRENT_SCHEMA_VERSION = 1;

// ─── Migration Registry ───────────────────────────────────────────────────────
// Each entry: { from: number, to: number, migrate: Function }
// Migrations MUST be registered in ascending order.
const _migrations = [];

/**
 * Register a migration.
 * @param {number}   from
 * @param {number}   to
 * @param {Function} migrate
 */
export function registerMigration(from, to, migrate) {
  if (typeof from !== 'number' || typeof to !== 'number') {
    throw new TypeError('registerMigration: from and to must be numbers');
  }
  if (to !== from + 1) {
    throw new Error(`registerMigration: migrations must be sequential (got ${from} → ${to})`);
  }
  if (typeof migrate !== 'function') {
    throw new TypeError('registerMigration: migrate must be a function');
  }
  _migrations.push({ from, to, migrate });
}

// ─── Built-in Migrations ──────────────────────────────────────────────────────
// v0 → v1: initial schema (no-op, just stamps the version)
registerMigration(0, 1, (snapshot) => {
  return {
    ...snapshot,
    _schemaVersion: 1,
  };
});

// Future migrations are registered here, e.g.:
// registerMigration(1, 2, (snapshot) => { ... });

// ─── Migration Runner ─────────────────────────────────────────────────────────
/**
 * Run all necessary migrations to bring a snapshot to the current version.
 * @param {object} snapshot
 * @param {number} fromVersion
 * @returns {{ snapshot: object, migrationsRun: number[] }}
 */
export function runMigrations(snapshot, fromVersion) {
  let current = snapshot;
  const migrationsRun = [];

  const pending = _migrations
    .filter(m => m.from >= fromVersion && m.to <= CURRENT_SCHEMA_VERSION)
    .sort((a, b) => a.from - b.from);

  for (const { from, to, migrate } of pending) {
    try {
      current = migrate(current);
      migrationsRun.push(to);
    } catch (err) {
      console.error(`[Versioning] Migration ${from}→${to} failed:`, err);
      // Return the snapshot as-is rather than corrupting it further
      break;
    }
  }

  return { snapshot: current, migrationsRun };
}

/**
 * Get the schema version from a snapshot.
 * Returns 0 if no version is stamped (legacy / first boot).
 * @param {object} snapshot
 * @returns {number}
 */
export function getSnapshotVersion(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return 0;
  const v = snapshot._schemaVersion;
  return typeof v === 'number' ? v : 0;
}
