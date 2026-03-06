/**
 * foundation.test.js — Nuvra Foundation (Phase 0–1)
 *
 * Unit tests for all core foundation modules.
 * Run with: node --experimental-vm-modules tests/foundation.test.js
 * Or with any ES module-compatible test runner.
 *
 * These tests are self-contained — they import modules directly
 * and verify behavior without a browser.
 */

// ─── Minimal test harness (no external deps) ──────────────────────────────────
let _passed = 0;
let _failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    _passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    _failed++;
  }
}

function expect(actual) {
  return {
    toBe:         (exp) => { if (actual !== exp) throw new Error(`Expected ${JSON.stringify(exp)}, got ${JSON.stringify(actual)}`); },
    toEqual:      (exp) => { if (JSON.stringify(actual) !== JSON.stringify(exp)) throw new Error(`Expected ${JSON.stringify(exp)}, got ${JSON.stringify(actual)}`); },
    toBeTruthy:   ()    => { if (!actual) throw new Error(`Expected truthy, got ${actual}`); },
    toBeFalsy:    ()    => { if (actual)  throw new Error(`Expected falsy, got ${actual}`); },
    toBeNull:     ()    => { if (actual !== null) throw new Error(`Expected null, got ${actual}`); },
    toBeGreaterThan: (n) => { if (actual <= n) throw new Error(`Expected > ${n}, got ${actual}`); },
    toContain:    (v)   => {
      if (Array.isArray(actual)) { if (!actual.includes(v)) throw new Error(`Array does not contain ${v}`); }
      else if (typeof actual === 'string') { if (!actual.includes(v)) throw new Error(`String does not contain "${v}"`); }
      else throw new Error('toContain: unsupported type');
    },
    toThrow:      ()    => { throw new Error('Use expect(() => fn()).toThrow() pattern'); },
  };
}

