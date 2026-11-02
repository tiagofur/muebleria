/**
 * Agregado editor form — tabs: General, Piezas, Herrajes.
 * Full-page editor, no modal. Follows ComponentEditorForm pattern.
 */

import {
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Agregado, AgregadoRigidMember, Component, Hardware, HardwareLine, ModuleComponentInstance, OptionGroup } from '@granete/domain';
import { Plus, Trash2 } from 'lucide-react';
import { WorkspaceTabs, type TabDefinition } from '../../common/Tabs';
import { CatalogPicker } from '../../catalogs/CatalogPicker';
import { ModuleComponentAdderModal } from '../../modules/components/ModuleComponentAdderModal';
import { COMPONENT_PLACEMENTS } from '../../components';
import { InstanceOverridesEditor } from '../../modules/components/InstanceOverridesEditor';
import {
  HardwarePlacementsEditor,
  hardwareGroupMembersHint,
} from '../../modules/components/HardwarePlacementsEditor';
import { optionGroupsForHardware } from '../../modules/helpers/moduleRolePickers';
import type { Module3DCatalogInput } from '../../modules/module3dPreview';
import type { AgregadoDraft } from '../agregadoDraft';
import { AgregadoCajonHardwareSection, uniqueMemberId } from './AgregadoCajonHardwareSection';
import { AgregadoEditorGeneralPanel } from './AgregadoEditorGeneralPanel';
import { AgregadoEditorPreview3D } from './AgregadoEditorPreview3D';
import { AgregadoRecipeAuthoringPanel } from './AgregadoRecipeAuthoringPanel';

export type AgregadoEditorTab = 'general' | 'components' | 'hardware' | 'recipe';

export type AgregadoEditorFormProps = {
  readonly formId: string;
  readonly error: string | null;
  readonly onSubmit: (e: FormEvent) => void;
  readonly editorTab: AgregadoEditorTab;
  readonly setEditorTab: Dispatch<SetStateAction<AgregadoEditorTab>>;
  readonly draft: AgregadoDraft;
  readonly setDraft: Dispatch<SetStateAction<AgregadoDraft>>;
  readonly editingId: string | null;
  readonly catalogComponents: readonly Component[];
  readonly catalogHardware: readonly Hardware[];
  /** Full catalog for the live 3D preview. When omitted, the Piezas tab falls
   * back to a single-column layout with no preview. */
  readonly catalogInput?: Module3DCatalogInput;
  readonly resolveImageUrl?: (url: string | undefined) => string | undefined;
  /** Option groups governing the hardware role select (#1009 S4). When
   * omitted, the role field degrades to the legacy free-text input. */
  readonly optionGroups?: readonly OptionGroup[];
  /** #1009 S3: the last save was rejected by the server; the draft is intact. */
  readonly saveFailed?: boolean;
  /** #1369: la entidad guardada cuya receta muestra la pestaña (read-only). */
  readonly recipeAgregado?: Agregado | null;
  /** #1369: abrir el modal «Simular cambio de receta». Ausente ⇒ botón oculto. */
  readonly onSimulateChange?: () => void;
};

const TABS: { id: AgregadoEditorTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'components', label: 'Piezas' },
  { id: 'hardware', label: 'Herrajes' },
  { id: 'recipe', label: 'Receta' },
];

