import { describe, expect, it } from "vitest";

import {
  pilotAssets,
  pilotComponents,
  pilotFurnitureDefinitions,
  pilotFurniturePresets,
  pilotHardware,
  pilotMaterials,
} from "./pilotFurnitureCatalog";
import { validateInteractiveParameters } from "./furnitureCompositionEngine";

describe("pilot furniture catalog", () => {
  it("exposes exactly 10 user-visible presets backed by 4 reusable definitions", () => {
    expect(pilotFurniturePresets).toHaveLength(10);
    expect(Object.keys(pilotFurnitureDefinitions)).toHaveLength(4);

    for (const preset of pilotFurniturePresets) {
      expect(pilotFurnitureDefinitions[preset.furnitureDefinitionId]).toBeDefined();
    }
  });

  it("keeps every component, material, hardware and asset reference resolvable", () => {
    for (const definition of Object.values(pilotFurnitureDefinitions)) {
      for (const slot of definition.componentSlots) {
        expect(pilotComponents[slot.componentDefinitionId], `${definition.code}:${slot.slotId}`).toBeDefined();
      }
      for (const assignment of definition.defaultMaterialAssignments) {
        expect(pilotMaterials[assignment.materialId], `${definition.code}:${assignment.role}`).toBeDefined();
        if (assignment.edgeBandId) {
          expect(pilotMaterials[assignment.edgeBandId], `${definition.code}:${assignment.role}:edge`).toBeDefined();
        }
      }
    }

    for (const material of Object.values(pilotMaterials)) {
      if (material.visualAssetId) expect(pilotAssets[material.visualAssetId]).toBeDefined();
    }

    for (const hardware of Object.values(pilotHardware)) {
      if (hardware.assetId) expect(pilotAssets[hardware.assetId]).toBeDefined();
    }
  });

  it("validates all 10 preset parameter sets against their definitions", () => {
    for (const preset of pilotFurniturePresets) {
      const definition = pilotFurnitureDefinitions[preset.furnitureDefinitionId];
      expect(definition).toBeDefined();
      const result = validateInteractiveParameters(definition!, { ...preset.parameters });
      expect(result.valid, `${preset.presetId}: ${JSON.stringify(result.issues)}`).toBe(true);
    }
  });

  it("contains the requested base, drawer, wall and tall families", () => {
    expect(pilotFurniturePresets.map((p) => p.presetId)).toEqual([
      "base-1-door-left",
      "base-1-door-right",
      "base-2-doors",
      "base-drawers-2",
      "base-drawers-3",
      "base-drawers-4",
      "wall-1-door-left",
      "wall-1-door-right",
      "wall-2-doors",
      "tall-pantry-2-doors",
    ]);
  });

  it("models shelves as horizontal reusable components without embedding a rotation", () => {
    const shelf = pilotComponents["component-shelf"];
    expect(shelf).toBeDefined();
    expect(shelf!.boardLocal).toBe("horizontal");
    expect(shelf!.category).toBe("shelf");
    expect("rotationDeg" in shelf!).toBe(false);
  });
});
