'use strict';

/**
 * aiExtensionLayer.js — Nuvra Phase 8
 *
 * The Composable AI Behavior Layer.
 *
 * Extensions can register:
 * - Prompt Layers:        Prepended to system prompts for specific intent types
 * - Planner Overrides:    Replace or augment the planning graph for specific intent types
 * - Schema Modifiers:     Post-process generated schemas (add sections, enforce patterns)
 * - Output Validators:    Validate AI output before it enters the system
 *
 * All registered behaviors are:
 * - Namespaced by extensionId (cannot collide)
 * - Ordered by priority (lower number = higher priority)
 * - Isolated: a failing modifier/validator does not crash the pipeline
 * - Auditable: every invocation is logged
 *
 * Design principle: Extensions compose AI behavior; they do not replace it.
 * The core pipeline always runs. Extensions add layers on top.
 */

// ─── AIExtensionLayer ─────────────────────────────────────────────────────────

class AIExtensionLayer {
  /**
   * @param {object} [options]
   * @param {object} [options.logger]
   */
  constructor({ logger = null } = {}) {
    this._logger           = logger;
    this._promptLayers     = [];  // { id, extensionId, scope, content, priority }
    this._plannerOverrides = [];  // { id, extensionId, intentTypes, planFn, priority }
    this._schemaModifiers  = [];  // { id, extensionId, priority, modifyFn }
    this._outputValidators = [];  // { id, extensionId, validateFn }
    this._invocationLog    = [];  // Audit log of all invocations
  }

  // ─── Prompt Layers ────────────────────────────────────────────────────────

  /**
   * Registers a prompt layer from an extension.
   * @param {object} layer
   * @param {string}   layer.id          - Unique ID within the extension
   * @param {string}   layer.extensionId - The registering extension's ID
   * @param {string}   layer.scope       - 'all' | intent type (e.g. 'marketing_site')
   * @param {string}   layer.content     - The prompt text to prepend
   * @param {number}   [layer.priority]  - Lower = higher priority (default: 100)
   */
  addPromptLayer(layer) {
    const entry = {
      id:          `${layer.extensionId}:${layer.id}`,
      extensionId: layer.extensionId,
      scope:       layer.scope || 'all',
      content:     layer.content,
      priority:    layer.priority ?? 100,
    };
    this._promptLayers.push(entry);
    this._promptLayers.sort((a, b) => a.priority - b.priority);
    this._log('info', `Prompt layer registered: ${entry.id} (scope: ${entry.scope})`);
  }

  /**
   * Returns all prompt layers applicable to a given intent type.
   * @param {string} intentType
   * @returns {object[]}
   */
  getPromptLayersFor(intentType) {
    return this._promptLayers.filter(l =>
      l.scope === 'all' || l.scope === intentType
    );
  }

  /**
   * Composes the extension prompt layers into a single string for injection.
   * @param {string} intentType
   * @returns {string}
   */
  composePromptLayers(intentType) {
    const layers = this.getPromptLayersFor(intentType);
    if (layers.length === 0) return '';

    const composed = layers
      .map(l => `[Extension: ${l.extensionId}]\n${l.content}`)
      .join('\n\n---\n\n');

    this._logInvocation('prompt_layer', { intentType, layerCount: layers.length });
    return composed;
  }

  // ─── Planner Overrides ────────────────────────────────────────────────────

  /**
   * Registers a planner override from an extension.
   * @param {object} override
   * @param {string}   override.id          - Unique ID within the extension
   * @param {string}   override.extensionId - The registering extension's ID
   * @param {string[]} override.intentTypes - Intent types this override applies to
   * @param {Function} override.planFn      - (intentSchema, defaultPlan) => modifiedPlan
   * @param {number}   [override.priority]  - Lower = higher priority (default: 100)
   */
  addPlannerOverride(override) {
    if (typeof override.planFn !== 'function') {
      this._log('warn', `Planner override "${override.id}" from "${override.extensionId}" has no planFn — skipped`);
      return;
    }
    const entry = {
      id:          `${override.extensionId}:${override.id}`,
      extensionId: override.extensionId,
      intentTypes: override.intentTypes || [],
      planFn:      override.planFn,
      priority:    override.priority ?? 100,
    };
    this._plannerOverrides.push(entry);
    this._plannerOverrides.sort((a, b) => a.priority - b.priority);
    this._log('info', `Planner override registered: ${entry.id} (intents: ${entry.intentTypes.join(', ')})`);
  }

  /**
   * Applies all applicable planner overrides to a plan.
   * @param {string} intentType
   * @param {object} intentSchema
   * @param {object} defaultPlan
   * @returns {object} The modified plan
   */
  applyPlannerOverrides(intentType, intentSchema, defaultPlan) {
    const applicable = this._plannerOverrides.filter(o =>
      o.intentTypes.length === 0 || o.intentTypes.includes(intentType)
    );

    if (applicable.length === 0) return defaultPlan;

    let plan = defaultPlan;
    for (const override of applicable) {
      try {
        const modified = override.planFn(intentSchema, plan);
        if (modified && typeof modified === 'object') {
          plan = modified;
          this._logInvocation('planner_override', { id: override.id, intentType });
        }
      } catch (err) {
        this._log('error', `Planner override "${override.id}" failed: ${err.message}`);
        // Isolation: continue with the current plan
      }
    }

    return plan;
  }

