/**
 * ModuleLibraryPanel — biblioteca lateral del catálogo de muebles dentro de
 * Proyectar (F141 / #309, North Star §6). Fuente de inserción sin salir del
 * editor: búsqueda tolerante, categorías jerárquicas (chips L1/L2 +
 * breadcrumb), Favoritos/Recientes/Mi taller y thumbnails con silueta
 * paramétrica de fallback. El panel no crea ítems: notifica al studio vía
 * onInsert / onCardDragStart y el studio resuelve la inserción atómica.
 */

import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import type { Module, ModuleCategory } from '@muebles/domain';
import {
  categoryPath,
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
  const [search, setSearch] = useState('');
  const [selectedL1Id, setSelectedL1Id] = useState('');
  const [selectedL2Id, setSelectedL2Id] = useState('');

  const l1Nodes = useMemo(
    () => childrenOf(categories, undefined),
    [categories],
  );
  const l2Nodes = useMemo(
    () =>
      selectedL1Id ? childrenOf(categories, selectedL1Id) : [],
    [categories, selectedL1Id],
  );
  const effectiveFilterId = selectedL2Id || selectedL1Id || null;

  const searching = search.trim().length > 0;
  const filtered = useMemo(() => {
    let list = modules;
    if (!searching && effectiveFilterId !== null) {
      list = filterModulesByCategory(list, effectiveFilterId, categories);
    }
    if (searching) {
      list = searchModules(list, search, categories);
    }
    return list;
  }, [modules, categories, searching, search, effectiveFilterId]);

  const breadcrumb = useMemo(() => {
    if (effectiveFilterId === null) return null;
    const path = categoryPath(effectiveFilterId, categories);
    return path.length > 0 ? path.map((c) => c.name).join(' › ') : null;
  }, [effectiveFilterId, categories]);

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

  const groupedCatalog = useMemo(() => {
    if (searching || effectiveFilterId !== null) return null;
    const groupsMap = new Map<
      string,
      { title: string; items: Module[] }
    >();
    const uncategorized: Module[] = [];
    for (const m of filtered) {
      if (!m.categoryId) {
        uncategorized.push(m);
        continue;
      }
      const path = categoryPath(m.categoryId, categories);
      const title =
        path.length > 0 ? path.map((c) => c.name).join(' › ') : 'Sin categoría';
      const existing = groupsMap.get(title);
      if (existing) {
        existing.items.push(m);
      } else {
        groupsMap.set(title, { title, items: [m] });
      }
    }
    const groups = Array.from(groupsMap.values());
    if (uncategorized.length > 0) {
      groups.push({ title: 'Sin categoría', items: uncategorized });
    }
    return groups;
  }, [filtered, categories, searching, effectiveFilterId]);

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
      <h3 className="spatial-studio__section-title">
        Biblioteca ({modules.length})
      </h3>
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Buscar mueble por nombre, código o categoría…"
        aria-label="Buscar muebles en la biblioteca"
      />
      {categories.length > 0 && !searching ? (
        <div
          className="module-library__chips"
          role="group"
          aria-label="Categorías de la biblioteca"
        >
          <button
            type="button"
            className={
              effectiveFilterId === null
                ? 'spatial-studio__filter spatial-studio__filter--on'
                : 'spatial-studio__filter'
            }
            aria-pressed={effectiveFilterId === null}
            onClick={() => {
              setSelectedL1Id('');
              setSelectedL2Id('');
            }}
            data-testid="module-library-chip-all"
          >
            Todas
          </button>
          {l1Nodes.map((c) => (
            <button
              key={c.id}
              type="button"
              className={
                selectedL1Id === c.id
                  ? 'spatial-studio__filter spatial-studio__filter--on'
                  : 'spatial-studio__filter'
              }
              aria-pressed={selectedL1Id === c.id}
              onClick={() => {
                setSelectedL1Id(c.id);
                setSelectedL2Id('');
              }}
              data-testid={`module-library-chip-${c.id}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      ) : null}
      {l2Nodes.length > 0 && !searching ? (
        <div
          className="module-library__chips module-library__chips--sub"
          role="group"
          aria-label="Subcategorías"
        >
          {l2Nodes.map((c) => (
            <button
              key={c.id}
              type="button"
              className={
                selectedL2Id === c.id
                  ? 'spatial-studio__filter spatial-studio__filter--on'
                  : 'spatial-studio__filter'
              }
              aria-pressed={selectedL2Id === c.id}
              onClick={() => setSelectedL2Id(c.id)}
              data-testid={`module-library-chip-${c.id}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      ) : null}
      {breadcrumb ? (
        <p className="module-library__breadcrumb" data-testid="module-library-breadcrumb">
          {breadcrumb}
        </p>
      ) : null}

      <div className="module-library__results">
        {modules.length === 0 ? (
          <p className="spatial-studio__hint">
            No hay muebles en el catálogo. Agregá muebles desde Librería →
            Muebles.
          </p>
        ) : filtered.length === 0 ? (
          <p className="spatial-studio__hint">
            Sin resultados para esta búsqueda o categoría.
          </p>
        ) : groupedCatalog ? (
          <>
            {!searching && workshopModules.length > 0 ? (
              <div className="module-library__group">
                <h4 className="module-library__group-title">Mi taller</h4>
                {renderList(workshopModules, 'module-library-workshop')}
              </div>
            ) : null}
            {!searching && favoriteModules.length > 0 ? (
              <div className="module-library__group">
                <h4 className="module-library__group-title">Favoritos</h4>
                {renderList(favoriteModules, 'module-library-favorites')}
              </div>
            ) : null}
            {!searching && recentModules.length > 0 ? (
              <div className="module-library__group">
                <h4 className="module-library__group-title">Recientes</h4>
                {renderList(recentModules, 'module-library-recent')}
              </div>
            ) : null}
            {groupedCatalog.map((group) => (
              <div
                key={group.title}
                className="module-library__group"
                data-testid={`module-library-group-${group.title}`}
              >
                <h4 className="module-library__group-title">
                  {group.title} ({group.items.length})
                </h4>
                {renderList(group.items, `module-library-list-${group.title}`)}
              </div>
            ))}
          </>
        ) : (
          renderList(filtered, 'module-library-results')
        )}
      </div>
    </section>
  );
}
