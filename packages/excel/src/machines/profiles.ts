/**
 * Versioned output-compatibility profiles and client machine profiles
 * (#351 foundation — DATA, not logic).
 *
 * Everything here is evidence-bound data following docs/machines/README.md:
 * a dimension value exists only with field/repo evidence; everything else is
 * listed in `pendingEvidence` as FIELD_FORMAT_EVIDENCE_REQUIRED and makes
 * adapters fail closed. Adding CADmatic/woodWOP/SAW evidence later means
 * publishing NEW profile revisions with the evidenced values — never editing
 * these in place and never hardcoding guesses in the serializers.
 *
 * Brand/client names are allowed HERE (export-layer data) but never in the
 * neutral domain module (packages/domain/src/machineOutput.ts).
 */

import type {
  MachineCapability,
  MachineProfileRef,
  OutputCompatibilityProfile,
} from '@granete/domain';
import { canonicalJson } from './digest';

/**
 * Canonical text over the profile data (every field except `digest` itself).
 * Tests hash this with sha256Hex and compare against the recorded constant, so
 * a profile edit without a new revision id cannot slip through.
 */
export function canonicalProfileData(profile: OutputCompatibilityProfile): string {
  const { digest: _digest, ...data } = profile;
  return canonicalJson(data);
}

// ---------------------------------------------------------------------------
// Output compatibility profiles — PTX family
// ---------------------------------------------------------------------------

/**
 * Syntax dimensions the PTX serializer requires before it can emit bytes.
 * Mirrored by the adapter's requiredDimensions (tests assert they stay equal).
 */
export const PTX_REQUIRED_DIMENSIONS = [
  'fileExtension',
  'encoding',
  'lineEnding',
  'decimalPlaces',
  'headerVersion',
  'unit',
] as const;

/**
 * `ptx-generic` r1 — the PTX dialect the repository serializer emits today
 * (defined in-repo, commit c43f1443; audited in docs/machines/ptx-validation.md).
 *
 * EVIDENCE STATUS: repo-implementation only. The Client A conversion failure
 * (2026-09, see docs/machines/client-a/ptx-conversion-failure.md) proves this
 * dialect is NOT accepted by the client's conversion workflow. supportStatus
 * stays NOT_TESTED as a validation state; the failure itself lives in the
 * client-a evidence pack.
 */
export const PTX_GENERIC_PROFILE: OutputCompatibilityProfile = {
  ref: { outputCompatibilityProfileId: 'ptx-generic', revisionId: 'r1' },
  formatFamily: 'ptx',
  dimensions: {
    fileExtension: 'ptx',
    encoding: 'ascii',
    lineEnding: 'crlf',
    decimalPlaces: 1,
    headerVersion: '1.14',
    unit: 'mm',
  },
  pendingEvidence: [],
  supportStatus: 'NOT_TESTED',
  digest: 'd05d279e6c1e40ccb1fc9995d5e5d6c1b54112af5b62e91ba2275912872d4595',
  evidenceUri: 'docs/machines/ptx-validation.md',
};

/**
 * Dimensions that remain unknown for every CADmatic-targeted PTX profile
 * until a real sample/spec from the client's software is captured.
 */
const PTX_CADMATIC_PENDING_EVIDENCE = [
  'fileExtension',
  'encoding',
  'lineEnding',
  'decimalPlaces',
  'headerVersion',
  'unit',
  'fieldAvailability',
  'recordOrdering',
  'characterRestrictions',
  'filenameConstraints',
] as const;

function cadmaticProfile(targetVersion: string, digest: string): OutputCompatibilityProfile {
  return {
    ref: { outputCompatibilityProfileId: `ptx-cadmatic-${targetVersion}`, revisionId: 'r1' },
    formatFamily: 'ptx',
    targetSoftware: {
      name: 'CADmatic',
      version: targetVersion,
      // The client's software family/version is not field-verified yet
      // (dossier machine-b §2): the version here is the TARGET identity of
      // the profile, not a claim about the client's install.
      provenance: 'FIELD_VERIFICATION_REQUIRED',
    },
    dimensions: {},
    pendingEvidence: PTX_CADMATIC_PENDING_EVIDENCE,
    supportStatus: 'NOT_TESTED',
    digest,
    evidenceUri: 'docs/machines/client-a/machine-b-hpp250.md',
  };
}

