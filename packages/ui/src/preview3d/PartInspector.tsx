/**
 * Read-only inspector for a selected ResolvedBoardPart in the 3D viewer.
 * Pure UI — no Three.js. Used by Furniture3DViewer (and tests).
 *
 * F066: rediseñado en 5 secciones colapsables (Dimensiones / Material /
 * Herrajes / Acabado / Avanzado). El estado de colapso persiste en
 * localStorage via useInspectorSectionState. Las secciones Herrajes y
 * Acabado muestran placeholder hoy; se pueblan con F069 (variantes) y
 * F070 (placement editor).
 */

import type { ReactNode } from 'react';
import { useState } from 'react';
import type { Hardware, HardwarePlacement, ResolvedBoardPart } from '@muebles/domain';
import { PieceFaceDrillingEditor } from './PieceFaceDrillingEditor';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import {
  type InspectorSectionId,
  useInspectorSectionState,
} from './useInspectorSectionState';
import './partInspector.css';

export type PartInspectorProps = {
  readonly part: ResolvedBoardPart | null;
  readonly placements?: readonly HardwarePlacement[];
  readonly onUpdateHardwarePlacement?: (idx: number, patch: Partial<HardwarePlacement>) => void;
  /** F131: hardware catalog — enables the per-face 2D editor with real holes. */
  readonly hardwareCatalog?: readonly Hardware[];
  readonly onClear?: () => void;
  readonly isolateSelected?: boolean;
  readonly onIsolateChange?: (isolate: boolean) => void;
  readonly testId?: string;
};

function formatMm(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  return `${Math.round(n)} mm`;
}

function formatDeg(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  return `${n}°`;
}

/** Datos de una fila del grid dentro de una sección. */
type Field = {
  readonly label: string;
  readonly value: string;
  readonly testId?: string;
  readonly mono?: boolean;
};

