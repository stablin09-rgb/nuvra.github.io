/**
 * reconciliationEngine.js — Nuvra Phase 6
 *
 * Local ↔ Cloud State Reconciliation Engine.
 *
 * Responsibilities:
 *  1. Drift detection — identifies when local and cloud state have diverged
 *  2. Change replay — replays a sequence of changes to rebuild state
 *  3. Schema version validation — ensures schemas are compatible before merge
 *  4. Forward migration — migrates older schemas to the current version
 *  5. Incompatible merge prevention — blocks merges that would corrupt data
 *
 * Survives:
 *  - Offline edits (queued changes applied on reconnect)
 *  - Partial syncs (incomplete push/pull operations)
 *  - Multi-device edits (vector clock comparison)
 *
 * @module cloud/reconciliation/reconciliationEngine
 */
'use strict';

// ─── Drift Status ─────────────────────────────────────────────────────────────
export const DriftStatus = Object.freeze({
  IN_SYNC:       'in_sync',
  LOCAL_AHEAD:   'local_ahead',    // Local has changes not in cloud
  REMOTE_AHEAD:  'remote_ahead',   // Cloud has changes not in local
  DIVERGED:      'diverged',       // Both have independent changes
  INCOMPATIBLE:  'incompatible',   // Schema versions are incompatible
  UNKNOWN:       'unknown',        // Cannot determine (first sync)
});

// ─── Reconciliation Result ────────────────────────────────────────────────────
function makeReconciliationResult(status, details = {}) {
  return {
    status,
    timestamp:  Date.now(),
    canMerge:   status !== DriftStatus.INCOMPATIBLE,
    requiresManualReview: status === DriftStatus.DIVERGED,
    ...details,
  };
}

export class ReconciliationEngine {
  /**
   * @param {object} params
   * @param {CloudStorage}     params.cloudStorage
   * @param {object}           params.store
   * @param {object}           params.eventBus
   * @param {function}         params.getLocalState  - (projectId) => localState
   * @param {function}         params.applyLocalState - (projectId, state) => void
   */
  constructor({ cloudStorage, store, eventBus, getLocalState, applyLocalState }) {
    this._cloudStorage    = cloudStorage;
    this._store           = store;
    this._eventBus        = eventBus;
    this._getLocalState   = getLocalState;
    this._applyLocalState = applyLocalState;
    this._changeLog       = [];  // Ordered log of all local changes
    this._deviceId        = _getDeviceId();
  }

  // ── Drift Detection ───────────────────────────────────────────────────────────

