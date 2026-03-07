# Nuvra Architecture Proposal

**Prepared for:** stablin09-rgb
**Date:** February 26, 2026
**Author:** Manus AI

## 1. Introduction

This document outlines a comprehensive architectural proposal for **Nuvra**, an AI-powered website and web application builder. The primary objective is to evolve Nuvra from its current state as a frontend-only GrapesJS editor into a scalable, extensible, and production-ready platform. 

The proposed architecture prioritizes **modularity, originality, and long-term extensibility**, ensuring Nuvra can grow to support not just static websites, but also complex web applications, dashboards, and internal tools, without being a derivative of existing platforms.

Following a thorough analysis of the existing repository, the codebase has been refactored from a single `index.html` file into a clean, modular JavaScript project. This new structure serves as the foundation for the architecture detailed below.

---

## 2. Core Frontend Architecture

The initial refactoring has established a decoupled and maintainable frontend structure. This separation of concerns is critical for stability and for enabling parallel development of different features.

### 2.1. Directory Structure

The new `src/` directory organizes the application logically:

| Directory          | Purpose                                                                                             |
|--------------------|-----------------------------------------------------------------------------------------------------|
| `/src/core/`       | Contains the main application logic: `app.js` (entry point), `pageManager.js`, `storage.js`, etc.     |
| `/src/ai/`         | Houses the pluggable AI engine (`aiEngine.js`) and its configuration UI (`aiSettings.js`).          |
| `/src/blocks/`     | Defines the library of all drag-and-drop components (`blockLibrary.js`).                              |
| `/src/ui/`         | Manages the user interface, including the main stylesheet (`styles.css`) and UI components.         |
| `/src/utils/`      | Provides pure, reusable utility functions like modals, toasts, and debouncing (`helpers.js`).         |
| `index.html`       | The main HTML shell, now clean and serving only as the application container.                         |

### 2.2. Key Modules

- **`app.js` (Entry Point):** Initializes all modules in the correct order, wires up event listeners, and orchestrates the application startup.
- **`pageManager.js`:** A stateful module that encapsulates all logic for creating, deleting, renaming, and switching between pages. It acts as the single source of truth for the page structure, keeping the GrapesJS editor and the UI in sync.
- **`storage.js`:** Abstracts all interactions with `localStorage`. This module can be easily replaced with a backend API for cloud storage without requiring changes to other parts of the application.
- **`exportImport.js`:** Handles all project serialization and file download/upload logic, cleanly separating it from the core application state.

---

## 3. AI Generation Layer

To move beyond mock generation, a **pluggable, provider-agnostic AI engine** has been implemented in `src/ai/aiEngine.js`. This design ensures Nuvra is not locked into a single LLM provider and can adapt to new models or even local on-device models in the future.

### 3.1. Provider-Based Architecture

The engine uses a simple class-based system where each AI provider (e.g., OpenAI, Anthropic, Mock) extends a `BaseProvider` class. This class enforces a contract, requiring each provider to implement a `generate()` method.

```javascript
// Conceptual Diagram from aiEngine.js

class BaseProvider {
  async generate(prompt, options) { /* ... */ }
}

class OpenAIProvider extends BaseProvider { /* ... */ }
class AnthropicProvider extends BaseProvider { /* ... */ }
class MockProvider extends BaseProvider { /* ... */ }
```

The active provider is selected based on user configuration, which is managed by the `aiSettings.js` module and stored in `localStorage`.

### 3.2. Standardized Generation Flow

1.  **User Input:** The user enters a prompt in the top bar.
2.  **System Prompt Construction:** A detailed system prompt is constructed in `_buildSystemPrompt()`. This is the **central point for quality tuning**. It instructs the LLM to act as an expert web developer and to return a response in a specific JSON format: `{ name, html, css }`.
3.  **API Call:** The active provider sends the request to the corresponding LLM API.
4.  **JSON Parsing:** The response is parsed and validated. The system is resilient to common LLM formatting errors, such as wrapping JSON in markdown code fences.
5.  **Page Creation:** The validated `html` and `css` are passed to the `pageManager` to create and display the new page.

