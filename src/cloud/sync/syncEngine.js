/**
 * syncEngine.js — Nuvra Phase 6
 *
 * Bidirectional cloud sync engine.
 *
 * Sync model:
 *  - Local state is PRIMARY
 *  - Cloud is eventual consistency
 *  - Explicit merge strategies — no silent overwrites
 *  - Human-readable conflict resolution
 *  - Vector clocks for causality tracking
 *
 * Sync flow:
 *  1. Pull remote changes since last sync
 *  2. Detect conflicts (local changed AND remote changed since last sync)
 *  3. Resolve conflicts using the configured strategy
 *  4. Apply resolved changes to local state
 *  5. Push local changes to cloud
 *  6. Update sync state (vector clock, last sync timestamp)
 *
 * @module cloud/sync/syncEngine
 */
'use strict';

// ─── Merge Strategies ─────────────────────────────────────────────────────────
export const MergeStrategy = Object.freeze({
  LOCAL_WINS:    'local_wins',   // Local always wins — discard remote
  REMOTE_WINS:   'remote_wins',  // Remote always wins — discard local
  LATEST_WINS:   'latest_wins',  // Most recently modified wins
  MANUAL:        'manual',       // Queue for human resolution
  THREE_WAY:     'three_way',    // Merge using common ancestor (future)
});

// ─── Sync Status ──────────────────────────────────────────────────────────────
export const SyncStatus = Object.freeze({
  IDLE:          'idle',
  PULLING:       'pulling',
  PUSHING:       'pushing',
  CONFLICT:      'conflict',
  SYNCED:        'synced',
  ERROR:         'error',
  OFFLINE:       'offline',
});

