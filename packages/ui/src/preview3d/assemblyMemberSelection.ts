import type {
  AssemblyRenderStatus,
  ProjectedAssembly,
  ProjectedFabricatedComponent,
  ProjectedRigidMember,
} from '@granete/domain';

/**
 * Selection of one exact node inside one exact projected assembly (#670).
 *
 * `assemblyInstanceId` is mandatory: three drawers built from the same recipe
 * share every `memberId`, so a member id alone cannot name a node. Resolution
 * always pins the instance first and never falls back to another assembly that
 * happens to carry the same member id (FI-A must not resolve into FI-B).
 */
export type AssemblyMemberSelection =
  | {
      readonly kind: 'rigid';
      readonly assemblyInstanceId: string;
      readonly memberId: string;
    }
  | {
      readonly kind: 'fabricated';
      readonly assemblyInstanceId: string;
      readonly componentId: string;
    };

export type ResolvedAssemblyMemberSelection =
  | {
      readonly kind: 'rigid';
      readonly assembly: ProjectedAssembly;
      readonly member: ProjectedRigidMember;
    }
  | {
      readonly kind: 'fabricated';
      readonly assembly: ProjectedAssembly;
      readonly component: ProjectedFabricatedComponent;
    };

export function assemblyMemberSelectionEquals(
  a: AssemblyMemberSelection | null | undefined,
  b: AssemblyMemberSelection | null | undefined,
): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.assemblyInstanceId !== b.assemblyInstanceId) return false;
  if (a.kind === 'rigid' && b.kind === 'rigid') return a.memberId === b.memberId;
  if (a.kind === 'fabricated' && b.kind === 'fabricated') {
    return a.componentId === b.componentId;
  }
  return false;
}

/**
 * Resolves a selection against the projected assemblies currently in the scene.
 * Returns null when the exact instance or node no longer exists (stale
 * selection after a re-resolve); callers clear the selection, never guess.
 */
export function findSelectedAssemblyMember(
  assemblies: readonly ProjectedAssembly[] | undefined,
  selection: AssemblyMemberSelection | null | undefined,
): ResolvedAssemblyMemberSelection | null {
  if (!selection || !assemblies || assemblies.length === 0) return null;
  const assembly = assemblies.find(
    (a) => a.assemblyInstanceId === selection.assemblyInstanceId,
  );
  if (!assembly) return null;

  if (selection.kind === 'rigid') {
    const member = assembly.rigidMembers.find((m) => m.memberId === selection.memberId);
    return member ? { kind: 'rigid', assembly, member } : null;
  }
  const component = assembly.fabricatedComponents.find(
    (c) => c.componentId === selection.componentId,
  );
  return component ? { kind: 'fabricated', assembly, component } : null;
}

export type AssemblyRenderStatusTone = 'ok' | 'warning' | 'danger';

export type AssemblyRenderStatusLabel = {
  readonly label: string;
  readonly tone: AssemblyRenderStatusTone;
};

const RENDER_STATUS_LABELS: Readonly<Record<AssemblyRenderStatus, AssemblyRenderStatusLabel>> = {
  exact: { label: 'Exacta (recurso 3D fijado)', tone: 'ok' },
  proxy: { label: 'Aproximada (sin recurso 3D fijado)', tone: 'warning' },
  historical_asset_missing: {
    label: 'Recurso histórico no disponible',
    tone: 'danger',
  },
  asset_load_failed: { label: 'Error al cargar el recurso 3D', tone: 'danger' },
  snapshot_invalid: { label: 'Snapshot de conjunto inválido', tone: 'danger' },
};

/** Spanish label + tone for a member render status. Unknown values fail loud. */
export function describeAssemblyRenderStatus(
  status: AssemblyRenderStatus,
): AssemblyRenderStatusLabel {
  const entry = RENDER_STATUS_LABELS[status];
  if (!entry) {
    throw new Error(`describeAssemblyRenderStatus: unknown render status '${String(status)}'`);
  }
  return entry;
}
