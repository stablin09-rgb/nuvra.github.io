# Nuvra Architecture: Phase 0–1 Foundation

**A hard reset of the Nuvra foundation, built from first principles for determinism, observability, and extensibility.**

## 1. Core Objective & Principles

Phase 0–1 rebuilds the core of Nuvra to be a production-grade, non-static, and fully deterministic foundation. The primary goal is to create a bedrock so stable and well-architected that no core system will need to be rewritten in future phases.

This foundation is built on seven non-negotiable principles:

1.  **Determinism over magic**: All state changes are predictable and traceable.
2.  **Runtime execution over mock behavior**: The editor is a live environment, not a static mock.
3.  **Single source of truth for state**: All application state is centralized in one observable store.
4.  **Explicit lifecycles**: Modules follow a strict `init` → `run` → `teardown` lifecycle.
5.  **Zero silent failures**: Errors are always captured, reported, and made visible.
6.  **Observable systems**: All significant events (state changes, errors, lifecycle transitions) are emitted on a central event bus.
7.  **Strict separation of concerns**: Modules have clear boundaries and interact via well-defined contracts, not direct imports.

## 2. Foundation Systems

The architecture consists of seven mandatory, cleanly separated systems.

| System | Module(s) | Responsibility |
| :--- | :--- | :--- |
| 1. Core Runtime | `coreRuntime.js`, `eventBus.js`, `lifecycle.js` | Boots the app, manages module lifecycles, and provides the central event bus. |
| 2. State Authority | `store.js`, `reducers.js`, `selectors.js` | The single, observable source of truth for all application state. |
| 3. Persistence Layer | `storageEngine.js`, `versioning.js` | Handles local-first state persistence with versioning and corruption recovery. |
| 4. Page System | `pageManager.js`, `pageTypes.js` | Manages pages as real, dynamic entities stored in state. |
| 5. Diagnostics | `errorBoundary.js`, `logger.js` | Captures all errors and provides structured, leveled logging. |
| 6. Live Editor UI | `editorShell.js`, `panels/*`, `controls/*` | Renders the UI based on state; all user interactions dispatch actions. |
| 7. Boot Sequence | `main.js` | The single entry point that wires all systems together in the correct order. |

### 2.1. Nuvra Core Runtime (`/runtime`)

The **Core Runtime** is the heart of the application. It is the first system to initialize and the last to shut down. Nothing runs outside of its control.

-   **`coreRuntime.js`**: The runtime itself. It exposes `register()`, `start()`, and `shutdown()` methods. It uses a topological sort to initialize and start modules in the correct dependency order, preventing race conditions.
-   **`lifecycle.js`**: Defines the explicit lifecycle states (`REGISTERED`, `INITIALIZING`, `READY`, `RUNNING`, `STOPPED`, `ERROR`) and enforces valid transitions for every module.
-   **`eventBus.js`**: The central nervous system. All inter-module communication happens via the event bus. This decouples modules, as they only need to know about events, not about each other. It includes a replay buffer for late-joining listeners.

### 2.2. Single State Authority (`/state`)

All application state is held in a single, observable **Store**. This eliminates scattered state and makes the entire application predictable.

-   **`store.js`**: A Redux-inspired, dependency-free state container. It exposes `getState()`, `dispatch(action)`, and `subscribe(listener)`. State is read-only and can only be changed by dispatching a pure action.
-   **`reducers.js`**: A set of pure functions that take the current state and an action and return the *new* state. This is the only place state is ever changed. Reducers are combined into a `rootReducer`.
-   **`selectors.js`**: A set of pure functions for reading derived data from the state. UI components and modules use selectors to get the data they need, ensuring they are decoupled from the raw state structure.

### 2.3. Persistence Layer (`/persistence`)

The foundation uses a **local-first persistence** strategy. The state is continuously saved to the browser's `localStorage`, but with a robust engine that prevents data loss.

-   **`storageEngine.js`**: This is not just `localStorage.setItem()`. It's a versioned, corruption-resistant engine that:
    -   Debounces saves to prevent performance issues.
    -   Keeps rolling backups of the last few valid saves.
    -   Flags corrupted data and can attempt to restore from a backup.
    -   Emits events (`persistence:saved`, `persistence:error`) for observability.
-   **`versioning.js`**: Manages state schema migrations. If the application code is updated with a new state schema, this module runs registered migration functions to bring the old, persisted state up to date without data loss.

### 2.4. Page System (`/pages`)

Pages are **real, dynamic entities**, not hardcoded placeholders. They are stored as records in the state store and managed by a dedicated system.

-   **`pageTypes.js`**: Defines the canonical `PageRecord` shape and provides a `createPage()` factory to ensure all pages are created with a valid, consistent structure.
-   **`pageManager.js`**: A runtime module that provides the public API for all page operations (`addPage`, `removePage`, `setActivePage`, etc.). It validates inputs and dispatches the appropriate actions to the store.

### 2.5. Error Boundary & Diagnostics (`/diagnostics`)

**Zero silent failures** is a core principle. The diagnostics system ensures that if something breaks, it is immediately obvious why.

-   **`errorBoundary.js`**: Installs global handlers (`window.onerror`, `unhandledrejection`) to catch all uncaught exceptions. It provides a central `capture(error)` method for modules to report errors. For critical errors, it displays a full-screen overlay with stack trace information.
-   **`logger.js`**: A structured, leveled logging system. All modules log through this service, which allows for consistent formatting, level filtering, and easy transport swapping (e.g., from `console` to a remote logging service).

### 2.6. Live Editor Shell (`/ui`)

The editor UI is **100% state-driven**. It is a reflection of the current state in the store; it never manipulates the DOM directly or maintains its own internal state.

-   **`editorShell.js`**: The top-level UI module. It subscribes to the store and re-renders its child panels (`toolbar`, `sidebar`, `canvas`) when relevant state slices change.
-   **Panels & Controls**: Each piece of the UI is a small module that takes state as input and renders HTML. User interactions (clicks, changes) are handled by dispatching actions to the store, which triggers a new render cycle. This creates a predictable, one-way data flow.

## 3. Boot Sequence (`main.js`)

The entire application is brought to life in a deterministic boot sequence defined in `main.js`. This script is the only entry point in `index.html`.

The sequence is:

1.  **Install Error Boundary**: The global error handlers are attached first, ensuring any error during boot is caught.
2.  **Load State**: The `storageEngine` loads the last-known state from `localStorage`.
3.  **Hydrate Store**: The loaded state is used to hydrate the store, restoring the application to exactly where the user left off.
4.  **Initialize Runtime**: The `coreRuntime` is initialized.
5.  **Register Modules**: All systems (`pageManager`, `editorShell`, etc.) are registered with the runtime.
6.  **Start Runtime**: The runtime calls the `init()` and `start()` methods on each module in the correct dependency order.
7.  **Wire Persistence**: A subscriber is attached to the store to automatically save the state whenever it changes.

This strict sequence ensures that all systems are available and in a valid state before any user interaction can occur.
