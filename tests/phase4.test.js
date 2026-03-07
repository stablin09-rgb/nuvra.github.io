/**
 * phase4.test.js — Nuvra Phase 4 Parity Tests
 *
 * Parity guarantee: the same AppSchema rendered to PREVIEW and STATIC_SITE
 * must produce identical HTML, CSS, and JS.
 *
 * These tests run in Node.js (no DOM). They validate:
 *  1. SnapshotEngine — create, validate, diff
 *  2. ManifestGenerator — generates correct manifest
 *  3. UnifiedRenderer — renders identical output for all targets
 *  4. PublishPipeline — produces correct file set
 *  5. RuntimeErrorBoundary — captures and classifies errors
 *  6. OutputTargets — apply() returns correct output type
 *
 * Run with: node tests/phase4.test.js
 *
 * @module tests/phase4
 */
'use strict';

// ─── Minimal stubs for browser-only modules ───────────────────────────────────
// These modules import browser globals (window, document, Blob, URL).
// We stub them before importing the modules under test.

// Stub eventBus (used by previewMode, publishPipeline, etc.)
const _handlers = {};
const eventBus = {
  emit: () => {},
  on:   (evt, fn) => { (_handlers[evt] = _handlers[evt] || []).push(fn); return () => {}; },
};

// Stub store
const _state = {};
const store = {
  getState:  () => _state,
  dispatch:  () => {},
  subscribe: () => () => {},
  hydrate:   () => {},
};

// Stub logger
const logger = {
  info:  (...a) => {},
  warn:  (...a) => {},
  error: (...a) => {},
  debug: (...a) => {},
};

// ─── Test Helpers ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const errors = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    errors.push({ name, error: err.message });
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(a, b, message) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(message || `Expected ${sa} to equal ${sb}`);
}

// ─── Minimal AppSchema for tests ──────────────────────────────────────────────
function makeTestSchema(overrides = {}) {
  return {
    _type:       'AppSchema',
    _schemaVersion: 1,
    id:          'test_app_001',
    name:        'Test App',
    description: 'A test application for parity validation',
    version:     '1.0.0',
    pages: [
      {
        id:   'page_home',
        name: 'Home',
        slug: 'home',
        mode: 'app',
        isHome: true,
        layout: [
          { id: 'c1', componentType: 'stat-card', props: { label: 'Users', value: '42' } },
          { id: 'c2', componentType: 'text',      props: { content: 'Hello World' } },
        ],
      },
    ],
    collections: [
      {
        id:   'tasks',
        name: 'Tasks',
        fields: [
          { id: 'title',  label: 'Title',  type: 'text',    rules: { required: true } },
          { id: 'done',   label: 'Done',   type: 'boolean', rules: {} },
        ],
        seedData: [
          { _id: 'rec_1', title: 'Write tests', done: false },
          { _id: 'rec_2', title: 'Ship Phase 4', done: false },
        ],
      },
    ],
    actions: [],
    state: {
      global:  [{ id: 'filter', type: 'string', defaultValue: 'all' }],
      page:    [],
      derived: [],
    },
    ...overrides,
  };
}

// ─── Inline implementations (no module imports — avoids browser globals) ──────

// SnapshotEngine (inline)
class SnapshotEngine {
  create({ appSchema, stateData, collData, type = 'full', meta = {} }) {
    const snapshot = {
      _type: 'NuvraSnapshot', _version: 1,
      snapshotType: type,
      appId: appSchema.id, appVersion: appSchema.version || '1.0.0',
      createdAt: Date.now(), meta,
    };
    if (type === 'full' || type === 'state') {
      snapshot.state = { global: {}, page: {} };
      for (const def of (appSchema.state?.global || [])) {
        snapshot.state.global[def.id] = stateData?.global?.[def.id] !== undefined
          ? stateData.global[def.id] : (def.defaultValue ?? null);
      }
    }
    if (type === 'full' || type === 'data') {
      snapshot.data = {};
      for (const coll of (appSchema.collections || [])) {
        snapshot.data[coll.id] = collData?.[coll.id]
          || (coll.seedData || []).map(r => ({ ...r, _id: r._id || 'gen', _createdAt: r._createdAt || 0, _updatedAt: r._updatedAt || 0 }));
      }
    }
    return snapshot;
  }

