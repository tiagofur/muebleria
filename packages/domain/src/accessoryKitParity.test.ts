import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveModuleAgregadoAssembliesDetailed,
  type ResolvedModuleAssembly,
} from './agregadoAssembly';
import { resolveBom } from './engine/bom';
import type { Agregado, Catalog, Hardware, Module, OptionGroup, Structure } from './types';
import type { ProductVariant } from './agregadoAssembly';

// #1502: paridad TS↔Go del kit accesorio elegible. Autoridad numérica única:
// contracts/fixtures/accessoryKitParity.contract.json — ambos lados CONSTRUYEN
// catálogo y receta desde el JSON (patrón variantKitQuoteParity). El espejo Go
// vive en backend-go/internal/domain/engine/accessory_kit_parity_test.go.

interface AccessoryKitFixture {
  heights: { code: string; nominalDimensionMm: number; hardwareId: string; kitHardwareId: string }[];
  module: { widthMm: number; heightMm: number; depthMm: number; bayHeightFormula: string };
  accessoryGroup: {
    code: string;
    name: string;
    required: boolean;
    kitHardwareId: string;
    accessories: {
      id: string;
      code: string;
      name: string;
      parts: { id: string; code: string; name: string; label: string; actorMembership: string }[];
    }[];
  };
  chosenAccessoryId: string;
  expectedAccessoryAssembly: { assemblyInstanceId: string; memberHardwareIds: string[] };
  expectedAccessoryKitLine: { id: string; hardwareId: string; quantity: number };
}

const FIXTURE_PATH = resolve(__dirname, '../../../contracts/fixtures/accessoryKitParity.contract.json');
const f = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as AccessoryKitFixture;

expect(f.accessoryGroup.accessories.length).toBeGreaterThanOrEqual(2);

const buildScenario = (required: boolean, linked: boolean) => {
  const hardware: Hardware[] = [];
  const variants: ProductVariant[] = f.heights.map(
    (h): ProductVariant => ({
      nominalDimensionMm: h.nominalDimensionMm,
      hardwareId: h.hardwareId,
      commercialKitHardwareId: h.kitHardwareId,
    }),
  );
  for (const h of f.heights) {
    hardware.push(
      { id: h.hardwareId, code: h.hardwareId, name: h.hardwareId, unit: 'piece', costPerUnit: 100, active: true },
      { id: h.kitHardwareId, code: h.kitHardwareId.toUpperCase(), name: h.kitHardwareId, unit: 'set', costPerUnit: 200, active: true },
    ) as unknown as Hardware[];
  }

  const optionIds: string[] = [];
  for (const acc of f.accessoryGroup.accessories) {
    optionIds.push(acc.id);
    hardware.push({ id: acc.id, code: acc.code, name: acc.name, unit: 'set', costPerUnit: 90, active: true }) as unknown as Hardware;
    for (const part of acc.parts) {
      hardware.push({
        id: part.id,
        code: part.code,
        name: part.name,
        unit: 'piece',
        costPerUnit: 30,
        active: true,
        kitHardwareId: acc.id,
        designParts: [{ componentName: part.code, actorMembership: part.actorMembership, label: part.label }],
      }) as unknown as Hardware;
    }
  }

  const group: OptionGroup = {
    id: 'og-lateral-e',
    code: f.accessoryGroup.code,
    name: f.accessoryGroup.name,
    kind: 'hardware',
    required,
    optionIds,
    ...(linked ? { kitHardwareId: f.accessoryGroup.kitHardwareId } : {}),
  };

  const agr: Agregado = {
    id: 'agr-mbox-acc',
    code: 'MERIVOBOX-ACC',
    name: 'MERIVOBOX con accesorio',
    active: true,
    variantSets: [{ id: 'height-variants', dimension: 'height', variants }],
    rigidMembers: (['min', 'max'] as const).map((ref, i) => ({
      memberId: `side-${i === 0 ? 'left' : 'right'}`,
      role: `drawer_side_${i === 0 ? 'left' : 'right'}`,
      source: { kind: 'variant', variant: { variantSetId: 'height-variants' } },
      placement: { x: { ref, offsetMm: 0 }, y: { ref: 'min', offsetMm: 0 }, z: { ref: 'min', offsetMm: 0 } },
      bomRole: 'included_in_kit',
    })),
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
    id: 'mod-cajonera-acc',
    code: 'CAJONERA-ACC',
    name: 'Cajonera accesorio',
    structureId: 'st-base',
    externalDims: { width: f.module.widthMm, height: f.module.heightMm, depth: f.module.depthMm },
    agregados: [
      { id: 'inst-bajo', agregadoId: agr.id, quantity: 1, dimensions: { heightFormula: f.module.bayHeightFormula } },
    ],
    hardwareLines: [],
  } as unknown as Module;

  const catalog = {
    structures: [structure],
    agregados: [agr],
    hardware,
    components: [],
    materials: [],
    edges: [],
    optionGroups: [group],
  } as unknown as Catalog;

  return { catalog, module, groupCode: f.accessoryGroup.code };
};

const accAssembliesOf = (assemblies: readonly ResolvedModuleAssembly[]) =>
  assemblies.filter((a) => a.assemblyInstanceId.includes('-acc-'));

