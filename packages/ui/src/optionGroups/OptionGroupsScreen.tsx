/**
 * Option groups ABM — list + search + modal SM (F020); controlled presentation.
 */

import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type {
  EdgeBand,
  Hardware,
  MaterialBoard,
  Module,
  OptionGroup,
  OptionGroupKind,
} from '@muebles/domain';
import { Pencil, Plus, SearchX, ToggleLeft, Trash2 } from 'lucide-react';
import {
  EmptyState,
  Modal,
  SearchInput,
  useDebouncedValue,
  useRoutableEntitySelection,
} from '../common';
import { validateRequiredName } from '../catalogs/catalogHelpers';
import { CatalogTable, type CatalogColumn } from '../catalogs/CatalogTable';
import '../catalogs/catalogs.css';
import {
  filterOptionIdsByMembers,
  membersForKind,
  optionGroupKindLabel,
  validateOptionGroupCode,
} from './optionGroupHelpers';
import './optionGroups.css';

export type OptionGroupDraft = {
  code: string;
  name: string;
  kind: OptionGroupKind;
  required: boolean;
  optionIds: string[];
};

const emptyDraft = (): OptionGroupDraft => ({
  code: '',
  name: '',
  kind: 'board',
  required: true,
  optionIds: [],
});

function toDraft(item: OptionGroup): OptionGroupDraft {
  return {
    code: item.code,
    name: item.name,
    kind: item.kind,
    required: item.required,
    optionIds: [...item.optionIds],
  };
}

function matchesOptionGroup(
  item: OptionGroup,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) return true;
  const hay =
    `${item.code} ${item.name} ${optionGroupKindLabel(item.kind)}`.toLocaleLowerCase(
      'es-UY',
    );
  return hay.includes(normalizedQuery);
}

export interface OptionGroupsScreenProps {
  readonly optionGroups: readonly OptionGroup[];
  readonly materials: readonly MaterialBoard[];
  readonly edges: readonly EdgeBand[];
  readonly hardware: readonly Hardware[];
  /** Used to warn how many modules reference a group before delete. */
  readonly modules?: readonly Module[];
  readonly onCreate: (draft: OptionGroupDraft) => void;
  readonly onUpdate: (id: string, draft: OptionGroupDraft) => void;
  readonly onDelete: (id: string) => void;
  readonly openEntityId?: string | null;
  readonly onSelectionChange?: (id: string | null) => void;
}

function countModulesUsingGroup(
  modules: readonly Module[],
  groupCode: string,
): number {
  return modules.filter(
    (m) =>
      m.boardParts.some((p) => p.optionRole === groupCode) ||
      m.hardwareLines.some((h) => h.optionRole === groupCode),
  ).length;
}