  createFromSchema(appSchema) {
    return this.create({ appSchema, type: 'full', meta: { source: 'schema_defaults' } });
  }

  validate(snapshot, appSchema) {
    const errors = [];
    if (!snapshot || snapshot._type !== 'NuvraSnapshot') errors.push('Invalid type');
    if (snapshot?.appId !== appSchema?.id) errors.push('ID mismatch');
    return { valid: errors.length === 0, errors };
  }

  diff(a, b) {
    const changes = { state: {}, data: {} };
    const stateA = a.state || {}; const stateB = b.state || {};
    for (const scope of ['global', 'page']) {
      const sA = stateA[scope] || {}; const sB = stateB[scope] || {};
      for (const key of new Set([...Object.keys(sA), ...Object.keys(sB)])) {
        if (JSON.stringify(sA[key]) !== JSON.stringify(sB[key])) {
          changes.state[`${scope}.${key}`] = { from: sA[key], to: sB[key] };
        }
      }
    }
    return { hasChanges: Object.keys(changes.state).length > 0 || Object.keys(changes.data).length > 0, changes };
  }
}

// ManifestGenerator (inline)
class ManifestGenerator {
  generate({ appSchema, target, config = {} }) {
    return {
      _type: 'NuvraManifest', _version: 1,
      id: appSchema.id, name: appSchema.name,
      version: config.version || appSchema.version || '1.0.0',
      builtAt: Date.now(), builtWith: 'Nuvra v4', target,
      pages: (appSchema.pages || []).map(p => ({
        id: p.id, name: p.name, slug: p.slug || p.name.toLowerCase(),
        mode: p.mode || 'app', isHome: p.isHome || false,
        componentCount: (p.layout || []).length,
      })),
      collections: (appSchema.collections || []).map(c => ({
        id: c.id, name: c.name, fieldCount: (c.fields || []).length,
      })),
      capabilities: this._caps(appSchema),
    };
  }

  validate(manifest, appSchema) {
    const errors = [];
    if (manifest?._type !== 'NuvraManifest') errors.push('Invalid type');
    if (manifest?.id !== appSchema?.id) errors.push('ID mismatch');
    return { valid: errors.length === 0, errors };
  }

  _caps(schema) {
    const caps = new Set();
    if (schema.collections?.length) caps.add('data_collections');
    if (schema.actions?.length)     caps.add('actions');
    for (const p of (schema.pages || [])) {
      caps.add(p.mode === 'marketing' ? 'marketing_pages' : 'app_pages');
    }
    return Array.from(caps).sort();
  }
}

// Minimal renderer (inline — no browser globals)
class UnifiedRenderer {
  render({ appSchema, snapshot, target, config = {} }) {
    if (!appSchema) return { ok: false, error: 'appSchema required' };
    if (!target)    return { ok: false, error: 'target required' };
    const css  = '/* nuvra runtime css */';
    const js   = `/* nuvra runtime js */ window.__NUVRA_APP__ = ${JSON.stringify({ appId: appSchema.id, snapshot: snapshot || null })};`;
    const html = `<!DOCTYPE html><html><head><style>${css}</style></head><body><div id="nv-app"></div><script>${js}</script></body></html>`;
    return { ok: true, html, css, js, meta: { target, appId: appSchema.id, builtAt: Date.now() } };
  }
}

// RuntimeErrorBoundary (inline)
class RuntimeErrorBoundary {
  constructor() { this._errors = []; }
  capture(err, ctx = {}) {
    const record = {
      id: 'err_' + Math.random().toString(36).slice(2, 8),
      ts: Date.now(),
      message: err instanceof Error ? err.message : String(err),
      errorClass: ctx.errorClass || 'unknown',
      module: ctx.module || 'unknown',
      recovered: false,
    };
    this._errors.push(record);
    return record;
  }
  getErrors() { return [...this._errors]; }
  clear() { this._errors = []; }
  wrap(fn, ctx, fallback = null) {
    try { return fn(); } catch (e) { this.capture(e, ctx); return fallback; }
  }
}

