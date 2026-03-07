# Nuvra Phase 5–5B: AI-Native Generation Engine

## Architecture Document

**Author:** Manus AI  
**Phase:** 5 — AI-Native Generation Engine  
**Build date:** 2026-03-01  
**Cumulative JS files:** 76  
**Test suite:** 41 tests, 0 failures

---

## Overview

Phase 5 replaces the single-provider `aiAdapter` from Phase 2 with a production-grade, provider-agnostic AI generation engine. The central architectural principle is that **AI is a planner, not a builder**. The AI never writes HTML, CSS, or JavaScript. It produces structured JSON schemas that the deterministic Phase 3 and Phase 4 systems then render, execute, and publish.

Every generation run is governed by three constraints that operate in parallel: a **budget engine** that enforces token and cost limits, a **security scanner** that blocks unsafe prompts and schemas, and a **generation ledger** that records every AI decision for human review. No AI output enters the system without passing all three.

---

## The Three-Step Pipeline

The pipeline is mandatory and sequential. A generation run cannot skip or reorder steps. Each step produces a typed, validated schema that is the sole input to the next step.

```
User Prompt
    │
    ▼  [Security Scan]
┌─────────────────────────┐
│  Step 1: Intent         │  intentExtractor.js
│  Extraction             │
│  Prompt → IntentSchema  │
└────────────┬────────────┘
             │  IntentSchema (validated)
             ▼  [Budget Check]
┌─────────────────────────┐
│  Step 2: System         │  systemPlanner.js
│  Planning               │
│  IntentSchema →         │
│  SystemPlan             │
└────────────┬────────────┘
             │  SystemPlan (validated)
             ▼  [Budget Check]
┌─────────────────────────┐
│  Step 3: Schema         │  schemaAssembler.js
│  Assembly               │
│  SystemPlan →           │
│  AppSchema              │
└────────────┬────────────┘
             │  AppSchema (validated)
             ▼  [Security Scan]
         AppSchema
```

### Step 1: Intent Extraction

The `intentExtractor.js` module sends the user's raw prompt to the active AI provider with a strict system prompt that instructs the model to return a single JSON object conforming to the `IntentSchema` type. The system prompt is deterministic — it does not vary between runs for the same input.

The `IntentSchema` captures the following fields:

| Field | Type | Description |
|---|---|---|
| `goal` | `string` | A one-sentence description of the desired output |
| `outputType` | `'site' \| 'app' \| 'hybrid'` | Whether the output is a marketing site, a web app, or both |
| `industry` | `string` | The industry or domain (e.g., `saas`, `ecommerce`, `healthcare`) |
| `brandTone` | `string` | The desired tone (e.g., `professional`, `playful`, `minimal`) |
| `complexity` | `'simple' \| 'medium' \| 'complex'` | The expected complexity of the output |
| `targetAudience` | `string` | Who the output is for |
| `dataRequirements` | `string[]` | The named entities the app needs to store (e.g., `['task', 'user']`) |
| `featureSet` | `string[]` | The features required (e.g., `['crud', 'dashboard', 'auth']`) |
| `pageHints` | `string[]` | Suggested page names |
| `assumptions` | `string[]` | Assumptions the model made when the prompt was ambiguous |
| `confidence` | `number` | The model's confidence in its interpretation (0–1) |

If the AI returns an invalid `IntentSchema`, the `schemaRepairLoop` attempts up to three auto-repairs before failing the run.

### Step 2: System Planning

The `systemPlanner.js` module takes the validated `IntentSchema` and produces a `SystemPlan`. This step uses a more detailed system prompt that includes the full `IntentSchema` as context. The AI is instructed to plan the complete system architecture: pages, data collections, actions, state flows, and permissions.

The `SystemPlan` is the most complex schema in the pipeline. It contains:

- **Pages** — each with a `mode` (`marketing`, `app`, or `hybrid`), a `purpose`, a `reason`, and a list of `sections`
- **Collections** — each with a list of typed `fields` and a `reason` for its existence
- **Actions** — each with a `trigger`, a list of `steps`, and a `reason`
- **State flows** — global and page-scoped state variables with their types and purposes
- **Permissions** — the access control model for the entire app
- **Decisions** — a list of architectural decisions, each with a `category`, a `decision`, and a `reason`

The `decisions` array is the primary input to the `generationLedger`. Every decision the AI makes is recorded and made available for human review.

### Step 3: Schema Assembly

The `schemaAssembler.js` module is **deterministic**. It takes the validated `SystemPlan` and `IntentSchema` and assembles the final `AppSchema` without making any AI calls. This step is pure computation: it maps the plan's pages, collections, and actions into the canonical `AppSchema` format defined in Phase 3.

Because this step is deterministic, the same `SystemPlan` always produces the same `AppSchema`. This is critical for debugging: if the output is wrong, the problem is in the plan, not in the assembly.

---

## Provider-Agnostic Layer

The provider layer consists of four files:

| File | Role |
|---|---|
| `providerContract.js` | The interface every provider must implement |
| `openAIProvider.js` | OpenAI GPT-4o and GPT-4o-mini adapter |
| `anthropicProvider.js` | Anthropic Claude 3.5 Sonnet and Haiku adapter |
| `ollamaProvider.js` | Local Ollama / LM Studio adapter (zero API cost) |
| `providerRegistry.js` | Central registry with active/fallback selection |

Every provider implements the same `call(request)` method, which returns a `ProviderResponse` with the fields `ok`, `data`, `raw`, `usage`, `latencyMs`, and `model`. The pipeline never calls a provider directly — it always calls `providerRegistry.getActive().call(request)`. This means the provider can be swapped at any time without changing any pipeline code.

### Fallback Behaviour

When the active provider fails (network error, rate limit, or invalid response), the registry automatically tries the fallback provider. If both fail, the run fails with a structured error that includes the failure reason from both providers. The fallback event is emitted on the event bus so the UI can inform the user.

### Adding a New Provider

To add a new AI provider, create a file in `src/ai/providers/` that exports a class implementing the `ProviderContract` interface, then register it in `main.js`:

```js
import { MyProvider } from './ai/providers/myProvider.js';
providerRegistry.register(new MyProvider({ apiKey }));
```

No other changes are required.

---

## Budget & Cost Governance

The `budgetEngine.js` module enforces two types of limits:

| Limit Type | Behaviour |
|---|---|
| `HARD` | Blocks the AI call entirely. The run fails with a budget error. |
| `SOFT` | Allows the call but emits a warning event. The UI shows a warning toast. |

Limits are configured at two scopes:

- **Operation scope** — applied to each individual AI call (token count, cost)
- **Session scope** — applied to the cumulative totals for the current browser session (total tokens, total cost, total call count)

The default configuration is:

```
Operation:  8,000 tokens (HARD), $0.10/call (SOFT)
Session:    200,000 tokens (SOFT), $5.00 total (HARD), 100 calls (SOFT)
```

Every AI call is recorded in the budget engine's history. The `getSessionSummary()` method returns the current session totals, which are stored in the `aiGeneration.budgetSummary` state slice and displayed in the generation UI.

---

## Schema Validation & Repair Loop

The `schemaRepairLoop.js` module runs after every AI response. It performs two passes:

**Pass 1 — Structural validation.** Checks that all required fields are present, all enum values are valid, and all arrays are arrays. Errors are classified into three categories:

| Error Class | Description | Auto-Repairable? |
|---|---|---|
| `missing_field` | A required field is absent | Sometimes (if a default exists) |
| `invalid_enum` | A field value is not in the allowed set | Sometimes (if a close match exists) |
| `wrong_type` | A field has the wrong type | Often (e.g., `null` → `[]`) |
| `invalid_structure` | The overall shape is wrong | No — requires re-prompt |

**Pass 2 — Auto-repair.** For errors marked `canAutoRepair`, the loop applies a deterministic fix (e.g., sets a `null` array to `[]`, or coerces a string enum to lowercase). If all errors are repaired, the schema is accepted. If any non-repairable errors remain, the loop sends a repair prompt to the AI with the specific errors listed. This is attempted up to three times before the run fails.

---

## Explainability & Human-in-the-Loop

The `generationLedger.js` module records every decision the AI makes during a generation run. A decision has the following shape:

```json
{
  "id": "dec_abc123",
  "category": "data_model",
  "field": "collections[0].name",
  "value": "Tasks",
  "reason": "The user mentioned task management as the primary goal",
  "status": "ai_proposed"
}
```

The `status` field transitions through the following states based on user interaction:

```
ai_proposed → user_accepted
            → user_modified  (user changed the value)
            → user_rejected  (user disagrees)
            → user_locked    (user locks this decision for future re-plans)
```

These transitions are triggered by events on the event bus:

| Event | Payload | Effect |
|---|---|---|
| `ai:accept_decision` | `{ runId, decisionId }` | Marks decision as `user_accepted` |
| `ai:modify_decision` | `{ runId, decisionId, newValue, userReason }` | Updates value, marks as `user_modified` |
| `ai:reject_decision` | `{ runId, decisionId, feedback }` | Marks as `user_rejected`, stores feedback |
| `ai:lock_decision` | `{ runId, decisionId }` | Marks as `user_locked`, preserved across re-plans |

When a re-plan is triggered, the `aiGenerationEngine` queries the ledger for locked decisions and includes them as hard constraints in the system prompt for Step 2. This ensures that user edits survive regeneration.

---

## Security & Safety

The `securityScanner.js` module runs deterministically — it makes no AI calls. It operates at two points in the pipeline:

**Pre-generation (prompt scan):** Before the prompt is sent to any AI provider, it is scanned for prompt injection patterns, harmful content requests, and PII. High-severity threats block the generation entirely. Medium-severity threats (e.g., an email address in the prompt) emit a warning but allow the sanitized prompt to proceed.

**Post-generation (schema scan):** After the `AppSchema` is assembled, it is scanned for dangerous patterns: `eval()` calls, `new Function()` calls, `<script>` tags, `javascript:` URLs, inline event handlers, and external `fetch()` calls. Any critical threat blocks the schema from being stored in the state.

