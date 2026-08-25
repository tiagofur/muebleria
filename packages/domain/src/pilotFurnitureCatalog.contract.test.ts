import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { pilotFurnitureCatalog } from "./pilotFurnitureCatalog";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const contractPath = join(repoRoot, "contracts", "pilotFurnitureCatalog.json");

describe("pilotFurnitureCatalog shared contract (contracts/pilotFurnitureCatalog.json)", () => {
  it("is the golden interchange artifact for Go and the SketchUp extension", () => {
    const contract = JSON.parse(readFileSync(contractPath, "utf8")) as Record<string, unknown>;

    expect(contract.schemaId).toBe("granete.pilotFurnitureCatalog.v1");
    expect(contract.revisionId).toBe("pilot-rev-1");
    expect(contract).toEqual({
      schemaId: "granete.pilotFurnitureCatalog.v1",
      revisionId: "pilot-rev-1",
      ...JSON.parse(JSON.stringify(pilotFurnitureCatalog)),
    });
  });
});
