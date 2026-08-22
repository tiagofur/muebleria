/**
 * ModuleLibraryPanel — biblioteca lateral del catálogo de muebles dentro de
 * Proyectar (F141 / #309, North Star §6). Fuente de inserción sin salir del
 * editor: búsqueda tolerante, colecciones (Favoritos/Recientes/Mi taller) y
 * navegación por categorías en cascada — un renglón de chips por nivel, no
 * todo mezclado en un solo control. El panel no crea ítems: notifica al
 * studio vía onInsert / onCardDragStart y el studio resuelve la inserción
 * atómica.
 */

import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import type { Module, ModuleCategory } from '@muebles/domain';
import {
  childrenOf,
  defaultMeasurePresetId,
  filterModulesByCategory,
  resolveModuleMeasurePreset,
} from '@muebles/domain';
import { Star } from 'lucide-react';
import { SearchInput } from '../../../common';
import {
  encodeLibraryDrag,
  LIBRARY_DRAG_MIME,
} from '../../../preview3d/paintMaterial';
import { searchModules } from './searchModules';
import type { LibraryCollections } from './useLibraryFavorites';
import './moduleLibrary.css';

const NAVIGATION_STORAGE_KEY = 'muebles.proyectar.library.navigation.v1';

type LibraryCollection = 'workshop' | 'favorites' | 'recent';

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
  if (value === 'collection:workshop') return { kind: 'collection', collection: 'workshop' };
  if (value === 'collection:favorites') return { kind: 'collection', collection: 'favorites' };
  if (value === 'collection:recent') return { kind: 'collection', collection: 'recent' };
  return { kind: 'catalog' };
}

const COLLECTION_LABELS: Record<LibraryCollection, string> = {
  workshop: 'Mi taller',
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
          <Star size={14} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
    </li>
  );
}

function levelLabel(index: number): string {
  if (index === 0) return 'Categoría';
  if (index === 1) return 'Subcategoría';
  return `Nivel ${index + 1}`;
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
  const workshopModules = useMemo(
    () => collectionModules(collections.workshop),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collections.workshop, byId],
  );
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
    const valid: string[] = [];
    let parent: string | undefined;
    for (const id of navigation.path) {
      const exists = categories.some(
        (c) => c.id === id && (c.parentId ?? undefined) === parent,
      );
      if (!exists) break;
      valid.push(id);
      parent = id;
    }
    return valid;
  }, [navigation.path, categories]);

  /**
   * Renglones de niveles de la cascada: uno por nivel seleccionado + el
   * siguiente nivel disponible (sólo si tiene hijos). Cada nivel es su
   * propio renglón de chips — nunca todo mezclado en un control.
   */
  const levelRows = useMemo(() => {
    if (scope.kind !== 'catalog' || categories.length === 0) return [];
    const rows: {
      readonly options: readonly ModuleCategory[];
      readonly selectedId: string | null;
    }[] = [];
    let parent: string | undefined;
    for (const selectedId of path) {
      rows.push({
        options: childrenOf(categories, parent),
        selectedId,
      });
      parent = selectedId;
    }
    const next = childrenOf(categories, parent);
    if (next.length > 0) {
      rows.push({ options: next, selectedId: null });
    }
    return rows;
  }, [scope, path, categories]);

  const selectScope = (next: LibraryScope): void => {
    setNavigation((current) => ({ ...current, scope: next }));
  };

  const selectLevel = (level: number, categoryId: string | null): void => {
    setNavigation((current) => ({
      ...current,
      path: categoryId === null ? current.path.slice(0, level) : [...current.path.slice(0, level), categoryId],
    }));
  };

  const scopedModules = useMemo(() => {
    if (scope.kind === 'collection') {
      if (scope.collection === 'workshop') return workshopModules;
      if (scope.collection === 'favorites') return favoriteModules;
      return recentModules;
    }
    const deepest = path[path.length - 1];
    return deepest
      ? filterModulesByCategory(modules, deepest, categories)
      : modules;
  }, [scope, path, modules, categories, workshopModules, favoriteModules, recentModules]);

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
        <SearchInput
          value={search}
          onChange={(value) =>
            setNavigation((current) => ({ ...current, search: value }))
          }
          placeholder={searchPlaceholder}
          aria-label={searchAriaLabel}
        />
        {levelRows.map((row, index) => (
          <div className="module-library__level" key={index}>
            <span className="module-library__level-label">{levelLabel(index)}</span>
            <div
              className="module-library__chips"
              role="group"
              aria-label={`Filtrar por ${levelLabel(index).toLowerCase()}`}
            >
              {index === 0 ? (
                <button
                  type="button"
                  className={chipClass(row.selectedId === null)}
                  aria-pressed={row.selectedId === null}
                  onClick={() => selectLevel(0, null)}
                  data-testid="module-library-level-0-all"
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
                  data-testid={`module-library-chip-${category.id}`}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </div>
        ))}
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
