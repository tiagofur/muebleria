/**
 * 3-level category tree (sidebar filter with counts) and the manage-modal
 * rows (edit/delete per category) for the ambient catalog.
 */

import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { AmbientCategory } from '@granete/domain';
import { childrenOf } from '@granete/domain';
import { Pencil, Trash2 } from 'lucide-react';

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
        return (
          <li key={node.id}>
            <button
              type="button"
              className={
                active
                  ? 'module-category-tree__item module-category-tree__item--active'
                  : 'module-category-tree__item'
              }
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
            <CategoryTree
              categories={categories}
              parentId={node.id}
              depth={depth + 1}
              categoryFilter={categoryFilter}
              setCategoryFilter={setCategoryFilter}
              counts={counts}
            />
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
