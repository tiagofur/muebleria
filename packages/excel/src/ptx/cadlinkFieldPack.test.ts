import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { PtxDocument } from './records';
import { serializePtxDocumentUnchecked } from './serialize';
import { serializePtxDocumentBytesSpecChecked } from './specPreflight';
import { compileCutPlanToPtxDocument } from './compileCutPlan';
import {
  GOLDEN_R5_DECIMAL_PLACES,
  GOLDEN_R5_OPTIONS,
  buildGoldenR5Candidate,
} from './cutPlanPtxGoldenR5';
import {
  analyzeCadlinkFieldResult,
  buildCadlinkFieldPack,
  cadlinkFieldPackIdentityPinsFromSelection,
  CadlinkFieldPackError,
  type CadlinkFieldPackBuildInput,
  type CadlinkFieldPackIdentityPins,
} from './cadlinkFieldPack';
import { CadlinkRltParseError } from './cadlinkRlt';

const GOLDEN_R5_SHA256 = '239e9f7c8989c5f3756545da94a184b7b79aa1bdda797755c065301917201932';
const GOLDEN_R5_BYTES = 3303;
const CANDIDATE_FILENAME = 'LAB-792-R5-GOLDEN.ptx';

/**
 * LAB/TEST identity pins — deliberately impossible to confuse with a
 * productive #793 identity (ptx-cadmatic-4@r5 / granete-ptx@1.4.0).
 */
