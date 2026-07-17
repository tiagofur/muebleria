/**
 * Category manage + create/edit + delete confirmation modals.
 */

import type { FormEvent, ReactNode } from 'react';
import type { ModuleCategory } from '@muebles/domain';
import { childrenOf } from '@muebles/domain';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../../common';
import type { CategoryDraft } from '../moduleHelpers';

export type FlatCategoryRow = {
  readonly id: string;
  readonly label: string;
  readonly depth: number;
};

export type ModuleCategoryModalsProps = {
  readonly categories: readonly ModuleCategory[];
  readonly flatCategories: readonly FlatCategoryRow[];
  readonly manageOpen: boolean;
  readonly onCloseManage: () => void;
  readonly onOpenCreate: () => void;
  readonly formOpen: boolean;
  readonly onCloseForm: () => void;
  readonly categoryFormId: string;
  readonly editingCategoryId: string | null;
  readonly categoryDraft: CategoryDraft;
  readonly setCategoryDraft: (draft: CategoryDraft) => void;
  readonly categoryError: string | null;
  readonly onSubmitForm: (e: FormEvent) => void;
  readonly onEditCategory: (cat: ModuleCategory) => void;
  readonly onRequestDeleteCategory: (id: string) => void;
  readonly onCreateCategory?: (draft: CategoryDraft) => void;
  readonly onDeleteCategory?: (id: string) => void;
  readonly deleteTarget: ModuleCategory | null;
  readonly confirmDeleteCategoryId: string | null;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: () => void;
};

function ManageCategoryRows({
  categories,
  parentId,
  depth,
  onEdit,
  onDelete,
  canDelete,
}: {
  readonly categories: readonly ModuleCategory[];
  readonly parentId: string | undefined;
  readonly depth: number;
  readonly onEdit: (cat: ModuleCategory) => void;
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
                  className="btn btn--ghost btn--small"
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

export function ModuleCategoryModals({
  categories,
  flatCategories,
  manageOpen,
  onCloseManage,
  onOpenCreate,
  formOpen,
  onCloseForm,
  categoryFormId,
  editingCategoryId,
  categoryDraft,
  setCategoryDraft,
  categoryError,
  onSubmitForm,
  onEditCategory,
  onRequestDeleteCategory,
  onCreateCategory,
  onDeleteCategory,
  deleteTarget,
  confirmDeleteCategoryId: _confirmDeleteCategoryId,
  onCancelDelete,
  onConfirmDelete,
}: ModuleCategoryModalsProps): ReactNode {
  return (
    <>
      <Modal
        open={manageOpen}
        onClose={onCloseManage}
        title="Gestionar categorías"
        size="md"
        footer={
          <>
            <button type="button" className="btn" onClick={onCloseManage}>
              Cerrar
            </button>
            {onCreateCategory ? (
              <button
                type="button"
                className="btn btn--primary"
                onClick={onOpenCreate}
                data-testid="manage-categories-new"
              >
                <Plus size={16} strokeWidth={1.5} aria-hidden />
                Nueva categoría
              </button>
            ) : null}
          </>
        }
      >
        <div
          className="module-category-manage"
          data-testid="manage-categories-modal"
        >
          <p className="module-category-manage__hint">
            Organizá la jerarquía de muebles (hasta 3 niveles). El panel lateral
            solo filtra la lista.
          </p>
          {categories.length === 0 ? (
            <p className="module-category-manage__empty">
              Todavía no hay categorías. Creá la primera con «Nueva categoría».
            </p>
          ) : (
            <ManageCategoryRows
              categories={categories}
              parentId={undefined}
              depth={0}
              onEdit={onEditCategory}
              onDelete={onRequestDeleteCategory}
              canDelete={Boolean(onDeleteCategory)}
            />
          )}
        </div>
      </Modal>

      <Modal
        open={formOpen}
        onClose={onCloseForm}
        title={editingCategoryId ? 'Editar categoría' : 'Nueva categoría'}
        size="sm"
        footer={
          <>
            <button type="button" className="btn" onClick={onCloseForm}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              form={categoryFormId}
            >
              Guardar
            </button>
          </>
        }
      >
        <form
          id={categoryFormId}
          className="catalog-form"
          onSubmit={onSubmitForm}
        >
          {categoryError ? (
            <p className="catalog-form__error">{categoryError}</p>
          ) : null}
          <div className="catalog-form__field">
            <label htmlFor="cat-name">Nombre</label>
            <input
              id="cat-name"
              value={categoryDraft.name}
              onChange={(e) =>
                setCategoryDraft({ ...categoryDraft, name: e.target.value })
              }
              required
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="cat-parent">Padre (opcional)</label>
            <select
              id="cat-parent"
              value={categoryDraft.parentId}
              onChange={(e) =>
                setCategoryDraft({
                  ...categoryDraft,
                  parentId: e.target.value,
                })
              }
            >
              <option value="">— Raíz (nivel 1) —</option>
              {flatCategories
                .filter((row) => row.id !== editingCategoryId && row.depth < 2)
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.label}
                  </option>
                ))}
            </select>
          </div>
          <div className="catalog-form__field">
            <label htmlFor="cat-sort">Orden</label>
            <input
              id="cat-sort"
              type="number"
              value={categoryDraft.sortOrder}
              onChange={(e) =>
                setCategoryDraft({
                  ...categoryDraft,
                  sortOrder: e.target.value,
                })
              }
            />
          </div>
        </form>
      </Modal>

      <Modal
        open={deleteTarget != null}
        onClose={onCancelDelete}
        title="Eliminar categoría"
        size="sm"
        footer={
          <>
            <button type="button" className="btn" onClick={onCancelDelete}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={onConfirmDelete}
            >
              Eliminar
            </button>
          </>
        }
      >
        <p className="project-confirm-modal__text">
          ¿Seguro que querés eliminar la categoría{' '}
          <strong>{deleteTarget?.name ?? ''}</strong>? Solo se puede si no tiene
          hijos.
        </p>
      </Modal>
    </>
  );
}
