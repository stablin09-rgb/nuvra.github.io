# Nuvra Foundation — Phase 0–1

This directory contains the complete source code for the Nuvra Foundation, a hard reset of the application built from first principles. It provides a deterministic, observable, and extensible core for all future development.

## Core Objective

The goal of this phase was to produce a non-static, fully functioning, deterministic core that can support all future phases without rework. The foundation is built on principles of determinism, runtime execution, a single source of truth, explicit lifecycles, zero silent failures, observable systems, and strict module boundaries.

## How to Run

This is a vanilla JavaScript project with no build dependencies. You can run it by serving the `nuvra-foundation` directory with any local web server.

1.  **Navigate to the project directory:**
    ```sh
    cd nuvra-foundation
    ```

2.  **Start a simple web server (e.g., using Python):**
    ```sh
    python3 -m http.server 8000
    ```

3.  **Open your browser** and navigate to `http://localhost:8000`.

## Project Structure

The codebase is organized into cleanly separated systems:

-   `/src/runtime`: The Core Runtime, Event Bus, and Lifecycle Manager.
-   `/src/state`: The single State Authority (Store, Reducers, Selectors).
-   `/src/persistence`: The local-first Persistence Layer with versioning.
-   `/src/pages`: The dynamic Page System.
-   `/src/diagnostics`: The Error Boundary and structured Logger.
-   `/src/ui`: The state-driven Live Editor Shell and its components.
-   `/src/main.js`: The application boot sequence.
-   `/index.html`: The single HTML entry point.
-   `/tests`: Standalone unit tests for the foundation modules.

For a detailed explanation of the architecture, please see `ARCHITECTURE_PHASE_0_1.md`.

## Validation & Testing

A suite of unit tests is included in `/tests/foundation.test.js`. These tests can be run from the command line using Node.js and have no external dependencies.

```sh
node --experimental-vm-modules tests/foundation.test.js
```

All tests should pass, confirming the integrity and correctness of the core systems.

## Known Limitations

This is a foundational phase. As such, many features are explicitly out of scope:

-   **No GrapesJS**: The canvas is a placeholder. The GrapesJS editor will be integrated in a future phase.
-   **No AI**: AI providers, prompt generation, and AI-driven features are not included.
-   **No Cloud**: There is no authentication, cloud storage, or deployment. Persistence is local-only.
-   **No Marketplace**: The extension and marketplace systems are not part of the foundation.

This phase delivers only the core, upon which all other features will be built.
