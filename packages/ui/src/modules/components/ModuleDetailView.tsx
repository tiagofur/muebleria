/**
 * Module detail — engineering read-only workspace (wave 3).
 * Chrome: precio est. + Vista 3D + Editar + overflow (Duplicar / Eliminar).
 * Primary: cost preview + components. Secondary: hardware, structure ref,
 * commercial presets.
 */

import type { ReactNode } from 'react';
import type {
  Component,
  Hardware,
  Module,
  ModuleCategory,
  QuoteBreakdown,
  Structure,
} from '@muebles/domain';
import { categoryPath } from '@muebles/domain';
import {
  Box,
  ChevronLeft,
  Copy,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import { DropdownMenu } from '../../common/DropdownMenu';
import { EngineeringDetailLayout } from '../../common/EngineeringDetailLayout';
import { formatModuleMoney } from '../moduleHelpers';
import { CostPreviewPanel } from './CostPreviewPanel';

export type ModuleDetailViewProps = {
  readonly module: Module;
  readonly categories: readonly ModuleCategory[];
  readonly catalogComponents: readonly Component[];
  readonly hardwareById: ReadonlyMap<string, Hardware>;
  /** Catalog structures — resolve structureId for summary. */
  readonly structures?: readonly Structure[];
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

function dimsLabel(mod: Module): string | null {
  const d = mod.externalDims;
  if (!d) return null;
  return `${d.width} × ${d.height} × ${d.depth} mm`;
}

export function ModuleDetailView({
  module: mod,
  categories,
  catalogComponents,
  hardwareById,
  structures = [],
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
  const componentCount = mod.components?.length ?? 0;
  const hardwareCount = mod.hardwareLines.length;
  const dims = dimsLabel(mod);
  const structure = mod.structureId
    ? (structures.find((s) => s.id === mod.structureId) ?? null)
    : null;
  const presetCount = mod.presets?.length ?? 0;

  const moreItems = [
    ...(onDuplicate
      ? [
          {
            id: 'duplicate',
            label: 'Duplicar',
            icon: <Copy size={16} strokeWidth={1.5} aria-hidden />,
            onSelect: () => onDuplicate(mod.id),
          },
        ]
      : []),
    {
      id: 'delete',
      label: 'Eliminar',
      icon: <Trash2 size={16} strokeWidth={1.5} aria-hidden />,
      onSelect: () => onDelete(mod.id),
    },
  ];

  const chrome = (
    <header className="workspace-chrome" data-testid="module-detail-chrome">
      <div className="workspace-chrome__lead">
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={onBack}
          aria-label="Volver a la lista"
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
            {componentCount > 0 ? (
              <>
                <span className="workspace-chrome__dot" aria-hidden>
                  ·
                </span>
                {componentCount} componente
                {componentCount === 1 ? '' : 's'}
              </>
            ) : null}
            <span className="workspace-chrome__dot" aria-hidden>
              ·
            </span>
            {hardwareCount} herraje
            {hardwareCount === 1 ? '' : 's'}
            {dims ? (
              <>
                <span className="workspace-chrome__dot" aria-hidden>
                  ·
                </span>
                {dims}
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
          className="btn"
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
          data-testid="module-detail-edit"
        >
          <Pencil size={16} strokeWidth={1.5} aria-hidden />
          Editar
        </button>
        {moreItems.length > 0 ? (
          <DropdownMenu
            ariaLabel="Más acciones del mueble"
            triggerLabel="Más"
            triggerIcon={<MoreHorizontal size={16} strokeWidth={1.5} />}
            triggerClassName="btn"
            sections={[{ id: 'main', items: moreItems }]}
          />
        ) : null}
      </div>
    </header>
  );

  const notes = mod.notes ? (
    <p className="eng-detail__notes" data-testid="module-detail-notes">
      {mod.notes}
    </p>
  ) : null;

  const primary = (
    <>
      <section
        className="surface-card surface-card--lg"
        aria-label="Preview de costo"
        data-testid="module-detail-cost"
      >
        <h3 className="eng-detail__panel-title">Costo y venta</h3>
        <CostPreviewPanel
          costPreview={costPreview}
          previewBlocked={previewBlocked}
          missingGroups={missingGroups}
          groupLabels={groupLabels}
        />
      </section>

      <section
        className="surface-card surface-card--lg"
        aria-label="Componentes"
        data-testid="module-detail-components"
      >
        <h3 className="eng-detail__panel-title">
          Componentes ({componentCount})
        </h3>
        {componentCount === 0 ? (
          <p className="eng-detail__empty">
            Sin componentes directos. Las piezas se derivan de la estructura +
            componentes del mueble.
          </p>
        ) : (
          <ul className="eng-detail__instance-list">
            {mod.components!.map((inst, idx) => {
              const catComp = catalogComponents.find(
                (c) => c.id === inst.componentId,
              );
              return (
                <li
                  key={`${inst.componentId}-${idx}`}
                  className="eng-detail__instance-row"
                >
                  <span className="eng-detail__instance-code">
                    {catComp?.code ?? inst.componentId}
                  </span>
                  <div className="eng-detail__instance-main">
                    {catComp?.name ?? 'Componente'}
                    <span className="eng-detail__instance-sub">
                      {inst.placementOverride
                        ? `Ubicación ${inst.placementOverride}`
                        : (catComp?.placement ?? '—')}
                    </span>
                  </div>
                  <span className="eng-detail__instance-qty">
                    ×{inst.quantity}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );

  const secondary = (
    <>
      <section
        className="surface-card"
        aria-label="Estructura y medidas"
        data-testid="module-detail-structure"
      >
        <h3 className="eng-detail__panel-title">Cuerpo y medidas</h3>
        <dl className="eng-detail__defs">
          <div>
            <dt>Estructura</dt>
            <dd>
              {structure ? (
                <>
                  <span className="eng-detail__mono">{structure.code}</span>
                  {' — '}
                  {structure.name}
                </>
              ) : mod.structureId ? (
                <span className="eng-detail__mono">{mod.structureId}</span>
              ) : (
                <span className="eng-detail__empty">Sin estructura</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Exterior</dt>
            <dd>{dims ?? '—'}</dd>
          </div>
          {mod.furnitureType ? (
            <div>
              <dt>Tipo</dt>
              <dd>{mod.furnitureType}</dd>
            </div>
          ) : null}
          {mod.baseMode && mod.baseMode !== 'none' ? (
            <div data-testid="module-detail-base-mode">
              <dt>Base</dt>
              <dd>
                {mod.baseMode === 'plinth_board'
                  ? 'Zoclo melamina'
                  : mod.baseMode === 'plinth_strip'
                    ? 'Zoclo perfil (ml)'
                    : mod.baseMode === 'legs'
                      ? 'Patas'
                      : mod.baseMode}
                {mod.baseClearanceMm !== undefined
                  ? ` · B ${mod.baseClearanceMm} mm`
                  : ''}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section
        className="surface-card"
        aria-label="Herrajes"
        data-testid="module-detail-hardware"
      >
        <h3 className="eng-detail__panel-title">
          Herrajes ({hardwareCount})
        </h3>
        {hardwareCount === 0 ? (
          <p className="eng-detail__empty">Sin líneas de herraje.</p>
        ) : (
          <ul className="eng-detail__instance-list">
            {mod.hardwareLines.map((line) => {
              const fixed = line.hardwareId
                ? hardwareById.get(line.hardwareId)
                : undefined;
              const label = fixed
                ? `${fixed.code} — ${fixed.name}`
                : `Rol ${line.optionRole}`;
              return (
                <li key={line.id} className="eng-detail__instance-row">
                  <span className="eng-detail__instance-code">
                    {fixed?.code ?? line.optionRole}
                  </span>
                  <div className="eng-detail__instance-main">
                    {line.descriptionOverride?.trim() || label}
                    <span className="eng-detail__instance-sub">
                      {fixed
                        ? 'Herraje fijo'
                        : `Por opción (${line.optionRole})`}
                    </span>
                  </div>
                  <span className="eng-detail__instance-qty">
                    ×{line.quantity}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section
        className="surface-card"
        aria-label="Presets comerciales"
        data-testid="module-detail-presets"
      >
        <h3 className="eng-detail__panel-title">
          Presets comerciales
          {presetCount > 0 ? ` (${presetCount})` : null}
        </h3>
        <p className="eng-detail__panel-hint">
          Tamaños de venta ofrecidos en cotización (no son presets de
          ingeniería de la estructura).
        </p>
        {presetCount === 0 ? (
          <p className="eng-detail__empty">Sin presets comerciales.</p>
        ) : (
          <ul className="eng-detail__kv-list">
            {mod.presets!.map((pr) => (
              <li key={pr.id} className="eng-detail__kv-item">
                <span className="eng-detail__kv-name">
                  {pr.name?.trim() || 'Sin nombre'}
                </span>
                <span className="eng-detail__kv-value">
                  {pr.width} × {pr.height} × {pr.depth} mm
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );

  return (
    <EngineeringDetailLayout
      dataTestId="module-detail"
      className="module-detail"
      chrome={chrome}
      notes={notes}
      primary={primary}
      secondary={secondary}
    />
  );
}
