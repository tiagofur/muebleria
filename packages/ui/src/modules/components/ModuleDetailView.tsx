/**
 * Module detail chrome — cost preview, components and hardware summary.
 */

import type { ReactNode } from 'react';
import type {
  Component,
  Hardware,
  Module,
  ModuleCategory,
  QuoteBreakdown,
} from '@muebles/domain';
import { categoryPath } from '@muebles/domain';
import { Box, ChevronLeft, Copy, Pencil, Trash2 } from 'lucide-react';
import { formatModuleMoney } from '../moduleHelpers';
import { CostPreviewPanel } from './CostPreviewPanel';

export type ModuleDetailViewProps = {
  readonly module: Module;
  readonly categories: readonly ModuleCategory[];
  readonly catalogComponents: readonly Component[];
  readonly hardwareById: ReadonlyMap<string, Hardware>;
  readonly costPreview: QuoteBreakdown | null;
  readonly previewBlocked: boolean;
  readonly missingGroups: readonly string[];
  readonly groupLabels?: Readonly<Record<string, string>>;
  readonly moduleEstimates: Readonly<Record<string, number | null>>;
  readonly onBack: () => void;
  readonly onEdit: (mod: Module) => void;
  readonly onDuplicate?: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onView3D: (mod: Module) => void;
};

export function ModuleDetailView({
  module: mod,
  categories,
  catalogComponents,
  hardwareById,
  costPreview,
  previewBlocked,
  missingGroups,
  groupLabels,
  moduleEstimates,
  onBack,
  onEdit,
  onDuplicate,
  onDelete,
  onView3D,
}: ModuleDetailViewProps): ReactNode {
  const estimate = moduleEstimates[mod.id];
  const chromeSale =
    costPreview?.salePrice ??
    (typeof estimate === 'number' ? estimate : null);
  const categoryLabel = mod.categoryId
    ? categoryPath(mod.categoryId, categories)
        .map((c) => c.name)
        .join(' › ') || 'Categoría'
    : 'Sin categoría';

  return (
    <div className="module-detail" data-testid="module-detail">
      <header className="workspace-chrome" data-testid="module-detail-chrome">
        <div className="workspace-chrome__lead">
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={onBack}
          >
            <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
            Lista
          </button>
          <div className="workspace-chrome__identity">
            <span className="workspace-chrome__code">{mod.code}</span>
            <div className="workspace-chrome__title-row">
              <h2 className="workspace-chrome__title">{mod.name}</h2>
            </div>
            <p
              className={
                mod.categoryId
                  ? 'workspace-chrome__subtitle'
                  : 'workspace-chrome__subtitle workspace-chrome__subtitle--muted'
              }
              data-testid="module-category-path"
            >
              {categoryLabel}
              {(mod.components?.length ?? 0) > 0 ? (
                <>
                  <span className="workspace-chrome__dot" aria-hidden>
                    ·
                  </span>
                  {mod.components!.length} componente
                  {mod.components!.length === 1 ? '' : 's'}
                </>
              ) : null}
              <span className="workspace-chrome__dot" aria-hidden>
                ·
              </span>
              {mod.hardwareLines.length} herraje
              {mod.hardwareLines.length === 1 ? '' : 's'}
              {mod.externalDims ? (
                <>
                  <span className="workspace-chrome__dot" aria-hidden>
                    ·
                  </span>
                  {mod.externalDims.width}×{mod.externalDims.height}×
                  {mod.externalDims.depth} mm
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div
          className="workspace-chrome__total"
          data-testid="module-detail-total"
        >
          <span className="workspace-chrome__total-label">Precio est.</span>
          <span
            className={
              chromeSale == null
                ? 'workspace-chrome__total-value workspace-chrome__total-value--muted'
                : 'workspace-chrome__total-value'
            }
          >
            {chromeSale == null ? '—' : formatModuleMoney(chromeSale)}
          </span>
        </div>
        <div className="workspace-chrome__actions">
          <button
            type="button"
            className="btn btn--outline"
            style={{ marginRight: '8px' }}
            onClick={() => onView3D(mod)}
            data-testid="view-3d-btn"
          >
            <Box size={16} strokeWidth={1.5} aria-hidden />
            Vista 3D
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onEdit(mod)}
          >
            <Pencil size={16} strokeWidth={1.5} aria-hidden />
            Editar
          </button>
          {onDuplicate ? (
            <button
              type="button"
              className="btn"
              onClick={() => onDuplicate(mod.id)}
            >
              <Copy size={16} strokeWidth={1.5} aria-hidden />
              Duplicar
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => onDelete(mod.id)}
          >
            <Trash2 size={16} strokeWidth={1.5} aria-hidden />
            Eliminar
          </button>
        </div>
      </header>

      {mod.notes ? (
        <p className="module-detail__notes">{mod.notes}</p>
      ) : null}

      <CostPreviewPanel
        costPreview={costPreview}
        previewBlocked={previewBlocked}
        missingGroups={missingGroups}
        groupLabels={groupLabels}
      />

      <section className="module-detail__section" aria-label="Componentes">
        <h3 className="module-detail__section-title">
          Componentes ({mod.components?.length ?? 0})
        </h3>
        {(mod.components?.length ?? 0) === 0 ? (
          <p className="module-detail__empty">
            Sin componentes. Las piezas se derivan de la estructura +
            componentes.
          </p>
        ) : (
          mod.components!.map((inst, idx) => {
            const catComp = catalogComponents.find(
              (c) => c.id === inst.componentId,
            );
            return (
              <div
                key={`${inst.componentId}-${idx}`}
                className="module-detail-row"
              >
                <span className="module-detail-row__code">
                  {catComp?.code ?? inst.componentId}
                </span>
                <div className="module-detail-row__main">
                  {catComp?.name ?? 'Componente'}
                  <span className="module-detail-row__sub">
                    {inst.placementOverride
                      ? `Ubicación ${inst.placementOverride}`
                      : (catComp?.placement ?? '—')}
                  </span>
                </div>
                <span className="module-detail-row__qty">
                  ×{inst.quantity}
                </span>
              </div>
            );
          })
        )}
      </section>

      <section className="module-detail__section" aria-label="Herrajes">
        <h3 className="module-detail__section-title">
          Herrajes ({mod.hardwareLines.length})
        </h3>
        {mod.hardwareLines.length === 0 ? (
          <p className="module-detail__empty">Sin líneas de herraje.</p>
        ) : (
          mod.hardwareLines.map((line) => {
            const fixed = line.hardwareId
              ? hardwareById.get(line.hardwareId)
              : undefined;
            const label = fixed
              ? `${fixed.code} — ${fixed.name}`
              : `Rol ${line.optionRole}`;
            return (
              <div key={line.id} className="module-detail-row">
                <span className="module-detail-row__code">
                  {fixed?.code ?? line.optionRole}
                </span>
                <div className="module-detail-row__main">
                  {line.descriptionOverride?.trim() || label}
                  <span className="module-detail-row__sub">
                    {fixed ? 'Herraje fijo' : `Por opción (${line.optionRole})`}
                  </span>
                </div>
                <span className="module-detail-row__qty">×{line.quantity}</span>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
