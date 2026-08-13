/**
 * MaterialPalette — paleta de acabados 3D (texturas, pinturas, materiales) arrastrable al 3D.
 * Soporta jerarquía de categorías, filtrado, búsqueda y selector de superficie objetivo (Suelo/Pared/Techo).
 *
 * Drag source HTML5: cada material es draggable, codifica su id
 * en dataTransfer (PAINT_DRAG_MIME). El canvas del FurnitureScene3D es el drop
 * target y resuelve la superficie golpeada por raycast.
 */

import { useMemo, useState, type ReactNode } from 'react';
import type { AmbientCategory, AmbientMaterial } from '@muebles/domain';
import {
  categoryPath,
  filterAmbientMaterialsByCategory,
  UNCATEGORIZED_FILTER,
} from '@muebles/domain';
import { SearchInput } from '../common';
import {
  PAINT_DRAG_MIME,
  encodePaintDrag,
  type PaintDragPayload,
} from './paintMaterial';
import './materialPalette.css';

export type TargetSurface = 'floor' | 'wall' | 'ceiling';

export type MaterialPaletteProps = {
  readonly materials: readonly AmbientMaterial[];
  readonly categories?: readonly AmbientCategory[];
  readonly activeFloorId?: string;
  readonly activeWallId?: string;
  readonly activeCeilingId?: string;
  readonly testId?: string;
  readonly onOpenCatalog?: () => void;
  readonly onSelectMaterial?: (material: AmbientMaterial, targetSurface?: TargetSurface) => void;
};

function MaterialSwatch({
  material,
}: {
  readonly material: AmbientMaterial;
}): ReactNode {
  if (material.previewTextureUrl) {
    return (
      <img
        className="material-palette__thumb-img"
        src={material.previewTextureUrl}
        alt=""
        draggable={false}
      />
    );
  }
  if (material.previewColor) {
    return (
      <svg
        className="material-palette__swatch"
        width={40}
        height={40}
        viewBox="0 0 40 40"
        aria-label={material.previewColor}
      >
        <rect x={0} y={0} width={40} height={40} rx={6} fill={material.previewColor} />
      </svg>
    );
  }
  return <span className="material-palette__no-preview">—</span>;
}