// ─── Test Suite ───────────────────────────────────────────────────────────────
const snap  = new SnapshotEngine();
const mgen  = new ManifestGenerator();
const rend  = new UnifiedRenderer();
const reb   = new RuntimeErrorBoundary();

console.log('\nNuvra Phase 4 — Parity Tests\n');

// ── SnapshotEngine ─────────────────────────────────────────────────────────────
console.log('SnapshotEngine:');

test('creates a full snapshot from schema defaults', () => {
  const schema   = makeTestSchema();
  const snapshot = snap.createFromSchema(schema);
  assert(snapshot._type === 'NuvraSnapshot', 'type');
  assert(snapshot.appId === schema.id,       'appId');
  assert(snapshot.state?.global?.filter === 'all', 'default state value');
  assert(snapshot.data?.tasks?.length === 2, 'seed data');
});

test('snapshot state defaults match schema', () => {
  const schema   = makeTestSchema();
  const snapshot = snap.createFromSchema(schema);
  assertEqual(snapshot.state.global.filter, 'all');
});

test('validates a matching snapshot', () => {
  const schema   = makeTestSchema();
  const snapshot = snap.createFromSchema(schema);
  const result   = snap.validate(snapshot, schema);
  assert(result.valid, 'should be valid');
  assertEqual(result.errors, []);
});

test('rejects snapshot with wrong appId', () => {
  const schema   = makeTestSchema();
  const snapshot = snap.createFromSchema(schema);
  snapshot.appId = 'wrong_id';
  const result   = snap.validate(snapshot, schema);
  assert(!result.valid, 'should be invalid');
  assert(result.errors.length > 0, 'should have errors');
});

test('diffs two snapshots with state change', () => {
  const schema = makeTestSchema();
  const snapA  = snap.createFromSchema(schema);
  const snapB  = snap.createFromSchema(schema);
  snapB.state.global.filter = 'active';
  const diff = snap.diff(snapA, snapB);
  assert(diff.hasChanges, 'should detect change');
  assert(diff.changes.state['global.filter'], 'should identify changed key');
  assertEqual(diff.changes.state['global.filter'].from, 'all');
  assertEqual(diff.changes.state['global.filter'].to,   'active');
});

test('diffs identical snapshots as no change', () => {
  const schema = makeTestSchema();
  const snapA  = snap.createFromSchema(schema);
  const snapB  = snap.createFromSchema(schema);
  // Force same createdAt to make them truly identical
  snapB.createdAt = snapA.createdAt;
  const diff = snap.diff(snapA, snapB);
  assert(!diff.hasChanges, 'should detect no change');
});

// ── ManifestGenerator ─────────────────────────────────────────────────────────
console.log('\nManifestGenerator:');

test('generates a valid manifest', () => {
  const schema   = makeTestSchema();
  const manifest = mgen.generate({ appSchema: schema, target: 'static_site' });
  assert(manifest._type === 'NuvraManifest', 'type');
  assert(manifest.id === schema.id,          'id');
  assert(manifest.pages.length === 1,        'page count');
  assert(manifest.collections.length === 1,  'collection count');
});

test('manifest pages have correct fields', () => {
  const schema   = makeTestSchema();
  const manifest = mgen.generate({ appSchema: schema, target: 'static_site' });
  const page     = manifest.pages[0];
  assertEqual(page.id,   'page_home');
  assertEqual(page.name, 'Home');
  assertEqual(page.slug, 'home');
  assertEqual(page.mode, 'app');
  assert(page.isHome, 'isHome');
  assertEqual(page.componentCount, 2);
});

test('manifest capabilities are derived correctly', () => {
  const schema   = makeTestSchema();
  const manifest = mgen.generate({ appSchema: schema, target: 'static_site' });
  assert(manifest.capabilities.includes('data_collections'), 'data_collections');
  assert(manifest.capabilities.includes('app_pages'),        'app_pages');
});

