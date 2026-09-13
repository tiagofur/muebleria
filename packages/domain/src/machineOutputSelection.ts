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
  /** Exact profile data digest. Null exists only for pre-#692 historical rows. */
  readonly outputCompatibilityProfileDigest: string | null;
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
      const ptxMessages: Readonly<Record<string, string>> = {
        'ptx_compile.missing_cut_program': 'el plan no tiene un programa de corte ejecutable; regenerá el plan',
        'ptx_compile.phase_unsupported': 'la secuencia de corte usa una fase que CADmatic 4 r3 todavía no representa; reorganizá o regenerá el plan',
        'ptx_compile.trim_unsupported': 'el plan usa refilados no admitidos por este perfil',
        'ptx_compile.trim_frame_unsupported': 'la orientación o el marco de refilado no está soportado por CADmatic 4 r3',
        'ptx_compile.trim_structure_invalid': 'la secuencia de refilados no forma un marco CADmatic 4 válido; regenerá el plan o revisá los márgenes',
        'ptx_compile.trim_mapping_ambiguous': 'las hojas del mismo material requieren refilados distintos; separá el material o unificá los márgenes',
        'ptx_compile.trim_geometry_mismatch': 'la geometría ejecutada no coincide con los refilados configurados; regenerá el plan',
        'ptx_compile.offcut_release_92_unsupported': 'el plan requiere liberar un retazo fuera del subconjunto FUNCTION 92 soportado',
        'ptx_compile.offcut_release_duplicate': 'el plan intenta liberar dos veces el mismo retazo; regenerá el plan',
      };
      if (reason.code.startsWith('ptx_compile.')) {
        return ptxMessages[reason.code] ?? reason.detail;
      }
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
