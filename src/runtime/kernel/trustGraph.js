/**
 * Nuvra Runtime Kernel — trustGraph.js (Phase 16)
 *
 * The Zero-Trust Graph. Models trust relationships between actors, resources,
 * and actions. Trust is never assumed — it is always computed from evidence.
 *
 * Trust Score: 0–100
 *   0–20   = Untrusted (block by default)
 *   21–40  = Low trust (require approval)
 *   41–60  = Medium trust (allow with logging)
 *   61–80  = High trust (allow with monitoring)
 *   81–100 = Verified (allow with minimal friction)
 *
 * Trust is built from:
 *   - Verification status (email, org, SSO)
 *   - Historical behavior (no violations, no blocked actions)
 *   - Role and permissions
 *   - Session age and activity
 *   - Extension/plugin provenance
 *
 * @module runtime/trustGraph
 */
'use strict';

const TRUST_KEY_PREFIX = 'nuvra-trust-graph-';

// ─── Trust Levels ─────────────────────────────────────────────────────────────
export const TRUST_LEVEL = Object.freeze({
  UNTRUSTED: 'untrusted',   // 0–20
  LOW:       'low',         // 21–40
  MEDIUM:    'medium',      // 41–60
  HIGH:      'high',        // 61–80
  VERIFIED:  'verified',    // 81–100
});

// ─── Trust Score Thresholds ───────────────────────────────────────────────────
const THRESHOLDS = [
  { min: 81, level: TRUST_LEVEL.VERIFIED  },
  { min: 61, level: TRUST_LEVEL.HIGH      },
  { min: 41, level: TRUST_LEVEL.MEDIUM    },
  { min: 21, level: TRUST_LEVEL.LOW       },
  { min: 0,  level: TRUST_LEVEL.UNTRUSTED },
];

// ─── Trust Factors (additive scoring) ────────────────────────────────────────
const TRUST_FACTORS = {
  // Actor factors
  emailVerified:       +15,
  orgMember:           +10,
  ssoAuthenticated:    +20,
  mfaEnabled:          +10,
  adminRole:           +15,
  developerRole:       +10,
  editorRole:          +5,
  viewerRole:          0,
  // Behavioral factors
  noViolations30d:     +10,
  noBlockedActions7d:  +5,
  activeUser:          +5,
  // Extension/plugin factors
  extensionVerified:   +20,
  extensionTrusted:    +10,
  extensionUnverified: -20,
  // Negative factors
  recentViolation:     -20,
  recentBlockedAction: -10,
  suspiciousActivity:  -30,
  newAccount:          -10,
};

// ─── Internal State ───────────────────────────────────────────────────────────
let _userId  = null;
let _graph   = {};   // actorId → TrustNode

// ─── TrustNode ────────────────────────────────────────────────────────────────
class TrustNode {
  constructor(actorId, actorType) {
    this.actorId    = actorId;
    this.actorType  = actorType;
    this.score      = 30;   // Default: low trust
    this.level      = TRUST_LEVEL.LOW;
    this.factors    = [];
    this.lastUpdated = Date.now();
    this.history    = [];
  }

  applyFactor(factorName) {
    const delta = TRUST_FACTORS[factorName];
    if (delta === undefined) return;
    this.score = Math.max(0, Math.min(100, this.score + delta));
    this.factors.push({ factor: factorName, delta, appliedAt: Date.now() });
    this.level = _scoreToLevel(this.score);
    this.lastUpdated = Date.now();
  }

  recordEvent(event) {
    this.history.push({ event, timestamp: Date.now() });
    if (this.history.length > 50) this.history = this.history.slice(-50);
  }

  toJSON() {
    return {
      actorId:     this.actorId,
      actorType:   this.actorType,
      score:       this.score,
      level:       this.level,
      factors:     this.factors,
      lastUpdated: this.lastUpdated,
    };
  }
}

// ─── Initialization ───────────────────────────────────────────────────────────
export function init(userId) {
  _userId = userId;
  _graph  = _load();
}

// ─── Actor Trust Management ───────────────────────────────────────────────────
/**
 * Get or create a trust node for an actor.
 */
export function getNode(actorId, actorType = 'user') {
  if (!_graph[actorId]) {
    _graph[actorId] = new TrustNode(actorId, actorType);
  }
  return _graph[actorId];
}