describe('#1502 — kit accesorio elegible (paridad con Go)', () => {
  it('con elección: ensamble accesorio con las partes del kit elegido + línea de cotización', () => {
    const { catalog, module, groupCode } = buildScenario(true, true);
    const choices = { [groupCode]: f.chosenAccessoryId };

    const detailed = resolveModuleAgregadoAssembliesDetailed(
      module,
      { width: f.module.widthMm, height: f.module.heightMm, depth: f.module.depthMm },
      catalog,
      { optionChoices: choices },
    );
    const acc = accAssembliesOf(detailed.assemblies);
    expect(acc).toHaveLength(1);
    expect(acc[0]!.assemblyInstanceId).toBe(f.expectedAccessoryAssembly.assemblyInstanceId);
    expect(detailed.rejections).toHaveLength(0);
    const members = acc[0]!.resolvedAssembly!.rigidMembers.map((m) => m.hardwareId);
    expect(members).toEqual(f.expectedAccessoryAssembly.memberHardwareIds);

    const bom = resolveBom(module, choices, catalog);
    const accLines = bom.hardwareLines.filter((line) => line.id.startsWith('kit-acc-'));
    expect(accLines).toHaveLength(1);
    expect(accLines[0]!.id).toBe(f.expectedAccessoryKitLine.id);
    expect(accLines[0]!.hardwareId).toBe(f.expectedAccessoryKitLine.hardwareId);
    expect(accLines[0]!.quantity).toBe(f.expectedAccessoryKitLine.quantity);
  });

  it('control legacy: el MISMO grupo sin kit_hardware_id no cambia nada', () => {
    const { catalog, module, groupCode } = buildScenario(true, false);
    const choices = { [groupCode]: f.chosenAccessoryId };

    const detailed = resolveModuleAgregadoAssembliesDetailed(
      module,
      { width: f.module.widthMm, height: f.module.heightMm, depth: f.module.depthMm },
      catalog,
      { optionChoices: choices },
    );
    expect(accAssembliesOf(detailed.assemblies)).toHaveLength(0);
    expect(detailed.rejections).toHaveLength(0);

    const bom = resolveBom(module, choices, catalog);
    expect(bom.hardwareLines.filter((line) => line.id.startsWith('kit-acc-'))).toHaveLength(0);
  });

  it('sin elección y grupo opcional: base sin accesorio ni línea, bahía dibujada', () => {
    const { catalog, module } = buildScenario(false, true);

    const detailed = resolveModuleAgregadoAssembliesDetailed(
      module,
      { width: f.module.widthMm, height: f.module.heightMm, depth: f.module.depthMm },
      catalog,
      { optionChoices: {} },
    );
    expect(accAssembliesOf(detailed.assemblies)).toHaveLength(0);
    expect(detailed.rejections).toHaveLength(0);
    expect(detailed.assemblies).toHaveLength(1); // el ensamble principal sigue

    const bom = resolveBom(module, {}, catalog);
    expect(bom.hardwareLines.filter((line) => line.id.startsWith('kit-acc-'))).toHaveLength(0);
  });

  it('grupo requerido sin elección: rechazo accessory_choice_required y sin línea', () => {
    const { catalog, module, groupCode } = buildScenario(true, true);

    const detailed = resolveModuleAgregadoAssembliesDetailed(
      module,
      { width: f.module.widthMm, height: f.module.heightMm, depth: f.module.depthMm },
      catalog,
      { optionChoices: {} },
    );
    expect(detailed.assemblies).toHaveLength(1); // el cajón se dibuja igual
    expect(detailed.rejections).toHaveLength(1);
    expect(detailed.rejections[0]!.reason).toBe('accessory_choice_required');
    expect(detailed.rejections[0]!.assemblyInstanceId).toBe(
      `${'inst-bajo'}-acc-${groupCode.toLowerCase()}`,
    );

    const bom = resolveBom(module, {}, catalog);
    expect(bom.hardwareLines.filter((line) => line.id.startsWith('kit-acc-'))).toHaveLength(0);
  });

  it('accesorio monolítico (sin partes): un miembro con el herraje elegido', () => {
    const { catalog, module, groupCode } = buildScenario(true, true);
    const monolithic = f.accessoryGroup.accessories[1]!;
    expect(monolithic.parts).toHaveLength(0);
    const choices = { [groupCode]: monolithic.id };

    const detailed = resolveModuleAgregadoAssembliesDetailed(
      module,
      { width: f.module.widthMm, height: f.module.heightMm, depth: f.module.depthMm },
      catalog,
      { optionChoices: choices },
    );
    const acc = accAssembliesOf(detailed.assemblies);
    expect(acc).toHaveLength(1);
    expect(acc[0]!.resolvedAssembly!.rigidMembers).toHaveLength(1);
    expect(acc[0]!.resolvedAssembly!.rigidMembers[0]!.hardwareId).toBe(monolithic.id);
  });

  it('elección inválida: rechazo resolve_failed y cero accesorios', () => {
    const { catalog, module, groupCode } = buildScenario(true, true);
    const choices = { [groupCode]: 'kit-acc-desconocido' };

    const detailed = resolveModuleAgregadoAssembliesDetailed(
      module,
      { width: f.module.widthMm, height: f.module.heightMm, depth: f.module.depthMm },
      catalog,
      { optionChoices: choices },
    );
    expect(accAssembliesOf(detailed.assemblies)).toHaveLength(0);
    expect(detailed.rejections).toHaveLength(1);
    expect(detailed.rejections[0]!.reason).toBe('resolve_failed');

    const bom = resolveBom(module, choices, catalog);
    expect(bom.hardwareLines.filter((line) => line.id.startsWith('kit-acc-'))).toHaveLength(0);
  });
});
