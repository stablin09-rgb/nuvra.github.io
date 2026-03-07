const { ExtensionType, TrustTier, Permission, Capability, RuntimeScope, BillingImpact } =
  require("../src/extensions/manifest/extensionTypes.js");
const { ManifestValidator } = require("../src/extensions/manifest/manifestValidator.js");
const { ExtensionRegistry } = require("../src/extensions/registry/extensionRegistry.js");
const { MarketplaceCatalog } = require("../src/marketplace/catalog/marketplaceCatalog.js");
const { RevenueEngine, PricingModel } = require("../src/monetization/revenue/revenueEngine.js");
const { ExtensionGovernance, ReviewStatus } = require("../src/governance/extensions/extensionGovernance.js");
const { AIExtensionLayer } = require("../src/ai/extensions/aiExtensionLayer.js");
const { ExtensionDevTools } = require("../src/extensions/devtools/extensionDevTools.js");
const { CompatibilityMatrix } = require("../src/extensions/compatibility/compatibilityMatrix.js");

function makeManifest(overrides = {}) {
  return {
    id:               "acme.test-ext",
    name:             "Test Extension",
    version:          "1.0.0",
    type:             ExtensionType.AI,
    author:           "Test Author <test@example.com>",
    description:      "A test extension for validation",
    permissions:      [Permission.AI_REGISTER_PROMPT_LAYER],
    capabilities:     [Capability.PROMPT_PACK],
    scopes:           [RuntimeScope.AI],
    nuvraCoreVersion: ">=8.0.0",
    entryPoint:       "index.js",
    billingImpact:    BillingImpact.LOW,
    aiUsageImpact:    BillingImpact.LOW,
    ...overrides,
  };
}
const L = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

