/**
 * ownershipManager.js — Nuvra Phase 6
 *
 * Project ownership and access control.
 *
 * Every project has:
 *  - An owner (the user who created it)
 *  - A permissions model (read, edit, admin)
 *  - Visibility rules (private, shared, public)
 *  - Share tokens (future)
 *
 * Designed for teams without implementing full teams yet.
 * The architecture supports team expansion without schema changes.
 *
 * Zero-trust: every operation is checked against the ownership model.
 *
 * @module ownership/ownershipManager
 */
'use strict';

// ─── Permission Levels ────────────────────────────────────────────────────────
export const Permission = Object.freeze({
  READ:  'read',   // Can view the project
  EDIT:  'edit',   // Can modify pages, schemas, content
  ADMIN: 'admin',  // Can manage permissions, delete, publish
  OWNER: 'owner',  // Full control, cannot be removed
});

// ─── Visibility ───────────────────────────────────────────────────────────────
export const Visibility = Object.freeze({
  PRIVATE: 'private', // Only owner (and granted users) can access
  SHARED:  'shared',  // Accessible via share token
  PUBLIC:  'public',  // Publicly readable
});

// ─── Permission Hierarchy ─────────────────────────────────────────────────────
const PERMISSION_RANK = {
  [Permission.READ]:  1,
  [Permission.EDIT]:  2,
  [Permission.ADMIN]: 3,
  [Permission.OWNER]: 4,
};

function hasPermission(userPermission, requiredPermission) {
  return (PERMISSION_RANK[userPermission] || 0) >= (PERMISSION_RANK[requiredPermission] || 0);
}

// ─── Project Record ───────────────────────────────────────────────────────────
export function createProjectRecord({ id, name, ownerId, description = null, visibility = Visibility.PRIVATE, settings = {} }) {
  return {
    id,
    name,
    ownerId,
    description,
    visibility,
    settings,
    permissions: {},  // userId → Permission (for non-owners)
    shareTokens: [],  // Future: { token, permission, expiresAt }
    createdAt:   Date.now(),
    updatedAt:   Date.now(),
  };
}

export class OwnershipManager {
  /**
   * @param {object} params
   * @param {object} params.store
   * @param {object} params.eventBus
   * @param {CloudProviderContract} params.cloudAdapter
   * @param {function} params.getCurrentUserId - () => string|null
   */
  constructor({ store, eventBus, cloudAdapter, getCurrentUserId }) {
    this._store            = store;
    this._eventBus         = eventBus;
    this._cloud            = cloudAdapter;
    this._getCurrentUserId = getCurrentUserId;
    this._projects         = {};  // projectId → ProjectRecord (local cache)
  }

  // ── Project Lifecycle ─────────────────────────────────────────────────────────

  /**
   * Create a new project owned by the current user.
   */
  async createProject({ name, description, visibility, settings }) {
    const userId = this._getCurrentUserId();
    if (!userId) return { ok: false, error: 'Not authenticated' };

    const project = createProjectRecord({
      id:          _generateId('proj'),
      name,
      ownerId:     userId,
      description: description || null,
      visibility:  visibility || Visibility.PRIVATE,
      settings:    settings || {},
    });

    this._projects[project.id] = project;

    // Persist to cloud
    if (this._cloud) {
      const result = await this._cloud.createProject(project);
      if (!result.ok) {
        // Keep local copy even if cloud fails — will sync later
        this._eventBus.emit('ownership:project_cloud_save_failed', { projectId: project.id, error: result.error });
      }
    }

    this._store.dispatch({ type: 'PROJECT_CREATED', payload: { project } });
    this._eventBus.emit('ownership:project_created', { project });

    return { ok: true, project };
  }

