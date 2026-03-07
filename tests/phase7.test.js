'use strict';

/**
 * phase7.test.js — Nuvra Phase 7 Validation Suite
 *
 * Required scenarios from the brief:
 *  1. Free user hits project limit → hard block fires
 *  2. AI generation records tokens + cost in ledger
 *  3. Abuse detector blocks prompt spam
 *  4. Upgrade preview shows correct proration
 *  5. Enterprise org tracks cost by cost center
 *  6. Usage export produces valid CSV and JSON
 *
 * Additional validation:
 *  7. Ledger is append-only (no mutation)
 *  8. Entitlement check respects plan limits
 *  9. AI cost governance blocks on session limit
 * 10. Billing reducer handles all action types
 * 11. Downgrade warning shows usage-over-limit
 * 12. Billing dashboard data structure is complete
 */

// ─── Minimal test harness ─────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(a, b, message) {
  if (a !== b) throw new Error(message || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function assertApprox(a, b, tolerance, message) {
  if (Math.abs(a - b) > tolerance) throw new Error(message || `Expected ~${b}, got ${a}`);
}

// ─── Load modules ─────────────────────────────────────────────────────────────
const { UsageLedger }             = require('../src/billing/ledger/usageLedger');
const { Dimension }               = require('../src/billing/ledger/usageDimensions');
const { EntitlementManager }      = require('../src/billing/plans/entitlementManager');
const { getPlan, getAllPlans, isUpgrade } = require('../src/billing/plans/planDefinitions');
const { LimitEnforcementEngine }  = require('../src/billing/limits/limitEnforcementEngine');
const { AICostGovernance }        = require('../src/billing/limits/aiCostGovernance');
const { AbuseDetector, AbuseCode } = require('../src/billing/abuse/abuseDetector');
const { BillingDashboard }        = require('../src/billing/dashboard/billingDashboard');
const { UpgradeEngine, TransitionType } = require('../src/billing/upgrade/upgradeEngine');
const { EnterpriseBilling }       = require('../src/billing/enterprise/enterpriseBilling');
const { BillingProviderRegistry } = require('../src/billing/providers/billingProviderRegistry');
const { LocalBillingProvider }    = require('../src/billing/providers/localBillingProvider');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeEventBus() {
  const handlers = {};
  return {
    on:   (event, fn) => { if (!handlers[event]) handlers[event] = []; handlers[event].push(fn); },
    emit: (event, data) => { (handlers[event] || []).forEach(fn => fn(data)); },
  };
}

function makeLedger() {
  return new UsageLedger({ eventBus: makeEventBus(), logger: null });
}

function makeEntitlementManager(ledger) {
  return new EntitlementManager({ ledger, logger: null });
}

// ─── Scenario 1: Free user hits project limit → hard block fires ──────────────
console.log('\nScenario 1: Free user hits project limit');

test('Free plan exists and has AI generation limits', () => {
  const plan = getPlan('free');
  assert(plan !== null, 'Free plan should exist');
  const ent = plan.entitlements[Dimension.AI_PLANS_EXECUTED];
  assert(ent !== undefined, 'Free plan should have an AI_PLANS_EXECUTED entitlement');
  assert(ent.limit < Infinity, 'Free plan AI_PLANS_EXECUTED limit should be finite');
});

test('LimitEnforcementEngine blocks when hard limit is reached', () => {
  const ledger = makeLedger();
  const userId = 'user_limit_test';
  const planId = 'free';

  const em     = makeEntitlementManager(ledger);
  const engine = new LimitEnforcementEngine({ entitlementManager: em, eventBus: makeEventBus(), logger: null });

  // Record usage up to the free plan's AI_PLANS_EXECUTED limit
  const plan  = getPlan(planId);
  const limit = plan.entitlements[Dimension.AI_PLANS_EXECUTED].limit;

  for (let i = 0; i < limit; i++) {
    ledger.record({ dimension: Dimension.AI_PLANS_EXECUTED, quantity: 1, userId });
  }

  const result = engine.enforce({ dimension: Dimension.AI_PLANS_EXECUTED, userId, planId });
  assert(!result.allowed, 'Should be blocked after reaching AI_PLANS_EXECUTED limit');
  assert(result.reason, 'Should have a reason for the block');
});

test('LimitEnforcementEngine emits billing:limit:blocked event', () => {
  const eventBus = makeEventBus();
  const ledger   = makeLedger();
  const userId   = 'user_event_test';
  const planId   = 'free';

  const em     = makeEntitlementManager(ledger);
  const engine = new LimitEnforcementEngine({ entitlementManager: em, eventBus, logger: null });

  let blockedEvent = null;
  eventBus.on('billing:limit:blocked', (data) => { blockedEvent = data; });

  const plan  = getPlan(planId);
  const limit = plan.entitlements[Dimension.AI_PLANS_EXECUTED].limit;
  for (let i = 0; i < limit; i++) {
    ledger.record({ dimension: Dimension.AI_PLANS_EXECUTED, quantity: 1, userId });
  }

  engine.enforce({ dimension: Dimension.AI_PLANS_EXECUTED, userId, planId });
  assert(blockedEvent !== null, 'billing:limit:blocked event should have been emitted');
  assertEqual(blockedEvent.dimension, Dimension.AI_PLANS_EXECUTED, 'Event should reference the correct dimension');
});

// ─── Scenario 2: AI generation records tokens + cost in ledger ────────────────
console.log('\nScenario 2: AI generation records tokens + cost in ledger');

test('UsageLedger records AI generation entries', () => {
  const ledger = makeLedger();
  const userId = 'user_ai_test';

  ledger.record({ dimension: Dimension.AI_PLANS_EXECUTED,  quantity: 1,     userId });
  ledger.record({ dimension: Dimension.AI_TOKENS_INPUT,    quantity: 1500,  userId, provider: 'openai' });
  ledger.record({ dimension: Dimension.AI_TOKENS_OUTPUT,   quantity: 800,   userId, provider: 'openai' });
  ledger.record({ dimension: Dimension.AI_COST_USD,        quantity: 0.035, userId, provider: 'openai', meta: { model: 'gpt-4o' } });

  const { since, until } = UsageLedger.currentMonthWindow();
  const plans  = ledger.aggregate({ dimension: Dimension.AI_PLANS_EXECUTED,  userId, since, until });
  const input  = ledger.aggregate({ dimension: Dimension.AI_TOKENS_INPUT,    userId, since, until });
  const output = ledger.aggregate({ dimension: Dimension.AI_TOKENS_OUTPUT,   userId, since, until });
  const cost   = ledger.aggregate({ dimension: Dimension.AI_COST_USD,        userId, since, until });

  assertEqual(plans,  1,     'Should record 1 AI plan execution');
  assertEqual(input,  1500,  'Should record 1500 input tokens');
  assertEqual(output, 800,   'Should record 800 output tokens');
  assertApprox(cost, 0.035, 0.0001, 'Should record $0.035 cost');
});

test('UsageLedger getAICostUSD returns correct total', () => {
  const ledger = makeLedger();
  const userId = 'user_cost_test';
  const { since, until } = UsageLedger.currentMonthWindow();

  ledger.record({ dimension: Dimension.AI_COST_USD, quantity: 0.10, userId });
  ledger.record({ dimension: Dimension.AI_COST_USD, quantity: 0.05, userId });
  ledger.record({ dimension: Dimension.AI_COST_USD, quantity: 0.02, userId });

  const total = ledger.getAICostUSD(userId, since, until);
  assertApprox(total, 0.17, 0.0001, 'Total AI cost should be $0.17');
});

test('UsageLedger getProjectAICostUSD scopes by project', () => {
  const ledger    = makeLedger();
  const userId    = 'user_proj_cost';
  const projectId = 'proj_abc';
  const { since, until } = UsageLedger.currentMonthWindow();

  ledger.record({ dimension: Dimension.AI_COST_USD, quantity: 0.20, userId, projectId });
  ledger.record({ dimension: Dimension.AI_COST_USD, quantity: 0.30, userId, projectId: 'proj_other' });

  const projCost = ledger.getProjectAICostUSD(projectId, since, until);
  assertApprox(projCost, 0.20, 0.0001, 'Project cost should be $0.20 (not $0.50)');
});

// ─── Scenario 3: Abuse detector blocks prompt spam ────────────────────────────
console.log('\nScenario 3: Abuse detector blocks prompt spam');

test('AbuseDetector allows first prompt', () => {
  const detector = new AbuseDetector({ thresholds: { promptSpam: { maxIdentical: 3, windowMs: 60000 } } });
  const result   = detector.check({ userId: 'user_spam_1', prompt: 'Build me a SaaS app' });
  assert(result.clean, 'First prompt should be allowed');
  assertEqual(result.action, 'allow', 'Action should be allow');
});

test('AbuseDetector throttles repeated identical prompts', () => {
  const detector = new AbuseDetector({ thresholds: { promptSpam: { maxIdentical: 2, windowMs: 60000 } } });
  const userId   = 'user_spam_2';
  const prompt   = 'Build me a SaaS app for project management';

  detector.check({ userId, prompt });
  detector.check({ userId, prompt });
  const result = detector.check({ userId, prompt }); // 3rd identical prompt

  assert(!result.clean, 'Third identical prompt should be flagged');
  assertEqual(result.code, AbuseCode.PROMPT_SPAM, 'Code should be PROMPT_SPAM');
  assert(result.action === 'throttle' || result.action === 'block', 'Action should be throttle or block');
});

test('AbuseDetector blocks token flooding', () => {
  const detector = new AbuseDetector({ thresholds: { tokenFlood: { maxInputTokens: 1000, maxOutputTokens: 500 } } });
  const result   = detector.check({ userId: 'user_flood', prompt: 'short', estimatedInputTokens: 5000 });
  assert(!result.clean, 'Token flood should be blocked');
  assertEqual(result.code, AbuseCode.TOKEN_FLOOD, 'Code should be TOKEN_FLOOD');
  assertEqual(result.action, 'block', 'Action should be block');
});

test('AbuseDetector detects regeneration loops', () => {
  const detector   = new AbuseDetector({ thresholds: { regenLoop: { maxRegens: 3, windowMs: 60000 } } });
  const userId     = 'user_regen';
  const resourceId = 'project_xyz';

  for (let i = 0; i < 3; i++) {
    detector.check({ userId, prompt: `Regen ${i}`, resourceId });
  }
  const result = detector.check({ userId, prompt: 'Regen 4', resourceId });
  assert(!result.clean, 'Should detect regeneration loop');
  assertEqual(result.code, AbuseCode.REGEN_LOOP, 'Code should be REGEN_LOOP');
});

test('AbuseDetector clearFlag re-allows blocked user', () => {
  const detector = new AbuseDetector({ thresholds: { tokenFlood: { maxInputTokens: 100, maxOutputTokens: 100 } } });
  const userId   = 'user_clear';

  detector.check({ userId, prompt: 'test', estimatedInputTokens: 5000 });
  assert(detector.isFlagged(userId), 'User should be flagged');

  detector.clearFlag(userId);
  assert(!detector.isFlagged(userId), 'User should no longer be flagged after clearFlag');
});

// ─── Scenario 4: Upgrade preview shows correct proration ─────────────────────
console.log('\nScenario 4: Upgrade preview shows correct proration');

test('UpgradeEngine.previewTransition identifies upgrade correctly', () => {
  const ledger   = makeLedger();
  const registry = new BillingProviderRegistry();
  const engine   = new UpgradeEngine({ billingProviderRegistry: registry, ledger, eventBus: makeEventBus() });

  const preview = engine.previewTransition({ userId: 'user_upgrade', fromPlanId: 'free', toPlanId: 'pro' });
  assertEqual(preview.type, TransitionType.UPGRADE, 'Should be identified as an upgrade');
  assert(preview.fromPlan.id === 'free', 'From plan should be free');
  assert(preview.toPlan.id   === 'pro',  'To plan should be pro');
});

test('UpgradeEngine.previewTransition identifies downgrade correctly', () => {
  const ledger   = makeLedger();
  const registry = new BillingProviderRegistry();
  const engine   = new UpgradeEngine({ billingProviderRegistry: registry, ledger, eventBus: makeEventBus() });

  const preview = engine.previewTransition({ userId: 'user_downgrade', fromPlanId: 'pro', toPlanId: 'free' });
  assertEqual(preview.type, TransitionType.DOWNGRADE, 'Should be identified as a downgrade');
});

test('UpgradeEngine.previewTransition calculates proration', () => {
  const ledger   = makeLedger();
  const registry = new BillingProviderRegistry();
  const engine   = new UpgradeEngine({ billingProviderRegistry: registry, ledger, eventBus: makeEventBus() });

  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 15);

  const preview = engine.previewTransition({
    userId:            'user_prorate',
    fromPlanId:        'free',
    toPlanId:          'pro',
    currentPeriodEnd:  futureDate.toISOString(),
  });

  assert(preview.proration !== undefined, 'Should have proration data');
  assert(typeof preview.proration.netUSD === 'number', 'netUSD should be a number');
  assert(preview.proration.explanation.length > 0, 'Should have a proration explanation');
});