export function OptionGroupsScreen({
  optionGroups,
  materials,
  edges,
  hardware,
  modules = [],
  onCreate,
  onUpdate,
  onDelete,
  openEntityId = null,
  onSelectionChange,
}: OptionGroupsScreenProps): ReactNode {
  const formId = useId();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const optionGroupIds = useMemo(
    () => optionGroups.map((g) => g.id),
    [optionGroups],
  );
  const { selectedId: expandedId, toggleSelectedId } =
    useRoutableEntitySelection({
      openEntityId,
      onSelectionChange,
      knownIds: optionGroupIds,
    });
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<OptionGroupDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = debouncedSearch.trim().toLocaleLowerCase('es-UY');
    if (!q) return [...optionGroups];
    return optionGroups.filter((g) => matchesOptionGroup(g, q));
  }, [optionGroups, debouncedSearch]);

  const memberCandidates = useMemo(
    () => membersForKind(draft.kind, { materials, edges, hardware }),
    [draft.kind, materials, edges, hardware],
  );

  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of materials) map.set(m.id, `${m.code} — ${m.name}`);
    for (const e of edges) map.set(e.id, `${e.code} — ${e.name}`);
    for (const h of hardware) map.set(h.id, `${h.code} — ${h.name}`);
    return map;
  }, [materials, edges, hardware]);

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setDraft(emptyDraft());
    setError(null);
  };

  const startCreate = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setError(null);
    setModalOpen(true);
  };

  const startEdit = (item: OptionGroup) => {
    setEditingId(item.id);
    setDraft(toDraft(item));
    setError(null);
    setModalOpen(true);
  };

  const toggleExpand = (item: OptionGroup) => {
    toggleSelectedId(item.id);
  };

  const setKind = (kind: OptionGroupKind) => {
    const nextMembers = membersForKind(kind, { materials, edges, hardware });
    setDraft((prev) => ({
      ...prev,
      kind,
      optionIds: filterOptionIdsByMembers(prev.optionIds, nextMembers),
    }));
  };

  const toggleMember = (id: string) => {
    setDraft((prev) => {
      const has = prev.optionIds.includes(id);
      return {
        ...prev,
        optionIds: has
          ? prev.optionIds.filter((x) => x !== id)
          : [...prev.optionIds, id],
      };
    });
  };

  const validate = (): string | null => {
    const codeErr = validateOptionGroupCode(
      draft.code,
      optionGroups,
      editingId ?? undefined,
    );
    if (codeErr) return codeErr;
    return validateRequiredName(draft.name);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    const clean: OptionGroupDraft = {
      ...draft,
      code: draft.code.trim(),
      name: draft.name.trim(),
      optionIds: filterOptionIdsByMembers(draft.optionIds, memberCandidates),
    };
    setError(null);
    if (editingId) {
      onUpdate(editingId, clean);
    } else {
      onCreate(clean);
    }
    closeModal();
  };

  const columns: CatalogColumn<OptionGroup>[] = useMemo(
    () => [
      {
        key: 'code',
        header: 'Código',
        render: (r) => (
          <span className="catalog-row-detail__value--mono">{r.code}</span>
        ),
      },
      { key: 'name', header: 'Nombre', render: (r) => r.name },
      {
        key: 'kind',
        header: 'Tipo',
        render: (r) => optionGroupKindLabel(r.kind),
      },
      {
        key: 'required',
        header: 'Requerido',
        render: (r) => (r.required ? 'Sí' : 'No'),
      },
      {
        key: 'members',
        header: 'Miembros',
        render: (r) => r.optionIds.length,
      },
    ],
    [],
  );

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const deleteTarget = useMemo(
    () =>
      confirmDeleteId
        ? (optionGroups.find((g) => g.id === confirmDeleteId) ?? null)
        : null,
    [confirmDeleteId, optionGroups],
  );
  const deleteTargetModuleCount = deleteTarget
    ? countModulesUsingGroup(modules, deleteTarget.code)
    : 0;

  const requestDelete = (id: string) => {
    setConfirmDeleteId(id);
  };

  const confirmDelete = () => {
    if (!confirmDeleteId) return;
    onDelete(confirmDeleteId);
    setConfirmDeleteId(null);
  };

  const isTrulyEmpty = optionGroups.length === 0;
  const isFilterEmpty = !isTrulyEmpty && rows.length === 0;

  return (
    <section className="catalog-page" aria-label="Grupos de opciones">
      <div className="catalog-page__header">
        <h2 className="catalog-page__title">Grupos de opciones</h2>
        <div className="catalog-page__toolbar">
          <button type="button" className="btn btn--primary" onClick={startCreate}>
            <Plus size={16} strokeWidth={1.5} aria-hidden />
            Nuevo grupo
          </button>
        </div>
      </div>

      {!isTrulyEmpty ? (
        <div className="catalog-page__filters">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar grupos…"
            aria-label="Buscar grupos de opciones"
          />
        </div>
      ) : null}

      <div className="catalog-layout">
        {isTrulyEmpty ? (
          <EmptyState
            icon={ToggleLeft}
            title="No hay grupos de opciones"
            description="Definí grupos para que los módulos puedan elegir materiales, cantos o herrajes."
            actionLabel="Agregar grupo"
            onAction={startCreate}
          />
        ) : isFilterEmpty ? (
          <EmptyState
            variant="no-results"
            icon={SearchX}
            title="Sin resultados"
            description="No hay grupos que coincidan con la búsqueda."
            actionLabel="Limpiar filtros"
            onAction={() => setSearch('')}
          />
        ) : (
          <CatalogTable
            columns={columns}
            rows={rows}
            expandedId={expandedId}
            onRowClick={toggleExpand}
            renderExpandedDetail={(row) => (
              <>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Código</span>
                  <span className="catalog-row-detail__value catalog-row-detail__value--mono">
                    {row.code}
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Nombre</span>
                  <span className="catalog-row-detail__value">{row.name}</span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Tipo</span>
                  <span className="catalog-row-detail__value">
                    {optionGroupKindLabel(row.kind)}
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Requerido</span>
                  <span className="catalog-row-detail__value">
                    {row.required ? 'Sí' : 'No'}
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Miembros</span>
                  <span className="catalog-row-detail__value">
                    {row.optionIds.length === 0
                      ? '—'
                      : row.optionIds
                          .map((id) => memberNameById.get(id) ?? id)
                          .join('; ')}
                  </span>
                </div>
                <div className="catalog-row-detail__actions">
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => startEdit(row)}
                  >
                    <Pencil size={14} strokeWidth={1.5} aria-hidden />
                    Editar
                  </button>
                  <button
                    type="button"
                    className="btn btn--small btn--danger"
                    onClick={() => requestDelete(row.id)}
                  >
                    <Trash2 size={14} strokeWidth={1.5} aria-hidden />
                    Eliminar
                  </button>
                </div>
              </>
            )}
            getRowActions={(row) => (
              <>
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  aria-label={`Editar ${row.code}`}
                  onClick={() => startEdit(row)}
                >
                  <Pencil size={14} strokeWidth={1.5} aria-hidden />
                  Editar
                </button>
                <button
                  type="button"
                  className="btn btn--small btn--ghost btn--danger"
                  aria-label={`Eliminar ${row.code}`}
                  onClick={() => requestDelete(row.id)}
                >
                  <Trash2 size={14} strokeWidth={1.5} aria-hidden />
                  Eliminar
                </button>
              </>
            )}
          />
        )}
      </div>

      <Modal
        open={deleteTarget != null}
        onClose={() => setConfirmDeleteId(null)}
        title="Eliminar grupo de opciones"
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => setConfirmDeleteId(null)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={confirmDelete}
            >
              Eliminar
            </button>
          </>
        }
      >
        <p className="project-confirm-modal__text">
          ¿Seguro que querés eliminar{' '}
          <strong>
            {deleteTarget
              ? `${deleteTarget.code} — ${deleteTarget.name}`
              : 'este grupo'}
          </strong>
          ?
          {deleteTargetModuleCount > 0 ? (
            <>
              {' '}
              Afecta a <strong>{deleteTargetModuleCount}</strong> mueble
              {deleteTargetModuleCount === 1 ? '' : 's'} del catálogo (cost
              preview / opciones).
            </>
          ) : null}{' '}
          Esta acción no se puede deshacer.
        </p>
      </Modal>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editingId ? 'Editar grupo' : 'Nuevo grupo'}
        size="sm"
        footer={
          <>
            <button type="button" className="btn" onClick={closeModal}>
              Cancelar
            </button>
            <button type="submit" className="btn btn--primary" form={formId}>
              Guardar
            </button>
          </>
        }
      >
        <form id={formId} className="catalog-form" onSubmit={handleSubmit}>
          {error ? <p className="catalog-form__error">{error}</p> : null}

          <div className="catalog-form__field">
            <label htmlFor="og-code">Código</label>
            <input
              id="og-code"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              autoComplete="off"
              required
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="og-name">Nombre</label>
            <input
              id="og-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="og-kind">Tipo (kind)</label>
            <select
              id="og-kind"
              value={draft.kind}
              onChange={(e) => setKind(e.target.value as OptionGroupKind)}
            >
              <option value="board">{optionGroupKindLabel('board')}</option>
              <option value="hardware">{optionGroupKindLabel('hardware')}</option>
              <option value="edge">{optionGroupKindLabel('edge')}</option>
            </select>
          </div>
          <div className="catalog-form__field catalog-form__row-check">
            <input
              id="og-required"
              type="checkbox"
              checked={draft.required}
              onChange={(e) =>
                setDraft({ ...draft, required: e.target.checked })
              }
            />
            <label htmlFor="og-required">Requerido (bloquea precio si falta)</label>
          </div>

          <fieldset className="option-members">
            <legend>
              Miembros ({optionGroupKindLabel(draft.kind).toLowerCase()})
            </legend>
            {memberCandidates.length === 0 ? (
              <p className="catalog-empty">
                No hay ítems activos de este tipo en el catálogo.
              </p>
            ) : (
              <ul className="option-members__list">
                {memberCandidates.map((item) => {
                  const checked = draft.optionIds.includes(item.id);
                  return (
                    <li key={item.id}>
                      <label className="option-members__item">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleMember(item.id)}
                        />
                        <span>
                          {item.code} — {item.name}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {draft.optionIds.length > 0 ? (
              <p className="option-members__summary">
                Seleccionados:{' '}
                {draft.optionIds
                  .map((id) => memberNameById.get(id) ?? id)
                  .join('; ')}
              </p>
            ) : null}
          </fieldset>
        </form>
      </Modal>
    </section>
  );
}
