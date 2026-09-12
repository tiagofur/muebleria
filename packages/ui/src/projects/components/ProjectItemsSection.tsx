/**
 * Project items list section — extracted from ProjectDetailViewInner (#refactor).
 *
 * Renders: section header with "Vista 3D cotización" + "Agregar mueble" buttons,
 * error message, empty state, and the list of item cards with quantity/measure
 * pickers, option choice dropdowns, 3D viewer triggers, and inline remove confirm.
 * Items support drag & drop reordering (F052).
 */

import { memo, useCallback, useRef, useState, type ReactNode } from 'react';
import { Box, GripVertical, Plus, X } from 'lucide-react';
import { useProjectDetail } from './projectDetailContext';
import { ProjectItemStructureRevisionIndicator } from './ProjectItemStructureRevisionIndicator';
import {
  groupsForModuleItem,
  optionLabelForId,
  optionsForGroup,
  furnitureTypeLabel,
  formatProjectMoney,
} from '../projectHelpers';
import {
  buildRevisionLines,
  formatLifecycleStatus,
  formatRevisionUnitDimensions,
} from '../quoteRevisionPresentation';

/** Drag-over visual feedback state. */
type DropPosition = 'above' | 'below' | null;

export const ProjectItemsSection = memo(function ProjectItemsSection(): ReactNode {
  const {
    project,
    modules,
    optionGroups,
    catalogs,
    catalogComponents,
    catalogStructures,
    itemHandlers,
    removeConfirm,
    viewer3D,
    itemError,
    addItemModalOpen,
    onOpenAddItemModal,
    canEditContent,
    postAddPlaceCue,
    onDismissPostAddPlaceCue,
    onOpenSpatialStudioUnplaced,
    onOpenReconciliation,
    quoteAuthority,
    showCosts,
  } = useProjectDetail();

  // ─── Drag & drop state ────────────────────────────────────────────────
  const dragIndexRef = useRef<number | null>(null);
  const dropPosRef = useRef<DropPosition>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [dropPos, setDropPos] = useState<DropPosition>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent, index: number) => {
      if (!itemHandlers.onReorderItems) return;
      dragIndexRef.current = index;
      e.dataTransfer.effectAllowed = 'move';
      // Set a transparent pixel as drag image so the browser uses a ghost of the element
      const img = new Image();
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      e.dataTransfer.setDragImage(img, 0, 0);
      // Add class to the dragged element after a tick (so browser captures the ghost first)
      requestAnimationFrame(() => {
        const el = e.currentTarget as HTMLElement;
        el.classList.add('project-item-card--dragging');
      });
    },
    [itemHandlers.onReorderItems],
  );

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.classList.remove('project-item-card--dragging');
    dragIndexRef.current = null;
    setOverIndex(null);
    setDropPos(null);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      if (dragIndexRef.current === null) return;
      if (dragIndexRef.current === index) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      // Determine if cursor is in top or bottom half of the target
      const rect = e.currentTarget.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const pos: DropPosition = e.clientY < midY ? 'above' : 'below';
      setOverIndex(index);
      setDropPos(pos);
      dropPosRef.current = pos;
    },
    [],
  );

  const handleDragLeave = useCallback(() => {
    setOverIndex(null);
    setDropPos(null);
    dropPosRef.current = null;
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      e.preventDefault();
      const fromIndex = dragIndexRef.current;
      const currentDropPos = dropPosRef.current;
      dragIndexRef.current = null;
      dropPosRef.current = null;
      setOverIndex(null);
      setDropPos(null);

      if (fromIndex === null || fromIndex === toIndex) return;
      if (!itemHandlers.onReorderItems) return;

      // Adjust target index based on drop position.
      // 'above' = insert before this item; 'below' = insert after.
      // Account for the removed item shifting indices.
      let adjustedTo: number;
      if (currentDropPos === 'above') {
        adjustedTo = fromIndex < toIndex ? toIndex - 1 : toIndex;
      } else {
        adjustedTo = fromIndex < toIndex ? toIndex : toIndex + 1;
      }

      itemHandlers.onReorderItems(fromIndex, adjustedTo);
    },
    [itemHandlers.onReorderItems],
  );

  // ─── Render ────────────────────────────────────────────────────────────

  if (quoteAuthority?.kind === 'loading') {
    return (
      <section className="project-detail__section project-detail__items" aria-label="Ítems de cotización">
        <div className="project-detail__section-header">
          <h3 className="project-detail__section-title">Muebles</h3>
        </div>
        <p className="project-detail__empty" aria-busy="true">
          Cargando muebles de la cotización…
        </p>
      </section>
    );
  }

  if (quoteAuthority?.kind === 'error') {
    return (
      <section className="project-detail__section project-detail__items" aria-label="Ítems de cotización">
        <div className="project-detail__section-header">
          <h3 className="project-detail__section-title">Muebles</h3>
        </div>
        <div
          className="catalog-form__error"
          role="alert"
          data-testid="project-items-error"
          style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-start' }}
        >
          <p>{quoteAuthority.message}</p>
          <button
            type="button"
            className="btn btn--small"
            onClick={quoteAuthority.onRetry}
            data-testid="project-items-retry"
          >
            Reintentar
          </button>
        </div>
      </section>
    );
  }

  if (quoteAuthority?.kind === 'legacy') {
    // #642 legacy recovery: show the persisted quote_revision_items read-only
    // — the honest recoverable truth. Fail-closed per FIELD, not per revision:
    // furniture, parameters, materials and lifecycle persisted here are real;
    // amounts and frozen customer-facing labels never existed and are never
    // invented. Current catalog names may assist recognition, always marked as
    // "etiqueta actual" — never as frozen history of this revision.
    const legacyItems = quoteAuthority.items ?? [];
    const currentModuleLabel = (definitionId?: string | null): string | null => {
      if (!definitionId) return null;
      return modules.find((m) => m.id === definitionId)?.name ?? null;
    };
    const currentMaterialLabel = (materialId: string): string | null =>
      catalogs.materials.find((m) => m.id === materialId)?.name ?? null;

    return (
      <section className="project-detail__section project-detail__items" aria-label="Ítems de cotización">
        <div className="project-detail__section-header">
          <h3 className="project-detail__section-title">Muebles ({legacyItems.length})</h3>
          <span className="badge badge--warning" data-testid="quote-legacy-badge">
            Q{quoteAuthority.revisionNumber} · Cotización anterior
          </span>
        </div>

        <div
          className="catalog-form__error"
          role="status"
          data-testid="project-items-legacy"
          style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-start' }}
        >
          <p>{quoteAuthority.message}</p>
          {onOpenReconciliation ? (
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={() => onOpenReconciliation(project.id, quoteAuthority.revisionId)}
              data-testid="legacy-modernize-btn"
            >
              Crear nueva revisión actualizada
            </button>
          ) : null}
          {quoteAuthority.staleMessage ? (
            <p style={{ fontSize: '0.85rem' }}>{quoteAuthority.staleMessage}</p>
          ) : null}
          <button
            type="button"
            className="btn btn--small"
            onClick={quoteAuthority.onRetry}
            data-testid="project-items-legacy-retry"
          >
            Reintentar
          </button>
        </div>

        {legacyItems.length === 0 ? (
          <p className="project-detail__empty">Esta revisión no conserva muebles registrados.</p>
        ) : (
          <div className="project-item-list">
            {legacyItems.map((item, index) => {
              const dimensions = formatRevisionUnitDimensions(item.parameters);
              const moduleLabel = currentModuleLabel(item.furnitureDefinitionId);
              const materialEntries = Object.entries(item.materialChoices ?? {});
              return (
                <div
                  key={item.furnitureInstanceId}
                  className="project-item-card project-item-card--readonly"
                  data-testid={`quote-legacy-unit-${item.furnitureInstanceId}`}
                >
                  <div className="project-item-card__header">
                    <div className="project-item-card__header-left">
                      <span className="project-item-card__index">{index + 1}.</span>
                      <h4 className="project-item-card__title">Unidad física</h4>
                    </div>
                    <span className={`badge ${item.lifecycleStatus === 'active' ? 'badge--subtle' : 'badge--warning'}`}>
                      {formatLifecycleStatus(item.lifecycleStatus)}
                    </span>
                  </div>
                  <div className="project-item-card__body" style={{ display: 'grid', gap: '0.35rem' }}>
                    {dimensions != null ? (
                      <span data-testid={`quote-legacy-dimensions-${item.furnitureInstanceId}`}>
                        {dimensions}
                      </span>
                    ) : null}
                    <span className="project-item-readonly-value">
                      Definición: {item.furnitureDefinitionId || '—'}
                      {item.definitionVersion != null ? ` · v${item.definitionVersion}` : ''}
                    </span>
                    {moduleLabel != null ? (
                      <span className="catalog-form__hint" style={{ margin: 0 }}>
                        {moduleLabel} (etiqueta actual)
                      </span>
                    ) : null}
                    {materialEntries.map(([groupCode, materialId]) => (
                      <span key={groupCode} className="project-item-readonly-value">
                        Material {groupCode}: {materialId}
                        {currentMaterialLabel(materialId) != null ? (
                          <span className="catalog-form__hint" style={{ marginLeft: '0.35rem' }}>
                            {currentMaterialLabel(materialId)} (etiqueta actual)
                          </span>
                        ) : null}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  if (quoteAuthority?.kind === 'ready') {
    if (!quoteAuthority.snapshot) {
      return (
        <section className="project-detail__section project-detail__items" aria-label="Ítems de cotización">
          <div className="project-detail__section-header">
            <h3 className="project-detail__section-title">Muebles ({quoteAuthority.furnitureQuantity})</h3>
            <span className="badge badge--subtle">Q{quoteAuthority.revisionNumber} · Solo lectura</span>
          </div>
          <p className="project-detail__empty">Sin snapshot de muebles disponible para esta revisión.</p>
        </section>
      );
    }

    const revisionLines = buildRevisionLines(quoteAuthority.snapshot, quoteAuthority.items, {
      amountsVisible: showCosts,
    });

    return (
      <section className="project-detail__section project-detail__items" aria-label="Ítems de cotización">
        <div className="project-detail__section-header">
          <h3 className="project-detail__section-title">Muebles ({quoteAuthority.furnitureQuantity})</h3>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span className="badge badge--subtle" data-testid="quote-revision-badge">
              Q{quoteAuthority.revisionNumber} · Solo lectura
            </span>
          </div>
        </div>

        {quoteAuthority.staleMessage ? (
          <div className="catalog-form__error" role="status" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <span>{quoteAuthority.staleMessage}</span>
            <button type="button" className="btn btn--small" onClick={quoteAuthority.onRetry}>
              Reintentar
            </button>
          </div>
        ) : null}

        {revisionLines.length === 0 ? (
          <p className="project-detail__empty">Sin muebles registrados en esta revisión.</p>
        ) : (
          <div className="project-item-list">
            {revisionLines.map((line, index) => (
              <div
                key={line.quoteLineId}
                className="project-item-card project-item-card--readonly"
                data-testid={`quote-line-${line.quoteLineId}`}
              >
                <div className="project-item-card__header">
                  <div className="project-item-card__header-left">
                    <span className="project-item-card__index">{index + 1}.</span>
                    <h4 className="project-item-card__title">
                      {line.moduleName}{line.moduleCode ? ` — ${line.moduleCode}` : ''}
                    </h4>
                  </div>
                  {line.salePrice !== null ? (
                    <div className="project-item-card__price">
                      {formatProjectMoney(line.salePrice, quoteAuthority.currency)}
                    </div>
                  ) : null}
                </div>

                {line.isMultiUnit ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div className="catalog-form__field" style={{ maxWidth: '120px' }}>
                      <span className="catalog-form__label">Cantidad total</span>
                      <div className="project-item-readonly-value">{line.quantity}</div>
                    </div>
                    {line.units.map((unit, uIdx) => (
                      <div
                        key={unit.furnitureInstanceId}
                        className="project-revision-unit-card"
                        data-testid={`quote-unit-${unit.furnitureInstanceId}`}
                      >
                        <div className="project-revision-unit-card__header">
                          <span className="project-revision-unit-card__title">Unidad {uIdx + 1}</span>
                          <span className={`badge ${unit.lifecycleStatus === 'active' ? 'badge--subtle' : 'badge--warning'}`}>
                            {formatLifecycleStatus(unit.lifecycleStatus)}
                          </span>
                        </div>
                        <div className="project-revision-unit-card__meta">
                          <span className="project-item-readonly-uuid" title={unit.furnitureInstanceId}>
                            ID: {unit.furnitureInstanceId}
                          </span>
                        </div>
                        <div className="project-editor__grid">
                          {unit.dimensionsFormatted ? (
                            <div className="catalog-form__field">
                              <span className="catalog-form__label">Medidas</span>
                              <div className="project-item-readonly-value">{unit.dimensionsFormatted}</div>
                            </div>
                          ) : null}
                        </div>
                        {unit.options.length > 0 ? (
                          <div className="project-item-choices">
                            {unit.options.map((opt) => (
                              <div key={opt.groupCode} className="catalog-form__field">
                                <span className="catalog-form__label">{opt.groupLabel} ({opt.groupCode})</span>
                                <div className="project-item-readonly-value">
                                  {opt.groupLabel}: {opt.choiceLabel}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>
                    {line.units[0] ? (
                      <div data-testid={`quote-unit-${line.units[0].furnitureInstanceId}`}>
                        <div className="project-revision-unit-card__meta" style={{ marginBottom: '0.5rem' }}>
                          <span className="project-item-readonly-uuid" title={line.units[0].furnitureInstanceId}>
                            ID: {line.units[0].furnitureInstanceId}
                          </span>
                        </div>
                        <div className="project-editor__grid">
                          <div className="catalog-form__field">
                            <span className="catalog-form__label">Cantidad</span>
                            <div className="project-item-readonly-value">{line.quantity}</div>
                          </div>
                          <div className="catalog-form__field">
                            <span className="catalog-form__label">Estado</span>
                            <div className="project-item-readonly-value">
                              <span className={`badge ${line.units[0].lifecycleStatus === 'active' ? 'badge--subtle' : 'badge--warning'}`}>
                                {formatLifecycleStatus(line.units[0].lifecycleStatus)}
                              </span>
                            </div>
                          </div>
                          {line.units[0].dimensionsFormatted ? (
                            <div className="catalog-form__field">
                              <span className="catalog-form__label">Medidas</span>
                              <div className="project-item-readonly-value">
                                {line.units[0].dimensionsFormatted}
                              </div>
                            </div>
                          ) : null}
                        </div>
                        {line.units[0].options.length > 0 ? (
                          <div className="project-item-choices">
                            {line.units[0].options.map((opt) => (
                              <div key={opt.groupCode} className="catalog-form__field">
                                <span className="catalog-form__label">{opt.groupLabel} ({opt.groupCode})</span>
                                <div className="project-item-readonly-value">
                                  {opt.groupLabel}: {opt.choiceLabel}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="catalog-empty">Sin opciones requeridas.</p>
                        )}
                      </div>
                    ) : (
                      <div className="catalog-form__field">
                        <span className="catalog-form__label">Cantidad</span>
                        <div className="project-item-readonly-value">{line.quantity}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="project-detail__section project-detail__items" aria-label="Ítems de cotización">
      <div className="project-detail__section-header">
        <h3 className="project-detail__section-title">Muebles ({project.items.length})</h3>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {project.items.length > 0 ? (
            <button type="button" className="btn btn--small" onClick={viewer3D.onOpenQuote3D} data-testid="project-view-3d-run">
              <Box size={14} strokeWidth={1.5} aria-hidden /> Vista 3D cotización
            </button>
          ) : null}
          {canEditContent ? (
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={onOpenAddItemModal}
              disabled={modules.length === 0}
            >
              <Plus size={14} strokeWidth={1.5} aria-hidden /> Agregar mueble
            </button>
          ) : null}
        </div>
      </div>

      {itemError && !addItemModalOpen ? (
        <p className="catalog-form__error">{itemError}</p>
      ) : null}

      {postAddPlaceCue ? (
        <div
          className="project-post-add-cue"
          role="status"
          data-testid="project-post-add-place-cue"
        >
          <p className="project-post-add-cue__text">
            Mueble agregado a la cotización. Podés seguir armando la lista o
            colocarlo en el plano.
          </p>
          <div className="project-post-add-cue__actions">
            {onOpenSpatialStudioUnplaced ? (
              <button
                type="button"
                className="btn btn--primary btn--small"
                onClick={onOpenSpatialStudioUnplaced}
                data-testid="project-post-add-place-cue-open"
              >
                Colocar en Proyectar
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => onDismissPostAddPlaceCue?.()}
              aria-label="Listo"
              data-testid="project-post-add-place-cue-dismiss"
            >
              <X size={14} strokeWidth={1.5} aria-hidden /> Listo
            </button>
          </div>
        </div>
      ) : null}

      {project.items.length === 0 ? (
        <p className="project-detail__empty">Sin muebles. Agregá uno del catálogo para cotizar.</p>
      ) : (
        <div className="project-item-list">
          {project.items.map((item, index) => {
            const mod = modules.find((m) => m.id === item.moduleId);
            const groups = groupsForModuleItem(
              mod,
              optionGroups,
              catalogComponents,
              catalogStructures,
              undefined,
              item.baseMode,
            );

            // Drop indicator classes
            const isOver = overIndex === index;
            const dropAbove = isOver && dropPos === 'above';
            const dropBelow = isOver && dropPos === 'below';
            const cardClasses = [
              'project-item-card',
              dropAbove ? 'project-item-card--drop-above' : '',
              dropBelow ? 'project-item-card--drop-below' : '',
            ].filter(Boolean).join(' ');

            return (
              <div
                key={item.id}
                className={cardClasses}
                data-testid={`project-item-${item.id}`}
                draggable={canEditContent && !!itemHandlers.onReorderItems}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, index)}
              >
                <div className="project-item-card__header">
                  <div className="project-item-card__header-left">
                    {itemHandlers.onReorderItems ? (
                      <span
                        className="project-item-card__drag-handle"
                        title="Arrastrar para reordenar"
                        aria-hidden="true"
                      >
                        <GripVertical size={16} strokeWidth={1.5} />
                      </span>
                    ) : null}
                    <span className="project-item-card__index">{index + 1}.</span>
                    <h4 className="project-item-card__title">
                      {mod ? `${mod.name} — ${mod.code}` : `Mueble desconocido (${item.moduleId})`}
                      {mod?.furnitureType ? (
                        <span className="project-item-type-badge" data-testid={`project-item-type-badge-${item.id}`}>
                          {furnitureTypeLabel(mod.furnitureType)}
                        </span>
                      ) : null}
                      {item.structureRevisionPin !== undefined ? (
                        <ProjectItemStructureRevisionIndicator pin={item.structureRevisionPin} testId={`project-item-revision-pin-${item.id}`} />
                      ) : null}
                    </h4>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {mod && (
                      <button type="button" className="btn btn--small" onClick={() => viewer3D.onOpenItem3D(item, mod)} data-testid={`view-3d-btn-${item.id}`}>
                        <Box size={14} strokeWidth={1.5} aria-hidden /> 3D
                      </button>
                    )}
                    {canEditContent ? (
                      removeConfirm.confirmRemoveItemId === item.id ? (
                      <span className="project-inline-confirm">
                        <span className="project-inline-confirm__text">¿Quitar?</span>
                        <button type="button" className="btn btn--small btn--danger" onClick={() => removeConfirm.onConfirmRemoveItem(project.id, item.id)}>Confirmar</button>
                        <button type="button" className="btn btn--small" onClick={removeConfirm.onCancelRemoveItem}>Cancelar</button>
                      </span>
                    ) : (
                      <button type="button" className="btn btn--small btn--danger" onClick={() => removeConfirm.onRequestRemoveItem(item.id)}>Quitar</button>
                    )
                    ) : null}
                  </div>
                </div>

                <div className="project-editor__grid">
                  <div className="catalog-form__field">
                    <label htmlFor={`item-qty-${item.id}`}>Cantidad</label>
                    <input
                      id={`item-qty-${item.id}`}
                      type="number"
                      min={1}
                      step={1}
                      value={item.quantity}
                      disabled={!canEditContent}
                      onChange={(e) =>
                        itemHandlers.onUpdateItemQuantity(
                          item,
                          Number(e.target.value),
                        )
                      }
                    />
                  </div>
                  {mod && (mod.presets?.length ?? 0) > 0 ? (
                    <div className="catalog-form__field">
                      <label htmlFor={`item-measure-${item.id}`}>Medida</label>
                      <select
                        id={`item-measure-${item.id}`}
                        value={item.measurePresetId ?? ''}
                        disabled={!canEditContent}
                        onChange={(e) =>
                          itemHandlers.onUpdateItemMeasurePreset(
                            item,
                            e.target.value,
                          )
                        }
                        data-testid={`item-measure-preset-${item.id}`}
                      >
                        <option value="">Elegí medida…</option>
                        {mod.presets!.map((pr) => (
                          <option key={pr.id} value={pr.id}>
                            {pr.name?.trim() ? `${pr.name} (${pr.width}×${pr.height}×${pr.depth} mm)` : `${pr.width}×${pr.height}×${pr.depth} mm`}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>

                {groups.length === 0 ? (
                  <p className="catalog-empty">Este mueble no tiene grupos de opción requeridos.</p>
                ) : (
                  <div className="project-item-choices">
                    {groups.map((group) => {
                      const options = optionsForGroup(group, catalogs);
                      const lineValue = item.optionChoices[group.code]?.trim() ?? '';
                      const projectDefault = project.projectLevelChoices?.[group.code]?.trim() ?? '';
                      const isOverride = Boolean(lineValue);
                      const inheritLabel = projectDefault
                        ? `Usar default del proyecto (${optionLabelForId(projectDefault, group, catalogs)})`
                        : 'Usar default del proyecto';
                      return (
                        <div key={group.id} className="catalog-form__field">
                          <label htmlFor={`choice-${item.id}-${group.code}`}>
                            {group.name} ({group.code})
                            {isOverride ? (
                              <span className="project-choice-override-badge" title="Esta línea overridea el default del proyecto">Override</span>
                            ) : null}
                          </label>
                          <select
                            id={`choice-${item.id}-${group.code}`}
                            value={lineValue}
                            disabled={!canEditContent}
                            onChange={(e) =>
                              itemHandlers.onUpdateItemChoice(
                                item,
                                group.code,
                                e.target.value,
                              )
                            }
                            data-testid={`item-choice-${item.id}-${group.code}`}
                          >
                            <option value="">{inheritLabel}</option>
                            {options.map((opt) => (
                              <option key={opt.id} value={opt.id}>{opt.name} — {opt.code}</option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
});