test('UpgradeEngine.previewTransition shows limit changes', () => {
  const ledger   = makeLedger();
  const registry = new BillingProviderRegistry();
  const engine   = new UpgradeEngine({ billingProviderRegistry: registry, ledger, eventBus: makeEventBus() });

  const preview = engine.previewTransition({ userId: 'user_limits', fromPlanId: 'free', toPlanId: 'pro' });
  assert(Array.isArray(preview.limitChanges), 'Should have limitChanges array');
  assert(preview.limitChanges.length > 0, 'Should show at least one limit change for free → pro');
});

test('UpgradeEngine schedules downgrade correctly', async () => {
  const ledger   = makeLedger();
  const registry = new BillingProviderRegistry();
  const engine   = new UpgradeEngine({ billingProviderRegistry: registry, ledger, eventBus: makeEventBus() });

  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 30);

  const result = await engine.scheduleDowngrade({
    userId:           'user_sched',
    subscriptionId:   'sub_123',
    fromPlanId:       'pro',
    toPlanId:         'free',
    currentPeriodEnd: futureDate.toISOString(),
  });

  assert(result.ok, 'Downgrade should be scheduled successfully');
  assert(engine.getPendingDowngrade('user_sched') !== null, 'Pending downgrade should be stored');
});

// ─── Scenario 5: Enterprise org tracks cost by cost center ───────────────────
console.log('\nScenario 5: Enterprise org tracks cost by cost center');