const LAB_TEST_ONLY_PINS: CadlinkFieldPackIdentityPins = {
  machineProfileId: 'LAB_TEST_ONLY-machine-profile',
  machineProfileRevisionId: 'LAB_TEST_ONLY-machine-profile-r0',
  outputCompatibilityProfileId: 'LAB_TEST_ONLY-output-profile',
  outputCompatibilityProfileRevisionId: 'LAB_TEST_ONLY-output-profile-r0',
  outputCompatibilityProfileDigest: 'LAB_TEST_ONLY-output-profile-sha256',
  postprocessorAdapterId: 'LAB_TEST_ONLY-adapter',
  postprocessorAdapterVersion: '0.0.0-lab',
  postprocessorImplementationDigest: 'LAB_TEST_ONLY-adapter-implementation-sha256',
};

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function ascii(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Pack file accessor by name — fails loud instead of asserting index access. */
function packFileByName(
  files: readonly { name: string; bytes: Uint8Array; sha256: string; byteLength: number }[],
  name: string,
): { name: string; bytes: Uint8Array; sha256: string; byteLength: number } {
  const file = files.find((entry) => entry.name === name);
  if (file === undefined) throw new Error(`pack is missing file ${name}`);
  return file;
}

function packFile(
  pack: Awaited<ReturnType<typeof buildCadlinkFieldPack>>,
  name: string,
): { name: string; bytes: Uint8Array; sha256: string; byteLength: number } {
  return packFileByName(pack.files, name);
}


const candidate = await buildGoldenR5Candidate();

const compileOptions = { ...GOLDEN_R5_OPTIONS, partLabels: candidate.labels };

function packInput(): CadlinkFieldPackBuildInput {
  return {
    ptxFilename: CANDIDATE_FILENAME,
    ptxBytes: candidate.bytes,
    cutPlan: candidate.plan,
    mapping: candidate.compiled.mapping,
    compileOptions,
    identityPins: LAB_TEST_ONLY_PINS,
  };
}

/** Re-serialize a mutated document, bypassing validation exactly like a byte-level mutation would. */
function mutatedBytes(document: PtxDocument): Uint8Array {
  return new TextEncoder().encode(
    serializePtxDocumentUnchecked(document, { decimalPlaces: GOLDEN_R5_DECIMAL_PLACES }),
  );
}

describe('#792 field pack — valid golden r5 builds a deterministic pack', () => {
  it('1. builds a pack for the valid golden r5 with the documented file set', async () => {
    const pack = await buildCadlinkFieldPack(packInput());

    expect(pack.files.map((file) => file.name)).toEqual([
      CANDIDATE_FILENAME,
      'manifest.json',
      'expected_identity.json',
      'README_FIELD_TEST.txt',
      'CHECKSUMS.sha256',
    ]);
    expect(pack.fieldTestMode).toBe('CAD4');
    expect(pack.receiverPolicyId).toBe('HPP250_CAD4_R5_LAB');
  });

  it('2. rebuilds every file byte-exact from the same inputs', async () => {
    const first = await buildCadlinkFieldPack(packInput());
    const second = await buildCadlinkFieldPack(packInput());

    expect(second.files.map((file) => file.bytes)).toEqual(first.files.map((file) => file.bytes));
    expect(second.checksumsSha256).toBe(first.checksumsSha256);
  });

  it('3. carries the exact golden PTX bytes and SHA', async () => {
    const pack = await buildCadlinkFieldPack(packInput());
    const ptxFile = packFile(pack, CANDIDATE_FILENAME);

    expect(ptxFile?.name).toBe(CANDIDATE_FILENAME);
    expect(ptxFile?.bytes).toEqual(candidate.bytes);
    expect(ptxFile?.sha256).toBe(GOLDEN_R5_SHA256);
    expect(ptxFile?.byteLength).toBe(GOLDEN_R5_BYTES);
    expect(pack.ptxSha256).toBe(GOLDEN_R5_SHA256);
  });

  it('4. produces exact deterministic manifest bytes', async () => {
    const first = await buildCadlinkFieldPack(packInput());
    const second = await buildCadlinkFieldPack(packInput());
    const manifestA = packFile(first, 'manifest.json');
    const manifestB = packFile(second, 'manifest.json');

    expect(manifestA?.name).toBe('manifest.json');
    expect(manifestB?.bytes).toEqual(manifestA?.bytes);

    const manifest = JSON.parse(ascii(manifestA.bytes));
    expect(manifest.schemaVersion).toBe('granete-cadlink-field-pack/1');
    expect(manifest.fieldTestMode).toBe('CAD4');
    expect(manifest.candidateFilename).toBe(CANDIDATE_FILENAME);
    expect(manifest.receiverPolicyId).toBe('HPP250_CAD4_R5_LAB');
    expect(manifest.candidate.title).toBe('LAB-R5-GOLDEN-TEST-ONLY1');
    expect(manifest.ptx).toEqual({ sha256: GOLDEN_R5_SHA256, byteLength: GOLDEN_R5_BYTES });
    expect(manifest.records).toMatchObject({
      total: 60,
      jobs: 1,
      parts: 10,
      partsInf: 10,
      partsUdi: 10,
      boards: 4,
      materials: 2,
      offcuts: 1,
      vectors: 0,
    });
    expect(manifest.expectedCadlinkResult).toEqual({ errorNumber: 0, fieldNumber: 0, lineNumber: 0 });
    expect(manifest.supportStatus).toEqual({
      status: 'NOT_TESTED',
      compatibilityClaim: 'notClaimed',
      note: 'LAB/TEST field pack: no CADmatic/CADLink acceptance is claimed by this pack',
    });
    expect(manifest.cadlinkIntent.deleteOptionUsed).toBe(false);
  });

  it('5. manifest SHA is the hash of the exact manifest bytes', async () => {
    const pack = await buildCadlinkFieldPack(packInput());
    const manifestFile = packFile(pack, 'manifest.json');

    expect(manifestFile?.sha256).toBe(sha256(manifestFile.bytes));
  });

  it('6. CHECKSUMS.sha256 lists every payload file with exact hashes, sorted by filename', async () => {
    const pack = await buildCadlinkFieldPack(packInput());
    const checksumsFile = packFile(pack, 'CHECKSUMS.sha256');
    const payload = pack.files.slice(0, 4);

    expect(ascii(checksumsFile.bytes).endsWith('\n')).toBe(true);
    const entries = ascii(checksumsFile.bytes)
      .trimEnd()
      .split('\n')
      .map((line) => {
        const [hash, name] = line.split('  ');
        if (hash === undefined || name === undefined) {
          throw new Error(`malformed CHECKSUMS line: '${line}'`);
        }
        return { hash, name };
      });

    expect(entries.map((entry) => entry.name)).toEqual(
      payload.map((file) => file.name).sort((a, b) => (a < b ? -1 : 1)),
    );
    for (const entry of entries) {
      const file = packFileByName(payload, entry.name);
      expect(entry.hash, entry.name).toBe(file.sha256);
      expect(entry.hash).toBe(sha256(file.bytes));
    }
    expect(checksumsFile.sha256).toBe(sha256(checksumsFile.bytes));
  });

  it('7. expected_identity.json references the manifest and pins the comparison facts', async () => {
    const pack = await buildCadlinkFieldPack(packInput());
    const identity = JSON.parse(ascii(packFile(pack, 'expected_identity.json').bytes));

    expect(identity.schemaVersion).toBe('granete-cadlink-field-identity/1');
    expect(identity.primaryRecord).toBe('manifest.json');
    expect(identity.candidateFilename).toBe(CANDIDATE_FILENAME);
    expect(identity.ptx).toEqual({ sha256: GOLDEN_R5_SHA256, byteLength: GOLDEN_R5_BYTES });
    expect(identity.receiverPolicyId).toBe('HPP250_CAD4_R5_LAB');
    expect(identity.expectedCadlinkMode).toBe('CAD4');
    expect(identity.expectedSuccessfulRlt).toEqual({ errorNumber: 0, fieldNumber: 0, lineNumber: 0 });
  });

  it('8. records the identity pins byte-for-byte in both records', async () => {
    const pack = await buildCadlinkFieldPack(packInput());
    const manifest = JSON.parse(ascii(packFile(pack, 'manifest.json').bytes));
    const identity = JSON.parse(ascii(packFile(pack, 'expected_identity.json').bytes));

    const expectedIdentity = {
      machineProfile: {
        id: 'LAB_TEST_ONLY-machine-profile',
        revisionId: 'LAB_TEST_ONLY-machine-profile-r0',
      },
      outputCompatibilityProfile: {
        id: 'LAB_TEST_ONLY-output-profile',
        revisionId: 'LAB_TEST_ONLY-output-profile-r0',
        digest: 'LAB_TEST_ONLY-output-profile-sha256',
      },
      postprocessorAdapter: {
        id: 'LAB_TEST_ONLY-adapter',
        version: '0.0.0-lab',
        implementationDigest: 'LAB_TEST_ONLY-adapter-implementation-sha256',
      },
    };
    expect(manifest.identity).toEqual(expectedIdentity);
    expect(identity.identity).toEqual(expectedIdentity);
  });

  it('9. pins map structurally from a MachineOutputSelection-shaped selection', () => {
    const pins = cadlinkFieldPackIdentityPinsFromSelection({
      machineProfileId: 'machine-a',
      machineProfileRevisionId: 'machine-a-r1',
      outputProfileId: 'ptx-cadmatic-4',
      outputProfileRevisionId: 'r5',
      outputProfileDigest: 'deadbeef',
      adapterId: 'granete-ptx',
      adapterVersion: '1.4.0',
      adapterImplementationDigest: 'cafebabe',
    });

    expect(pins).toEqual({
      machineProfileId: 'machine-a',
      machineProfileRevisionId: 'machine-a-r1',
      outputCompatibilityProfileId: 'ptx-cadmatic-4',
      outputCompatibilityProfileRevisionId: 'r5',
      outputCompatibilityProfileDigest: 'deadbeef',
      postprocessorAdapterId: 'granete-ptx',
      postprocessorAdapterVersion: '1.4.0',
      postprocessorImplementationDigest: 'cafebabe',
    });
  });

  it('10. README is deterministic', async () => {
    const first = await buildCadlinkFieldPack(packInput());
    const second = await buildCadlinkFieldPack(packInput());

    expect(packFile(second, 'README_FIELD_TEST.txt').bytes).toEqual(
      packFile(first, 'README_FIELD_TEST.txt').bytes,
    );
    // (name checked by the packFile accessor itself)
  });

  it('11-13. README forces /CAD4, /RESULT and /UDI /INF intent', async () => {
    const pack = await buildCadlinkFieldPack(packInput());
    const readme = ascii(packFile(pack, 'README_FIELD_TEST.txt').bytes);

    const commandLines = readme
      .split(/\r\n/)
      .filter((line) => line.trimStart().startsWith('cadlink.exe'));
    expect(commandLines).toHaveLength(1);
    const command = commandLines[0] ?? '';
    expect(command).toContain('/CAD4');
    expect(command).toContain('/RESULT=');
    expect(command).toContain('/UDI /INF');
    expect(command).not.toContain('/DELETE');
    expect(readme).toContain('/CAD4');
    expect(readme).toContain('/RESULT');
    expect(readme).toContain('/UDI /INF');
  });

  it('14. README warns that cadlink.ini overrides every command-line option', async () => {
    const pack = await buildCadlinkFieldPack(packInput());
    const readme = ascii(packFile(pack, 'README_FIELD_TEST.txt').bytes);

    expect(readme).toContain('CADLINK.INI EXISTS');
    expect(readme).toContain('IGNORES ALL COMMAND-LINE OPTIONS');
    expect(readme).toContain('cadlinkIniPresent: <true | false | unknown>');
    expect(readme).toContain('effectiveOptionsVerified: <true | false>');
  });

  it('15. README forbids physical cutting and .SAW execution', async () => {
    const pack = await buildCadlinkFieldPack(packInput());
    const readme = ascii(packFile(pack, 'README_FIELD_TEST.txt').bytes);

    expect(readme).toContain('THIS TEST IS IMPORT/CONVERSION ONLY.');
    expect(readme).toContain('DO NOT START THE SAW.');
    expect(readme).toContain('DO NOT CUT MATERIAL.');
    expect(readme).toContain('DO NOT EXECUTE THE GENERATED .SAW FILE.');
  });

  it('16. README/manifest never instruct /DELETE and state it is not used', async () => {
    const pack = await buildCadlinkFieldPack(packInput());
    const readme = ascii(packFile(pack, 'README_FIELD_TEST.txt').bytes);
    const manifest = JSON.parse(ascii(packFile(pack, 'manifest.json').bytes));

    expect(readme).toContain('/DELETE is deliberately NOT used');
    expect(manifest.cadlinkIntent.deleteOptionUsed).toBe(false);
    expect(manifest.cadlinkIntent.commandTemplate).not.toContain('/DELETE');
  });

  it('17-18. pack text carries no absolute paths, usernames, hostnames or timestamps', async () => {
    const pack = await buildCadlinkFieldPack(packInput());
    for (const file of pack.files.filter((entry) => entry.name !== CANDIDATE_FILENAME)) {
      const text = ascii(file.bytes);
      expect(text, file.name).not.toMatch(/\/Users\/|\\Users\\|\/home\/|C:\\/i);
      expect(text, file.name).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
      expect(text, file.name).not.toContain('tiagofur');
      expect(text, file.name).not.toContain('generatedAt');
      expect(text, file.name).not.toContain('hostname');
      // README is plain printable ASCII for the legacy Windows environment.
      if (file.name === 'README_FIELD_TEST.txt') {
        expect(text).toMatch(/^[\x20-\x7E\r\n]*$/);
      }
    }
  });

  it('19. a pack with no optional pictures stays valid and records empty attachments', async () => {
    const pack = await buildCadlinkFieldPack(packInput());
    const manifest = JSON.parse(ascii(packFile(pack, 'manifest.json').bytes));

    expect(manifest.attachments).toEqual([]);
    expect(pack.files.map((file) => file.name)).not.toContain('LABEL-PIC-792.PNG');
  });
});

describe('#792 field pack — preflight blocks invalid candidates', () => {
  it('20. corrupt PTX bytes → no pack (parse gate)', async () => {
    const input = {
      ...packInput(),
      ptxBytes: new TextEncoder().encode('THIS IS NOT A PTX FILE\r\n'),
    };
    await expect(buildCadlinkFieldPack(input)).rejects.toMatchObject({ code: 'field_pack.parse_failed' });
  });

  it('21. HEADER title > 25 → no pack (strict spec gate)', async () => {
    const document = {
      ...candidate.parsed,
      header: { ...candidate.parsed.header, title: `${candidate.parsed.header.title}XX` },
    };
    const input = { ...packInput(), ptxBytes: mutatedBytes(document) };

    await expect(buildCadlinkFieldPack(input)).rejects.toMatchObject({ code: 'field_pack.spec_preflight_failed' });
  });

  it('22a. MATERIALS.RULE1 6 → 7 → no pack (receiver semantic readback gate)', async () => {
    const document = {
      ...candidate.parsed,
      records: candidate.parsed.records.map((record) =>
        record.type === 'MATERIALS' ? { ...record, rule1: 7 } : record,
      ),
    };
    const input = { ...packInput(), ptxBytes: mutatedBytes(document) };

    await expect(buildCadlinkFieldPack(input)).rejects.toMatchObject({ code: 'field_pack.readback_failed' });
  });

  it('22b. expected CUTS FUNCTION 92 → 93 → no pack (semantic verifier gate)', async () => {
    const document = {
      ...candidate.parsed,
      records: candidate.parsed.records.map((record) =>
        record.type === 'CUTS' && record.functionCode === 92
          ? { ...record, functionCode: 93 }
          : record,
      ),
    };
    const input = { ...packInput(), ptxBytes: mutatedBytes(document) };

    await expect(buildCadlinkFieldPack(input)).rejects.toMatchObject({ code: 'field_pack.readback_failed' });
  });

  it('23. missing receiver policy → no pack', async () => {
    const { receiverPolicy: _omitted, ...optionsWithoutPolicy } = compileOptions;
    const input = { ...packInput(), compileOptions: optionsWithoutPolicy };

    await expect(buildCadlinkFieldPack(input)).rejects.toMatchObject({ code: 'field_pack.receiver_policy_missing' });
  });

  it('24. missing identity pin → no pack', async () => {
    const { postprocessorImplementationDigest: _digest, ...pinsWithoutDigest } = LAB_TEST_ONLY_PINS;
    const input = {
      ...packInput(),
      identityPins: pinsWithoutDigest as CadlinkFieldPackIdentityPins,
    };

    await expect(buildCadlinkFieldPack(input)).rejects.toMatchObject({ code: 'field_pack.identity_pin_missing' });
  });

  it('25. empty digest pin → no pack (a null selection digest fails closed)', async () => {
    const input = {
      ...packInput(),
      identityPins: { ...LAB_TEST_ONLY_PINS, outputCompatibilityProfileDigest: '' },
    };

    await expect(buildCadlinkFieldPack(input)).rejects.toMatchObject({ code: 'field_pack.identity_pin_missing' });

    const pins = cadlinkFieldPackIdentityPinsFromSelection({
      machineProfileId: 'm',
      machineProfileRevisionId: 'm-r1',
      outputProfileId: 'o',
      outputProfileRevisionId: 'o-r1',
      outputProfileDigest: null,
      adapterId: 'a',
      adapterVersion: '1',
      adapterImplementationDigest: 'd',
    });
    await expect(buildCadlinkFieldPack({ ...packInput(), identityPins: pins })).rejects.toMatchObject({ code: 'field_pack.identity_pin_missing' });
  });

  it('blocks a label udiPictureRef that resolves to no real picture file', async () => {
    const labels = candidate.labels.map((label, index) =>
      index === 0 ? { ...label, udiPictureRef: 'LABEL-PIC-792.PNG' } : label,
    );
    const compiled = compileCutPlanToPtxDocument(candidate.plan, {
      ...GOLDEN_R5_OPTIONS,
      partLabels: labels,
    });
    const bytes = serializePtxDocumentBytesSpecChecked(compiled.document, {
      decimalPlaces: GOLDEN_R5_DECIMAL_PLACES,
    });
    const input = {
      ...packInput(),
      ptxBytes: bytes,
      mapping: compiled.mapping,
      compileOptions: { ...GOLDEN_R5_OPTIONS, partLabels: labels },
    };

    await expect(buildCadlinkFieldPack(input)).rejects.toMatchObject({ code: 'field_pack.picture_missing' });

    const pack = await buildCadlinkFieldPack({
      ...input,
      optionalPictures: [
        { name: 'LABEL-PIC-792.PNG', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
      ],
    });
    const manifest = JSON.parse(ascii(packFile(pack, 'manifest.json').bytes));
    expect(manifest.attachments).toEqual([
      {
        name: 'LABEL-PIC-792.PNG',
        sha256: sha256(new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
        byteLength: 4,
      },
    ]);
    expect(pack.files.map((file) => file.name)).toContain('LABEL-PIC-792.PNG');
  });

  it('rejects unsafe filenames and picture names before any gate', async () => {
    await expect(
      buildCadlinkFieldPack({ ...packInput(), ptxFilename: '../escape.ptx' }),
    ).rejects.toMatchObject({ code: 'field_pack.options_invalid' });
    await expect(
      buildCadlinkFieldPack({ ...packInput(), ptxFilename: 'candidate.txt' }),
    ).rejects.toMatchObject({ code: 'field_pack.options_invalid' });
  });
});

describe('#792 field-result readback API', () => {
  it('analyzes a successful .RLT against the expected identity', async () => {
    const analysis = await analyzeCadlinkFieldResult({
      rltBytes: new TextEncoder().encode('0\r\n0\r\n0\r\n'),
      ptxBytes: candidate.bytes,
      expectedIdentity: { ptxSha256: GOLDEN_R5_SHA256, ptxByteLength: GOLDEN_R5_BYTES },
    });

    expect(analysis.outcome).toBe('SUCCESS');
    expect(analysis.diagnosis.diagnosticCode).toBe('cadlink.import_success');
    expect(analysis.ptxIdentity.matches).toBe(true);
    expect(analysis.supportStatusPolicy).toBe('field-evidence-only');
  });

  it('reports structured failure diagnostics for a rejected import', async () => {
    const analysis = await analyzeCadlinkFieldResult({
      rltBytes: new TextEncoder().encode('17\r\n4\r\n23\r\n'),
      ptxBytes: candidate.bytes,
      expectedIdentity: { ptxSha256: GOLDEN_R5_SHA256, ptxByteLength: GOLDEN_R5_BYTES },
    });

    expect(analysis.outcome).toBe('FAILURE');
    expect(analysis.diagnosis.diagnosticCode).toBe('cadlink.illegal_material_index');
    expect(analysis.diagnosis.fieldNumber).toBe(4);
    expect(analysis.diagnosis.lineNumber).toBe(23);
  });

  it('flags when the attempted PTX is not the reviewed candidate', async () => {
    const analysis = await analyzeCadlinkFieldResult({
      rltBytes: new TextEncoder().encode('0\r\n0\r\n0\r\n'),
      ptxBytes: candidate.bytes,
      expectedIdentity: { ptxSha256: 'deadbeef', ptxByteLength: GOLDEN_R5_BYTES },
    });

    expect(analysis.outcome).toBe('SUCCESS');
    expect(analysis.ptxIdentity.matches).toBe(false);
    expect(analysis.ptxIdentity.expectedPtxSha256).toBe('deadbeef');
    expect(analysis.ptxIdentity.actualPtxSha256).toBe(GOLDEN_R5_SHA256);
  });

  it('throws on malformed .RLT evidence instead of inventing an outcome', async () => {
    await expect(
      analyzeCadlinkFieldResult({
        rltBytes: new TextEncoder().encode('0\n0'),
        ptxBytes: candidate.bytes,
        expectedIdentity: { ptxSha256: GOLDEN_R5_SHA256, ptxByteLength: GOLDEN_R5_BYTES },
      }),
    ).rejects.toThrow(CadlinkRltParseError);
  });
});

