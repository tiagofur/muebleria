import { describe, expect, it, vi } from 'vitest';
import type { Project, ProjectDrillingResult } from '@granete/domain';
import JSZip from 'jszip';
import { createSeedWorkspace } from '@granete/storage/seed';
import {
  generateCutRows,
  optimizeCutPlan,
  type MachineOutputSelection,
} from '@granete/domain';
import { buildProductionPackExport, productionPackFileName, composeFrozenDrilling, type FrozenDrillingSource } from './exportProductionPack';

const cadmatic4Selection: MachineOutputSelection = {
  operation: 'cutting',
  machineProfileId: 'client-a-machine-b-hpp250',
  machineProfileRevisionId: 'r1',
  outputCompatibilityProfileId: 'ptx-cadmatic-4',
  outputCompatibilityProfileRevisionId: 'r3',
  outputCompatibilityProfileDigest: '4998b6a53e131eda776934e18a24ee7f7e55ce526cbea3b8ba74d3340cbb9537',
  postprocessorAdapterId: 'granete-ptx',
  postprocessorAdapterVersion: '1.2.0',
  postprocessorImplementationDigest:
    '954fd63d08425a241309826d936597a4f20f857ae18b94741643480d679f7236',
};

function projectWithCutPlan() {
  const seed = createSeedWorkspace();
  const project = seed.projects.find((p) => p.name === 'Demo plantilla')!;
  const cutRows = generateCutRows(project, seed.catalog);
  return {
    seed,
    project: {
      ...project,
      cutPlan: optimizeCutPlan(
        project.id,
        cutRows,
        seed.catalog.materials,
        undefined,
        project.name,
      ),
    },
  };
}

