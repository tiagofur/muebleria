/**
 * BoardMaterialPalette — dock de materiales del TALLER (tableros,
 * MaterialBoard) dentro de Proyectar (F142 / #309). Navegación estándar con
 * la Biblioteca: chips de Fabricante + cascada de subgrupos por nivel +
 * búsqueda tolerante. Los tableros se aplican a MUEBLES (drag sobre el canvas
 * o click); nunca a superficies ambientales — el studio rechaza ese drop con
 * feedback que enseña. Panel presentacional: el estado de scope y el apply
 * viven en el studio.
 */

import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import type { MaterialBoard, MaterialCategory } from '@muebles/domain';
import {
  categoryPath,
  filterMaterialBoardsByCategory,
  materialManufacturer,
  MATERIAL_MANUFACTURER_UNSET,
} from '@muebles/domain';
import {
  BOARD_PAINT_DRAG_MIME,
  encodeBoardPaintDrag,
} from './paintMaterial';
import {
  cascadeLevelLabel,
  cascadeLevels,
  sanitizeCategoryPath,
} from '../common/cascadeLevels';
import { normalizeSearchText } from '../projects/components/library/searchModules';
import './boardMaterialPalette.css';

/** Scope de aplicación del tablero (el default del drag es 'fronts'). */
export type BoardApplyScope = 'fronts' | 'interior' | 'whole' | 'project';

export const BOARD_APPLY_SCOPES: readonly {
  readonly id: BoardApplyScope;
  readonly label: string;
}[] = [
  { id: 'fronts', label: 'Frentes del mueble' },
  { id: 'interior', label: 'Interior del mueble' },
  { id: 'whole', label: 'Todo el mueble' },
  { id: 'project', label: 'Frentes de toda la obra' },
];

export interface BoardMaterialPaletteProps {
  readonly materials: readonly MaterialBoard[];
  readonly materialCategories: readonly MaterialCategory[];
  readonly canEdit: boolean;
  readonly resolveMediaUrl?: (url: string | undefined) => string | undefined;
  /** Scope activo (controlado por el studio). */
  readonly scope: BoardApplyScope;
  readonly onScopeChange: (scope: BoardApplyScope) => void;
  /** Los scopes de mueble requieren selección (o drop sobre un mueble). */
  readonly hasSelection: boolean;
  /** Último apply / error de enseñanza (aria-live). */
  readonly status: string | null;
  readonly onApply: (materialId: string) => void;
  readonly onCardDragStart?: (materialId: string) => void;
  readonly onCardDragEnd?: () => void;
}

function materialHaystack(
  material: MaterialBoard,
  categories: readonly MaterialCategory[],
): string {
  const parts = [material.name, material.code, materialManufacturer(material)];
  for (const node of categoryPath(material.categoryId, categories)) {
    parts.push(node.name);
  }
  return normalizeSearchText(parts.join(' '));
}

