import { describe, expect, it } from "vitest";

import {
  cabinetCatalog,
  cabinetEnvelope,
  cloneCabinetEnvelope,
  mutateCabinetEnvelope,
} from "./__fixtures__/sketchupAuthoringCabinet";
import { cabinetJoineryCatalog } from "./__fixtures__/sketchupJoineryCatalogFixture";
import { runManufacturingPreflight } from "./sketchupPreflight";
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
