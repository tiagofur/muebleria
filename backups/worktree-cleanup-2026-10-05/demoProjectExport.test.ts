/**
 * DEMA KDT — exportador de proyecto REAL para la prueba en Flexdrill 1200
 * (demo 2026-10-04, Gabinete Bajo 1 Puerta Izquierda).
 *
 * Reproduce exactamente el pipeline del botón "Programas KDT" de la app
 * (handleExportMachiningKdt → composeFrozenDrilling →
 * generateSelectedMachiningOutput) pero fuera del navegador: une las
 * perforaciones CONGELADAS de la liberación con la identidad de piso del
 * resolve del catálogo (dims/material/nombre por pieza) y escribe los XML
 * KDTPanelFormat + manifests + DXF por pieza.
 *
 * Nombres de archivo: ID del despiece (≤10 caracteres) = ordinal de mueble
 * congelado + secuencia de pieza (`1-P01`), la misma ordenación que muestra
 * el despiece (resolveCleanPieceCode #781) — lista para código de barras.
 *
 *   DEMO_KDT_IN=<dir con frozen-snapshot.json + resolve-quote.json> \
 *   DEMO_KDT_OUT=<dir destino> \
 *   pnpm --filter @granete/excel exec vitest run \
 *     src/machines/kdt/demoProjectExport.test.ts
 *
 * Sin las env vars se salta silenciosamente. Archivo de demo — no subir.
 */

import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MachineOutputSelection, ResolvedMachiningJob } from '@granete/domain';
import { generateSelectedMachiningOutput } from '../outputSelectionResolver';
import { KDT_FLEXDRILL_1200_PROFILE } from '../profiles';
import { KDT_POSTPROCESSOR_ADAPTER } from '../kdtAdapter';
import { sha256Hex } from '../digest';

const inDir = process.env.DEMO_KDT_IN;
const outDir = process.env.DEMO_KDT_OUT;

interface FrozenPart {
  partId: string;
  edgeBandingSides: string[];
  operations: {
    operation: string;
    holes: { face: string; xMm: number; yMm: number; diameterMm: number; depthMm: number; type: string }[];
  }[];
}

/** ID del despiece: `1-P01` = mueble 1, pieza congelada 01 de esa unidad. */
function despieceId(unitOrdinal: number, partIndex: number): string {
  return `${unitOrdinal + 1}-P${String(partIndex + 1).padStart(2, '0')}`;
}

function holeFace(h: { face: string }): 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back' {
  return h.face as 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back';
}

function holeType(h: { type: string }): 'dowel' | 'minifix' | 'hinge' | 'shelf' | 'screw' {
  return h.type as 'dowel' | 'minifix' | 'hinge' | 'shelf' | 'screw';
}

function readInputs() {
  const frozen = JSON.parse(readFileSync(join(inDir!, 'frozen-snapshot.json'), 'utf8')) as {
    release: { id: string; manufacturingFingerprint: string; releaseNumber: number };
    routing: { units: { furnitureInstanceId: string; parts: FrozenPart[] }[] };
  };
  const resolve = JSON.parse(readFileSync(join(inDir!, 'resolve-quote.json'), 'utf8')) as {
    resolved: {
      layout: {
        components: {
          componentInstanceId: string; name: string;
          widthMm: number; lengthMm: number; thicknessMm: number;
          materialName?: string;
        }[];
      };
    };
  };
  const boards = new Map(resolve.resolved.layout.components.map((c) => [c.componentInstanceId, c]));
  // ID de despiece por partida congelada (ordinal de unidad + secuencia de pieza).
  const idByPart = new Map<string, { id: string; unitOrdinal: number; name: string }>();
  for (const [unitOrdinal, unit] of frozen.routing.units.entries()) {
    for (const [partIndex, part] of unit.parts.entries()) {
      const board = boards.get(part.partId);
      idByPart.set(part.partId, {
        id: despieceId(unitOrdinal, partIndex),
        unitOrdinal,
        name: board?.name ?? part.partId,
      });
    }
  }
  return { frozen, resolve, boards, idByPart };
}

