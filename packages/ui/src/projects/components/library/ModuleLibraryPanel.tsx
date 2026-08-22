/**
 * ModuleLibraryPanel — biblioteca lateral del catálogo de muebles dentro de
 * Proyectar (F141 / #309, North Star §6). Fuente de inserción sin salir del
 * editor: búsqueda tolerante, scopes jerárquicos compactos con breadcrumb,
 * Favoritos/Recientes/Mi taller y thumbnails con silueta
 * paramétrica de fallback. El panel no crea ítems: notifica al studio vía
 * onInsert / onCardDragStart y el studio resuelve la inserción atómica.
 */

import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import type { Module, ModuleCategory } from '@muebles/domain';
import {
  categoryPath,
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

type LibraryScope =
  | { readonly kind: 'catalog' }
  | {
      readonly kind: 'collection';
      readonly collection: 'workshop' | 'favorites' | 'recent';
    }
  | { readonly kind: 'category'; readonly categoryId: string };

function scopeId(scope: LibraryScope): string {
  if (scope.kind === 'catalog') return 'catalog';
  if (scope.kind === 'collection') return `collection:${scope.collection}`;
  return `category:${scope.categoryId}`;
}

function scopeFromId(value: string): LibraryScope {
  if (value === 'collection:workshop') return { kind: 'collection', collection: 'workshop' };
  if (value === 'collection:favorites') return { kind: 'collection', collection: 'favorites' };
  if (value === 'collection:recent') return { kind: 'collection', collection: 'recent' };
  if (value.startsWith('category:')) return { kind: 'category', categoryId: value.slice('category:'.length) };
  return { kind: 'catalog' };
}

function readNavigation(): { readonly scope: LibraryScope; readonly search: string } {
  try {
    const raw = globalThis.localStorage?.getItem(NAVIGATION_STORAGE_KEY);
    if (!raw) return { scope: { kind: 'catalog' }, search: '' };
    const parsed = JSON.parse(raw) as { scope?: unknown; search?: unknown };
    return {
      scope: typeof parsed.scope === 'string' ? scopeFromId(parsed.scope) : { kind: 'catalog' },
      search: typeof parsed.search === 'string' ? parsed.search : '',
    };
  } catch {
    return { scope: { kind: 'catalog' }, search: '' };
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
  const [navigation, setNavigation] = useState(readNavigation);
  const { search, scope } = navigation;

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(
        NAVIGATION_STORAGE_KEY,
        JSON.stringify({ scope: scopeId(scope), search }),
      );
    } catch {
      // Storage bloqueado o lleno: la navegación conserva el estado en memoria.
    }
  }, [scope, search]);

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

  const scopeOptions = useMemo(() => {
    const categoryOptions = categories.map((category) => ({
      value: `category:${category.id}`,
      label: categoryPath(category.id, categories)
        .map((node) => node.name)
        .join(' › '),
    }));
    return [
      { value: 'catalog', label: 'Catálogo · Todos los muebles' },
      { value: 'collection:workshop', label: 'En proyecto · Mi taller' },
      { value: 'collection:favorites', label: 'En proyecto · Favoritos' },
      { value: 'collection:recent', label: 'En proyecto · Recientes' },
      ...categoryOptions,
    ];
  }, [categories]);

  const scopeLabel = useMemo(() => {
    if (scope.kind === 'catalog') return 'Catálogo · Todos los muebles';
    if (scope.kind === 'collection') {
      return scope.collection === 'workshop'
        ? 'En proyecto · Mi taller'
        : scope.collection === 'favorites'
          ? 'En proyecto · Favoritos'
          : 'En proyecto · Recientes';
    }
    return categoryPath(scope.categoryId, categories)
      .map((category) => category.name)
      .join(' › ');
  }, [scope, categories]);

  const scopedModules = useMemo(() => {
    if (scope.kind === 'catalog') return modules;
    if (scope.kind === 'category') {
      return filterModulesByCategory(modules, scope.categoryId, categories);
    }
    if (scope.collection === 'workshop') return workshopModules;
    if (scope.collection === 'favorites') return favoriteModules;
    return recentModules;
  }, [scope, modules, categories, workshopModules, favoriteModules, recentModules]);

  const filtered = useMemo(
    () => searchModules(scopedModules, search, categories),
    [scopedModules, search, categories],
  );

  const clearFilters = (): void => {
    setNavigation({ scope: { kind: 'catalog' }, search: '' });
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

  const renderList = (
    items: readonly Module[],
    listTestId: string,
  ): ReactNode => (
    <ul className="module-library__list" data-testid={listTestId}>
      {items.map(renderCard)}
    </ul>
  );

  return (
    <section
      className="module-library spatial-studio__section"
      aria-label="Biblioteca de muebles"
      data-testid="module-library"
    >
      <div className="module-library__controls">
        <div className="module-library__heading">
          <h3 className="spatial-studio__section-title">Catálogo</h3>
          <span className="module-library__count" data-testid="module-library-result-count">
            {filtered.length} de {scopedModules.length}
          </span>
        </div>
        <label className="module-library__scope-label" htmlFor="module-library-scope">
          Alcance
        </label>
        <select
          id="module-library-scope"
          className="module-library__scope"
          value={scopeId(scope)}
          onChange={(event) =>
            setNavigation((current) => ({
              ...current,
              scope: scopeFromId(event.target.value),
            }))
          }
          data-testid="module-library-scope"
        >
          {scopeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <SearchInput
          value={search}
          onChange={(value) =>
            setNavigation((current) => ({ ...current, search: value }))
          }
          placeholder="Buscar en este alcance…"
          aria-label="Buscar muebles en el alcance actual"
        />
        <p className="module-library__breadcrumb" data-testid="module-library-breadcrumb">
          {scopeLabel}
        </p>
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
          renderList(filtered, 'module-library-results')
        )}
      </div>
    </section>
  );
}
