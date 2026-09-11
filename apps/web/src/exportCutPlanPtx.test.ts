import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import {
  downloadCutPlanPtx,
  downloadCuttingArtifactBundles,
  ptxFileName,
  ptxZipFileName,
} from './exportCutPlanPtx';
import { DEFAULT_CUT_PLAN_CONFIG, optimizeCutPlan } from '@granete/domain';
import type { CutPlan, MachineOutputSelection, ProductionCutRow } from '@granete/domain';
import { generateSelectedCuttingOutput, PTX_POSTPROCESSOR_ADAPTER } from '@granete/excel';
import type { MachineArtifactBundle } from '@granete/excel';
import type { DownloadDeps } from './exportOptimizer';

function buildCutPlanFixture(): CutPlan {
  return {
    id: 'cutplan-test-01',
    projectId: 'PRJ-1042',
    projectName: 'Cocina Moderna',
    generatedAt: '2026-08-20T10:00:00.000Z',
    version: 1,
    isFrozen: false,
    config: {
      sawKerfMm: 4.4,
      trim: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
      deductEdgeBand: true,
      allowRotationNoGrain: true,
      minRemnantLengthMm: 600,
      minRemnantWidthMm: 400,
      preferLongitudinalRips: true,
      heuristic: 'guillotine-hybrid',
    },
    sheets: [
      {
        sheetIndex: 0,
        strategy: 'saw-guillotine',
        materialCode: 'MEL_BLANCO_18',
        materialName: 'MDF Melamina Blanco 18mm',
        sheetLengthMm: 2750,
        sheetWidthMm: 1830,
        thicknessMm: 18,
        netPiecesAreaM2: 2.15,
        grossSheetAreaM2: 5.0325,
        usableRemnantAreaM2: 1.2,
        wasteAreaM2: 1.6825,
        wastePercent: 33.4,
        yieldPercent: 42.7,
        instructions: [],
        remnants: [],
        pieces: [
          {
            id: 'p-01',
            partCode: 'LAT_IZQ',
            partName: 'Lateral Izquierdo',
            moduleCode: 'BAJO_60',
            labelRef: 'BAR-LAT-01',
            materialName: 'MDF Melamina Blanco 18mm',
            materialCode: 'MEL_BLANCO_18',
            xMm: 10,
            yMm: 10,
            lengthMm: 716,
            widthMm: 578,
            originalLengthMm: 720,
            originalWidthMm: 580,
            grain: 1,
            rotated: false,
            L1: 1,
            L2: 1,
            W1: 1,
            W2: 0,
            sheetIndex: 0,
            stripIndex: 0,
            cutSequenceNumber: 1,
          },
        ],
      },
    ],
    stats: {
      totalSheets: 1,
      totalPieces: 1,
      totalGrossAreaM2: 5.0325,
      totalNetPiecesAreaM2: 2.15,
      totalUsefulRemnantsAreaM2: 1.2,
      totalWasteAreaM2: 1.6825,
      globalWastePercent: 33.4,
      globalYieldPercent: 42.7,
      byMaterial: [],
    },
    usefulRemnants: [],
  };
}