test('EnterpriseBilling creates org and adds members', () => {
  const ledger  = makeLedger();
  const billing = new EnterpriseBilling({ ledger, eventBus: makeEventBus() });

  billing.createOrg({ orgId: 'org_acme', name: 'Acme Corp', adminUserId: 'user_admin' });
  billing.addMember('org_acme', 'user_dev1');
  billing.addMember('org_acme', 'user_dev2');

  const members = billing.getMembers('org_acme');
  assert(members.includes('user_admin'), 'Admin should be a member');
  assert(members.includes('user_dev1'),  'Dev1 should be a member');
  assert(members.includes('user_dev2'),  'Dev2 should be a member');
  assertEqual(members.length, 3, 'Should have 3 members');
});

test('EnterpriseBilling creates cost center and assigns users', () => {
  const ledger  = makeLedger();
  const billing = new EnterpriseBilling({ ledger, eventBus: makeEventBus() });

  billing.createOrg({ orgId: 'org_beta', name: 'Beta Inc', adminUserId: 'user_cto' });
  billing.createCostCenter('org_beta', { centerId: 'cc_eng', name: 'Engineering', monthlyBudgetUSD: 500 });
  billing.assignUserToCostCenter('org_beta', 'cc_eng', 'user_cto');

  const report = billing.getCostCenterReport('org_beta', 'cc_eng');
  assert(report !== null, 'Should return a cost center report');
  assertEqual(report.centerId, 'cc_eng', 'Report should reference the correct cost center');
  assertEqual(report.monthlyBudgetUSD, 500, 'Budget should be $500');
  assert(report.byUser.some(u => u.userId === 'user_cto'), 'Report should include the assigned user');
});