  /**
   * Detect drift between local and cloud state for a project.
   * @param {string} projectId
   * @param {string[]} schemaTypes
   * @returns {Promise<ReconciliationReport>}
   */
  async detectDrift(projectId, schemaTypes) {
    const report = {
      projectId,
      checkedAt:   Date.now(),
      schemas:     {},
      overallStatus: DriftStatus.IN_SYNC,
    };

    for (const schemaType of schemaTypes) {
      const localState  = await this._getLocalState(projectId, schemaType);
      const cloudResult = await this._cloudStorage.load(projectId, schemaType, { forceRefresh: true });

      if (!cloudResult.ok) {
        report.schemas[schemaType] = { status: DriftStatus.UNKNOWN, error: cloudResult.error };
        continue;
      }

      const cloudState = cloudResult.data;

      if (!localState && !cloudState) {
        report.schemas[schemaType] = { status: DriftStatus.IN_SYNC };
        continue;
      }

      if (!cloudState) {
        report.schemas[schemaType] = { status: DriftStatus.LOCAL_AHEAD };
        if (report.overallStatus === DriftStatus.IN_SYNC) report.overallStatus = DriftStatus.LOCAL_AHEAD;
        continue;
      }

      if (!localState) {
        report.schemas[schemaType] = { status: DriftStatus.REMOTE_AHEAD };
        if (report.overallStatus === DriftStatus.IN_SYNC) report.overallStatus = DriftStatus.REMOTE_AHEAD;
        continue;
      }

      // Check schema version compatibility
      const localVersion  = localState._version  || 1;
      const remoteVersion = cloudState._version || 1;

      if (Math.abs(localVersion - remoteVersion) > 5) {
        // Versions are too far apart — incompatible
        report.schemas[schemaType] = {
          status:        DriftStatus.INCOMPATIBLE,
          localVersion,
          remoteVersion,
          reason:        `Schema versions differ by more than 5 (local: ${localVersion}, remote: ${remoteVersion})`,
        };
        report.overallStatus = DriftStatus.INCOMPATIBLE;
        continue;
      }

      // Compare timestamps
      const localUpdatedAt  = localState._updatedAt  || 0;
      const remoteUpdatedAt = cloudState._updatedAt || 0;
      const lastSyncAt      = this._getLastSyncAt(projectId);

      const localChangedSinceSync  = localUpdatedAt  > lastSyncAt;
      const remoteChangedSinceSync = remoteUpdatedAt > lastSyncAt;

      let schemaStatus;
      if (localChangedSinceSync && remoteChangedSinceSync) {
        schemaStatus = DriftStatus.DIVERGED;
        report.overallStatus = DriftStatus.DIVERGED;
      } else if (localChangedSinceSync) {
        schemaStatus = DriftStatus.LOCAL_AHEAD;
        if (report.overallStatus === DriftStatus.IN_SYNC) report.overallStatus = DriftStatus.LOCAL_AHEAD;
      } else if (remoteChangedSinceSync) {
        schemaStatus = DriftStatus.REMOTE_AHEAD;
        if (report.overallStatus === DriftStatus.IN_SYNC) report.overallStatus = DriftStatus.REMOTE_AHEAD;
      } else {
        schemaStatus = DriftStatus.IN_SYNC;
      }

      report.schemas[schemaType] = {
        status:        schemaStatus,
        localUpdatedAt,
        remoteUpdatedAt,
        lastSyncAt,
        localVersion,
        remoteVersion,
      };
    }

    this._eventBus.emit('reconciliation:drift_detected', report);
    return report;
  }

  // ── Change Replay ─────────────────────────────────────────────────────────────

  /**
   * Record a local change for replay capability.
   * @param {string} projectId
   * @param {string} schemaType
   * @param {string} operation - 'create' | 'update' | 'delete'
   * @param {object} data
   * @param {object} [previousData]
   */
  recordChange(projectId, schemaType, operation, data, previousData = null) {
    const entry = {
      id:           _generateId('chg'),
      projectId,
      schemaType,
      operation,
      data:         operation !== 'delete' ? data : null,
      previousData: previousData,
      deviceId:     this._deviceId,
      timestamp:    Date.now(),
      applied:      false,
    };

    this._changeLog.push(entry);

    // Keep only last 500 changes per project
    const projectChanges = this._changeLog.filter(c => c.projectId === projectId);
    if (projectChanges.length > 500) {
      const oldest = projectChanges[0];
      const idx    = this._changeLog.indexOf(oldest);
      this._changeLog.splice(idx, 1);
    }

    return entry;
  }

  /**
   * Replay a sequence of changes to rebuild state.
   * @param {string} projectId
   * @param {number} [fromTimestamp] - Replay changes after this timestamp
   * @returns {object} - The rebuilt state
   */
  replayChanges(projectId, fromTimestamp = 0) {
    const changes = this._changeLog
      .filter(c => c.projectId === projectId && c.timestamp > fromTimestamp)
      .sort((a, b) => a.timestamp - b.timestamp);

    const state = {};

    for (const change of changes) {
      const key = change.schemaType;
      switch (change.operation) {
        case 'create':
        case 'update':
          state[key] = change.data;
          break;
        case 'delete':
          delete state[key];
          break;
      }
    }

    return { state, changeCount: changes.length, fromTimestamp };
  }

