/**
 * Ambient category management: manage-list modal + create/edit form modal +
 * delete confirmation. Owns its internal modal state; the screen only opens
 * the manage modal (F117 split).
 */

import {
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { AmbientCategory } from '@muebles/domain';
import { childrenOf } from '@muebles/domain';
import { Layers, Plus } from 'lucide-react';
import { EmptyState, Modal } from '../../common';
import type { AmbientCategoryDraft } from './ambientMaterialDraft';
import { ManageCategoryRows } from './AmbientCategoryTree';

export interface AmbientCategoryModalsProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly categories: readonly AmbientCategory[];
  readonly onCreateCategory?: (draft: AmbientCategoryDraft) => void;
  readonly onUpdateCategory?: (id: string, draft: AmbientCategoryDraft) => void;
  readonly onDeleteCategory?: (id: string) => void;
  /** Screen hook so the filter resets when the filtered category is deleted. */
  readonly onAfterDelete?: (id: string) => void;
}

export function AmbientCategoryModals({
  open,
  onClose,
  categories,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
  onAfterDelete,
}: AmbientCategoryModalsProps): ReactNode {
  const catFormId = useId();
  const [catFormOpen, setCatFormOpen] = useState(false);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [catDraft, setCatDraft] = useState<AmbientCategoryDraft>({
    name: '',
    parentId: '',
    sortOrder: '0',
  });
  const [catError, setCatError] = useState<string | null>(null);
  const [deleteCatId, setDeleteCatId] = useState<string | null>(null);

  const openCreateCategory = () => {
    setEditingCatId(null);
    setCatDraft({ name: '', parentId: '', sortOrder: '0' });
    setCatError(null);
    setCatFormOpen(true);
  };

  const openEditCategory = (cat: AmbientCategory) => {
    setEditingCatId(cat.id);
    setCatDraft({
      name: cat.name,
      parentId: cat.parentId ?? '',
      sortOrder: String(cat.sortOrder),
    });
    setCatError(null);
    setCatFormOpen(true);
  };

  const handleCategorySubmit = (e: FormEvent) => {
    e.preventDefault();
    const name = catDraft.name.trim();
    if (!name) {
      setCatError('El nombre es obligatorio');
      return;
    }
    if (editingCatId) {
      onUpdateCategory?.(editingCatId, {
        name,
        parentId: catDraft.parentId.trim(),
        sortOrder: String(catDraft.sortOrder),
      });
    } else {
      onCreateCategory?.({
        name,
        parentId: catDraft.parentId.trim(),
        sortOrder: String(catDraft.sortOrder),
      });
    }
    setCatFormOpen(false);
    setEditingCatId(null);
  };

  const deleteCatTarget = useMemo(
    () => (deleteCatId ? categories.find((c) => c.id === deleteCatId) ?? null : null),
    [deleteCatId, categories],
  );

  const confirmDeleteCategory = () => {
    if (deleteCatId) {
      onDeleteCategory?.(deleteCatId);
      onAfterDelete?.(deleteCatId);
    }
    setDeleteCatId(null);
  };

  // Flattened categories for parent picker (max 2 levels so child is max L3)
  const categoryParentOptions = useMemo(() => {
    const opts: { id: string; name: string }[] = [];
    const walk = (parentId: string | undefined, depth: number) => {
      if (depth >= 2) return; // Cannot be parent if depth is already 2 (would create L4)
      for (const c of childrenOf(categories, parentId)) {
        if (c.id !== editingCatId) {
          const indent = depth > 0 ? `${'—'.repeat(depth)} ` : '';
          opts.push({ id: c.id, name: `${indent}${c.name}` });
          walk(c.id, depth + 1);
        }
      }
    };
    walk(undefined, 0);
    return opts;
  }, [categories, editingCatId]);

  return (
    <>
      {/* Category Management Modal */}
      <Modal
        open={open}
        onClose={onClose}
        title="Administrar categorías de acabados"
        size="md"
        dataTestId="ambient-category-manage-modal"
        footer={
          <>
            <button
              type="button"
              className="btn btn--primary"
              onClick={openCreateCategory}
              data-testid="ambient-category-create-btn"
            >
              <Plus size={16} strokeWidth={1.5} aria-hidden />
              Nueva categoría
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Cerrar
            </button>
          </>
        }
      >
        <div className="module-category-manage">
          {categories.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="Sin categorías"
              description="Creá categorías para organizar los acabados y materiales visuales."
              actionLabel="Crear primera categoría"
              onAction={openCreateCategory}
            />
          ) : (
            <ManageCategoryRows
              categories={categories}
              parentId={undefined}
              depth={0}
              onEdit={openEditCategory}
              onDelete={(id) => setDeleteCatId(id)}
              canDelete={Boolean(onDeleteCategory)}
            />
          )}
        </div>
      </Modal>

      {/* Create / Edit Category Modal */}
      <Modal
        open={catFormOpen}
        onClose={() => {
          setCatFormOpen(false);
          setEditingCatId(null);
        }}
        title={editingCatId ? 'Editar categoría' : 'Nueva categoría de acabados'}
        size="sm"
        dataTestId="ambient-category-form-modal"
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setCatFormOpen(false);
                setEditingCatId(null);
              }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              form={catFormId}
              data-testid="ambient-category-submit"
            >
              Guardar
            </button>
          </>
        }
      >
        <form id={catFormId} className="catalog-form" onSubmit={handleCategorySubmit}>
          {catError ? <p className="catalog-form__error">{catError}</p> : null}
          <div className="catalog-form__field">
            <label htmlFor="cat-name">Nombre</label>
            <input
              id="cat-name"
              value={catDraft.name}
              onChange={(e) =>
                setCatDraft({ ...catDraft, name: e.target.value })
              }
              placeholder="Ej. Maderas, Metales, Cerámicos…"
              autoComplete="off"
              required
              data-testid="ambient-category-name-input"
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="cat-parent">Categoría padre (opcional)</label>
            <select
              id="cat-parent"
              value={catDraft.parentId}
              onChange={(e) =>
                setCatDraft({ ...catDraft, parentId: e.target.value })
              }
              data-testid="ambient-category-parent-select"
            >
              <option value="">Principal (Nivel 1)</option>
              {categoryParentOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>
            <p className="catalog-form__hint">
              Máximo 3 niveles de profundidad (Categoría › Subcategoría 1 › Subcategoría 2).
            </p>
          </div>
        </form>
      </Modal>

      {/* Delete Category Confirmation Modal */}
      <Modal
        open={Boolean(deleteCatId)}
        onClose={() => setDeleteCatId(null)}
        title="Eliminar categoría"
        size="sm"
        dataTestId="ambient-category-delete-confirm-modal"
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => setDeleteCatId(null)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={confirmDeleteCategory}
              data-testid="ambient-category-confirm-delete"
            >
              Eliminar
            </button>
          </>
        }
      >
        <p>
          ¿Estás seguro de que deseás eliminar la categoría{' '}
          <strong>{deleteCatTarget?.name}</strong>? Los acabados asignados a
          esta categoría quedarán como «Sin categoría».
        </p>
      </Modal>
    </>
  );
}
