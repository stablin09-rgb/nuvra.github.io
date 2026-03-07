# Nuvra Phase 2–2.5: AI Planning Engine

**Author**: Manus AI
**Date**: Mar 01, 2026

## 1. Overview

Phase 2–2.5 introduces the **AI Planning Engine**, a deterministic, schema-first system that translates natural language user intent into a structured, explainable site plan. This is the core of Nuvra's "AI as a controlled collaborator" philosophy. The AI suggests, but the system decides.

This phase builds directly on the Phase 0–1 foundation, integrating as a new `planningEngine` module and an associated `ai` state slice. It does not replace the foundation, but extends it.

### Key Principles

- **Schema-First**: The AI's primary output is a structured, versioned schema, not code or content. This schema is the single source of truth for the renderer.
- **Deterministic**: For a given input and version, the planning output is reproducible. This is achieved by using zero temperature for AI calls and encoding UX rules as deterministic heuristics.
- **Explainable**: Every decision in the generated plan is accompanied by a `reason` field, tracing back to a specific UX heuristic or a direct interpretation of the user's intent. The AI's reasoning is not a black box.
- **Controllable**: The user can inspect, edit, lock, and reject any part of the AI's plan through the **Explainability & Introspection UI**.

## 2. System Architecture

The Planning Engine consists of several coordinated modules that form a pipeline:

`User Prompt` → `Intent Analysis` → `Planning Graph` → `Schema Store` → `UI`

| Module | Path | Responsibilities |
|---|---|---|
| **Planning Engine** | `src/ai/planningEngine.js` | Top-level orchestrator; manages the planning pipeline, re-planning, and user edits. |
| **Intent Analyzer** | `src/ai/intent/intentAnalyzer.js` | Converts raw user prompt into a structured `IntentSchema`. |
| **Planning Graph** | `src/ai/planning/planningGraph.js` | Converts `IntentSchema` into a `SiteSchema` using heuristics and AI refinement. |
| **Schema Store** | `src/ai/schemas/schemaStore.js` | Authoritative, versioned repository for all schemas (`IntentSchema`, `SiteSchema`). |
| **AI Adapter** | `src/ai/adapter/aiAdapter.js` | The only module that communicates with an external AI provider (e.g., OpenAI). Enforces a strict JSON-only contract. |
| **Schema Validator** | `src/ai/validator/schemaValidator.js` | Gatekeeper that validates all AI output against canonical schemas before it enters the system. |
| **Planning Panel** | `src/ui/panels/planningPanel.js` | The UI for explainability and introspection, allowing users to interact with the planning process. |

### 2.1. The Planning Pipeline

1.  **Prompt Input**: The user enters a natural language description of their goal into the **Planning Panel**.

2.  **Intent Analysis**: The `planningEngine` passes the prompt to the `intentAnalyzer`. The analyzer uses a specialized system prompt to instruct the AI to return a structured JSON object representing the user's intent. This output is validated and normalized into a canonical `IntentSchema`.

3.  **Planning Graph**: The `planningEngine` passes the `IntentSchema` to the `planningGraph`. The graph operates in stages:
    *   **Page Planning**: It first uses heuristics from `planningHeuristics.js` to determine which pages the site needs (e.g., a SaaS product needs a pricing page).
    *   **Section Planning**: For each page, it uses a template from `planningHeuristics.js` to create a baseline section order based on proven UX patterns. This baseline is then sent to the AI for refinement, which may reorder, add, or remove optional sections based on the specific user intent.
    *   **Content Intent Planning**: For each section, the AI defines a `ContentIntentSchema`, which is a semantic contract describing *what* the content must communicate, not the copy itself.

4.  **Schema Generation**: The output of the Planning Graph is a complete, versioned `SiteSchema`.

5.  **Storage and UI Update**: The `planningEngine` commits the new `SiteSchema` to the `schemaStore`, which creates a new version and computes a diff. The store then notifies the UI, which re-renders the **Planning Panel** to display the new, fully-explainable plan.

## 3. Canonical Schemas

This phase introduces a strict, versioned schema hierarchy that serves as the backbone of the entire system. These schemas are render-agnostic.

-   **`IntentSchema`**: The structured, normalized understanding of the user's request.
-   **`SiteSchema`**: The top-level plan for the entire site, containing an array of `PageSchema` objects.
-   **`PageSchema`**: The plan for a single page, containing an array of `SectionSchema` objects.
-   **`SectionSchema`**: The plan for a single section, containing a `ContentIntentSchema`.
-   **`ContentIntentSchema`**: The semantic contract for a section's content (e.g., "headline must communicate trust and security").

## 4. UI: Explainability & Introspection

The **Planning Panel** (`planningPanel.js`) is the user's window into the AI's mind. It is a new sidebar panel with four tabs:

-   **Prompt**: Where the user interacts with the AI.
-   **Intent**: A read-only view of the `IntentSchema`, showing how the AI understood the request, including any ambiguities or assumptions it made.
-   **Plan**: A detailed, hierarchical view of the `SiteSchema`. Each page and section is displayed with its `purpose` and `reason`, making the AI's logic transparent.
-   **History**: A list of all previous plan versions, with diffs showing what changed. The user can restore any previous version.

## 5. Integration with Foundation

Phase 2–2.5 integrates cleanly with the Phase 0–1 foundation:

-   **State Management**: A new `ai` slice is added to the root reducer (`reducers.js`) to manage the planning state (`isPlanning`, `intent`, `siteSchema`, etc.).
-   **Boot Sequence**: The `planningEngine` is registered as a module in `main.js` and is started by the `coreRuntime`.
-   **Persistence**: The `schemaStore`'s full state, including history, is serialized and saved to the `storageEngine` as part of the main application state. This ensures that the AI's memory is preserved across sessions.
-   **UI**: The `editorShell` is updated to mount and manage the new `planningPanel`.

This modular integration ensures that the core foundation remains decoupled from the AI systems, allowing for independent evolution and testing.
