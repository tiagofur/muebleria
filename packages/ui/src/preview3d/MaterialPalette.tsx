/**
 * MaterialPalette — paleta de acabados 3D (texturas, pinturas, materiales) arrastrable al 3D.
 * Soporta comboboxes en cascada para categorías (L1 › L2 › L3) y búsqueda en tiempo real.
 *
 * Los acabados sólo se aplican arrastrando y soltando: cada material es
 * draggable y codifica su id en dataTransfer (PAINT_DRAG_MIME). El canvas del
 * FurnitureScene3D es el drop target y resuelve la superficie golpeada
 * (piso/muro/techo/mesada) por raycast — no hay aplicación por clic.
 */

import { useMemo, useState, type ReactNode } from 'react';
import type { AmbientCategory, AmbientMaterial } from '@muebles/domain';
import {
  categoryPath,
  childrenOf,
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

export type MaterialPaletteProps = {
  readonly materials: readonly AmbientMaterial[];
  readonly categories?: readonly AmbientCategory[];
  readonly activeFloorId?: string;
  readonly activeWallId?: string;
  readonly activeCeilingId?: string;
  readonly activeCountertopId?: string;
  readonly testId?: string;
  readonly onOpenCatalog?: () => void;
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
        width={36}
        height={36}
        viewBox="0 0 36 36"
        aria-label={material.previewColor}
      >
        <rect x={0} y={0} width={36} height={36} rx={5} fill={material.previewColor} />
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
  isCountertop,
  testId,
}: {
  readonly material: AmbientMaterial;
  readonly active: boolean;
  readonly isFloor: boolean;
  readonly isWall: boolean;
  readonly isCeiling: boolean;
  readonly isCountertop?: boolean;
  readonly testId: string;
}): ReactNode {
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>): void => {
    const payload: PaintDragPayload = {
      materialId: material.id,
      surfaceType: material.surfaceType,
    };
    e.dataTransfer.setData(PAINT_DRAG_MIME, encodePaintDrag(payload));
    e.dataTransfer.setData('text/plain', material.id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div
      className={
        'material-palette__chip' + (active ? ' material-palette__chip--active' : '')
      }
      draggable
      onDragStart={handleDragStart}
      aria-label={`${material.name} (${material.code}) — arrastrar al plano para aplicar`}
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
      {(isFloor || isWall || isCeiling || isCountertop) && (
        <span className="material-palette__badges">
          {isFloor && (
            <span className="material-palette__badge material-palette__badge--floor" title="Aplicado en Suelo">
              Piso
            </span>
          )}
          {isWall && (
            <span className="material-palette__badge material-palette__badge--wall" title="Aplicado en Pared">
              Pared
            </span>
          )}
          {isCeiling && (
            <span className="material-palette__badge material-palette__badge--ceiling" title="Aplicado en Techo">
              Techo
            </span>
          )}
          {isCountertop && (
            <span className="material-palette__badge material-palette__badge--countertop" title="Aplicado en Mesada">
              Mesada
            </span>
          )}
        </span>
      )}
    </div>
  );
}

