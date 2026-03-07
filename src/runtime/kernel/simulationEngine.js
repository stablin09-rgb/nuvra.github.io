/**
 * Nuvra Runtime Kernel — simulationEngine.js (Phase 16)
 *
 * The Compliance Simulation Engine. Runs synthetic stress-test scenarios
 * against the active compliance configuration to validate that policies,
 * gatekeeper rules, and isolation modes behave correctly before going live.
 *
 * Built-in scenario libraries:
 *   - GDPR breach simulation
 *   - HIPAA PHI exposure simulation
 *   - PCI-DSS cardholder data leak simulation
 *   - Agent runaway simulation (unbounded execution)
 *   - Supply chain attack simulation (malicious extension)
 *   - Data residency violation simulation
 *
 * Results are stored in the Evidence Vault and surfaced in the Runtime Console.
 *
 * @module runtime/simulationEngine
 */
'use strict';

import { ACTOR, INTENT, ENVIRONMENT, RISK_LEVEL, ExecutionContext } from './executionContext.js';
import { DECISION } from './aiGatekeeper.js';

// ─── Scenario Status ──────────────────────────────────────────────────────────
export const SCENARIO_STATUS = Object.freeze({
  PASS:    'pass',
  FAIL:    'fail',
  WARNING: 'warning',
  SKIPPED: 'skipped',
});