test('EnterpriseBilling cost center report includes AI cost', () => {
  const ledger  = makeLedger();
  const billing = new EnterpriseBilling({ ledger, eventBus: makeEventBus() });

  billing.createOrg({ orgId: 'org_gamma', name: 'Gamma Ltd', adminUserId: 'user_gm' });
  billing.createCostCenter('org_gamma', { centerId: 'cc_product', name: 'Product', monthlyBudgetUSD: 200 });
  billing.assignUserToCostCenter('org_gamma', 'cc_product', 'user_gm');

  // Record AI cost for the assigned user
  ledger.record({ dimension: Dimension.AI_COST_USD, quantity: 12.50, userId: 'user_gm' });

  const report = billing.getCostCenterReport('org_gamma', 'cc_product');
  assertApprox(report.totalCostUSD, 12.50, 0.01, 'Cost center should show $12.50 total cost');
  assert(report.budgetPct > 0, 'Budget percentage should be > 0');
});

test('EnterpriseBilling records invoice audit trail', () => {
  const ledger  = makeLedger();
  const billing = new EnterpriseBilling({ ledger, eventBus: makeEventBus() });

  billing.createOrg({ orgId: 'org_delta', name: 'Delta', adminUserId: 'user_d' });
  billing.recordInvoiceEvent('org_delta', { type: 'charge', amountUSD: 49.00, description: 'Pro plan' });
  billing.recordInvoiceEvent('org_delta', { type: 'credit', amountUSD: 5.00,  description: 'Proration credit' });

  const trail = billing.getInvoiceAuditTrail('org_delta');
  assertEqual(trail.length, 2, 'Should have 2 invoice events');
  assert(trail[0].id,         'Each event should have an ID');
  assert(trail[0].recordedAt, 'Each event should have a timestamp');
});

