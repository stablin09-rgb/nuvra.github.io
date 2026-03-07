# Nuvra Phase 4 — High-Fidelity Preview & Publish

**The rule: Preview = Published Output = Future Hosted Output.**

There is one renderer. There is no preview renderer. There is no export renderer. There is one `UnifiedRenderer` that takes a `RenderContext` and produces a `RenderOutput`. That output is used everywhere.

---

## The Core Principle

In most no-code tools, "Preview" is a lie. It is a separate rendering path that approximates what the published output will look like. Drift accumulates. Users discover bugs in production that were invisible in preview.

Nuvra Phase 4 eliminates this class of bug entirely.

```
AppSchema + Snapshot
        │
        ▼
 UnifiedRenderer
        │
        ├──► PREVIEW target  ──► Blob URL ──► sandboxed <iframe>
        │
        ├──► STATIC_SITE target ──► HTML/CSS/JS files ──► ZIP download
        │
        ├──► LIVE_PREVIEW target ──► Blob URL ──► new browser tab
        │
        └──► APP_READY target ──► ZIP with mobile metadata
```

The CSS and JS are byte-for-byte identical across all targets. The only difference is the HTML wrapper (which adds a debug banner in preview mode when `debug=true`).

---

## System Architecture

### 1. Unified Runtime Renderer (`src/renderer/`)

| File | Responsibility |
|---|---|
| `renderTarget.js` | Canonical target definitions: `preview`, `static_site`, `live_preview`, `app_ready`, `cloud_host` |
| `runtimeBundle.js` | The self-contained runtime JS that boots the app in the browser |
| `runtimeStyles.js` | The canonical CSS — the only CSS that ships in any output |
| `unifiedRenderer.js` | The single renderer: `RenderContext → RenderOutput` |

**RenderContext:**
```js
{
  appSchema: AppSchema,    // The schema to render
  snapshot:  Snapshot,     // Data/state snapshot (optional)
  target:    RenderTarget, // Which target to render for
  config: {
    title:   string,       // Page title
    version: string,       // Build version
    debug:   boolean,      // Enable debug banner (preview only)
  }
}
```

**RenderOutput:**
```js
{
  ok:   boolean,
  html: string,   // Complete HTML document (self-contained)
  css:  string,   // Canonical CSS
  js:   string,   // Runtime JS bundle
  meta: { target, appId, appName, version, builtAt, pageCount }
}
```

### 2. Snapshot Engine (`src/snapshot/`)

The `SnapshotEngine` serializes the complete runtime state of an app into a portable, deterministic snapshot. The snapshot is embedded in the published output and used to boot the runtime.

**Snapshot types:**
- `full` — all state + all data (default)
- `state` — state only
- `data` — data only
- `partial` — specific paths (future)

**Key operations:**
- `createFromSchema(appSchema)` — builds a snapshot from schema defaults (seed data + default state values)
- `validate(snapshot, appSchema)` — validates a snapshot against a schema
- `diff(snapshotA, snapshotB)` — returns a structured diff of what changed

### 3. Preview Mode (`src/preview/`)

The `PreviewMode` module manages the preview lifecycle:

```
editor:enter_preview event
        │
        ▼
  PreviewMode.enter()
        │
        ├── 1. Create snapshot (from live runtime or schema defaults)
        ├── 2. UnifiedRenderer.render(target: PREVIEW)
        ├── 3. Create Blob URL from HTML
        ├── 4. Inject into sandboxed <iframe>
        └── 5. Emit preview:entered
```

**Sandbox attributes:** `allow-scripts allow-same-origin allow-forms`

**Isolation guarantee:** Mutations inside the preview iframe (state changes, data writes) do NOT affect the editor state. The preview runs in a completely isolated execution context.

**Reset:** `PreviewMode.reset()` re-creates the snapshot from schema defaults and re-renders. All mutations are discarded.

### 4. Publish Pipeline (`src/publish/`)

The `PublishPipeline` is a 7-stage compilation engine:

```
Stage 1: VALIDATE  — Schema + target validation
Stage 2: SNAPSHOT  — Create data/state snapshot
Stage 3: MANIFEST  — Generate nuvra.manifest.json
Stage 4: RENDER    — UnifiedRenderer.render()
Stage 5: ASSEMBLE  — Build files map { filename: content }
Stage 6: TARGET    — Apply output target wrapper
Stage 7: COMPLETE  — Emit publish:complete event
```

Each stage emits a `publish:stage` event. The `PreviewPanel` listens to these events to update the progress bar.

**Output files:**
```
index.html           — Complete self-contained HTML document
nuvra-runtime.css    — Canonical CSS (also inlined in HTML)
nuvra-runtime.js     — Runtime JS bundle (also inlined in HTML)
nuvra.manifest.json  — Machine-readable build manifest
nuvra.snapshot.json  — Data/state snapshot (if embedData=true)
README.md            — Human-readable documentation
```

### 5. Output Target System (`src/output/`)

Each target applies a different wrapper to the same compiled output:

| Target | Output | Use Case |
|---|---|---|
| `static_site` | ZIP download | Deploy to any static host |
| `live_preview` | Blob URL → new tab | Share a live preview link |
| `app_ready` | ZIP with mobile metadata | Wrap with Capacitor/React Native Web |
| `cloud_host` | (future) | Deploy to Nuvra Cloud |

The `StaticSiteTarget` includes a pure-JS ZIP builder (no external dependencies, CRC-32 + PKZIP format).

### 6. Manifest System (`src/manifest/`)

The `nuvra.manifest.json` is the machine-readable contract for the published output:

```json
{
  "_type": "NuvraManifest",
  "id": "app_001",
  "name": "My App",
  "version": "1.0.0",
  "target": "static_site",
  "pages": [{ "id": "page_home", "name": "Home", "slug": "home", "mode": "app" }],
  "collections": [{ "id": "tasks", "name": "Tasks", "fieldCount": 3 }],
  "capabilities": ["app_pages", "data_collections", "forms"],
  "routing": { "type": "hash", "baseUrl": "/" },
  "mobileReady": false
}
```

### 7. Preview Controls UI (`src/ui/panels/previewPanel.js`)

The `PreviewPanel` replaces the editor canvas when Preview Mode is active. It provides:

- **Back to Editor** button — exits preview, returns to edit mode
- **Viewport switcher** — Desktop / Tablet / Mobile
- **Reload** — re-renders the preview (preserves current state)
- **Reset Data** — re-creates snapshot from schema defaults (discards mutations)
- **Debug overlay** — shows preview state, schema info, snapshot stats, build log
- **Publish menu** — Download ZIP / Open Live Preview / App-Ready ZIP
- **Build progress bar** — animated, stage-by-stage
- **Error panel** — displays runtime errors with a Retry button

### 8. Error Containment (`src/preview/runtimeErrorBoundary.js`)

The `RuntimeErrorBoundary` captures and classifies all runtime errors:

| Error Class | Trigger |
|---|---|
| `schema_invalid` | Schema failed validation |
| `render_failed` | Renderer threw an error |
| `component_error` | A component failed to render |
| `action_error` | An action step failed |
| `data_error` | A data operation failed |
| `state_error` | A state operation failed |
| `publish_error` | Publish pipeline failed |
| `snapshot_error` | Snapshot creation failed |
| `unknown` | Uncategorized |

**Guarantee:** A preview failure never corrupts the editor state. The editor never crashes due to a preview error. All errors are captured, classified, and displayed.

---

## State Shape (Phase 4 additions)

```js
{
  // ... Phase 0-3 slices ...
  preview: {
    state:    'idle' | 'loading' | 'running' | 'error' | 'resetting',
    viewport: 'desktop' | 'tablet' | 'mobile',
    debug:    boolean,
  },
  publish: {
    stage:      PipelineStage,
    lastResult: PublishResult | null,
    error:      string | null,
  },
  runtimeErrors: {
    errors: RuntimeErrorRecord[],
  },
}
```

---

## Lifecycle Diagram

```
USER CLICKS "PREVIEW"
        │
        ▼
editor:enter_preview event
        │
        ▼
main.js handler
        │
        ├── store.dispatch(PREVIEW/SET_STATE: 'loading')
        │
        ▼
PreviewMode.enter({ appSchema, mountEl })
        │
        ├── snapshotEngine.createFromSchema(appSchema)
        │         └── reads: state defaults, seed data
        │
        ├── unifiedRenderer.render({ appSchema, snapshot, target: 'preview' })
        │         ├── generateRuntimeCSS()
        │         ├── generateRuntimeScript()
        │         └── buildHTMLDocument()
        │
        ├── new Blob([html]) → URL.createObjectURL()
        │
        ├── <iframe sandbox="..."> ← inject Blob URL
        │
        └── store.dispatch(PREVIEW/SET_STATE: 'running')
                  └── eventBus.emit('preview:entered')


USER CLICKS "PUBLISH → DOWNLOAD ZIP"
        │
        ▼
publish:run event
        │
        ▼
PublishPipeline.run({ appSchema, target: 'static_site' })
        │
        ├── Stage 1: validate schema + target
        ├── Stage 2: snapshotEngine.createFromSchema()
        ├── Stage 3: manifestGenerator.generate()
        ├── Stage 4: unifiedRenderer.render(target: 'static_site')
        │         └── SAME renderer, SAME CSS, SAME JS as preview
        ├── Stage 5: assemble files map
        ├── Stage 6: StaticSiteTarget.apply() → ZIP Blob
        └── Stage 7: emit publish:complete
                  │
                  ▼
        StaticSiteTarget.download() → browser download
```

---

## Known Limitations

**Phase 4 does not include:**

- Multi-page routing in the published output (coming in Phase 5)
- Cloud hosting deployment (coming in Phase 7)
- Real-time collaboration (coming in Phase 8)
- Mobile native wrapper generation (coming in Phase 9)
- The `runtimeBundle.js` is a stub — it embeds the schema and snapshot but does not yet run the full Phase 3 App Runtime in the browser. Full browser-side runtime execution is the Phase 5 milestone.

---

## Files Added in Phase 4

| File | Lines |
|---|---|
| `src/renderer/renderTarget.js` | ~60 |
| `src/renderer/runtimeBundle.js` | ~180 |
| `src/renderer/runtimeStyles.js` | ~160 |
| `src/renderer/unifiedRenderer.js` | ~110 |
| `src/snapshot/snapshotEngine.js` | ~200 |
| `src/preview/previewMode.js` | ~220 |
| `src/preview/runtimeErrorBoundary.js` | ~160 |
| `src/publish/publishPipeline.js` | ~230 |
| `src/output/outputTargets.js` | ~230 |
| `src/manifest/manifestGenerator.js` | ~150 |
| `src/ui/panels/previewPanel.js` | ~310 |
| `src/state/reducers.js` | +70 lines (3 new slices) |
| `src/main.js` | +50 lines (Preview + Publish wiring) |
| `tests/phase4.test.js` | ~280 |
| **Total new code** | **~2,400 lines** |

---

*Nuvra Phase 4 — Built with determinism as a design constraint.*
