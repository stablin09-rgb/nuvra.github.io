/**
 * Nuvra Enterprise — Organization Service (Phase 12)
 *
 * Implements the Organization-First Architecture:
 *
 *   Organization
 *     └── Workspace (1..n per org)
 *           └── Team (0..n per workspace)
 *                 └── Member (user + role + policy overrides)
 *
 * A single user may belong to:
 *   - Multiple organizations
 *   - Multiple teams within each org
 *   - Different roles per workspace
 *
 * Roles (ordered by privilege, lowest to highest):
 *   viewer → editor → developer → admin → owner
 *
 * This module is the single source of truth for org identity.
 * It does NOT enforce policies — that is policyEngine.js's job.
 *
 * Storage:
 *   - Cloud: nuvra_orgs, nuvra_workspaces, nuvra_teams, nuvra_members tables
 *   - Local fallback: localStorage under nuvra-org-{userId}
 *
 * @module orgService
 */
'use strict';

import { cloud }        from '../cloud/cloud.js';
import { auditService } from './auditService.js';

// ─── Role Hierarchy ───────────────────────────────────────────────────────────

export const ROLES = Object.freeze({
  VIEWER:    'viewer',
  EDITOR:    'editor',
  DEVELOPER: 'developer',
  ADMIN:     'admin',
  OWNER:     'owner',
});

const ROLE_RANK = {
  viewer: 1, editor: 2, developer: 3, admin: 4, owner: 5,
};

export function roleAtLeast(userRole, requiredRole) {
  return (ROLE_RANK[userRole] || 0) >= (ROLE_RANK[requiredRole] || 0);
}

// ─── Org Plan Tiers ───────────────────────────────────────────────────────────

export const ORG_PLANS = Object.freeze({
  FREE:       'free',
  TEAM:       'team',
  BUSINESS:   'business',
  ENTERPRISE: 'enterprise',
  WHITE_LABEL: 'white_label',
});

// ─── Internal State ───────────────────────────────────────────────────────────

let _userId     = null;
let _activeOrg  = null;   // { id, name, plan, settings, ... }
let _activeWs   = null;   // { id, name, orgId, ... }
let _membership = null;   // { role, teamIds, policyOverrides }
let _listeners  = [];

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Initialize the org service for the current user.
 * Loads the user's last active org from localStorage, then refreshes from cloud.
 *
 * @param {string|null} userId - The authenticated user ID (null for anonymous)
 */
export async function init(userId) {
  _userId = userId;

  if (!userId) {
    // Anonymous users have no org context
    _activeOrg  = null;
    _activeWs   = null;
    _membership = null;
    return;
  }

  // Restore last active org from localStorage
  const cached = _loadCached(userId);
  if (cached?.orgId) {
    await _loadOrg(cached.orgId, cached.workspaceId);
  }
}

// ─── Org CRUD ─────────────────────────────────────────────────────────────────

/**
 * Create a new organization and set it as active.
 *
 * @param {object} opts
 * @param {string} opts.name
 * @param {string} [opts.plan='free']
 * @param {object} [opts.settings={}]
 * @returns {Promise<{org, workspace}>}
 */
export async function createOrg({ name, plan = ORG_PLANS.FREE, settings = {} }) {
  if (!_userId) throw new Error('Must be authenticated to create an organization.');

  const orgId = _uuid();
  const wsId  = _uuid();
  const now   = new Date().toISOString();

  const org = {
    id: orgId, name, plan, settings,
    ownerId: _userId,
    createdAt: now, updatedAt: now,
  };

  const workspace = {
    id: wsId, name: 'Default Workspace',
    orgId, createdAt: now, updatedAt: now,
  };

  const member = {
    id: _uuid(), orgId, workspaceId: wsId,
    userId: _userId, role: ROLES.OWNER,
    teamIds: [], policyOverrides: {},
    joinedAt: now,
  };

  // Persist to cloud
  if (cloud.isCloudAvailable()) {
    await cloud.orgs.create(org);
    await cloud.orgs.createWorkspace(workspace);
    await cloud.orgs.addMember(member);
  }

  // Persist to local fallback
  _saveLocal(orgId, org, workspace, member);

  // Set as active
  _activeOrg  = org;
  _activeWs   = workspace;
  _membership = { role: ROLES.OWNER, teamIds: [], policyOverrides: {} };

  _saveActiveCached(_userId, orgId, wsId);
  _emit('org.created', { org, workspace });

  await auditService.log({
    action: 'org.created',
    orgId,
    userId: _userId,
    meta: { name, plan },
  });

  return { org, workspace };
}

