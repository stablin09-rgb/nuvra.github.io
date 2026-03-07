# Nuvra — Phase 5B Drop-In Archive

This ZIP contains the **complete Nuvra repository** at Phase 5B state.
It is designed to be dropped directly into your existing `nuvra.github.io` folder.

---

## How to Apply

### Step 1 — Back up your current repo (optional but recommended)
```bash
cp -r nuvra.github.io nuvra.github.io.backup
```

### Step 2 — Unzip into your repo folder
```bash
# Unzip and overwrite all files
unzip nuvra-phase-5b-complete.zip -d nuvra.github.io
```
> All existing files will be overwritten. No files will be deleted.

### Step 3 — Commit and push
```bash
cd nuvra.github.io
git add .
git commit -m "feat: apply Nuvra Phase 5B — real AI app generation"
git push origin main
```

---

## What's Included

### New Files (Phase 5B)
| File | Purpose |
| :--- | :--- |
| `src/ai/appSchema.js` | AppPageSchema, AiCollectionSchema, ActionSchema type definitions |
| `src/ai/appPlanner.js` | AppPromptAnalyser + AppPlanner (Prompt → Intent → AppPlan) |
| `src/ai/appSchemaRenderer.js` | Converts AppPageSchema to HTML/CSS for GrapesJS |

### Updated Files (Phase 5B)
| File | Changes |
| :--- | :--- |
| `src/ai/aiEngine.js` | Added `generateApp()` function; full Prompt→Plan→Render pipeline |
| `src/ai/promptBuilder.js` | Added `buildAppSystemPrompt()` and `buildAppUserMessage()` |
| `src/core/app.js` | Three-mode generation system (Page / Site / App) |
| `index.html` | Generate button upgraded to split-button with mode dropdown |
| `src/ui/styles.css` | Styles for the new generate-mode dropdown |

### Files Carried Forward (Phases 2–5A, unchanged)
All files from previous phases are included in full:
- `src/ai/pageSchema.js`, `schemaRenderer.js`, `mockProvider.js`, `promptAnalyser.js`, `sitePlanner.js`
- `src/ai/providerBase.js`, `providers/openaiProvider.js`, `providers/anthropicProvider.js`, `providers/localProvider.js`
- `src/data/dataModel.js`, `src/state/stateManager.js`, `src/actions/actionEngine.js`
- `src/app-components/appComponents.js`, `src/runtime/appRuntime.js`
- `src/preview/previewRenderer.js`, `src/preview/previewManager.js`
- `src/publish/publishRenderer.js`, `src/publish/siteBuilder.js`, `src/publish/publishManager.js`, `src/publish/manifestBuilder.js`
- All original files: `storage.js`, `pageManager.js`, `exportImport.js`, `blockLibrary.js`, `componentSchema.js`, `helpers.js`

---

## Verification

After applying, open `index.html` in a browser (or serve locally with `npx serve .`).

You should see:
- [ ] The Nuvra editor loads with the GrapesJS canvas
- [ ] The AI prompt bar shows a split **Generate / ▾** button
- [ ] Clicking **▾** opens a dropdown with: Generate Page, Generate Site, Generate App
- [ ] Typing a prompt and clicking **Generate** (in Page mode) generates a marketing page
- [ ] Switching to **App** mode and typing "task manager" generates a multi-page app with a Dashboard and Tasks page

---

## Architecture Summary

Phase 5B introduces the **App Generation Pipeline**:

```
User Prompt
    │
    ▼
AppPromptAnalyser      → extracts: appType, entities, features, brand
    │
    ▼
AppPlanner             → produces: AppPlan (collections + pages + components)
    │
    ▼
AI Provider            → validates and enriches the AppPlan (real or mock)
    │
    ▼
AppSchemaRenderer      → converts each AppPageSchema to HTML + CSS
    │
    ▼
GrapesJS               → loads the rendered pages into the editor
```

The AI never generates raw HTML. All HTML is produced by Nuvra's own renderer,
ensuring output is consistent, reliable, and 100% original to Nuvra.
