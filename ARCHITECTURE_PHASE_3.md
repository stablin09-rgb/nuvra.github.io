# Nuvra Phase 3: Application Runtime Core

**Author:** Manus AI
**Date:** 2026-03-01

## 1. Overview

Phase 3 introduces the **Application Runtime Core**, a schema-driven engine for building and running full-stack, data-driven applications within the Nuvra platform. This is the heart of Nuvra's "no-code" app building capabilities. It transforms a declarative `AppSchema` into a live, interactive application without requiring the user to write a single line of JavaScript.

The core principle is **schema-first, runtime-second**. The `AppSchema` is the single source of truth. The runtime is a pure, deterministic projection of that schema, combined with user data and state. The DOM, in turn, is a pure projection of the runtime's state. This creates a predictable, debuggable, and highly extensible system.

## 2. Key Systems

The Application Runtime is composed of five major, interconnected systems:

| System | Files | Responsibility |
|---|---|---|
| **App Runtime** | `appRuntime.js`, `appContext.js`, `appEventBus.js`, `appRenderer.js` | Boots, runs, and tears down app instances. Manages the app lifecycle and orchestrates all other systems. |
| **State Engine** | `appStateEngine.js` | Manages all four scopes of state: global, page, component, and derived. Provides reactive, observable state management. |
| **Data Engine** | `dataEngine.js`, `fieldTypes.js` | Manages data collections, enforces schema validation, and handles relationships. A local-first, in-memory database. |
| **Action Engine** | `actionDispatcher.js`, `actionTypes.js` | Executes declarative action chains. The only way to mutate state or data. Provides a secure, auditable logic layer. |
| **Component Library** | `appComponentRegistry.js`, `formComponent.js`, `tableComponent.js`, etc. | A library of schema-bound, reactive UI components that render the application's user interface. |

### 2.1. The App Runtime (`appRuntime.js`)

The `AppRuntime` is the orchestrator. When an "app" page is loaded in the editor or in a published site, the foundation's `main.js` boots an instance of the `AppRuntime`, passing it the `AppSchema` and a DOM element to mount into.

The runtime's boot sequence is:
1.  Create an `AppContext` to hold all shared systems (state, data, actions).
2.  Instantiate the `AppEventBus` for sandboxed, app-internal communication.
3.  Boot the `StateEngine` from the `state` section of the schema.
4.  Boot the `DataEngine` from the `collections` section of the schema.
5.  Boot the `ActionDispatcher` from the `actions` section of the schema.
6.  Instantiate the `AppRenderer` to render the UI.
7.  The `AppRenderer` renders the initial page, which in turn renders its components.

### 2.2. State Management (`appStateEngine.js`)

State is never implicit. All state is declared in the `AppSchema` and managed by the `AppStateEngine`. It supports four scopes:

-   **Global State**: Persists across page navigations. Ideal for user authentication, session data, or app-wide settings.
-   **Page State**: Scoped to the current page. Automatically reset when the user navigates away. Useful for page-specific filters or UI state.
-   **Component State**: (Future) Local, ephemeral state for a single component instance.
-   **Derived State**: Read-only values computed from other state or data (e.g., `totalRevenue` from a `sum` of orders). These are automatically memoized and re-calculated only when their dependencies change.

### 2.3. Data Collections (`dataEngine.js`)

The `DataEngine` is a local-first, in-memory database. It is not a replacement for a backend like Supabase, but rather a portable data abstraction layer that *can* be synced with one.

Key features:
-   **Schema-driven**: Collections and fields are defined in the `AppSchema`.
-   **Typed Fields**: A rich set of field types (`text`, `number`, `date`, `relation`, etc.) are enforced via `fieldTypes.js`.
-   **Validation**: Every write (insert/update) is validated against the schema's rules.
-   **Relationships**: (Future) The schema supports defining relationships, but enforcement is not yet implemented.
-   **Observable**: Emits events on the `AppEventBus` for every change, enabling reactive UI updates.

### 2.4. Actions & Logic (`actionDispatcher.js`)

All mutations in a Nuvra app happen through **Actions**. An Action is a declarative sequence of **Steps** defined in the `AppSchema`. There is no inline JavaScript or `eval()`.

This design provides:
-   **Security**: Logic is sandboxed and cannot perform arbitrary operations.
-   **Auditability**: Every action dispatch is logged and can be replayed.
-   **Clarity**: The app's logic is explicitly defined in the schema, not hidden in code.

Steps include operations for data (`data.insert`), state (`state.set`), navigation (`navigate`), and control flow (`condition`).

### 2.5. Components (`/components/*.js`)

Components are the building blocks of the UI. They are simple, schema-driven rendering functions that:
-   Receive `props` from the `AppRenderer`.
-   Read data and state from the `AppContext`.
-   Dispatch actions in response to user events (e.g., a button click).
-   Do **not** own their own state.

Phase 3 includes a core library of essential components: `Form`, `Table`, `List`, `Filter`, `StatCard`, `Text`, and `Button`.

## 3. Data Flow: The Reactive Loop

The entire system is built on a unidirectional data flow, ensuring predictability and preventing complex debugging scenarios.

1.  **User Interaction**: A user clicks a button in a `ButtonComponent`.
2.  **Action Dispatch**: The component dispatches a named action (e.g., `'createTask'`) with a payload (e.g., form data) to the `ActionDispatcher` via the `AppContext`.
3.  **Logic Execution**: The `ActionDispatcher` executes the steps defined in the `'createTask'` `ActionSchema`.
4.  **Mutation**: A step in the action calls the `DataEngine` to insert a new record.
5.  **Event Emission**: The `DataEngine` validates the data, inserts the record, and emits a `data:changed:tasks` event on the `AppEventBus`.
6.  **Reactive Re-render**: A `TableComponent`, subscribed to that event, receives the notification and re-queries the `DataEngine` for the new list of tasks.
7.  **DOM Update**: The `TableComponent` re-renders itself with the new data, updating the DOM.

The user sees the new task appear in the table instantly. The flow is always the same: **Event → Action → State/Data → UI**.

## 4. Page Semantics

Not all pages are applications. Phase 3 introduces `pageSemantics.js` to formally distinguish between different page types:

-   **Marketing Pages**: Static content pages (e.g., landing pages, blogs). The App Runtime does not activate for these.
-   **App Pages**: Dynamic, stateful pages (e.g., dashboards, CRMs). The App Runtime activates.
-   **Hybrid Pages**: (Future) Pages with a mix of static content and interactive app components.

This distinction is crucial for performance, security, and determining the correct export pipeline (static HTML vs. a full app bundle).

## 5. Known Limitations & Next Steps

Phase 3 delivers a robust foundation, but is not feature-complete. Key limitations to be addressed in future phases include:

-   **No Backend Sync**: The `DataEngine` is local-only. A sync adapter for a backend like Supabase is a top priority.
-   **Limited Component Library**: The component set is minimal. More advanced components (charts, calendars, Kanban boards) are needed.
-   **No Inter-App Communication**: Apps are fully sandboxed and cannot communicate with each other.
-   **Basic Styling**: Component styling is functional but not deeply customizable without CSS overrides.
-   **No User Roles/Permissions**: The runtime does not yet have a concept of user roles or data access policies.
-   **Hybrid Pages Not Implemented**: The rendering pipeline for hybrid pages is a placeholder.

Phase 4 will likely focus on backend integration, user authentication, and expanding the component library.