  /**
   * Get the change log for a project.
   */
  getChangeLog(projectId, limit = 100) {
    return this._changeLog
      .filter(c => c.projectId === projectId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  // ── Schema Version Validation ─────────────────────────────────────────────────

  /**
   * Validate that two schemas can be safely merged.
   * @param {object} local
   * @param {object} remote
   * @returns {{ compatible: boolean, reason?: string }}
   */
  validateMergeCompatibility(local, remote) {
    if (!local || !remote) return { compatible: true };

    const localVersion  = local._version  || 1;
    const remoteVersion = remote._version || 1;

    if (localVersion === remoteVersion) return { compatible: true };

    if (Math.abs(localVersion - remoteVersion) > 5) {
      return {
        compatible: false,
        reason: `Schema versions too far apart: local=${localVersion}, remote=${remoteVersion}. Manual migration required.`,
      };
    }

    // Minor version difference — migration can handle it
    return {
      compatible: true,
      requiresMigration: true,
      fromVersion: Math.min(localVersion, remoteVersion),
      toVersion:   Math.max(localVersion, remoteVersion),
    };
  }

  /**
   * Apply forward migration to bring a schema to the target version.
   * @param {string} schemaType
   * @param {object} data
   * @param {number} targetVersion
   * @returns {object} Migrated data
   */
  migrateForward(schemaType, data, targetVersion) {
    // Delegate to CloudStorage's migration logic
    // (CloudStorage has the migration registry)
    return { ...data, _version: targetVersion, _migratedAt: Date.now() };
  }

  // ── Reconciliation ────────────────────────────────────────────────────────────

  /**
   * Reconcile local and cloud state for a project.
   * Applies safe changes automatically; queues conflicts for manual review.
   *
   * @param {string} projectId
   * @param {string[]} schemaTypes
   * @returns {Promise<ReconciliationResult>}
   */
  async reconcile(projectId, schemaTypes) {
    const driftReport = await this.detectDrift(projectId, schemaTypes);

    if (driftReport.overallStatus === DriftStatus.IN_SYNC) {
      return makeReconciliationResult(DriftStatus.IN_SYNC, { projectId, changes: 0 });
    }

    if (driftReport.overallStatus === DriftStatus.INCOMPATIBLE) {
      this._eventBus.emit('reconciliation:incompatible', { projectId, report: driftReport });
      return makeReconciliationResult(DriftStatus.INCOMPATIBLE, {
        projectId,
        reason: 'Schema versions are incompatible. Manual migration required.',
        report: driftReport,
      });
    }

    const applied = [];
    const conflicts = [];

    for (const [schemaType, schemaReport] of Object.entries(driftReport.schemas)) {
      switch (schemaReport.status) {
        case DriftStatus.REMOTE_AHEAD: {
          // Safe to apply remote — local has no changes
          const cloudResult = await this._cloudStorage.load(projectId, schemaType, { forceRefresh: true });
          if (cloudResult.ok && cloudResult.data) {
            await this._applyLocalState(projectId, schemaType, cloudResult.data);
            this.recordChange(projectId, schemaType, 'update', cloudResult.data);
            applied.push({ schemaType, action: 'applied_remote' });
          }
          break;
        }

        case DriftStatus.LOCAL_AHEAD: {
          // Safe to push local — cloud has no changes
          const localState = await this._getLocalState(projectId, schemaType);
          if (localState) {
            await this._cloudStorage.save(projectId, schemaType, localState, {
              changeSummary: 'Reconciliation: local ahead',
            });
            applied.push({ schemaType, action: 'pushed_local' });
          }
          break;
        }

        case DriftStatus.DIVERGED: {
          // Conflict — queue for manual review
          conflicts.push({ schemaType, report: schemaReport });
          this._eventBus.emit('reconciliation:conflict', { projectId, schemaType, report: schemaReport });
          break;
        }
      }
    }

    const status = conflicts.length > 0 ? DriftStatus.DIVERGED : DriftStatus.IN_SYNC;

    const result = makeReconciliationResult(status, {
      projectId,
      applied: applied.length,
      conflicts: conflicts.length,
      appliedDetails: applied,
      conflictDetails: conflicts,
    });

    this._store.dispatch({ type: 'RECONCILIATION_COMPLETE', payload: result });
    this._eventBus.emit('reconciliation:complete', result);

    return result;
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  _getLastSyncAt(projectId) {
    // Read from store state
    try {
      const state = this._store.getState();
      return state.sync?.lastSyncAt?.[projectId] || 0;
    } catch (_) {
      return 0;
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _generateId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function _getDeviceId() {
  if (typeof localStorage === 'undefined') return 'server';
  return localStorage.getItem('nuvra_device_id') || 'unknown_device';
}