The scanner maintains a scan log that is accessible via `securityScanner.getScanLog()` and `securityScanner.getStats()`. These are intended for developer debugging and future audit reporting.

---

## Failure Cases

The following table documents all known failure modes and their handling:

| Failure | Where It Occurs | Handling |
|---|---|---|
| AI provider network error | Steps 1, 2 | Retry with fallback provider; fail run if both fail |
| AI returns non-JSON response | Steps 1, 2 | `schemaRepairLoop` attempts to extract JSON from the response; fails if extraction fails |
| AI returns invalid schema | Steps 1, 2 | `schemaRepairLoop` attempts up to 3 auto-repairs and re-prompts |
| Budget hard limit exceeded | Before Steps 1, 2 | AI call is blocked; run fails with budget error; user is notified |
| Prompt injection detected | Before Step 1 | Generation is blocked; user is shown the threat description |
| Schema security scan fails | After Step 3 | Schema is discarded; user is notified; run fails |
| Step 3 assembly error | Step 3 | Run fails with structured error; no partial schema is stored |
| Re-plan with locked decisions | Steps 1–3 | Locked decisions are included as hard constraints in the planning prompt |

---

## State Shape (Phase 5 additions)

Phase 5 adds one new state slice: `aiGeneration`.

```js
aiGeneration: {
  generationStage:  'idle',    // 'idle' | 'extracting' | 'planning' | 'assembling' | 'validating' | 'complete' | 'failed'
  generationRunId:  null,      // string | null
  generationError:  null,      // string | null
  intent:           null,      // IntentSchema | null
  plan:             null,      // SystemPlan | null
  generatedSchema:  null,      // AppSchema | null
  activeProviderId: 'openai',  // string
  budgetSummary:    null,      // BudgetSummary | null
  securityThreats:  [],        // Threat[]
}
```

The existing `ai` state slice (from Phase 2) is preserved for backward compatibility.

---

## Event Bus API (Phase 5)

Phase 5 adds the following events to the event bus:

| Event | Direction | Payload | Description |
|---|---|---|---|
| `ai:generate` | → engine | `{ prompt, options }` | Trigger a full generation run |
| `ai:regenerate` | → engine | `{ schema, target, targetId, instruction }` | Regenerate a specific part of an existing schema |
| `ai:generation:complete` | engine → | `{ schema, runId }` | Generation run completed successfully |
| `ai:accept_decision` | → ledger | `{ runId, decisionId }` | Accept an AI decision |
| `ai:modify_decision` | → ledger | `{ runId, decisionId, newValue, userReason }` | Modify an AI decision |
| `ai:reject_decision` | → ledger | `{ runId, decisionId, feedback }` | Reject an AI decision |
| `ai:lock_decision` | → ledger | `{ runId, decisionId }` | Lock a decision against re-planning |
| `ai:reset_budget` | → engine | `{}` | Reset the session budget counters |
| `ai:set_provider` | → engine | `{ providerId }` | Switch the active AI provider |

---

## Known Limitations

**No streaming.** All AI calls are blocking request/response. Streaming output would require significant changes to the pipeline architecture and is deferred to a future phase.

**No multi-turn conversation.** Each generation run is independent. The pipeline does not maintain a conversation history between runs. The `generationLedger` provides a form of memory for locked decisions, but this is not the same as conversational context.

**Ollama provider requires local setup.** The `ollamaProvider.js` assumes Ollama is running at `http://localhost:11434`. No auto-detection or setup wizard is included in this phase.

**No streaming repair.** The `schemaRepairLoop` sends a complete repair prompt for each attempt. For large schemas, this can be expensive. A future optimisation would send only the failing fields.

---

## File Index

| File | Lines | Purpose |
|---|---|---|
| `src/ai/providers/providerContract.js` | ~60 | Interface definition and validation |
| `src/ai/providers/openAIProvider.js` | ~140 | OpenAI GPT-4o adapter |
| `src/ai/providers/anthropicProvider.js` | ~130 | Anthropic Claude adapter |
| `src/ai/providers/ollamaProvider.js` | ~110 | Local Ollama adapter |
| `src/ai/providers/providerRegistry.js` | ~120 | Provider registry with fallback |
| `src/ai/budget/budgetEngine.js` | ~200 | Token/cost governance engine |
| `src/ai/pipeline/intentExtractor.js` | ~180 | Step 1: Intent extraction |
| `src/ai/pipeline/systemPlanner.js` | ~220 | Step 2: System planning |
| `src/ai/pipeline/schemaAssembler.js` | ~260 | Step 3: Schema assembly (deterministic) |
| `src/ai/repair/schemaRepairLoop.js` | ~280 | Validation and auto-repair |
| `src/ai/generation/aiGenerationEngine.js` | ~300 | Top-level orchestrator |
| `src/ai/explainability/generationLedger.js` | ~240 | Decision recording and HITL |
| `src/ai/security/securityScanner.js` | ~220 | Prompt and schema security scanning |
| `src/state/reducers.js` | +60 | `aiGenerationReducer` added |
| `src/main.js` | ~260 | Phase 5 boot wiring |
| `tests/phase5.test.js` | ~400 | 41-test validation suite |