  /**
   * Load all projects for the current user.
   */
  async loadProjects() {
    const userId = this._getCurrentUserId();
    if (!userId) return { ok: false, error: 'Not authenticated', projects: [] };

    if (this._cloud) {
      const result = await this._cloud.listProjects(userId);
      if (result.ok) {
        for (const p of result.data) {
          this._projects[p.id] = _normalizeProject(p);
        }
      }
    }

    const projects = Object.values(this._projects)
      .filter(p => p.ownerId === userId && !p.deletedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    this._store.dispatch({ type: 'PROJECTS_LOADED', payload: { projects } });
    return { ok: true, projects };
  }

  /**
   * Delete a project (soft delete).
   */
  async deleteProject(projectId) {
    const check = this._checkPermission(projectId, Permission.OWNER);
    if (!check.ok) return check;

    this._projects[projectId].deletedAt = Date.now();

    if (this._cloud) {
      await this._cloud.deleteProject(projectId);
    }

    this._store.dispatch({ type: 'PROJECT_DELETED', payload: { projectId } });
    this._eventBus.emit('ownership:project_deleted', { projectId });

    return { ok: true };
  }

  // ── Access Control ────────────────────────────────────────────────────────────

  /**
   * Get the current user's permission level for a project.
   * @returns {Permission|null}
   */
  getUserPermission(projectId) {
    const userId  = this._getCurrentUserId();
    const project = this._projects[projectId];

    if (!userId || !project) return null;
    if (project.ownerId === userId) return Permission.OWNER;
    if (project.visibility === Visibility.PUBLIC) return Permission.READ;

    return project.permissions[userId] || null;
  }

  /**
   * Check if the current user can perform an action requiring a permission level.
   */
  canPerform(projectId, requiredPermission) {
    const userPermission = this.getUserPermission(projectId);
    if (!userPermission) return false;
    return hasPermission(userPermission, requiredPermission);
  }

  /**
   * Grant a permission to a user on a project.
   * Requires ADMIN or OWNER permission.
   */
  async grantPermission(projectId, targetUserId, permission) {
    const check = this._checkPermission(projectId, Permission.ADMIN);
    if (!check.ok) return check;

    const project = this._projects[projectId];

    // Cannot grant OWNER permission
    if (permission === Permission.OWNER) {
      return { ok: false, error: 'Cannot grant OWNER permission. Use transferOwnership() instead.' };
    }

    // Cannot modify owner's permissions
    if (targetUserId === project.ownerId) {
      return { ok: false, error: 'Cannot modify owner permissions.' };
    }

    project.permissions[targetUserId] = permission;
    project.updatedAt = Date.now();

    if (this._cloud) {
      await this._cloud.updateProject(projectId, { permissions: project.permissions });
    }

    this._eventBus.emit('ownership:permission_granted', { projectId, targetUserId, permission });
    return { ok: true };
  }

  /**
   * Revoke a user's permission on a project.
   */
  async revokePermission(projectId, targetUserId) {
    const check = this._checkPermission(projectId, Permission.ADMIN);
    if (!check.ok) return check;

    const project = this._projects[projectId];
    if (targetUserId === project.ownerId) {
      return { ok: false, error: 'Cannot revoke owner permissions.' };
    }

    delete project.permissions[targetUserId];
    project.updatedAt = Date.now();

    if (this._cloud) {
      await this._cloud.updateProject(projectId, { permissions: project.permissions });
    }

    this._eventBus.emit('ownership:permission_revoked', { projectId, targetUserId });
    return { ok: true };
  }

  /**
   * Transfer project ownership to another user.
   * Only the current owner can do this.
   */
  async transferOwnership(projectId, newOwnerId) {
    const userId  = this._getCurrentUserId();
    const project = this._projects[projectId];

    if (!project) return { ok: false, error: 'Project not found' };
    if (project.ownerId !== userId) return { ok: false, error: 'Only the owner can transfer ownership.' };

    // Give the old owner ADMIN permission
    project.permissions[userId] = Permission.ADMIN;
    project.ownerId   = newOwnerId;
    project.updatedAt = Date.now();

    if (this._cloud) {
      await this._cloud.updateProject(projectId, { ownerId: newOwnerId, permissions: project.permissions });
    }

    this._eventBus.emit('ownership:ownership_transferred', { projectId, from: userId, to: newOwnerId });
    return { ok: true };
  }

  // ── Visibility ────────────────────────────────────────────────────────────────

  async setVisibility(projectId, visibility) {
    const check = this._checkPermission(projectId, Permission.ADMIN);
    if (!check.ok) return check;

    this._projects[projectId].visibility = visibility;
    this._projects[projectId].updatedAt  = Date.now();

    if (this._cloud) {
      await this._cloud.updateProject(projectId, { visibility });
    }

    this._eventBus.emit('ownership:visibility_changed', { projectId, visibility });
    return { ok: true };
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  getProject(projectId) {
    return this._projects[projectId] || null;
  }

  getOwnedProjects() {
    const userId = this._getCurrentUserId();
    return Object.values(this._projects).filter(p => p.ownerId === userId && !p.deletedAt);
  }

  getAccessibleProjects() {
    const userId = this._getCurrentUserId();
    return Object.values(this._projects).filter(p => {
      if (p.deletedAt) return false;
      if (p.ownerId === userId) return true;
      if (p.visibility === Visibility.PUBLIC) return true;
      if (p.permissions[userId]) return true;
      return false;
    });
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  _checkPermission(projectId, requiredPermission) {
    const userId  = this._getCurrentUserId();
    if (!userId) return { ok: false, error: 'Not authenticated' };

    const project = this._projects[projectId];
    if (!project) return { ok: false, error: 'Project not found' };

    if (!this.canPerform(projectId, requiredPermission)) {
      return { ok: false, error: `Insufficient permissions. Required: ${requiredPermission}` };
    }

    return { ok: true };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _generateId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function _normalizeProject(raw) {
  return {
    id:          raw.id,
    name:        raw.name,
    ownerId:     raw.owner_id || raw.ownerId,
    description: raw.description || null,
    visibility:  raw.visibility || Visibility.PRIVATE,
    settings:    raw.settings || {},
    permissions: raw.permissions || {},
    shareTokens: raw.share_tokens || raw.shareTokens || [],
    createdAt:   raw.created_at ? new Date(raw.created_at).getTime() : Date.now(),
    updatedAt:   raw.updated_at ? new Date(raw.updated_at).getTime() : Date.now(),
  };
}
