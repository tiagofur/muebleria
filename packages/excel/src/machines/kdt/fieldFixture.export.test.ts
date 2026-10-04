/**
 * K4 field fixture OFFLINE EXPORTER (#1005 K4).
 *
 * Writes the three frozen KDTPanelFormat programs (byte-identical to the
 * pinned hashes in docs/machines/client-b/k4-field-validation/
 * expected-values.md) plus their manifests, WITHOUT needing an app project:
 *
 *   KDT_FIELD_OUT=/ruta/al/directorio \
 *     pnpm --filter @granete/excel exec vitest run \
 *     src/machines/kdt/fieldFixture.export.test.ts
 *
 * Skips silently when KDT_FIELD_OUT is unset. Byte-identity with the
 * pinned hashes is asserted on write — if this test ever fails, the field
 * kit docs and the code have diverged and the session must not start.
 */

import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MachineOutputSelection } from '@granete/domain';
import { generateSelectedMachiningOutput } from '../outputSelectionResolver';
import { KDT_FLEXDRILL_1200_PROFILE } from '../profiles';
import { KDT_POSTPROCESSOR_ADAPTER } from '../kdtAdapter';
import { buildKdtFieldFixtureJob, KDT_FIELD_PROGRAM_SHA256 } from './fieldFixture';
import { sha256Hex } from '../digest';

const outDir = process.env.KDT_FIELD_OUT;

describe.skipIf(!outDir)('KDT field fixture export (KDT_FIELD_OUT set)', () => {
  it('escribe los 3 programas congelados + manifests, byte-idénticos a los hashes pinned', async () => {
    const job = buildKdtFieldFixtureJob();
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
    expect(bundles).toHaveLength(3);

    mkdirSync(outDir!, { recursive: true });
    for (const bundle of bundles) {
      writeFileSync(join(outDir!, bundle.artifact.fileName), bundle.artifact.bytes);
      writeFileSync(
        join(outDir!, `${bundle.artifact.fileName}.manifest.json`),
        bundle.manifestJson,
      );
      const key = Object.entries(KDT_FIELD_PROGRAM_SHA256).find(([key]) =>
        bundle.manifest.delivery.mode === 'by-piece' &&
        bundle.manifest.delivery.piece?.code === key.split(':')[0] &&
        bundle.manifest.delivery.piece?.machiningFace === (key.split(':')[1] as 'front' | 'back'),
      );
      expect(key, `hash pinned para ${bundle.artifact.fileName}`).toBeDefined();
      expect(await sha256Hex(bundle.artifact.bytes)).toBe(KDT_FIELD_PROGRAM_SHA256[key![0]]);
    }
    console.log(`[k4-export] 3 programas + 3 manifests escritos en ${outDir}`);
  });
});