describe('buildProductionPackExport (Issue #134)', () => {
  it('builds a valid ZIP with 4 production files', async () => {
    const seed = createSeedWorkspace();
    const project = seed.projects.find((p) => p.name === 'Demo plantilla')!;

    const result = await buildProductionPackExport(
      project,
      seed.catalog,
      'Cliente Test',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.fileName).toBe(productionPackFileName(project.name));
    expect(result.bytes.byteLength).toBeGreaterThan(1000);
    // Optional annexes list — empty when everything generated.
    expect(result.omissions).toEqual([]);

    const zip = await JSZip.loadAsync(result.bytes);
    const filenames = Object.keys(zip.files);

    expect(filenames).toContain('optimizer_Demo_plantilla.xlsx');
    expect(filenames).toContain('herrajes_Demo_plantilla.xlsx');
    expect(filenames).toContain('etiquetas_Demo_plantilla.pdf');
    expect(filenames).toContain('etiquetas_muebles_Demo_plantilla.pdf');
    expect(filenames).toContain('resumen_materiales_Demo_plantilla.pdf');
  });

  it('includes thermal labels ZPL for Zebra printers (default preset)', async () => {
    const seed = createSeedWorkspace();
    const project = seed.projects.find((p) => p.name === 'Demo plantilla')!;

    const result = await buildProductionPackExport(project, seed.catalog);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const zip = await JSZip.loadAsync(result.bytes);
    const filenames = Object.keys(zip.files);
    expect(filenames).toContain('etiquetas_zpl_Demo_plantilla.zpl');

    const zpl = await zip.file('etiquetas_zpl_Demo_plantilla.zpl')!.async(
      'string',
    );
    // One ^XA block per label + v2 QR payload with the real project id.
    expect(zpl.startsWith('^XA')).toBe(true);
    expect(zpl).toContain(`"projectId":"${project.id}"`);
    expect(zpl).toContain('"v":2');
  });

  it('fails with validation issues when project has missing choices', async () => {
    const seed = createSeedWorkspace();
    const invalidProject = {
      ...seed.projects[0]!,
      items: [],
    };
    const result = await buildProductionPackExport(invalidProject, seed.catalog);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it('configured CADmatic 4 includes only selected output in the Production Pack', async () => {
    const { seed, project } = projectWithCutPlan();
    const selected = vi.fn(async () => [
      {
        artifact: {
          artifactId: 'cad4-r3',
          kind: 'ptx' as const,
          schemaVersion: 'granete.ptx.v1',
          fileName: 'corte-cadmatic4-r3.ptx',
          bytes: new TextEncoder().encode('SELECTED-CADMATIC4-R3'),
          sha256: 'selected',
        },
        manifest: {},
        manifestJson: '{"manifestSchemaVersion":"granete.machine-artifact-manifest.v2"}\n',
      },
    ] as never);
    const legacy = vi.fn(() => new Uint8Array([1, 2, 3]));

    const result = await buildProductionPackExport(project, seed.catalog, undefined, {
      cuttingOutputState: {
        status: 'configured',
        scopeKey: 'org-a',
        selection: cadmatic4Selection,
      },
      generateSelected: selected,
      generateLegacy: legacy,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const zip = await JSZip.loadAsync(result.bytes);
    expect(await zip.file('corte-cadmatic4-r3.ptx')?.async('string')).toBe(
      'SELECTED-CADMATIC4-R3',
    );
    expect(
      await zip.file('corte-cadmatic4-r3.ptx.manifest.json')?.async('string'),
    ).toContain('granete.machine-artifact-manifest.v2');
    expect(Object.keys(zip.files)).not.toContain('seccionadora_Demo_plantilla.ptx');
    expect(selected).toHaveBeenCalledWith(project.cutPlan, cadmatic4Selection, 'unified');
    expect(legacy).not.toHaveBeenCalled();
  });

  it('blocked selection blocks the Production Pack without invoking legacy', async () => {
    const { seed, project } = projectWithCutPlan();
    const selected = vi.fn();
    const legacy = vi.fn();

    const result = await buildProductionPackExport(project, seed.catalog, undefined, {
      cuttingOutputState: {
        status: 'blocked',
        scopeKey: 'org-a',
        selection: cadmatic4Selection,
        reason: 'La selección de salida de corte está desactualizada.',
      },
      generateSelected: selected,
      generateLegacy: legacy,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.message).toMatch(/desactualizada/i);
    expect(selected).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });

  it('confirmed empty preserves the legacy PTX inside the Production Pack', async () => {
    const { seed, project } = projectWithCutPlan();
    const selected = vi.fn();
    const legacy = vi.fn(() => new TextEncoder().encode('LEGACY-CONFIRMED-EMPTY'));

    const result = await buildProductionPackExport(project, seed.catalog, undefined, {
      cuttingOutputState: { status: 'empty', scopeKey: 'org-a' },
      generateSelected: selected,
      generateLegacy: legacy,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const zip = await JSZip.loadAsync(result.bytes);
    expect(await zip.file('seccionadora_Demo_plantilla.ptx')?.async('string')).toBe(
      'LEGACY-CONFIRMED-EMPTY',
    );
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(selected).not.toHaveBeenCalled();
  });
});

describe('composeFrozenDrilling (#995 export bridge K1)', () => {
  const legacyResolved = () => ({
    patterns: [
      {
        pieceCode: 'MOD-L1', moduleCode: 'MOD', partName: 'Lateral',
        lengthMm: 720, widthMm: 560, materialName: 'MDF',
        holes: [{ face: 'top', xMm: 100, yMm: 100, diameterMm: 5, depthMm: 12, type: 'through' as never }],
      },
    ],
    resolutionIssues: [],
    links: [
      { partId: 'part-1', labelRef: 'MOD-L1', partCode: 'L1', moduleCode: 'MOD', part: { description: 'Lateral' } },
    ] as never,
    data: {} as never,
  }) as never as ProjectDrillingResult;
  const frozen = () => ({
    releaseId: 'rel-1',
    manufacturingFingerprint: 'fp-1',
    snapshot: {
      schemaVersion: 2,
      release: { id: 'rel-1', releaseNumber: 1, status: 'approved', manufacturingFingerprint: 'fp-1' },
      routing: {
        contract: 'granete.release-manufacturing-program.v1',
        industrialRulesRevision: 'rr-1',
        units: [
          {
            furnitureInstanceId: 'unit-1',
            furnitureDefinitionId: 'mod-1',
            machiningFingerprint: 'mf-1',
            parts: [
              {
                partId: 'part-1',
                cut: true,
                cncRequired: true,
                operations: [
                  {
                    operationId: 'op-1',
                    provenance: {
                      sourceKind: 'relationship',
                      relationshipId: 'rel-shelf',
                      technicalProfileId: 'prof-1',
                      technicalProfileRevision: 'rev-1',
                    },
                    operation: 'drill',
                    holes: [
                      { face: 'side', xMm: 40, yMm: 100, diameterMm: 15, depthMm: 13, type: 'housing' },
                      { face: 'side', xMm: 40, yMm: 200, diameterMm: 8, depthMm: 17, type: 'dowel' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  }) as never as FrozenDrillingSource;
  const project = { id: 'proj-1', name: 'Obra' } as never as Project;

  it('replaces heuristic holes with the frozen ones and pins the release identity', () => {
    const data = composeFrozenDrilling(project, frozen(), legacyResolved());
    expect(data.source).toBe('frozen-release');
    expect(data.releaseId).toBe('rel-1');
    expect(data.manufacturingFingerprint).toBe('fp-1');
    expect(data.totalPiecesCount).toBe(1);
    expect(data.totalHolesCount).toBe(2);
    expect(data.patterns[0]?.pieceCode).toBe('MOD-L1');
    expect(data.patterns[0]?.holes.map((hole) => hole.diameterMm)).toEqual([15, 8]);
  });

  it('fails closed on a covered-parts count mismatch', () => {
    const broken = frozen() as unknown as {
      releaseId: string;
      manufacturingFingerprint: string;
      snapshot: { routing: { units: { parts: { partId: string }[] }[] } };
    };
    broken.snapshot.routing.units[0]!.parts = [];
    expect(() => composeFrozenDrilling(project, broken as never, legacyResolved())).toThrow(/cubierta|cubre/);
  });

  it('fails closed when the released part identity cannot be joined', () => {
    const broken = frozen() as unknown as {
      releaseId: string;
      manufacturingFingerprint: string;
      snapshot: { routing: { units: { parts: { partId: string }[] }[] } };
    };
    broken.snapshot.routing.units[0]!.parts[0]!.partId = 'part-missing';
    expect(() => composeFrozenDrilling(project, broken as never, legacyResolved())).toThrow(/no tiene routing congelado/);
  });
});