export function AgregadoEditorForm({
  formId,
  error,
  onSubmit,
  editorTab,
  setEditorTab,
  draft,
  setDraft,
  editingId,
  catalogComponents,
  catalogHardware,
  catalogInput,
  resolveImageUrl,
  optionGroups,
  saveFailed = false,
  recipeAgregado,
  onSimulateChange,
}: AgregadoEditorFormProps): ReactNode {

  const hardwareRoles = useMemo(
    () => (optionGroups ? optionGroupsForHardware(optionGroups) : []),
    [optionGroups],
  );

  // #1451: items del picker de herrajes — una sola voz en líneas y members.
  const pickerHardwareItems = useMemo(
    () =>
      catalogHardware.map((h) => ({
        id: h.id,
        code: h.code,
        name: h.name,
        active: h.active,
      })),
    [catalogHardware],
  );

  // S5 #1009: «Añadir Pieza» opens a searchable picker instead of blindly
  // appending the catalog's first component (ModuleComponentAdderModal parity).
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerComponentId, setPickerComponentId] = useState('');
  const [pickerQty, setPickerQty] = useState(1);

  const filteredPickerComponents = useMemo(() => {
    const q = pickerSearch.trim().toLocaleLowerCase('es-UY');
    if (!q) return catalogComponents.filter((c) => c.active);
    return catalogComponents.filter(
      (c) =>
        c.active &&
        (`${c.code} ${c.name}`.toLocaleLowerCase('es-UY').includes(q) ||
          c.optionRoles.some((r) => r.toLocaleLowerCase('es-UY').includes(q))),
    );
  }, [catalogComponents, pickerSearch]);

  const openComponentPicker = () => {
    setPickerComponentId('');
    setPickerQty(1);
    setPickerSearch('');
    setPickerOpen(true);
  };

  const confirmComponentPick = () => {
    if (!pickerComponentId) return;
    setDraft((prev) => ({
      ...prev,
      components: [
        ...prev.components,
        { componentId: pickerComponentId, quantity: pickerQty },
      ],
    }));
    setPickerOpen(false);
  };

  const addComponentInstance = openComponentPicker;

  const removeComponentInstance = (idx: number) => {
    setDraft((prev) => ({
      ...prev,
      components: prev.components.filter((_, i) => i !== idx),
    }));
  };

  const updateComponentInstance = (idx: number, patch: Partial<ModuleComponentInstance>) => {
    setDraft((prev) => ({
      ...prev,
      components: prev.components.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    }));
  };

  const addHardwareLine = () => {
    // #1451: la línea nace sin herraje ni grupo — inválida-visible hasta que
    // el autor elige (mismo trato fail-closed que los placements #1147);
    // nunca un default encubierto a catalogHardware[0].
    setDraft((prev) => ({
      ...prev,
      hardwareLines: [
        ...prev.hardwareLines,
        {
          id: `hl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          quantity: 1,
          optionRole: '',
        },
      ],
    }));
  };

  // #1451: fábrica del miembro «Del cajón» — comparte el chooser del header y
  // el botón de la sección. Nace SIN herraje (inválido-visible) anclado al
  // borde izquierdo; el kit del borrador manda para el bomRole.
  const addAgregadoMember = () => {
    setDraft((prev) => {
      const member: AgregadoRigidMember = {
        memberId: uniqueMemberId(prev.rigidMembers ?? []),
        role: 'fixed_rail',
        source: { kind: 'fixed', fixed: { hardwareId: '' } },
        placement: {
          x: { ref: 'min', offsetMm: 0 },
          y: { ref: 'min', offsetMm: 0 },
          z: { ref: 'min', offsetMm: 0 },
        },
        bomRole: prev.commercialKitHardwareId
          ? 'included_in_kit'
          : 'separately_purchased',
        actorMembership: 'body',
      };
      return { ...prev, rigidMembers: [...(prev.rigidMembers ?? []), member] };
    });
  };

  // #1451: el «+ Añadir herraje» pregunta primero el nivel — la distinción
  // que el usuario ya hace de forma natural (del cajón / pieza / cantidad).
  const [hwChooserOpen, setHwChooserOpen] = useState(false);
  const cajonLevelRef = useRef<HTMLDivElement | null>(null);
  const cantidadLevelRef = useRef<HTMLDivElement | null>(null);
  const piezasLevelRef = useRef<HTMLDivElement | null>(null);

  const chooseHardwareLevel = (level: 'cajon' | 'pieza' | 'cantidad') => {
    setHwChooserOpen(false);
    if (level === 'cajon') {
      addAgregadoMember();
    } else if (level === 'cantidad') {
      addHardwareLine();
    }
    window.requestAnimationFrame(() => {
      const target =
        level === 'cajon'
          ? cajonLevelRef.current
          : level === 'pieza'
          ? piezasLevelRef.current
          : cantidadLevelRef.current;
      target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  };

  const removeHardwareLine = (idx: number) => {
    setDraft((prev) => ({
      ...prev,
      hardwareLines: prev.hardwareLines.filter((_, i) => i !== idx),
    }));
  };

  const updateHardwareLine = (idx: number, patch: Partial<HardwareLine>) => {
    setDraft((prev) => ({
      ...prev,
      hardwareLines: prev.hardwareLines.map((h, i) => (i === idx ? { ...h, ...patch } : h)),
    }));
  };

  const totalHardwarePlacements = draft.components.reduce(
    (acc, c) => acc + (c.overrides?.hardwarePlacements?.length ?? 0),
    0,
  );

  // #1451: badge por nivel — «cantidad + posiciones», nunca la suma cruda.
  const bulkHardwareCount = draft.hardwareLines.length;
  const positionedHardwareCount =
    totalHardwarePlacements + (draft.rigidMembers?.length ?? 0);
  const hardwareBadge =
    bulkHardwareCount === 0 && positionedHardwareCount === 0
      ? undefined
      : [
          ...(bulkHardwareCount > 0 ? [String(bulkHardwareCount)] : []),
          `${positionedHardwareCount} pos.`,
        ].join(' + ');

  const tabBadge: Partial<Record<AgregadoEditorTab, string | number>> = {
    components: draft.components.length,
    hardware: hardwareBadge,
    // #1412: la pestaña ahora AUTORA la receta del borrador; el resumen de la
    // guardada vive dentro (lectura) y «Simular cambio» sigue contra la guardada.
    recipe: draft.rigidMembers?.length,
  };

  const tabDefs: readonly TabDefinition<AgregadoEditorTab>[] = TABS.map(
    (tab) => ({
      id: tab.id,
      label: tab.label,
      count: tabBadge[tab.id] || undefined,
    }),
  );

  return (
    <>
      <form
        id={formId}
        onSubmit={onSubmit}
        className="catalog-form agregado-editor"
        noValidate
      >
      {error ? (
        <p className="catalog-form__error" data-testid="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {saveFailed ? (
        <div
          className="catalog-form__error agregado-editor__save-error"
          role="alert"
          data-testid="agregado-editor-save-error"
        >
          <p>
            No se pudo guardar en el servidor. Tus cambios siguen acá —
            revisá tu conexión e intentá de nuevo.
          </p>
        </div>
      ) : null}

      {/* Tabs */}
      <WorkspaceTabs
        tabs={tabDefs}
        activeTab={editorTab}
        onTabChange={setEditorTab}
        ariaLabel="Secciones del editor de agregado"
        idPrefix="agregado-editor"
        testIdPrefix="agregado-editor"
      />

      {/* Tab: General */}
      {editorTab === 'general' && (
        <AgregadoEditorGeneralPanel
          formId={formId}
          draft={draft}
          setDraft={setDraft}
          setEditorTab={setEditorTab}
        />
      )}

      {/* Tab: Piezas */}
      {editorTab === 'components' && (
        <div
          className="agregado-editor__panel"
          id="agregado-editor-panel-components"
          role="tabpanel"
          aria-labelledby="agregado-editor-tab-components"
          data-testid="agregado-tab-components"
        >
          <div
            className={
              catalogInput
                ? 'agregado-editor__components-layout agregado-editor__components-layout--with-preview'
                : 'agregado-editor__components-layout'
            }
          >
            <div className="agregado-editor__components-list">
              <div className="agregado-editor__panel-header">
                <p className="catalog-form__hint">
                  Piezas de tablero que componen este sub-ensamble. Cada pieza usará W, H, D locales del agregado.
                </p>
                <button
                  type="button"
                  className="btn btn--secondary btn--small"
                  onClick={addComponentInstance}
                  disabled={catalogComponents.length === 0}
                  data-testid="agregado-add-component"
                >
                  <Plus size={14} /> Añadir Pieza
                </button>
              </div>

              {draft.components.length === 0 ? (
                <div className="agregado-editor__empty-slot">
                  No hay piezas en este sub-ensamble.
                </div>
              ) : (
                <ul className="agregado-editor__item-list">
                  {draft.components.map((comp, idx) => {
                    const info = catalogComponents.find((c) => c.id === comp.componentId);
                    return (
                      <li
                        key={idx}
                        className="agregado-editor__item-row agregado-editor__item-row--block"
                      >
                        <div className="agregado-editor__item-header agregado-editor__item-header--flex">
                          <strong className="agregado-editor__item-title">
                            {info ? `${info.code} — ${info.name}` : comp.componentId}
                          </strong>
                          <button
                            type="button"
                            className="btn btn--ghost btn--small btn--icon-only"
                            aria-label="Eliminar pieza"
                            onClick={() => removeComponentInstance(idx)}
                            data-testid={`agregado-comp-${idx}-remove`}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>

                        <div className="agregado-editor__item-fields agregado-editor__item-fields--grid">
                          <div className="catalog-form__field">
                            <label className="catalog-form__label">Componente</label>
                            <select
                              className="catalog-form__select"
                              value={comp.componentId}
                              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                                updateComponentInstance(idx, { componentId: e.target.value })
                              }
                              data-testid={`agregado-comp-${idx}-select`}
                            >
                              {catalogComponents.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.code} — {c.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="catalog-form__field">
                            <label className="catalog-form__label">Cantidad</label>
                            <input
                              type="number"
                              min={1}
                              className="catalog-form__input"
                              value={comp.quantity}
                              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                updateComponentInstance(idx, {
                                  quantity: Math.max(1, Number(e.target.value) || 1),
                                })
                              }
                              data-testid={`agregado-comp-${idx}-qty`}
                            />
                          </div>

                          <div className="catalog-form__field">
                            <label className="catalog-form__label">Ubicación (opcional)</label>
                            <select
                              className="catalog-form__select"
                              value={comp.placementOverride ?? ''}
                              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                                updateComponentInstance(idx, {
                                  placementOverride: (e.target.value as any) || undefined,
                                })
                              }
                              data-testid={`agregado-comp-${idx}-placement`}
                            >
                              <option value="">— Del componente —</option>
                              {COMPONENT_PLACEMENTS.map((p) => (
                                <option key={p.value} value={p.value}>
                                  {p.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {info?.notes && (
                          <p className="agregado-editor__item-hint">{info.notes}</p>
                        )}

                        <InstanceOverridesEditor
                          overrides={comp.overrides}
                          testIdSuffix={String(idx)}
                          onChange={(nextOverrides) =>
                            updateComponentInstance(idx, { overrides: nextOverrides })
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {catalogInput ? (
              <AgregadoEditorPreview3D
                draft={draft}
                catalogInput={catalogInput}
                agregadoId={editingId}
                resolveMediaUrl={resolveImageUrl}
              />
            ) : null}
          </div>
        </div>
      )}

      {/* Tab: Herrajes (#1451) — un hogar, tres niveles de anclaje */}
      {editorTab === 'hardware' && (
        <div
          className="agregado-editor__panel"
          id="agregado-editor-panel-hardware"
          role="tabpanel"
          aria-labelledby="agregado-editor-tab-hardware"
          data-testid="agregado-tab-hardware"
        >
          <div
            className={
              catalogInput
                ? 'agregado-editor__components-layout agregado-editor__components-layout--with-preview'
                : 'agregado-editor__components-layout'
            }
          >
            <div className="agregado-editor__components-list">
              <div className="agregado-editor__panel-header">
                <p className="catalog-form__hint">
                  Cada herraje vive en un nivel: del cajón (anclado a la caja del
                  agregado), por cantidad (insumo sin posición) o de una pieza
                  (cara + perforaciones). Un herraje tiene un solo nivel y una
                  sola línea de compra.
                </p>
                <button
                  type="button"
                  className="btn btn--secondary btn--small"
                  onClick={() => setHwChooserOpen((open) => !open)}
                  aria-expanded={hwChooserOpen}
                  data-testid="agregado-add-hardware"
                >
                  <Plus size={14} /> Añadir herraje
                </button>
              </div>

              {hwChooserOpen ? (
                <div
                  className="agregado-editor__hw-chooser"
                  role="group"
                  aria-label="¿Dónde va este herraje?"
                  data-testid="agregado-hw-chooser"
                >
                  <button
                    type="button"
                    className="btn btn--secondary btn--small"
                    onClick={() => chooseHardwareLevel('cajon')}
                    data-testid="agregado-hw-chooser-cajon"
                  >
                    Del cajón — kit o riel anclado a la caja
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary btn--small"
                    onClick={() => chooseHardwareLevel('pieza')}
                    data-testid="agregado-hw-chooser-pieza"
                  >
                    De una pieza — con cara y perforaciones
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary btn--small"
                    onClick={() => chooseHardwareLevel('cantidad')}
                    data-testid="agregado-hw-chooser-cantidad"
                  >
                    Solo cantidad — insumo sin posición
                  </button>
                </div>
              ) : null}

              {/* Nivel: Del cajón — rigidMembers fixed del borrador (#1412) */}
              <div
                ref={cajonLevelRef}
                className="agregado-editor__hardware-placements"
                aria-label="Herrajes del cajón"
                data-testid="agregado-hw-level-cajon"
              >
                <h4 className="module-editor__section-title">
                  Del cajón (anclado al agregado)
                </h4>
                <p className="catalog-form__hint">
                  Kit de correderas, guías o rieles que pertenecen al cajón
                  entero, no a una pieza. Izquierda y derecha son entradas
                  separadas — nunca un espejo. Se ven en el 3D del borrador.
                </p>
                <AgregadoCajonHardwareSection
                  draft={draft}
                  setDraft={setDraft}
                  catalogHardware={catalogHardware}
                  onAddMember={addAgregadoMember}
                />
              </div>

              {/* Nivel: Por cantidad — hardwareLines sin posición */}
              <div
                ref={cantidadLevelRef}
                className="agregado-editor__hardware-placements"
                aria-label="Herrajes por cantidad"
                data-testid="agregado-hw-level-cantidad"
              >
                <h4 className="module-editor__section-title">
                  Por cantidad (sin posición)
                </h4>
                <p className="catalog-form__hint">
                  Tornillería, perfiles, insumos que se compran a granel: se
                  cotizan por cantidad, sin posición 3D ni perforaciones.
                </p>
                {draft.hardwareLines.length === 0 ? (
                  <div
                    className="agregado-editor__empty-slot"
                    data-testid="agregado-hw-cantidad-empty"
                  >
                    Sin herrajes por cantidad. Tornillería e insumos van acá.
                  </div>
                ) : (
                  <ul className="agregado-editor__item-list">
                    {draft.hardwareLines.map((hw, idx) => {
                      const lineMode =
                        hw.optionRole && !hw.hardwareId ? 'grupo' : 'especifico';
                      const selectedGroup = hardwareRoles.find((g) => g.code === hw.optionRole);
                      return (
                      <li key={idx} className="agregado-editor__item-row">
                        <div className="agregado-editor__item-fields">
                          {hardwareRoles.length > 0 ? (
                            <div className="catalog-form__field">
                              <label
                                className="catalog-form__label"
                                htmlFor={`agregado-hw-${idx}-mode`}
                              >
                                Modo
                              </label>
                              <select
                                id={`agregado-hw-${idx}-mode`}
                                className="catalog-form__select"
                                value={lineMode}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                                  if (e.target.value === 'grupo') {
                                    updateHardwareLine(idx, {
                                      hardwareId: undefined,
                                      // #1147: sin rol elegido la línea queda
                                      // inválida-visible; nunca se inventa uno.
                                      optionRole: hw.optionRole ?? '',
                                    });
                                  } else {
                                    updateHardwareLine(idx, {
                                      hardwareId: hw.hardwareId ?? '',
                                      optionRole: undefined,
                                    });
                                  }
                                }}
                                data-testid={`agregado-hw-${idx}-mode`}
                              >
                                <option value="especifico">Herraje específico</option>
                                <option value="grupo">Grupo de opciones</option>
                              </select>
                            </div>
                          ) : null}
                          {lineMode === 'grupo' ? (
                            <div className="catalog-form__field">
                              <label
                                className="catalog-form__label"
                                htmlFor={`agregado-hw-${idx}-role`}
                              >
                                Grupo de herrajes
                              </label>
                              {hardwareRoles.length > 0 ? (
                                /* S4 #1009 + #1046: role is a resolution key for
                                 * pricing and drilling — pick from the catalog's
                                 * hardware option groups. A saved value outside
                                 * the catalog stays visible, never rewritten. */
                                <>
                                  <select
                                    id={`agregado-hw-${idx}-role`}
                                    className="catalog-form__select"
                                    value={hw.optionRole}
                                    onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                                      updateHardwareLine(idx, { optionRole: e.target.value })
                                    }
                                    data-testid={`agregado-hw-${idx}-role`}
                                  >
                                    {!hw.optionRole ? (
                                      <option value="">Seleccionar grupo…</option>
                                    ) : null}
                                    {!hardwareRoles.some((g) => g.code === hw.optionRole) ? (
                                      <option value={hw.optionRole}>
                                        {hw.optionRole} (guardado)
                                      </option>
                                    ) : null}
                                    {hardwareRoles.map((g) => (
                                      <option key={g.id} value={g.code}>
                                        {g.code} — {g.name}
                                      </option>
                                    ))}
                                  </select>
                                  {selectedGroup ? (
                                    <p className="catalog-form__hint" data-testid={`agregado-hw-${idx}-members`}>
                                      {/* #1046: same members-with-cost hint as the
                                       * placements editor — one voice per surface. */}
                                      Se elige al cotizar: {hardwareGroupMembersHint(selectedGroup, catalogHardware)}
                                    </p>
                                  ) : null}
                                </>
                              ) : (
                                <input
                                  id={`agregado-hw-${idx}-role`}
                                  type="text"
                                  className="catalog-form__input"
                                  value={hw.optionRole}
                                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                    updateHardwareLine(idx, { optionRole: e.target.value })
                                  }
                                  placeholder="BISAGRA / CORREDERA / JALADERA"
                                  data-testid={`agregado-hw-${idx}-role`}
                                />
                              )}
                            </div>
                          ) : (
                            <div className="catalog-form__field">
                              <CatalogPicker
                                id={`agregado-hw-${idx}-select`}
                                label="Herraje específico"
                                placeholder="Seleccionar herraje…"
                                searchPlaceholder="Buscar herraje…"
                                value={hw.hardwareId ?? ''}
                                onChange={(hardwareId) =>
                                  updateHardwareLine(idx, {
                                    hardwareId: hardwareId || undefined,
                                  })
                                }
                                items={pickerHardwareItems}
                                data-testid={`agregado-hw-${idx}-select`}
                              />
                            </div>
                          )}
                          <div className="catalog-form__field catalog-form__field--narrow">
                            <label
                              className="catalog-form__label"
                              htmlFor={`agregado-hw-${idx}-qty`}
                            >
                              Cantidad
                            </label>
                            <input
                              id={`agregado-hw-${idx}-qty`}
                              type="number"
                              min={1}
                              className="catalog-form__input"
                              value={hw.quantity}
                              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                updateHardwareLine(idx, {
                                  quantity: Math.max(1, Number(e.target.value) || 1),
                                })
                              }
                              data-testid={`agregado-hw-${idx}-qty`}
                            />
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btn--ghost btn--small btn--icon-only"
                          aria-label="Eliminar herraje"
                          onClick={() => removeHardwareLine(idx)}
                          data-testid={`agregado-hw-${idx}-remove`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Nivel: De las piezas — placements con cara y perforaciones */}
              <div
                ref={piezasLevelRef}
                className="agregado-editor__hardware-placements"
                aria-label="Herrajes de las piezas"
                data-testid="agregado-hw-level-piezas"
              >
                <h4 className="module-editor__section-title">
                  De las piezas (con cara y perforaciones)
                </h4>
                <p className="catalog-form__hint">
                  Cada herraje se ancla a una cara de una pieza: es lo que se ve
                  en la Vista 3D y la base de las perforaciones.
                </p>
                {draft.components.length === 0 ? (
                  <p className="catalog-empty" data-testid="agregado-hw-placements-empty">
                    Sin piezas en el agregado. Si los herrajes son del cajón
                    entero, usá la sección «Del cajón»; si no, agregá piezas en
                    la pestaña Piezas.
                  </p>
                ) : (
                  draft.components.map((comp, idx) => {
                    const info = catalogComponents.find(
                      (c) => c.id === comp.componentId,
                    );
                    return (
                      <div
                        key={idx}
                        className="agregado-editor__piece-hardware"
                        data-testid={`agregado-piece-hardware-${idx}`}
                      >
                        <h5 className="module-part-card__title">
                          {info ? `${info.code} — ${info.name}` : comp.componentId}
                        </h5>
                        <HardwarePlacementsEditor
                          placements={comp.overrides?.hardwarePlacements ?? []}
                          catalogHardware={catalogHardware}
                          optionGroups={optionGroups}
                          containerLabel={info ? info.code : comp.componentId}
                          testIdSuffix={`hw-pc-${idx}`}
                          onChange={(next) => {
                            const current = comp.overrides ?? {};
                            if (!next || next.length === 0) {
                              const { hardwarePlacements: _omit, ...rest } = current;
                              void _omit;
                              updateComponentInstance(idx, {
                                overrides:
                                  Object.keys(rest).length > 0 ? rest : undefined,
                              });
                            } else {
                              updateComponentInstance(idx, {
                                overrides: { ...current, hardwarePlacements: next },
                              });
                            }
                          }}
                        />
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {catalogInput ? (
              <AgregadoEditorPreview3D
                draft={draft}
                catalogInput={catalogInput}
                agregadoId={editingId}
                resolveMediaUrl={resolveImageUrl}
              />
            ) : null}
          </div>
        </div>
      )}
      </form>

      {/* Tab: Receta (#1412) — autoría del borrador + resumen de la guardada */}
      {editorTab === 'recipe' && (
        <AgregadoRecipeAuthoringPanel
          draft={draft}
          setDraft={setDraft}
          catalogHardware={catalogHardware}
          saved={recipeAgregado ?? null}
          onSimulateChange={onSimulateChange}
        />
      )}

      <ModuleComponentAdderModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        componentSearch={pickerSearch}
        onSearchChange={setPickerSearch}
        filteredComponents={filteredPickerComponents}
        newCompId={pickerComponentId}
        onSelect={setPickerComponentId}
        newCompQty={pickerQty}
        onQtyChange={setPickerQty}
        optionGroups={optionGroups}
        onConfirm={confirmComponentPick}
      />
    </>
  );
}