describe("Phase 8 Tests", () => {
  describe("Manifest Validation", () => {
    test("accepts valid manifest", () => {
      const r = new ManifestValidator().validate(makeManifest());
      expect(r.valid).toBe(true);
    });
    test("rejects missing required fields", () => {
      const r = new ManifestValidator().validate({ id: "acme.bad" });
      expect(r.valid).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
    });
    test("rejects unknown permission", () => {
      const r = new ManifestValidator().validate(makeManifest({ permissions: ["UNKNOWN"] }));
      expect(r.valid).toBe(false);
    });
    test("rejects invalid ID format", () => {
      const r = new ManifestValidator().validate(makeManifest({ id: "invalid_no_dot" }));
      expect(r.valid).toBe(false);
    });
  });

  describe("Extension Registry", () => {
    test("installs valid extension", () => {
      const reg = new ExtensionRegistry({ logger: L });
      const r = reg.install(makeManifest(), "module.exports = {};");
      expect(r.ok).toBe(true);
      expect(reg.getStatusReport().total).toBe(1);
    });
    test("rejects duplicate install", () => {
      const reg = new ExtensionRegistry({ logger: L });
      reg.install(makeManifest(), "module.exports = {};");
      expect(reg.install(makeManifest(), "module.exports = {};").ok).toBe(false);
    });
    test("enable/disable works", () => {
      const reg = new ExtensionRegistry({ logger: L });
      reg.install(makeManifest(), "module.exports = {};");
      reg.disable("acme.test-ext");
      const e1 = reg.getStatusReport().extensions.find(e => e.id === "acme.test-ext");
      expect(e1.enabled).toBe(false);
      reg.enable("acme.test-ext");
      const e2 = reg.getStatusReport().extensions.find(e => e.id === "acme.test-ext");
      expect(e2.enabled).toBe(true);
    });
    test("uninstall removes extension", () => {
      const reg = new ExtensionRegistry({ logger: L });
      reg.install(makeManifest(), "module.exports = {};");
      expect(reg.uninstall("acme.test-ext").ok).toBe(true);
      expect(reg.getStatusReport().total).toBe(0);
    });
  });

  describe("Marketplace Catalog", () => {
    test("publish and search lists extensions", () => {
      const cat = new MarketplaceCatalog({ logger: L });
      cat.publish({ id: "acme.seo", name: "SEO", type: ExtensionType.AI, trustTier: TrustTier.VERIFIED, tags: ["seo"] });
      cat.publish({ id: "acme.form", name: "Form", type: ExtensionType.UI, trustTier: TrustTier.COMMUNITY, tags: ["forms"] });
      expect(cat.search({}).total).toBeGreaterThanOrEqual(2);
    });
    test("search filters by type", () => {
      const cat = new MarketplaceCatalog({ logger: L });
      cat.publish({ id: "acme.seo", name: "SEO", type: ExtensionType.AI, trustTier: TrustTier.VERIFIED, tags: [] });
      cat.publish({ id: "acme.form", name: "Form", type: ExtensionType.UI, trustTier: TrustTier.COMMUNITY, tags: [] });
      const r = cat.search({ type: ExtensionType.AI });
      expect(r.results.length).toBe(1);
      expect(r.results[0].id).toBe("acme.seo");
    });
    test("search filters by text query (tag)", () => {
      const cat = new MarketplaceCatalog({ logger: L });
      cat.publish({ id: "acme.seo", name: "SEO Booster", description: "SEO tools", type: ExtensionType.AI, trustTier: TrustTier.VERIFIED, tags: ["seo"] });
      cat.publish({ id: "acme.form", name: "Form Builder", description: "Form tools", type: ExtensionType.UI, trustTier: TrustTier.COMMUNITY, tags: ["forms"] });
      const r = cat.search({ q: "seo" });
      expect(r.results.length).toBe(1);
    });
    test("getById returns correct entry", () => {
      const cat = new MarketplaceCatalog({ logger: L });
      cat.publish({ id: "acme.seo", name: "SEO Booster", type: ExtensionType.AI, trustTier: TrustTier.VERIFIED, tags: [] });
      expect(cat.getById("acme.seo").name).toBe("SEO Booster");
    });
  });

  describe("Revenue Engine", () => {
    test("records paid purchase with revenue split", () => {
      const eng = new RevenueEngine({ logger: L });
      const r = eng.purchase({ extensionId: "acme.paid", userId: "u1", pricingModel: PricingModel.PAID, priceUSD: 10, creatorId: "c1", paymentToken: "tok" });
      expect(r.ok).toBe(true);
      expect(r.purchase.creatorShare).toBeGreaterThan(0);
      expect(r.purchase.platformShare).toBeGreaterThan(0);
      const total = Math.round((r.purchase.creatorShare + r.purchase.platformShare) * 100) / 100;
      expect(total).toBe(10);
    });
    test("rejects free extension purchase", () => {
      const eng = new RevenueEngine({ logger: L });
      expect(eng.purchase({ extensionId: "acme.free", userId: "u1", pricingModel: PricingModel.FREE, priceUSD: 0, creatorId: "c1", paymentToken: "tok" }).ok).toBe(false);
    });
    test("checkLicense returns licensed after purchase", () => {
      const eng = new RevenueEngine({ logger: L });
      eng.purchase({ extensionId: "acme.paid", userId: "u1", pricingModel: PricingModel.PAID, priceUSD: 10, creatorId: "c1", paymentToken: "tok" });
      expect(eng.checkLicense("u1", "acme.paid").licensed).toBe(true);
    });
    test("checkLicense returns unlicensed for unknown user", () => {
      expect(new RevenueEngine({ logger: L }).checkLicense("acme.paid", "nobody").licensed).toBe(false);
    });
  });

  describe("Extension Governance", () => {
    test("submits for review -> PENDING", () => {
      const gov = new ExtensionGovernance({ logger: L });
      const r = gov.submitForReview("acme.test-ext", makeManifest(), "module.exports = {};");
      expect(r.reviewId).toBeDefined();
      expect(gov.getReview("acme.test-ext").status).toBe(ReviewStatus.PENDING);
    });
    test("approve -> APPROVED", () => {
      const gov = new ExtensionGovernance({ logger: L });
      gov.submitForReview("acme.test-ext", makeManifest(), "");
      gov.approve("acme.test-ext", "rev1", "ok");
      expect(gov.getReview("acme.test-ext").status).toBe(ReviewStatus.APPROVED);
    });
    test("suspend -> SUSPENDED", () => {
      const gov = new ExtensionGovernance({ logger: L });
      gov.submitForReview("acme.test-ext", makeManifest(), "");
      gov.approve("acme.test-ext", "rev1", "ok");
      gov.suspend("acme.test-ext", "admin1", "security");
      expect(gov.getReview("acme.test-ext").status).toBe(ReviewStatus.SUSPENDED);
    });
    test("security scan detects eval() as critical threat", () => {
      const gov = new ExtensionGovernance({ logger: L });
      const r = gov.scanCode("acme.bad-ext", "eval(\"x\")");
      expect(r.safe).toBe(false);
      expect(r.findings.length).toBeGreaterThan(0);
      expect(r.threatLevel).toBe("critical");
    });
  });

  describe("AI Extension Layer", () => {
    test("addPromptLayer registers layer", () => {
      const layer = new AIExtensionLayer({ logger: L });
      layer.addPromptLayer({ id: "seo-layer", extensionId: "acme.seo", scope: RuntimeScope.AI, priority: 10, content: "SEO prompt" });
      expect(layer.getPromptLayersFor(RuntimeScope.AI).length).toBe(1);
    });
    test("composePromptLayers returns string with all layer content", () => {
      const layer = new AIExtensionLayer({ logger: L });
      layer.addPromptLayer({ id: "layer-a", extensionId: "acme.a", scope: RuntimeScope.AI, priority: 5,  content: "Focus on SEO" });
      layer.addPromptLayer({ id: "layer-b", extensionId: "acme.b", scope: RuntimeScope.AI, priority: 10, content: "Use formal tone" });
      const composed = layer.composePromptLayers(RuntimeScope.AI);
      expect(typeof composed).toBe("string");
      expect(composed).toContain("acme.a");
      expect(composed).toContain("acme.b");
    });
    test("deregisterExtension removes layers", () => {
      const layer = new AIExtensionLayer({ logger: L });
      layer.addPromptLayer({ id: "layer-a", extensionId: "acme.a", scope: RuntimeScope.AI, priority: 5, content: "Layer A content" });
      layer.deregisterExtension("acme.a");
      expect(layer.getPromptLayersFor(RuntimeScope.AI).length).toBe(0);
    });
  });

  describe("Compatibility Matrix", () => {
    test("accepts compatible manifest", () => {
      const m = new CompatibilityMatrix({ nuvraCoreVersion: "8.0.0", logger: L });
      expect(m.checkManifestCompatibility(makeManifest({ nuvraCoreVersion: ">=8.0.0" })).compatible).toBe(true);
    });
    test("rejects incompatible manifest", () => {
      const m = new CompatibilityMatrix({ nuvraCoreVersion: "8.0.0", logger: L });
      expect(m.checkManifestCompatibility(makeManifest({ nuvraCoreVersion: ">=9.0.0" })).compatible).toBe(false);
    });
    test("getDeprecationWarnings returns array", () => {
      const m = new CompatibilityMatrix({ nuvraCoreVersion: "8.0.0", logger: L });
      expect(Array.isArray(m.getDeprecationWarnings(makeManifest()))).toBe(true);
    });
  });

  describe("Dev Tools", () => {
    test("startDevSession succeeds", () => {
      const reg = new ExtensionRegistry({ logger: L });
      const gov = new ExtensionGovernance({ logger: L });
      const cat = new MarketplaceCatalog({ logger: L });
      const dt  = new ExtensionDevTools({ registry: reg, governance: gov, catalog: cat, logger: L });
      const r = dt.startDevSession(makeManifest(), "module.exports = {};");
      expect(r.ok).toBe(true);
      expect(r.sessionId).toBeDefined();
    });
    test("hotReload succeeds (returns ok:true from activate)", () => {
      const reg = new ExtensionRegistry({ logger: L });
      const gov = new ExtensionGovernance({ logger: L });
      const cat = new MarketplaceCatalog({ logger: L });
      const dt  = new ExtensionDevTools({ registry: reg, governance: gov, catalog: cat, logger: L });
      dt.startDevSession(makeManifest(), "module.exports = {};");
      const r = dt.hotReload("acme.test-ext", "module.exports = {};");
      expect(r.ok).toBe(true);
    });
    test("endDevSession succeeds", () => {
      const reg = new ExtensionRegistry({ logger: L });
      const gov = new ExtensionGovernance({ logger: L });
      const cat = new MarketplaceCatalog({ logger: L });
      const dt  = new ExtensionDevTools({ registry: reg, governance: gov, catalog: cat, logger: L });
      dt.startDevSession(makeManifest(), "module.exports = {};");
      expect(dt.endDevSession("acme.test-ext").ok).toBe(true);
    });
  });

  describe("Crash Isolation", () => {
    test("registry does not throw on crashing extension", () => {
      const reg = new ExtensionRegistry({ logger: L });
      let threw = false;
      try { reg.install(makeManifest(), "throw new Error(\"crash\");"); } catch (e) { threw = true; }
      expect(threw).toBe(false);
      expect(reg.getStatusReport().extensions.find(e => e.id === "acme.test-ext")).toBeDefined();
    });
  });
});