This abstracted flow makes the rest of the application entirely unaware of which LLM is being used.

---

## 4. Component & Application Architecture

Generating truly dynamic web apps requires moving beyond static HTML components. We need a system for defining components with **data schemas, properties, and actions**.

### 4.1. Proposed Component Schema

We will introduce a **JSON-based schema** for defining Nuvra components. This schema will describe not just the component’s appearance but also its data requirements and behavior.

**Example Schema for a "User Profile Card" Component:**

```json
{
  "id": "user-profile-card",
  "name": "User Profile Card",
  "category": "Application",
  "template": "<div class=\"user-card\"><img src=\"{{avatar}}\"><h3>{{name}}</h3><p>{{email}}</p></div>",
  "styles": ".user-card { padding: 20px; border: 1px solid #ddd; } ...",
  "dataSchema": {
    "name": { "type": "string", "default": "John Doe" },
    "email": { "type": "string", "default": "john.doe@example.com" },
    "avatar": { "type": "image", "default": "https://i.pravatar.cc/150" }
  },
  "actions": {
    "onClick": { "description": "Triggered when the card is clicked" }
  }
}
```

### 4.2. Data Binding and App Generation

With this schema, Nuvra can generate full applications:

1.  **AI Understands Components:** When a user prompts, "Build a team directory page," the AI will be instructed to use the `user-profile-card` component.
2.  **Data Model Generation:** The AI will generate a JSON array of data that matches the `dataSchema` of the components it uses.
3.  **Dynamic Rendering:** The Nuvra frontend will loop through the data array and render a `user-profile-card` for each entry, injecting the data into the template. GrapesJS can be extended to support this form of template-based, data-bound rendering.

This approach is the key to generating **CRUD tools, dashboards, and listings**. For a CRUD interface, the AI would generate a page with a "User Form" component and a "User Table" component, both bound to the same underlying data model.

---

## 5. Hosting & Publishing Architecture

To provide a scalable and cost-effective hosting solution, a **serverless architecture** is recommended. This avoids the need to manage traditional servers and scales automatically with user traffic.

### 5.1. Proposed Infrastructure (using AWS as an example)

- **Amazon S3 (Simple Storage Service):** User websites will be stored as static files (HTML, CSS, JS, images) in S3 buckets. Each user or site gets a dedicated bucket or a prefixed path.
- **Amazon CloudFront:** A global Content Delivery Network (CDN) will sit in front of S3. This provides fast load times for users worldwide and handles SSL/TLS for custom domains.
- **AWS Lambda:** Serverless functions will handle the publishing process. When a user clicks "Publish," a Lambda function is triggered to:
    1.  Retrieve the project JSON.
    2.  Generate the final, production-ready HTML/CSS/JS files.
    3.  Sync these files to the correct S3 bucket.
    4.  (Optional) Invalidate the CloudFront cache to ensure changes go live immediately.
- **Amazon Route 53:** Manages DNS for custom domains, pointing them to the CloudFront distribution.

### 5.2. Publishing Flow

1.  **User Clicks Publish:** A request is sent to a secure backend API (e.g., on AWS API Gateway).
2.  **Lambda Trigger:** The API Gateway triggers the "Publish" Lambda function.
3.  **Build & Deploy:** The Lambda function builds the site from the project data and deploys it to S3.
4.  **Live:** The site is instantly available globally via the CloudFront CDN.

This architecture is **highly scalable, secure, and pay-as-you-go**, making it ideal for a service like Nuvra.

---

## 6. Conclusion & Next Steps

The refactored codebase provides a solid foundation for building Nuvra. The proposed architecture for the AI engine, component schemas, and hosting will enable Nuvra to become a powerful and unique tool for building both websites and web applications.

**Immediate Next Steps:**

1.  **Review and Merge:** Review the refactored code and merge it.
2.  **Component Schema Implementation:** Begin implementing the proposed component schema system and extend GrapesJS to support it.
3.  **Backend API Scaffolding:** Start building the basic backend services for user accounts and the publishing pipeline.

By following this roadmap, Nuvra can achieve its goal of becoming a versatile, extensible, and original AI-powered builder, staying true to its unique vision.