/**
 * List all organizations the current user belongs to.
 *
 * @returns {Promise<Array>}
 */
export async function listOrgs() {
  if (!_userId) return [];

  if (cloud.isCloudAvailable()) {
    const { data, error } = await cloud.orgs.listForUser(_userId);
    if (!error && data) return data;
  }

  // Fallback: scan localStorage
  return _listLocalOrgs(_userId);
}

/**
 * Switch the active organization and workspace.
 *
 * @param {string} orgId
 * @param {string} [workspaceId] - defaults to the org's first workspace
 */
export async function switchOrg(orgId, workspaceId) {
  await _loadOrg(orgId, workspaceId);
  _saveActiveCached(_userId, orgId, _activeWs?.id);
  _emit('org.switched', { org: _activeOrg, workspace: _activeWs });
}

/**
 * Update org settings (admin/owner only).
 *
 * @param {object} updates - Partial org fields to update
 */
export async function updateOrg(updates) {
  _requireRole(ROLES.ADMIN);
  const now = new Date().toISOString();
  const updated = { ..._activeOrg, ...updates, updatedAt: now };

  if (cloud.isCloudAvailable()) {
    await cloud.orgs.update(_activeOrg.id, updates);
  }

  _activeOrg = updated;
  _updateLocalOrg(_activeOrg.id, updated);
  _emit('org.updated', { org: updated });

  await auditService.log({
    action: 'org.updated',
    orgId: _activeOrg.id,
    userId: _userId,
    meta: { updates },
  });
}

/**
 * Delete an organization (owner only).
 */
export async function deleteOrg() {
  _requireRole(ROLES.OWNER);

  if (cloud.isCloudAvailable()) {
    await cloud.orgs.delete(_activeOrg.id);
  }

  const orgId = _activeOrg.id;
  _clearLocalOrg(orgId);
  _activeOrg  = null;
  _activeWs   = null;
  _membership = null;
  _clearActiveCached(_userId);

  _emit('org.deleted', { orgId });

  await auditService.log({
    action: 'org.deleted',
    orgId,
    userId: _userId,
    meta: {},
  });
}

// ─── Workspace CRUD ───────────────────────────────────────────────────────────

/**
 * Create a new workspace within the active org.
 */