// ─── Conflict Record ──────────────────────────────────────────────────────────
function makeConflict(projectId, schemaType, local, remote) {
  return {
    id:           `conflict_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    projectId,
    schemaType,
    local:        { data: local.data, updatedAt: local.updatedAt },
    remote:       { data: remote.data, updatedAt: remote.updated_at },
    detectedAt:   Date.now(),
    resolvedAt:   null,
    resolution:   null, // 'local' | 'remote' | 'merged'
    resolvedData: null,
  };
}

export class SyncEngine {
  /**
   * @param {object} params
   * @param {CloudProviderContract} params.cloudAdapter
   * @param {object}                params.store
   * @param {object}                params.eventBus
   * @param {function}              params.getLocalSchema  - (projectId, type) => schema
   * @param {function}              params.setLocalSchema  - (projectId, type, data) => void
   * @param {string}                [params.defaultStrategy]
   */
  constructor({ cloudAdapter, store, eventBus, getLocalSchema, setLocalSchema, defaultStrategy }) {
    this._cloud           = cloudAdapter;
    this._store           = store;
    this._eventBus        = eventBus;
    this._getLocalSchema  = getLocalSchema;
    this._setLocalSchema  = setLocalSchema;
    this._strategy        = defaultStrategy || MergeStrategy.LATEST_WINS;
    this._syncState       = {};   // projectId → { lastSyncAt, vectorClock, deviceId }
    this._pendingConflicts= [];   // Unresolved conflicts
    this._isSyncing       = false;
    this._offlineQueue    = [];   // Changes queued while offline
    this._status          = SyncStatus.IDLE;
    this._deviceId        = _getDeviceId();
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  /**
   * Perform a full bidirectional sync for a project.
   * @param {string} projectId
   * @param {string[]} schemaTypes - Which schema types to sync
   * @returns {Promise<SyncResult>}
   */
  async sync(projectId, schemaTypes) {
    if (this._isSyncing) {
      return { ok: false, error: 'Sync already in progress', skipped: true };
    }

    this._isSyncing = true;
    this._setStatus(SyncStatus.PULLING);

    try {
      const syncState = this._getSyncState(projectId);
      const since     = syncState.lastSyncAt || 0;

      // Step 1: Pull remote changes
      const pullResult = await this._cloud.pullChanges(projectId, since);
      if (!pullResult.ok) {
        this._setStatus(SyncStatus.ERROR);
        return { ok: false, error: pullResult.error };
      }

      const remoteChanges = pullResult.data.changes || [];
      const conflicts     = [];
      const applied       = [];

      // Step 2: Detect and resolve conflicts
      for (const remoteChange of remoteChanges) {
        const schemaType  = remoteChange.schema_type;
        const localSchema = await this._getLocalSchema(projectId, schemaType);

        if (!localSchema) {
          // No local version — just apply the remote change
          await this._setLocalSchema(projectId, schemaType, remoteChange.data);
          applied.push({ schemaType, action: 'applied_remote' });
          continue;
        }

        const localUpdatedAt  = localSchema._updatedAt || 0;
        const remoteUpdatedAt = new Date(remoteChange.updated_at || 0).getTime();

        // Check if both local and remote changed since last sync
        const localChangedSinceSync  = localUpdatedAt  > since;
        const remoteChangedSinceSync = remoteUpdatedAt > since;

        if (localChangedSinceSync && remoteChangedSinceSync) {
          // CONFLICT
          const conflict = makeConflict(projectId, schemaType, localSchema, remoteChange);
          const resolved = this._resolveConflict(conflict, this._strategy);

          if (resolved.strategy === MergeStrategy.MANUAL) {
            this._pendingConflicts.push(conflict);
            conflicts.push({ schemaType, conflict: conflict.id });
            this._eventBus.emit('sync:conflict_detected', { projectId, conflict });
          } else {
            if (resolved.useRemote) {
              await this._setLocalSchema(projectId, schemaType, remoteChange.data);
            }
            applied.push({ schemaType, action: `resolved_${resolved.strategy}` });
          }
        } else if (remoteChangedSinceSync) {
          // Remote is newer — apply it
          await this._setLocalSchema(projectId, schemaType, remoteChange.data);
          applied.push({ schemaType, action: 'applied_remote' });
        }
        // else: local is newer or same — will be pushed below
      }

      // Step 3: Push local changes
      this._setStatus(SyncStatus.PUSHING);
      const localChanges = [];

      for (const schemaType of schemaTypes) {
        const localSchema = await this._getLocalSchema(projectId, schemaType);
        if (!localSchema) continue;

        const localUpdatedAt = localSchema._updatedAt || 0;
        if (localUpdatedAt > since) {
          localChanges.push({ schemaType, data: localSchema });
        }
      }

      // Also push any queued offline changes
      const offlineChanges = this._offlineQueue.filter(c => c.projectId === projectId);
      for (const oc of offlineChanges) {
        if (!localChanges.find(c => c.schemaType === oc.schemaType)) {
          localChanges.push({ schemaType: oc.schemaType, data: oc.data });
        }
      }

      let pushed = 0;
      if (localChanges.length > 0) {
        const newVectorClock = _incrementVectorClock(syncState.vectorClock, this._deviceId);
        const pushResult = await this._cloud.pushChanges(projectId, {
          changes:     localChanges,
          vectorClock: newVectorClock,
          deviceId:    this._deviceId,
        });

        if (!pushResult.ok) {
          this._setStatus(SyncStatus.ERROR);
          return { ok: false, error: pushResult.error };
        }

        pushed = pushResult.data.pushed;

        // Clear pushed offline queue items
        this._offlineQueue = this._offlineQueue.filter(c => c.projectId !== projectId);

        // Update vector clock
        this._syncState[projectId] = {
          ...syncState,
          lastSyncAt:  Date.now(),
          vectorClock: newVectorClock,
        };
      } else {
        this._syncState[projectId] = { ...syncState, lastSyncAt: Date.now() };
      }

      const hasConflicts = conflicts.length > 0;
      this._setStatus(hasConflicts ? SyncStatus.CONFLICT : SyncStatus.SYNCED);

      const result = {
        ok:        true,
        projectId,
        pulled:    applied.length,
        pushed,
        conflicts: conflicts.length,
        pendingConflicts: this._pendingConflicts.filter(c => c.projectId === projectId).length,
        syncedAt:  Date.now(),
      };

      this._store.dispatch({ type: 'SYNC_COMPLETE', payload: result });
      this._eventBus.emit('sync:complete', result);

      return result;
    } catch (err) {
      this._setStatus(SyncStatus.ERROR);
      this._eventBus.emit('sync:error', { projectId, error: err.message });
      return { ok: false, error: err.message };
    } finally {
      this._isSyncing = false;
    }
  }

  /**
   * Queue a change for sync when back online.
   * @param {string} projectId
   * @param {string} schemaType
   * @param {object} data
   */
  queueOfflineChange(projectId, schemaType, data) {
    // Remove any existing queued change for the same schema
    this._offlineQueue = this._offlineQueue.filter(
      c => !(c.projectId === projectId && c.schemaType === schemaType)
    );
    this._offlineQueue.push({ projectId, schemaType, data, queuedAt: Date.now() });
    this._eventBus.emit('sync:offline_change_queued', { projectId, schemaType, queuedCount: this._offlineQueue.length });
  }

  /**
   * Resolve a pending conflict manually.
   * @param {string} conflictId
   * @param {'local'|'remote'|'merged'} resolution
   * @param {object} [mergedData] - Required if resolution === 'merged'
   */
  async resolveConflict(conflictId, resolution, mergedData = null) {
    const idx = this._pendingConflicts.findIndex(c => c.id === conflictId);
    if (idx === -1) return { ok: false, error: 'Conflict not found' };

    const conflict = this._pendingConflicts[idx];
    conflict.resolvedAt   = Date.now();
    conflict.resolution   = resolution;
    conflict.resolvedData = resolution === 'merged' ? mergedData
      : resolution === 'local'  ? conflict.local.data
      : conflict.remote.data;

    // Apply the resolved data
    await this._setLocalSchema(conflict.projectId, conflict.schemaType, conflict.resolvedData);

    // Remove from pending
    this._pendingConflicts.splice(idx, 1);

    this._eventBus.emit('sync:conflict_resolved', { conflictId, resolution, projectId: conflict.projectId });

    if (this._pendingConflicts.length === 0) {
      this._setStatus(SyncStatus.SYNCED);
    }

    return { ok: true, conflict };
  }

  /**
   * Get all pending (unresolved) conflicts.
   */
  getPendingConflicts() {
    return [...this._pendingConflicts];
  }

  /**
   * Get the current sync status.
   */
  getStatus() {
    return this._status;
  }

  /**
   * Get the offline queue size.
   */
  getOfflineQueueSize() {
    return this._offlineQueue.length;
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  _resolveConflict(conflict, strategy) {
    switch (strategy) {
      case MergeStrategy.LOCAL_WINS:
        return { strategy, useRemote: false };

      case MergeStrategy.REMOTE_WINS:
        return { strategy, useRemote: true };

      case MergeStrategy.LATEST_WINS: {
        const localTime  = conflict.local.updatedAt  || 0;
        const remoteTime = conflict.remote.updatedAt || 0;
        return { strategy, useRemote: remoteTime > localTime };
      }

      case MergeStrategy.MANUAL:
      default:
        return { strategy: MergeStrategy.MANUAL, useRemote: false };
    }
  }

  _getSyncState(projectId) {
    return this._syncState[projectId] || {
      lastSyncAt:  0,
      vectorClock: {},
      deviceId:    this._deviceId,
    };
  }

  _setStatus(status) {
    this._status = status;
    this._store.dispatch({ type: 'SYNC_STATUS_CHANGED', payload: { status } });
    this._eventBus.emit('sync:status_changed', { status });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _getDeviceId() {
  if (typeof localStorage === 'undefined') return 'server';
  return localStorage.getItem('nuvra_device_id') || 'unknown_device';
}

function _incrementVectorClock(clock, deviceId) {
  const next = { ...(clock || {}) };
  next[deviceId] = (next[deviceId] || 0) + 1;
  return next;
}
