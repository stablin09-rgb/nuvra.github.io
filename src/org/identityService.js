/**
 * Nuvra Enterprise — Identity Service (Phase 12)
 *
 * Manages enterprise identity beyond basic auth:
 *
 *   - SSO enforcement (SAML / OIDC) — delegates to Supabase Auth
 *   - SCIM provisioning readiness (token generation, schema)
 *   - Session context enrichment (org, role, plan injected into session)
 *   - Domain-based org routing (user@acme.com → Acme org)
 *   - Impersonation (admin-only, fully audited)
 *   - MFA enforcement (policy-driven)
 *
 * This module wraps authManager.js and orgService.js to provide a
 * unified identity context for the rest of the application.
 *
 * @module identityService
 */
'use strict';

import { getSession, signOut }   from '../auth/authManager.js';
import { orgService, ROLES }     from './orgService.js';
import { auditService }          from './auditService.js';
import { policyEngine }          from './policyEngine.js';

// ─── Internal State ───────────────────────────────────────────────────────────

let _identityContext = null;
let _listeners       = [];

/**
 * IdentityContext shape:
 * {
 *   userId:      string | null,
 *   email:       string | null,
 *   displayName: string | null,
 *   avatarUrl:   string | null,
 *   isAnonymous: boolean,
 *   orgId:       string | null,
 *   orgName:     string | null,
 *   orgPlan:     string | null,
 *   workspaceId: string | null,
 *   role:        string | null,
 *   teamIds:     string[],
 *   ssoProvider: string | null,
 *   mfaEnabled:  boolean,
 *   sessionId:   string | null,
 * }
 */

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Build the full identity context from the current auth session + org.
 * Called by app.js after initAuth() and orgService.init().
 */
export async function buildContext() {
  const session = await getSession();
  const user    = session?.user || null;

  if (!user) {
    _identityContext = _anonymousContext();
    _emit('identity.changed', _identityContext);
    return _identityContext;
  }

  const org        = orgService.getActiveOrg();
  const workspace  = orgService.getActiveWorkspace();
  const membership = orgService.getMembership();

  _identityContext = {
    userId:      user.id,
    email:       user.email || null,
    displayName: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
    avatarUrl:   user.user_metadata?.avatar_url || null,
    isAnonymous: false,
    orgId:       org?.id || null,
    orgName:     org?.name || null,
    orgPlan:     org?.plan || null,
    workspaceId: workspace?.id || null,
    role:        membership?.role || null,
    teamIds:     membership?.teamIds || [],
    ssoProvider: _detectSsoProvider(user),
    mfaEnabled:  user.factors?.length > 0 || false,
    sessionId:   session.access_token ? _hashToken(session.access_token) : null,
  };

  _emit('identity.changed', _identityContext);
  return _identityContext;
}

// ─── Accessors ────────────────────────────────────────────────────────────────

export function getContext()          { return _identityContext; }
export function getUserId()           { return _identityContext?.userId || null; }
export function getEmail()            { return _identityContext?.email || null; }
export function getOrgId()            { return _identityContext?.orgId || null; }
export function getRole()             { return _identityContext?.role || null; }
export function isAnonymous()         { return _identityContext?.isAnonymous !== false; }
export function isAuthenticated()     { return !!_identityContext?.userId && !_identityContext.isAnonymous; }
export function hasRole(role)         { return orgService.hasRole(role); }

// ─── Domain-Based Org Routing ─────────────────────────────────────────────────

/**
 * Given an email address, determine which org it belongs to.
 * Used during sign-in to auto-route users to their org.
 *
 * @param {string} email
 * @returns {Promise<{orgId, orgName, ssoRequired, ssoProvider}|null>}
 */
export async function resolveOrgForEmail(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;

  try {
    const { cloud } = await import('../cloud/cloud.js');
    if (!cloud.isCloudAvailable()) return null;
    const { data } = await cloud.orgs.findByDomain(domain);
    if (!data) return null;
    return {
      orgId:       data.id,
      orgName:     data.name,
      ssoRequired: !!data.settings?.sso,
      ssoProvider: data.settings?.sso?.provider || null,
    };
  } catch {
    return null;
  }
}

// ─── SSO Enforcement ─────────────────────────────────────────────────────────

/**
 * Check if SSO is required for the current user's email domain.
 * If so, redirect to the SSO provider.
 *
 * @param {string} email
 * @returns {Promise<boolean>} - true if SSO redirect was initiated
 */
