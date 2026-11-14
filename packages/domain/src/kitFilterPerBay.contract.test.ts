import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveModuleAgregadoAssembliesDetailed } from './agregadoAssembly';
import type { AgregadoRigidMember, ProductVariant } from './agregadoAssembly';
import type { Agregado, Catalog, Hardware, Module, Structure } from './types';

// #1613 ronda 4: paridad TS↔Go del filtro por kit efectivo. Autoridad única:
// contracts/fixtures/kitFilterPerBay.contract.json — ambos lados CONSTRUYEN
// catálogo y receta desde el JSON (patrón accessoryKitParity). El espejo Go
// vive en backend-go/internal/domain/engine/kit_filter_per_bay_parity_test.go.

interface KitFilterFixture {
  kits: {
    id: string;
    code: string;
    variantHardwareId: string;
    nominalDimensionMm: number;
    parts: { id: string; code: string }[];
  }[];
  looseHardware: { id: string; code: string; memberId: string }[];
  agregado: { id: string; code: string; variantSetId: string };
  module: { widthMm: number; heightMm: number; depthMm: number };
  bays: { id: string; heightFormula: string; expectedHardwareCounts: Record<string, number> }[];
}

const FIXTURE_PATH = resolve(__dirname, '../../../contracts/fixtures/kitFilterPerBay.contract.json');
const f = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as KitFilterFixture;

describe('#1613 ronda 4 — filtro por kit efectivo (paridad con Go)', () => {
  it('cada bahía dibuja sólo las piezas de su kit + el herraje suelto sin kit', () => {
    const variants: ProductVariant[] = f.kits.map(
      (k): ProductVariant => ({
        nominalDimensionMm: k.nominalDimensionMm,
        hardwareId: k.variantHardwareId,
        commercialKitHardwareId: k.id,
      }),
    );

    const hardware: Hardware[] = [];
    // La receta persiste la UNIÓN de los kits (patrón rev 17 del sync web):
    // miembros fijos de TODAS las partes de TODOS los kits × mano + sueltos.
    const members: AgregadoRigidMember[] = [];
    const member = (
      id: string,
      hwId: string,
      hand: 'left' | 'right' | undefined,
      xRef: 'min' | 'max',
    ): AgregadoRigidMember => ({
      memberId: id,
      role: 'drawer_guide',
      source: { kind: 'fixed', fixed: { hardwareId: hwId } },
      placement: { x: { ref: xRef, offsetMm: 0 }, y: { ref: 'min', offsetMm: 0 }, z: { ref: 'min', offsetMm: 0 } },
      bomRole: 'included_in_kit',
      ...(hand ? { hand } : {}),
    });

    for (const kit of f.kits) {
      hardware.push({
        id: kit.variantHardwareId,
        code: kit.code,
        name: kit.code,
        unit: 'set',
        costPerUnit: 200,
        active: true,
      } as unknown as Hardware);
      for (const part of kit.parts) {
        hardware.push({
          id: part.id,
          code: part.code,
          name: part.code,
          unit: 'piece',
          costPerUnit: 100,
          active: true,
          kitHardwareId: kit.id,
          pieces: [
            { anchor: 'left', offsetMm: { x: 0, y: 0, z: 0 } },
            { anchor: 'right', offsetMm: { x: 0, y: 0, z: 0 } },
          ],
        } as unknown as Hardware);
        members.push(member(`part-${part.id}-left`, part.id, 'left', 'min'));
        members.push(member(`part-${part.id}-right`, part.id, 'right', 'max'));
      }
    }
    for (const loose of f.looseHardware) {
      hardware.push({
        id: loose.id,
        code: loose.code,
        name: loose.code,
        unit: 'piece',
        costPerUnit: 5,
        active: true,
      } as unknown as Hardware);
      members.push(member(loose.memberId, loose.id, undefined, 'min'));
    }

    const agr: Agregado = {
      id: f.agregado.id,
      code: f.agregado.code,
      name: f.agregado.code,
      active: true,
      variantSets: [{ id: f.agregado.variantSetId, dimension: 'height', variants }],
      rigidMembers: members,
      components: [],
      hardwareLines: [],
    } as unknown as Agregado;

    const structure: Structure = {
      id: 'st-base',
      code: 'ST-BASE',
      name: 'Cuerpo',
      components: [],
      agregados: [],
      active: true,
    } as unknown as Structure;

    const module: Module = {
      id: 'mod-cajonera',
      code: 'CAJONERA',
      name: 'Cajonera',
      structureId: 'st-base',
      externalDims: { width: f.module.widthMm, height: f.module.heightMm, depth: f.module.depthMm },
      agregados: f.bays.map((bay) => ({
        id: bay.id,
        agregadoId: agr.id,
        quantity: 1,
        dimensions: { heightFormula: bay.heightFormula },
      })),
      hardwareLines: [],
    } as unknown as Module;

    const catalog = {
      structures: [structure],
      agregados: [agr],
      hardware,
      components: [],
      materials: [],
      optionGroups: [],
    } as unknown as Catalog;

    const detailed = resolveModuleAgregadoAssembliesDetailed(
      module,
      { width: f.module.widthMm, height: f.module.heightMm, depth: f.module.depthMm },
      catalog,
      {},
    );

    expect(detailed.rejections).toHaveLength(0);
    expect(detailed.assemblies).toHaveLength(f.bays.length);
    for (const bay of f.bays) {
      const asm = detailed.assemblies.find((a) => a.assemblyInstanceId === bay.id);
      expect(asm, `ensamble de ${bay.id}`).toBeDefined();
      const counts: Record<string, number> = {};
      for (const rm of asm!.resolvedAssembly!.rigidMembers) {
        counts[rm.hardwareId] = (counts[rm.hardwareId] ?? 0) + 1;
      }
      expect(Object.keys(counts).sort()).toEqual(Object.keys(bay.expectedHardwareCounts).sort());
      for (const [hwId, want] of Object.entries(bay.expectedHardwareCounts)) {
        expect(counts[hwId], `${bay.id} → ${hwId}`).toBe(want);
      }
    }
  });
});