/** Sub-componente: header colapsable + body. Patrón controlado del repo. */
function CollapsibleSection({
  id,
  title,
  testIdPrefix,
  isOpen,
  onToggle,
  summary,
  children,
}: {
  readonly id: InspectorSectionId;
  readonly title: string;
  readonly testIdPrefix: string;
  readonly isOpen: boolean;
  readonly onToggle: (id: InspectorSectionId) => void;
  readonly summary?: string;
  readonly children: ReactNode;
}): ReactNode {
  const panelId = `${testIdPrefix}-panel-${id}`;
  const buttonId = `${testIdPrefix}-trigger-${id}`;
  return (
    <section className="part-inspector__section">
      <h5 className="part-inspector__section-heading">
        <button
          type="button"
          id={buttonId}
          className="part-inspector__section-trigger"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => onToggle(id)}
          data-testid={`${testIdPrefix}-section-${id}`}
        >
          <span className="part-inspector__section-chevron" aria-hidden>
            {isOpen ? (
              <ChevronDown size={14} strokeWidth={1.5} />
            ) : (
              <ChevronRight size={14} strokeWidth={1.5} />
            )}
          </span>
          <span className="part-inspector__section-label">{title}</span>
          {summary ? (
            <span className="part-inspector__section-summary">{summary}</span>
          ) : null}
        </button>
      </h5>
      {isOpen ? (
        <div
          id={panelId}
          role="region"
          aria-labelledby={buttonId}
          className="part-inspector__section-body"
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** Grid reutilizable de pares dt/dd dentro de una sección. */
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
          <dd
            data-testid={f.testId}
            className={f.mono ? 'part-inspector__mono' : undefined}
          >
            {f.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function PartInspector({
  part,
  placements = [],
  onUpdateHardwarePlacement,
  onClear,
  isolateSelected = false,
  onIsolateChange,
  testId = 'part-inspector',
  hardwareCatalog,
}: PartInspectorProps): ReactNode {
  const sections = useInspectorSectionState();

  if (!part) {
    return (
      <div className="part-inspector part-inspector--empty" data-testid={testId}>
        <p className="part-inspector__hint">
          Seleccioná una pieza en el 3D o en la lista para ver sus datos.
        </p>
      </div>
    );
  }

  const dimensionFields: Field[] = [
    {
      label: 'Largo × Ancho × Espesor',
      value: `${formatMm(part.lengthMm)} × ${formatMm(part.widthMm)} × ${formatMm(
        part.thicknessMm,
      )}`,
      testId: `${testId}-dims`,
    },
    { label: 'Cantidad', value: String(part.quantity), testId: `${testId}-qty` },
  ];

  const materialFields: Field[] = [
    {
      label: 'Material',
      value: part.materialId || '—',
      testId: `${testId}-material`,
      mono: true,
    },
  ];

  const advancedFields: Field[] = [
    { label: 'Rol', value: part.optionRole || '—', testId: `${testId}-role` },
    {
      label: 'Posición (X / Y / Z)',
      value: `${formatMm(part.x)} / ${formatMm(part.y)} / ${formatMm(part.z)}`,
      testId: `${testId}-pose`,
    },
    {
      label: 'Rotación (X / Y / Z)',
      value: `${formatDeg(part.rotateX)} / ${formatDeg(part.rotateY)} / ${formatDeg(
        part.rotateZ,
      )}`,
      testId: `${testId}-rotation`,
    },
  ];

  return (
    <div className="part-inspector" data-testid={testId}>
      <div className="part-inspector__header">
        <div className="part-inspector__title-block">
          <h4 className="part-inspector__title" data-testid={`${testId}-title`}>
            {part.description || part.code || part.id}
          </h4>
          {part.code ? (
            <span className="part-inspector__code" data-testid={`${testId}-code`}>
              {part.code}
            </span>
          ) : null}
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
        <CollapsibleSection
          id="dimensions"
          title="Dimensiones"
          testIdPrefix={testId}
          isOpen={sections.isOpen('dimensions')}
          onToggle={sections.toggle}
        >
          <FieldGrid fields={dimensionFields} testIdPrefix={testId} />
        </CollapsibleSection>

        <CollapsibleSection
          id="material"
          title="Material"
          testIdPrefix={testId}
          isOpen={sections.isOpen('material')}
          onToggle={sections.toggle}
        >
          <FieldGrid fields={materialFields} testIdPrefix={testId} />
          <p
            className="part-inspector__placeholder"
            data-testid={`${testId}-finish-placeholder`}
          >
            Acabado del material
          </p>
        </CollapsibleSection>

        <CollapsibleSection
          id="hardware"
          title={`Herrajes (${placements.length})`}
          testIdPrefix={testId}
          isOpen={sections.isOpen('hardware')}
          onToggle={sections.toggle}
        >
          {placements.length === 0 ? (
            <p
              className="part-inspector__placeholder"
              data-testid={`${testId}-hardware-placeholder`}
            >
              Sin herrajes definidos para esta pieza
            </p>
          ) : (
            <div className="part-inspector__hardware-list" data-testid={`${testId}-hardware-list`}>
              {/* F131: editor visual 2D por cara (agujeros reales + snap 32) */}
              {part ? (
                <PieceFaceDrillingEditor
                  piece={part}
                  placements={placements}
                  hardwareCatalog={hardwareCatalog}
                  onUpdatePlacement={onUpdateHardwarePlacement}
                  testId={`${testId}-face-editor`}
                />
              ) : null}
              {placements.map((hw, idx) => (
                <div key={idx} className="part-inspector__hardware-item" data-testid={`${testId}-hardware-item-${idx}`}>
                  <div className="part-inspector__hardware-name">
                    <span>Herraje {idx + 1}: <strong>{hw.hardwareId}</strong></span>
                    <span className="part-inspector__mono"> ({hw.anchorFace})</span>
                  </div>
                  <div className="part-inspector__hardware-inputs">
                    <label>
                      X (mm)
                      <input
                        type="number"
                        value={hw.relativePosition.xMm}
                        onChange={(e) =>
                          onUpdateHardwarePlacement?.(idx, {
                            relativePosition: {
                              ...hw.relativePosition,
                              xMm: Number(e.target.value),
                            },
                          })
                        }
                        data-testid={`${testId}-hw-${idx}-x`}
                      />
                    </label>
                    <label>
                      Y (mm)
                      <input
                        type="number"
                        value={hw.relativePosition.yMm}
                        onChange={(e) =>
                          onUpdateHardwarePlacement?.(idx, {
                            relativePosition: {
                              ...hw.relativePosition,
                              yMm: Number(e.target.value),
                            },
                          })
                        }
                        data-testid={`${testId}-hw-${idx}-y`}
                      />
                    </label>
                    <label>
                      Rot Z (°)
                      <input
                        type="number"
                        value={hw.rotationDeg?.z ?? 0}
                        onChange={(e) =>
                          onUpdateHardwarePlacement?.(idx, {
                            rotationDeg: {
                              x: hw.rotationDeg?.x ?? 0,
                              y: hw.rotationDeg?.y ?? 0,
                              z: Number(e.target.value),
                            },
                          })
                        }
                        data-testid={`${testId}-hw-${idx}-rz`}
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          id="finish"
          title="Acabado"
          testIdPrefix={testId}
          isOpen={sections.isOpen('finish')}
          onToggle={sections.toggle}
        >
          <p
            className="part-inspector__placeholder"
            data-testid={`${testId}-finish-section-placeholder`}
          >
            Acabado del material
          </p>
        </CollapsibleSection>

        <CollapsibleSection
          id="advanced"
          title="Avanzado"
          testIdPrefix={testId}
          isOpen={sections.isOpen('advanced')}
          onToggle={sections.toggle}
          summary="Datos técnicos"
        >
          <FieldGrid fields={advancedFields} testIdPrefix={testId} />
          {onIsolateChange ? (
            <label
              className="part-inspector__isolate"
              data-testid={`${testId}-isolate`}
            >
              <input
                type="checkbox"
                checked={isolateSelected}
                onChange={(e) => onIsolateChange(e.target.checked)}
                data-testid={`${testId}-isolate-checkbox`}
              />
              Aislar pieza (atenuar el resto)
            </label>
          ) : null}
        </CollapsibleSection>
      </div>
    </div>
  );
}

