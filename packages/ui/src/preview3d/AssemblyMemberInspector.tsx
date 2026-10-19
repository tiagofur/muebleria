/**
 * Read-only inspector for the exact assembly member or fabricated component
 * selected in the 3D viewer (#670). Pure UI — no Three.js.
 *
 * Mirrors PartInspector's chrome. Identity is always shown as
 * (agregado, instancia, miembro) so the user can tell FI-A from FI-B when
 * several drawers share one recipe. The 3D render status and its diagnostic
 * are surfaced as distinct states instead of a silent fallback.
 */

import type { ReactNode } from 'react';
import type { Hardware } from '@granete/domain';
import type { ProjectedAssembly } from '@granete/domain';
import { X } from 'lucide-react';
import {
  type AssemblyMemberSelection,
  describeAssemblyRenderStatus,
  findSelectedAssemblyMember,
} from './assemblyMemberSelection';
import './partInspector.css';

export type AssemblyMemberInspectorProps = {
  readonly assemblies: readonly ProjectedAssembly[] | undefined;
  readonly selection: AssemblyMemberSelection | null;
  /** Hardware catalog for member names/codes; absent → ids only. */
  readonly hardwareCatalog?: readonly Hardware[];
  readonly onClear?: () => void;
  readonly testId?: string;
};

type Field = {
  readonly label: string;
  readonly value: ReactNode;
  readonly testId: string;
  readonly mono?: boolean;
};