/** PTX dialect targeting CADmatic 3 receiving software. No evidenced dimensions yet. */
export const PTX_CADMATIC_3_PROFILE: OutputCompatibilityProfile = cadmaticProfile(
  '3',
  'c4ef85133a395b051da68a8411917217eba167a47950482270b202b160b9b7d1',
);
/** PTX dialect targeting CADmatic 4 receiving software. No evidenced dimensions yet. */
export const PTX_CADMATIC_4_PROFILE: OutputCompatibilityProfile = cadmaticProfile(
  '4',
  'd420e74de6a2db5c0f9a35c7bd78ef9ccd33346901a98d428b46871774ac6029',
);
/** PTX dialect targeting CADmatic 5 receiving software. No evidenced dimensions yet. */
export const PTX_CADMATIC_5_PROFILE: OutputCompatibilityProfile = cadmaticProfile(
  '5',
  '0679fada5b4d97ee5f2ec173d5c7ddebbf14cd8b226bf1ebe12ff95da9288bc1',
);

/**
 * Dimensions the documented-PTX compiler route consumes when a profile
 * revision is routed to compileCutPlanToPtxDocument (#650). Every value here
 * must be present in the profile's `dimensions` AND implemented by the
 * adapter, or serialization fails closed — a profile option that does not
 * reach the bytes is forbidden.
 */
export const PTX_COMPILER_REQUIRED_DIMENSIONS = [
  'fileExtension',
  'encoding',
  'lineEnding',
  'decimalPlaces',
  'headerVersion',
  'unit',
  'headerOrigin',
  'trimType',
  'includeVectors',
  'supportsPositiveTrim',
  'supportedFunctions',
] as const;

/**
 * Dimensions ONLY the r4 revision (#781) requires on top of the common
 * compiler set: the field-dialect candidate policies (OFC_QTY column,
 * OFFCUTS-before-CUTS ordering, Xn markers restricted to FUNCTION 92, and
 * the workshop part-code authority with its hard length limit). r2/r3 keep
 * their historical dimension sets and byte identities.
 */
export const PTX_COMPILER_R4_REQUIRED_DIMENSIONS = [
  'offcutsWithQuantity',
  'offcutsBeforePatterns',
  'offcutCutMarkers',
  'partCodeAuthority',
  'partCodeMaxLength',
] as const;

/**
 * Dimensions ONLY the r5 revision (#793) requires on top of the r4 set: the
 * strict Pattern Exchange spec preflight (#788), the part-local pre-rotation
 * cut PARTS_REQ frame + structural PARTS_UDI (#789), and the productive
 * receiver policy identity (#790 values, #793 candidate id). Every value is
 * consumed by the r5 compiler route — an option that does not reach the
 * bytes or a gate is forbidden.
 */
export const PTX_COMPILER_R5_REQUIRED_DIMENSIONS = [
  ...PTX_COMPILER_R4_REQUIRED_DIMENSIONS,
  'strictSpecPreflight',
  'partsReqDimensionPolicy',
  'partsUdi',
  'receiverPolicy',
] as const;

/**
 * `ptx-cadmatic-4` r2 — the CANDIDATE revision routed to the documented PTX
 * compiler (#650 PR 6: CutProgram → PtxDocument → CADLink/CAD4 route).
 *
 * EVIDENCE STATUS of every dimension: repo-implementation evidence — the
 * documented PTX subset frozen in docs/machines/ptx-cadmatic4/ (S03 locators)
 * and implemented by the #656 core + #657 compiler in this repository. None
 * of it is receiver evidence: supportStatus stays NOT_TESTED and the
 * receiving-side unknowns (which optional fields CADmatic 4 consumes, record
 * ordering expectations, character/filename constraints) remain in
 * pendingEvidence as FIELD_FORMAT evidence. Receiver-family identity:
 * CADmatic 4 via CADLink, with the install itself FIELD_VERIFICATION_REQUIRED.
 *
 * Effective options (govern the bytes through the adapter):
 * - headerVersion 1 (dossier examples' documented form; never from the
 *   controller name), units mm, origin 0, trimType 1 (candidate choice).
 * - ASCII + CRLF: the conservative first-candidate encoding already
 *   documented in the dossier — NOT a claim that CADmatic 4 requires them.
 * - decimalPlaces 2: covers domain mm measures up to two decimals with the
 *   exact-representability preflight blocking anything finer.
 * - includeVectors false: not needed for the documented CADLink/CAD4 route.
 * - supportsPositiveTrim false: the compiler rejects positive trims
 *   (ptx_compile.trim_unsupported) and the 90..99 codes stay disabled.
 * - supportedFunctions 0,1,2,3: exactly the #656/#657 supported subset.
 */
