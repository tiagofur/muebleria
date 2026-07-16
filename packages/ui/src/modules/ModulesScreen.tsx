/**
 * Module (mueble plantilla) ABM — cards + detail + Modal LG (F021).
 * Cost formulas live in the shell; this component only renders cost props.
 */

import {
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type {
  Hardware,
  Module,
  ModuleCategory,
  OptionGroup,
  QuoteBreakdown,
} from '@muebles/domain';
import {
  UNCATEGORIZED_FILTER,
  canPlaceCategory,
  cascadeFromCategoryId,
  cascadeOptions,
  cascadeSelectedCategoryId,
  categoryPath,
  childrenOf,
  filterModulesByCategory,
  type CategoryFilterId,
} from '@muebles/domain';
import {
  ChevronLeft,
  Copy,
  FolderTree,
  Layers,
  Package,
  Pencil,
  Plus,
  Settings2,
  Trash2,
} from 'lucide-react';
import { validateNonNegativeNumber, validateRequiredName } from '../catalogs/catalogHelpers';
import { EmptyState, Modal, SearchInput, useDebouncedValue } from '../common';
import '../catalogs/catalogs.css';
import {
  emptyBoardPartDraft,
  emptyCategoryDraft,
  emptyHardwareLineDraft,
  emptyModuleDraft,
  filterModulesByQuery,
  flattenCategoriesForSelect,
  formatModuleMoney,
  moduleToDraft,
  optionGroupsForBoardParts,
  optionGroupsForHardware,
  suggestPartCode,
  validateModuleCode,
  type BoardPartDraft,
  type CategoryDraft,
  type HardwareLineDraft,
  type ModuleDraft,
} from './moduleHelpers';
import './modules.css';

export type { ModuleDraft, BoardPartDraft, HardwareLineDraft, CategoryDraft };

export interface ModulesScreenProps {
  readonly modules: readonly Module[];
  readonly optionGroups: readonly OptionGroup[];
  readonly hardware: readonly Hardware[];
  /** Hierarchical categories (MOD-09). Default empty. */
  readonly categories?: readonly ModuleCategory[];
  readonly onCreate: (draft: ModuleDraft) => void;
  readonly onUpdate: (id: string, draft: ModuleDraft) => void;
  readonly onDelete: (id: string) => void;
  readonly onCreateCategory?: (draft: CategoryDraft) => void;
  readonly onUpdateCategory?: (id: string, draft: CategoryDraft) => void;
  readonly onDeleteCategory?: (id: string) => void;
  /** Deep-copy module (MOD-05). Shell owns id/code generation. */
  readonly onDuplicate?: (id: string) => void;
  /**
   * Notifies parent when the module used for domain cost preview changes
   * (detail selection or edit modal). Null = none / create mode.
   */
  readonly onEditingChange?: (moduleId: string | null) => void;
  /** Domain QuoteBreakdown from shell (MOD-06). Null when blocked/unavailable. */
  readonly costPreview?: QuoteBreakdown | null;
  readonly previewBlocked?: boolean;
  readonly missingGroups?: readonly string[];
  readonly groupLabels?: Readonly<Record<string, string>>;
  /**
   * Sale-price estimate per module id (domain-computed in shell).
   * `null` value = blocked / unavailable.
   */
  readonly moduleEstimates?: Readonly<Record<string, number | null>>;
  /**
   * Incrementing token to open the create-module modal from outside
   * (Dashboard quick action). 0 / undefined = no request.
   */
  readonly requestCreateKey?: number;
  /**
   * Open detail for this module id when set (URL `/modules/:id` or shell handoff).
   * null / '' = list view.
   */
  readonly openModuleId?: string | null;
  /** Notifies parent when detail selection changes (for URL sync). */
  readonly onSelectionChange?: (moduleId: string | null) => void;
}

function CostPreviewPanel({
  costPreview,
  previewBlocked,
  missingGroups,
  groupLabels,
  allowEmptyHint,
}: {
  readonly costPreview: QuoteBreakdown | null;
  readonly previewBlocked: boolean;
  readonly missingGroups: readonly string[];
  readonly groupLabels?: Readonly<Record<string, string>>;
  readonly allowEmptyHint?: boolean;
}): ReactNode {
  if (allowEmptyHint && !costPreview && !previewBlocked) {
    return (
      <p className="catalog-empty" style={{ margin: 0 }}>
        Guardá el mueble para ver el preview de costo con defaults de opción.
      </p>
    );
  }

  return (
    <div
      className={
        previewBlocked || !costPreview
          ? 'module-cost-preview module-cost-preview--blocked'
          : 'module-cost-preview'
      }
      role="status"
      aria-live="polite"
    >
      <h4 className="module-cost-preview__title">
        Preview de costo (con opciones por defecto)
      </h4>
      {previewBlocked || !costPreview ? (
        <>
          <p style={{ margin: 0, fontSize: 'var(--text-base)' }}>
            Preview bloqueado: faltan grupos o no se pudo calcular.
          </p>
          {missingGroups.length > 0 ? (
            <ul className="module-cost-preview__missing">
              {missingGroups.map((code) => (
                <li key={code}>{groupLabels?.[code] ?? code}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <>
          <dl className="module-cost-preview__grid">
            <div>
              <dt>Materiales</dt>
              <dd>{formatModuleMoney(costPreview.materialsCost)}</dd>
            </div>
            <div>
              <dt>Cantos</dt>
              <dd>{formatModuleMoney(costPreview.edgeTotal)}</dd>
            </div>
            <div>
              <dt>Herrajes</dt>
              <dd>{formatModuleMoney(costPreview.hardwareTotal)}</dd>
            </div>
            <div>
              <dt>Costo directo</dt>
              <dd>{formatModuleMoney(costPreview.directCost)}</dd>
            </div>
          </dl>
          <p className="module-cost-preview__sale">
            Precio de venta: {formatModuleMoney(costPreview.salePrice)}
          </p>
        </>
      )}
    </div>
  );
}

export function ModulesScreen({
  modules,
  optionGroups,
  hardware,
  categories = [],
  onCreate,
  onUpdate,
  onDelete,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
  onDuplicate,
  onEditingChange,
  costPreview = null,
  previewBlocked = false,
  missingGroups = [],
  groupLabels,
  moduleEstimates = {},
  requestCreateKey = 0,
  openModuleId = null,
  onSelectionChange,
}: ModulesScreenProps): ReactNode {
  const formId = useId();
  const categoryFormId = useId();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [categoryFilter, setCategoryFilter] =
    useState<CategoryFilterId>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ModuleDraft>(emptyModuleDraft);
  const [error, setError] = useState<string | null>(null);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(
    null,
  );
  const [categoryDraft, setCategoryDraft] =
    useState<CategoryDraft>(emptyCategoryDraft);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const boardRoles = useMemo(
    () => optionGroupsForBoardParts(optionGroups),
    [optionGroups],
  );
  const hardwareRoles = useMemo(
    () => optionGroupsForHardware(optionGroups),
    [optionGroups],
  );
  const activeHardware = useMemo(
    () => hardware.filter((h) => h.active),
    [hardware],
  );
  const hardwareById = useMemo(() => {
    const map = new Map<string, Hardware>();
    for (const h of hardware) map.set(h.id, h);
    return map;
  }, [hardware]);

  const filtered = useMemo(() => {
    const byCat = filterModulesByCategory(
      modules,
      categoryFilter,
      categories,
    );
    return filterModulesByQuery(byCat, debouncedSearch);
  }, [modules, categories, categoryFilter, debouncedSearch]);

  const draftCascade = useMemo(
    () => cascadeFromCategoryId(draft.categoryId || undefined, categories),
    [draft.categoryId, categories],
  );
  const draftCascadeOpts = useMemo(
    () => cascadeOptions(categories, draftCascade),
    [categories, draftCascade],
  );
  const flatCategories = useMemo(
    () => flattenCategoriesForSelect(categories),
    [categories],
  );

  const setDraftCascadeLevel = (
    level: 1 | 2 | 3,
    value: string,
  ) => {
    const next = {
      level1Id: level >= 1 ? (level === 1 ? value || undefined : draftCascade.level1Id) : undefined,
      level2Id: level >= 2 ? (level === 2 ? value || undefined : draftCascade.level2Id) : undefined,
      level3Id: level >= 3 ? (level === 3 ? value || undefined : draftCascade.level3Id) : undefined,
    };
    if (level === 1) {
      next.level2Id = undefined;
      next.level3Id = undefined;
      next.level1Id = value || undefined;
    } else if (level === 2) {
      next.level3Id = undefined;
      next.level2Id = value || undefined;
    } else {
      next.level3Id = value || undefined;
    }
    setDraft((prev) => ({
      ...prev,
      categoryId: cascadeSelectedCategoryId(next) ?? '',
    }));
  };

  const selected = useMemo(
    () => modules.find((m) => m.id === selectedId) ?? null,
    [modules, selectedId],
  );

  // If selected module disappears (delete), return to list
  useEffect(() => {
    if (selectedId && !modules.some((m) => m.id === selectedId)) {
      setSelectedId(null);
    }
  }, [modules, selectedId]);

  // Notify shell of detail selection (URL sync).
  useEffect(() => {
    onSelectionChange?.(selectedId);
  }, [selectedId, onSelectionChange]);

  // Sync detail from shell URL (`/modules` vs `/modules/:id`).
  useEffect(() => {
    if (openModuleId == null || openModuleId === '') {
      setSelectedId(null);
      return;
    }
    if (!modules.some((m) => m.id === openModuleId)) return;
    setSelectedId(openModuleId);
  }, [openModuleId, modules]);

  // Open create modal from shell (Dashboard quick action)
  useEffect(() => {
    if (!requestCreateKey) return;
    setEditingId(null);
    setDraft(emptyModuleDraft());
    setError(null);
    setModalOpen(true);
  }, [requestCreateKey]);

  // Domain cost preview target: edit modal id, else detail selection
  useEffect(() => {
    if (modalOpen) {
      onEditingChange?.(editingId);
    } else {
      onEditingChange?.(selectedId);
    }
  }, [modalOpen, editingId, selectedId, onEditingChange]);

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setDraft(emptyModuleDraft());
    setError(null);
  };

  const startCreate = () => {
    setEditingId(null);
    setDraft(emptyModuleDraft());
    setError(null);
    setModalOpen(true);
  };

  const startEdit = (item: Module) => {
    setEditingId(item.id);
    setDraft(moduleToDraft(item));
    setError(null);
    setModalOpen(true);
  };

  const openDetail = (item: Module) => {
    setSelectedId(item.id);
  };

  const backToList = () => {
    setSelectedId(null);
  };

  const updatePart = (id: string, patch: Partial<BoardPartDraft>) => {
    setDraft((prev) => ({
      ...prev,
      boardParts: prev.boardParts.map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      ),
    }));
  };

  const updateLine = (id: string, patch: Partial<HardwareLineDraft>) => {
    setDraft((prev) => ({
      ...prev,
      hardwareLines: prev.hardwareLines.map((l) =>
        l.id === id ? { ...l, ...patch } : l,
      ),
    }));
  };

  const addBoardPart = () => {
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `part-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const index = draft.boardParts.length + 1;
    const part = emptyBoardPartDraft(id);
    part.code = suggestPartCode(draft.code, index);
    if (boardRoles[0]) {
      part.optionRole = boardRoles[0].code;
    }
    setDraft((prev) => ({
      ...prev,
      boardParts: [...prev.boardParts, part],
    }));
  };

  const removeBoardPart = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      boardParts: prev.boardParts.filter((p) => p.id !== id),
    }));
  };

  const addHardwareLine = () => {
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `hwline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const line = emptyHardwareLineDraft(id);
    if (hardwareRoles[0]) {
      line.optionRole = hardwareRoles[0].code;
    }
    setDraft((prev) => ({
      ...prev,
      hardwareLines: [...prev.hardwareLines, line],
    }));
  };

  const removeHardwareLine = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      hardwareLines: prev.hardwareLines.filter((l) => l.id !== id),
    }));
  };

  const validate = (): string | null => {
    const codeErr = validateModuleCode(
      draft.code,
      modules,
      editingId ?? undefined,
    );
    if (codeErr) return codeErr;
    const nameErr = validateRequiredName(draft.name);
    if (nameErr) return nameErr;

    if (draft.baseLaborCost.trim()) {
      const n = Number(draft.baseLaborCost);
      const laborErr = validateNonNegativeNumber(n, 'Mano de obra base');
      if (laborErr) return laborErr;
    }

    for (const dim of [
      draft.externalWidth,
      draft.externalHeight,
      draft.externalDepth,
    ]) {
      if (dim.trim()) {
        const n = Number(dim);
        const dimErr = validateNonNegativeNumber(n, 'Dimensión externa');
        if (dimErr) return dimErr;
      }
    }

    for (const part of draft.boardParts) {
      if (!part.description.trim()) {
        return 'Cada pieza de tablero necesita descripción.';
      }
      if (!part.optionRole.trim()) {
        return 'Cada pieza de tablero necesita un rol de opción (optionRole).';
      }
      const qtyErr = validateNonNegativeNumber(part.quantity, 'Cantidad de pieza');
      if (qtyErr) return qtyErr;
      if (part.quantity <= 0) {
        return 'La cantidad de pieza debe ser mayor a 0.';
      }
      const lErr = validateNonNegativeNumber(part.lengthMm, 'Largo');
      if (lErr) return lErr;
      const wErr = validateNonNegativeNumber(part.widthMm, 'Ancho');
      if (wErr) return wErr;
      if (part.lengthMm <= 0 || part.widthMm <= 0) {
        return 'Largo y ancho de pieza deben ser mayores a 0.';
      }
    }

    for (const line of draft.hardwareLines) {
      const qtyErr = validateNonNegativeNumber(line.quantity, 'Cantidad de herraje');
      if (qtyErr) return qtyErr;
      if (line.quantity <= 0) {
        return 'La cantidad de herraje debe ser mayor a 0.';
      }
      if (line.mode === 'role') {
        if (!line.optionRole.trim()) {
          return 'Cada línea de herraje por rol necesita optionRole.';
        }
      } else if (!line.hardwareId.trim()) {
        return 'Cada herraje fijo necesita un herraje del catálogo.';
      }
    }

    return null;
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    if (editingId) {
      onUpdate(editingId, draft);
    } else {
      onCreate(draft);
    }
    closeModal();
  };

  const handleDelete = (id: string) => {
    onDelete(id);
    if (selectedId === id) {
      setSelectedId(null);
    }
    if (editingId === id) {
      closeModal();
    }
  };

  const isTrulyEmpty = modules.length === 0;
  const isFilterEmpty = !isTrulyEmpty && filtered.length === 0;

  const estimateLabel = (moduleId: string): ReactNode => {
    if (!(moduleId in moduleEstimates)) {
      return (
        <span className="module-card__cost-value module-card__cost-value--muted">
          —
        </span>
      );
    }
    const value = moduleEstimates[moduleId];
    if (value == null) {
      return (
        <span className="module-card__cost-value module-card__cost-value--muted">
          Sin estimado
        </span>
      );
    }
    return (
      <span className="module-card__cost-value">
        {formatModuleMoney(value)}
      </span>
    );
  };

  const renderEditorForm = (): ReactNode => (
    <form
      id={formId}
      className="catalog-form catalog-form--wide module-editor"
      onSubmit={handleSubmit}
    >
      {error ? <p className="catalog-form__error">{error}</p> : null}

      <div className="module-editor__section">
        <h4 className="module-editor__section-title">Datos generales</h4>
        <div className="module-editor__grid">
          <div className="catalog-form__field">
            <label htmlFor="mod-code">Código</label>
            <input
              id="mod-code"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              autoComplete="off"
              required
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="mod-name">Nombre</label>
            <input
              id="mod-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="mod-labor">Mano de obra base</label>
            <input
              id="mod-labor"
              type="number"
              min={0}
              step="any"
              value={draft.baseLaborCost}
              onChange={(e) =>
                setDraft({ ...draft, baseLaborCost: e.target.value })
              }
              placeholder="Opcional"
            />
          </div>
        </div>
        <div
          className="module-editor__grid"
          style={{ marginTop: '0.65rem' }}
          data-testid="module-category-cascade"
        >
          <div className="catalog-form__field">
            <label htmlFor="mod-cat-l1">Categoría (nivel 1)</label>
            <select
              id="mod-cat-l1"
              value={draftCascade.level1Id ?? ''}
              onChange={(e) => setDraftCascadeLevel(1, e.target.value)}
            >
              <option value="">Sin categoría</option>
              {draftCascadeOpts.level1.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {draftCascadeOpts.level2.length > 0 ? (
            <div className="catalog-form__field">
              <label htmlFor="mod-cat-l2">Subcategoría (nivel 2)</label>
              <select
                id="mod-cat-l2"
                value={draftCascade.level2Id ?? ''}
                onChange={(e) => setDraftCascadeLevel(2, e.target.value)}
              >
                <option value="">— (usar nivel 1)</option>
                {draftCascadeOpts.level2.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {draftCascadeOpts.level3.length > 0 ? (
            <div className="catalog-form__field">
              <label htmlFor="mod-cat-l3">Subcategoría (nivel 3)</label>
              <select
                id="mod-cat-l3"
                value={draftCascade.level3Id ?? ''}
                onChange={(e) => setDraftCascadeLevel(3, e.target.value)}
              >
                <option value="">— (usar nivel 2)</option>
                {draftCascadeOpts.level3.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
        <div className="catalog-form__field" style={{ marginTop: '0.65rem' }}>
          <label htmlFor="mod-notes">Notas</label>
          <input
            id="mod-notes"
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </div>
        <fieldset className="module-editor__dims-legend">
          <legend className="module-editor__section-title">
            Dimensiones externas (opcionales, mm)
          </legend>
          <div className="module-editor__grid module-editor__grid--dims">
            <div className="catalog-form__field">
              <label htmlFor="mod-w">Ancho</label>
              <input
                id="mod-w"
                type="number"
                min={0}
                step="any"
                value={draft.externalWidth}
                onChange={(e) =>
                  setDraft({ ...draft, externalWidth: e.target.value })
                }
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor="mod-h">Alto</label>
              <input
                id="mod-h"
                type="number"
                min={0}
                step="any"
                value={draft.externalHeight}
                onChange={(e) =>
                  setDraft({ ...draft, externalHeight: e.target.value })
                }
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor="mod-d">Profundidad</label>
              <input
                id="mod-d"
                type="number"
                min={0}
                step="any"
                value={draft.externalDepth}
                onChange={(e) =>
                  setDraft({ ...draft, externalDepth: e.target.value })
                }
              />
            </div>
          </div>
        </fieldset>
      </div>

      <div className="module-editor__section">
        <div className="module-editor__section-header">
          <h4 className="module-editor__section-title">
            Piezas de tablero ({draft.boardParts.length})
          </h4>
          <button type="button" className="btn btn--small" onClick={addBoardPart}>
            Agregar pieza
          </button>
        </div>
        {draft.boardParts.length === 0 ? (
          <p className="catalog-empty">
            Sin piezas. Agregá al menos una para cotizar.
          </p>
        ) : (
          <div className="module-part-list">
            {draft.boardParts.map((part, index) => (
              <div key={part.id} className="module-part-card">
                <div className="module-part-card__header">
                  <h5 className="module-part-card__title">Pieza {index + 1}</h5>
                  <button
                    type="button"
                    className="btn btn--small btn--danger"
                    onClick={() => removeBoardPart(part.id)}
                  >
                    Quitar
                  </button>
                </div>
                <div className="module-editor__grid">
                  <div className="catalog-form__field">
                    <label htmlFor={`part-code-${part.id}`}>Código pieza</label>
                    <input
                      id={`part-code-${part.id}`}
                      value={part.code}
                      onChange={(e) =>
                        updatePart(part.id, { code: e.target.value })
                      }
                      placeholder={suggestPartCode(draft.code, index + 1)}
                    />
                  </div>
                  <div className="catalog-form__field">
                    <label htmlFor={`part-desc-${part.id}`}>Descripción</label>
                    <input
                      id={`part-desc-${part.id}`}
                      value={part.description}
                      onChange={(e) =>
                        updatePart(part.id, { description: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div className="catalog-form__field">
                    <label htmlFor={`part-qty-${part.id}`}>Cantidad</label>
                    <input
                      id={`part-qty-${part.id}`}
                      type="number"
                      min={1}
                      step={1}
                      value={part.quantity}
                      onChange={(e) =>
                        updatePart(part.id, {
                          quantity: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="catalog-form__field">
                    <label htmlFor={`part-l-${part.id}`}>Largo (mm)</label>
                    <input
                      id={`part-l-${part.id}`}
                      type="number"
                      min={0}
                      step="any"
                      value={part.lengthMm}
                      onChange={(e) =>
                        updatePart(part.id, {
                          lengthMm: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="catalog-form__field">
                    <label htmlFor={`part-w-${part.id}`}>Ancho (mm)</label>
                    <input
                      id={`part-w-${part.id}`}
                      type="number"
                      min={0}
                      step="any"
                      value={part.widthMm}
                      onChange={(e) =>
                        updatePart(part.id, {
                          widthMm: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="catalog-form__field">
                    <label htmlFor={`part-role-${part.id}`}>
                      Rol (optionRole)
                    </label>
                    <select
                      id={`part-role-${part.id}`}
                      value={part.optionRole}
                      onChange={(e) =>
                        updatePart(part.id, { optionRole: e.target.value })
                      }
                      required
                    >
                      <option value="">Seleccionar grupo…</option>
                      {boardRoles.map((g) => (
                        <option key={g.id} value={g.code}>
                          {g.name} ({g.code})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="module-edge-flags" role="group" aria-label="Cantos">
                  {(
                    [
                      ['edgeL1', 'L1'],
                      ['edgeL2', 'L2'],
                      ['edgeW1', 'W1'],
                      ['edgeW2', 'W2'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={part[key]}
                        onChange={(e) =>
                          updatePart(part.id, { [key]: e.target.checked })
                        }
                      />
                      Canto {label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="module-editor__section">
        <div className="module-editor__section-header">
          <h4 className="module-editor__section-title">
            Herrajes ({draft.hardwareLines.length})
          </h4>
          <button
            type="button"
            className="btn btn--small"
            onClick={addHardwareLine}
          >
            Agregar herraje
          </button>
        </div>
        {draft.hardwareLines.length === 0 ? (
          <p className="catalog-empty">Sin líneas de herraje.</p>
        ) : (
          <div className="module-part-list">
            {draft.hardwareLines.map((line, index) => (
              <div key={line.id} className="module-part-card">
                <div className="module-part-card__header">
                  <h5 className="module-part-card__title">
                    Herraje {index + 1}
                  </h5>
                  <button
                    type="button"
                    className="btn btn--small btn--danger"
                    onClick={() => removeHardwareLine(line.id)}
                  >
                    Quitar
                  </button>
                </div>
                <div className="module-editor__grid">
                  <div className="catalog-form__field">
                    <label htmlFor={`hw-mode-${line.id}`}>Modo</label>
                    <select
                      id={`hw-mode-${line.id}`}
                      value={line.mode}
                      onChange={(e) => {
                        const mode = e.target.value as 'role' | 'fixed';
                        updateLine(line.id, {
                          mode,
                          optionRole:
                            mode === 'fixed'
                              ? line.optionRole || 'FIXED'
                              : line.optionRole === 'FIXED'
                                ? hardwareRoles[0]?.code ?? ''
                                : line.optionRole,
                          hardwareId: mode === 'role' ? '' : line.hardwareId,
                        });
                      }}
                    >
                      <option value="role">Por rol de opción</option>
                      <option value="fixed">Herraje fijo</option>
                    </select>
                  </div>
                  <div className="catalog-form__field">
                    <label htmlFor={`hw-qty-${line.id}`}>Cantidad</label>
                    <input
                      id={`hw-qty-${line.id}`}
                      type="number"
                      min={1}
                      step={1}
                      value={line.quantity}
                      onChange={(e) =>
                        updateLine(line.id, {
                          quantity: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  {line.mode === 'role' ? (
                    <div className="catalog-form__field">
                      <label htmlFor={`hw-role-${line.id}`}>
                        Rol (optionRole)
                      </label>
                      <select
                        id={`hw-role-${line.id}`}
                        value={line.optionRole}
                        onChange={(e) =>
                          updateLine(line.id, {
                            optionRole: e.target.value,
                          })
                        }
                      >
                        <option value="">Seleccionar grupo…</option>
                        {hardwareRoles.map((g) => (
                          <option key={g.id} value={g.code}>
                            {g.name} ({g.code})
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="catalog-form__field">
                      <label htmlFor={`hw-id-${line.id}`}>Herraje fijo</label>
                      <select
                        id={`hw-id-${line.id}`}
                        value={line.hardwareId}
                        onChange={(e) =>
                          updateLine(line.id, {
                            hardwareId: e.target.value,
                            optionRole: line.optionRole || 'FIXED',
                          })
                        }
                      >
                        <option value="">Seleccionar herraje…</option>
                        {activeHardware.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.code} — {h.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="catalog-form__field">
                    <label htmlFor={`hw-desc-${line.id}`}>
                      Descripción (opcional)
                    </label>
                    <input
                      id={`hw-desc-${line.id}`}
                      value={line.descriptionOverride}
                      onChange={(e) =>
                        updateLine(line.id, {
                          descriptionOverride: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editingId ? (
        <CostPreviewPanel
          costPreview={costPreview}
          previewBlocked={previewBlocked}
          missingGroups={missingGroups}
          groupLabels={groupLabels}
        />
      ) : (
        <CostPreviewPanel
          costPreview={null}
          previewBlocked={false}
          missingGroups={[]}
          allowEmptyHint
        />
      )}
    </form>
  );

  const renderDetail = (mod: Module): ReactNode => (
    <div className="module-detail" data-testid="module-detail">
      <div className="module-detail__top">
        <div className="module-detail__identity">
          <button
            type="button"
            className="btn btn--ghost btn--small module-detail__back"
            onClick={backToList}
          >
            <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
            Volver a la lista
          </button>
          <span className="module-detail__code">{mod.code}</span>
          <h2 className="module-detail__title">{mod.name}</h2>
          {mod.categoryId ? (
            <p className="module-detail__category" data-testid="module-category-path">
              {categoryPath(mod.categoryId, categories)
                .map((c) => c.name)
                .join(' › ') || 'Categoría'}
            </p>
          ) : (
            <p className="module-detail__category module-detail__category--muted">
              Sin categoría
            </p>
          )}
          <div className="module-detail__meta">
            <span>
              {mod.boardParts.length} pieza
              {mod.boardParts.length === 1 ? '' : 's'}
            </span>
            <span>
              {mod.hardwareLines.length} herraje
              {mod.hardwareLines.length === 1 ? '' : 's'}
            </span>
            {mod.externalDims ? (
              <span>
                {mod.externalDims.width}×{mod.externalDims.height}×
                {mod.externalDims.depth} mm
              </span>
            ) : null}
          </div>
          {mod.notes ? (
            <p className="module-detail__notes">{mod.notes}</p>
          ) : null}
        </div>
        <div className="module-detail__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => startEdit(mod)}
          >
            <Pencil size={16} strokeWidth={1.5} aria-hidden />
            Editar
          </button>
          {onDuplicate ? (
            <button
              type="button"
              className="btn"
              onClick={() => onDuplicate(mod.id)}
            >
              <Copy size={16} strokeWidth={1.5} aria-hidden />
              Duplicar
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => handleDelete(mod.id)}
          >
            <Trash2 size={16} strokeWidth={1.5} aria-hidden />
            Eliminar
          </button>
        </div>
      </div>

      <CostPreviewPanel
        costPreview={costPreview}
        previewBlocked={previewBlocked}
        missingGroups={missingGroups}
        groupLabels={groupLabels}
      />

      <section className="module-detail__section" aria-label="Piezas de tablero">
        <h3 className="module-detail__section-title">
          Piezas de tablero ({mod.boardParts.length})
        </h3>
        {mod.boardParts.length === 0 ? (
          <p className="module-detail__empty">Sin piezas de tablero.</p>
        ) : (
          mod.boardParts.map((part) => {
            const edgesOn = part.edges
              .filter((e) => e.enabled)
              .map((e) => e.side)
              .join(', ');
            return (
              <div key={part.id} className="module-detail-row">
                <span className="module-detail-row__code">
                  {part.code ?? '—'}
                </span>
                <div className="module-detail-row__main">
                  {part.description}
                  <span className="module-detail-row__sub">
                    {part.lengthMm}×{part.widthMm} mm · rol {part.optionRole}
                    {edgesOn ? ` · cantos ${edgesOn}` : ''} · veta según material
                  </span>
                </div>
                <span className="module-detail-row__qty">×{part.quantity}</span>
              </div>
            );
          })
        )}
      </section>

      <section className="module-detail__section" aria-label="Herrajes">
        <h3 className="module-detail__section-title">
          Herrajes ({mod.hardwareLines.length})
        </h3>
        {mod.hardwareLines.length === 0 ? (
          <p className="module-detail__empty">Sin líneas de herraje.</p>
        ) : (
          mod.hardwareLines.map((line) => {
            const fixed = line.hardwareId
              ? hardwareById.get(line.hardwareId)
              : undefined;
            const label = fixed
              ? `${fixed.code} — ${fixed.name}`
              : `Rol ${line.optionRole}`;
            return (
              <div key={line.id} className="module-detail-row">
                <span className="module-detail-row__code">
                  {fixed?.code ?? line.optionRole}
                </span>
                <div className="module-detail-row__main">
                  {line.descriptionOverride?.trim() || label}
                  <span className="module-detail-row__sub">
                    {fixed ? 'Herraje fijo' : `Por opción (${line.optionRole})`}
                  </span>
                </div>
                <span className="module-detail-row__qty">×{line.quantity}</span>
              </div>
            );
          })
        )}
      </section>
    </div>
  );

  const renderCategoryTree = (
    parentId: string | undefined,
    depth: number,
  ): ReactNode => {
    const nodes = childrenOf(categories, parentId);
    if (nodes.length === 0) return null;
    return (
      <ul
        className="module-category-tree__list"
        style={{ paddingLeft: depth === 0 ? 0 : 'var(--space-3)' }}
      >
        {nodes.map((node) => {
          const active = categoryFilter === node.id;
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
                  setCategoryFilter((prev) =>
                    prev === node.id ? null : node.id,
                  )
                }
                data-testid={`category-filter-${node.id}`}
              >
                {node.name}
              </button>
              {renderCategoryTree(node.id, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  };

  const openCreateCategory = () => {
    setEditingCategoryId(null);
    setCategoryDraft(emptyCategoryDraft());
    setCategoryError(null);
    setCategoryModalOpen(true);
  };

  const openEditCategory = (cat: ModuleCategory) => {
    setEditingCategoryId(cat.id);
    setCategoryDraft({
      name: cat.name,
      parentId: cat.parentId ?? '',
      sortOrder: String(cat.sortOrder),
    });
    setCategoryError(null);
    setCategoryModalOpen(true);
  };

  const closeCategoryModal = () => {
    setCategoryModalOpen(false);
    setEditingCategoryId(null);
    setCategoryDraft(emptyCategoryDraft());
    setCategoryError(null);
  };

  const handleCategorySubmit = (e: FormEvent) => {
    e.preventDefault();
    const name = categoryDraft.name.trim();
    if (!name) {
      setCategoryError('El nombre es obligatorio.');
      return;
    }
    const parentId = categoryDraft.parentId || undefined;
    if (
      !canPlaceCategory(parentId, categories, editingCategoryId ?? undefined)
    ) {
      setCategoryError(
        'No se puede colocar aquí: máximo 3 niveles o jerarquía inválida.',
      );
      return;
    }
    setCategoryError(null);
    if (editingCategoryId) {
      onUpdateCategory?.(editingCategoryId, categoryDraft);
    } else {
      onCreateCategory?.(categoryDraft);
    }
    closeCategoryModal();
  };

  const renderList = (): ReactNode => (
    <>
      <div className="catalog-page__header">
        <h2 className="catalog-page__title">Muebles (módulos plantilla)</h2>
        <div className="catalog-page__toolbar">
          {onCreateCategory ? (
            <button
              type="button"
              className="btn"
              onClick={openCreateCategory}
              data-testid="manage-categories"
            >
              <FolderTree size={16} strokeWidth={1.5} aria-hidden />
              Categorías
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--primary"
            onClick={startCreate}
          >
            <Plus size={16} strokeWidth={1.5} aria-hidden />
            Nuevo mueble
          </button>
        </div>
      </div>

      <div className="module-list-layout">
        <aside
          className="module-category-tree"
          aria-label="Filtro por categorías"
          data-testid="category-filter-panel"
        >
          <h3 className="module-category-tree__title">Categorías</h3>
          <button
            type="button"
            className={
              categoryFilter === null
                ? 'module-category-tree__item module-category-tree__item--active'
                : 'module-category-tree__item'
            }
            onClick={() => setCategoryFilter(null)}
          >
            Todas
          </button>
          <button
            type="button"
            className={
              categoryFilter === UNCATEGORIZED_FILTER
                ? 'module-category-tree__item module-category-tree__item--active'
                : 'module-category-tree__item'
            }
            onClick={() => setCategoryFilter(UNCATEGORIZED_FILTER)}
            data-testid="category-filter-uncategorized"
          >
            Sin categoría
          </button>
          {categories.length === 0 ? (
            <p className="module-category-tree__empty">
              Sin categorías. Creá la jerarquía con el botón Categorías.
            </p>
          ) : (
            renderCategoryTree(undefined, 0)
          )}
          {onCreateCategory && categories.length > 0 ? (
            <ul className="module-category-tree__admin" aria-label="Editar categorías">
              {flatCategories.map((row) => {
                const cat = categories.find((c) => c.id === row.id);
                if (!cat) return null;
                return (
                  <li key={row.id} className="module-category-tree__admin-row">
                    <span>{row.label}</span>
                    <span className="module-category-tree__admin-actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--small"
                        onClick={() => openEditCategory(cat)}
                        aria-label={`Editar ${cat.name}`}
                      >
                        <Pencil size={14} strokeWidth={1.5} />
                      </button>
                      {onDeleteCategory ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--small"
                          onClick={() => onDeleteCategory(cat.id)}
                          aria-label={`Eliminar ${cat.name}`}
                        >
                          <Trash2 size={14} strokeWidth={1.5} />
                        </button>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </aside>

        <div className="module-list-main">
          {!isTrulyEmpty ? (
            <div className="catalog-page__filters">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Buscar muebles…"
                aria-label="Buscar muebles"
              />
            </div>
          ) : null}

          {isTrulyEmpty ? (
            <EmptyState
              icon={Package}
              title="No hay módulos"
              description="Creá el primer mueble plantilla o cargá la semilla del workspace."
              actionLabel="Nuevo mueble"
              onAction={startCreate}
            />
          ) : isFilterEmpty ? (
            <p className="module-filter-empty">
              No hay muebles que coincidan con el filtro o la búsqueda.
            </p>
          ) : (
            <ul className="module-card-grid" aria-label="Lista de muebles">
              {filtered.map((mod) => (
                <li key={mod.id}>
                  <button
                    type="button"
                    className="module-card"
                    onClick={() => openDetail(mod)}
                    data-testid={`module-card-${mod.id}`}
                  >
                    <span className="module-card__code">{mod.code}</span>
                    <h3 className="module-card__name">{mod.name}</h3>
                    <div className="module-card__stats">
                      <span className="module-card__stat">
                        <Layers size={14} strokeWidth={1.5} aria-hidden />
                        {mod.boardParts.length} pieza
                        {mod.boardParts.length === 1 ? '' : 's'}
                      </span>
                      <span className="module-card__stat">
                        <Settings2 size={14} strokeWidth={1.5} aria-hidden />
                        {mod.hardwareLines.length} herraje
                        {mod.hardwareLines.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="module-card__cost">
                      <span className="module-card__cost-label">
                        Costo estimado
                      </span>
                      {estimateLabel(mod.id)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );

  return (
    <section className="catalog-page" aria-label="Muebles (módulos)">
      {selected ? renderDetail(selected) : renderList()}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editingId ? 'Editar mueble' : 'Nuevo mueble'}
        size="lg"
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
        {renderEditorForm()}
      </Modal>

      <Modal
        open={categoryModalOpen}
        onClose={closeCategoryModal}
        title={editingCategoryId ? 'Editar categoría' : 'Nueva categoría'}
        size="sm"
        footer={
          <>
            <button type="button" className="btn" onClick={closeCategoryModal}>
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
          onSubmit={handleCategorySubmit}
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
    </section>
  );
}
