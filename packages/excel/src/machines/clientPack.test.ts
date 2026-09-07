import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildClientValidationPack } from './clientPack';

describe('buildClientValidationPack', () => {
  it('generates ONLY the evidence-backed cutting artifact (ptx-generic)', async () => {
    const pack = await buildClientValidationPack();

    expect(pack.generated.map((entry) => entry.name)).toEqual(['test-generic']);
    const generic = pack.generated[0]!;
    expect(generic.bundle.artifact.fileName).toBe('test-generic.ptx');
    expect(generic.bundle.manifest.validationStatus).toBe('NOT_TESTED');
    expect(generic.bundle.manifest.outputCompatibilityProfile.revisionId).toBe('r1');
  });

  it('records every unevidenced target as notGenerated with reasons', async () => {
    const pack = await buildClientValidationPack();
    const names = pack.notGenerated.map((entry) => entry.name).sort();
    expect(names).toEqual(['test-bhx050', 'test-cadmatic3', 'test-cadmatic4', 'test-cadmatic5', 'test-hpp250']);

    for (const entry of pack.notGenerated) {
      expect(entry.reasons.length).toBeGreaterThan(0);
      expect(entry.neededEvidence.length).toBeGreaterThan(0);
      expect(entry.reasons.every((r) => r.code === 'FIELD_FORMAT_EVIDENCE_REQUIRED' || r.code === 'OPERATION_NOT_REPRESENTABLE')).toBe(true);
    }
  });

  it('pack README carries the non-production banners and checksums', async () => {
    const pack = await buildClientValidationPack();
    expect(pack.readme).toContain('NON-PRODUCTION VALIDATION ARTIFACT');
    expect(pack.readme).toContain('DO NOT EXECUTE PRODUCTION CUTTING/MACHINING');
    expect(pack.readme).toContain('test-generic.ptx');
    expect(pack.readme).toContain('sha256=');
    expect(pack.readme).toContain('client-test-procedure.md');
  });

  it('is deterministic across builds', async () => {
    const a = await buildClientValidationPack();
    const b = await buildClientValidationPack();
    expect(a.readme).toBe(b.readme);
    expect(a.generated[0]!.bundle.artifact.sha256).toBe(b.generated[0]!.bundle.artifact.sha256);
    expect(a.packId).toBe(b.packId);
  });

  it.runIf(Boolean(process.env.PTX_EMIT_CLIENT_PACK_DIR))(
    'emits the sanitized Client A validation pack',
    async () => {
      const outDir = process.env.PTX_EMIT_CLIENT_PACK_DIR!;
      mkdirSync(outDir, { recursive: true });

      const pack = await buildClientValidationPack();
      for (const entry of pack.generated) {
        writeFileSync(
          resolve(outDir, entry.bundle.artifact.fileName),
          Buffer.from(entry.bundle.artifact.bytes),
        );
        writeFileSync(
          resolve(outDir, `${entry.name}.manifest.json`),
          entry.bundle.manifestJson,
          'utf8',
        );
        console.log(
          `[client-pack] ${entry.bundle.artifact.fileName} sha256=${entry.bundle.artifact.sha256}`,
        );
      }
      writeFileSync(resolve(outDir, 'README.txt'), pack.readme, 'utf8');
      console.log(`[client-pack] Pack written to ${outDir} (${pack.generated.length} generated, ${pack.notGenerated.length} pending evidence)`);
    },
  );
});