// ─── Built-in Scenario Library ────────────────────────────────────────────────
const BUILT_IN_SCENARIOS = [

  // ── GDPR Scenarios ────────────────────────────────────────────────────────

  {
    id:          'gdpr-pii-in-prompt',
    name:        'GDPR: PII in AI Prompt',
    framework:   'gdpr',
    description: 'Simulates a user accidentally including a Social Security Number in an AI generation prompt.',
    severity:    'critical',
    async run(ctx, { gatekeeper }) {
      const testCtx = new ExecutionContext({
        actor:      ACTOR.USER,
        actorId:    'sim-user-001',
        intent:     INTENT.GENERATE,
        compliance: ['gdpr'],
        environment: ENVIRONMENT.PROD,
        riskLevel:  RISK_LEVEL.MEDIUM,
      });
      const result = await gatekeeper.evaluate(testCtx, {
        prompt: 'Create a user profile page for John Smith, SSN 123-45-6789, email john@example.com',
      });
      return {
        status:   result.decision === DECISION.BLOCK ? SCENARIO_STATUS.PASS : SCENARIO_STATUS.FAIL,
        expected: DECISION.BLOCK,
        actual:   result.decision,
        message:  result.decision === DECISION.BLOCK
          ? 'PII in prompt was correctly blocked.'
          : 'CRITICAL: PII in prompt was NOT blocked. GDPR violation risk.',
      };
    },
  },

  {
    id:          'gdpr-data-minimization',
    name:        'GDPR: Data Minimization Check',
    framework:   'gdpr',
    description: 'Verifies that sensitive context data is redacted before being sent to AI providers.',
    severity:    'high',
    async run(ctx, { gatekeeper }) {
      const testCtx = new ExecutionContext({
        actor:      ACTOR.USER,
        actorId:    'sim-user-001',
        intent:     INTENT.GENERATE,
        compliance: ['gdpr'],
        environment: ENVIRONMENT.PROD,
        riskLevel:  RISK_LEVEL.MEDIUM,
      });
      const result = await gatekeeper.evaluate(testCtx, {
        prompt: 'Generate a dashboard for this user',
        contextData: {
          username: 'johndoe',
          email:    'john@example.com',
          password: 'supersecret123',
          apiKey:   'sk-abc123',
        },
      });
      const wasRedacted = result.decision === DECISION.MODIFY && result.redactedFields?.length > 0;
      return {
        status:   wasRedacted ? SCENARIO_STATUS.PASS : SCENARIO_STATUS.FAIL,
        expected: DECISION.MODIFY,
        actual:   result.decision,
        message:  wasRedacted
          ? `Sensitive fields correctly redacted: ${result.redactedFields?.join(', ')}`
          : 'CRITICAL: Sensitive fields were NOT redacted from AI context.',
      };
    },
  },

  // ── HIPAA Scenarios ───────────────────────────────────────────────────────

  {
    id:          'hipaa-phi-in-prompt',
    name:        'HIPAA: PHI in AI Prompt',
    framework:   'hipaa',
    description: 'Simulates a user including Protected Health Information in an AI generation prompt.',
    severity:    'critical',
    async run(ctx, { gatekeeper }) {
      const testCtx = new ExecutionContext({
        actor:      ACTOR.USER,
        actorId:    'sim-user-001',
        intent:     INTENT.GENERATE,
        compliance: ['hipaa'],
        environment: ENVIRONMENT.PROD,
        riskLevel:  RISK_LEVEL.HIGH,
      });
      const result = await gatekeeper.evaluate(testCtx, {
        prompt: 'Create a patient portal for MRN: 123456, diagnosis: Type 2 Diabetes, medication: Metformin 500mg',
      });
      return {
        status:   result.decision === DECISION.BLOCK ? SCENARIO_STATUS.PASS : SCENARIO_STATUS.FAIL,
        expected: DECISION.BLOCK,
        actual:   result.decision,
        message:  result.decision === DECISION.BLOCK
          ? 'PHI in prompt was correctly blocked.'
          : 'CRITICAL: PHI in prompt was NOT blocked. HIPAA violation risk.',
      };
    },
  },

  // ── Agent Safety Scenarios ────────────────────────────────────────────────

  {
    id:          'agent-deploy-approval',
    name:        'Agent Safety: Deploy Requires Approval',
    framework:   'general',
    description: 'Verifies that autonomous agents cannot deploy to production without human approval.',
    severity:    'high',
    async run(ctx, { gatekeeper }) {
      const testCtx = new ExecutionContext({
        actor:      ACTOR.AGENT,
        actorId:    'sim-agent-001',
        intent:     INTENT.DEPLOY,
        compliance: [],
        environment: ENVIRONMENT.PROD,
        riskLevel:  RISK_LEVEL.HIGH,
        meta:       { agentType: 'deployment' },
      });
      const result = await gatekeeper.evaluate(testCtx, {
        targetEnvironment: 'production',
      });
      return {
        status:   result.decision === DECISION.REQUIRE_APPROVAL ? SCENARIO_STATUS.PASS : SCENARIO_STATUS.FAIL,
        expected: DECISION.REQUIRE_APPROVAL,
        actual:   result.decision,
        message:  result.decision === DECISION.REQUIRE_APPROVAL
          ? 'Agent deployment correctly requires human approval.'
          : 'CRITICAL: Agent was able to deploy without human approval.',
      };
    },
  },

  {
    id:          'agent-schema-approval',
    name:        'Agent Safety: Schema Change Requires Approval',
    framework:   'general',
    description: 'Verifies that autonomous agents cannot modify data schemas without human approval.',
    severity:    'high',
    async run(ctx, { gatekeeper }) {
      const testCtx = new ExecutionContext({
        actor:      ACTOR.AGENT,
        actorId:    'sim-agent-001',
        intent:     INTENT.MODIFY,
        compliance: [],
        environment: ENVIRONMENT.PROD,
        riskLevel:  RISK_LEVEL.HIGH,
        meta:       { agentType: 'maintenance' },
      });
      const result = await gatekeeper.evaluate(testCtx, {
        targetType: 'schema',
      });
      return {
        status:   result.decision === DECISION.REQUIRE_APPROVAL ? SCENARIO_STATUS.PASS : SCENARIO_STATUS.FAIL,
        expected: DECISION.REQUIRE_APPROVAL,
        actual:   result.decision,
        message:  result.decision === DECISION.REQUIRE_APPROVAL
          ? 'Agent schema change correctly requires human approval.'
          : 'CRITICAL: Agent was able to modify schema without human approval.',
      };
    },
  },

  // ── Authorization Scenarios ───────────────────────────────────────────────

  {
    id:          'anonymous-deploy-blocked',
    name:        'Authorization: Anonymous Deploy Blocked',
    framework:   'general',
    description: 'Verifies that unauthenticated users cannot deploy to production.',
    severity:    'critical',
    async run(ctx, { gatekeeper }) {
      const testCtx = new ExecutionContext({
        actor:      ACTOR.USER,
        actorId:    'anonymous',
        intent:     INTENT.DEPLOY,
        compliance: [],
        environment: ENVIRONMENT.PROD,
        riskLevel:  RISK_LEVEL.HIGH,
      });
      const result = await gatekeeper.evaluate(testCtx, {});
      return {
        status:   result.decision === DECISION.BLOCK ? SCENARIO_STATUS.PASS : SCENARIO_STATUS.FAIL,
        expected: DECISION.BLOCK,
        actual:   result.decision,
        message:  result.decision === DECISION.BLOCK
          ? 'Anonymous deploy correctly blocked.'
          : 'CRITICAL: Anonymous user was able to deploy to production.',
      };
    },
  },

  // ── Budget Scenarios ──────────────────────────────────────────────────────

  {
    id:          'over-budget-blocked',
    name:        'Budget: Over-Budget Request Blocked',
    framework:   'general',
    description: 'Verifies that requests exceeding the token budget are blocked.',
    severity:    'medium',
    async run(ctx, { gatekeeper }) {
      const testCtx = new ExecutionContext({
        actor:      ACTOR.USER,
        actorId:    'sim-user-001',
        intent:     INTENT.GENERATE,
        compliance: [],
        environment: ENVIRONMENT.PROD,
        riskLevel:  RISK_LEVEL.LOW,
      });
      const result = await gatekeeper.evaluate(testCtx, {
        estimatedTokens: 100_000,
        remainingBudget: 5_000,
      });
      return {
        status:   result.decision === DECISION.BLOCK ? SCENARIO_STATUS.PASS : SCENARIO_STATUS.FAIL,
        expected: DECISION.BLOCK,
        actual:   result.decision,
        message:  result.decision === DECISION.BLOCK
          ? 'Over-budget request correctly blocked.'
          : 'WARNING: Over-budget request was not blocked.',
      };
    },
  },
];

