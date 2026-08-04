/**
 * Project items list section — extracted from ProjectDetailViewInner (#refactor).
 *
 * Renders: section header with "Vista 3D cotización" + "Agregar mueble" buttons,
 * error message, empty state, and the list of item cards with quantity/measure
 * pickers, option choice dropdowns, 3D viewer triggers, and inline remove confirm.
 * Items support drag & drop reordering (F052).
 */

import { memo, useCallback, useRef, useState, type ReactNode } from 'react';
import { Box, GripVertical, Plus } from 'lucide-react';
import { useProjectDetail } from './projectDetailContext';
import { ProjectItemStructureRevisionIndicator } from './ProjectItemStructureRevisionIndicator';
import {
  groupsForModuleItem,
  optionLabelForId,
  optionsForGroup,
  furnitureTypeLabel,
} from '../projectHelpers';

/** Drag-over visual feedback state. */
type DropPosition = 'above' | 'below' | null;

export const ProjectItemsSection = memo(function ProjectItemsSection(): ReactNode {
  const {
    project,
    modules,
    optionGroups,
    catalogs,
    itemHandlers,
    removeConfirm,
    viewer3D,
    itemError,
    addItemModalOpen,
    onOpenAddItemModal,
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

  return (
    <section className="project-detail__section project-detail__items" aria-label="Ítems de cotización">
      <div className="project-detail__section-header">
        <h3 className="project-detail__section-title">Muebles ({project.items.length})</h3>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {project.items.length > 0 ? (
            <button type="button" className="btn btn--small btn--outline" onClick={viewer3D.onOpenQuote3D} data-testid="project-view-3d-run">
              <Box size={14} strokeWidth={1.5} aria-hidden /> Vista 3D cotización
            </button>
          ) : null}
          <button type="button" className="btn btn--primary btn--small" onClick={onOpenAddItemModal} disabled={modules.length === 0}>
            <Plus size={14} strokeWidth={1.5} aria-hidden /> Agregar mueble
          </button>
        </div>
      </div>

      {itemError && !addItemModalOpen ? (
        <p className="catalog-form__error">{itemError}</p>
      ) : null}

      {project.items.length === 0 ? (
        <p className="project-detail__empty">Sin muebles. Agregá uno del catálogo para cotizar.</p>
      ) : (
        <div className="project-item-list">
          {project.items.map((item, index) => {
            const mod = modules.find((m) => m.id === item.moduleId);
            const groups = groupsForModuleItem(mod, optionGroups);

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
                draggable={!!itemHandlers.onReorderItems}
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
                      <button type="button" className="btn btn--small btn--outline" onClick={() => viewer3D.onOpenItem3D(item, mod)} data-testid={`view-3d-btn-${item.id}`}>
                        <Box size={14} strokeWidth={1.5} aria-hidden /> 3D
                      </button>
                    )}
                    {removeConfirm.confirmRemoveItemId === item.id ? (
                      <span className="project-inline-confirm">
                        <span className="project-inline-confirm__text">¿Quitar?</span>
                        <button type="button" className="btn btn--small btn--danger" onClick={() => removeConfirm.onConfirmRemoveItem(project.id, item.id)}>Confirmar</button>
                        <button type="button" className="btn btn--small" onClick={removeConfirm.onCancelRemoveItem}>Cancelar</button>
                      </span>
                    ) : (
                      <button type="button" className="btn btn--small btn--danger" onClick={() => removeConfirm.onRequestRemoveItem(item.id)}>Quitar</button>
                    )}
                  </div>
                </div>

                <div className="project-editor__grid">
                  <div className="catalog-form__field">
                    <label htmlFor={`item-qty-${item.id}`}>Cantidad</label>
                    <input id={`item-qty-${item.id}`} type="number" min={1} step={1} value={item.quantity}
                      onChange={(e) => itemHandlers.onUpdateItemQuantity(item, Number(e.target.value))} />
                  </div>
                  {mod && (mod.presets?.length ?? 0) > 0 ? (
                    <div className="catalog-form__field">
                      <label htmlFor={`item-measure-${item.id}`}>Medida</label>
                      <select id={`item-measure-${item.id}`} value={item.measurePresetId ?? ''}
                        onChange={(e) => itemHandlers.onUpdateItemMeasurePreset(item, e.target.value)}
                        data-testid={`item-measure-preset-${item.id}`}>
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
                          <select id={`choice-${item.id}-${group.code}`} value={lineValue}
                            onChange={(e) => itemHandlers.onUpdateItemChoice(item, group.code, e.target.value)}
                            data-testid={`item-choice-${item.id}-${group.code}`}>
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
