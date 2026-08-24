import { describe, expect, it } from "vitest";

import { cabinetCatalog } from "./__fixtures__/sketchupAuthoringCabinet";
import { cabinetJoineryCatalog } from "./__fixtures__/sketchupJoineryCatalogFixture";
import {
  kitchenBaseDefinition,
  sampleComponents,
  sampleHardware,
  sampleMaterials,
} from "./__fixtures__/smartFurnitureFixtures";
import { instantiateFurniture } from "./furnitureCompositionEngine";
import { repositionHardwarePlacement } from "./sketchupHardwareSync";

describe("Hardware Placement & Machining Sync (#350)", () => {
  it("isolates machining changes: moving a hinge updates only its derived hole and leaves shelf machining untouched", () => {
    const inst = instantiateFurniture(
      kitchenBaseDefinition,
      { widthMm: 600, heightMm: 720, depthMm: 590, shelfCount: 1, doorCount: 1 },
      sampleComponents,
      sampleMaterials,
      sampleHardware,
      { projectId: "project-42", assemblyId: "asm-base-01" },
    );
    expect(inst.success).toBe(true);

    // Initial preflight
    const initialSync = repositionHardwarePlacement(
      inst.envelope!,
      {
        assemblyId: "asm-base-01",
        placementId: "hp-hinge-bottom",
        newOffsetMm: [50, 100],
      },
      cabinetCatalog,
      cabinetJoineryCatalog,
    );
    expect(initialSync.success).toBe(true);

    const initialShelfOps = initialSync.preflight.derivedMachiningOperations.filter(
      (op) => op.provenance.sourceKind === "relationship"
    );
    const initialHingeOp = initialSync.preflight.derivedMachiningOperations.find(
      (op) => op.provenance.sourceKind === "manualHardwarePlacement" && (op.provenance as any).hardwarePlacementId === "hp-hinge-bottom"
    );
    expect(initialHingeOp).toBeDefined();
    expect(initialHingeOp!.detail.holes[0]!.yMm).toBe(100);

    // Move bottom hinge from Y=100 to Y=150
    const movedSync = repositionHardwarePlacement(
      inst.envelope!,
      {
        assemblyId: "asm-base-01",
        placementId: "hp-hinge-bottom",
        newOffsetMm: [50, 150],
      },
      cabinetCatalog,
      cabinetJoineryCatalog,
    );
    expect(movedSync.success).toBe(true);

    const movedShelfOps = movedSync.preflight.derivedMachiningOperations.filter(
      (op) => op.provenance.sourceKind === "relationship"
    );
    const movedHingeOp = movedSync.preflight.derivedMachiningOperations.find(
      (op) => op.provenance.sourceKind === "manualHardwarePlacement" && (op.provenance as any).hardwarePlacementId === "hp-hinge-bottom"
    );

    // 1. Hinge hole moved to Y=150
    expect(movedHingeOp!.detail.holes[0]!.yMm).toBe(150);

    // 2. Shelf machining is completely untouched
    expect(movedShelfOps).toEqual(initialShelfOps);
  });

  it("resolves drilling collisions interactively by repositioning conflicting hardware", () => {
    const inst = instantiateFurniture(
      kitchenBaseDefinition,
      { widthMm: 600, heightMm: 720, depthMm: 590, shelfCount: 1, doorCount: 1 },
      sampleComponents,
      sampleMaterials,
      sampleHardware,
      { projectId: "project-42", assemblyId: "asm-base-01" },
    );

    // Place bottom hinge at Y=360 (colliding with shelf-01 at Z=360)
    const collidingSync = repositionHardwarePlacement(
      inst.envelope!,
      {
        assemblyId: "asm-base-01",
        placementId: "hp-hinge-bottom",
        newOffsetMm: [50, 360],
      },
      cabinetCatalog,
      cabinetJoineryCatalog,
    );

    expect(collidingSync.success).toBe(false);
    expect(collidingSync.preflight.status).toBe("blocked");
    expect(collidingSync.preflight.issues.map((i) => i.code)).toContain("DRILLING_CONFLICT");

    // Reposition hinge away from shelf to Y=200 -> resolves collision!
    const resolvedSync = repositionHardwarePlacement(
      collidingSync.envelope,
      {
        assemblyId: "asm-base-01",
        placementId: "hp-hinge-bottom",
        newOffsetMm: [50, 200],
      },
      cabinetCatalog,
      cabinetJoineryCatalog,
    );

    expect(resolvedSync.success).toBe(true);
    expect(resolvedSync.preflight.status).toBe("ready");
    expect(resolvedSync.preflight.issues).toEqual([]);
  });

  it("enforces strict provenance on derived manual hardware machining", () => {
    const inst = instantiateFurniture(
      kitchenBaseDefinition,
      { widthMm: 600, heightMm: 720, depthMm: 590, shelfCount: 1, doorCount: 1 },
      sampleComponents,
      sampleMaterials,
      sampleHardware,
      { projectId: "project-42", assemblyId: "asm-base-01" },
    );

    const sync = repositionHardwarePlacement(
      inst.envelope!,
      {
        assemblyId: "asm-base-01",
        placementId: "hp-hinge-top",
        newOffsetMm: [50, 620],
      },
      cabinetCatalog,
      cabinetJoineryCatalog,
    );

    expect(sync.success).toBe(true);
    const topHingeOp = sync.preflight.derivedMachiningOperations.find(
      (op) => op.provenance.sourceKind === "manualHardwarePlacement" && (op.provenance as any).hardwarePlacementId === "hp-hinge-top"
    );

    expect(topHingeOp).toBeDefined();
    expect(topHingeOp!.provenance).toEqual({
      sourceKind: "manualHardwarePlacement",
      hardwarePlacementId: "hp-hinge-top",
    });
  });
});