describe('exportCutPlanPtx', () => {
  it('ptxFileName sanitizes and formats names with .ptx extension', () => {
    expect(ptxFileName('Cocina Moderna 2026!')).toBe('Cocina-Moderna-2026.ptx');
    expect(ptxFileName('')).toBe('plan-de-corte.ptx');
  });

  it('ptxZipFileName formats zip file name', () => {
    expect(ptxZipFileName('Cocina Moderna')).toBe('seccionadora-materiales-Cocina-Moderna.zip');
  });

  it('downloadCutPlanPtx triggers download using injected deps (unified mode)', async () => {
    const plan = buildCutPlanFixture();
    const createdAnchors: any[] = [];
    const appendedNodes: any[] = [];
    const removedNodes: any[] = [];

    const fakeAnchor: any = {
      href: '',
      download: '',
      rel: '',
      click: vi.fn(),
    };

    const deps: DownloadDeps = {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
      createElement: vi.fn(() => {
        createdAnchors.push(fakeAnchor);
        return fakeAnchor;
      }),
      appendChild: vi.fn((node) => appendedNodes.push(node)),
      removeChild: vi.fn((node) => removedNodes.push(node)),
    };

    await downloadCutPlanPtx(
      plan,
      { projectName: 'Cocina Prueba', customerName: 'Cliente A', mode: 'unified' },
      'seccionadora.ptx',
      deps,
    );

    expect(deps.createObjectURL).toHaveBeenCalled();
    expect(fakeAnchor.download).toBe('seccionadora.ptx');
    expect(fakeAnchor.click).toHaveBeenCalled();
    expect(deps.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('downloadCutPlanPtx bundles multiple materials into a ZIP in by-material mode', async () => {
    const basePlan = buildCutPlanFixture();
    const multiMatPlan: CutPlan = {
      ...basePlan,
      sheets: [
        ...basePlan.sheets,
        {
          sheetIndex: 1,
          strategy: 'saw-guillotine',
          materialCode: 'FONDO_3',
          materialName: 'MDF Fondo Blanco 3mm',
          sheetLengthMm: 2440,
          sheetWidthMm: 1220,
          thicknessMm: 3,
          netPiecesAreaM2: 0.5,
          grossSheetAreaM2: 2.9768,
          usableRemnantAreaM2: 0,
          wasteAreaM2: 2.4768,
          wastePercent: 83.2,
          yieldPercent: 16.8,
          instructions: [],
          remnants: [],
          pieces: [
            {
              id: 'p-02',
              partCode: 'FONDO',
              partName: 'Fondo',
              moduleCode: 'BAJO_60',
              labelRef: 'BAR-FONDO-01',
              materialName: 'MDF Fondo Blanco 3mm',
              materialCode: 'FONDO_3',
              xMm: 10,
              yMm: 10,
              lengthMm: 680,
              widthMm: 560,
              originalLengthMm: 680,
              originalWidthMm: 560,
              grain: 0,
              rotated: false,
              L1: 0,
              L2: 0,
              W1: 0,
              W2: 0,
              sheetIndex: 1,
              stripIndex: 0,
              cutSequenceNumber: 1,
            },
          ],
        },
      ],
      stats: {
        ...basePlan.stats,
        totalSheets: 2,
        totalPieces: 2,
      },
    };

    const fakeAnchor: any = {
      href: '',
      download: '',
      rel: '',
      click: vi.fn(),
    };

    const deps: DownloadDeps = {
      createObjectURL: vi.fn(() => 'blob:mock-zip-url'),
      revokeObjectURL: vi.fn(),
      createElement: vi.fn(() => fakeAnchor),
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    };

    await downloadCutPlanPtx(
      multiMatPlan,
      { projectName: 'Cocina Integral', mode: 'by-material' },
      undefined,
      deps,
    );

    expect(deps.createObjectURL).toHaveBeenCalled();
    expect(fakeAnchor.download).toBe('seccionadora-materiales-Cocina-Integral.zip');
    expect(fakeAnchor.click).toHaveBeenCalled();
  });
});

describe('descarga del candidato CADmatic 4 (ptx-cadmatic-4@r3, #661)', () => {
  it('by-material: el PTX documentado del compilador llega dentro del ZIP, un archivo por material', async () => {
    const { fakeAnchor, deps, blobs } = captureDeps();

    const materials = [
      {
        id: 'mat-a',
        code: 'LAB18',
        name: 'Lab Board 18',
        costPerM2: 10,
        wastePercent: 10,
        lengthMm: 1200,
        widthMm: 700,
        thicknessMm: 18,
        grainDefault: true,
        boardPrice: 8,
        active: true,
      },
      {
        id: 'mat-b',
        code: 'ALT18',
        name: 'Lab Alt 18',
        costPerM2: 12,
        wastePercent: 10,
        lengthMm: 800,
        widthMm: 600,
        thicknessMm: 18,
        grainDefault: true,
        boardPrice: 6,
        active: true,
      },
    ];
    const row = (
      partCode: string,
      lengthMm: number,
      widthMm: number,
      materialName: string,
      materialCode: string,
    ): ProductionCutRow => ({
      quantity: 1,
      lengthMm,
      widthMm,
      description: `${partCode} lab`,
      materialName,
      materialCode,
      grain: 1 as const,
      L1: 0,
      L2: 0,
      W1: 0,
      W2: 0,
      partCode,
      partName: partCode,
      moduleCode: 'M01',
      thicknessMm: 18,
    });
    const plan = optimizeCutPlan(
      'lab-650-cad4-zip',
      [
        row('A', 450, 320, 'Lab Board 18', 'LAB18'),
        row('C', 500, 400, 'Lab Alt 18', 'ALT18'),
      ],
      materials,
      {
        ...DEFAULT_CUT_PLAN_CONFIG,
        sawKerfMm: 4,
        trim: { topMm: 0, bottomMm: 0, leftMm: 0, rightMm: 0 },
      },
    );

    const bundles = await generateSelectedCuttingOutput(plan, cad4Selection(), 'by-material');
    expect(bundles.length).toBe(2);

    await downloadCuttingArtifactBundles(bundles, 'Cocina Candidata', deps, 'by-material');

    expect(blobs).toHaveLength(1);
    expect(fakeAnchor.download).toBe('seccionadora-materiales-Cocina-Candidata.zip');
    const zip = await JSZip.loadAsync(await blobs[0]!.arrayBuffer());
    const fileNames = Object.keys(zip.files).filter((name) => name.endsWith('.ptx'));
    expect(fileNames).toHaveLength(2);
    // El PTX documentado (registros CSV del compilador #657) llega al archivo
    // descargado — no el formato INI legacy.
    for (const name of fileNames) {
      const content = await zip.file(name)!.async('string');
      expect(content.startsWith('HEADER,')).toBe(true);
      expect(content).not.toContain('[HEADER]');
      expect(content).toContain('GRANETE-PTX-CANDIDATE NOT_MACHINE_VALIDATED');
    }
    // Manifest exacto por material dentro del propio bundle.
    for (const bundle of bundles) {
      expect(bundle.manifest.outputCompatibilityProfile.revisionId).toBe('r3');
      expect(bundle.manifest.validationStatus).toBe('NOT_TESTED');
      expect(bundle.manifest.compatibilityEvidence.claim).toBe('notClaimed');
    }
  });
});

function cad4Selection(): MachineOutputSelection {
  return {
    operation: 'cutting',
    machineProfileId: 'client-a-machine-b-hpp250',
    machineProfileRevisionId: 'r1',
    outputCompatibilityProfileId: 'ptx-cadmatic-4',
    outputCompatibilityProfileRevisionId: 'r3',
    postprocessorAdapterId: PTX_POSTPROCESSOR_ADAPTER.postprocessorAdapterId,
    postprocessorAdapterVersion: PTX_POSTPROCESSOR_ADAPTER.adapterVersion,
    postprocessorImplementationDigest: PTX_POSTPROCESSOR_ADAPTER.implementationDigest,
  };
}

function bundleFixture(fileName: string, marker: string): MachineArtifactBundle {
  return {
    artifact: {
      artifactId: `artifact-${fileName}`,
      kind: 'ptx',
      schemaVersion: '1.14',
      fileName,
      bytes: new TextEncoder().encode(`PTX-CONTENT ${marker}`),
      sha256: `sha256-${fileName}`,
    },
    manifest: {} as MachineArtifactBundle['manifest'],
    manifestJson: '{}\n',
  };
}

function captureDeps() {
  const fakeAnchor: any = {
    href: '',
    download: '',
    rel: '',
    click: vi.fn(),
  };
  const blobs: Blob[] = [];
  const deps: DownloadDeps = {
    createObjectURL: vi.fn((blob: Blob) => {
      blobs.push(blob);
      return `blob:mock-${blobs.length}`;
    }),
    revokeObjectURL: vi.fn(),
    createElement: vi.fn(() => fakeAnchor),
    appendChild: vi.fn(),
    removeChild: vi.fn(),
  };
  return { fakeAnchor, deps, blobs };
}

describe('downloadCuttingArtifactBundles (#591 machine output)', () => {
  it('un único bundle se descarga directo con su nombre de artefacto', async () => {
    const { fakeAnchor, deps, blobs } = captureDeps();
    const bundle = bundleFixture('corte-PRJ-1042-MEL_BLANCO_18.ptx', 'blanco');

    await downloadCuttingArtifactBundles([bundle], 'Cocina Moderna', deps);

    expect(blobs).toHaveLength(1);
    expect(fakeAnchor.download).toBe('corte-PRJ-1042-MEL_BLANCO_18.ptx');
    expect(fakeAnchor.click).toHaveBeenCalledTimes(1);
    // Es el .ptx directo, no un zip.
    const text = new TextDecoder().decode(await blobs[0]!.arrayBuffer());
    expect(text).toContain('PTX-CONTENT blanco');
    expect(text.startsWith('PK')).toBe(false);
  });

  it('varios bundles por material se empaquetan TODOS en un zip (regresión: solo bajaba el primero)', async () => {
    const { fakeAnchor, deps, blobs } = captureDeps();
    const blanco = bundleFixture('corte-PRJ-1042-MEL_BLANCO_18.ptx', 'blanco');
    const moscato = bundleFixture('corte-PRJ-1042-MEL_MOSCATO_18.ptx', 'moscato');

    await downloadCuttingArtifactBundles([blanco, moscato], 'Cocina Moderna', deps);

    expect(blobs).toHaveLength(1);
    expect(fakeAnchor.download).toBe('seccionadora-materiales-Cocina-Moderna.zip');
    expect(fakeAnchor.click).toHaveBeenCalledTimes(1);

    // Round-trip real del zip: ambos materiales presentes con su contenido.
    const zip = await JSZip.loadAsync(await blobs[0]!.arrayBuffer());
    const fileNames = Object.keys(zip.files);
    expect(fileNames).toContain('corte-PRJ-1042-MEL_BLANCO_18.ptx');
    expect(fileNames).toContain('corte-PRJ-1042-MEL_MOSCATO_18.ptx');
    expect(fileNames).toHaveLength(2);
    expect(await zip.file('corte-PRJ-1042-MEL_BLANCO_18.ptx')!.async('string')).toContain('blanco');
    expect(await zip.file('corte-PRJ-1042-MEL_MOSCATO_18.ptx')!.async('string')).toContain('moscato');
  });
});

describe('robustez ZIP por material (hardening)', () => {
  function sheetWithMaterial(
    index: number,
    materialCode: string,
    materialName: string,
    pieces = 1,
  ): CutPlan['sheets'][number] {
    const base = buildCutPlanFixture().sheets[0]!;
    return {
      ...base,
      sheetIndex: index,
      materialCode,
      materialName,
      pieces: base.pieces.slice(0, pieces).map((p) => ({
        ...p,
        materialCode,
        materialName,
        sheetIndex: index,
      })),
    };
  }

  function planWithMaterials(
    ...materials: { code: string; name: string }[]
  ): CutPlan {
    return {
      ...buildCutPlanFixture(),
      sheets: materials.map((m, i) => sheetWithMaterial(i, m.code, m.name)),
      stats: {
        ...buildCutPlanFixture().stats,
        totalSheets: materials.length,
        totalPieces: materials.length,
      },
    };
  }

  it('un material en modo by-material también llega como ZIP válido con un PTX', async () => {
    const { fakeAnchor, deps, blobs } = captureDeps();
    const plan = planWithMaterials({ code: 'MEL_BLANCO_18', name: 'MDF Melamina Blanco 18mm' });

    await downloadCutPlanPtx(plan, { projectName: 'Cocina Una', mode: 'by-material' }, undefined, deps);

    expect(fakeAnchor.download).toBe('seccionadora-materiales-Cocina-Una.zip');
    const bytes = new Uint8Array(await blobs[0]!.arrayBuffer());
    // Firma PK: es un ZIP real, no un PTX suelto.
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toEqual(['corte-mdf-melamina-blanco-18mm.ptx']);
    const content = await zip.file('corte-mdf-melamina-blanco-18mm.ptx')!.async('string');
    expect(content).toContain('[HEADER]');
  });

  it('varios materiales → exactamente un PTX por material, orden determinista y sin extras', async () => {
    const { deps, blobs } = captureDeps();
    const plan = planWithMaterials(
      { code: 'ZZ_Z', name: 'ZZ Material Z' },
      { code: 'AA_A', name: 'AA Material A' },
      { code: 'MM_M', name: 'MM Material M' },
    );

    await downloadCutPlanPtx(plan, { projectName: 'Cocina Multi', mode: 'by-material' }, undefined, deps);

    const zip = await JSZip.loadAsync(new Uint8Array(await blobs[0]!.arrayBuffer()));
    // Orden alfabético determinista — independiente del orden de los sheets.
    expect(Object.keys(zip.files)).toEqual([
      'corte-aa-material-a.ptx',
      'corte-mm-material-m.ptx',
      'corte-zz-material-z.ptx',
    ]);
  });

  it('mismo input → mismo ZIP byte a byte (fechas fijas)', async () => {
    const plan = planWithMaterials(
      { code: 'MEL_BLANCO_18', name: 'MDF Melamina Blanco 18mm' },
      { code: 'FONDO_3', name: 'MDF Fondo Blanco 3mm' },
    );

    const run = async () => {
      const { deps, blobs } = captureDeps();
      await downloadCutPlanPtx(plan, { projectName: 'Cocina Det', mode: 'by-material' }, undefined, deps);
      return new Uint8Array(await blobs[0]!.arrayBuffer());
    };
    const first = await run();
    const second = await run();
    expect(second).toEqual(first);
  });

  it('bundles vacíos → error y cero descargas (nunca un ZIP vacío)', async () => {
    const { deps } = captureDeps();
    await expect(
      downloadCuttingArtifactBundles([], 'Cocina Vacía', deps),
    ).rejects.toThrow(/no hay archivos de corte/i);
    expect(deps.createObjectURL).not.toHaveBeenCalled();
  });

  it('nombres duplicados tras sanitización no se sobrescriben (sufijo -2)', async () => {
    const { fakeAnchor, deps, blobs } = captureDeps();
    const duplicado = bundleFixture('corte-mdf-blanco.ptx', 'uno');
    const duplicado2 = bundleFixture('corte-mdf-blanco.ptx', 'dos');

    await downloadCuttingArtifactBundles([duplicado, duplicado2], 'Cocina Dup', deps, 'by-material');

    expect(fakeAnchor.download).toBe('seccionadora-materiales-Cocina-Dup.zip');
    const zip = await JSZip.loadAsync(new Uint8Array(await blobs[0]!.arrayBuffer()));
    expect(Object.keys(zip.files).sort()).toEqual(['corte-mdf-blanco-2.ptx', 'corte-mdf-blanco.ptx']);
    expect(await zip.file('corte-mdf-blanco.ptx')!.async('string')).toContain('PTX-CONTENT uno');
    expect(await zip.file('corte-mdf-blanco-2.ptx')!.async('string')).toContain('PTX-CONTENT dos');
  });

  it('error en una generación → no se descarga nada parcial', async () => {
    const { deps } = captureDeps();
    // El segundo material tiene un sheet sin piezas: generatePtxByMaterial
    // revienta al generar ese grupo y la descarga jamás ocurre.
    const plan: CutPlan = {
      ...buildCutPlanFixture(),
      sheets: [
        sheetWithMaterial(0, 'MEL_BLANCO_18', 'MDF Melamina Blanco 18mm'),
        sheetWithMaterial(1, 'FONDO_3', 'MDF Fondo Blanco 3mm', 0),
      ],
    };
    await expect(
      downloadCutPlanPtx(plan, { projectName: 'Cocina Falla', mode: 'by-material' }, undefined, deps),
    ).rejects.toThrow();
    expect(deps.createObjectURL).not.toHaveBeenCalled();
  });

  it('sin modo explícito sigue siendo un único PTX unificado (default explícito, no preferencia oculta)', async () => {
    const { fakeAnchor, deps, blobs } = captureDeps();
    const plan = planWithMaterials(
      { code: 'MEL_BLANCO_18', name: 'MDF Melamina Blanco 18mm' },
      { code: 'FONDO_3', name: 'MDF Fondo Blanco 3mm' },
    );
    await downloadCutPlanPtx(plan, { projectName: 'Cocina Default' }, undefined, deps);
    expect(fakeAnchor.download).toBe('Cocina-Default.ptx');
    const text = new TextDecoder().decode(await blobs[0]!.arrayBuffer());
    expect(text).toContain('[HEADER]');
  });
});