export const PTX_CADMATIC_4_CANDIDATE_PROFILE: OutputCompatibilityProfile = {
  ref: { outputCompatibilityProfileId: 'ptx-cadmatic-4', revisionId: 'r2' },
  formatFamily: 'ptx',
  targetSoftware: {
    name: 'CADmatic',
    version: '4',
    provenance: 'FIELD_VERIFICATION_REQUIRED',
  },
  dimensions: {
    fileExtension: 'ptx',
    encoding: 'ascii',
    lineEnding: 'crlf',
    decimalPlaces: 2,
    headerVersion: '1',
    unit: 'mm',
    headerOrigin: 0,
    trimType: 1,
    includeVectors: false,
    supportsPositiveTrim: false,
    supportedFunctions: '0,1,2,3',
  },
  pendingEvidence: [
    'fieldAvailability',
    'recordOrdering',
    'characterRestrictions',
    'filenameConstraints',
  ],
  supportStatus: 'NOT_TESTED',
  digest: '822221a6324199e63ec432966cfdd84b41dd8821fe09da1a3d1970e9fbae3c4a',
  evidenceUri: 'docs/machines/ptx-cadmatic4/README.md',
};

/**
 * `ptx-cadmatic-4` r3 — the positive-trim candidate revision (#661), routed
 * to the same documented PTX compiler with the evidenced subset of
 * docs/machines/ptx-cadmatic4/04_contrato_r3_refilados.md enabled.
 *
 * EVIDENCE STATUS: repo implementation of the r3 contract built from two
 * sane field samples (03_evidencia_campo.md) + the Pattern Exchange
 * inventory (01). NOT receiver evidence: supportStatus stays NOT_TESTED and
 * the same receiving-side unknowns as r2 remain in pendingEvidence.
 *
 * Effective options (govern the bytes through the adapter): identical to r2
 * except
 * - supportsPositiveTrim: true — enables the r3 compiler policy ONLY (the
 *   fixed frame of contract §3: TRIM_TYPE=1, no initial rotation, VECTORS
 *   off, one fixed margin per side, trims projected to MATERIALS.TRIM_*
 *   with TRIM_HEAD/FRCT/VRCT absent). NOT a universal trim claim: anything
 *   outside the frame fails closed (trim_frame_unsupported,
 *   trim_structure_invalid, trim_mapping_ambiguous).
 * - supportedFunctions '0,1,2,3,92' — adds the demonstrated phase-2
 *   offcut-release pass (FUNCTION 92 + Xn) with its scheduler; 90/91/93..99
 *   stay unsupported.
 *
 * r2 stays an immutable historical constant: selections pinned to r2 keep
 * their exact tuple and surface a stale-revision blocker (never an
 * automatic retarget to r3).
 */
export const PTX_CADMATIC_4_R3_PROFILE: OutputCompatibilityProfile = {
  ref: { outputCompatibilityProfileId: 'ptx-cadmatic-4', revisionId: 'r3' },
  formatFamily: 'ptx',
  targetSoftware: {
    name: 'CADmatic',
    version: '4',
    provenance: 'FIELD_VERIFICATION_REQUIRED',
  },
  dimensions: {
    fileExtension: 'ptx',
    encoding: 'ascii',
    lineEnding: 'crlf',
    decimalPlaces: 2,
    headerVersion: '1',
    unit: 'mm',
    headerOrigin: 0,
    trimType: 1,
    includeVectors: false,
    supportsPositiveTrim: true,
    supportedFunctions: '0,1,2,3,92',
  },
  pendingEvidence: [
    'fieldAvailability',
    'recordOrdering',
    'characterRestrictions',
    'filenameConstraints',
  ],
  supportStatus: 'NOT_TESTED',
  digest: '4998b6a53e131eda776934e18a24ee7f7e55ce526cbea3b8ba74d3340cbb9537',
  evidenceUri: 'docs/machines/ptx-cadmatic4/04_contrato_r3_refilados.md',
};