function drillingPatterns(
  frozen: ReturnType<typeof readInputs>['frozen'],
  idByPart: ReturnType<typeof readInputs>['idByPart'],
  boards: ReturnType<typeof readInputs>['boards'],
) {
  const patterns = [] as ResolvedMachiningJob['drilling']['patterns'];
  let holesTotal = 0;
  for (const unit of frozen.routing.units) {
    for (const part of unit.parts) {
      const meta = idByPart.get(part.partId)!;
      const board = boards.get(part.partId)!;
      const holes = part.operations
        .filter((o) => o.operation === 'drill')
        .flatMap((o) => o.holes.map((h) => ({
          face: holeFace(h), xMm: h.xMm, yMm: h.yMm,
          diameterMm: h.diameterMm, depthMm: h.depthMm, type: holeType(h),
        })));
      holesTotal += holes.length;
      patterns.push({
        pieceCode: meta.id,
        moduleCode: 'MOD-BAJ-1P-IZQ',
        partName: board.name,
        lengthMm: board.lengthMm,
        widthMm: board.widthMm,
        thicknessMm: board.thicknessMm,
        materialName: board.materialName ?? 'Sin material',
        holes,
      });
    }
  }
  return { patterns, holesTotal };
}

describe.skipIf(!inDir || !outDir)('KDT export del proyecto real (demo 2026-10-04)', () => {
  it('escribe los programas KDT desde la liberación congelada', async () => {
    const { frozen, boards, idByPart } = readInputs();
    const { patterns, holesTotal } = drillingPatterns(frozen, idByPart, boards);
    expect(patterns.length).toBe(8);
    expect(holesTotal).toBeGreaterThan(0);

    const jobId = `${frozen.release.id}--kdt`;
    const job: ResolvedMachiningJob = {
      jobId,
      provenance: {
        projectId: '63f77dcb-8d33-4956-bb8e-014f1177a77b',
        generatedAt: '2026-10-04T16:00:00.000Z',
        productionReleaseId: frozen.release.id,
        bomFingerprint: frozen.release.manufacturingFingerprint,
      },
      drilling: {
        schema: 'muebles.drilling-data.v1',
        projectId: '63f77dcb-8d33-4956-bb8e-014f1177a77b',
        projectName: 'Demo KDT Flexdrill 1200',
        generatedAt: '2026-10-04T16:00:00.000Z',
        totalPiecesCount: patterns.length,
        totalHolesCount: holesTotal,
        source: 'frozen-release',
        releaseId: frozen.release.id,
        manufacturingFingerprint: frozen.release.manufacturingFingerprint,
        patterns,
      },
    };

    const selection: MachineOutputSelection = {
      operation: 'machining',
      machineProfileId: 'client-b-machine-c-kdt-flexdrill1200',
      machineProfileRevisionId: 'r1',
      outputCompatibilityProfileId: 'kdt-flexdrill-1200',
      outputCompatibilityProfileRevisionId: 'r2',
      outputCompatibilityProfileDigest: KDT_FLEXDRILL_1200_PROFILE.digest,
      postprocessorAdapterId: KDT_POSTPROCESSOR_ADAPTER.postprocessorAdapterId,
      postprocessorAdapterVersion: KDT_POSTPROCESSOR_ADAPTER.adapterVersion,
      postprocessorImplementationDigest: KDT_POSTPROCESSOR_ADAPTER.implementationDigest,
    };

    const bundles = await generateSelectedMachiningOutput(job, selection);
    expect(bundles.length).toBeGreaterThan(0);

    // UNA función de nombre para todo (#1061, decisión owner 2026-10-04):
    // base = ID del despiece; sufijo de cara A/B SOLO si la pieza tiene
    // programas en dos caras. Sin prefijos de formato: el barcode de la
    // etiqueta ES el nombre del archivo que escanea el CNC.
    const facesByPiece = new Map<string, Set<string>>();
    for (const bundle of bundles) {
      const d = bundle.manifest.delivery as { piece?: { code: string; machiningFace: string } };
      const code = d.piece?.code ?? '';
      const face = d.piece?.machiningFace ?? 'front';
      if (!facesByPiece.has(code)) facesByPiece.set(code, new Set());
      facesByPiece.get(code)!.add(face);
    }
    const artifactBase = (code: string, face: string): string => {
      const faces = facesByPiece.get(code);
      if (!faces || faces.size <= 1) return code;
      return `${code}-${face === 'back' ? 'B' : 'A'}`;
    };

    mkdirSync(outDir!, { recursive: true });
    const index: Record<string, unknown> = {};
    for (const bundle of bundles) {
      const d = bundle.manifest.delivery as { piece?: { code: string; machiningFace: string } };
      const base = artifactBase(d.piece?.code ?? '', d.piece?.machiningFace ?? 'front');
      writeFileSync(join(outDir!, `${base}.xml`), bundle.artifact.bytes);
      writeFileSync(join(outDir!, `${base}.xml.manifest.json`), bundle.manifestJson);
      index[`${base}.xml`] = {
        pieza: d.piece?.code,
        cara: d.piece?.machiningFace,
        sha256: await sha256Hex(bundle.artifact.bytes),
        bytes: bundle.artifact.bytes.byteLength,
      };
    }
    writeFileSync(join(outDir!, 'programas-index.json'), JSON.stringify(index, null, 2));
    console.log(`[demo-kdt] ${bundles.length} programas escritos en ${outDir}`);
    console.log(`[demo-kdt] piezas: ${patterns.length}, agujeros congelados: ${holesTotal}`);
  });

  it('escribe el DXF por pieza con las perforaciones congeladas y nombres de despiece', async () => {
    const { optimizeCutPlan, DEFAULT_CUT_PLAN_CONFIG } = await import('@granete/domain');
    const { generateDxfByPiece } = await import('../../dxfCutPlanExport');
    const { frozen, resolve, boards, idByPart } = readInputs();

    const edges = new Map<string, string[]>();
    for (const unit of frozen.routing.units) {
      for (const p of unit.parts) edges.set(p.partId, p.edgeBandingSides);
    }

    const rows = [...boards.entries()].map(([id, b]) => {
      const e = edges.get(id) ?? [];
      const code = idByPart.get(id)!.id;
      return {
        quantity: 1,
        lengthMm: b.lengthMm,
        widthMm: b.widthMm,
        description: `${code} · ${b.name} · MOD-BAJ-1P-IZQ`,
        materialName: b.materialName ?? 'Arauco Blanco Frosty 15mm',
        materialCode: 'ARA-BLA-FRO-15',
        grain: 0 as const,
        L1: (e.includes('L1') ? 1 : 0) as 0 | 1,
        L2: (e.includes('L2') ? 1 : 0) as 0 | 1,
        W1: (e.includes('W1') ? 1 : 0) as 0 | 1,
        W2: (e.includes('W2') ? 1 : 0) as 0 | 1,
        partCode: code,
        partName: b.name,
        moduleCode: 'MOD-BAJ-1P-IZQ',
        thicknessMm: b.thicknessMm,
      };
    });
    const materials = [{
      code: 'ARA-BLA-FRO-15', name: 'Arauco Blanco Frosty 15mm',
      lengthMm: 2500, widthMm: 1830, thicknessMm: 15, grain: false,
    }];
    const cutPlan = optimizeCutPlan(
      '63f77dcb-8d33-4956-bb8e-014f1177a77b',
      rows,
      materials,
      { ...DEFAULT_CUT_PLAN_CONFIG, cutStrategy: 'cnc-nesting' } as never,
      'Demo KDT Flexdrill 1200',
    );

    const drilling = [...boards.entries()].map(([id, b]) => {
      const part = frozen.routing.units.flatMap((u) => u.parts).find((p) => p.partId === id);
      return {
        pieceCode: idByPart.get(id)!.id,
        moduleCode: 'MOD-BAJ-1P-IZQ',
        partName: b.name,
        lengthMm: b.lengthMm,
        widthMm: b.widthMm,
        thicknessMm: b.thicknessMm,
        materialName: b.materialName ?? 'Sin material',
        holes: (part?.operations ?? []).filter((o) => o.operation === 'drill').flatMap((o) => o.holes.map((h) => ({
          face: holeFace(h), xMm: h.xMm, yMm: h.yMm,
          diameterMm: h.diameterMm, depthMm: h.depthMm, type: holeType(h),
        }))),
      };
    });

    const files = generateDxfByPiece({ cutPlan, projectName: 'Demo KDT Flexdrill 1200', drilling });
    expect(files.length).toBeGreaterThan(0);
    mkdirSync(join(outDir!, '..', 'dxf-piezas'), { recursive: true });
    for (const f of files) {
      // Nombre = ID del despiece (ordinal de mueble + pieza congelada).
      const code = f.fileName.match(/_([0-9]-P[0-9]{2})_MOD/)?.[1] ?? f.fileName;
      writeFileSync(join(outDir!, '..', 'dxf-piezas', `${code}.dxf`), f.bytes);
    }
    console.log(`[demo-kdt] ${files.length} DXF por pieza escritos`);
  });
});