  // ─── Schema Modifiers ─────────────────────────────────────────────────────

  /**
   * Registers a schema modifier from an extension.
   * @param {object} modifier
   * @param {string}   modifier.id          - Unique ID within the extension
   * @param {string}   modifier.extensionId - The registering extension's ID
   * @param {Function} modifier.modifyFn    - (schema) => modifiedSchema
   * @param {number}   [modifier.priority]  - Lower = higher priority (default: 100)
   */
  addSchemaModifier(modifier) {
    if (typeof modifier.modifyFn !== 'function') {
      this._log('warn', `Schema modifier "${modifier.id}" from "${modifier.extensionId}" has no modifyFn — skipped`);
      return;
    }
    const entry = {
      id:          `${modifier.extensionId}:${modifier.id}`,
      extensionId: modifier.extensionId,
      modifyFn:    modifier.modifyFn,
      priority:    modifier.priority ?? 100,
    };
    this._schemaModifiers.push(entry);
    this._schemaModifiers.sort((a, b) => a.priority - b.priority);
    this._log('info', `Schema modifier registered: ${entry.id}`);
  }

  /**
   * Applies all registered schema modifiers to a schema.
   * @param {object} schema
   * @returns {object} The modified schema
   */
  applySchemaModifiers(schema) {
    if (this._schemaModifiers.length === 0) return schema;

    let modified = schema;
    for (const modifier of this._schemaModifiers) {
      try {
        const result = modifier.modifyFn(modified);
        if (result && typeof result === 'object') {
          modified = result;
          this._logInvocation('schema_modifier', { id: modifier.id });
        }
      } catch (err) {
        this._log('error', `Schema modifier "${modifier.id}" failed: ${err.message}`);
        // Isolation: continue with the current schema
      }
    }

    return modified;
  }

  // ─── Output Validators ────────────────────────────────────────────────────

  /**
   * Registers an output validator from an extension.
   * @param {object} validator
   * @param {string}   validator.id          - Unique ID within the extension
   * @param {string}   validator.extensionId - The registering extension's ID
   * @param {Function} validator.validateFn  - (schema) => { valid: boolean, errors: string[] }
   */
  addOutputValidator(validator) {
    if (typeof validator.validateFn !== 'function') {
      this._log('warn', `Output validator "${validator.id}" from "${validator.extensionId}" has no validateFn — skipped`);
      return;
    }
    const entry = {
      id:          `${validator.extensionId}:${validator.id}`,
      extensionId: validator.extensionId,
      validateFn:  validator.validateFn,
    };
    this._outputValidators.push(entry);
    this._log('info', `Output validator registered: ${entry.id}`);
  }

  /**
   * Runs all registered output validators against a schema.
   * @param {object} schema
   * @returns {{ valid: boolean, errors: { validatorId: string, errors: string[] }[] }}
   */
  runOutputValidators(schema) {
    if (this._outputValidators.length === 0) return { valid: true, errors: [] };

    const allErrors = [];
    for (const validator of this._outputValidators) {
      try {
        const result = validator.validateFn(schema);
        if (!result.valid && result.errors?.length > 0) {
          allErrors.push({ validatorId: validator.id, errors: result.errors });
        }
        this._logInvocation('output_validator', { id: validator.id, valid: result.valid });
      } catch (err) {
        this._log('error', `Output validator "${validator.id}" threw: ${err.message}`);
        // Isolation: log the error but don't fail the pipeline
      }
    }

    return { valid: allErrors.length === 0, errors: allErrors };
  }

  // ─── Deregistration ───────────────────────────────────────────────────────

  /**
   * Removes all registered behaviors from a given extension.
   * Called when an extension is deactivated.
   * @param {string} extensionId
   */
  deregisterExtension(extensionId) {
    this._promptLayers     = this._promptLayers.filter(l => l.extensionId !== extensionId);
    this._plannerOverrides = this._plannerOverrides.filter(o => o.extensionId !== extensionId);
    this._schemaModifiers  = this._schemaModifiers.filter(m => m.extensionId !== extensionId);
    this._outputValidators = this._outputValidators.filter(v => v.extensionId !== extensionId);
    this._log('info', `Deregistered all AI behaviors from extension: ${extensionId}`);
  }

  // ─── Introspection ────────────────────────────────────────────────────────

  getRegisteredBehaviors() {
    return {
      promptLayers:     this._promptLayers.map(l => ({ id: l.id, scope: l.scope, priority: l.priority })),
      plannerOverrides: this._plannerOverrides.map(o => ({ id: o.id, intentTypes: o.intentTypes, priority: o.priority })),
      schemaModifiers:  this._schemaModifiers.map(m => ({ id: m.id, priority: m.priority })),
      outputValidators: this._outputValidators.map(v => ({ id: v.id })),
    };
  }

  getInvocationLog() {
    return [...this._invocationLog];
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  _logInvocation(type, meta) {
    this._invocationLog.push({ type, meta, timestamp: new Date().toISOString() });
    if (this._invocationLog.length > 1000) this._invocationLog.shift();
  }

  _log(level, message) {
    if (this._logger) this._logger[level]?.(`[AIExtensionLayer] ${message}`);
  }
}

module.exports = { AIExtensionLayer };