export async function enforceSso(email) {
  const orgInfo = await resolveOrgForEmail(email);
  if (!orgInfo?.ssoRequired) return false;

  const { cloud } = await import('../cloud/cloud.js');
  if (!cloud.isCloudAvailable()) return false;

  // Supabase handles the SSO redirect
  const { data, error } = await cloud.auth.signInWithSso({
    domain: email.split('@')[1],
    options: { redirectTo: window.location.origin },
  });

  if (error) {
    console.warn('[Identity] SSO redirect failed:', error.message);
    return false;
  }

  if (data?.url) {
    window.location.href = data.url;
    return true;
  }

  return false;
}

// ─── MFA Enforcement ─────────────────────────────────────────────────────────

/**
 * Check if MFA is required for the current user (policy-driven).
 * Returns true if MFA is required but not yet enrolled.
 */
export async function isMfaRequired() {
  if (!_identityContext?.orgId) return false;
  const policy = await policyEngine.evaluate('identity.mfa_required', {
    userId: _identityContext.userId,
    orgId:  _identityContext.orgId,
    role:   _identityContext.role,
  });
  return policy.allowed === false; // policy blocks if MFA not enrolled
}

// ─── Impersonation (Admin-Only) ───────────────────────────────────────────────

let _impersonating = null;

/**
 * Impersonate another user (admin/owner only, fully audited).
 * The impersonated context is layered on top of the real identity.
 *
 * @param {string} targetUserId
 */
export async function impersonate(targetUserId) {
  if (!orgService.hasRole(ROLES.ADMIN)) {
    throw new Error('Impersonation requires admin role.');
  }

  _impersonating = {
    realUserId: _identityContext.userId,
    targetUserId,
    startedAt: new Date().toISOString(),
  };

  await auditService.log({
    action: 'identity.impersonation_started',
    orgId:  _identityContext.orgId,
    userId: _identityContext.userId,
    meta:   { targetUserId },
    severity: 'high',
  });

  _emit('identity.impersonation', { impersonating: _impersonating });
}

/**
 * End impersonation and return to the real identity.
 */
export async function endImpersonation() {
  if (!_impersonating) return;

  await auditService.log({
    action: 'identity.impersonation_ended',
    orgId:  _identityContext.orgId,
    userId: _identityContext.userId,
    meta:   { targetUserId: _impersonating.targetUserId },
    severity: 'high',
  });

  _impersonating = null;
  _emit('identity.impersonation_ended', {});
}

export function getImpersonation() { return _impersonating; }

// ─── SCIM Schema (Future-Ready) ───────────────────────────────────────────────

/**
 * Returns the SCIM 2.0 User schema for this org.
 * Used by identity providers (Okta, Azure AD) for automated provisioning.
 */
export function getScimSchema() {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: 'nuvra-user',
    name: 'User',
    description: 'Nuvra user account',
    attributes: [
      { name: 'userName',    type: 'string',  required: true,  uniqueness: 'global' },
      { name: 'emails',      type: 'complex', required: true,  multiValued: true },
      { name: 'displayName', type: 'string',  required: false, uniqueness: 'none' },
      { name: 'active',      type: 'boolean', required: false, uniqueness: 'none' },
      {
        name: 'roles',
        type: 'complex',
        required: false,
        multiValued: true,
        subAttributes: [
          { name: 'value',   type: 'string' },
          { name: 'display', type: 'string' },
          { name: 'primary', type: 'boolean' },
        ],
      },
    ],
  };
}

// ─── Event Subscription ───────────────────────────────────────────────────────

export function subscribe(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function _anonymousContext() {
  return {
    userId: null, email: null, displayName: 'Anonymous',
    avatarUrl: null, isAnonymous: true,
    orgId: null, orgName: null, orgPlan: null,
    workspaceId: null, role: null, teamIds: [],
    ssoProvider: null, mfaEnabled: false, sessionId: null,
  };
}

function _detectSsoProvider(user) {
  const identities = user.identities || [];
  const ssoIdentity = identities.find(i => i.provider !== 'email');
  return ssoIdentity?.provider || null;
}

function _hashToken(token) {
  // Simple non-cryptographic hash for session identification in logs
  let h = 0;
  for (let i = 0; i < Math.min(token.length, 32); i++) {
    h = ((h << 5) - h) + token.charCodeAt(i);
    h |= 0;
  }
  return 'sess_' + Math.abs(h).toString(16);
}

function _emit(event, data) {
  _listeners.forEach(fn => { try { fn(event, data); } catch {} });
  // Also dispatch as a DOM event for cross-module communication
  document.dispatchEvent(new CustomEvent('nuvra:' + event.replace('.', '-'), { detail: data }));
}

// ─── Namespace Export for adminConsole compatibility ─────────────────────────
export const identityService = {
  buildContext,
  getContext,
  getUserId,
  getEmail,
  getOrgId,
  getRole,
  isAnonymous,
  isAuthenticated,
  hasRole,
  resolveOrgForEmail,
};