export function MaterialPalette({
  materials,
  categories = [],
  activeFloorId,
  activeWallId,
  activeCeilingId,
  activeCountertopId,
  testId = 'material-palette',
  onOpenCatalog,
}: MaterialPaletteProps): ReactNode {
  const [selectedL1Id, setSelectedL1Id] = useState<string>('');
  const [selectedL2Id, setSelectedL2Id] = useState<string>('');
  const [selectedL3Id, setSelectedL3Id] = useState<string>('');
  const [search, setSearch] = useState('');

  const activeMaterials = useMemo(
    () => materials.filter((m) => m.active),
    [materials],
  );

  // Level 1 options (roots)
  const l1Nodes = useMemo(() => childrenOf(categories, undefined), [categories]);

  // Level 2 options (children of selected L1)
  const l2Nodes = useMemo(
    () => (selectedL1Id && selectedL1Id !== UNCATEGORIZED_FILTER ? childrenOf(categories, selectedL1Id) : []),
    [categories, selectedL1Id],
  );

  // Level 3 options (children of selected L2)
  const l3Nodes = useMemo(
    () => (selectedL2Id ? childrenOf(categories, selectedL2Id) : []),
    [categories, selectedL2Id],
  );

  // Count uncategorized
  const uncategorizedCount = useMemo(
    () => filterAmbientMaterialsByCategory(activeMaterials, UNCATEGORIZED_FILTER, categories).length,
    [activeMaterials, categories],
  );

  // Active filter ID (L3 > L2 > L1 > null)
  const effectiveFilterId = useMemo(() => {
    if (selectedL1Id === UNCATEGORIZED_FILTER) return UNCATEGORIZED_FILTER;
    if (selectedL3Id) return selectedL3Id;
    if (selectedL2Id) return selectedL2Id;
    if (selectedL1Id) return selectedL1Id;
    return null;
  }, [selectedL1Id, selectedL2Id, selectedL3Id]);

  // Filtered materials
  const filteredMaterials = useMemo(() => {
    let list = activeMaterials;
    if (effectiveFilterId !== null) {
      list = filterAmbientMaterialsByCategory(list, effectiveFilterId, categories);
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
  }, [activeMaterials, effectiveFilterId, categories, search]);

  // Grouped sections
  const groupedSections = useMemo(() => {
    if (categories.length === 0 || effectiveFilterId !== null) {
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
  }, [filteredMaterials, categories, effectiveFilterId]);

  const handleL1Change = (val: string) => {
    setSelectedL1Id(val);
    setSelectedL2Id('');
    setSelectedL3Id('');
  };

  const handleL2Change = (val: string) => {
    setSelectedL2Id(val);
    setSelectedL3Id('');
  };

  const handleL3Change = (val: string) => {
    setSelectedL3Id(val);
  };

  return (
    <div className="material-palette" data-testid={testId}>
      {/* Cascading Category Comboboxes */}
      {categories.length > 0 ? (
        <div className="material-palette__filters-box">
          {/* L1 Category Combobox */}
          <div className="material-palette__filter-row">
            <select
              className="select select--sm material-palette__select"
              value={selectedL1Id}
              onChange={(e) => handleL1Change(e.target.value)}
              aria-label="Categoría principal"
              data-testid={`${testId}-select-l1`}
            >
              <option value="">Todas las categorías ({activeMaterials.length})</option>
              {l1Nodes.map((cat) => {
                const count = filterAmbientMaterialsByCategory(activeMaterials, cat.id, categories).length;
                return (
                  <option key={cat.id} value={cat.id}>
                    {cat.name} ({count})
                  </option>
                );
              })}
              {uncategorizedCount > 0 ? (
                <option value={UNCATEGORIZED_FILTER}>
                  Sin categoría ({uncategorizedCount})
                </option>
              ) : null}
            </select>
          </div>

          {/* L2 Subcategory Combobox (if L1 selected and has children) */}
          {l2Nodes.length > 0 ? (
            <div className="material-palette__filter-row">
              <select
                className="select select--sm material-palette__select"
                value={selectedL2Id}
                onChange={(e) => handleL2Change(e.target.value)}
                aria-label="Subcategoría nivel 2"
                data-testid={`${testId}-select-l2`}
              >
                <option value="">Todas las subcategorías</option>
                {l2Nodes.map((sub) => {
                  const count = filterAmbientMaterialsByCategory(activeMaterials, sub.id, categories).length;
                  return (
                    <option key={sub.id} value={sub.id}>
                      {sub.name} ({count})
                    </option>
                  );
                })}
              </select>
            </div>
          ) : null}

          {/* L3 Subcategory Combobox (if L2 selected and has children) */}
          {l3Nodes.length > 0 ? (
            <div className="material-palette__filter-row">
              <select
                className="select select--sm material-palette__select"
                value={selectedL3Id}
                onChange={(e) => handleL3Change(e.target.value)}
                aria-label="Subcategoría nivel 3"
                data-testid={`${testId}-select-l3`}
              >
                <option value="">Todas</option>
                {l3Nodes.map((sub3) => {
                  const count = filterAmbientMaterialsByCategory(activeMaterials, sub3.id, categories).length;
                  return (
                    <option key={sub3.id} value={sub3.id}>
                      {sub3.name} ({count})
                    </option>
                  );
                })}
              </select>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Search Input */}
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Buscar acabado por nombre o código..."
        aria-label="Buscar acabados"
      />

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
                const isCountertop = m.id === activeCountertopId;

                return (
                  <li key={m.id}>
                    <MaterialChip
                      material={m}
                      active={isFloor || isWall || isCeiling || isCountertop}
                      isFloor={isFloor}
                      isWall={isWall}
                      isCeiling={isCeiling}
                      isCountertop={isCountertop}
                      testId={`${testId}-chip-${m.id}`}
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