/**
 * Compute a trust score for an actor based on their profile.
 * @param {string} actorId
 * @param {object} profile - Actor profile (from auth/org service)
 * @returns {TrustNode}
 */
export function computeTrust(actorId, profile = {}) {
  const node = getNode(actorId, profile.actorType || 'user');

  // Reset score to base
  node.score   = 20;
  node.factors = [];

  // Apply factors based on profile
  if (profile.emailVerified)    node.applyFactor('emailVerified');
  if (profile.orgMember)        node.applyFactor('orgMember');
  if (profile.ssoAuthenticated) node.applyFactor('ssoAuthenticated');
  if (profile.mfaEnabled)       node.applyFactor('mfaEnabled');
  if (profile.role === 'admin')       node.applyFactor('adminRole');
  if (profile.role === 'developer')   node.applyFactor('developerRole');
  if (profile.role === 'editor')      node.applyFactor('editorRole');
  if (profile.noViolations30d)        node.applyFactor('noViolations30d');
  if (profile.noBlockedActions7d)     node.applyFactor('noBlockedActions7d');
  if (profile.activeUser)             node.applyFactor('activeUser');
  if (profile.recentViolation)        node.applyFactor('recentViolation');
  if (profile.recentBlockedAction)    node.applyFactor('recentBlockedAction');
  if (profile.suspiciousActivity)     node.applyFactor('suspiciousActivity');
  if (profile.newAccount)             node.applyFactor('newAccount');

  // Extension-specific factors
  if (profile.actorType === 'plugin') {
    if (profile.trustLevel === 'verified') node.applyFactor('extensionVerified');
    else if (profile.trustLevel === 'trusted') node.applyFactor('extensionTrusted');
    else node.applyFactor('extensionUnverified');
  }

  node.lastUpdated = Date.now();
  node.level       = _scoreToLevel(node.score);

  _save();
  return node;
}

/**
 * Get the trust level for an actor.
 * @param {string} actorId
 * @returns {string} TRUST_LEVEL constant
 */
export function getTrustLevel(actorId) {
  const node = _graph[actorId];
  return node ? node.level : TRUST_LEVEL.UNTRUSTED;
}

/**
 * Get the trust score for an actor.
 * @param {string} actorId
 * @returns {number} 0–100
 */
export function getTrustScore(actorId) {
  const node = _graph[actorId];
  return node ? node.score : 0;
}

/**
 * Record a trust event (e.g., violation, blocked action, successful deploy).
 * @param {string} actorId
 * @param {string} event
 * @param {number} [scoreDelta] - Optional score adjustment
 */
export function recordEvent(actorId, event, scoreDelta = 0) {
  const node = getNode(actorId);
  node.recordEvent(event);
  if (scoreDelta !== 0) {
    node.score = Math.max(0, Math.min(100, node.score + scoreDelta));
    node.level = _scoreToLevel(node.score);
    node.factors.push({ factor: event, delta: scoreDelta, appliedAt: Date.now() });
  }
  node.lastUpdated = Date.now();
  _save();
}

/**
 * Get all trust nodes (for the Runtime Console).
 * @returns {object[]}
 */
export function getAllNodes() {
  return Object.values(_graph).map(n => n.toJSON());
}

// ─── Persistence ──────────────────────────────────────────────────────────────
function _save() {
  if (!_userId) return;
  try {
    const serialized = {};
    for (const [id, node] of Object.entries(_graph)) {
      serialized[id] = node.toJSON();
    }
    localStorage.setItem(`${TRUST_KEY_PREFIX}${_userId}`, JSON.stringify(serialized));
  } catch (_) {}
}

function _load() {
  if (!_userId) return {};
  try {
    const raw = localStorage.getItem(`${TRUST_KEY_PREFIX}${_userId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const graph  = {};
    for (const [id, data] of Object.entries(parsed)) {
      const node = new TrustNode(data.actorId, data.actorType);
      Object.assign(node, data);
      graph[id] = node;
    }
    return graph;
  } catch (_) { return {}; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _scoreToLevel(score) {
  for (const { min, level } of THRESHOLDS) {
    if (score >= min) return level;
  }
  return TRUST_LEVEL.UNTRUSTED;
}

// ─── Singleton export ─────────────────────────────────────────────────────────
export const trustGraph = { init, getNode, computeTrust, getTrustLevel, getTrustScore, recordEvent, getAllNodes };
export default trustGraph;
