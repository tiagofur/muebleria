/**
 * 3-level category tree (sidebar filter with counts) and the manage-modal
 * rows (edit/delete per category) for the ambient catalog.
 */

import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useState,
} from 'react';
import type { AmbientCategory } from '@granete/domain';
import { childrenOf } from '@granete/domain';
import { ChevronRight, Pencil, Trash2 } from 'lucide-react';

export function CategoryTree({
  categories,
  parentId,
  depth,
  categoryFilter,
  setCategoryFilter,
  counts,
}: {
  readonly categories: readonly AmbientCategory[];
  readonly parentId: string | undefined;
  readonly depth: number;
  readonly categoryFilter: string | null;
  readonly setCategoryFilter: Dispatch<SetStateAction<string | null>>;
  readonly counts: ReadonlyMap<string, number>;
}): ReactNode {
  // #1643: colapso local por nodo (expandido por defecto; estado de sesión,
  // no persistido). La raíz es dueña del estado; la recursión lo recibe.
  const [collapsedIds, setCollapsedIds] = useState<readonly string[]>([]);
  const toggleCollapsed = (id: string): void =>
    setCollapsedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  return (
    <CategoryTreeNodes
      categories={categories}
      parentId={parentId}
      depth={depth}
      categoryFilter={categoryFilter}
      setCategoryFilter={setCategoryFilter}
      counts={counts}
      collapsedIds={collapsedIds}
      onToggleCollapsed={toggleCollapsed}
    />
  );
}

function CategoryTreeNodes({
  categories,
  parentId,
  depth,
  categoryFilter,
  setCategoryFilter,
  counts,
  collapsedIds,
  onToggleCollapsed,
}: {
  readonly categories: readonly AmbientCategory[];
  readonly parentId: string | undefined;
  readonly depth: number;
  readonly categoryFilter: string | null;
  readonly setCategoryFilter: Dispatch<SetStateAction<string | null>>;
  readonly counts: ReadonlyMap<string, number>;
  readonly collapsedIds: readonly string[];
  readonly onToggleCollapsed: (id: string) => void;
}): ReactNode {
  const nodes = childrenOf(categories, parentId);
  if (nodes.length === 0) return null;
  return (
    <ul
      className={
        depth === 0
          ? 'module-category-tree__list'
          : 'module-category-tree__list module-category-tree__list--nested'
      }
    >
      {nodes.map((node) => {
        const active = categoryFilter === node.id;
        const count = counts.get(node.id) ?? 0;
        const hasChildren = childrenOf(categories, node.id).length > 0;
        const collapsed = collapsedIds.includes(node.id);
        const itemClass = [
          'module-category-tree__item',
          active ? 'module-category-tree__item--active' : '',
          count === 0 ? 'module-category-tree__item--empty' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <li key={node.id}>
            <div className="module-category-tree__row">
              {hasChildren ? (
                <button
                  type="button"
                  className={
                    collapsed
                      ? 'module-category-tree__caret'
                      : 'module-category-tree__caret module-category-tree__caret--open'
                  }
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? `Expandir ${node.name}` : `Contraer ${node.name}`}
                  onClick={() => onToggleCollapsed(node.id)}
                  data-testid={`category-caret-${node.id}`}
                >
                  <ChevronRight size={12} strokeWidth={1.5} aria-hidden />
                </button>
              ) : null}
              <button
                type="button"
                className={itemClass}
                onClick={() =>
                  setCategoryFilter((prev) => (prev === node.id ? null : node.id))
                }
                data-testid={`category-filter-${node.id}`}
              >
                <span className="module-category-tree__label">{node.name}</span>
                <span
                  className="module-category-tree__count"
                  data-testid={`category-filter-count-${node.id}`}
                >
                  {count}
                </span>
              </button>
            </div>
            {!collapsed ? (
              <CategoryTreeNodes
                categories={categories}
                parentId={node.id}
                depth={depth + 1}
                categoryFilter={categoryFilter}
                setCategoryFilter={setCategoryFilter}
                counts={counts}
                collapsedIds={collapsedIds}
                onToggleCollapsed={onToggleCollapsed}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function ManageCategoryRows({
  categories,
  parentId,
  depth,
  onEdit,
  onDelete,
  canDelete,
}: {
  readonly categories: readonly AmbientCategory[];
  readonly parentId: string | undefined;
  readonly depth: number;
  readonly onEdit: (cat: AmbientCategory) => void;
  readonly onDelete: (id: string) => void;
  readonly canDelete: boolean;
}): ReactNode {
  const nodes = childrenOf(categories, parentId);
  if (nodes.length === 0) return null;
  return (
    <ul
      className={
        depth === 0
          ? 'module-category-manage__list'
          : 'module-category-manage__list module-category-manage__list--nested'
      }
      data-testid={depth === 0 ? 'manage-categories-list' : undefined}
    >
      {nodes.map((node) => (
        <li key={node.id}>
          <div className="module-category-manage__row">
            <div className="module-category-manage__row-main">
              <span className="module-category-manage__name">{node.name}</span>
              <span className="module-category-manage__meta">
                Nivel {depth + 1}
              </span>
            </div>
            <span className="module-category-manage__actions">
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => onEdit(node)}
                aria-label={`Editar ${node.name}`}
                data-testid={`manage-category-edit-${node.id}`}
              >
                <Pencil size={14} strokeWidth={1.5} />
              </button>
              {canDelete ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--small btn--danger"
                  onClick={() => onDelete(node.id)}
                  aria-label={`Eliminar ${node.name}`}
                  data-testid={`manage-category-delete-${node.id}`}
                >
                  <Trash2 size={14} strokeWidth={1.5} />
                </button>
              ) : null}
            </span>
          </div>
          <ManageCategoryRows
            categories={categories}
            parentId={node.id}
            depth={depth + 1}
            onEdit={onEdit}
            onDelete={onDelete}
            canDelete={canDelete}
          />
        </li>
      ))}
    </ul>
  );
}
