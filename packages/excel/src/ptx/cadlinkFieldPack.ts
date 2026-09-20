/**
 * #792 — deterministic CADLink field pack builder + field-result readback
 * API (R5-J of the #787 plan).
 *
 * The pack turns the next client CADLink trial into an instrumented,
 * reproducible execution: exact candidate PTX, exact identity pins, exact
 * hashes, exact CADLink command intent, and a README that asks for the .RLT
 * file instead of a verbal description of a popup.
 *
 * Fail-closed pipeline — no pack exists unless EVERY gate passes:
 *
 *   candidate bytes
 *   -> independent parse (parsePtxDocumentBytes)
 *   -> validatePtxDocument
 *   -> strict spec preflight (ptxSpecPreflightDocument, #788)
 *   -> receiver/product semantic readback (verifyCutPlanPtxReadback, #791)
 *   -> receiver policy present (#790)
 *   -> identity pins complete (#793 supplies the productive ones)
 *   -> label picture refs resolve to real pack files (#789 udiPictureRef)
 *   -> hashes + deterministic files
 *
 * Scope guard: #792 does NOT publish `ptx-cadmatic-4@r5` or
 * `granete-ptx@1.4.0`. Identity pins are REQUIRED from the caller (tests use
 * clearly-marked LAB_TEST_ONLY pins) and recorded byte-for-byte; #793 will
 * feed the real r5 identities through this same builder. Nothing here changes
 * profiles, adapter versions, routing, the productive output catalog,
 * supportStatus or any compatibility claim, and no PTX is sent to a client.
 */

import type { CutPlan } from '@granete/domain';
import { canonicalJson, sha256Hex } from '../machines/digest';
import {
  diagnoseCadlinkRlt,
  parseCadlinkRlt,
  type CadlinkRltDiagnosis,
  type CadlinkRltOutcome,
} from './cadlinkRlt';
import type { CompileCutPlanToPtxOptions, PtxCompilationMapping } from './compileCutPlan';
import { parsePtxDocumentBytes } from './parse';
import type { PtxDocument, PtxRecord } from './records';
import { ptxSpecPreflightDocument } from './specPreflight';
import { validatePtxDocument } from './validate';
import { verifyCutPlanPtxReadback } from './verifyCutPlanPtxReadback';

// ---------------------------------------------------------------------------
// Identity pins
// ---------------------------------------------------------------------------

/**
 * Exact profile/adapter identities a field pack must register.
 *
 * The productive source is `MachineOutputSelection` (generated contracts);
 * `cadlinkFieldPackIdentityPinsFromSelection` maps it structurally so #793
 * can pass a real selection without this package depending on storage. Every
 * pin is required non-empty — a null digest is a missing digest, not a
 * wildcard — and pins are recorded byte-for-byte.
 */
export interface CadlinkFieldPackIdentityPins {
  readonly machineProfileId: string;
  readonly machineProfileRevisionId: string;
  readonly outputCompatibilityProfileId: string;
  readonly outputCompatibilityProfileRevisionId: string;
  readonly outputCompatibilityProfileDigest: string;
  readonly postprocessorAdapterId: string;
  readonly postprocessorAdapterVersion: string;
  readonly postprocessorImplementationDigest: string;
}

/** Structural subset of the generated `MachineOutputSelection` contract. */
export interface MachineOutputSelectionLike {
  readonly machineProfileId: string;
  readonly machineProfileRevisionId: string;
  readonly outputProfileId: string;
  readonly outputProfileRevisionId: string;
  readonly outputProfileDigest: string | null;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly adapterImplementationDigest: string;
}

/**
 * Map a machine output selection to field-pack pins. A null digest maps to ''
 * ON PURPOSE: the builder then fails closed on the missing digest instead of
 * silently producing an unpinnable pack.
 */
export function cadlinkFieldPackIdentityPinsFromSelection(
  selection: MachineOutputSelectionLike,
): CadlinkFieldPackIdentityPins {
  return {
    machineProfileId: selection.machineProfileId,
    machineProfileRevisionId: selection.machineProfileRevisionId,
    outputCompatibilityProfileId: selection.outputProfileId,
    outputCompatibilityProfileRevisionId: selection.outputProfileRevisionId,
    outputCompatibilityProfileDigest: selection.outputProfileDigest ?? '',
    postprocessorAdapterId: selection.adapterId,
    postprocessorAdapterVersion: selection.adapterVersion,
    postprocessorImplementationDigest: selection.adapterImplementationDigest,
  };
}

