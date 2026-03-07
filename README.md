# Nuvra — Phase 2–2.5: AI Planning Engine

> **Includes Phase 0–1 Foundation + Phase 2–2.5 AI Planning Engine**

---

This directory contains the complete source code for the Nuvra Foundation, a hard reset of the application built from first principles. It provides a deterministic, observable, and extensible core for all future development.

## Core Objective

Phase 2–2.5 introduces the **AI Planning Engine** — a schema-first, deterministic system that translates natural language user intent into a structured, explainable site plan. It builds on the Phase 0–1 foundation without modifying its core principles.

**Phase 0–1 Foundation**: Deterministic Core Runtime, Single State Authority, local-first Persistence, dynamic Page System, Error Boundary, and state-driven Live Editor Shell.

**Phase 2–2.5 AI Planning Engine**: Intent Analysis, Planning Graph with UX heuristics, canonical schemas (SiteSchema, PageSchema, SectionSchema, ContentIntentSchema), AI Adapter, Schema Validator, versioned Schema Store, Explainability & Introspection UI, and full Re-planning support.

## How to Run

This is a vanilla JavaScript project with no build dependencies.

1.  **Set your OpenAI API key** (required for AI planning):
    In your browser console, before the page loads:
    ```javascript
    window.NUVRA_OPENAI_KEY = 'sk-your-key-here';
    ```

2.  **Start a local web server:**
    ```sh
    python3 -m http.server 8000
    ```

3.  **Open your browser** and navigate to `http://localhost:8000`.

4.  **Use the Planning Panel**: Click the AI icon in the sidebar to open the Planning Panel. Enter a prompt and click "Analyze & Plan".

## Project Structure

**Phase 0–1 Foundation:**
-   `/src/runtime`: Core Runtime, Event Bus, Lifecycle Manager.
-   `/src/state`: Single State Authority (Store, Reducers, Selectors).
-   `/src/persistence`: Local-first Persistence Layer with versioning.
-   `/src/pages`: Dynamic Page System.
-   `/src/diagnostics`: Error Boundary and structured Logger.
-   `/src/ui`: State-driven Live Editor Shell and components.

**Phase 2–2.5 AI Planning Engine:**
-   `/src/ai/planningEngine.js`: Top-level orchestrator.
-   `/src/ai/intent/`: Intent Analysis Engine and `IntentSchema` types.
-   `/src/ai/planning/`: Planning Graph and UX heuristics.
-   `/src/ai/schemas/`: Canonical schema factories and the Schema Store.
-   `/src/ai/adapter/`: AI provider adapter (OpenAI-compatible).
-   `/src/ai/validator/`: Schema validator for all AI output.
-   `/src/ui/panels/planningPanel.js`: Explainability & Introspection UI.

**Documentation:**
-   `ARCHITECTURE_PHASE_0_1.md`: Foundation architecture.
-   `ARCHITECTURE_PHASE_2_2_5.md`: AI Planning Engine architecture.

## Validation & Testing

A suite of unit tests is included in `/tests/foundation.test.js`. These tests can be run from the command line using Node.js and have no external dependencies.

```sh
node --experimental-vm-modules tests/foundation.test.js
```

All tests should pass, confirming the integrity and correctness of the core systems.

## Known Limitations

-   **No GrapesJS**: The canvas is a placeholder. GrapesJS integration is a future phase.
-   **No Content Generation**: The Planning Engine generates a *plan* (schemas), not actual copy or content. Content generation is a future phase.
-   **No Cloud**: Persistence is local-only. Cloud auth and sync are future phases.
-   **No Marketplace**: Extension and marketplace systems are not included.
