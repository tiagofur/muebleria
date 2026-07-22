/**
 * Add furniture to a quote modal (PRJ-11 cascade filter / F029 inherit).
 * Extracted from ProjectsScreen.tsx (F058a).
 *
 * Owns the add-item draft state (addItem / cascade L1-L3 / error). The parent
 * passes the catalog + project-level choices/measure-defaults so option
 * inheritance and preset pre-selection match the previous inline behavior.
 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type {
  EdgeBand,
  Hardware,
  MaterialBoard,
  Module,
  ModuleCategory,
  OptionChoices,
  OptionGroup,
} from '@muebles/domain';
import {
  cascadeOptions,
  cascadeSelectedCategoryId,
  effectiveOptionChoices,
  filterModulesByCategory,
  pickPresetByMeasureDefaults,
  type CategoryFilterId,
} from '@muebles/domain';
import { CatalogPicker } from '../../catalogs/CatalogPicker';
import { Modal } from '../../common';
import {
  defaultChoicesForNewItem,
  emptyAddItemDraft,
  groupsForModuleItem,
  optionLabelForId,
  optionsForGroup,
  setItemOptionChoice,
  validateItemQuantity,
  type AddItemDraft,
} from '../projectHelpers';

export interface ProjectAddItemPayload {
  readonly moduleId: string;
  readonly quantity: number;
  readonly optionChoices: OptionChoices;
  readonly measurePresetId?: string;
}

export interface ProjectAddItemModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Receives the validated add-item payload; parent routes to onAddItem. */
  readonly onSubmit: (payload: ProjectAddItemPayload) => void;
  readonly modules: readonly Module[];
  readonly categories: readonly ModuleCategory[];
  readonly optionGroups: readonly OptionGroup[];
  /** Catalog materials/edges/hardware for resolving option roles. */
  readonly catalogs: {
    readonly materials: readonly MaterialBoard[];
    readonly edges: readonly EdgeBand[];
    readonly hardware: readonly Hardware[];
  };
  /** F029: project-wide option defaults — empty key = inherit on this line. */
  readonly projectLevelChoices: Readonly<Record<string, string>>;
  /** #109: per-furnitureType measure defaults → pre-select closest preset. */
  readonly measureDefaults?:
    | Readonly<Record<string, { readonly depth?: number; readonly height?: number }>>
    | undefined;
}