function FieldGrid({
  fields,
  testIdPrefix,
}: {
  readonly fields: readonly Field[];
  readonly testIdPrefix: string;
}): ReactNode {
  return (
    <dl className="part-inspector__grid" data-testid={`${testIdPrefix}-grid`}>
      {fields.map((f) => (
        <div key={f.label}>
          <dt>{f.label}</dt>
          <dd data-testid={f.testId} className={f.mono ? 'part-inspector__mono' : undefined}>
            {f.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function formatMm(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return `${Number.isInteger(value) ? value : value.toFixed(1)} mm`;
}

function recipeLabel(assembly: ProjectedAssembly): string {
  if (assembly.isHistorical) {
    return assembly.snapshotId
      ? `Snapshot publicado ${assembly.snapshotId}`
      : 'Snapshot publicado';
  }
  return assembly.recipeRevision !== undefined
    ? `Receta en vivo · rev. ${assembly.recipeRevision}`
    : 'Receta en vivo';
}

export function AssemblyMemberInspector({
  assemblies,
  selection,
  hardwareCatalog,
  onClear,
  testId = 'assembly-member-inspector',
}: AssemblyMemberInspectorProps): ReactNode {
  if (!selection) return null;

  const resolved = findSelectedAssemblyMember(assemblies, selection);
  if (!resolved) {
    return (
      <div
        className="part-inspector part-inspector--empty"
        data-testid={testId}
        role="status"
      >
        <p className="part-inspector__hint" data-testid={`${testId}-stale`}>
          El miembro seleccionado ya no existe en esta vista. Volvé a elegirlo en el 3D.
        </p>
        {onClear ? (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={onClear}
            data-testid={`${testId}-clear`}
          >
            Quitar selección
          </button>
        ) : null}
      </div>
    );
  }

  const { assembly } = resolved;
  const identityFields: Field[] = [
    {
      label: 'Agregado',
      value: assembly.agregadoId,
      testId: `${testId}-agregado`,
      mono: true,
    },
    {
      label: 'Instancia',
      value: assembly.assemblyInstanceId,
      testId: `${testId}-instance`,
      mono: true,
    },
    { label: 'Origen', value: recipeLabel(assembly), testId: `${testId}-recipe` },
  ];

  if (resolved.kind === 'fabricated') {
    const c = resolved.component;
    const fabricatedFields: Field[] = [
      { label: 'Cantidad', value: String(c.quantity), testId: `${testId}-quantity` },
      { label: 'Ancho', value: formatMm(c.widthMm), testId: `${testId}-width` },
      { label: 'Largo', value: formatMm(c.lengthMm), testId: `${testId}-length` },
      { label: 'Espesor', value: formatMm(c.thicknessMm), testId: `${testId}-thickness` },
      {
        label: 'Material',
        value: c.materialId ?? 'Sin material vinculado',
        testId: `${testId}-material`,
        mono: Boolean(c.materialId),
      },
    ];
    return (
      <div className="part-inspector" data-testid={testId} data-kind="fabricated">
        <div className="part-inspector__header">
          <div className="part-inspector__title-block">
            <h4 className="part-inspector__title" data-testid={`${testId}-title`}>
              Tablero fabricado del conjunto
            </h4>
            <span className="part-inspector__code" data-testid={`${testId}-code`}>
              {c.componentId}
            </span>
          </div>
          {onClear ? (
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={onClear}
              aria-label="Quitar selección"
              data-testid={`${testId}-clear`}
            >
              <X size={14} strokeWidth={1.5} aria-hidden />
            </button>
          ) : null}
        </div>
        <div className="part-inspector__sections">
          <FieldGrid fields={identityFields} testIdPrefix={`${testId}-identity`} />
          <FieldGrid fields={fabricatedFields} testIdPrefix={`${testId}-dims`} />
        </div>
      </div>
    );
  }

  const m = resolved.member;
  const hardware = hardwareCatalog?.find((h) => h.id === m.hardwareId);
  const status = describeAssemblyRenderStatus(m.renderStatus);
  const memberFields: Field[] = [
    { label: 'Rol', value: m.role, testId: `${testId}-role` },
    {
      label: 'Herraje',
      value: hardware ? `${hardware.code} · ${hardware.name}` : m.hardwareId,
      testId: `${testId}-hardware`,
      mono: !hardware,
    },
    {
      label: 'Consumo',
      value: m.bomRole === 'included_in_kit' ? 'Incluido en el juego' : 'Línea separada',
      testId: `${testId}-bom-role`,
    },
  ];
  const assetFields: Field[] = [
    {
      label: 'Recurso 3D',
      value: m.assetRevisionId ?? 'Sin recurso fijado',
      testId: `${testId}-asset-revision`,
      mono: Boolean(m.assetRevisionId),
    },
    {
      label: 'GLB',
      value: m.glb ? m.glb.revisionId : 'Representación procedural',
      testId: `${testId}-glb-revision`,
      mono: Boolean(m.glb),
    },
  ];

  return (
    <div className="part-inspector" data-testid={testId} data-kind="rigid">
      <div className="part-inspector__header">
        <div className="part-inspector__title-block">
          <h4 className="part-inspector__title" data-testid={`${testId}-title`}>
            {hardware?.name ?? m.role}
          </h4>
          <span className="part-inspector__code" data-testid={`${testId}-code`}>
            {m.memberId}
          </span>
        </div>
        {onClear ? (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={onClear}
            aria-label="Quitar selección"
            data-testid={`${testId}-clear`}
          >
            <X size={14} strokeWidth={1.5} aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="part-inspector__sections">
        <FieldGrid fields={identityFields} testIdPrefix={`${testId}-identity`} />
        <FieldGrid fields={memberFields} testIdPrefix={`${testId}-member`} />
        <p
          className="assembly-member-inspector__status"
          data-tone={status.tone}
          data-testid={`${testId}-render-status`}
          role={status.tone === 'danger' ? 'alert' : 'status'}
        >
          Estado 3D: {status.label}
        </p>
        {m.statusDiagnostic ? (
          <p
            className="assembly-member-inspector__diagnostic"
            data-testid={`${testId}-diagnostic`}
          >
            {m.statusDiagnostic}
          </p>
        ) : null}
        <FieldGrid fields={assetFields} testIdPrefix={`${testId}-asset`} />
      </div>
    </div>
  );
}