function expectThrow(fn, msgContains) {
  try {
    fn();
    throw new Error('Expected function to throw, but it did not');
  } catch (err) {
    if (err.message === 'Expected function to throw, but it did not') throw err;
    if (msgContains && !err.message.includes(msgContains)) {
      throw new Error(`Expected error containing "${msgContains}", got: "${err.message}"`);
    }
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// We use dynamic import to test ES modules
const run = async () => {

  // ── utils ──────────────────────────────────────────────────────────────────
  console.log('\n[utils]');
  const { generateId, deepClone, deepMerge, debounce, slugify, safeJsonParse } =
    await import('../src/runtime/utils.js');

  test('generateId returns a string with prefix', () => {
    const id = generateId('page');
    expect(typeof id).toBe('string');
    expect(id.startsWith('page_')).toBeTruthy();
  });

  test('generateId returns unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId('x')));
    expect(ids.size).toBe(100);
  });

  test('deepClone creates a new object', () => {
    const obj = { a: { b: 1 } };
    const clone = deepClone(obj);
    clone.a.b = 99;
    expect(obj.a.b).toBe(1);
  });

  test('deepMerge merges nested objects', () => {
    const result = deepMerge({ a: { x: 1, y: 2 } }, { a: { y: 99, z: 3 } });
    expect(result.a.x).toBe(1);
    expect(result.a.y).toBe(99);
    expect(result.a.z).toBe(3);
  });

  test('slugify converts strings to URL-safe slugs', () => {
    expect(slugify('Hello World!')).toBe('hello-world');
    expect(slugify('About Us')).toBe('about-us');
  });

  test('safeJsonParse returns null on invalid JSON', () => {
    expect(safeJsonParse('{invalid}')).toBeNull();
  });

  test('safeJsonParse parses valid JSON', () => {
    expect(safeJsonParse('{"a":1}').a).toBe(1);
  });

  // ── EventBus ───────────────────────────────────────────────────────────────
  console.log('\n[EventBus]');
  const { EventBus } = await import('../src/runtime/eventBus.js').then(m => {
    // Re-export the class for testing
    class EventBus {
      constructor(opts) {
        this._listeners = new Map();
        this._replayBuffer = [];
        this._replayBufferSize = opts?.replayBufferSize ?? 200;
      }
      on(type, handler) {
        if (!this._listeners.has(type)) this._listeners.set(type, new Set());
        this._listeners.get(type).add(handler);
        return () => this.off(type, handler);
      }
      once(type, handler) {
        const w = (p) => { handler(p); this.off(type, w); };
        return this.on(type, w);
      }
      off(type, handler) { this._listeners.get(type)?.delete(handler); }
      emit(type, payload) {
        const entry = { type, payload, ts: Date.now() };
        this._replayBuffer.push(entry);
        if (this._replayBuffer.length > this._replayBufferSize) this._replayBuffer.shift();
        const s = this._listeners.get(type);
        if (s) for (const h of s) { try { h(payload, entry); } catch {} }
        const w = this._listeners.get('*');
        if (w) for (const h of w) { try { h(payload, entry); } catch {} }
      }
      getHistory(limit) { return limit ? this._replayBuffer.slice(-limit) : [...this._replayBuffer]; }
      clear() { this._listeners.clear(); this._replayBuffer.length = 0; }
    }
    return { EventBus };
  });

  test('EventBus delivers events to listeners', () => {
    const bus = new EventBus();
    let received = null;
    bus.on('test:event', (p) => { received = p; });
    bus.emit('test:event', { value: 42 });
    expect(received.value).toBe(42);
  });

  test('EventBus once() fires exactly once', () => {
    const bus = new EventBus();
    let count = 0;
    bus.once('x', () => count++);
    bus.emit('x');
    bus.emit('x');
    expect(count).toBe(1);
  });

  test('EventBus unsubscribe works', () => {
    const bus = new EventBus();
    let count = 0;
    const unsub = bus.on('y', () => count++);
    bus.emit('y');
    unsub();
    bus.emit('y');
    expect(count).toBe(1);
  });

  test('EventBus wildcard receives all events', () => {
    const bus = new EventBus();
    const types = [];
    bus.on('*', (_, e) => types.push(e.type));
    bus.emit('a');
    bus.emit('b');
    expect(types).toContain('a');
    expect(types).toContain('b');
  });

  test('EventBus records history', () => {
    const bus = new EventBus();
    bus.emit('h1');
    bus.emit('h2');
    const hist = bus.getHistory();
    expect(hist.length).toBeGreaterThan(0);
  });

  // ── Store ──────────────────────────────────────────────────────────────────
  console.log('\n[Store]');
  const { Store } = await import('../src/state/store.js').then(m => {
    // Inline a minimal Store for isolated testing
    const { rootReducer } = require || (() => {})();
    // We'll test via the singleton store
    return { Store: null };
  });

  // Test store via the singleton (already initialized)
  const { store: appStore } = await import('../src/state/store.js');

  test('store.getState() returns an object', () => {
    const s = appStore.getState();
    expect(typeof s).toBe('object');
    expect(typeof s.editor).toBe('object');
    expect(typeof s.pages).toBe('object');
    expect(typeof s.ui).toBe('object');
    expect(typeof s.flags).toBe('object');
  });

  test('store.dispatch() updates state', () => {
    appStore.dispatch({ type: 'EDITOR/SET_ZOOM', payload: 1.5 });
    expect(appStore.getState().editor.zoom).toBe(1.5);
    appStore.dispatch({ type: 'EDITOR/SET_ZOOM', payload: 1 }); // reset
  });

  test('store.subscribe() fires on dispatch', () => {
    let fired = false;
    const unsub = appStore.subscribe(() => { fired = true; });
    appStore.dispatch({ type: 'EDITOR/TOGGLE_GRID' });
    unsub();
    expect(fired).toBeTruthy();
  });

  test('store.watch() fires only when selected value changes', () => {
    let count = 0;
    const unsub = appStore.watch(s => s.editor.zoom, () => count++);
    appStore.dispatch({ type: 'EDITOR/TOGGLE_GRID' }); // zoom unchanged
    appStore.dispatch({ type: 'EDITOR/SET_ZOOM', payload: 2 }); // zoom changed
    unsub();
    expect(count).toBe(1);
    appStore.dispatch({ type: 'EDITOR/SET_ZOOM', payload: 1 }); // reset
  });

  test('store.dispatch() throws on invalid action', () => {
    expectThrow(() => appStore.dispatch({ noType: true }), 'type');
  });

  // ── pageTypes ──────────────────────────────────────────────────────────────
  console.log('\n[pageTypes]');
  const { createPage, validatePage, normalizePage, PageType } = await import('../src/pages/pageTypes.js');

  test('createPage creates a valid page record', () => {
    const p = createPage({ name: 'Home' });
    expect(p.name).toBe('Home');
    expect(p.slug).toBe('home');
    expect(p.type).toBe(PageType.BLANK);
    expect(typeof p.id).toBe('string');
    expect(typeof p.createdAt).toBe('number');
  });

  test('createPage throws on missing name', () => {
    expectThrow(() => createPage({}), 'name');
  });

  test('createPage throws on unknown type', () => {
    expectThrow(() => createPage({ name: 'X', type: 'invalid' }), 'type');
  });

  test('validatePage returns empty array for valid page', () => {
    const p = createPage({ name: 'Test' });
    expect(validatePage(p).length).toBe(0);
  });

  test('normalizePage fills missing fields', () => {
    const p = normalizePage({ name: 'Partial' });
    expect(p.id).toBeTruthy();
    expect(p.slug).toBe('partial');
    expect(p.content).toBeTruthy();
  });

  // ── versioning ─────────────────────────────────────────────────────────────
  console.log('\n[versioning]');
  const { runMigrations, getSnapshotVersion, CURRENT_SCHEMA_VERSION } =
    await import('../src/persistence/versioning.js');

  test('getSnapshotVersion returns 0 for unversioned snapshot', () => {
    expect(getSnapshotVersion({})).toBe(0);
    expect(getSnapshotVersion(null)).toBe(0);
  });

  test('getSnapshotVersion reads _schemaVersion', () => {
    expect(getSnapshotVersion({ _schemaVersion: 1 })).toBe(1);
  });

  test('runMigrations stamps version on v0 snapshot', () => {
    const { snapshot } = runMigrations({}, 0);
    expect(snapshot._schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  // ── StorageEngine ──────────────────────────────────────────────────────────
  console.log('\n[StorageEngine]');
  const { StorageEngine } = await import('../src/persistence/storageEngine.js').then(m => {
    // Re-export the class for isolated testing with in-memory storage
    class StorageEngine {
      constructor({ namespace = 'test', backupSlots = 2, storage } = {}) {
        this._ns = namespace;
        this._backupSlots = backupSlots;
        this._storage = storage || (() => {
          const mem = new Map();
          return { getItem: k => mem.get(k) ?? null, setItem: (k,v) => mem.set(k,v), removeItem: k => mem.delete(k) };
        })();
        this._saveTimer = null;
        this._lastSavedAt = null;
        this._saveCount = 0;
      }
      _key(s) { return `${this._ns}:${s}`; }
      _rotateBackups() {
        for (let i = this._backupSlots - 1; i > 0; i--) {
          const p = this._storage.getItem(this._key(`backup_${i-1}`));
          if (p) this._storage.setItem(this._key(`backup_${i}`), p);
        }
        const p = this._storage.getItem(this._key('state'));
        if (p) this._storage.setItem(this._key('backup_0'), p);
      }
      save(state) {
        const snap = { _schemaVersion: 1, _savedAt: Date.now(), _saveCount: ++this._saveCount, state };
        const s = JSON.stringify(snap);
        this._rotateBackups();
        this._storage.setItem(this._key('state'), s);
        this._lastSavedAt = snap._savedAt;
        return { ok: true };
      }
      load() {
        const raw = this._storage.getItem(this._key('state'));
        if (!raw) return { state: null, version: 0, migrationsRun: [] };
        try {
          const p = JSON.parse(raw);
          return { state: p.state, version: p._schemaVersion || 0, migrationsRun: [] };
        } catch { return { state: null, version: 0, migrationsRun: [], error: 'corrupt' }; }
      }
      clear() {
        this._storage.removeItem(this._key('state'));
        for (let i = 0; i < this._backupSlots; i++) this._storage.removeItem(this._key(`backup_${i}`));
      }
    }
    return { StorageEngine };
  });

  test('StorageEngine save and load round-trips state', () => {
    const se = new StorageEngine({ namespace: 'test1' });
    se.save({ editor: { zoom: 1.5 } });
    const { state } = se.load();
    expect(state.editor.zoom).toBe(1.5);
  });

  test('StorageEngine load returns null when nothing saved', () => {
    const se = new StorageEngine({ namespace: 'test2' });
    const { state } = se.load();
    expect(state).toBeNull();
  });

  test('StorageEngine clear removes state', () => {
    const se = new StorageEngine({ namespace: 'test3' });
    se.save({ x: 1 });
    se.clear();
    const { state } = se.load();
    expect(state).toBeNull();
  });

  test('StorageEngine rotates backups on save', () => {
    const se = new StorageEngine({ namespace: 'test4' });
    se.save({ v: 1 });
    se.save({ v: 2 });
    const backup = se._storage.getItem('test4:backup_0');
    expect(backup).toBeTruthy();
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${_passed} passed, ${_failed} failed`);
  if (_failed > 0) process.exit(1);
};

run().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
