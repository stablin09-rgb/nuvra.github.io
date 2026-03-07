---

*This document is best viewed in a Markdown renderer that supports tables.*

---

# Nuvra Phase 10: Marketplace & Extensibility Platform

- **Author**: Manus AI
- **Date**: March 01, 2026
- **Status**: Complete

## 1. Overview

Phase 10 transforms Nuvra from a closed application into an open, extensible platform. It introduces a full-featured extension system with a local-first marketplace, enabling third-party developers to add new functionality. This is the most architecturally significant phase to date, laying the groundwork for a vibrant ecosystem.

The core of this phase is a **security-first extension runtime**. All extensions execute in a sandboxed `<iframe>`, communicating with the main application via a permission-gated `postMessage` bridge. This prevents extensions from accessing sensitive data or disrupting the core application, ensuring stability and user trust.

Four types of extensions are supported, each with a dedicated API surface:

1.  **Templates**: Pre-built projects that users can install with one click.
2.  **Blocks**: Custom GrapesJS components that appear in the "Blocks" panel.
3.  **Integrations**: Connect Nuvra to external services (e.g., Mailchimp, Google Analytics).
4.  **AI Packs**: Custom planners and context extenders that make the AI engine domain-aware.

## 2. System Architecture

The extension system is composed of several key modules that work in concert to provide a secure and robust platform.

| Module | Responsibility |
| :--- | :--- |
| **`extensionHost.js`** | The central orchestrator. Manages all active sandboxes, routes messages, and exposes the scoped APIs. |
| **`sandbox.js`** | Creates and manages the `<iframe>` sandboxes. Handles the low-level `postMessage` communication. |
| **`permissions.js`** | Defines the permission model and provides functions for requesting and checking permissions. |
| **`extensionRegistry.js`** | Manages the state of all installed extensions for the current project. |
| **`extensionLoader.js`** | Handles the full extension lifecycle: install, enable, disable, update, and remove. |
| **`marketplaceManager.js`** | The data and logic layer for the marketplace. Fetches the catalog, manages installation state, and handles entitlement checks. |
| **`marketplaceUI.js`** | The UI controller for the marketplace panel. Renders the catalog and handles user interactions. |
| **Scoped APIs** | A set of modules (`editorApi.js`, `dataApi.js`, `aiApi.js`) that provide a safe, permission-gated interface for extensions to interact with the core application. |

### 2.1. Execution Flow: Extension Installation

1.  User clicks "Install" in the Marketplace UI.
2.  `marketplaceManager.js` checks if the user's plan allows the installation.
3.  `extensionLoader.js` fetches the extension manifest and code from the `catalog.json`.
4.  `permissions.js` prompts the user to approve the permissions requested in the manifest.
5.  If approved, `extensionLoader.js` saves the extension code to `localStorage` (scoped by project ID).
6.  `extensionRegistry.js` adds the extension to the list of installed extensions for the project.
7.  `extensionHost.js` is notified, creates a new sandbox, and loads the extension's code.

### 2.2. Execution Flow: Extension Activation

When a project is opened, `app.js` calls `extensionHost.activateProject()`.

1.  `extensionHost.js` retrieves the list of installed extensions for the project from `extensionRegistry.js`.
2.  For each enabled extension, it creates a new `Sandbox` instance.
3.  The sandbox loads the extension's code from `localStorage` into a hidden `<iframe>`.
4.  The extension code calls `nuvra.ready()` to signal it has loaded.
5.  The sandbox sends a `ready` message to the `extensionHost`.
6.  The `extensionHost` then calls the extension's `onActivate()` lifecycle hook, passing the scoped APIs.

## 3. Security Model: Sandboxing and Permissions

Security is the paramount concern. The entire system is designed around the principle of least privilege.

> All third-party code is treated as untrusted and is executed within a restrictive `<iframe>` sandbox. The `sandbox` attribute of the iframe is configured to prevent top-level navigation, popups, and other potentially malicious activities.

Communication between the extension and the main app is strictly mediated by the `extensionHost` via `postMessage`. Extensions cannot directly access the DOM, `window` object, or any other part of the Nuvra application.

### 3.1. Permission System

Before an extension can be installed, it must declare the permissions it requires in its manifest. The user is shown a clear, human-readable list of these permissions and must grant consent.

| Permission | Description | Grants Access To |
| :--- | :--- | :--- |
| `editor:read` | Read the structure and content of the current page. | `editorApi.getHtml()`, `editorApi.getCss()` |
| `editor:write` | Modify the content of the current page. | `editorApi.setHtml()`, `editorApi.addBlock()` |
| `data:read` | Read data from the project's data collections. | `dataApi.query()` |
| `data:write` | Insert, update, or delete data in the project's collections. | `dataApi.insert()`, `dataApi.update()` |
| `ai:extend` | Extend the AI's knowledge with custom context. | `aiApi.addPromptExtender()` |
| `ai:plan` | Provide a custom planner for AI generation. | `aiApi.registerPlanner()` |
| `events:subscribe` | Subscribe to application events (e.g., `project.saved`). | `eventsApi.on()` |
| `network:fetch` | Make network requests to specified domains. | `fetch()` within the sandbox |

## 4. Extension Types and APIs

Each extension type has a specific purpose and a corresponding set of APIs and lifecycle hooks.

### 4.1. Block Packs

-   **Purpose**: Add new components to the GrapesJS editor.
-   **Lifecycle**: `onActivate()`
-   **API**: `editorApi.registerBlock(name, definition)`
-   **Example**: A "Testimonial Carousel" block pack would register a new block with its HTML, CSS, and JavaScript.

### 4.2. Template Packs

-   **Purpose**: Provide pre-built projects.
-   **Lifecycle**: `onInstall()`
-   **API**: `marketplaceApi.registerTemplate(definition)`
-   **Example**: A "SaaS Landing Page" template would register a project JSON file that can be installed as a new project.

### 4.3. Integration Packs

-   **Purpose**: Connect to third-party services.
-   **Lifecycle**: `onActivate()`, `onDeactivate()`
-   **API**: `eventsApi`, `dataApi`, `network` permission
-   **Example**: A "Mailchimp Integration" could listen for `form.submitted` events and send the data to a Mailchimp mailing list.

### 4.4. AI Packs

-   **Purpose**: Make the AI engine domain-aware.
-   **Lifecycle**: `onActivate()`
-   **API**: `aiApi.addPromptExtender()`, `aiApi.registerPlanner()`
-   **Example**: A "Real Estate AI Pack" could register a planner that uses a specialized system prompt for generating property listings and add a prompt extender that injects local market data.

## 5. Marketplace

The Marketplace is the user-facing entry point to the extension ecosystem. In Phase 10, it is a local-first catalog defined in `catalog.json`. This allows for a curated set of extensions to be available immediately without requiring a backend.

The UI (`marketplaceUI.js`) provides:

-   A searchable, filterable list of all available extensions.
-   Detailed information for each extension (description, author, permissions, plan requirements).
-   One-click installation, removal, and enabling/disabling of extensions.
-   A clear distinction between installed and available extensions.

## 6. Conclusion

Phase 10 establishes a powerful, secure, and scalable foundation for extensibility in Nuvra. By prioritizing security through sandboxing and a granular permission model, it creates a safe environment for users to enhance the builder's capabilities. The four distinct extension types provide clear entry points for developers to contribute meaningful value, from simple UI components to sophisticated AI enhancements. This phase marks a pivotal transition for Nuvra, opening the door to a future of community-driven innovation.