/**
 * `ptx-cadmatic-4` r4 — the field-dialect candidate revision (#781), built
 * on r3's positive-trim subset plus the differences observed against the
 * two REAL working client PTX files (sanitized field samples) after the
 * first CADLink rejection (OnlineConvertedFailedMsg, 2026-09-17):
 *
 * - offcutsWithQuantity: true — OFFCUTS.OFC_QTY=1 (both field samples carry
 *   the column; one record = one physical remnant in this subset);
 * - offcutsBeforePatterns: true — OFFCUTS is declared before the
 *   PATTERNS/CUTS blocks so every Xn reference resolves backwards in the
 *   byte stream (both field samples order it this way; NOT a claim that
 *   CADLink is single-pass — a candidate compatibility fix);
 * - offcutCutMarkers 'function92-only' — Xn appears exclusively on
 *   FUNCTION 92 rows in the field samples; Granete's r3 QTY_RPT=0/SEQUENCE=0
 *   pseudo-marker rows are dropped (non-92 remnants stay OFFCUTS-only);
 * - partCodeAuthority 'workshop-labelref' + partCodeMaxLength 50 —
 *   PARTS_REQ.CODE is the workshop manufacturing code (clean labelRef, one
 *   per physical piece: `MOD-XXX[-Ln]-Pnn[-Cn]`), replacing the internal
 *   placement refs (up to 119 chars, with real collisions across different
 *   dimensions) that leaked into the rejected artifact. Codes exceeding the
 *   limit or colliding fail closed (part_code_too_long / part_code_duplicate).
 *
 * EVIDENCE STATUS: repo implementation of the #781 field-dialect contract;
 * none of it is receiver evidence — supportStatus stays NOT_TESTED and the
 * first CADLink rejection is NOT attributed to any single difference.
 * r2/r3 stay immutable historical constants: selections pinned to them keep
 * their exact tuple and surface a stale-revision blocker (never an
 * automatic retarget to r4).
 */
export const PTX_CADMATIC_4_R4_PROFILE: OutputCompatibilityProfile = {
  ref: { outputCompatibilityProfileId: 'ptx-cadmatic-4', revisionId: 'r4' },
  formatFamily: 'ptx',
  targetSoftware: {
    name: 'CADmatic',
    version: '4',
    provenance: 'FIELD_VERIFICATION_REQUIRED',
  },
  dimensions: {
    fileExtension: 'ptx',
    encoding: 'ascii',
    lineEnding: 'crlf',
    decimalPlaces: 2,
    headerVersion: '1',
    unit: 'mm',
    headerOrigin: 0,
    trimType: 1,
    includeVectors: false,
    supportsPositiveTrim: true,
    supportedFunctions: '0,1,2,3,92',
    offcutsWithQuantity: true,
    offcutsBeforePatterns: true,
    offcutCutMarkers: 'function92-only',
    partCodeAuthority: 'workshop-labelref',
    partCodeMaxLength: 50,
  },
  pendingEvidence: [
    'fieldAvailability',
    'recordOrdering',
    'characterRestrictions',
    'filenameConstraints',
  ],
  supportStatus: 'NOT_TESTED',
  digest: '94401b8c17cd54b80e548bcc85cd184f80ba25ba97056ef6d46d81d1cb5114fc',
  evidenceUri: 'docs/machines/ptx-cadmatic4/05_contrato_r4_field_dialect.md',
};

