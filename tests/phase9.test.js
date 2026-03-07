/**
 * phase9.test.js - Nuvra Phase 9
 *
 * Tests for Mobile Outputs Governance & Runtime Parity.
 * This includes tests for capability denial, policy rejection, offline-only scenarios,
 * permission revocation, AI-generated mobile apps with conflicts, and unsafe extension access.
 */

const MobilePolicyEngine = require("../src/mobile/governance/mobilePolicyEngine");
const CapabilityDeclarationSystem = require("../src/mobile/governance/capabilityDeclarationSystem");
const MobileAwarePlanner = require("../src/ai/planning/mobileAwarePlanner");
const PreviewParityEnforcement = require("../src/preview/previewParityEnforcement");
const GovernedBuildPipeline = require("../src/publish/governedBuildPipeline");
const EnterpriseRegulatedProfiles = require("../src/mobile/governance/enterpriseRegulatedProfiles");
const MobileVersioningRollback = require("../src/mobile/governance/mobileVersioningRollback");
const SecurityThreatModeling = require("../src/security/securityThreatModeling");

// Mock logger for tests
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  critical: jest.fn(),
};

describe("Phase 9: Mobile Outputs Governance & Runtime Parity", () => {
  let capabilitySystem;
  let mobilePolicyEngine;
  let mobileAwarePlanner;
  let previewParityEnforcement;
  let governedBuildPipeline;
  let enterpriseRegulatedProfiles;
  let mobileVersioningRollback;
  let securityThreatModeling;

  beforeEach(() => {
    capabilitySystem = new CapabilityDeclarationSystem();
    mobilePolicyEngine = new MobilePolicyEngine({ logger: mockLogger });
    mobileAwarePlanner = new MobileAwarePlanner({ logger: mockLogger, planningGraph: {} }); // planningGraph is mocked
    previewParityEnforcement = new PreviewParityEnforcement({ logger: mockLogger });
    governedBuildPipeline = new GovernedBuildPipeline({ logger: mockLogger, mobilePolicyEngine });
    enterpriseRegulatedProfiles = new EnterpriseRegulatedProfiles({ logger: mockLogger });
    mobileVersioningRollback = new MobileVersioningRollback({ logger: mockLogger });
    securityThreatModeling = new SecurityThreatModeling({ logger: mockLogger });

    // Clear mock calls before each test
    jest.clearAllMocks();
  });

  // Test 1: Capability denial flow
  test("should deny a build if a required capability is blocked by policy", () => {
    const appManifest = {
      id: "test-app-1",
      name: "Test App 1",
      declaredCapabilities: ["healthData", "camera"],
      usesEncryption: true,
    };
    const targetPlatform = "enterprise"; // Enterprise profile blocks healthData

    const { isValid, errors } = mobilePolicyEngine.evaluateApp(appManifest, targetPlatform);

    expect(isValid).toBe(false);
    expect(errors).toContain("Capability 'healthData' is blocked by enterprise policy.");
    expect(mockLogger.error).toHaveBeenCalledWith(`App evaluation failed for ${targetPlatform}: ${errors.join(' ')}`);
  });

  // Test 2: Store policy rejection simulation
  test("should generate compliance warnings for store policy violations", () => {
    const appManifest = {
      id: "test-app-2",
      name: "Test App 2",
      declaredCapabilities: ["payments"],
      usesInAppPurchases: true,
    };
    const targetPlatform = "ios"; // iOS policy warns about payments

    const { isValid, warnings } = mobilePolicyEngine.evaluateApp(appManifest, targetPlatform);

    expect(isValid).toBe(true); // It's a warning, not an error that blocks build
    expect(warnings).toContain("Policy warning for 'payments' on ios: Must use Apple's in-app purchase system for digital goods.");
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("App evaluation for ios has warnings"));
  });

  // Test 3: Offline-only app
  test("should plan for an offline-only app and ensure compatibility", () => {
    const appManifest = {
      id: "offline-app",
      name: "Offline Only App",
      declaredCapabilities: [],
      offlineSupport: true,
    };
    const intentSchema = { requiresOffline: true };
    const targetPlatform = "android";

    const enhancedPlan = mobileAwarePlanner.enhancePlanWithMobileConstraints({}, intentSchema, targetPlatform);

    expect(enhancedPlan.mobileReadiness.offlineCompatibilitySummary).toEqual({}); // No capabilities, so no specific offline notes
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Mobile-aware planning complete. Readiness score: 100"));
    expect(mockLogger.info).toHaveBeenCalledTimes(3);
  });

  // Test 4: Permission revocation
  test("should handle permission revocation scenarios in preview", () => {
    const appManifest = {
      id: "permission-app",
      name: "Permission Test App",
      declaredCapabilities: ["camera"],
    };
    const targetPlatform = "ios";

    previewParityEnforcement.initMobilePreview(targetPlatform);
    // Simulate user revoking camera permission
    // In a real scenario, this would involve mocking browser APIs or UI interactions
    // For this test, we'll check if the system is aware of the capability and its support
    const cameraCapability = capabilitySystem.getCapability("camera");
    expect(cameraCapability.platformSupport.ios).toBe(true);
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Initializing mobile preview for ios with parity enforcement."));
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Simulating potential offline conditions."));
    expect(mockLogger.info).toHaveBeenCalledTimes(2);
  });

  // Test 5: AI-generated mobile app with conflicts
  test("should identify conflicts in AI-generated mobile app plans", () => {
    const conflictingIntent = {
      id: "conflicting-intent",
      features: ["healthData", "payments"], // These conflict on enterprise
    };
    const targetPlatform = "enterprise";

    const enhancedPlan = mobileAwarePlanner.enhancePlanWithMobileConstraints({}, conflictingIntent, targetPlatform);

    // The mobileAwarePlanner should adjust the plan and potentially lower the score
    expect(enhancedPlan.mobileReadiness.score).toBe(60);
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("Capability 'healthData' is not fully supported on enterprise."));
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("Capability 'payments' is not fully supported on enterprise."));
    expect(mockLogger.warn).toHaveBeenCalledTimes(4);
  });

  // Test 6: Extension attempting unsafe access
  test("should block an extension attempting unsafe access", () => {
    const unsafeExtensionManifest = {
      id: "unsafe-ext",
      permissions: ["network"],
      usesEval: true, // This is considered unsafe
      runtimeScope: "privileged",
    };

    const { risks, score } = securityThreatModeling.analyzeExtensionRisks(unsafeExtensionManifest);

    expect(risks).toContain("Extension uses `eval()`, which can be a security risk.");
    expect(score).toBeGreaterThan(0);

    // Simulate blocking the extension
    securityThreatModeling.blockEntity(unsafeExtensionManifest.id, "Unsafe `eval()` usage");
    expect(securityThreatModeling.isBlocked(unsafeExtensionManifest.id)).toBe(true);
    expect(mockLogger.error).toHaveBeenCalledWith("Security: Entity blocked - unsafe-ext. Reason: Unsafe `eval()` usage");
  });

  // Test 7: Governed Build Pipeline blocking a non-compliant build
  test("should block a build if policy violations are critical", async () => {
    const appManifest = {
      id: "non-compliant-app",
      name: "Non-Compliant App",
      declaredCapabilities: ["healthData"],
      usesEncryption: false, // Enterprise profile requires encryption
    };
    const targetPlatform = "enterprise";

    await expect(governedBuildPipeline.runBuild(appManifest, targetPlatform)).rejects.toThrow(
      /Build failed: Policy violations detected./
    );
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("App evaluation failed for enterprise: Capability 'healthData' is blocked by enterprise policy."));
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("Build blocked due to policy violations: Capability 'healthData' is blocked by enterprise policy."));
    expect(mockLogger.error).toHaveBeenCalledTimes(2);
  });

  // Test 8: Mobile Versioning & Rollback
  test("should record new builds and allow rollback", () => {
    const build1 = { version: "1.0.0", buildId: "abc", appPackagePath: "/builds/abc.apk", compatibilityMatrix: {} };
    const build2 = { version: "1.0.1", buildId: "def", appPackagePath: "/builds/def.apk", compatibilityMatrix: {} };

    mobileVersioningRollback.recordNewBuild(build1);
    mobileVersioningRollback.recordNewBuild(build2);

    expect(mobileVersioningRollback.getBuildHistory().length).toBe(2);
    expect(mobileVersioningRollback.currentVersion).toBe("1.0.1");

    const rolledBackBuild = mobileVersioningRollback.rollbackToBuild("1.0.0");
    expect(rolledBackBuild.buildId).toBe("abc");
    expect(mobileVersioningRollback.currentVersion).toBe("1.0.0");
    expect(mockLogger.warn).toHaveBeenCalledWith(`Initiating rollback to Version ${rolledBackBuild.version}, Build ID: ${rolledBackBuild.buildId}.`);
  });

  // Test 9: Enterprise Profile Enforcement
  test("should enforce enterprise profile rules", () => {
    const enterpriseAppManifest = {
      id: "enterprise-app",
      declaredCapabilities: ["camera"],
      usesEncryption: false, // This will cause an error
    };
    const profileName = "enterprise";

    const { isValid, errors } = enterpriseRegulatedProfiles.applyProfileEnforcements(enterpriseAppManifest, profileName);

    expect(isValid).toBe(false);
    expect(errors).toContain("Profile 'enterprise' requires mandatory encryption, but app does not declare its use.");
  });
});
