/**
 * authContract.js — Nuvra Phase 6
 *
 * The canonical interface every authentication provider must implement.
 * Auth logic is completely decoupled from the UI and from any specific
 * provider (Supabase, Firebase, custom backend, etc.).
 *
 * Auth must be replaceable without rewriting the app.
 *
 * @module auth/providers/authContract
 */
'use strict';

// ─── Auth Result Shape ────────────────────────────────────────────────────────
/**
 * Every auth operation returns an AuthResult:
 * { ok: boolean, user?: UserRecord, session?: SessionRecord, error?: string, errorCode?: string }
 */

// ─── User Record ──────────────────────────────────────────────────────────────
/**
 * @typedef {object} UserRecord
 * @property {string}  id           - Stable user ID (never changes)
 * @property {string}  email        - Verified email address
 * @property {string}  [name]       - Display name
 * @property {string}  [avatarUrl]  - Profile image URL
 * @property {string}  role         - 'owner' | 'admin' | 'editor' | 'viewer'
 * @property {boolean} emailVerified
 * @property {object}  metadata     - Provider-specific metadata (opaque to the app)
 * @property {number}  createdAt    - Unix timestamp
 * @property {number}  lastSeenAt   - Unix timestamp
 */

// ─── Session Record ───────────────────────────────────────────────────────────
/**
 * @typedef {object} SessionRecord
 * @property {string}  sessionId    - Unique session identifier
 * @property {string}  userId       - The authenticated user's ID
 * @property {string}  deviceId     - Stable device fingerprint
 * @property {string}  deviceName   - Human-readable device label
 * @property {number}  issuedAt     - Unix timestamp
 * @property {number}  expiresAt    - Unix timestamp
 * @property {boolean} isPersistent - Whether the session survives browser close
 */

// ─── Auth Provider Contract ───────────────────────────────────────────────────
export class AuthProviderContract {
  /** @type {string} Unique provider ID, e.g. 'supabase', 'firebase', 'custom' */
  get id() { throw new Error('AuthProvider must implement id'); }

  /** @type {string} Human-readable label */
  get label() { throw new Error('AuthProvider must implement label'); }

  /**
   * Sign in with email and password.
   * @param {string} email
   * @param {string} password
   * @returns {Promise<AuthResult>}
   */
  async signInWithPassword(email, password) { // eslint-disable-line no-unused-vars
    throw new Error('AuthProvider must implement signInWithPassword');
  }

  /**
   * Send a magic link (passwordless sign-in) to the given email.
   * @param {string} email
   * @param {object} [options]
   * @returns {Promise<AuthResult>}
   */
  async sendMagicLink(email, options) { // eslint-disable-line no-unused-vars
    throw new Error('AuthProvider must implement sendMagicLink');
  }

  /**
   * Sign up with email and password.
   * @param {string} email
   * @param {string} password
   * @param {object} [metadata]
   * @returns {Promise<AuthResult>}
   */
  async signUp(email, password, metadata) { // eslint-disable-line no-unused-vars
    throw new Error('AuthProvider must implement signUp');
  }

  /**
   * Sign out the current user.
   * @returns {Promise<AuthResult>}
   */
  async signOut() {
    throw new Error('AuthProvider must implement signOut');
  }

  /**
   * Get the currently authenticated user (from session/token).
   * Returns null if not authenticated.
   * @returns {Promise<UserRecord|null>}
   */
  async getCurrentUser() {
    throw new Error('AuthProvider must implement getCurrentUser');
  }

  /**
   * Refresh the current session token.
   * @returns {Promise<AuthResult>}
   */
  async refreshSession() {
    throw new Error('AuthProvider must implement refreshSession');
  }

  /**
   * Get the raw access token (for API calls).
   * Returns null if not authenticated.
   * @returns {Promise<string|null>}
   */
  async getAccessToken() {
    throw new Error('AuthProvider must implement getAccessToken');
  }

  /**
   * Subscribe to auth state changes.
   * @param {function} listener - Called with (event: string, user: UserRecord|null)
   * @returns {function} Unsubscribe function
   */
  onAuthStateChange(listener) { // eslint-disable-line no-unused-vars
    throw new Error('AuthProvider must implement onAuthStateChange');
  }

  /**
   * Initiate OAuth sign-in (Google, GitHub, etc.).
   * @param {string} provider - 'google' | 'github' | 'microsoft'
   * @param {object} [options]
   * @returns {Promise<AuthResult>}
   */
  async signInWithOAuth(provider, options) { // eslint-disable-line no-unused-vars
    throw new Error('AuthProvider must implement signInWithOAuth');
  }

  /**
   * Send a password reset email.
   * @param {string} email
   * @returns {Promise<AuthResult>}
   */
  async sendPasswordReset(email) { // eslint-disable-line no-unused-vars
    throw new Error('AuthProvider must implement sendPasswordReset');
  }

  /**
   * Update the current user's profile.
   * @param {object} updates - { name?, avatarUrl?, metadata? }
   * @returns {Promise<AuthResult>}
   */
  async updateProfile(updates) { // eslint-disable-line no-unused-vars
    throw new Error('AuthProvider must implement updateProfile');
  }
}

// ─── Auth Error Codes ─────────────────────────────────────────────────────────
export const AuthErrorCode = Object.freeze({
  INVALID_CREDENTIALS:  'auth/invalid_credentials',
  EMAIL_NOT_VERIFIED:   'auth/email_not_verified',
  USER_NOT_FOUND:       'auth/user_not_found',
  EMAIL_IN_USE:         'auth/email_in_use',
  WEAK_PASSWORD:        'auth/weak_password',
  RATE_LIMITED:         'auth/rate_limited',
  SESSION_EXPIRED:      'auth/session_expired',
  NETWORK_ERROR:        'auth/network_error',
  PROVIDER_ERROR:       'auth/provider_error',
  NOT_AUTHENTICATED:    'auth/not_authenticated',
  OAUTH_CANCELLED:      'auth/oauth_cancelled',
  MAGIC_LINK_SENT:      'auth/magic_link_sent',  // Not an error — informational
});

// ─── Auth Events ──────────────────────────────────────────────────────────────
export const AuthEvent = Object.freeze({
  SIGNED_IN:        'auth:signed_in',
  SIGNED_OUT:       'auth:signed_out',
  SESSION_REFRESHED:'auth:session_refreshed',
  USER_UPDATED:     'auth:user_updated',
  TOKEN_EXPIRED:    'auth:token_expired',
  PASSWORD_RESET:   'auth:password_reset',
  MAGIC_LINK_SENT:  'auth:magic_link_sent',
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function authOk(user, session = null) {
  return { ok: true, user, session };
}

export function authError(error, errorCode = null) {
  return { ok: false, user: null, session: null, error, errorCode };
}