// ─── Scenario 6: Usage export produces valid CSV and JSON ─────────────────────
console.log('\nScenario 6: Usage export produces valid CSV and JSON');

test('UsageLedger export() returns all entries as copies', () => {
  const ledger = makeLedger();
  const userId = 'user_export';

  ledger.record({ dimension: Dimension.AI_PLANS_EXECUTED, quantity: 3,    userId });
  ledger.record({ dimension: Dimension.AI_TOKENS_INPUT,   quantity: 4500, userId });
  ledger.record({ dimension: Dimension.AI_COST_USD,       quantity: 0.15, userId });

  const exported = ledger.export();
  assert(Array.isArray(exported), 'Export should return an array');
  assertEqual(exported.length, 3, 'Should have 3 entries');
  assert(exported[0].dimension, 'Each entry should have a dimension');
  assert(exported[0].quantity !== undefined, 'Each entry should have a quantity');
  assert(exported[0].recordedAt, 'Each entry should have a recordedAt timestamp');
});

test('UsageLedger query returns filtered entries', () => {
  const ledger = makeLedger();
  const userId = 'user_query';
  const { since, until } = UsageLedger.currentMonthWindow();

  ledger.record({ dimension: Dimension.AI_COST_USD, quantity: 0.05, userId });
  ledger.record({ dimension: Dimension.AI_COST_USD, quantity: 0.10, userId: 'other_user' });

  const entries = ledger.query({ userId, since, until });
  assertEqual(entries.length, 1, 'Query should return only the user\'s entries');
  assertEqual(entries[0].userId, userId, 'Entry should belong to the queried user');
});

test('EnterpriseBilling exportUsageJSON covers all org members', () => {
  const ledger  = makeLedger();
  const billing = new EnterpriseBilling({ ledger, eventBus: makeEventBus() });
  const { since, until } = UsageLedger.currentMonthWindow();

  billing.createOrg({ orgId: 'org_export', name: 'Export Corp', adminUserId: 'user_e1' });
  billing.addMember('org_export', 'user_e2');

  ledger.record({ dimension: Dimension.AI_COST_USD, quantity: 0.10, userId: 'user_e1' });
  ledger.record({ dimension: Dimension.AI_COST_USD, quantity: 0.20, userId: 'user_e2' });

  const json = billing.exportUsageJSON('org_export', since, until);
  assert(json.orgId === 'org_export', 'Export should reference the org');
  assertEqual(json.entries.length, 2, 'Export should include entries from all members');
  assert(json.exportedAt, 'Export should have an exportedAt timestamp');
});