/**
 * `ptx-cadmatic-4` r5 — the PRODUCTIVE final-gate candidate revision
 * (#793): r4's proven dimension base plus the r5 decisions already
 * implemented and lab-proven by #788–#792, now wired into the normal
 * serialization route with NEW industrial identities:
 *
 * - strictSpecPreflight 'pattern-exchange-v1' (#788): the compiled document
 *   AND the serialized bytes must pass the strict Pattern Exchange limit
 *   validator (serializePtxDocumentBytesSpecChecked boundary) — the r4
 *   43-char TITLE defect class can never reach bytes again;
 * - partsReqDimensionPolicy 'part-local-pre-rotation-cut' (#789): PARTS_REQ
 *   carries the part-local cut frame so optimizer rotation cannot mutate
 *   dimensional identity (required whenever the label projection is on);
 * - partsUdi 'structural' (#789): one structural PARTS_UDI row per piece,
 *   INFO cells empty except evidenced picture refs — the field samples'
 *   compact edge encodings are UNKNOWN and never generated;
 * - receiverPolicy 'HPP250-CAD4-R5-CANDIDATE' (#790 values / #793 identity):
 *   the productive receiver policy pin (BOOK=3, KERF 4.4/4.4, geometry TRIM
 *   authority, recut trio OMIT, RULE 6/1/1/1) — separate from the frozen
 *   HPP250_CAD4_R5_LAB policy of the #791 golden;
 * - productive label authority (#793 hard gate): the route requires the
 *   neutral frozen per-piece manufacturing projection on the resolved job
 *   (release truth → ManufacturingLabelProjection → partLabels) and BLOCKS
 *   without it — the lab fixture discipline of #789/#791 is not a
 *   productive label source.
 *
 * EVIDENCE STATUS: repo implementation of the #788–#793 contracts; none of
 * it is receiver evidence — supportStatus stays NOT_TESTED and
 * compatibilityClaim stays notClaimed until a real field result lands in
 * #348. r2/r3/r4 stay immutable historical constants: selections pinned to
 * them surface a stale-revision blocker (never an automatic retarget to r5).
 */
export const PTX_CADMATIC_4_R5_PROFILE: OutputCompatibilityProfile = {
  ref: { outputCompatibilityProfileId: 'ptx-cadmatic-4', revisionId: 'r5' },
  formatFamily: 'ptx',
  targetSoftware: {
    name: 'CADmatic',
    version: '4',
    provenance: 'FIELD_VERIFICATION_REQUIRED',
  },
  dimensions: {
    fileExtension: 'ptx',
    encoding: 'ascii',
    lineEnding: 'crlf',
    decimalPlaces: 2,
    headerVersion: '1',
    unit: 'mm',
    headerOrigin: 0,
    trimType: 1,
    includeVectors: false,
    supportsPositiveTrim: true,
    supportedFunctions: '0,1,2,3,92',
    offcutsWithQuantity: true,
    offcutsBeforePatterns: true,
    offcutCutMarkers: 'function92-only',
    partCodeAuthority: 'workshop-labelref',
    partCodeMaxLength: 50,
    strictSpecPreflight: 'pattern-exchange-v1',
    partsReqDimensionPolicy: 'part-local-pre-rotation-cut',
    partsUdi: 'structural',
    receiverPolicy: 'HPP250-CAD4-R5-CANDIDATE',
  },
  pendingEvidence: [
    'fieldAvailability',
    'recordOrdering',
    'characterRestrictions',
    'filenameConstraints',
  ],
  supportStatus: 'NOT_TESTED',
  digest: '3d3d215bf45859b6bf74ea931fc34e9d2b99e16ed346f67a33f68da482534c6b',
  evidenceUri: 'docs/machines/ptx-cadmatic4/13_final_r5_candidate_gate.md',
};

// ---------------------------------------------------------------------------
// Output compatibility profiles — SAW family
// ---------------------------------------------------------------------------

export const SAW_REQUIRED_DIMENSIONS = [
  'fileExtension',
  'encoding',
  'lineEnding',
  'recordSyntax',
  'coordinateConvention',
  'kerfSemantics',
  'sheetIdentity',
] as const;

/**
 * `saw-homag` r1 — HOMAG-family SAW cutting format. The client states their
 * cutting workflow accepts SAW (owner relay, 2026-09-06), but NO format
 * sample or specification exists in the repo: zero evidenced dimensions,
 * serialization fails closed until one real `.saw` sample (or spec) arrives.
 */
export const SAW_HOMAG_PROFILE: OutputCompatibilityProfile = {
  ref: { outputCompatibilityProfileId: 'saw-homag', revisionId: 'r1' },
  formatFamily: 'saw',
  targetSoftware: {
    name: 'HOMAG cutting workflow (SAW import)',
    provenance: 'OWNER_CONFIRMED',
  },
  dimensions: {},
  pendingEvidence: [
    ...SAW_REQUIRED_DIMENSIONS,
    'trimSemantics',
    'partIdentityFields',
    'optimizationOwnership',
  ],
  supportStatus: 'NOT_TESTED',
  digest: '2cccceea22fbba8ec7c7df948473b8cb713223f0de1c3d07216e5614c7c3e112',
  evidenceUri: 'docs/machines/client-a/machine-b-hpp250.md',
};

