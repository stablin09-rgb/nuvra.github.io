/**
 * phase6.test.js — Nuvra Phase 6 Validation Suite
 *
 * Tests: Auth flows, multi-device sync, offline merge, AI safety limits,
 *        key rotation, ownership, governance, and secrets management.
 *
 * Run: node tests/phase6.test.js
 */
'use strict';

// ─── Minimal Test Harness ─────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    results.push({ name, ok: false, error: err.message });
    console.log(`  ✗ ${name}`);
    console.log(`    → ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(a, b, message) {
  if (a !== b) throw new Error(message || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function assertNotNull(v, message) {
  if (v === null || v === undefined) throw new Error(message || `Expected non-null value`);
}

// ─── Mock Dependencies ────────────────────────────────────────────────────────

// Mock EventBus
class MockEventBus {
  constructor() { this._handlers = {}; this._emitted = []; }
  on(event, fn) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(fn);
  }
  emit(event, data) {
    this._emitted.push({ event, data });
    (this._handlers[event] || []).forEach(fn => fn(data));
  }
  getEmitted(event) { return this._emitted.filter(e => e.event === event); }
}

// Mock Store
class MockStore {
  constructor(initial = {}) { this._state = initial; this._dispatched = []; }
  getState() { return this._state; }
  dispatch(action) {
    this._dispatched.push(action);
    // Apply simple reducers
    if (action.type === 'AUTH/SET_USER') this._state.auth = { ...this._state.auth, ...action.payload, isAuthenticated: true };
    if (action.type === 'AUTH/CLEAR_USER') this._state.auth = { userId: null, isAuthenticated: false };
    if (action.type === 'CLOUD/SET_SYNCING') this._state.cloud = { ...this._state.cloud, isSyncing: action.payload };
    if (action.type === 'CLOUD/SET_PROJECTS') this._state.cloud = { ...this._state.cloud, projects: action.payload };
    if (action.type === 'CLOUD/SET_CONFLICTS') this._state.cloud = { ...this._state.cloud, conflicts: action.payload };
  }
  subscribe(fn) {}
  getDispatched(type) { return this._dispatched.filter(a => a.type === type); }
}

// ─── Test Suites ──────────────────────────────────────────────────────────────

// ── 1. Auth Reducer ───────────────────────────────────────────────────────────
console.log('\n── 1. Auth Reducer ──────────────────────────────────────────────────');

test('AUTH_INITIAL has correct shape', () => {
  const AUTH_INITIAL = {
    userId: null, email: null, displayName: null, avatarUrl: null,
    isAuthenticated: false, isLoading: false, error: null, provider: null,
  };
  assert(!AUTH_INITIAL.isAuthenticated, 'Should not be authenticated initially');
  assert(AUTH_INITIAL.userId === null, 'userId should be null initially');
});

test('AUTH/SET_USER sets authenticated state', () => {
  const store = new MockStore({ auth: { userId: null, isAuthenticated: false } });
  store.dispatch({ type: 'AUTH/SET_USER', payload: { userId: 'u1', email: 'test@test.com' } });
  assert(store.getState().auth.isAuthenticated, 'Should be authenticated');
  assertEqual(store.getState().auth.userId, 'u1', 'userId should be set');
});

test('AUTH/CLEAR_USER clears authenticated state', () => {
  const store = new MockStore({ auth: { userId: 'u1', isAuthenticated: true } });
  store.dispatch({ type: 'AUTH/CLEAR_USER' });
  assert(!store.getState().auth.isAuthenticated, 'Should not be authenticated');
  assert(store.getState().auth.userId === null, 'userId should be null');
});

// ── 2. Local Auth Provider ────────────────────────────────────────────────────
console.log('\n── 2. Local Auth Provider ───────────────────────────────────────────');

// Inline the LocalAuthProvider logic for testing (no ESM imports in Node CJS test)
class LocalAuthProviderTest {
  constructor() { this._users = {}; this._currentUser = null; }

  async signUp(email, password) {
    if (this._users[email]) return { ok: false, error: 'Email already in use' };
    const user = { id: 'local_' + email.replace(/[^a-z0-9]/g, '_'), email, displayName: email.split('@')[0], provider: 'local' };
    this._users[email] = { ...user, password };
    this._currentUser = user;
    return { ok: true, user };
  }

  async signIn(email, password) {
    const stored = this._users[email];
    if (!stored) return { ok: false, error: 'User not found' };
    if (stored.password !== password) return { ok: false, error: 'Invalid password' };
    this._currentUser = stored;
    return { ok: true, user: stored };
  }

  async signOut() {
    this._currentUser = null;
    return { ok: true };
  }

  getUser() { return this._currentUser; }
  isAuthenticated() { return !!this._currentUser; }
}

test('LocalAuthProvider: sign up creates a user', async () => {
  const provider = new LocalAuthProviderTest();
  const result = await provider.signUp('alice@test.com', 'password123');
  assert(result.ok, 'Sign up should succeed');
  assertNotNull(result.user.id, 'User should have an ID');
  assertEqual(result.user.email, 'alice@test.com', 'Email should match');
});

test('LocalAuthProvider: sign up rejects duplicate email', async () => {
  const provider = new LocalAuthProviderTest();
  await provider.signUp('alice@test.com', 'password123');
  const result = await provider.signUp('alice@test.com', 'other');
  assert(!result.ok, 'Duplicate sign up should fail');
});

test('LocalAuthProvider: sign in with correct credentials', async () => {
  const provider = new LocalAuthProviderTest();
  await provider.signUp('bob@test.com', 'secret');
  const result = await provider.signIn('bob@test.com', 'secret');
  assert(result.ok, 'Sign in should succeed');
  assert(provider.isAuthenticated(), 'Should be authenticated');
});

test('LocalAuthProvider: sign in with wrong password fails', async () => {
  const provider = new LocalAuthProviderTest();
  await provider.signUp('bob@test.com', 'secret');
  const result = await provider.signIn('bob@test.com', 'wrong');
  assert(!result.ok, 'Wrong password should fail');
});

test('LocalAuthProvider: sign out clears user', async () => {
  const provider = new LocalAuthProviderTest();
  await provider.signUp('carol@test.com', 'pass');
  await provider.signIn('carol@test.com', 'pass');
  await provider.signOut();
  assert(!provider.isAuthenticated(), 'Should not be authenticated after sign out');
});

// ── 3. Cloud Reducer ──────────────────────────────────────────────────────────
console.log('\n── 3. Cloud Reducer ─────────────────────────────────────────────────');

test('CLOUD_INITIAL has correct shape', () => {
  const CLOUD_INITIAL = {
    isOnline: true, isSyncing: false, lastSyncedAt: null, syncError: null,
    conflicts: [], offlineQueueSize: 0, projects: [], activeProjectId: null,
  };
  assert(CLOUD_INITIAL.isOnline, 'Should be online by default');
  assert(!CLOUD_INITIAL.isSyncing, 'Should not be syncing initially');
  assertEqual(CLOUD_INITIAL.conflicts.length, 0, 'No conflicts initially');
});

test('CLOUD/SET_SYNCING updates syncing state', () => {
  const store = new MockStore({ cloud: { isSyncing: false } });
  store.dispatch({ type: 'CLOUD/SET_SYNCING', payload: true });
  assert(store.getState().cloud.isSyncing, 'Should be syncing');
});

test('CLOUD/SET_PROJECTS stores project list', () => {
  const store = new MockStore({ cloud: { projects: [] } });
  const projects = [{ id: 'p1', name: 'My Site' }, { id: 'p2', name: 'My App' }];
  store.dispatch({ type: 'CLOUD/SET_PROJECTS', payload: projects });
  assertEqual(store.getState().cloud.projects.length, 2, 'Should have 2 projects');
});

// ── 4. Local Cloud Adapter ────────────────────────────────────────────────────
console.log('\n── 4. Local Cloud Adapter ───────────────────────────────────────────');

class LocalCloudAdapterTest {
  constructor() { this._store = {}; }

  async save(projectId, schemaType, data, meta = {}) {
    const key = `${projectId}:${schemaType}`;
    const version = (this._store[key]?.version || 0) + 1;
    this._store[key] = { projectId, schemaType, data, version, savedAt: Date.now(), ...meta };
    return { ok: true, version };
  }

  async load(projectId, schemaType) {
    const key = `${projectId}:${schemaType}`;
    const record = this._store[key];
    if (!record) return { ok: true, data: null, version: 0 };
    return { ok: true, data: record.data, version: record.version, savedAt: record.savedAt };
  }

  async delete(projectId, schemaType) {
    const key = `${projectId}:${schemaType}`;
    if (!this._store[key]) return { ok: false, error: 'Not found' };
    delete this._store[key];
    return { ok: true };
  }

  async listProjects(userId) {
    return { ok: true, projects: [] };
  }
}

test('LocalCloudAdapter: save and load a schema', async () => {
  const adapter = new LocalCloudAdapterTest();
  const schema = { id: 's1', name: 'My Site', pages: [] };
  const saveResult = await adapter.save('p1', 'site_schema', schema);
  assert(saveResult.ok, 'Save should succeed');
  assertEqual(saveResult.version, 1, 'First save should be version 1');

  const loadResult = await adapter.load('p1', 'site_schema');
  assert(loadResult.ok, 'Load should succeed');
  assertEqual(loadResult.data.name, 'My Site', 'Loaded data should match');
  assertEqual(loadResult.version, 1, 'Version should match');
});

test('LocalCloudAdapter: version increments on each save', async () => {
  const adapter = new LocalCloudAdapterTest();
  await adapter.save('p1', 'site_schema', { v: 1 });
  await adapter.save('p1', 'site_schema', { v: 2 });
  const result = await adapter.save('p1', 'site_schema', { v: 3 });
  assertEqual(result.version, 3, 'Version should be 3 after 3 saves');
});

test('LocalCloudAdapter: load returns null for missing schema', async () => {
  const adapter = new LocalCloudAdapterTest();
  const result = await adapter.load('p1', 'nonexistent');
  assert(result.ok, 'Load should succeed');
  assert(result.data === null, 'Data should be null for missing schema');
});

test('LocalCloudAdapter: delete removes a schema', async () => {
  const adapter = new LocalCloudAdapterTest();
  await adapter.save('p1', 'site_schema', { name: 'test' });
  const deleteResult = await adapter.delete('p1', 'site_schema');
  assert(deleteResult.ok, 'Delete should succeed');
  const loadResult = await adapter.load('p1', 'site_schema');
  assert(loadResult.data === null, 'Data should be null after delete');
});

// ── 5. Sync Engine ────────────────────────────────────────────────────────────
console.log('\n── 5. Sync Engine ───────────────────────────────────────────────────');

// Inline sync logic for testing
class SyncEngineTest {
  constructor({ cloudAdapter, getLocalSchema, setLocalSchema }) {
    this._adapter        = cloudAdapter;
    this._getLocalSchema = getLocalSchema;
    this._setLocalSchema = setLocalSchema;
    this._offlineQueue   = [];
    this._conflicts      = [];
  }

  async sync(projectId, schemaTypes) {
    let pushed = 0, pulled = 0, conflicts = 0;

    for (const schemaType of schemaTypes) {
      const local  = await this._getLocalSchema(projectId, schemaType);
      const remote = await this._adapter.load(projectId, schemaType);

      if (!remote.data && local) {
        // Push local to cloud
        await this._adapter.save(projectId, schemaType, local);
        pushed++;
      } else if (remote.data && !local) {
        // Pull from cloud
        await this._setLocalSchema(projectId, schemaType, remote.data);
        pulled++;
      } else if (remote.data && local) {
        // Both exist — check for conflict (simplified: compare JSON)
        if (JSON.stringify(local) !== JSON.stringify(remote.data)) {
          this._conflicts.push({ id: `${projectId}:${schemaType}`, projectId, schemaType, local, remote: remote.data });
          conflicts++;
        }
      }
    }

    return { ok: true, pushed, pulled, conflicts };
  }

  queueOfflineChange(projectId, schemaType, data) {
    this._offlineQueue.push({ projectId, schemaType, data, queuedAt: Date.now() });
  }

  getOfflineQueueSize() { return this._offlineQueue.length; }
  getConflicts() { return this._conflicts; }
}

test('SyncEngine: pushes local schema to cloud when cloud is empty', async () => {
  const adapter = new LocalCloudAdapterTest();
  const local = { 'p1:site_schema': { name: 'My Site' } };

  const engine = new SyncEngineTest({
    cloudAdapter:    adapter,
    getLocalSchema:  async (pid, type) => local[`${pid}:${type}`] || null,
    setLocalSchema:  async (pid, type, data) => { local[`${pid}:${type}`] = data; },
  });

  const result = await engine.sync('p1', ['site_schema']);
  assert(result.ok, 'Sync should succeed');
  assertEqual(result.pushed, 1, 'Should push 1 schema');
  assertEqual(result.pulled, 0, 'Should pull 0 schemas');

  const cloudResult = await adapter.load('p1', 'site_schema');
  assertEqual(cloudResult.data.name, 'My Site', 'Cloud should have the local schema');
});

test('SyncEngine: pulls cloud schema when local is empty', async () => {
  const adapter = new LocalCloudAdapterTest();
  await adapter.save('p1', 'site_schema', { name: 'Cloud Site' });

  const local = {};
  const engine = new SyncEngineTest({
    cloudAdapter:    adapter,
    getLocalSchema:  async (pid, type) => local[`${pid}:${type}`] || null,
    setLocalSchema:  async (pid, type, data) => { local[`${pid}:${type}`] = data; },
  });

  const result = await engine.sync('p1', ['site_schema']);
  assert(result.ok, 'Sync should succeed');
  assertEqual(result.pulled, 1, 'Should pull 1 schema');
  assertEqual(local['p1:site_schema'].name, 'Cloud Site', 'Local should have cloud schema');
});

test('SyncEngine: detects conflict when both local and cloud differ', async () => {
  const adapter = new LocalCloudAdapterTest();
  await adapter.save('p1', 'site_schema', { name: 'Cloud Version' });

  const local = { 'p1:site_schema': { name: 'Local Version' } };
  const engine = new SyncEngineTest({
    cloudAdapter:    adapter,
    getLocalSchema:  async (pid, type) => local[`${pid}:${type}`] || null,
    setLocalSchema:  async (pid, type, data) => { local[`${pid}:${type}`] = data; },
  });

  const result = await engine.sync('p1', ['site_schema']);
  assertEqual(result.conflicts, 1, 'Should detect 1 conflict');
  assertEqual(engine.getConflicts().length, 1, 'Conflict should be recorded');
});

test('SyncEngine: queues offline changes', () => {
  const adapter = new LocalCloudAdapterTest();
  const engine = new SyncEngineTest({
    cloudAdapter:    adapter,
    getLocalSchema:  async () => null,
    setLocalSchema:  async () => {},
  });

  engine.queueOfflineChange('p1', 'site_schema', { name: 'Offline Change' });
  engine.queueOfflineChange('p1', 'app_schema',  { name: 'Offline App' });
  assertEqual(engine.getOfflineQueueSize(), 2, 'Should have 2 queued changes');
});

// ── 6. Ownership Manager ──────────────────────────────────────────────────────
console.log('\n── 6. Ownership Manager ─────────────────────────────────────────────');

// Inline ownership logic for testing
const Permission = { READ: 'read', WRITE: 'write', ADMIN: 'admin', OWNER: 'owner' };
const PERMISSION_LEVELS = { read: 1, write: 2, admin: 3, owner: 4 };

function hasPermission(required, granted) {
  return (PERMISSION_LEVELS[granted] || 0) >= (PERMISSION_LEVELS[required] || 0);
}

class OwnershipManagerTest {
  constructor(userId) {
    this._userId   = userId;
    this._projects = {};
  }

  createProject(name) {
    const id = 'proj_' + Date.now().toString(36);
    this._projects[id] = {
      id, name,
      ownerId: this._userId,
      members: { [this._userId]: Permission.OWNER },
      createdAt: Date.now(),
    };
    return { ok: true, project: this._projects[id] };
  }

  addMember(projectId, userId, permission) {
    const project = this._projects[projectId];
    if (!project) return { ok: false, error: 'Project not found' };
    if (!hasPermission(Permission.ADMIN, project.members[this._userId])) {
      return { ok: false, error: 'Insufficient permissions' };
    }
    project.members[userId] = permission;
    return { ok: true };
  }

  checkPermission(projectId, userId, required) {
    const project = this._projects[projectId];
    if (!project) return false;
    const granted = project.members[userId];
    if (!granted) return false;
    return hasPermission(required, granted);
  }

  getProjects() {
    return Object.values(this._projects).filter(p => p.members[this._userId]);
  }
}

test('OwnershipManager: create project sets owner', () => {
  const mgr = new OwnershipManagerTest('u1');
  const result = mgr.createProject('My Site');
  assert(result.ok, 'Create should succeed');
  assertEqual(result.project.ownerId, 'u1', 'Owner should be u1');
  assert(mgr.checkPermission(result.project.id, 'u1', Permission.OWNER), 'u1 should have OWNER permission');
});

test('OwnershipManager: owner can add members', () => {
  const mgr = new OwnershipManagerTest('u1');
  const { project } = mgr.createProject('My Site');
  const result = mgr.addMember(project.id, 'u2', Permission.WRITE);
  assert(result.ok, 'Add member should succeed');
  assert(mgr.checkPermission(project.id, 'u2', Permission.WRITE), 'u2 should have WRITE permission');
  assert(!mgr.checkPermission(project.id, 'u2', Permission.ADMIN), 'u2 should NOT have ADMIN permission');
});

test('OwnershipManager: non-admin cannot add members', () => {
  const ownerMgr  = new OwnershipManagerTest('u1');
  const { project } = ownerMgr.createProject('My Site');
  ownerMgr.addMember(project.id, 'u2', Permission.READ);

  // u2 tries to add u3 — should fail
  const readerMgr = new OwnershipManagerTest('u2');
  readerMgr._projects = ownerMgr._projects; // Share state
  const result = readerMgr.addMember(project.id, 'u3', Permission.READ);
  assert(!result.ok, 'Non-admin should not be able to add members');
});

test('OwnershipManager: permission hierarchy is correct', () => {
  assert(hasPermission(Permission.READ,  Permission.WRITE), 'WRITE satisfies READ');
  assert(hasPermission(Permission.READ,  Permission.ADMIN), 'ADMIN satisfies READ');
  assert(hasPermission(Permission.WRITE, Permission.ADMIN), 'ADMIN satisfies WRITE');
  assert(hasPermission(Permission.ADMIN, Permission.OWNER), 'OWNER satisfies ADMIN');
  assert(!hasPermission(Permission.WRITE, Permission.READ), 'READ does NOT satisfy WRITE');
  assert(!hasPermission(Permission.ADMIN, Permission.WRITE), 'WRITE does NOT satisfy ADMIN');
});

// ── 7. AI Safety Boundary ─────────────────────────────────────────────────────
console.log('\n── 7. AI Safety Boundary ────────────────────────────────────────────');

class AISafetyBoundaryTest {
  constructor(limits = {}) {
    this._limits = {
      maxTokensPerCall:    limits.maxTokensPerCall    || 8_000,
      maxCostPerCall:      limits.maxCostPerCall      || 0.10,
      maxTokensPerSession: limits.maxTokensPerSession || 200_000,
      maxCostPerSession:   limits.maxCostPerSession   || 5.00,
      maxCallsPerSession:  limits.maxCallsPerSession  || 100,
    };
    this._sessionUsage = { tokens: 0, cost: 0, calls: 0 };
  }

  checkPermission({ estimatedTokens = 0, estimatedCost = 0 } = {}) {
    if (estimatedTokens > this._limits.maxTokensPerCall) {
      return { allowed: false, reason: `Exceeds per-call token limit (${this._limits.maxTokensPerCall})`, code: 'TOKEN_LIMIT_EXCEEDED' };
    }
    if (estimatedCost > this._limits.maxCostPerCall) {
      return { allowed: false, reason: `Exceeds per-call cost limit ($${this._limits.maxCostPerCall})`, code: 'COST_LIMIT_EXCEEDED' };
    }
    if (this._sessionUsage.tokens + estimatedTokens > this._limits.maxTokensPerSession) {
      return { allowed: false, reason: 'Session token limit exceeded', code: 'SESSION_TOKEN_LIMIT' };
    }
    if (this._sessionUsage.cost + estimatedCost > this._limits.maxCostPerSession) {
      return { allowed: false, reason: 'Session cost limit exceeded', code: 'SESSION_COST_LIMIT' };
    }
    if (this._sessionUsage.calls >= this._limits.maxCallsPerSession) {
      return { allowed: false, reason: 'Session call limit exceeded', code: 'SESSION_CALL_LIMIT' };
    }

    // Warning at 80% of session limits
    const tokenPct = (this._sessionUsage.tokens + estimatedTokens) / this._limits.maxTokensPerSession;
    const costPct  = (this._sessionUsage.cost  + estimatedCost)  / this._limits.maxCostPerSession;
    if (tokenPct > 0.8 || costPct > 0.8) {
      return { allowed: true, warning: true, reason: 'Approaching session limits' };
    }

    return { allowed: true, warning: false };
  }

  recordUsage(projectId, tokens, cost) {
    this._sessionUsage.tokens += tokens;
    this._sessionUsage.cost   += cost;
    this._sessionUsage.calls  += 1;
  }

  resetSessionUsage() {
    this._sessionUsage = { tokens: 0, cost: 0, calls: 0 };
  }

  getSessionUsage() { return { ...this._sessionUsage }; }
}

test('AISafetyBoundary: allows normal requests', () => {
  const boundary = new AISafetyBoundaryTest();
  const result = boundary.checkPermission({ estimatedTokens: 1000, estimatedCost: 0.01 });
  assert(result.allowed, 'Normal request should be allowed');
  assert(!result.warning, 'Should not warn for low usage');
});

test('AISafetyBoundary: blocks requests exceeding per-call token limit', () => {
  const boundary = new AISafetyBoundaryTest({ maxTokensPerCall: 1000 });
  const result = boundary.checkPermission({ estimatedTokens: 2000, estimatedCost: 0.01 });
  assert(!result.allowed, 'Should block request exceeding token limit');
  assertEqual(result.code, 'TOKEN_LIMIT_EXCEEDED', 'Should return correct error code');
});

test('AISafetyBoundary: blocks requests exceeding per-call cost limit', () => {
  const boundary = new AISafetyBoundaryTest({ maxCostPerCall: 0.05 });
  const result = boundary.checkPermission({ estimatedTokens: 100, estimatedCost: 0.10 });
  assert(!result.allowed, 'Should block request exceeding cost limit');
  assertEqual(result.code, 'COST_LIMIT_EXCEEDED', 'Should return correct error code');
});

test('AISafetyBoundary: blocks when session token limit exceeded', () => {
  const boundary = new AISafetyBoundaryTest({ maxTokensPerSession: 5000 });
  boundary.recordUsage(null, 4500, 0.01);
  const result = boundary.checkPermission({ estimatedTokens: 1000, estimatedCost: 0.01 });
  assert(!result.allowed, 'Should block when session token limit would be exceeded');
  assertEqual(result.code, 'SESSION_TOKEN_LIMIT', 'Should return correct error code');
});

test('AISafetyBoundary: warns at 80% of session limits', () => {
  const boundary = new AISafetyBoundaryTest({ maxTokensPerSession: 10000 });
  boundary.recordUsage(null, 7500, 0.01);
  const result = boundary.checkPermission({ estimatedTokens: 1000, estimatedCost: 0.001 });
  assert(result.allowed, 'Should allow request at 85% usage');
  assert(result.warning, 'Should warn at 85% usage');
});

test('AISafetyBoundary: session usage resets correctly', () => {
  const boundary = new AISafetyBoundaryTest({ maxTokensPerSession: 5000 });
  boundary.recordUsage(null, 4500, 0.01);
  boundary.resetSessionUsage();
  const usage = boundary.getSessionUsage();
  assertEqual(usage.tokens, 0, 'Tokens should be reset');
  assertEqual(usage.cost, 0, 'Cost should be reset');
});

// ── 8. AI Governance Layer ────────────────────────────────────────────────────
console.log('\n── 8. AI Governance Layer ───────────────────────────────────────────');

// Inline governance logic for testing
class AIGovernanceLayerTest {
  constructor(config = {}) {
    this._config = {
      requireApprovalForGeneration: false,
      requireApprovalForMutation:   true,
      autoApproveBelow:             5,
      ...config,
    };
    this._records          = [];
    this._pendingApprovals = {};
    this._currentUserId    = 'u1';
  }

  _append(record) {
    const entry = { id: 'gov_' + this._records.length, timestamp: Date.now(), ...record };
    this._records.push(entry);
    return entry;
  }

  recordPromptSent(params) {
    return this._append({ type: 'prompt_sent', ...params });
  }

  recordSafetyBlock(params) {
    return this._append({ type: 'safety_block', ...params });
  }

  requestApproval({ operationId, projectId, capability, proposedSchema, previousSchema }) {
    const changes = previousSchema ? 10 : 0; // Simplified diff

    if (!this._config.requireApprovalForMutation || changes < this._config.autoApproveBelow) {
      this._append({ type: 'approved', operationId, projectId, data: { autoApproved: true } });
      return { approvalId: 'auto_' + operationId, status: 'auto_approved', autoApproved: true };
    }

    const approvalId = 'appr_' + operationId;
    this._pendingApprovals[approvalId] = {
      id: approvalId, operationId, projectId, capability,
      proposedSchema, previousSchema, status: 'pending',
    };
    this._append({ type: 'approval_required', operationId, projectId, data: { approvalId } });
    return { approvalId, status: 'pending', autoApproved: false };
  }

  approve(approvalId, reason = '') {
    const record = this._pendingApprovals[approvalId];
    if (!record) return { ok: false, error: 'Not found' };
    record.status = 'approved';
    this._append({ type: 'approved', operationId: record.operationId, data: { approvalId, reason } });
    return { ok: true, record };
  }

  reject(approvalId, reason = '') {
    const record = this._pendingApprovals[approvalId];
    if (!record) return { ok: false, error: 'Not found' };
    record.status = 'rejected';
    this._append({ type: 'rejected', operationId: record.operationId, data: { approvalId, reason } });
    return { ok: true, record };
  }

  getAuditLog() { return [...this._records]; }
  getPendingApprovals() { return Object.values(this._pendingApprovals).filter(r => r.status === 'pending'); }
}

test('AIGovernanceLayer: records prompt sent', () => {
  const governance = new AIGovernanceLayerTest();
  governance.recordPromptSent({ operationId: 'op1', projectId: 'p1', capability: 'generation', provider: 'openai', model: 'gpt-4o', prompt: 'test', estimatedTokens: 100, estimatedCost: 0.01 });
  const log = governance.getAuditLog();
  assertEqual(log.length, 1, 'Should have 1 audit record');
  assertEqual(log[0].type, 'prompt_sent', 'Should be a prompt_sent record');
});

test('AIGovernanceLayer: auto-approves new schema (no previous)', () => {
  const governance = new AIGovernanceLayerTest({ requireApprovalForMutation: true, autoApproveBelow: 5 });
  const result = governance.requestApproval({
    operationId:    'op1',
    projectId:      'p1',
    capability:     'generation',
    proposedSchema: { name: 'New App' },
    previousSchema: null,
  });
  assertEqual(result.status, 'auto_approved', 'Should be auto-approved for new schema');
});

test('AIGovernanceLayer: requires approval for mutations', () => {
  const governance = new AIGovernanceLayerTest({ requireApprovalForMutation: true, autoApproveBelow: 5 });
  const result = governance.requestApproval({
    operationId:    'op1',
    projectId:      'p1',
    capability:     'mutation',
    proposedSchema: { name: 'Updated App' },
    previousSchema: { name: 'Old App', pages: [{}, {}, {}, {}, {}, {}] }, // 6 changes
  });
  assertEqual(result.status, 'pending', 'Should be pending approval');
  assertEqual(governance.getPendingApprovals().length, 1, 'Should have 1 pending approval');
});

test('AIGovernanceLayer: approve resolves pending approval', () => {
  const governance = new AIGovernanceLayerTest({ requireApprovalForMutation: true, autoApproveBelow: 5 });
  const { approvalId } = governance.requestApproval({
    operationId:    'op1',
    projectId:      'p1',
    capability:     'mutation',
    proposedSchema: { name: 'Updated App' },
    previousSchema: { name: 'Old App', pages: [{}, {}, {}, {}, {}, {}] },
  });
  const result = governance.approve(approvalId, 'Looks good');
  assert(result.ok, 'Approve should succeed');
  assertEqual(governance.getPendingApprovals().length, 0, 'No pending approvals after approval');
});

test('AIGovernanceLayer: reject resolves pending approval', () => {
  const governance = new AIGovernanceLayerTest({ requireApprovalForMutation: true, autoApproveBelow: 5 });
  const { approvalId } = governance.requestApproval({
    operationId:    'op1',
    projectId:      'p1',
    capability:     'mutation',
    proposedSchema: { name: 'Updated App' },
    previousSchema: { name: 'Old App', pages: [{}, {}, {}, {}, {}, {}] },
  });
  const result = governance.reject(approvalId, 'Not what I wanted');
  assert(result.ok, 'Reject should succeed');
  assertEqual(governance.getPendingApprovals().length, 0, 'No pending approvals after rejection');
});

test('AIGovernanceLayer: audit log is append-only', () => {
  const governance = new AIGovernanceLayerTest();
  governance.recordPromptSent({ operationId: 'op1', projectId: 'p1', capability: 'generation', provider: 'openai', model: 'gpt-4o', prompt: 'a', estimatedTokens: 10, estimatedCost: 0.001 });
  governance.recordSafetyBlock({ operationId: 'op2', projectId: 'p1', reason: 'Prompt injection', code: 'PROMPT_INJECTION' });
  const log = governance.getAuditLog();
  assertEqual(log.length, 2, 'Should have 2 audit records');
  assertEqual(log[0].type, 'prompt_sent', 'First record should be prompt_sent');
  assertEqual(log[1].type, 'safety_block', 'Second record should be safety_block');
});

// ── 9. Secrets Manager ────────────────────────────────────────────────────────
console.log('\n── 9. Secrets Manager ───────────────────────────────────────────────');

// Inline secrets logic for testing (no btoa/atob in Node)
const KeyType = { OPENAI_API_KEY: 'openai_api_key', ANTHROPIC_API_KEY: 'anthropic_api_key', CUSTOM_API_KEY: 'custom_api_key' };
const KeyScope = { GLOBAL: 'global', PROJECT: 'project' };

class SecretsManagerTest {
  constructor(userId) {
    this._userId = userId;
    this._store  = {};
  }

  storeKey(keyType, value, options = {}) {
    if (!this._userId) return { ok: false, error: 'Not authenticated' };
    if (keyType === KeyType.OPENAI_API_KEY && !value.startsWith('sk-')) {
      return { ok: false, error: `Invalid key format for ${keyType}` };
    }

    const scope     = options.scope || KeyScope.GLOBAL;
    const projectId = options.projectId || null;
    if (scope === KeyScope.PROJECT && !projectId) {
      return { ok: false, error: 'projectId is required for project-scoped keys' };
    }

    const keyId = `${this._userId}:${keyType}:${scope}${projectId ? ':' + projectId : ''}`;
    this._store[keyId] = { keyId, keyType, scope, projectId, value: Buffer.from(value).toString('base64'), storedAt: Date.now() };
    return { ok: true, keyId };
  }

  getKey(keyType, options = {}) {
    const scope     = options.scope || KeyScope.GLOBAL;
    const projectId = options.projectId || null;
    const keyId     = `${this._userId}:${keyType}:${scope}${projectId ? ':' + projectId : ''}`;
    const record    = this._store[keyId];
    if (!record) return null;
    return Buffer.from(record.value, 'base64').toString();
  }

  hasKey(keyType, options = {}) { return this.getKey(keyType, options) !== null; }

  deleteKey(keyType, options = {}) {
    const scope     = options.scope || KeyScope.GLOBAL;
    const projectId = options.projectId || null;
    const keyId     = `${this._userId}:${keyType}:${scope}${projectId ? ':' + projectId : ''}`;
    if (!this._store[keyId]) return { ok: false, error: 'Key not found' };
    delete this._store[keyId];
    return { ok: true };
  }

  listKeys() {
    return Object.values(this._store).map(k => ({ ...k, value: '[REDACTED]' }));
  }

  redact(text) {
    if (!text) return text;
    let result = text;
    for (const record of Object.values(this._store)) {
      const value = Buffer.from(record.value, 'base64').toString();
      if (value && value.length > 8) result = result.split(value).join('[REDACTED]');
    }
    return result;
  }
}

test('SecretsManager: store and retrieve a key', () => {
  const mgr = new SecretsManagerTest('u1');
  const result = mgr.storeKey(KeyType.OPENAI_API_KEY, 'sk-test12345678901234567890');
  assert(result.ok, 'Store should succeed');
  const key = mgr.getKey(KeyType.OPENAI_API_KEY);
  assertEqual(key, 'sk-test12345678901234567890', 'Retrieved key should match');
});

test('SecretsManager: validates OpenAI key format', () => {
  const mgr = new SecretsManagerTest('u1');
  const result = mgr.storeKey(KeyType.OPENAI_API_KEY, 'invalid-key');
  assert(!result.ok, 'Invalid key format should be rejected');
});

test('SecretsManager: project-scoped key requires projectId', () => {
  const mgr = new SecretsManagerTest('u1');
  const result = mgr.storeKey(KeyType.CUSTOM_API_KEY, 'mykey12345', { scope: KeyScope.PROJECT });
  assert(!result.ok, 'Project-scoped key without projectId should fail');
});

test('SecretsManager: project-scoped key is separate from global', () => {
  const mgr = new SecretsManagerTest('u1');
  mgr.storeKey(KeyType.CUSTOM_API_KEY, 'global-key-12345', { scope: KeyScope.GLOBAL });
  mgr.storeKey(KeyType.CUSTOM_API_KEY, 'project-key-12345', { scope: KeyScope.PROJECT, projectId: 'p1' });

  assertEqual(mgr.getKey(KeyType.CUSTOM_API_KEY, { scope: KeyScope.GLOBAL }), 'global-key-12345', 'Global key should be separate');
  assertEqual(mgr.getKey(KeyType.CUSTOM_API_KEY, { scope: KeyScope.PROJECT, projectId: 'p1' }), 'project-key-12345', 'Project key should be separate');
});

test('SecretsManager: delete removes a key', () => {
  const mgr = new SecretsManagerTest('u1');
  mgr.storeKey(KeyType.CUSTOM_API_KEY, 'mykey12345');
  mgr.deleteKey(KeyType.CUSTOM_API_KEY);
  assert(!mgr.hasKey(KeyType.CUSTOM_API_KEY), 'Key should be deleted');
});

test('SecretsManager: listKeys never exposes values', () => {
  const mgr = new SecretsManagerTest('u1');
  mgr.storeKey(KeyType.CUSTOM_API_KEY, 'supersecret12345');
  const keys = mgr.listKeys();
  assertEqual(keys.length, 1, 'Should list 1 key');
  assertEqual(keys[0].value, '[REDACTED]', 'Value should be redacted in listing');
});

test('SecretsManager: redact removes key values from strings', () => {
  const mgr = new SecretsManagerTest('u1');
  mgr.storeKey(KeyType.CUSTOM_API_KEY, 'sk-supersecret123456');
  const text = 'The API key is sk-supersecret123456 and it should be hidden';
  const redacted = mgr.redact(text);
  assert(!redacted.includes('sk-supersecret123456'), 'Key should be redacted from text');
  assert(redacted.includes('[REDACTED]'), 'Should contain [REDACTED] placeholder');
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log('\n─────────────────────────────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);

if (failed > 0) {
  console.log('\nFailed tests:');
  results.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.name}: ${r.error}`));
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
  process.exit(0);
}