export function ProjectAddItemModal({
  open,
  onClose,
  onSubmit,
  modules,
  categories,
  optionGroups,
  catalogs,
  projectLevelChoices,
  measureDefaults,
}: ProjectAddItemModalProps): ReactNode {
  const formId = useId();
  const [addItem, setAddItem] = useState<AddItemDraft>(() =>
    emptyAddItemDraft(modules, optionGroups),
  );
  const [itemError, setItemError] = useState<string | null>(null);
  const [addCategoryL1, setAddCategoryL1] = useState('');
  const [addCategoryL2, setAddCategoryL2] = useState('');
  const [addCategoryL3, setAddCategoryL3] = useState('');

  // Keep the draft's module valid if the catalog changes underneath us.
  useEffect(() => {
    setAddItem((prev) => {
      if (prev.moduleId && modules.some((m) => m.id === prev.moduleId)) {
        return prev;
      }
      return emptyAddItemDraft(modules, optionGroups);
    });
  }, [modules, optionGroups]);

  // Reset internal state only on the closed → open transition so an in-flight
  // session is never clobbered by a parent re-render.
  const prevOpen = useRef(open);
  useEffect(() => {
    if (!prevOpen.current && open) {
      setAddItem(emptyAddItemDraft(modules, optionGroups));
      setItemError(null);
      setAddCategoryL1('');
      setAddCategoryL2('');
      setAddCategoryL3('');
    }
    prevOpen.current = open;
  }, [open, modules, optionGroups]);

  const addItemCategoryFilter: CategoryFilterId = useMemo(() => {
    const id = cascadeSelectedCategoryId({
      level1Id: addCategoryL1 || undefined,
      level2Id: addCategoryL2 || undefined,
      level3Id: addCategoryL3 || undefined,
    });
    return id ?? null;
  }, [addCategoryL1, addCategoryL2, addCategoryL3]);

  const addCascadeOpts = useMemo(
    () =>
      cascadeOptions(categories, {
        level1Id: addCategoryL1 || undefined,
        level2Id: addCategoryL2 || undefined,
        level3Id: addCategoryL3 || undefined,
      }),
    [categories, addCategoryL1, addCategoryL2, addCategoryL3],
  );

  const modulesForAdd = useMemo(
    () => filterModulesByCategory(modules, addItemCategoryFilter, categories),
    [modules, addItemCategoryFilter, categories],
  );

  const addModule = modules.find((m) => m.id === addItem.moduleId);
  const addGroups = groupsForModuleItem(addModule, optionGroups);

  const selectModuleForAdd = (moduleId: string) => {
    const mod = modules.find((m) => m.id === moduleId);
    // Prefill only groups without a project-level default (F029 inherit).
    const seeded = mod ? defaultChoicesForNewItem(mod, optionGroups) : {};
    const projectLevel = projectLevelChoices ?? {};
    const optionChoices: Record<string, string> = {};
    for (const [code, id] of Object.entries(seeded)) {
      if (!projectLevel[code]?.trim()) {
        optionChoices[code] = id;
      }
    }
    setAddItem({
      moduleId,
      quantity: addItem.quantity || 1,
      optionChoices,
      measurePresetId: mod
        ? pickPresetByMeasureDefaults(mod, measureDefaults)
        : undefined,
    });
  };

  function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const qtyErr = validateItemQuantity(addItem.quantity);
    if (qtyErr) {
      setItemError(qtyErr);
      return;
    }
    if (!addItem.moduleId) {
      setItemError('Elegí un mueble del catálogo.');
      return;
    }
    const mod = modules.find((m) => m.id === addItem.moduleId);
    if (!mod) {
      setItemError('El mueble seleccionado no existe en el catálogo.');
      return;
    }

    const groups = groupsForModuleItem(mod, optionGroups);
    const effective = effectiveOptionChoices(addItem.optionChoices, projectLevelChoices);
    for (const group of groups) {
      if (!effective[group.code]) {
        setItemError(`Falta elegir: ${group.name} (${group.code}).`);
        return;
      }
    }

    if ((mod.presets?.length ?? 0) > 0) {
      const presetOk = mod.presets!.some((p) => p.id === addItem.measurePresetId);
      if (!presetOk) {
        setItemError('Elegí un preset de medida válido para este mueble.');
        return;
      }
    }

    setItemError(null);
    onSubmit({
      moduleId: addItem.moduleId,
      quantity: addItem.quantity,
      optionChoices: addItem.optionChoices,
      measurePresetId: addItem.measurePresetId,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Agregar mueble"
      size="md"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            form={formId}
            disabled={modulesForAdd.length === 0}
          >
            Agregar
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="catalog-form catalog-form--wide project-add-item-form"
        onSubmit={handleSubmit}
      >
        {itemError ? <p className="catalog-form__error">{itemError}</p> : null}
        {categories.length > 0 ? (
          <div
            className="project-editor__grid"
            data-testid="add-item-category-cascade"
            style={{ marginBottom: 'var(--space-3)' }}
          >
            <div className="catalog-form__field">
              <label htmlFor="add-cat-l1">Categoría</label>
              <select
                id="add-cat-l1"
                value={addCategoryL1}
                onChange={(e) => {
                  setAddCategoryL1(e.target.value);
                  setAddCategoryL2('');
                  setAddCategoryL3('');
                }}
              >
                <option value="">Todas</option>
                {addCascadeOpts.level1.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            {addCascadeOpts.level2.length > 0 ? (
              <div className="catalog-form__field">
                <label htmlFor="add-cat-l2">Subcategoría</label>
                <select
                  id="add-cat-l2"
                  value={addCategoryL2}
                  onChange={(e) => {
                    setAddCategoryL2(e.target.value);
                    setAddCategoryL3('');
                  }}
                >
                  <option value="">Todas en nivel 1</option>
                  {addCascadeOpts.level2.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {addCascadeOpts.level3.length > 0 ? (
              <div className="catalog-form__field">
                <label htmlFor="add-cat-l3">Nivel 3</label>
                <select
                  id="add-cat-l3"
                  value={addCategoryL3}
                  onChange={(e) => setAddCategoryL3(e.target.value)}
                >
                  <option value="">Todas en nivel 2</option>
                  {addCascadeOpts.level3.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="project-editor__grid">
          <div className="catalog-form__field">
            <CatalogPicker
              id="add-module"
              label="Mueble"
              placeholder={
                modulesForAdd.length === 0
                  ? 'Sin muebles en este filtro'
                  : 'Seleccionar mueble…'
              }
              searchPlaceholder="Buscar mueble…"
              value={
                modulesForAdd.some((m) => m.id === addItem.moduleId)
                  ? addItem.moduleId
                  : ''
              }
              onChange={(moduleId) => {
                if (moduleId) selectModuleForAdd(moduleId);
              }}
              items={modulesForAdd.map((m) => ({
                id: m.id,
                code: m.code,
                name: m.name,
                active: true,
              }))}
              disabled={modulesForAdd.length === 0}
              data-testid="add-item-module-picker"
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="add-qty">Cantidad</label>
            <input
              id="add-qty"
              type="number"
              min={1}
              step={1}
              value={addItem.quantity}
              onChange={(e) =>
                setAddItem({
                  ...addItem,
                  quantity: Number(e.target.value),
                })
              }
            />
          </div>
          {addModule && (addModule.presets?.length ?? 0) > 0 ? (
            <div className="catalog-form__field">
              <label htmlFor="add-measure-preset">Medida</label>
              <select
                id="add-measure-preset"
                value={addItem.measurePresetId ?? ''}
                onChange={(e) =>
                  setAddItem({
                    ...addItem,
                    measurePresetId: e.target.value || undefined,
                  })
                }
                data-testid="add-item-measure-preset"
              >
                <option value="">Elegí medida…</option>
                {addModule.presets!.map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.name?.trim()
                      ? `${pr.name} (${pr.width}×${pr.height}×${pr.depth} mm)`
                      : `${pr.width}×${pr.height}×${pr.depth} mm`}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        {addGroups.length === 0 ? (
          <p className="catalog-empty" style={{ marginTop: 'var(--space-3)' }}>
            Este mueble no tiene grupos de opción requeridos.
          </p>
        ) : (
          <div className="project-item-choices" style={{ marginTop: 'var(--space-3)' }}>
            {addGroups.map((group) => {
              const options = optionsForGroup(group, catalogs);
              const projectDefault =
                projectLevelChoices?.[group.code]?.trim() ?? '';
              const inheritLabel = projectDefault
                ? `Usar default del proyecto (${optionLabelForId(projectDefault, group, catalogs)})`
                : 'Usar default del proyecto';
              return (
                <div key={group.id} className="catalog-form__field">
                  <label htmlFor={`add-choice-${group.code}`}>
                    {group.name} ({group.code})
                  </label>
                  <select
                    id={`add-choice-${group.code}`}
                    value={addItem.optionChoices[group.code] ?? ''}
                    onChange={(e) =>
                      setAddItem({
                        ...addItem,
                        optionChoices: setItemOptionChoice(
                          addItem.optionChoices,
                          group.code,
                          e.target.value,
                        ),
                      })
                    }
                  >
                    <option value="">{inheritLabel}</option>
                    {options.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.name} — {opt.code}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        )}
        <p className="project-editor__hint">
          Vacío = hereda el default del proyecto. Podés agregar el mismo mueble
          más de una vez con distintas opciones.
        </p>
      </form>
    </Modal>
  );
}