const IDENTITY_PIN_FIELDS = [
  'machineProfileId',
  'machineProfileRevisionId',
  'outputCompatibilityProfileId',
  'outputCompatibilityProfileRevisionId',
  'outputCompatibilityProfileDigest',
  'postprocessorAdapterId',
  'postprocessorAdapterVersion',
  'postprocessorImplementationDigest',
] as const satisfies readonly (keyof CadlinkFieldPackIdentityPins)[];

// ---------------------------------------------------------------------------
// Builder input/output
// ---------------------------------------------------------------------------

/** An optional real label picture. Never a placeholder — bytes must exist. */
export interface CadlinkFieldPackPicture {
  /** Deterministic safe basename (printable ASCII, no path separators). */
  readonly name: string;
  readonly bytes: Uint8Array;
}

export interface CadlinkFieldPackBuildInput {
  readonly ptxFilename: string;
  readonly ptxBytes: Uint8Array;
  readonly cutPlan: CutPlan;
  readonly mapping: PtxCompilationMapping;
  readonly compileOptions: CompileCutPlanToPtxOptions;
  readonly identityPins: CadlinkFieldPackIdentityPins;
  readonly optionalPictures?: readonly CadlinkFieldPackPicture[];
}

export interface CadlinkFieldPackFile {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly byteLength: number;
}

export interface CadlinkFieldPack {
  readonly schemaVersion: 'granete-cadlink-field-pack/1';
  readonly fieldTestMode: 'CAD4';
  readonly candidateFilename: string;
  readonly receiverPolicyId: string;
  readonly ptxSha256: string;
  /** Deterministic order: PTX, manifest, expected identity, README, pictures (sorted), checksums. */
  readonly files: readonly CadlinkFieldPackFile[];
  readonly checksumsSha256: string;
}

export type CadlinkFieldPackErrorCode =
  | 'field_pack.options_invalid'
  | 'field_pack.identity_pin_missing'
  | 'field_pack.identity_pin_invalid'
  | 'field_pack.parse_failed'
  | 'field_pack.validation_failed'
  | 'field_pack.spec_preflight_failed'
  | 'field_pack.readback_failed'
  | 'field_pack.receiver_policy_missing'
  | 'field_pack.picture_invalid'
  | 'field_pack.picture_missing';

export class CadlinkFieldPackError extends Error {
  constructor(
    readonly code: CadlinkFieldPackErrorCode,
    message: string,
    readonly context: Record<string, unknown> = {},
  ) {
    super(`${message} [${code}]`);
    this.name = 'CadlinkFieldPackError';
  }
}

// ---------------------------------------------------------------------------
// Determinism helpers
// ---------------------------------------------------------------------------

function isPrintableAscii(value: string): boolean {
  return value.length > 0 && /^[ -~]+$/.test(value);
}

function isSafeBasename(name: string, what: string): void {
  if (
    !isPrintableAscii(name) ||
    name.includes('/') ||
    name.includes('\\') ||
    name === '.' ||
    name === '..' ||
    name.includes('..')
  ) {
    throw new CadlinkFieldPackError(
      'field_pack.options_invalid',
      `${what} must be a printable ASCII basename without path separators or '..' segments`,
      { value: name },
    );
  }
}

function asciiBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** canonicalJson (sorted keys, no whitespace) + one final LF. */
function canonicalJsonBytes(value: unknown): Uint8Array {
  return asciiBytes(`${canonicalJson(value)}\n`);
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export async function buildCadlinkFieldPack(
  input: CadlinkFieldPackBuildInput,
): Promise<CadlinkFieldPack> {
  // Gate 0 — options + identity pins, before any file exists.
  isSafeBasename(input.ptxFilename, 'ptxFilename');
  if (!/\.ptx$/.test(input.ptxFilename)) {
    throw new CadlinkFieldPackError('field_pack.options_invalid', 'ptxFilename must end in .ptx', {
      value: input.ptxFilename,
    });
  }

  const pins = input.identityPins as CadlinkFieldPackIdentityPins | undefined;
  if (pins === undefined || pins === null) {
    throw new CadlinkFieldPackError(
      'field_pack.identity_pin_missing',
      'identity pins are required: #792 never invents profile/adapter identities',
    );
  }
  for (const field of IDENTITY_PIN_FIELDS) {
    const value = pins[field];
    if (typeof value !== 'string' || value.length === 0) {
      throw new CadlinkFieldPackError(
        'field_pack.identity_pin_missing',
        `identity pin '${field}' is required non-empty`,
        { field },
      );
    }
    if (!isPrintableAscii(value)) {
      throw new CadlinkFieldPackError(
        'field_pack.identity_pin_invalid',
        `identity pin '${field}' must be printable ASCII`,
        { field },
      );
    }
  }

  // Gate 1 — independent parse of the exact bytes.
  let parsed: PtxDocument;
  try {
    parsed = parsePtxDocumentBytes(input.ptxBytes);
  } catch (error) {
    throw new CadlinkFieldPackError(
      'field_pack.parse_failed',
      'candidate PTX bytes do not parse independently',
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }

  // Gate 2 — format/relational validation. UNSUPPORTED_FUNCTION_CODE is
  // tolerated here exactly as verifyCutPlanPtxReadback documents it: the
  // semantic gate below still reports it (plus the receiver expectation),
  // so nothing unsupported can ever reach a pack — the failure simply
  // attributes to the semantic verifier instead of the format gate.
  const validationIssues = validatePtxDocument(parsed).filter(
    (issue) => issue.code !== 'UNSUPPORTED_FUNCTION_CODE',
  );
  if (validationIssues.length > 0) {
    throw new CadlinkFieldPackError('field_pack.validation_failed', 'candidate PTX is invalid', {
      issues: validationIssues.map((issue) => issue.code),
    });
  }

  // Gate 3 — strict documented-spec preflight (#788).
  const specIssues = ptxSpecPreflightDocument(parsed);
  if (specIssues.length > 0) {
    throw new CadlinkFieldPackError(
      'field_pack.spec_preflight_failed',
      'candidate PTX fails the strict Pattern Exchange spec preflight',
      { issues: specIssues.map((issue) => issue.code) },
    );
  }

  // Gate 4 — receiver policy present (#790). Checked BEFORE the readback:
  // the readback derives its receiver expectations from this policy, so a
  // missing policy would otherwise surface as a misleading semantic mismatch
  // instead of the actionable "policy missing" error.
  const receiverPolicyId = input.compileOptions.receiverPolicy?.id;
  if (typeof receiverPolicyId !== 'string' || receiverPolicyId.length === 0) {
    throw new CadlinkFieldPackError(
      'field_pack.receiver_policy_missing',
      'compileOptions.receiverPolicy with a non-empty id is required before any field pack',
    );
  }

  // Gate 5 — receiver/product semantic readback against the plan (#791).
  const readbackIssues = verifyCutPlanPtxReadback(
    parsed,
    input.cutPlan,
    input.mapping,
    input.compileOptions,
  );
  if (readbackIssues.length > 0) {
    throw new CadlinkFieldPackError(
      'field_pack.readback_failed',
      'candidate PTX fails the independent receiver/product semantic readback',
      { issues: readbackIssues.map((issue) => issue.code) },
    );
  }

  // Gate 6 — optional pictures: real bytes only, every udiPictureRef resolves.
  const pictures = [...(input.optionalPictures ?? [])].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const pictureNames = new Set<string>();
  for (const picture of pictures) {
    isSafeBasename(picture.name, 'picture name');
    if (pictureNames.has(picture.name)) {
      throw new CadlinkFieldPackError('field_pack.picture_invalid', 'duplicate picture name', {
        name: picture.name,
      });
    }
    if (picture.bytes.byteLength === 0) {
      throw new CadlinkFieldPackError('field_pack.picture_invalid', 'empty picture bytes', {
        name: picture.name,
      });
    }
    pictureNames.add(picture.name);
  }
  for (const label of input.compileOptions.partLabels ?? []) {
    if (label.udiPictureRef !== undefined && !pictureNames.has(label.udiPictureRef)) {
      throw new CadlinkFieldPackError(
        'field_pack.picture_missing',
        `PARTS_UDI INFO1 udiPictureRef '${label.udiPictureRef}' has no real picture file in the pack`,
        { udiPictureRef: label.udiPictureRef },
      );
    }
  }

  // Gate 7 passed — build the deterministic pack payload.
  const ptxSha256 = await sha256Hex(input.ptxBytes);
  const identity = {
    machineProfile: {
      id: pins.machineProfileId,
      revisionId: pins.machineProfileRevisionId,
    },
    outputCompatibilityProfile: {
      id: pins.outputCompatibilityProfileId,
      revisionId: pins.outputCompatibilityProfileRevisionId,
      digest: pins.outputCompatibilityProfileDigest,
    },
    postprocessorAdapter: {
      id: pins.postprocessorAdapterId,
      version: pins.postprocessorAdapterVersion,
      implementationDigest: pins.postprocessorImplementationDigest,
    },
  };
  const ptxSummary = { sha256: ptxSha256, byteLength: input.ptxBytes.byteLength };
  const recordSummary = summarizeRecords(parsed.records);
  const attachments: { name: string; sha256: string; byteLength: number }[] = [];
  for (const picture of pictures) {
    attachments.push({
      name: picture.name,
      sha256: await sha256Hex(picture.bytes),
      byteLength: picture.bytes.byteLength,
    });
  }

  const manifestValue = {
    schemaVersion: 'granete-cadlink-field-pack/1',
    fieldTestMode: 'CAD4',
    candidateFilename: input.ptxFilename,
    receiverPolicyId,
    identity,
    ptx: ptxSummary,
    candidate: { title: parsed.header.title },
    records: recordSummary,
    attachments,
    expectedCadlinkResult: { errorNumber: 0, fieldNumber: 0, lineNumber: 0 },
    supportStatus: {
      status: 'NOT_TESTED',
      compatibilityClaim: 'notClaimed',
      note: 'LAB/TEST field pack: no CADmatic/CADLink acceptance is claimed by this pack',
    },
    cadlinkIntent: {
      commandTemplate:
        'cadlink.exe "<candidate>.ptx" "<saw-output-dir>" /CAD4 /RESULT="<result-dir>" /UDI /INF',
      optionOrderIntent: 'UDI first, INF second (documented CADLink internal default)',
      cadlinkIniOverrideRisk:
        'if cadlink.ini exists beside cadlink.exe, ALL command-line options are ignored',
      deleteOptionUsed: false,
    },
  };

  const expectedIdentityValue = {
    schemaVersion: 'granete-cadlink-field-identity/1',
    primaryRecord: 'manifest.json',
    candidateFilename: input.ptxFilename,
    ptx: ptxSummary,
    receiverPolicyId,
    identity,
    expectedCadlinkMode: 'CAD4',
    expectedSuccessfulRlt: { errorNumber: 0, fieldNumber: 0, lineNumber: 0 },
  };

  const manifestBytes = canonicalJsonBytes(manifestValue);
  const expectedIdentityBytes = canonicalJsonBytes(expectedIdentityValue);
  const readmeBytes = asciiBytes(renderFieldTestReadme(input.ptxFilename, ptxSha256));

  const payloadFiles: CadlinkFieldPackFile[] = [];
  const pushFile = async (name: string, bytes: Uint8Array): Promise<void> => {
    payloadFiles.push({
      name,
      bytes,
      sha256: await sha256Hex(bytes),
      byteLength: bytes.byteLength,
    });
  };
  await pushFile(input.ptxFilename, input.ptxBytes);
  await pushFile('manifest.json', manifestBytes);
  await pushFile('expected_identity.json', expectedIdentityBytes);
  await pushFile('README_FIELD_TEST.txt', readmeBytes);
  for (const picture of pictures) {
    await pushFile(picture.name, picture.bytes);
  }

  // CHECKSUMS.sha256 — every payload file (never itself), sorted by filename,
  // sha256sum-style two-space separator, LF, final newline.
  const checksumLines = [...payloadFiles]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((file) => `${file.sha256}  ${file.name}`)
    .join('\n');
  const checksumsBytes = asciiBytes(`${checksumLines}\n`);
  const checksumsSha256 = await sha256Hex(checksumsBytes);
  payloadFiles.push({
    name: 'CHECKSUMS.sha256',
    bytes: checksumsBytes,
    sha256: checksumsSha256,
    byteLength: checksumsBytes.byteLength,
  });

  return {
    schemaVersion: 'granete-cadlink-field-pack/1',
    fieldTestMode: 'CAD4',
    candidateFilename: input.ptxFilename,
    receiverPolicyId,
    ptxSha256,
    files: payloadFiles,
    checksumsSha256,
  };
}

function summarizeRecords(records: readonly PtxRecord[]): Record<string, number> {
  const count = (type: string): number =>
    records.filter((record) => record.type === type).length;
  return {
    total: records.length,
    jobs: count('JOBS'),
    parts: count('PARTS_REQ'),
    partsInf: count('PARTS_INF'),
    partsUdi: count('PARTS_UDI'),
    boards: count('BOARDS'),
    materials: count('MATERIALS'),
    offcuts: count('OFFCUTS'),
    patterns: count('PATTERNS'),
    cuts: count('CUTS'),
    vectors: count('VECTORS'),
  };
}

// ---------------------------------------------------------------------------
// README_FIELD_TEST.txt — plain ASCII, CRLF, no private data
// ---------------------------------------------------------------------------

function renderFieldTestReadme(candidateFilename: string, ptxSha256: string): string {
  const lines: string[] = [];
  lines.push('=================================================================');
  lines.push(' GRANETE CADLINK FIELD TEST - IMPORT/CONVERSION ONLY (LAB/TEST)');
  lines.push('=================================================================');
  lines.push('');
  lines.push(`CANDIDATE  : ${candidateFilename}`);
  lines.push(`PTX SHA256 : ${ptxSha256}`);
  lines.push('MANIFEST   : manifest.json (primary record)');
  lines.push('');
  lines.push('-----------------------------------------------------------------');
  lines.push(' A. SAFETY - THIS IS NOT A CUTTING JOB');
  lines.push('-----------------------------------------------------------------');
  lines.push('THIS TEST IS IMPORT/CONVERSION ONLY.');
  lines.push('DO NOT START THE SAW.');
  lines.push('DO NOT CUT MATERIAL.');
  lines.push('DO NOT EXECUTE THE GENERATED .SAW FILE.');
  lines.push('');
  lines.push('ESTA PRUEBA ES SOLO DE IMPORTACION/CONVERSION.');
  lines.push('NO ARRANQUE LA SIERRA. NO CORTE MATERIAL.');
  lines.push('');
  lines.push('-----------------------------------------------------------------');
  lines.push(' B. VERIFY HASHES BEFORE THE TEST');
  lines.push('-----------------------------------------------------------------');
  lines.push(`1. Candidate file : ${candidateFilename}`);
  lines.push(`2. PTX SHA256     : ${ptxSha256}`);
  lines.push('3. Verify every file against CHECKSUMS.sha256 (it lists the SHA256');
  lines.push('   of the PTX, manifest.json, expected_identity.json, this README');
  lines.push('   and any label pictures).');
  lines.push('');
  lines.push('-----------------------------------------------------------------');
  lines.push(' C. CADLINK COMMAND INTENT');
  lines.push('-----------------------------------------------------------------');
  lines.push('Intended command shape (replace the <...> placeholders with the');
  lines.push('controlled test directories - no private paths are hardcoded here):');
  lines.push('');
  lines.push(
    `cadlink.exe "${candidateFilename}" "<saw-output-dir>" /CAD4 /RESULT="<result-dir>" /UDI /INF`,
  );
  lines.push('');
  lines.push('- /CAD4    : produce CADmatic 4 saw files. Explicit on purpose, even');
  lines.push('            though the help documents CAD4 as the default mode, so the');
  lines.push('            intent is registered.');
  lines.push('- /RESULT  : forces creation of .RLT result files. REQUIRED for this');
  lines.push('            test - the .RLT is the primary import evidence.');
  lines.push('- /UDI /INF: information-box order for the .SAW labels. UDI first,');
  lines.push('            INF second - this matches the documented internal default.');
  lines.push('- /DELETE is deliberately NOT used: the original PTX, the .RLT and');
  lines.push('            all evidence must be preserved.');
  lines.push('');
  lines.push('-----------------------------------------------------------------');
  lines.push(' D. CADLINK.INI WARNING - READ BEFORE RUNNING');
  lines.push('-----------------------------------------------------------------');
  lines.push('IF CADLINK.INI EXISTS IN THE DIRECTORY THAT CONTAINS CADLINK.EXE,');
  lines.push('CADLINK IGNORES ALL COMMAND-LINE OPTIONS AND USES THE INI INSTEAD.');
  lines.push('');
  lines.push('Writing /CAD4 /RESULT /UDI /INF on the command line does NOT mean');
  lines.push('they were effective. Do not assume it - see the field report below.');
  lines.push('');
  lines.push('-----------------------------------------------------------------');
  lines.push(' E. SAFE PROCEDURE');
  lines.push('-----------------------------------------------------------------');
  lines.push('- Prefer a controlled/test CADLink directory; do not touch the');
  lines.push('  productive configuration.');
  lines.push('- DO NOT replace or modify the productive cadlink.ini without the');
  lines.push("  operator's explicit authorization.");
  lines.push('- If cadlink.ini exists: record that it exists, capture only the');
  lines.push('  sanitized relevant options, never copy credentials or private');
  lines.push('  paths into any report, and run only under authorized configuration.');
  lines.push('');
  lines.push('FIELD REPORT - FILL IN AND RETURN TOGETHER WITH THE .RLT:');
  lines.push('cadlinkIniPresent: <true | false | unknown>');
  lines.push('effectiveOptionsVerified: <true | false>');
  lines.push('cadlink exit code (if visible): <code | unknown>');
  lines.push('generated .SAW filename/existence (optional): <filename | unknown>');
  lines.push('');
  lines.push('-----------------------------------------------------------------');
  lines.push(' F. RESULT WE NEED BACK');
  lines.push('-----------------------------------------------------------------');
  lines.push('RETURN THE .RLT FILE.');
  lines.push('THE .RLT IS THE PRIMARY EVIDENCE OF THE IMPORT RESULT.');
  lines.push('A verbal description of a popup is not required.');
  lines.push('');
  lines.push('For an ASCII PTX the .RLT contains exactly three lines:');
  lines.push('error number / field number / line number.');
  lines.push('A successful import reads 0 / 0 / 0.');
  lines.push('');
  lines.push('DO NOT EXECUTE THE .SAW FILE.');
  lines.push('');
  return lines.join('\r\n');
}

// ---------------------------------------------------------------------------
// Field-result readback API (#793/#348 consumption)
// ---------------------------------------------------------------------------

/**
 * Identity summary the field result is compared against — the exact content
 * expected_identity.json carries.
 */
export interface CadlinkFieldExpectedIdentity {
  readonly candidateFilename?: string;
  readonly ptxSha256: string;
  readonly ptxByteLength: number;
  readonly receiverPolicyId?: string;
  readonly expectedCadlinkMode?: 'CAD4';
}

export interface CadlinkFieldResultAnalysis {
  readonly outcome: CadlinkRltOutcome;
  readonly diagnosis: CadlinkRltDiagnosis;
  readonly ptxIdentity: {
    readonly expectedPtxSha256: string;
    readonly actualPtxSha256: string;
    /** SHA-256 and byte length both match the expected identity. */
    readonly matches: boolean;
  };
  /**
   * Explicit contract: this function NEVER changes supportStatus. A 0/0/0 in
   * a lab/unit test is not field evidence; only a real field attempt under
   * its own issue can promote NOT_TESTED.
   */
  readonly supportStatusPolicy: 'field-evidence-only';
}

/**
 * Analyze a returned field .RLT against the exact attempted PTX bytes and the
 * expected identity recorded in the pack. Malformed .RLT evidence throws
 * CadlinkRltParseError — an unreadable result file is not an import outcome.
 */
export async function analyzeCadlinkFieldResult(input: {
  readonly rltBytes: Uint8Array;
  readonly ptxBytes: Uint8Array;
  readonly expectedIdentity: CadlinkFieldExpectedIdentity;
}): Promise<CadlinkFieldResultAnalysis> {
  const result = parseCadlinkRlt(input.rltBytes);
  const diagnosis = await diagnoseCadlinkRlt(result, input.ptxBytes);
  const actualPtxSha256 = await sha256Hex(input.ptxBytes);
  return {
    outcome: diagnosis.outcome,
    diagnosis,
    ptxIdentity: {
      expectedPtxSha256: input.expectedIdentity.ptxSha256,
      actualPtxSha256,
      matches:
        actualPtxSha256 === input.expectedIdentity.ptxSha256 &&
        input.ptxBytes.byteLength === input.expectedIdentity.ptxByteLength,
    },
    supportStatusPolicy: 'field-evidence-only',
  };
}
