import { describe, expect, it } from "vitest";

import {
  cabinetCatalog,
  cabinetEnvelope,
  cloneCabinetEnvelope,
  mutateCabinetEnvelope,
} from "./__fixtures__/sketchupAuthoringCabinet";
import { cabinetJoineryCatalog } from "./__fixtures__/sketchupJoineryCatalogFixture";
import {
  DRILLING_CAPABILITY_ID,
  PANEL_GEOMETRY_CAPABILITY_ID,
  runManufacturingPreflight,
  type MachineProfile,
  type PreflightOverride,
} from "./sketchupPreflight";
import type { SketchUpJoineryCatalog } from "./sketchupJoineryCatalog";

describe("runManufacturingPreflight — minimum authoritative preflight milestone (#347)", () => {
  it("passes cleanly (status: ready) for the canonical valid cabinet fixture", () => {
    const result = runManufacturingPreflight(
      cabinetEnvelope,
      cabinetCatalog,
      cabinetJoineryCatalog,
    );

    expect(result.status).toBe("ready");
    expect(result.issues).toEqual([]);
    expect(result.identity.projectId).toBe("project-42");
    expect(result.identity.designRevisionId).toBe("rev-source-rev-8");
    expect(result.identity.bomFingerprint).toMatch(/^fnv1a-/);
    expect(result.derivedHardwarePlacements.length).toBeGreaterThan(0);
    expect(result.derivedMachiningOperations.length).toBeGreaterThan(0);
  });

  it("detects critical drilling collisions and BLOCKS manufacturing with zero output", () => {
    // Position a manual hardware item on the left side panel exactly where shelf-01 holes are located (Y=350, face=front/inside)
    const collidingEnvelope = mutateCabinetEnvelope((e) => {
      e.assemblies[0]!.hardwarePlacements!.push({
        hardwarePlacementId: "hp-conflict-01",
        catalogHardwareId: "hinge-softclose-110",
        hostComponentInstanceId: "side-left-01",
        anchorFace: "inside",
        offsetMm: [50, 350], // collides with minifix at x=50, y=350
        rotationDeg: 0,
      });
    });

    const result = runManufacturingPreflight(
      collidingEnvelope,
      cabinetCatalog,
      cabinetJoineryCatalog,
    );

    expect(result.status).toBe("blocked");
    const issueCodes = result.issues.map((i) => i.code);
    expect(issueCodes).toContain("DRILLING_CONFLICT");

    // Negative proof: Zero fabricable operations released on critical conflict
    expect(result.derivedMachiningOperations).toEqual([]);
    expect(result.derivedHardwarePlacements).toEqual([]);
  });

  it("blocks manufacturing when a shelf relationship is geometrically out-of-bounds", () => {
    const outOfBoundsEnvelope = mutateCabinetEnvelope((e) => {
      const shelf = e.assemblies[0]!.components!.find((c) => c.componentInstanceId === "shelf-02")!;
      shelf.transform.translationMm = [18, 0, 850]; // exceeding 720mm side panel height
    });

    const result = runManufacturingPreflight(
      outOfBoundsEnvelope,
      cabinetCatalog,
      cabinetJoineryCatalog,
    );

    expect(result.status).toBe("blocked");
    expect(result.issues.map((i) => i.code)).toContain("RELATIONSHIP_INVALID");
    expect(result.derivedMachiningOperations).toEqual([]);
  });

  it("blocks manufacturing when drilling depth exceeds panel thickness", () => {
    const invalidJoineryCatalog: SketchUpJoineryCatalog = {
      ...cabinetJoineryCatalog,
      joinerySystems: {
        ...cabinetJoineryCatalog.joinerySystems,
        "minifix-dowel": {
          ...cabinetJoineryCatalog.joinerySystems["minifix-dowel"]!,
          camDepthMm: 22, // exceeds 18mm thickness
        },
      },
    };

    const result = runManufacturingPreflight(
      cabinetEnvelope,
      cabinetCatalog,
      invalidJoineryCatalog,
    );

    expect(result.status).toBe("blocked");
    expect(result.issues.map((i) => i.code)).toContain("DRILLING_INVALID");
    expect(result.derivedMachiningOperations).toEqual([]);
  });

  it("blocks manufacturing when a component definition is missing from the geometry catalog", () => {
    const missingGeomCatalog: SketchUpJoineryCatalog = {
      ...cabinetJoineryCatalog,
      componentGeometry: {
        "definition-side-panel": cabinetJoineryCatalog.componentGeometry["definition-side-panel"]!,
        // definition-shelf omitted
      },
    };

    const result = runManufacturingPreflight(
      cabinetEnvelope,
      cabinetCatalog,
      missingGeomCatalog,
    );

    expect(result.status).toBe("blocked");
    expect(result.issues.map((i) => i.code)).toContain("CATALOG_REFERENCE_MISSING");
    expect(result.derivedMachiningOperations).toEqual([]);
  });

  it("blocks manufacturing when an anchor references an orphaned component instance", () => {
    const orphanEnvelope = mutateCabinetEnvelope((e) => {
      e.assemblies[0]!.relationships![0]!.targets = [
        { componentInstanceId: "side-non-existent", role: "inside-face" },
      ];
    });

    const result = runManufacturingPreflight(
      orphanEnvelope,
      cabinetCatalog,
      cabinetJoineryCatalog,
    );

    expect(result.status).toBe("blocked");
    expect(result.issues.map((i) => i.code)).toContain("RELATIONSHIP_ORPHANED");
    expect(result.derivedMachiningOperations).toEqual([]);
  });
});