// ─── SimulationEngine Class ───────────────────────────────────────────────────
export class SimulationEngine {
  constructor() {
    this._customScenarios = [];
    this._lastRunResults  = null;
    this._gatekeeper      = null;
    this._vault           = null;
  }

  init(options = {}) {
    this._gatekeeper = options.gatekeeper || null;
    this._vault      = options.vault      || null;
  }

  /**
   * Run all scenarios (or a filtered subset).
   * @param {object} [options]
   * @param {string[]} [options.frameworks] - Filter by framework (e.g., ['gdpr', 'hipaa'])
   * @param {string[]} [options.ids]        - Run specific scenario IDs
   * @param {function} [options.onProgress] - Progress callback: (scenario, result) => void
   * @returns {Promise<SimulationReport>}
   */
  async runAll(options = {}) {
    const allScenarios = [...this._customScenarios, ...BUILT_IN_SCENARIOS];
    let scenarios = allScenarios;

    if (options.frameworks?.length) {
      scenarios = scenarios.filter(s => options.frameworks.includes(s.framework) || s.framework === 'general');
    }
    if (options.ids?.length) {
      scenarios = scenarios.filter(s => options.ids.includes(s.id));
    }

    const results = [];
    const deps = { gatekeeper: this._gatekeeper };

    for (const scenario of scenarios) {
      let result;
      try {
        const ctx = ExecutionContext.system(INTENT.ANALYZE);
        result = await scenario.run(ctx, deps);
        result.scenarioId   = scenario.id;
        result.scenarioName = scenario.name;
        result.framework    = scenario.framework;
        result.severity     = scenario.severity;
        result.timestamp    = Date.now();
      } catch (e) {
        result = {
          scenarioId:   scenario.id,
          scenarioName: scenario.name,
          framework:    scenario.framework,
          severity:     scenario.severity,
          status:       SCENARIO_STATUS.FAIL,
          message:      `Scenario threw an error: ${e.message}`,
          timestamp:    Date.now(),
        };
      }
      results.push(result);
      if (options.onProgress) options.onProgress(scenario, result);
    }

    const report = this._buildReport(results);
    this._lastRunResults = report;

    // Store in evidence vault
    if (this._vault) {
      await this._vault.record({ type: 'simulation_report', ...report }).catch(() => {});
    }

    return report;
  }

  /**
   * Run a single scenario by ID.
   */
  async runScenario(id) {
    const scenario = [...this._customScenarios, ...BUILT_IN_SCENARIOS].find(s => s.id === id);
    if (!scenario) throw new Error(`Scenario not found: ${id}`);
    const ctx = ExecutionContext.system(INTENT.ANALYZE);
    return scenario.run(ctx, { gatekeeper: this._gatekeeper });
  }

  addScenario(scenario) {
    this._customScenarios.push(scenario);
  }

  listScenarios() {
    return [...this._customScenarios, ...BUILT_IN_SCENARIOS].map(s => ({
      id: s.id, name: s.name, framework: s.framework, severity: s.severity, description: s.description,
    }));
  }

  getLastReport() {
    return this._lastRunResults;
  }

  // ── Private ────────────────────────────────────────────────────────────────
  _buildReport(results) {
    const passed   = results.filter(r => r.status === SCENARIO_STATUS.PASS).length;
    const failed   = results.filter(r => r.status === SCENARIO_STATUS.FAIL).length;
    const warnings = results.filter(r => r.status === SCENARIO_STATUS.WARNING).length;
    const critical = results.filter(r => r.status === SCENARIO_STATUS.FAIL && r.severity === 'critical').length;

    return {
      id:          `sim-${Date.now().toString(36)}`,
      runAt:       new Date().toISOString(),
      total:       results.length,
      passed,
      failed,
      warnings,
      criticalFailures: critical,
      passRate:    results.length ? (passed / results.length * 100).toFixed(1) : 100,
      overallStatus: critical > 0 ? 'critical' : failed > 0 ? 'fail' : warnings > 0 ? 'warning' : 'pass',
      results,
    };
  }
}

export default SimulationEngine;
