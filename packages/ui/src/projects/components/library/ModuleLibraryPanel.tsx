/**
 * ModuleLibraryPanel — biblioteca lateral del catálogo de muebles dentro de
 * Proyectar (F141 / #309, North Star §6). Fuente de inserción sin salir del
 * editor: búsqueda tolerante, colecciones (Favoritos/Recientes) y navegación
 * por categorías en cascada — un renglón de chips por nivel, no todo
 * mezclado en un solo control. El panel no crea ítems: notifica al studio
 * vía onInsert / onCardDragStart y el studio resuelve la inserción atómica.
 */

import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import type { Module, ModuleCategory } from '@granete/domain';
import {
  childrenOf,
  defaultMeasurePresetId,
  filterModulesByCategory,
  resolveModuleMeasurePreset,
  UNCATEGORIZED_FILTER,
} from '@granete/domain';
import { Star } from 'lucide-react';
import { sanitizeCategoryPath } from '../../../common/cascadeLevels';
import { SearchInput } from '../../../common';
import {
  encodeLibraryDrag,
  LIBRARY_DRAG_MIME,
} from '../../../preview3d/paintMaterial';
import { trackUsability } from '../../../preview3d/usabilityBenchmark';
import { searchModules } from './searchModules';
import type { LibraryCollections } from './useLibraryFavorites';
import './moduleLibrary.css';

const NAVIGATION_STORAGE_KEY = 'muebles.proyectar.library.navigation.v1';

type LibraryCollection = 'favorites' | 'recent';

type LibraryScope =
  | { readonly kind: 'catalog' }
  | { readonly kind: 'collection'; readonly collection: LibraryCollection };

type LibraryNavigation = {
  readonly scope: LibraryScope;
  /** Ruta de categorías seleccionadas (ids raíz→hoja). Sólo aplica al catálogo. */
  readonly path: readonly string[];
  readonly search: string;
};

function scopeId(scope: LibraryScope): string {
  if (scope.kind === 'catalog') return 'catalog';
  return `collection:${scope.collection}`;
}

function scopeFromId(value: string): LibraryScope {
  if (value === 'collection:favorites') return { kind: 'collection', collection: 'favorites' };
  if (value === 'collection:recent') return { kind: 'collection', collection: 'recent' };
  return { kind: 'catalog' };
}

const COLLECTION_LABELS: Record<LibraryCollection, string> = {
  favorites: 'Favoritos',
  recent: 'Recientes',
};

function readNavigation(): LibraryNavigation {
  try {
    const raw = globalThis.localStorage?.getItem(NAVIGATION_STORAGE_KEY);
    if (!raw) return { scope: { kind: 'catalog' }, path: [], search: '' };
    const parsed = JSON.parse(raw) as {
      scope?: unknown;
      path?: unknown;
      search?: unknown;
    };
    return {
      scope: typeof parsed.scope === 'string' ? scopeFromId(parsed.scope) : { kind: 'catalog' },
      path: Array.isArray(parsed.path)
        ? parsed.path.filter((id): id is string => typeof id === 'string')
        : [],
      search: typeof parsed.search === 'string' ? parsed.search : '',
    };
  } catch {
    return { scope: { kind: 'catalog' }, path: [], search: '' };
  }
}

/** Dimensiones representativas del módulo (preset default → exterior → 600×720×560). */
export function moduleDefaultDims(mod: Module): {
  width: number;
  height: number;
  depth: number;
} {
  try {
    const preset = resolveModuleMeasurePreset(
      mod,
      defaultMeasurePresetId(mod) || undefined,
    );
    if (preset) {
      return { width: preset.width, height: preset.height, depth: preset.depth };
    }
  } catch {
    /* fall through */
  }
  if (mod.externalDims) {
    return {
      width: mod.externalDims.width,
      height: mod.externalDims.height,
      depth: mod.externalDims.depth,
    };
  }
  return { width: 600, height: 720, depth: 560 };
}

export interface ModuleLibraryPanelProps {
  readonly modules: readonly Module[];
  readonly categories: readonly ModuleCategory[];
  readonly canEdit: boolean;
  readonly resolveMediaUrl?: (url: string | undefined) => string | undefined;
  readonly collections: LibraryCollections;
  readonly onInsert: (moduleId: string) => void;
  readonly onCardDragStart: (
    moduleId: string,
    dims: { readonly width: number; readonly height: number; readonly depth: number },
  ) => void;
  readonly onCardDragEnd: () => void;
}