export function BoardMaterialPalette({
  materials,
  materialCategories,
  canEdit,
  resolveMediaUrl,
  scope,
  onScopeChange,
  hasSelection,
  status,
  onApply,
  onCardDragStart,
  onCardDragEnd,
}: BoardMaterialPaletteProps): ReactNode {
  const [manufacturer, setManufacturer] = useState<string | null>(null);
  const [subgroupPath, setSubgroupPath] = useState<readonly string[]>([]);
  const [search, setSearch] = useState('');

  const activeMaterials = useMemo(
    () => materials.filter((m) => m.active),
    [materials],
  );

  const manufacturers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of activeMaterials) {
      const name = materialManufacturer(m);
      if (!seen.has(name)) seen.set(name, name);
    }
    return Array.from(seen.keys()).sort((a, b) =>
      a === MATERIAL_MANUFACTURER_UNSET
        ? 1
        : b === MATERIAL_MANUFACTURER_UNSET
          ? -1
          : a.localeCompare(b, 'es'),
    );
  }, [activeMaterials]);

  const path = useMemo(
    () => sanitizeCategoryPath(materialCategories, subgroupPath),
    [materialCategories, subgroupPath],
  );
  const levelRows = useMemo(
    () =>
      materialCategories.length === 0 ? [] : cascadeLevels(materialCategories, path),
    [materialCategories, path],
  );

  const scoped = useMemo(() => {
    if (manufacturer === null) return activeMaterials;
    return activeMaterials.filter(
      (m) => materialManufacturer(m) === manufacturer,
    );
  }, [activeMaterials, manufacturer]);

  const deepest = path[path.length - 1];
  const byCategory = useMemo(
    () =>
      deepest
        ? filterMaterialBoardsByCategory(scoped, deepest, materialCategories)
        : scoped,
    [scoped, deepest, materialCategories],
  );

  const searching = search.trim().length > 0;
  const filtered = useMemo(() => {
    if (!searching) return byCategory;
    const q = normalizeSearchText(search);
    const terms = q.split(' ');
    return byCategory.filter((m) =>
      terms.every((t) => materialHaystack(m, materialCategories).includes(t)),
    );
  }, [byCategory, searching, search, materialCategories]);

  const selectLevel = (level: number, categoryId: string | null): void => {
    setSubgroupPath((current) =>
      categoryId === null
        ? current.slice(0, level)
        : [...current.slice(0, level), categoryId],
    );
  };

  const chipClass = (active: boolean): string =>
    active
      ? 'spatial-studio__filter spatial-studio__filter--on'
      : 'spatial-studio__filter';

  return (
    <section
      className="board-palette spatial-studio__section"
      aria-label="Tableros del taller"
      data-testid="board-material-palette"
    >
      <div className="board-palette__controls">
        <label className="spatial-studio__field" htmlFor="board-palette-scope">
          <span>Aplicar a</span>
          <select
            id="board-palette-scope"
            value={scope}
            disabled={!canEdit}
            onChange={(e) => onScopeChange(e.target.value as BoardApplyScope)}
            data-testid="board-palette-scope"
          >
            {BOARD_APPLY_SCOPES.map((option) => (
              <option
                key={option.id}
                value={option.id}
                disabled={option.id !== 'project' && !hasSelection}
              >
                {option.label}
                {option.id !== 'project' && !hasSelection ? ' (sin selección)' : ''}
              </option>
            ))}
          </select>
        </label>

        <div
          className="board-palette__chips"
          role="group"
          aria-label="Filtrar por fabricante"
        >
          <button
            type="button"
            className={chipClass(manufacturer === null)}
            aria-pressed={manufacturer === null}
            onClick={() => setManufacturer(null)}
            data-testid="board-palette-mfr-all"
          >
            Todos
          </button>
          {manufacturers.map((name) => (
            <button
              key={name}
              type="button"
              className={chipClass(manufacturer === name)}
              aria-pressed={manufacturer === name}
              onClick={() =>
                setManufacturer((current) => (current === name ? null : name))
              }
              data-testid={`board-palette-mfr-${normalizeSearchText(name)
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')}`}
            >
              {name}
            </button>
          ))}
        </div>

        <label className="spatial-studio__hint board-palette__search" htmlFor="board-palette-search">
          Buscar tablero por nombre, código o fabricante
        </label>
        <input
          id="board-palette-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar tablero por nombre, código o fabricante…"
          data-testid="board-palette-search"
        />

        {levelRows.map((row, index) => (
          <div className="board-palette__level" key={index}>
            <span className="board-palette__level-label">
              {cascadeLevelLabel(index)}
            </span>
            <div
              className="board-palette__chips"
              role="group"
              aria-label={`Filtrar por ${cascadeLevelLabel(index).toLowerCase()}`}
            >
              {index === 0 ? (
                <button
                  type="button"
                  className={chipClass(row.selectedId === null)}
                  aria-pressed={row.selectedId === null}
                  onClick={() => selectLevel(0, null)}
                  data-testid="board-palette-level-0-all"
                >
                  Todas
                </button>
              ) : null}
              {row.options.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={chipClass(row.selectedId === category.id)}
                  aria-pressed={row.selectedId === category.id}
                  onClick={() =>
                    selectLevel(
                      index,
                      row.selectedId === category.id ? null : category.id,
                    )
                  }
                  data-testid={`board-palette-chip-${category.id}`}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </div>
        ))}

        <span className="board-palette__count" data-testid="board-palette-count">
          {filtered.length} de {byCategory.length}
        </span>
      </div>

      {status ? (
        <p
          className="spatial-studio__import-msg"
          role="status"
          data-testid="board-palette-status"
        >
          {status}
        </p>
      ) : null}

      <div className="board-palette__results">
        {activeMaterials.length === 0 ? (
          <p className="spatial-studio__hint">
            No hay tableros activos en el catálogo. Agregá materiales desde
            Catálogos → Materiales.
          </p>
        ) : filtered.length === 0 ? (
          <p className="spatial-studio__hint">
            Sin tableros para este fabricante o subgrupo.
          </p>
        ) : (
          <ul className="board-palette__list" data-testid="board-palette-results">
            {filtered.map((material) => {
              const imageUrl =
                resolveMediaUrl?.(material.imageUrl ?? material.previewTextureUrl) ??
                (material.imageUrl ?? material.previewTextureUrl);
              const dims = `${material.thicknessMm} mm`;
              const handleDragStart = (e: DragEvent<HTMLButtonElement>): void => {
                e.dataTransfer.setData(
                  BOARD_PAINT_DRAG_MIME,
                  encodeBoardPaintDrag({ materialId: material.id }),
                );
                e.dataTransfer.effectAllowed = 'copy';
                onCardDragStart?.(material.id);
              };
              return (
                <li key={material.id}>
                  <button
                    type="button"
                    className="board-palette__card"
                    title={
                      canEdit
                        ? 'Click para aplicar al scope elegido; arrastrá sobre un mueble del plano'
                        : material.name
                    }
                    disabled={!canEdit}
                    draggable={canEdit}
                    onDragStart={canEdit ? handleDragStart : undefined}
                    onDragEnd={canEdit ? onCardDragEnd : undefined}
                    onClick={() => onApply(material.id)}
                    data-testid={`board-palette-card-${material.id}`}
                  >
                    <span className="board-palette__thumb" aria-hidden>
                      {imageUrl ? (
                        <img src={imageUrl} alt="" loading="lazy" />
                      ) : material.previewColor ? (
                        <span
                          className="board-palette__swatch"
                          style={{ background: material.previewColor }}
                        />
                      ) : (
                        <span className="board-palette__swatch board-palette__swatch--empty" />
                      )}
                    </span>
                    <span className="board-palette__meta">
                      <span className="board-palette__name">{material.name}</span>
                      <span className="board-palette__code">
                        {materialManufacturer(material)} · {material.code}
                      </span>
                      <span className="board-palette__dims">{dims}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
