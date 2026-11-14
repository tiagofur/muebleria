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

  // Decisión del owner 2026-11-13 (sustituye «sólo elección explícita» de
  // #1555): sin elección, la bahía monta y cotiza la PRIMERA opción activa.
  for (const required of [false, true]) {
    it(`sin elección (${required ? 'requerido' : 'opcional'}): monta y cotiza la primera opción`, () => {
      const { catalog, module } = buildScenario(required, true);
      const first = f.accessoryGroup.accessories[0]!;

      const detailed = resolveModuleAgregadoAssembliesDetailed(
        module,
        { width: f.module.widthMm, height: f.module.heightMm, depth: f.module.depthMm },
        catalog,
        { optionChoices: {} },
      );
      expect(detailed.rejections).toHaveLength(0);
      expect(accAssembliesOf(detailed.assemblies)).toHaveLength(1);
      expect(detailed.assemblies).toHaveLength(2); // principal + inserto por defecto

      const bom = resolveBom(module, {}, catalog);
      const lines = bom.hardwareLines.filter((line) => line.id.startsWith('kit-acc-'));
      expect(lines).toHaveLength(1);
      expect(lines[0]!.hardwareId).toBe(first.id);
    });
  }

  it('el default salta las opciones inactivas', () => {
    const { catalog, module } = buildScenario(false, true);
    const [first, second] = f.accessoryGroup.accessories;
    const withInactiveFirst = {
      ...catalog,
      hardware: (catalog.hardware ?? []).map((h) => (h.id === first!.id ? { ...h, active: false } : h)),
    };
    const bom = resolveBom(module, {}, withInactiveFirst);
    const lines = bom.hardwareLines.filter((line) => line.id.startsWith('kit-acc-'));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.hardwareId).toBe(second!.id);
  });

  it('sin ninguna opción activa: opcional calla, requerido rechaza accessory_choice_required', () => {
    const accessoryIds = new Set(f.accessoryGroup.accessories.map((a) => a.id));
    for (const required of [false, true]) {
      const { catalog, module, groupCode } = buildScenario(required, true);
      const withoutActive = {
        ...catalog,
        hardware: (catalog.hardware ?? []).map((h) =>
          accessoryIds.has(h.id) ? { ...h, active: false } : h,
        ),
      };
      const detailed = resolveModuleAgregadoAssembliesDetailed(
        module,
        { width: f.module.widthMm, height: f.module.heightMm, depth: f.module.depthMm },
        withoutActive,
        { optionChoices: {} },
      );
      expect(detailed.assemblies).toHaveLength(1); // el cajón se dibuja igual
      const bom = resolveBom(module, {}, withoutActive);
      expect(bom.hardwareLines.filter((line) => line.id.startsWith('kit-acc-'))).toHaveLength(0);
      if (!required) {
        expect(detailed.rejections).toHaveLength(0);
        continue;
      }
      expect(detailed.rejections).toHaveLength(1);
      expect(detailed.rejections[0]!.reason).toBe('accessory_choice_required');
      expect(detailed.rejections[0]!.assemblyInstanceId).toBe(
        `${'inst-bajo'}-acc-${groupCode.toLowerCase()}`,
      );
    }
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
  it('guard target vacío: una bahía legacy SIN kit no hereda grupos hardware sin link como accesorios (#1429 slice B)', () => {
    // Cajón kit-less (miembros fixed, sin kits de variante ni a nivel
    // agregado) en un catálogo con un grupo hardware REQUERIDO sin
    // kit_hardware_id (el BISAGRA clásico): sin el guard del gemelo Go, el
    // target '' lo matcheaba y la bahía heredaba rejections
    // accessory_choice_required falsas en cada preview (cazado vía el
    // surfacing de #1429 slice B).
    const kitless = {
      id: 'agr-kitless',
      code: 'CAJON-KITLESS',
      name: 'Cajón sin kit',
      active: true,
      rigidMembers: (['min', 'max'] as const).map((ref, i) => ({
        memberId: `side-${i}`,
        role: `drawer_side_${i}`,
        source: { kind: 'fixed', fixed: { hardwareId: 'hw-fijo' } },
        placement: { x: { ref, offsetMm: 0 }, y: { ref: 'min', offsetMm: 0 }, z: { ref: 'min', offsetMm: 0 } },
        bomRole: 'separately_purchased',
      })),
      components: [],
      hardwareLines: [],
    } as unknown as Agregado;
    const grupoLegacy: OptionGroup = {
      id: 'og-bis',
      code: 'BISAGRA',
      name: 'Bisagras',
      kind: 'hardware',
      required: true,
      optionIds: ['hw-fijo'],
    };
    const catalogKitless = {
      structures: [],
      agregados: [kitless],
      components: [],
      materials: [],
      hardware: [{ id: 'hw-fijo', code: 'HW-FIJO', name: 'Riel fijo', unit: 'piece', costPerUnit: 10, active: true }],
      optionGroups: [grupoLegacy],
    } as unknown as Catalog;
    const moduleKitless = {
      id: 'mod-kitless',
      code: 'MOD-KITLESS',
      name: 'Cajonera sin kit',
      externalDims: { width: 400, height: 300, depth: 500 },
      agregados: [{ id: 'inst-kitless', agregadoId: kitless.id, quantity: 1 }],
      hardwareLines: [],
    } as unknown as Module;

    const detailed = resolveModuleAgregadoAssembliesDetailed(
      moduleKitless,
      { width: 400, height: 300, depth: 500 },
      catalogKitless,
      { optionChoices: {} },
    );
    // El cajón se dibuja y NINGUNA rejection de accesorio aparece: el grupo
    // hardware legacy es exactamente lo que siempre fue.
    expect(detailed.assemblies).toHaveLength(1);
    expect(detailed.rejections).toEqual([]);
  });
});