// ---------------------------------------------------------------------------
// Output compatibility profiles — MPR family (woodWOP)
// ---------------------------------------------------------------------------

export const MPR_REQUIRED_DIMENSIONS = [
  'fileExtension',
  'encoding',
  'versionHeader',
  'coordinateConvention',
  'faceConvention',
  'toolIdConvention',
  'macroSyntax',
  'operationMacros',
] as const;

/**
 * `mpr-woodwop` r1 — woodWOP MPR part program format. No reliable in-repo
 * format evidence exists: zero evidenced dimensions, serialization fails
 * closed until a real `.mpr` sample produced by the client's woodWOP version
 * (plus its exact version) is captured. MPRX stays out of scope; a future
 * adapter can be added without touching neutral machining logic.
 */
export const MPR_WOODWOP_PROFILE: OutputCompatibilityProfile = {
  ref: { outputCompatibilityProfileId: 'mpr-woodwop', revisionId: 'r1' },
  formatFamily: 'mpr',
  targetSoftware: {
    name: 'woodWOP',
    provenance: 'FIELD_VERIFICATION_REQUIRED',
  },
  dimensions: {},
  pendingEvidence: [
    ...MPR_REQUIRED_DIMENSIONS,
    'horizontalDrillingSyntax',
    'grooveSyntax',
    'routingSyntax',
  ],
  supportStatus: 'NOT_TESTED',
  digest: '28369cb293fcc77db20b11a4dfda795dc9f3346ea2d70e756286ba46de03fdf1',
  evidenceUri: 'docs/machines/client-a/machine-a-bhx050.md',
};

// ---------------------------------------------------------------------------
// Client A machine profiles (identity data only — zero inferred capabilities)
// ---------------------------------------------------------------------------

export interface ClientMachineProfileData {
  readonly ref: MachineProfileRef;
  /** Capability negotiation surface for the manufacturing preflight. */
  readonly supported: readonly MachineCapability[];
  readonly identity: {
    readonly opaqueClientKey: string;
    readonly machineKey: string;
    readonly manufacturerFamily: string;
    readonly model: string;
    readonly role: string;
    readonly provenance: 'OWNER_CONFIRMED';
  };
  readonly evidenceUri: string;
}

/**
 * `machine-b` HPP 250 — panel dividing saw. Identity is OWNER_CONFIRMED;
 * every capability/limit stays FIELD_VERIFICATION_REQUIRED, so the profile
 * declares ZERO supported capabilities (unknown blocks — it never passes).
 * Accepted input families come from the client via owner relay: PTX reached
 * the conversion workflow and failed there (2026-09); SAW is claimed accepted
 * but untested. See docs/machines/client-a/ptx-conversion-failure.md.
 */
export const CLIENT_A_HPP250_PROFILE: ClientMachineProfileData = {
  ref: { machineProfileId: 'client-a-machine-b-hpp250', machineProfileRevisionId: 'r1' },
  supported: [],
  identity: {
    opaqueClientKey: 'client-a',
    machineKey: 'machine-b',
    manufacturerFamily: 'HOLZMA (HOMAG)',
    model: 'HPP 250',
    role: 'panel-dividing-saw',
    provenance: 'OWNER_CONFIRMED',
  },
  evidenceUri: 'docs/machines/client-a/machine-b-hpp250.md',
};

/**
 * `machine-a` BHX 050 — CNC drilling/machining center. Identity is
 * OWNER_CONFIRMED; woodWOP version, tooling and head configuration remain
 * FIELD_VERIFICATION_REQUIRED, so zero capabilities are declared.
 */
export const CLIENT_A_BHX050_PROFILE: ClientMachineProfileData = {
  ref: { machineProfileId: 'client-a-machine-a-bhx050', machineProfileRevisionId: 'r1' },
  supported: [],
  identity: {
    opaqueClientKey: 'client-a',
    machineKey: 'machine-a',
    manufacturerFamily: 'WEEKE (HOMAG)',
    model: 'BHX 050',
    role: 'cnc-drilling-machining-center',
    provenance: 'OWNER_CONFIRMED',
  },
  evidenceUri: 'docs/machines/client-a/machine-a-bhx050.md',
};