export async function createWorkspace(name) {
  _requireRole(ROLES.ADMIN);
  const ws = {
    id: _uuid(), name, orgId: _activeOrg.id,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  if (cloud.isCloudAvailable()) {
    await cloud.orgs.createWorkspace(ws);
  }
  _emit('workspace.created', { workspace: ws });
  await auditService.log({ action: 'workspace.created', orgId: _activeOrg.id, userId: _userId, meta: { name } });
  return ws;
}

/**
 * List all workspaces in the active org.
 */
export async function listWorkspaces() {
  if (!_activeOrg) return [];
  if (cloud.isCloudAvailable()) {
    const { data } = await cloud.orgs.listWorkspaces(_activeOrg.id);
    return data || [];
  }
  return _listLocalWorkspaces(_activeOrg.id);
}

// ─── Member Management ────────────────────────────────────────────────────────

/**
 * Invite a user to the active org.
 *
 * @param {string} email
 * @param {string} role
 * @param {string} [workspaceId]
 */
export async function inviteMember(email, role = ROLES.EDITOR, workspaceId) {
  _requireRole(ROLES.ADMIN);
  const wsId = workspaceId || _activeWs?.id;

  const invite = {
    id: _uuid(),
    orgId: _activeOrg.id,
    workspaceId: wsId,
    email,
    role,
    invitedBy: _userId,
    invitedAt: new Date().toISOString(),
    status: 'pending',
  };

  if (cloud.isCloudAvailable()) {
    await cloud.orgs.createInvite(invite);
  }

  _emit('member.invited', { invite });

  await auditService.log({
    action: 'member.invited',
    orgId: _activeOrg.id,
    userId: _userId,
    meta: { email, role },
  });

  return invite;
}

/**
 * List all members of the active org.
 */
export async function listMembers() {
  if (!_activeOrg) return [];
  if (cloud.isCloudAvailable()) {
    const { data } = await cloud.orgs.listMembers(_activeOrg.id);
    return data || [];
  }
  return [];
}

/**
 * Update a member's role.
 */
export async function updateMemberRole(memberId, newRole) {
  _requireRole(ROLES.ADMIN);
  if (cloud.isCloudAvailable()) {
    await cloud.orgs.updateMember(memberId, { role: newRole });
  }
  _emit('member.updated', { memberId, role: newRole });
  await auditService.log({
    action: 'member.role_changed',
    orgId: _activeOrg.id,
    userId: _userId,
    meta: { memberId, newRole },
  });
}

/**
 * Remove a member from the org.
 */
export async function removeMember(memberId) {
  _requireRole(ROLES.ADMIN);
  if (cloud.isCloudAvailable()) {
    await cloud.orgs.removeMember(memberId);
  }
  _emit('member.removed', { memberId });
  await auditService.log({
    action: 'member.removed',
    orgId: _activeOrg.id,
    userId: _userId,
    meta: { memberId },
  });
}

// ─── Team Management ──────────────────────────────────────────────────────────

/**
 * Create a team within the active workspace.
 */
export async function createTeam(name, memberIds = []) {
  _requireRole(ROLES.ADMIN);
  const team = {
    id: _uuid(), name,
    orgId: _activeOrg.id,
    workspaceId: _activeWs?.id,
    memberIds,
    createdAt: new Date().toISOString(),
  };
  if (cloud.isCloudAvailable()) {
    await cloud.orgs.createTeam(team);
  }
  _emit('team.created', { team });
  await auditService.log({ action: 'team.created', orgId: _activeOrg.id, userId: _userId, meta: { name } });
  return team;
}

/**
 * List all teams in the active workspace.
 */
export async function listTeams() {
  if (!_activeOrg) return [];
  if (cloud.isCloudAvailable()) {
    const { data } = await cloud.orgs.listTeams(_activeOrg.id, _activeWs?.id);
    return data || [];
  }
  return [];
}

// ─── Accessors ────────────────────────────────────────────────────────────────

export function getActiveOrg()        { return _activeOrg; }
export function getActiveWorkspace()  { return _activeWs; }
export function getMembership()       { return _membership; }
export function getCurrentRole()      { return _membership?.role || null; }
export function getUserId()           { return _userId; }

/**
 * Check if the current user has at least the given role.
 */
export function hasRole(role) {
  return roleAtLeast(getCurrentRole(), role);
}

// ─── Event Subscription ───────────────────────────────────────────────────────

export function subscribe(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

// ─── SSO / SAML Readiness ─────────────────────────────────────────────────────

/**
 * Configure SSO for the active org (SAML/OIDC).
 * Stores the config; actual SSO handshake is handled by Supabase Auth.
 *
 * @param {object} ssoConfig
 * @param {string} ssoConfig.provider - 'saml' | 'oidc'
 * @param {string} ssoConfig.metadataUrl - SAML metadata URL or OIDC discovery URL
 * @param {string} ssoConfig.domain - The email domain to enforce SSO for
 */
export async function configureSso(ssoConfig) {
  _requireRole(ROLES.OWNER);
  const settings = { ..._activeOrg.settings, sso: ssoConfig };
  await updateOrg({ settings });
  _emit('sso.configured', { orgId: _activeOrg.id, provider: ssoConfig.provider });
  await auditService.log({
    action: 'sso.configured',
    orgId: _activeOrg.id,
    userId: _userId,
    meta: { provider: ssoConfig.provider, domain: ssoConfig.domain },
  });
}

/**
 * Get the SSO configuration for the active org.
 */
export function getSsoConfig() {
  return _activeOrg?.settings?.sso || null;
}

// ─── SCIM Provisioning (Future-Ready) ─────────────────────────────────────────

/**
 * Generate a SCIM token for automated provisioning.
 * The token is stored in org settings; actual SCIM endpoint is a Supabase Edge Function.
 */
export async function generateScimToken() {
  _requireRole(ROLES.OWNER);
  const token = 'scim_' + _uuid().replace(/-/g, '');
  const settings = { ..._activeOrg.settings, scimToken: token };
  await updateOrg({ settings });
  await auditService.log({
    action: 'scim.token_generated',
    orgId: _activeOrg.id,
    userId: _userId,
    meta: {},
  });
  return token;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function _loadOrg(orgId, workspaceId) {
  let org, workspace, membership;

  if (cloud.isCloudAvailable()) {
    const [orgRes, wsRes, memRes] = await Promise.all([
      cloud.orgs.get(orgId),
      workspaceId ? cloud.orgs.getWorkspace(workspaceId) : cloud.orgs.getFirstWorkspace(orgId),
      cloud.orgs.getMembership(orgId, _userId),
    ]);
    org        = orgRes.data;
    workspace  = wsRes.data;
    membership = memRes.data;
  }

  if (!org) {
    // Fallback to localStorage
    const local = _readLocalOrg(orgId);
    org        = local?.org;
    workspace  = local?.workspace;
    membership = local?.membership;
  }

  if (!org) throw new Error(`Organization ${orgId} not found.`);

  _activeOrg  = org;
  _activeWs   = workspace;
  _membership = membership || { role: ROLES.VIEWER, teamIds: [], policyOverrides: {} };
}

function _requireRole(minRole) {
  if (!_membership) throw new Error('No active organization context.');
  if (!roleAtLeast(_membership.role, minRole)) {
    throw new Error(`Requires role '${minRole}' but current role is '${_membership.role}'.`);
  }
}

function _emit(event, data) {
  _listeners.forEach(fn => { try { fn(event, data); } catch {} });
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

const _LS_ORG_KEY     = id => `nuvra-org-${id}`;
const _LS_ACTIVE_KEY  = uid => `nuvra-active-org-${uid}`;
const _LS_ORG_LIST    = uid => `nuvra-org-list-${uid}`;

function _saveLocal(orgId, org, workspace, member) {
  try {
    localStorage.setItem(_LS_ORG_KEY(orgId), JSON.stringify({ org, workspace, member }));
    const list = JSON.parse(localStorage.getItem(_LS_ORG_LIST(_userId)) || '[]');
    if (!list.includes(orgId)) { list.push(orgId); localStorage.setItem(_LS_ORG_LIST(_userId), JSON.stringify(list)); }
  } catch {}
}

function _readLocalOrg(orgId) {
  try { return JSON.parse(localStorage.getItem(_LS_ORG_KEY(orgId))); } catch { return null; }
}

function _updateLocalOrg(orgId, org) {
  try {
    const existing = _readLocalOrg(orgId) || {};
    localStorage.setItem(_LS_ORG_KEY(orgId), JSON.stringify({ ...existing, org }));
  } catch {}
}

function _clearLocalOrg(orgId) {
  try { localStorage.removeItem(_LS_ORG_KEY(orgId)); } catch {}
}

function _listLocalOrgs(userId) {
  try {
    const ids = JSON.parse(localStorage.getItem(_LS_ORG_LIST(userId)) || '[]');
    return ids.map(id => _readLocalOrg(id)?.org).filter(Boolean);
  } catch { return []; }
}

function _listLocalWorkspaces(orgId) {
  try {
    const data = _readLocalOrg(orgId);
    return data?.workspace ? [data.workspace] : [];
  } catch { return []; }
}

function _loadCached(userId) {
  try { return JSON.parse(localStorage.getItem(_LS_ACTIVE_KEY(userId))); } catch { return null; }
}

function _saveActiveCached(userId, orgId, wsId) {
  try { localStorage.setItem(_LS_ACTIVE_KEY(userId), JSON.stringify({ orgId, workspaceId: wsId })); } catch {}
}

function _clearActiveCached(userId) {
  try { localStorage.removeItem(_LS_ACTIVE_KEY(userId)); } catch {}
}

// ─── UUID helper ──────────────────────────────────────────────────────────────

function _uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ─── Namespace Export for adminConsole compatibility ─────────────────────────
export const orgService = {
  init,
  createOrg,
  listOrgs,
  switchOrg,
  updateOrg,
  deleteOrg,
  createWorkspace,
  listWorkspaces,
  inviteMember,
  listMembers,
  updateMemberRole,
  removeMember,
  createTeam,
  listTeams,
  getActiveOrg,
  getActiveWorkspace,
  getMembership,
  getCurrentRole,
  getUserId,
  hasRole,
  roleAtLeast,
  configureSso,
  getSsoConfig,
  generateScimToken,
  subscribe,
  ROLES,
  ORG_PLANS,
};