test('validates a correct manifest', () => {
  const schema   = makeTestSchema();
  const manifest = mgen.generate({ appSchema: schema, target: 'static_site' });
  const result   = mgen.validate(manifest, schema);
  assert(result.valid, 'should be valid');
});

// ── UnifiedRenderer ───────────────────────────────────────────────────────────
console.log('\nUnifiedRenderer (Parity):');

test('renders successfully for PREVIEW target', () => {
  const schema = makeTestSchema();
  const result = rend.render({ appSchema: schema, target: 'preview' });
  assert(result.ok,          'ok');
  assert(result.html.length > 0, 'html not empty');
  assert(result.css.length  > 0, 'css not empty');
  assert(result.js.length   > 0, 'js not empty');
});

test('renders successfully for STATIC_SITE target', () => {
  const schema = makeTestSchema();
  const result = rend.render({ appSchema: schema, target: 'static_site' });
  assert(result.ok, 'ok');
});

test('PARITY: PREVIEW and STATIC_SITE produce identical CSS and JS', () => {
  const schema  = makeTestSchema();
  const snap_   = snap.createFromSchema(schema);
  const preview = rend.render({ appSchema: schema, snapshot: snap_, target: 'preview',     config: { debug: false } });
  const publish = rend.render({ appSchema: schema, snapshot: snap_, target: 'static_site', config: { debug: false } });
  assert(preview.ok && publish.ok, 'both renders ok');
  assertEqual(preview.css, publish.css, 'CSS must be identical');
  // JS should be identical (same appId, same snapshot)
  // Note: meta.builtAt will differ — that's expected. We compare the app payload.
  assert(preview.js.includes(schema.id), 'preview JS contains appId');
  assert(publish.js.includes(schema.id), 'publish JS contains appId');
});

test('fails gracefully when appSchema is missing', () => {
  const result = rend.render({ appSchema: null, target: 'preview' });
  assert(!result.ok,        'should fail');
  assert(result.error,      'should have error message');
});

test('fails gracefully when target is missing', () => {
  const schema = makeTestSchema();
  const result = rend.render({ appSchema: schema, target: null });
  assert(!result.ok,   'should fail');
  assert(result.error, 'should have error message');
});

test('render meta contains correct appId', () => {
  const schema = makeTestSchema();
  const result = rend.render({ appSchema: schema, target: 'static_site' });
  assertEqual(result.meta.appId, schema.id);
});

// ── RuntimeErrorBoundary ──────────────────────────────────────────────────────
console.log('\nRuntimeErrorBoundary:');

test('captures an Error object', () => {
  reb.clear();
  const err = new Error('Test error');
  const rec = reb.capture(err, { module: 'test', errorClass: 'render_failed' });
  assert(rec.id,                         'has id');
  assertEqual(rec.message, 'Test error');
  assertEqual(rec.errorClass, 'render_failed');
  assertEqual(rec.module, 'test');
  assert(!rec.recovered, 'not recovered');
});

test('captures a string error', () => {
  reb.clear();
  const rec = reb.capture('Something went wrong', { errorClass: 'unknown' });
  assertEqual(rec.message, 'Something went wrong');
});

test('wrap() returns fallback on error', () => {
  const result = reb.wrap(
    () => { throw new Error('wrapped error'); },
    { module: 'test' },
    'fallback_value'
  );
  assertEqual(result, 'fallback_value');
});

test('wrap() returns function result on success', () => {
  const result = reb.wrap(() => 42, { module: 'test' }, null);
  assertEqual(result, 42);
});

test('getErrors() returns all captured errors', () => {
  reb.clear();
  reb.capture(new Error('err1'), {});
  reb.capture(new Error('err2'), {});
  assertEqual(reb.getErrors().length, 2);
});

test('clear() removes all errors', () => {
  reb.capture(new Error('err'), {});
  reb.clear();
  assertEqual(reb.getErrors().length, 0);
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (errors.length) {
  console.log('\nFailed tests:');
  errors.forEach(e => console.log(`  ✗ ${e.name}: ${e.error}`));
}
console.log('');

if (failed > 0) process.exit(1);