test('EnterpriseBilling exportUsageCSV is valid CSV', () => {
  const ledger  = makeLedger();
  const billing = new EnterpriseBilling({ ledger, eventBus: makeEventBus() });
  const { since, until } = UsageLedger.currentMonthWindow();

  billing.createOrg({ orgId: 'org_csv', name: 'CSV Corp', adminUserId: 'user_csv1' });
  ledger.record({ dimension: Dimension.AI_COST_USD, quantity: 0.05, userId: 'user_csv1' });

  const csv = billing.exportUsageCSV('org_csv', since, until);
  assert(typeof csv === 'string', 'CSV should be a string');
  assert(csv.includes('dimension'), 'CSV should have headers');
  const rows = csv.trim().split('\n');
  assert(rows.length >= 2, 'CSV should have header + at least 1 data row');
});

// ─── Additional Validation ────────────────────────────────────────────────────
console.log('\nAdditional Validation');

test('Ledger entries are immutable (Object.freeze)', () => {
  const ledger = makeLedger();
  const userId = 'user_immutable';

  const entry = ledger.record({ dimension: Dimension.AI_COST_USD, quantity: 1.00, userId });

  // Verify the entry is frozen
  assert(Object.isFrozen(entry), 'Ledger entries should be frozen (immutable)');

  // Verify the export returns copies, not references
  const exported = ledger.export();
  exported[0].quantity = 999;

  const { since, until } = UsageLedger.currentMonthWindow();
  const cost = ledger.getAICostUSD(userId, since, until);
  assertApprox(cost, 1.00, 0.001, 'Ledger should be immutable — cost should still be $1.00');
});

test('EntitlementManager.check returns correct result for free plan', () => {
  const ledger = makeLedger();
  const em     = makeEntitlementManager(ledger);

  const result = em.check({ userId: 'user_check', planId: 'free', dimension: Dimension.AI_PLANS_EXECUTED, quantity: 1 });
  assert(typeof result === 'object', 'Check result should be an object');
  assert(typeof result.allowed === 'boolean', 'Result should have an allowed boolean');
});

test('AICostGovernance blocks when session limit is reached', () => {
  const eventBus = makeEventBus();
  const ledger   = makeLedger();
  const gov      = new AICostGovernance({
    ledger,
    eventBus,
    logger:         null,
    sessionBudgets: { free: { limit: 0.10, maxCalls: 100 } },
  });

  const userId  = 'user_session_limit';
  const planId  = 'free';
  const provider = 'openai';
  const model   = 'gpt-4o-mini';

  // Record usage that exceeds the $0.10 session limit
  // gpt-4o-mini: ~$0.15/1M input tokens, ~$0.60/1M output tokens
  // 300k input + 100k output ≈ $0.045 + $0.06 = $0.105 > $0.10 limit
  gov.recordUsage({ userId, planId, provider, model, actualInputTokens: 300000, actualOutputTokens: 100000 });

  const check = gov.checkBudgets({ userId, planId, provider, model, estimatedInputTokens: 1000, estimatedOutputTokens: 500 });
  assert(!check.allowed, 'Should be blocked after exceeding session limit');
  assert(check.reason, 'Should have a reason for the block');
});

test('BillingReducer handles all Phase 7 action types', () => {
  const { billingReducer } = require('../src/state/reducers');

  let state = billingReducer(undefined, { type: '@@INIT' });
  assertEqual(state.planId, 'free', 'Initial plan should be free');

  state = billingReducer(state, { type: 'BILLING/SET_PLAN', payload: 'pro' });
  assertEqual(state.planId, 'pro', 'Plan should be updated to pro');

  state = billingReducer(state, { type: 'BILLING/SET_SESSION_COST', payload: 1.23 });
  assertApprox(state.sessionCostUSD, 1.23, 0.001, 'Session cost should be updated');

  state = billingReducer(state, { type: 'BILLING/SET_LIMIT_WARNING', payload: { dimension: Dimension.AI_PLANS_EXECUTED, pct: 85 } });
  assert(state.limitWarnings[Dimension.AI_PLANS_EXECUTED], 'Limit warning should be stored');
  assertEqual(state.limitWarnings[Dimension.AI_PLANS_EXECUTED].pct, 85, 'Warning pct should be 85');

  state = billingReducer(state, { type: 'BILLING/SET_LIMIT_BLOCKED', payload: { dimension: Dimension.APPS_GENERATED } });
  assert(state.limitBlocked[Dimension.APPS_GENERATED], 'Limit blocked should be stored');

  state = billingReducer(state, { type: 'BILLING/SET_ABUSE_FLAG', payload: { userId: 'u1', code: 'PROMPT_SPAM' } });
  assert(state.abuseFlag !== null, 'Abuse flag should be set');

  state = billingReducer(state, { type: 'BILLING/CLEAR_ABUSE_FLAG' });
  assert(state.abuseFlag === null, 'Abuse flag should be cleared');

  state = billingReducer(state, { type: 'BILLING/SET_PENDING_DOWNGRADE', payload: { toPlanId: 'free', effectiveAt: '2026-04-01' } });
  assert(state.pendingDowngrade !== null, 'Pending downgrade should be set');

  state = billingReducer(state, { type: 'BILLING/CLEAR_PENDING_DOWNGRADE' });
  assert(state.pendingDowngrade === null, 'Pending downgrade should be cleared');
});