type LibraryCardProps = {
  readonly mod: Module;
  readonly canEdit: boolean;
  readonly resolveMediaUrl?: (url: string | undefined) => string | undefined;
  readonly isFavorite: boolean;
  readonly onToggleFavorite: (moduleId: string) => void;
  readonly onInsert: (moduleId: string) => void;
  readonly onCardDragStart: ModuleLibraryPanelProps['onCardDragStart'];
  readonly onCardDragEnd: () => void;
};

function LibraryCard({
  mod,
  canEdit,
  resolveMediaUrl,
  isFavorite,
  onToggleFavorite,
  onInsert,
  onCardDragStart,
  onCardDragEnd,
}: LibraryCardProps): ReactNode {
  const dims = moduleDefaultDims(mod);
  const imageUrl = resolveMediaUrl?.(mod.imageUrl) ?? mod.imageUrl;

  const handleDragStart = (e: DragEvent<HTMLButtonElement>): void => {
    const payload = encodeLibraryDrag({
      moduleId: mod.id,
      widthMm: dims.width,
      heightMm: dims.height,
      depthMm: dims.depth,
    });
    e.dataTransfer.setData(LIBRARY_DRAG_MIME, payload);
    e.dataTransfer.effectAllowed = 'copy';
    onCardDragStart(mod.id, dims);
  };

  return (
    <li>
      <div className="module-library__card">
        <button
          type="button"
          className="module-library__pick"
          title={
            canEdit
              ? 'Click para insertar; arrastrá al plano para colocar directamente'
              : mod.name
          }
          draggable={canEdit}
          onDragStart={canEdit ? handleDragStart : undefined}
          onDragEnd={canEdit ? onCardDragEnd : undefined}
          onClick={() => onInsert(mod.id)}
          data-testid={`module-library-card-${mod.id}`}
        >
          <span
            className="module-library__thumb"
            aria-hidden
            data-testid={`module-library-thumb-${mod.id}`}
          >
            {imageUrl ? (
              <img src={imageUrl} alt="" loading="lazy" />
            ) : (
              <span
                className="module-library__silhouette"
                style={{ aspectRatio: `${dims.width} / ${dims.height}` }}
              />
            )}
          </span>
          <span className="module-library__meta">
            <span className="module-library__name">{mod.name}</span>
            <span className="module-library__code">{mod.code}</span>
            <span className="module-library__dims">
              {dims.width} × {dims.height} × {dims.depth} mm
            </span>
          </span>
        </button>
        <button
          type="button"
          className={
            isFavorite
              ? 'btn btn--icon btn--small module-library__fav module-library__fav--on'
              : 'btn btn--icon btn--small module-library__fav'
          }
          onClick={() => onToggleFavorite(mod.id)}
          aria-pressed={isFavorite}
          aria-label={
            isFavorite
              ? `Quitar ${mod.name} de favoritos`
              : `Agregar ${mod.name} a favoritos`
          }
          title={isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
          data-testid={`module-library-fav-${mod.id}`}
        >
          <Star
            size={14}
            strokeWidth={1.5}
            fill={isFavorite ? 'currentColor' : 'none'}
            aria-hidden
          />
        </button>
      </div>
    </li>
  );
}

export function ModuleLibraryPanel({
  modules,
  categories,
  canEdit,
  resolveMediaUrl,
  collections,
  onInsert,
  onCardDragStart,
  onCardDragEnd,
}: ModuleLibraryPanelProps): ReactNode {
  const [navigation, setNavigation] = useState<LibraryNavigation>(readNavigation);
  const { search, scope } = navigation;

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(
        NAVIGATION_STORAGE_KEY,
        JSON.stringify({
          scope: scopeId(scope),
          path: navigation.path,
          search,
        }),
      );
    } catch {
      // Storage bloqueado o lleno: la navegación conserva el estado en memoria.
    }
  }, [scope, navigation.path, search]);

  const byId = useMemo(
    () => new Map(modules.map((m) => [m.id, m])),
    [modules],
  );
  const collectionModules = (ids: readonly string[]): Module[] => {
    const found: Module[] = [];
    for (const id of ids) {
      const mod = byId.get(id);
      if (mod) found.push(mod);
    }
    return found;
  };
  const favoriteModules = useMemo(
    () => collectionModules(collections.favorites),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collections.favorites, byId],
  );
  const recentModules = useMemo(
    () => collectionModules(collections.recent),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collections.recent, byId],
  );

  /**
   * Ruta sanitizada: descarta ids que dejaron de existir o que ya no cuelgan
   * del nivel anterior (categorías renombradas/re-migradas del catálogo).
   */
  const path = useMemo(() => {
    if (navigation.path.length === 1 && navigation.path[0] === UNCATEGORIZED_FILTER) {
      return navigation.path;
    }
    return sanitizeCategoryPath(categories, navigation.path);
  }, [navigation.path, categories]);

  const selectedL1Id = path[0] ?? '';
  const selectedL2Id = path[1] ?? '';
  const selectedL3Id = path[2] ?? '';

  // Level 1 options (roots)
  const l1Nodes = useMemo(() => childrenOf(categories, undefined), [categories]);

  // Level 2 options (children of selected L1)
  const l2Nodes = useMemo(
    () =>
      selectedL1Id && selectedL1Id !== UNCATEGORIZED_FILTER
        ? childrenOf(categories, selectedL1Id)
        : [],
    [categories, selectedL1Id],
  );

  // Level 3 options (children of selected L2)
  const l3Nodes = useMemo(
    () => (selectedL2Id ? childrenOf(categories, selectedL2Id) : []),
    [categories, selectedL2Id],
  );

  // Count uncategorized
  const uncategorizedCount = useMemo(
    () => filterModulesByCategory(modules, UNCATEGORIZED_FILTER, categories).length,
    [modules, categories],
  );

  // Active filter ID (L3 > L2 > L1 > null)
  const effectiveFilterId = useMemo(() => {
    if (selectedL1Id === UNCATEGORIZED_FILTER) return UNCATEGORIZED_FILTER;
    if (selectedL3Id) return selectedL3Id;
    if (selectedL2Id) return selectedL2Id;
    if (selectedL1Id) return selectedL1Id;
    return null;
  }, [selectedL1Id, selectedL2Id, selectedL3Id]);

  const handleL1Change = (val: string): void => {
    setNavigation((current) => ({
      ...current,
      path: val ? [val] : [],
    }));
  };

  const handleL2Change = (val: string): void => {
    setNavigation((current) => ({
      ...current,
      path: val ? [selectedL1Id, val] : [selectedL1Id],
    }));
  };

  const handleL3Change = (val: string): void => {
    setNavigation((current) => ({
      ...current,
      path: val ? [selectedL1Id, selectedL2Id, val] : [selectedL1Id, selectedL2Id],
    }));
  };

  const selectScope = (next: LibraryScope): void => {
    setNavigation((current) => ({ ...current, scope: next }));
  };

  const scopedModules = useMemo(() => {
    if (scope.kind === 'collection') {
      if (scope.collection === 'favorites') return favoriteModules;
      return recentModules;
    }
    return effectiveFilterId !== null
      ? filterModulesByCategory(modules, effectiveFilterId, categories)
      : modules;
  }, [scope, effectiveFilterId, modules, categories, favoriteModules, recentModules]);

  const filtered = useMemo(
    () => searchModules(scopedModules, search, categories),
    [scopedModules, search, categories],
  );

  const searchAriaLabel =
    scope.kind === 'collection'
      ? `Buscar en ${COLLECTION_LABELS[scope.collection]}`
      : 'Buscar muebles en la biblioteca';
  const searchPlaceholder =
    scope.kind === 'collection'
      ? `Buscar en ${COLLECTION_LABELS[scope.collection]}…`
      : 'Buscar mueble por nombre, código o categoría…';

  const clearFilters = (): void => {
    setNavigation({ scope: { kind: 'catalog' }, path: [], search: '' });
  };

  const renderCard = (mod: Module): ReactNode => (
    <LibraryCard
      key={mod.id}
      mod={mod}
      canEdit={canEdit}
      resolveMediaUrl={resolveMediaUrl}
      isFavorite={collections.isFavorite(mod.id)}
      onToggleFavorite={collections.toggleFavorite}
      onInsert={onInsert}
      onCardDragStart={onCardDragStart}
      onCardDragEnd={onCardDragEnd}
    />
  );

  const chipClass = (active: boolean): string =>
    active
      ? 'spatial-studio__filter spatial-studio__filter--on'
      : 'spatial-studio__filter';

  return (
    <section
      className="module-library spatial-studio__section"
      aria-label="Biblioteca de muebles"
      data-testid="module-library"
    >
      <div className="module-library__controls">
        <div
          className="module-library__chips"
          role="group"
          aria-label="Colecciones de la biblioteca"
        >
          <button
            type="button"
            className={chipClass(scope.kind === 'catalog')}
            aria-pressed={scope.kind === 'catalog'}
            onClick={() => selectScope({ kind: 'catalog' })}
            data-testid="module-library-scope-catalog"
          >
            Catálogo
          </button>
          {(Object.keys(COLLECTION_LABELS) as LibraryCollection[]).map((collection) => (
            <button
              key={collection}
              type="button"
              className={chipClass(
                scope.kind === 'collection' && scope.collection === collection,
              )}
              aria-pressed={
                scope.kind === 'collection' && scope.collection === collection
              }
              onClick={() => selectScope({ kind: 'collection', collection })}
              data-testid={`module-library-scope-${collection}`}
            >
              {COLLECTION_LABELS[collection]}
            </button>
          ))}
        </div>

        {/* Cascading Category Comboboxes */}
        {categories.length > 0 && scope.kind === 'catalog' ? (
          <div className="module-library__filters-box">
            {/* L1 Category Combobox */}
            <div className="module-library__filter-row">
              <select
                className="select select--sm module-library__select"
                value={selectedL1Id}
                onChange={(e) => handleL1Change(e.target.value)}
                aria-label="Categoría principal"
                data-testid="module-library-select-l1"
              >
                <option value="">Todas las categorías ({modules.length})</option>
                {l1Nodes.map((cat) => {
                  const count = filterModulesByCategory(modules, cat.id, categories).length;
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
              <div className="module-library__filter-row">
                <select
                  className="select select--sm module-library__select"
                  value={selectedL2Id}
                  onChange={(e) => handleL2Change(e.target.value)}
                  aria-label="Subcategoría nivel 2"
                  data-testid="module-library-select-l2"
                >
                  <option value="">Todas las subcategorías</option>
                  {l2Nodes.map((sub) => {
                    const count = filterModulesByCategory(modules, sub.id, categories).length;
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
              <div className="module-library__filter-row">
                <select
                  className="select select--sm module-library__select"
                  value={selectedL3Id}
                  onChange={(e) => handleL3Change(e.target.value)}
                  aria-label="Subcategoría nivel 3"
                  data-testid="module-library-select-l3"
                >
                  <option value="">Todas</option>
                  {l3Nodes.map((sub3) => {
                    const count = filterModulesByCategory(modules, sub3.id, categories).length;
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

        <SearchInput
          value={search}
          onChange={(value) => {
            setNavigation((current) => ({ ...current, search: value }));
            trackUsability('library_search', { query: value.slice(0, 80) });
          }}
          placeholder={searchPlaceholder}
          aria-label={searchAriaLabel}
        />
        <span
          className="module-library__count"
          data-testid="module-library-result-count"
        >
          {filtered.length} de {scopedModules.length}
        </span>
      </div>

      <div className="module-library__results">
        {modules.length === 0 ? (
          <p className="spatial-studio__hint">
            No hay muebles en el catálogo. Agregá muebles desde Librería →
            Muebles.
          </p>
        ) : filtered.length === 0 ? (
          <div className="module-library__empty">
            <p className="spatial-studio__hint">
              No hay muebles que coincidan con este alcance.
            </p>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={clearFilters}
            >
              Ver todo el catálogo
            </button>
          </div>
        ) : (
          <ul className="module-library__list" data-testid="module-library-results">
            {filtered.map(renderCard)}
          </ul>
        )}
      </div>
    </section>
  );
}