function MaterialChip({
  material,
  active,
  isFloor,
  isWall,
  isCeiling,
  testId,
  onSelect,
}: {
  readonly material: AmbientMaterial;
  readonly active: boolean;
  readonly isFloor: boolean;
  readonly isWall: boolean;
  readonly isCeiling: boolean;
  readonly testId: string;
  readonly onSelect?: (material: AmbientMaterial) => void;
}): ReactNode {
  const handleDragStart = (e: React.DragEvent<HTMLButtonElement>): void => {
    const payload: PaintDragPayload = {
      materialId: material.id,
      surfaceType: material.surfaceType,
    };
    e.dataTransfer.setData(PAINT_DRAG_MIME, encodePaintDrag(payload));
    e.dataTransfer.setData('text/plain', material.id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <button
      type="button"
      className={
        'material-palette__chip' + (active ? ' material-palette__chip--active' : '')
      }
      draggable
      onDragStart={handleDragStart}
      onClick={() => onSelect?.(material)}
      aria-pressed={active}
      aria-label={`${material.name} (${material.code}) — hacer clic o arrastrar para aplicar`}
      data-testid={testId}
    >
      <span className="material-palette__thumb">
        <MaterialSwatch material={material} />
      </span>
      <span className="material-palette__label">
        <span className="material-palette__name">{material.name}</span>
        {material.code ? (
          <span className="material-palette__code">{material.code}</span>
        ) : null}
      </span>
      {(isFloor || isWall || isCeiling) && (
        <span className="material-palette__badges">
          {isFloor && (
            <span className="material-palette__badge material-palette__badge--floor" title="Aplicado al Suelo">
              Piso
            </span>
          )}
          {isWall && (
            <span className="material-palette__badge material-palette__badge--wall" title="Aplicado a Pared">
              Pared
            </span>
          )}
          {isCeiling && (
            <span className="material-palette__badge material-palette__badge--ceiling" title="Aplicado al Techo">
              Techo
            </span>
          )}
        </span>
      )}
    </button>
  );
}

export function MaterialPalette({
  materials,
  categories = [],
  activeFloorId,
  activeWallId,
  activeCeilingId,
  testId = 'material-palette',
  onOpenCatalog,
  onSelectMaterial,
}: MaterialPaletteProps): ReactNode {
  const [targetSurface, setTargetSurface] = useState<TargetSurface>('floor');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const activeMaterials = useMemo(
    () => materials.filter((m) => m.active),
    [materials],
  );

  // Category filter options
  const categoryPills = useMemo(() => {
    if (categories.length === 0) return [];
    const rootCats = categories.filter((c) => !c.parentId);
    const pills: { id: string | null; name: string; count: number }[] = [
      { id: null, name: 'Todos', count: activeMaterials.length },
    ];
    for (const cat of rootCats) {
      const count = filterAmbientMaterialsByCategory(activeMaterials, cat.id, categories).length;
      pills.push({ id: cat.id, name: cat.name, count });
    }
    const uncategorizedCount = filterAmbientMaterialsByCategory(
      activeMaterials,
      UNCATEGORIZED_FILTER,
      categories,
    ).length;
    if (uncategorizedCount > 0) {
      pills.push({
        id: UNCATEGORIZED_FILTER,
        name: 'Sin categoría',
        count: uncategorizedCount,
      });
    }
    return pills;
  }, [categories, activeMaterials]);

  // Filtered materials
  const filteredMaterials = useMemo(() => {
    let list = activeMaterials;
    if (selectedCategoryFilter !== null) {
      list = filterAmbientMaterialsByCategory(list, selectedCategoryFilter, categories);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.code.toLowerCase().includes(q),
      );
    }
    return list;
  }, [activeMaterials, selectedCategoryFilter, categories, search]);

  // Groups by Category
  const groupedSections = useMemo(() => {
    if (categories.length === 0 || selectedCategoryFilter !== null) {
      return [{ title: null, items: filteredMaterials }];
    }

    const groupsMap = new Map<string, { title: string; items: AmbientMaterial[] }>();
    const uncategorized: AmbientMaterial[] = [];

    for (const m of filteredMaterials) {
      if (!m.categoryId) {
        uncategorized.push(m);
        continue;
      }
      const path = categoryPath(m.categoryId, categories);
      const title = path.length > 0 ? path.map((c) => c.name).join(' › ') : 'Sin categoría';
      const existing = groupsMap.get(title);
      if (existing) {
        existing.items.push(m);
      } else {
        groupsMap.set(title, { title, items: [m] });
      }
    }

    const result = Array.from(groupsMap.values());
    if (uncategorized.length > 0) {
      result.push({ title: 'Sin categoría', items: uncategorized });
    }
    return result;
  }, [filteredMaterials, categories, selectedCategoryFilter]);

  const handleChipSelect = (material: AmbientMaterial) => {
    onSelectMaterial?.(material, targetSurface);
  };

  return (
    <div className="material-palette" data-testid={testId}>
      {/* Target surface segmented buttons */}
      <div className="material-palette__target-bar">
        <span className="material-palette__target-label">Superficie activa para aplicar:</span>
        <div className="material-palette__target-segmented" role="radiogroup" aria-label="Superficie objetivo">
          <button
            type="button"
            className={
              'material-palette__target-btn' +
              (targetSurface === 'floor' ? ' material-palette__target-btn--active' : '')
            }
            onClick={() => setTargetSurface('floor')}
            aria-pressed={targetSurface === 'floor'}
            data-testid={`${testId}-target-floor`}
          >
            Suelo
          </button>
          <button
            type="button"
            className={
              'material-palette__target-btn' +
              (targetSurface === 'wall' ? ' material-palette__target-btn--active' : '')
            }
            onClick={() => setTargetSurface('wall')}
            aria-pressed={targetSurface === 'wall'}
            data-testid={`${testId}-target-wall`}
          >
            Pared
          </button>
          <button
            type="button"
            className={
              'material-palette__target-btn' +
              (targetSurface === 'ceiling' ? ' material-palette__target-btn--active' : '')
            }
            onClick={() => setTargetSurface('ceiling')}
            aria-pressed={targetSurface === 'ceiling'}
            data-testid={`${testId}-target-ceiling`}
          >
            Techo
          </button>
        </div>
      </div>

      <p className="material-palette__hint">
        Hacé clic en un acabado para aplicarlo al {targetSurface === 'floor' ? 'suelo' : targetSurface === 'wall' ? 'muro' : 'techo'}, o arrastralo al 3D.
      </p>

      {/* Search Input */}
      {materials.length > 3 ? (
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar acabado por nombre o código..."
          aria-label="Buscar acabados"
        />
      ) : null}

      {/* Category Pills Filter */}
      {categoryPills.length > 2 ? (
        <div className="material-palette__categories" role="tablist" aria-label="Filtrar por categoría">
          {categoryPills.map((pill) => (
            <button
              key={pill.id ?? 'all'}
              type="button"
              className={
                'material-palette__cat-pill' +
                (selectedCategoryFilter === pill.id ? ' material-palette__cat-pill--active' : '')
              }
              onClick={() => setSelectedCategoryFilter(pill.id)}
              data-testid={`${testId}-cat-${pill.id ?? 'all'}`}
            >
              {pill.name} ({pill.count})
            </button>
          ))}
        </div>
      ) : null}

      {materials.length === 0 && onOpenCatalog ? (
        <div className="material-palette__empty-box">
          <p className="material-palette__empty">
            No hay acabados configurados en el catálogo.
          </p>
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={onOpenCatalog}
            data-testid={`${testId}-open-catalog`}
          >
            Ir a Acabados
          </button>
        </div>
      ) : null}

      {/* Grouped materials list */}
      {filteredMaterials.length === 0 && materials.length > 0 ? (
        <p className="material-palette__empty">No se encontraron acabados con este filtro.</p>
      ) : (
        groupedSections.map((group, gIdx) => (
          <div key={group.title ?? `g-${gIdx}`} className="material-palette__group">
            {group.title ? (
              <h6 className="material-palette__group-title">
                <span>{group.title}</span>
                <span className="material-palette__group-count">({group.items.length})</span>
              </h6>
            ) : null}
            <ul className="material-palette__list" role="list">
              {group.items.map((m) => {
                const isFloor = m.id === activeFloorId;
                const isWall = m.id === activeWallId;
                const isCeiling = m.id === activeCeilingId;
                const isCurrentTargetActive =
                  (targetSurface === 'floor' && isFloor) ||
                  (targetSurface === 'wall' && isWall) ||
                  (targetSurface === 'ceiling' && isCeiling);

                return (
                  <li key={m.id}>
                    <MaterialChip
                      material={m}
                      active={isCurrentTargetActive}
                      isFloor={isFloor}
                      isWall={isWall}
                      isCeiling={isCeiling}
                      testId={`${testId}-chip-${m.id}`}
                      onSelect={handleChipSelect}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