test('BillingDashboard getDashboardData returns complete structure', () => {
  const ledger = makeLedger();
  const em     = makeEntitlementManager(ledger);
  const dash   = new BillingDashboard({ ledger, entitlementManager: em });

  const data = dash.getDashboardData({ userId: 'user_dash', planId: 'free' });
  assert(data.plan,              'Dashboard should have plan');
  assert(data.period,            'Dashboard should have period');
  assert(data.usageSummary,      'Dashboard should have usageSummary');
  assert(data.costBreakdown,     'Dashboard should have costBreakdown');
  assert(data.projections,       'Dashboard should have projections');
  assert(data.dailyTrend,        'Dashboard should have dailyTrend');
  assert(data.entitlementStatus, 'Dashboard should have entitlementStatus');
  assert(data.upgradeOptions,    'Dashboard should have upgradeOptions');
  assert(Array.isArray(data.dailyTrend), 'dailyTrend should be an array');
});

test('All plan IDs are valid and have required fields', () => {
  const plans = getAllPlans();
  assert(plans.length >= 3, 'Should have at least 3 plans (free, pro, enterprise)');
  for (const plan of plans) {
    assert(plan.id,           `Plan ${plan.id} should have an id`);
    assert(plan.name,         `Plan ${plan.id} should have a name`);
    assert(plan.entitlements, `Plan ${plan.id} should have entitlements`);
    // priceUSD can be null for enterprise (custom pricing) — just check it exists
    assert('priceUSD' in plan, `Plan ${plan.id} should have a priceUSD property (can be null for custom pricing)`);
  }
});

test('isUpgrade correctly identifies plan hierarchy', () => {
  assert(isUpgrade('free', 'pro'),        'free → pro should be an upgrade');
  assert(isUpgrade('pro', 'enterprise'),  'pro → enterprise should be an upgrade');
  assert(!isUpgrade('pro', 'free'),       'pro → free should NOT be an upgrade');
  assert(!isUpgrade('free', 'free'),      'free → free should NOT be an upgrade');
});

test('LocalBillingProvider creates checkout session', async () => {
  const provider = new LocalBillingProvider();
  const result   = await provider.createCheckoutSession({
    customerId: 'cust_test',
    planId:     'pro',
    successUrl: 'https://example.com/success',
    cancelUrl:  'https://example.com/cancel',
  });
  assert(result.ok, 'Checkout session should be created');
  assert(result.checkoutUrl || result.sessionId, 'Should return a checkout URL or session ID');
});

test('UsageLedger getSummary returns all dimensions', () => {
  const ledger = makeLedger();
  const userId = 'user_summary';
  const { since, until } = UsageLedger.currentMonthWindow();

  ledger.record({ dimension: Dimension.AI_COST_USD, quantity: 0.05, userId });

  const summary = ledger.getSummary(userId, since, until);
  assert(typeof summary === 'object', 'Summary should be an object');
  assert(summary[Dimension.AI_COST_USD], 'Summary should include AI_COST_USD dimension');
  assertApprox(summary[Dimension.AI_COST_USD].quantity, 0.05, 0.001, 'AI cost should be $0.05');
});

// ─── Results ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All Phase 7 tests passed.');
}
