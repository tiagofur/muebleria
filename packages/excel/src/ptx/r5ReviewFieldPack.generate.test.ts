/**
 * #793 — FINAL-REVIEW field pack generator (review-only, never sent).
 *
 * Runs ONLY when GRANETE_R5_REVIEW_PACK_DIR is set (CI leaves it unset, so
 * the test skips there — the pack is a local review artifact, not shipped
 * evidence). It drives the SAME productive route a real release takes:
 *
 *   frozen release fixture (no private data)
 *   → neutral ManufacturingLabelProjection (+ explicit fixture CNC authority)
 *   → optimizeCutPlan with releaseBase
 *   → generateSelectedCuttingOutput (r5 selection, adapter 1.4.0)
 *   → independent parse + strict spec preflight + semantic readback
 *   → buildCadlinkFieldPack with the REAL r5/1.4.0 identity pins
 *   → artifacts-local/ptx-r5-final-review/ (ignored by git)
 *
 * NOT_TESTED / notClaimed everywhere: generating the pack promotes nothing.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compileCutPlanToPtxDocument,
} from './compileCutPlan';
import { parsePtxDocumentBytes } from './parse';
import { ptxSpecPreflightDocument } from './specPreflight';
import { verifyCutPlanPtxReadback } from './verifyCutPlanPtxReadback';
import { ptxPartLabelsFromManufacturingProjection } from './partLabels';
import { buildCadlinkFieldPack } from './cadlinkFieldPack';
import { buildR5GateFixture } from './r5FieldCandidateFixture';
import { generateSelectedCuttingOutput } from '../machines/outputSelectionResolver';
import { PTX_CADMATIC_4_R5_PROFILE } from '../machines/profiles';
import {
  PTX_POSTPROCESSOR_ADAPTER,
  PTX_R5_FIELD_TEST_TITLE,
  resolvePtxCompilerRoute,
} from '../machines/ptxAdapter';

const OUTPUT_DIR = process.env.GRANETE_R5_REVIEW_PACK_DIR;

describe.skipIf(OUTPUT_DIR === undefined)('#793 final-review field pack generator', () => {
  it('generates the review pack through the productive r5 route and prints the exact report', async () => {
    const fixture = buildR5GateFixture();
    const selection = {
      operation: 'cutting' as const,
      machineProfileId: 'client-a-machine-b-hpp250',
      machineProfileRevisionId: 'r1',
      outputCompatibilityProfileId: PTX_CADMATIC_4_R5_PROFILE.ref.outputCompatibilityProfileId,
      outputCompatibilityProfileRevisionId: PTX_CADMATIC_4_R5_PROFILE.ref.revisionId,
      outputCompatibilityProfileDigest: PTX_CADMATIC_4_R5_PROFILE.digest,
      postprocessorAdapterId: PTX_POSTPROCESSOR_ADAPTER.postprocessorAdapterId,
      postprocessorAdapterVersion: PTX_POSTPROCESSOR_ADAPTER.adapterVersion,
      postprocessorImplementationDigest: PTX_POSTPROCESSOR_ADAPTER.implementationDigest,
    };

    const [bundle] = await generateSelectedCuttingOutput(
      fixture.plan,
      selection,
      'unified',
      { manufacturingLabels: fixture.projection },
    );
    expect(bundle).toBeDefined();

    // Every #792 gate re-runs on the exact bytes before any file exists.
    const parsed = parsePtxDocumentBytes(bundle!.artifact.bytes);
    expect(ptxSpecPreflightDocument(parsed)).toEqual([]);
    const partLabels = await ptxPartLabelsFromManufacturingProjection(fixture.projection);
    const compileOptions = {
      ...resolvePtxCompilerRoute(PTX_CADMATIC_4_R5_PROFILE).config!.compileOptions,
      partLabels,
    };
    const compiled = compileCutPlanToPtxDocument(fixture.plan, compileOptions);
    expect(verifyCutPlanPtxReadback(parsed, fixture.plan, compiled.mapping, compileOptions))
      .toEqual([]);

    const pack = await buildCadlinkFieldPack({
      ptxFilename: bundle!.artifact.fileName,
      ptxBytes: bundle!.artifact.bytes,
      cutPlan: fixture.plan,
      mapping: compiled.mapping,
      compileOptions,
      identityPins: {
        machineProfileId: selection.machineProfileId,
        machineProfileRevisionId: selection.machineProfileRevisionId,
        outputCompatibilityProfileId: selection.outputCompatibilityProfileId,
        outputCompatibilityProfileRevisionId: selection.outputCompatibilityProfileRevisionId,
        outputCompatibilityProfileDigest: selection.outputCompatibilityProfileDigest,
        postprocessorAdapterId: selection.postprocessorAdapterId,
        postprocessorAdapterVersion: selection.postprocessorAdapterVersion,
        postprocessorImplementationDigest: selection.postprocessorImplementationDigest,
      },
    });

    const dir = OUTPUT_DIR!;
    await mkdir(dir, { recursive: true });
    for (const file of pack.files) {
      await writeFile(join(dir, file.name), file.bytes);
    }

    // Compact review report (mission §30): everything the reviewer pins.
    const manifestFile = pack.files.find((file) => file.name === 'manifest.json')!;
    const manifest = JSON.parse(new TextDecoder().decode(manifestFile.bytes)) as {
      records: Record<string, number>;
      supportStatus: { status: string; compatibilityClaim: string };
    };
    const report = {
      outputDir: dir,
      ptx: {
        filename: bundle!.artifact.fileName,
        sha256: pack.ptxSha256,
        byteLength: bundle!.artifact.bytes.byteLength,
        title: PTX_R5_FIELD_TEST_TITLE,
      },
      manifestSha256: manifestFile.sha256,
      expectedIdentitySha256: pack.files.find((f) => f.name === 'expected_identity.json')!.sha256,
      checksumsSha256: pack.checksumsSha256,
      identity: {
        profile: `ptx-cadmatic-4@r5 ${PTX_CADMATIC_4_R5_PROFILE.digest}`,
        adapter: `granete-ptx@${PTX_POSTPROCESSOR_ADAPTER.adapterVersion} ${PTX_POSTPROCESSOR_ADAPTER.implementationDigest}`,
        machine: `${selection.machineProfileId}@${selection.machineProfileRevisionId}`,
        receiverPolicyId: compileOptions.receiverPolicy?.id,
      },
      records: manifest.records,
      supportStatus: { status: 'NOT_TESTED', compatibilityClaim: 'notClaimed' },
    };
    console.log(`[r5-review-pack]\n${JSON.stringify(report, null, 2)}`);
    expect(manifest.supportStatus.status).toBe('NOT_TESTED');
    expect(manifest.supportStatus.compatibilityClaim).toBe('notClaimed');
  });
});