describe("runManufacturingPreflight — full Definition of Done (#347)", () => {
  const capableMachine: MachineProfile = {
    ref: { machineProfileId: "machine-alpha", machineProfileRevisionId: "rev-3" },
    supported: [
      {
        capabilityId: DRILLING_CAPABILITY_ID,
        version: "1",
        constraints: { minDiameterMm: 5, maxDiameterMm: 40, maxDepthMm: 30 },
      },
      {
        capabilityId: PANEL_GEOMETRY_CAPABILITY_ID,
        version: "1",
        constraints: { maxLengthMm: 2440, maxWidthMm: 1220, maxThicknessMm: 30 },
      },
    ],
  };

  it("is deterministic: same fixture produces the same fingerprint and capabilities", () => {
    const first = runManufacturingPreflight(cabinetEnvelope, cabinetCatalog, cabinetJoineryCatalog);
    const second = runManufacturingPreflight(cloneCabinetEnvelope(), cabinetCatalog, cabinetJoineryCatalog);

    expect(second.identity.bomFingerprint).toBe(first.identity.bomFingerprint);
    expect(second.requiredCapabilities).toEqual(first.requiredCapabilities);
    expect(second.issues).toEqual(first.issues);
  });

  it("derives required capabilities from resolved manufacturing truth, not authoring claims", () => {
    const result = runManufacturingPreflight(cabinetEnvelope, cabinetCatalog, cabinetJoineryCatalog);

    expect(result.requiredCapabilities.map((c) => c.capabilityId)).toEqual([
      DRILLING_CAPABILITY_ID,
      PANEL_GEOMETRY_CAPABILITY_ID,
    ]);
    const drilling = result.requiredCapabilities.find(
      (c) => c.capabilityId === DRILLING_CAPABILITY_ID,
    )!;
    // dowels Ø8 … hinge Ø35; dowel end depth 20mm is the deepest hole
    expect(drilling.constraints).toEqual({
      minDiameterMm: 8,
      maxDiameterMm: 35,
      maxDepthMm: 20,
    });
    const panels = result.requiredCapabilities.find(
      (c) => c.capabilityId === PANEL_GEOMETRY_CAPABILITY_ID,
    )!;
    expect(panels.constraints).toEqual({ maxLengthMm: 720, maxWidthMm: 570, maxThicknessMm: 18 });
  });

  it("negotiates cleanly against a capable machine profile", () => {
    const result = runManufacturingPreflight(
      cabinetEnvelope,
      cabinetCatalog,
      cabinetJoineryCatalog,
      { machineProfile: capableMachine },
    );

    expect(result.status).toBe("ready");
    expect(result.machineNegotiation?.machineProfile.machineProfileId).toBe("machine-alpha");
    expect(result.machineNegotiation?.unsupported).toEqual([]);
    expect(result.derivedMachiningOperations.length).toBeGreaterThan(0);
  });

  it("blocks before export when the machine does not declare a required capability", () => {
    const machineWithoutDrilling: MachineProfile = {
      ...capableMachine,
      supported: capableMachine.supported.filter(
        (c) => c.capabilityId !== DRILLING_CAPABILITY_ID,
      ),
    };

    const result = runManufacturingPreflight(cabinetEnvelope, cabinetCatalog, cabinetJoineryCatalog, {
      machineProfile: machineWithoutDrilling,
    });

    expect(result.status).toBe("blocked");
    const issue = result.issues.find((i) => i.code === "MACHINE_CAPABILITY_UNSUPPORTED");
    expect(issue).toBeDefined();
    expect(issue!.details?.capabilityId).toBe(DRILLING_CAPABILITY_ID);
    expect(result.machineNegotiation?.unsupported).toHaveLength(1);
    expect(result.derivedMachiningOperations).toEqual([]);
    expect(result.derivedHardwarePlacements).toEqual([]);
  });

  it("blocks when a declared machine constraint cannot cover the resolved requirement", () => {
    const shallowMachine: MachineProfile = {
      ...capableMachine,
      supported: capableMachine.supported.map((c) =>
        c.capabilityId === DRILLING_CAPABILITY_ID
          ? { ...c, constraints: { ...c.constraints, maxDepthMm: 10 } }
          : c,
      ),
    };

    const result = runManufacturingPreflight(cabinetEnvelope, cabinetCatalog, cabinetJoineryCatalog, {
      machineProfile: shallowMachine,
    });

    expect(result.status).toBe("blocked");
    const issue = result.issues.find((i) => i.code === "MACHINE_CAPABILITY_UNSUPPORTED")!;
    expect(issue.details).toMatchObject({ constraint: "maxDepthMm", machineValue: 10, requiredValue: 20 });
  });

  it("blocks when the machine omits a constraint the model requires — capabilities are never inferred", () => {
    const vagueMachine: MachineProfile = {
      ...capableMachine,
      supported: capableMachine.supported.map((c) =>
        c.capabilityId === DRILLING_CAPABILITY_ID
          ? { ...c, constraints: { minDiameterMm: 5, maxDiameterMm: 40 } }
          : c,
      ),
    };

    const result = runManufacturingPreflight(cabinetEnvelope, cabinetCatalog, cabinetJoineryCatalog, {
      machineProfile: vagueMachine,
    });

    expect(result.status).toBe("blocked");
    expect(
      result.issues.find((i) => i.code === "MACHINE_CAPABILITY_UNSUPPORTED")?.details,
    ).toMatchObject({ constraint: "maxDepthMm" });
  });

  it("blocks on capability version mismatch", () => {
    const newerMachine: MachineProfile = {
      ...capableMachine,
      supported: capableMachine.supported.map((c) =>
        c.capabilityId === DRILLING_CAPABILITY_ID ? { ...c, version: "2" } : c,
      ),
    };

    const result = runManufacturingPreflight(cabinetEnvelope, cabinetCatalog, cabinetJoineryCatalog, {
      machineProfile: newerMachine,
    });

    expect(result.status).toBe("blocked");
    expect(
      result.issues.find((i) => i.code === "MACHINE_CAPABILITY_UNSUPPORTED")?.details,
    ).toMatchObject({ machineVersion: "2", requiredVersion: "1" });
  });

  it("applies a server-authoritative override as an audited downgrade, never a silent bypass", () => {
    const machineWithoutDrilling: MachineProfile = {
      ...capableMachine,
      supported: capableMachine.supported.filter(
        (c) => c.capabilityId !== DRILLING_CAPABILITY_ID,
      ),
    };
    const overrides: readonly PreflightOverride[] = [
      {
        overrideId: "ovr-01",
        code: "MACHINE_CAPABILITY_UNSUPPORTED",
        capabilityId: DRILLING_CAPABILITY_ID,
        reason: "Pilot machine missing declaration; field-validated in dossier #352",
        approvedBy: "production-lead",
        approvedAt: "2026-08-26T12:00:00Z",
      },
    ];

    const result = runManufacturingPreflight(cabinetEnvelope, cabinetCatalog, cabinetJoineryCatalog, {
      machineProfile: machineWithoutDrilling,
      overrides,
    });

    expect(result.status).toBe("warning");
    const issue = result.issues.find((i) => i.code === "MACHINE_CAPABILITY_UNSUPPORTED")!;
    expect(issue.severity).toBe("warning");
    expect(issue.details?.override).toMatchObject({
      overrideId: "ovr-01",
      approvedBy: "production-lead",
      approvedAt: "2026-08-26T12:00:00Z",
    });
    // The negotiation view carries the same downgraded, audited issue
    expect(result.machineNegotiation?.unsupported[0]?.severity).toBe("warning");
    // Audited override releases output
    expect(result.derivedMachiningOperations.length).toBeGreaterThan(0);
  });

  it("never lets an override bypass critical ambiguity such as a drilling collision", () => {
    const collidingEnvelope = mutateCabinetEnvelope((e) => {
      e.assemblies[0]!.hardwarePlacements!.push({
        hardwarePlacementId: "hp-conflict-02",
        catalogHardwareId: "hinge-softclose-110",
        hostComponentInstanceId: "side-left-01",
        anchorFace: "inside",
        offsetMm: [50, 350],
        rotationDeg: 0,
      });
    });
    // Runtime-forged override outside the allowed code union must be ignored
    const forged = {
      overrideId: "ovr-bad",
      code: "DRILLING_CONFLICT",
      reason: "should not apply",
      approvedBy: "nobody",
      approvedAt: "2026-08-26T12:00:00Z",
    } as unknown as PreflightOverride;

    const result = runManufacturingPreflight(collidingEnvelope, cabinetCatalog, cabinetJoineryCatalog, {
      machineProfile: capableMachine,
      overrides: [forged],
    });

    expect(result.status).toBe("blocked");
    expect(result.issues.find((i) => i.code === "DRILLING_CONFLICT")?.severity).toBe("error");
    expect(result.derivedMachiningOperations).toEqual([]);
  });

  it("marks outputs stale when current truth no longer matches the released fingerprint", () => {
    const result = runManufacturingPreflight(cabinetEnvelope, cabinetCatalog, cabinetJoineryCatalog, {
      release: {
        releasedDesignRevisionId: "rev-source-rev-7",
        releasedBomFingerprint: "fnv1a-deadbeef",
        releasedAt: "2026-08-20T10:00:00Z",
      },
    });

    expect(result.status).toBe("blocked");
    const issue = result.issues.find((i) => i.code === "REVISION_STALE")!;
    expect(issue.severity).toBe("error");
    expect(issue.details).toMatchObject({
      releasedBomFingerprint: "fnv1a-deadbeef",
      currentBomFingerprint: result.identity.bomFingerprint,
    });
    expect(result.derivedMachiningOperations).toEqual([]);
  });

  it("does not flag staleness when the released fingerprint still matches", () => {
    const first = runManufacturingPreflight(cabinetEnvelope, cabinetCatalog, cabinetJoineryCatalog);

    const result = runManufacturingPreflight(cabinetEnvelope, cabinetCatalog, cabinetJoineryCatalog, {
      release: {
        releasedDesignRevisionId: first.identity.designRevisionId,
        releasedBomFingerprint: first.identity.bomFingerprint,
        releasedAt: "2026-08-20T10:00:00Z",
      },
    });

    expect(result.status).toBe("ready");
    expect(result.issues.find((i) => i.code === "REVISION_STALE")).toBeUndefined();
  });

  it("allows stale production only through an audited override (warning, output released)", () => {
    const result = runManufacturingPreflight(cabinetEnvelope, cabinetCatalog, cabinetJoineryCatalog, {
      release: {
        releasedDesignRevisionId: "rev-source-rev-7",
        releasedBomFingerprint: "fnv1a-deadbeef",
        releasedAt: "2026-08-20T10:00:00Z",
      },
      overrides: [
        {
          overrideId: "ovr-stale-01",
          code: "REVISION_STALE",
          reason: "Rework order approved by workshop manager",
          approvedBy: "workshop-manager",
          approvedAt: "2026-08-26T13:00:00Z",
        },
      ],
    });

    expect(result.status).toBe("warning");
    const issue = result.issues.find((i) => i.code === "REVISION_STALE")!;
    expect(issue.severity).toBe("warning");
    expect(issue.details?.override).toMatchObject({ overrideId: "ovr-stale-01" });
    expect(result.derivedMachiningOperations.length).toBeGreaterThan(0);
  });

  it("every error issue is locatable and actionable: code, message, entityId, path, severity, remediation", () => {
    const invalidJoineryCatalog: SketchUpJoineryCatalog = {
      ...cabinetJoineryCatalog,
      joinerySystems: {
        ...cabinetJoineryCatalog.joinerySystems,
        "minifix-dowel": {
          ...cabinetJoineryCatalog.joinerySystems["minifix-dowel"]!,
          camDepthMm: 22,
        },
      },
    };
    const scenarios = [
      runManufacturingPreflight(cabinetEnvelope, cabinetCatalog, invalidJoineryCatalog),
      runManufacturingPreflight(
        mutateCabinetEnvelope((e) => {
          e.assemblies[0]!.relationships![0]!.targets = [
            { componentInstanceId: "side-non-existent", role: "inside-face" },
          ];
        }),
        cabinetCatalog,
        cabinetJoineryCatalog,
      ),
      runManufacturingPreflight(cabinetEnvelope, cabinetCatalog, cabinetJoineryCatalog, {
        machineProfile: {
          ...capableMachine,
          supported: capableMachine.supported.slice(0, 1),
        },
      }),
      runManufacturingPreflight(cabinetEnvelope, cabinetCatalog, cabinetJoineryCatalog, {
        release: {
          releasedDesignRevisionId: "rev-source-rev-7",
          releasedBomFingerprint: "fnv1a-deadbeef",
          releasedAt: "2026-08-20T10:00:00Z",
        },
      }),
    ];

    for (const result of scenarios) {
      for (const issue of result.issues) {
        if (issue.severity !== "error") continue;
        expect(issue.code, `${issue.code} needs code`).toBeTruthy();
        expect(issue.message, `${issue.code} needs message`).toBeTruthy();
        expect(issue.entityId, `${issue.code} needs entityId`).toBeTruthy();
        expect(issue.path, `${issue.code} needs path`).toBeTruthy();
        expect(issue.remediation, `${issue.code} needs remediation`).toBeTruthy();
      }
    }
  });
});
