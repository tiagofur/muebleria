/**
 * Machine output selection (#591 / WEB-MFG-2): the exact machine/profile/
 * adapter tuple a factory selects for normal manufacturing generation.
 *
 * Fundamental production rule: one manufacturing operation -> ONE selected
 * tuple. Normal production generates only that intentional output; validation
 * packs intentionally evaluating several candidates are a separate flow that
 * never reads this selection.
 */

import type { AdapterBlockReason, MachineOutputSupportStatus } from './machineOutput';

export type ManufacturingOperation = 'cutting' | 'machining';

/** Exact persisted authority references — never "latest". */
export interface MachineOutputSelection {
  readonly operation: ManufacturingOperation;
  readonly machineProfileId: string;
  readonly machineProfileRevisionId: string;
  readonly outputCompatibilityProfileId: string;
  readonly outputCompatibilityProfileRevisionId: string;
  readonly postprocessorAdapterId: string;
  readonly postprocessorAdapterVersion: string;
  readonly postprocessorImplementationDigest: string;
}

export interface MachineOutputSelectionRecord {
  readonly selection: MachineOutputSelection;
  readonly version: number;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export type MachineOutputBlockerCode = 'SERIALIZER_NOT_IMPLEMENTED';

export interface MachineOutputBlocker {
  readonly code: MachineOutputBlockerCode;
  readonly detail: string;
}

/** Result of resolving the configured target for one operation. */
export type ResolvedManufacturingOutputTarget =
  | { readonly status: 'NO_OUTPUT_CONFIGURED'; readonly operation: ManufacturingOperation }
  | {
      readonly status: 'CONFIGURED';
      readonly operation: ManufacturingOperation;
      readonly selection: MachineOutputSelection;
      readonly machineLabel: string;
      readonly profileLabel: string;
      readonly adapterLabel: string;
      readonly supportStatus: MachineOutputSupportStatus;
      readonly readiness: { readonly ready: boolean; readonly reasons: readonly AdapterBlockReason[] };
    };

/**
 * Human-readable Spanish summary of generation blockers for UI surfaces.
 * Empty string when there is nothing blocking.
 */
export function machineOutputBlockerMessageEs(
  reasons: readonly AdapterBlockReason[],
): string {
  if (reasons.length === 0) return '';
  const detail = reasons
    .map((reason) => {
      switch (reason.code) {
        case 'SERIALIZER_NOT_IMPLEMENTED':
          return 'el serializador todavía no está implementado';
        case 'FIELD_FORMAT_EVIDENCE_REQUIRED':
          return `faltan datos confirmados del formato (${reason.dimension ?? 'dimensión desconocida'})`;
        case 'OPERATION_NOT_REPRESENTABLE':
          return 'hay operaciones que el perfil no puede representar';
        case 'FORMAT_FAMILY_MISMATCH':
          return 'la combinación máquina/perfil/adapter no es compatible';
        case 'PROFILE_DIGEST_MISMATCH':
          return 'la revisión seleccionada ya no coincide con el catálogo';
        default:
          return reason.detail;
      }
    })
    .join('; ');
  return `No se puede generar este archivo todavía: ${detail}.`;
}
