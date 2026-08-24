import { describe, expect, it } from "vitest";

import {
  cabinetCatalog,
} from "./__fixtures__/sketchupAuthoringCabinet";
import { cabinetJoineryCatalog } from "./__fixtures__/sketchupJoineryCatalogFixture";
import {
  closetTowerDefinition,
  kitchenBaseDefinition,
  sampleComponents,
  sampleHardware,
  sampleMaterials,
  workstationDeskDefinition,
} from "./__fixtures__/smartFurnitureFixtures";
import { instantiateFurniture } from "./furnitureCompositionEngine";
import { runManufacturingPreflight } from "./sketchupPreflight";

describe("Smart Parametric Furniture Library (#349)", () => {
  it("instantiates a standard kitchen base cabinet and passes preflight cleanly", () => {
    const result = instantiateFurniture(
      kitchenBaseDefinition,
      { widthMm: 600, heightMm: 720, depthMm: 590, shelfCount: 1, doorCount: 1 },
      sampleComponents,
      sampleMaterials,
      sampleHardware,
      { projectId: "project-42", sourceRevisionId: "rev-1" },
    );

    expect(result.success).toBe(true);
    expect(result.envelope).toBeDefined();

    const preflight = runManufacturingPreflight(
      result.envelope!,
      cabinetCatalog,
      cabinetJoineryCatalog,
    );

    expect(preflight.status).toBe("ready");
    expect(preflight.issues).toEqual([]);
    expect(preflight.identity.bomFingerprint).toMatch(/^fnv1a-/);
    expect(preflight.derivedMachiningOperations.length).toBeGreaterThan(0);
  });

  it("dynamically recalculates assembly geometry when parameters change (600mm -> 800mm, height 720 -> 850)", () => {
    const res600 = instantiateFurniture(
      kitchenBaseDefinition,
      { widthMm: 600, heightMm: 720, depthMm: 590 },
      sampleComponents,
      sampleMaterials,
      sampleHardware,
      { projectId: "project-42" },
    );
    const res800 = instantiateFurniture(
      kitchenBaseDefinition,
      { widthMm: 800, heightMm: 850, depthMm: 590 },
      sampleComponents,
      sampleMaterials,
      sampleHardware,
      { projectId: "project-42" },
    );

    expect(res600.success).toBe(true);
    expect(res800.success).toBe(true);

    const rightSide600 = res600.envelope!.assemblies[0]!.components!.find((c) => c.componentInstanceId === "side-right-01")!;
    const rightSide800 = res800.envelope!.assemblies[0]!.components!.find((c) => c.componentInstanceId === "side-right-01")!;

    expect(rightSide600.transform.translationMm[0]).toBe(600 - 18);
    expect(rightSide800.transform.translationMm[0]).toBe(800 - 18);

    const preflight600 = runManufacturingPreflight(res600.envelope!, cabinetCatalog, cabinetJoineryCatalog);
    const preflight800 = runManufacturingPreflight(res800.envelope!, cabinetCatalog, cabinetJoineryCatalog);

    expect(preflight600.status).toBe("ready");
    expect(preflight800.status).toBe("ready");
    expect(preflight600.identity.bomFingerprint).not.toBe(preflight800.identity.bomFingerprint);
  });

  it("supports multiple independent shelves sharing the same componentDefinitionId", () => {
    const res = instantiateFurniture(
      kitchenBaseDefinition,
      { widthMm: 800, heightMm: 720, depthMm: 590, shelfCount: 3 },
      sampleComponents,
      sampleMaterials,
      sampleHardware,
      { projectId: "project-42" },
    );

    expect(res.success).toBe(true);
    const shelves = res.envelope!.assemblies[0]!.components!.filter((c) => c.componentDefinitionId === "definition-shelf");
    expect(shelves.length).toBe(3);
    expect(shelves.map((s) => s.componentInstanceId)).toEqual(["shelf-01", "shelf-02", "shelf-03"]);

    const preflight = runManufacturingPreflight(res.envelope!, cabinetCatalog, cabinetJoineryCatalog);
    expect(preflight.status).toBe("ready");
  });

  it("rejects out-of-bounds parameters with structured errors", () => {
    const res = instantiateFurniture(
      kitchenBaseDefinition,
      { widthMm: 2500 }, // Max is 1200
      sampleComponents,
      sampleMaterials,
      sampleHardware,
      { projectId: "project-42" },
    );

    expect(res.success).toBe(false);
    expect(res.issues.length).toBeGreaterThan(0);
    expect(res.issues[0]!.code).toBe("PARAMETER_OUT_OF_RANGE");
  });

  it("supports diverse typologies (closet tower and desk workstation) without hardcoded cabinet assumptions", () => {
    const closetRes = instantiateFurniture(
      closetTowerDefinition,
      { widthMm: 900, heightMm: 2200, depthMm: 550, shelfCount: 5 },
      sampleComponents,
      sampleMaterials,
      sampleHardware,
      { projectId: "project-42" },
    );
    expect(closetRes.success).toBe(true);
    expect(closetRes.envelope!.assemblies[0]!.components!.length).toBe(7); // 2 sides + 5 shelves

    const deskRes = instantiateFurniture(
      workstationDeskDefinition,
      { widthMm: 1400, heightMm: 750, depthMm: 700 },
      sampleComponents,
      sampleMaterials,
      sampleHardware,
      { projectId: "project-42" },
    );
    expect(deskRes.success).toBe(true);
    expect(deskRes.envelope!.assemblies[0]!.components!.length).toBe(3); // worktop + 2 legs
  });
});
