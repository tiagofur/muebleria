/**
 * #1412 — pestaña «Receta» del editor de agregado: AUTORÍA de la receta del
 * borrador (miembros rígidos, sets de variantes, reglas de compatibilidad y
 * kit comercial). Guardar crea una revisión versionada vía el PUT existente;
 * la validación autoritativa es server-side (aquí sólo anticipamos con los
 * validadores de @granete/domain en el submit). «Receta guardada» queda como
 * resumen de lectura abajo; «Simular cambio» (#1369) sigue comparando contra
 * la revisión guardada, nunca contra este borrador.
 */

import { type ChangeEvent, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type {
  Agregado,
  AgregadoRigidMember,
  AgregadoVariantSet,
  AssemblyAxisRef,
  Hardware,
  RigidMemberBOMRole,
} from '@granete/domain';
import { Plus, Trash2 } from 'lucide-react';
import type { AgregadoDraft } from '../agregadoDraft';
import { AgregadoRecipePanel } from './AgregadoRecipePanel';

export type AgregadoRecipeAuthoringPanelProps = {
  readonly draft: AgregadoDraft;
  readonly setDraft: Dispatch<SetStateAction<AgregadoDraft>>;
  readonly catalogHardware: readonly Hardware[];
  /** La entidad guardada para el resumen de lectura (null en creaciones). */
  readonly saved: Agregado | null;
  readonly onSimulateChange?: () => void;
  readonly testId?: string;
};

const AXIS_REFS: { value: AssemblyAxisRef; label: string }[] = [
  { value: 'min', label: 'Mínimo' },
  { value: 'max', label: 'Máximo' },
  { value: 'center', label: 'Centro' },
];

const BOM_ROLES: { value: RigidMemberBOMRole; label: string }[] = [
  { value: 'included_in_kit', label: 'Incluido en el juego (kit)' },
  { value: 'separately_purchased', label: 'Compra separada' },
  { value: 'non_purchasing', label: 'Solo visual (no se compra)' },
];

const AXIS_NAMES = ['x', 'y', 'z'] as const;

function axisLabel(name: 'x' | 'y' | 'z'): string {
  // Assembly space: +X ancho/dcha, +Y fondo/frente, +Z alto (contrato #670).
  return name === 'x' ? 'X (ancho)' : name === 'y' ? 'Y (fondo)' : 'Z (alto)';
}

function uniqueMemberId(members: readonly AgregadoRigidMember[]): string {
  let n = members.length + 1;
  while (members.some((m) => m.memberId === `miembro-${n}`)) n += 1;
  return `miembro-${n}`;
}

export function AgregadoRecipeAuthoringPanel({
  draft,
  setDraft,
  catalogHardware,
  saved,
  onSimulateChange,
  testId = 'agregado-tab-recipe-authoring',
}: AgregadoRecipeAuthoringPanelProps): ReactNode {
  const members = draft.rigidMembers ?? [];
  const sets = draft.variantSets ?? [];
  const rules = draft.compatibilityRules ?? [];
  const kitId = draft.commercialKitHardwareId ?? '';

  const patchDraft = (patch: Partial<AgregadoDraft>) =>
    setDraft((prev) => ({ ...prev, ...patch }));

  const addMember = () => {
    const kit = kitId !== '';
    const member: AgregadoRigidMember = {
      memberId: uniqueMemberId(members),
      role: members.length === 0 ? 'side_left' : members.length === 1 ? 'side_right' : `rol-${members.length + 1}`,
      source: { kind: 'fixed', fixed: { hardwareId: catalogHardware[0]?.id ?? '' } },
      placement: {
        x: { ref: 'min', offsetMm: 0 },
        y: { ref: 'min', offsetMm: 0 },
        z: { ref: 'min', offsetMm: 0 },
      },
      bomRole: kit ? 'included_in_kit' : 'separately_purchased',
    };
    patchDraft({ rigidMembers: [...members, member] });
  };

  const updateMember = (idx: number, patch: Partial<AgregadoRigidMember>) => {
    patchDraft({
      rigidMembers: members.map((m, i) => (i === idx ? { ...m, ...patch } : m)),
    });
  };

  const removeMember = (idx: number) => {
    patchDraft({ rigidMembers: members.filter((_, i) => i !== idx) });
  };

  const addVariantSet = () => {
    let n = sets.length + 1;
    while (sets.some((s) => s.id === `set-fondo-${n}`)) n += 1;
    const nextSets: AgregadoVariantSet[] = [
      ...sets,
      {
        id: `set-fondo-${n}`,
        dimension: 'depth',
        variants: [
          { nominalDimensionMm: 500, hardwareId: catalogHardware[0]?.id ?? '' },
        ],
      },
    ];
    // Regla de compatibilidad por set (1:1): la resolución exige estrategia y
    // holgura para elegir variante; sin regla el set no se puede resolver.
    const nextRules = [
      ...rules.filter((r) => nextSets.some((s) => s.id === r.variantSetId)),
      ...nextSets
        .filter((s) => !rules.some((r) => r.variantSetId === s.id))
        .map((s) => ({ variantSetId: s.id, clearanceMm: 0, selectionStrategy: 'max_fitting' as const })),
    ];
    patchDraft({ variantSets: nextSets, compatibilityRules: nextRules });
  };

  const updateVariantSet = (idx: number, patch: Partial<AgregadoVariantSet>) => {
    patchDraft({
      variantSets: sets.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    });
  };

  const removeVariantSet = (idx: number) => {
    const nextSets = sets.filter((_, i) => i !== idx);
    patchDraft({
      variantSets: nextSets,
      compatibilityRules: rules.filter((r) => nextSets.some((s) => s.id === r.variantSetId)),
    });
  };

  const updateRule = (
    variantSetId: string,
    patch: Partial<{ clearanceMm: number; selectionStrategy: 'max_fitting' | 'exact' }>,
  ) => {
    patchDraft({
      compatibilityRules: rules.map((r) =>
        r.variantSetId === variantSetId ? { ...r, ...patch } : r,
      ),
    });
  };

  return (
    <div
      className="agregado-editor__panel agregado-recipe"
      id="agregado-editor-panel-recipe"
      role="tabpanel"
      aria-labelledby="agregado-editor-tab-recipe"
      data-testid={testId}
    >
      <div className="agregado-editor__panel-header">
        <h4 className="module-editor__section-title">Receta del ensamble</h4>
      </div>
      <p className="catalog-form__hint">
        Herrajes comprados que cuelgan del agregado (guías, correderas, herrajes de
        cajón): se posicionan por anclaje y viajan como una revisión al guardar. La
        izquierda y la derecha son miembros separados — nunca un espejo.
      </p>

      {/* Kit comercial */}
      <section className="agregado-recipe__section" aria-label="Kit comercial">
        <h5>Kit comercial</h5>
        <div className="catalog-form__field">
          <label className="catalog-form__label" htmlFor={`${testId}-kit`}>
            Herraje que se vende como juego
          </label>
          <select
            id={`${testId}-kit`}
            className="catalog-form__select"
            value={kitId}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              patchDraft({ commercialKitHardwareId: e.target.value || undefined })
            }
            data-testid={`${testId}-kit`}
          >
            <option value="">Sin kit (compra separada)</option>
            {catalogHardware.map((h) => (
              <option key={h.id} value={h.id}>
                {h.code} — {h.name}
              </option>
            ))}
          </select>
          <p className="catalog-form__hint">
            Los miembros «incluido en el juego» no generan línea de compra propia: el
            kit cotiza una vez.
          </p>
        </div>
      </section>

      {/* Miembros rígidos */}
      <section className="agregado-recipe__section" aria-label="Miembros rígidos">
        <div className="agregado-editor__panel-header">
          <h5>Miembros rígidos ({members.length})</h5>
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={addMember}
            disabled={catalogHardware.length === 0}
            data-testid={`${testId}-add-member`}
          >
            <Plus size={14} /> Añadir miembro
          </button>
        </div>
        {members.length === 0 ? (
          <p className="catalog-empty">
            Sin miembros. Un miembro es una parte comprada del ensamble (una
            corredera, una guía) que se ancla al espacio del agregado y nunca se
            escala.
          </p>
        ) : (
          <ul className="agregado-editor__item-list">
            {members.map((m, idx) => {
              const membershipKind =
                m.actorMembership === 'body'
                  ? 'body'
                  : m.actorMembership !== undefined && m.actorMembership.startsWith('actor:')
                  ? 'actor'
                  : 'none';
              const actorId =
                membershipKind === 'actor' && m.actorMembership !== undefined
                  ? m.actorMembership.slice('actor:'.length)
                  : '';
              return (
                <li
                  key={idx}
                  className="agregado-editor__item-row agregado-editor__item-row--block"
                  data-testid={`${testId}-member-${idx}`}
                >
                  <div className="agregado-editor__item-header agregado-editor__item-header--flex">
                    <strong className="agregado-editor__item-title">{m.memberId}</strong>
                    <button
                      type="button"
                      className="btn btn--ghost btn--small btn--icon-only"
                      aria-label={`Eliminar miembro ${m.memberId}`}
                      onClick={() => removeMember(idx)}
                      data-testid={`${testId}-member-${idx}-remove`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  <div className="agregado-editor__item-fields agregado-editor__item-fields--grid">
                    <div className="catalog-form__field">
                      <label className="catalog-form__label">ID del miembro</label>
                      <input
                        type="text"
                        className="catalog-form__input"
                        value={m.memberId}
                        onChange={(e) => updateMember(idx, { memberId: e.target.value })}
                        data-testid={`${testId}-member-${idx}-id`}
                      />
                    </div>
                    <div className="catalog-form__field">
                      <label className="catalog-form__label">Rol</label>
                      <input
                        type="text"
                        className="catalog-form__input"
                        value={m.role}
                        placeholder="side_left / runner_right…"
                        onChange={(e) => updateMember(idx, { role: e.target.value })}
                        data-testid={`${testId}-member-${idx}-role`}
                      />
                    </div>
                    <div className="catalog-form__field">
                      <label className="catalog-form__label">Origen</label>
                      <select
                        className="catalog-form__select"
                        value={m.source.kind}
                        onChange={(e) => {
                          const kind = e.target.value as 'fixed' | 'variant';
                          updateMember(
                            idx,
                            kind === 'fixed'
                              ? {
                                  source: {
                                    kind,
                                    fixed: {
                                      hardwareId: catalogHardware[0]?.id ?? '',
                                    },
                                  },
                                }
                              : {
                                  source: {
                                    kind,
                                    variant: { variantSetId: sets[0]?.id ?? '' },
                                  },
                                },
                          );
                        }}
                        data-testid={`${testId}-member-${idx}-source-kind`}
                      >
                        <option value="fixed">Fijo: herraje específico</option>
                        <option value="variant" disabled={sets.length === 0}>
                          Variante: según set {sets.length === 0 ? '(sin sets)' : ''}
                        </option>
                      </select>
                    </div>
                    {m.source.kind === 'fixed' ? (
                      <div className="catalog-form__field">
                        <label className="catalog-form__label">Herraje</label>
                        <select
                          className="catalog-form__select"
                          value={m.source.fixed?.hardwareId ?? ''}
                          onChange={(e) =>
                            updateMember(idx, {
                              source: {
                                kind: 'fixed',
                                fixed: { hardwareId: e.target.value },
                              },
                            })
                          }
                          data-testid={`${testId}-member-${idx}-source-hardware`}
                        >
                          <option value="" disabled>
                            Seleccionar herraje…
                          </option>
                          {catalogHardware.map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.code} — {h.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="catalog-form__field">
                        <label className="catalog-form__label">Set de variantes</label>
                        <select
                          className="catalog-form__select"
                          value={m.source.variant?.variantSetId ?? ''}
                          onChange={(e) =>
                            updateMember(idx, {
                              source: {
                                kind: 'variant',
                                variant: { variantSetId: e.target.value },
                              },
                            })
                          }
                          data-testid={`${testId}-member-${idx}-source-variantset`}
                        >
                          <option value="" disabled>
                            Seleccionar set…
                          </option>
                          {sets.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.id} ({s.dimension})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="catalog-form__field">
                      <label className="catalog-form__label">Compra</label>
                      <select
                        className="catalog-form__select"
                        value={m.bomRole}
                        onChange={(e) =>
                          updateMember(idx, { bomRole: e.target.value as RigidMemberBOMRole })
                        }
                        data-testid={`${testId}-member-${idx}-bom-role`}
                      >
                        {BOM_ROLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="catalog-form__field">
                      <label className="catalog-form__label">Membresía (fijo/móvil)</label>
                      <select
                        className="catalog-form__select"
                        value={membershipKind}
                        onChange={(e) => {
                          const kind = e.target.value;
                          updateMember(idx, {
                            actorMembership:
                              kind === 'body'
                                ? 'body'
                                : kind === 'actor'
                                ? `actor:${actorId || 'drawer'}`
                                : undefined,
                          });
                        }}
                        data-testid={`${testId}-member-${idx}-membership`}
                      >
                        <option value="none">Sin membresía</option>
                        <option value="body">Fijo al cuerpo</option>
                        <option value="actor">Parte móvil (actor)</option>
                      </select>
                    </div>
                    {membershipKind === 'actor' ? (
                      <div className="catalog-form__field">
                        <label className="catalog-form__label">ID del actor</label>
                        <input
                          type="text"
                          className="catalog-form__input"
                          value={actorId}
                          placeholder="drawer"
                          onChange={(e) =>
                            updateMember(idx, { actorMembership: `actor:${e.target.value.trim()}` })
                          }
                          data-testid={`${testId}-member-${idx}-membership-actor`}
                        />
                      </div>
                    ) : null}
                  </div>

                  {/* Anclaje */}
                  <div className="agregado-editor__item-fields agregado-editor__item-fields--grid">
                    {AXIS_NAMES.map((axis) => (
                      <div className="catalog-form__field" key={axis}>
                        <label className="catalog-form__label">{axisLabel(axis)}</label>
                        <div className="agregado-recipe__axis">
                          <select
                            className="catalog-form__select"
                            value={m.placement[axis].ref}
                            onChange={(e) =>
                              updateMember(idx, {
                                placement: {
                                  ...m.placement,
                                  [axis]: {
                                    ...m.placement[axis],
                                    ref: e.target.value as AssemblyAxisRef,
                                  },
                                },
                              })
                            }
                            aria-label={`${axisLabel(axis)} referencia`}
                            data-testid={`${testId}-member-${idx}-anchor-${axis}-ref`}
                          >
                            {AXIS_REFS.map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            className="catalog-form__input"
                            value={m.placement[axis].offsetMm}
                            onChange={(e) =>
                              updateMember(idx, {
                                placement: {
                                  ...m.placement,
                                  [axis]: {
                                    ...m.placement[axis],
                                    offsetMm: Number(e.target.value) || 0,
                                  },
                                },
                              })
                            }
                            aria-label={`${axisLabel(axis)} offset mm`}
                            data-testid={`${testId}-member-${idx}-anchor-${axis}-offset`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <details className="agregado-recipe__advanced">
                    <summary>Rotación (avanzado)</summary>
                    <div className="agregado-editor__item-fields agregado-editor__item-fields--grid">
                      {AXIS_NAMES.map((axis) => (
                        <div className="catalog-form__field" key={axis}>
                          <label className="catalog-form__label">
                            {axisLabel(axis)} (°)
                          </label>
                          <input
                            type="number"
                            className="catalog-form__input"
                            value={m.placement.rotationDeg?.[axis] ?? 0}
                            onChange={(e) => {
                              const current = m.placement.rotationDeg ?? {};
                              const next = {
                                ...current,
                                [axis]: Number(e.target.value) || 0,
                              };
                              updateMember(idx, { placement: { ...m.placement, rotationDeg: next } });
                            }}
                            data-testid={`${testId}-member-${idx}-rotation-${axis}`}
                          />
                        </div>
                      ))}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Sets de variantes */}
      <section className="agregado-recipe__section" aria-label="Sets de variantes">
        <div className="agregado-editor__panel-header">
          <h5>Sets de variantes ({sets.length})</h5>
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={addVariantSet}
            disabled={catalogHardware.length === 0}
            data-testid={`${testId}-add-set`}
          >
            <Plus size={14} /> Añadir set
          </button>
        </div>
        <p className="catalog-form__hint">
          Tamaños comerciales del mismo herraje (p. ej. corredera 450/500): la
          resolución elige la variante más grande que entre, según la holgura.
        </p>
        {sets.length === 0 ? (
          <p className="catalog-empty">Sin sets de variantes.</p>
        ) : (
          <ul className="agregado-editor__item-list">
            {sets.map((s, idx) => {
              const rule = rules.find((r) => r.variantSetId === s.id);
              return (
                <li
                  key={idx}
                  className="agregado-editor__item-row agregado-editor__item-row--block"
                  data-testid={`${testId}-set-${idx}`}
                >
                  <div className="agregado-editor__item-header agregado-editor__item-header--flex">
                    <strong className="agregado-editor__item-title">{s.id}</strong>
                    <button
                      type="button"
                      className="btn btn--ghost btn--small btn--icon-only"
                      aria-label={`Eliminar set ${s.id}`}
                      onClick={() => removeVariantSet(idx)}
                      data-testid={`${testId}-set-${idx}-remove`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="agregado-editor__item-fields agregado-editor__item-fields--grid">
                    <div className="catalog-form__field">
                      <label className="catalog-form__label">ID del set</label>
                      <input
                        type="text"
                        className="catalog-form__input"
                        value={s.id}
                        onChange={(e) => updateVariantSet(idx, { id: e.target.value })}
                        data-testid={`${testId}-set-${idx}-id`}
                      />
                    </div>
                    <div className="catalog-form__field">
                      <label className="catalog-form__label">Dimensión</label>
                      <select
                        className="catalog-form__select"
                        value={s.dimension}
                        onChange={(e) =>
                          updateVariantSet(idx, {
                            dimension: e.target.value as AgregadoVariantSet['dimension'],
                          })
                        }
                        data-testid={`${testId}-set-${idx}-dimension`}
                      >
                        <option value="depth">Fondo</option>
                        <option value="height">Alto</option>
                        <option value="width">Ancho</option>
                      </select>
                    </div>
                    <div className="catalog-form__field">
                      <label className="catalog-form__label">Holgura (mm)</label>
                      <input
                        type="number"
                        className="catalog-form__input"
                        min={0}
                        value={rule?.clearanceMm ?? 0}
                        onChange={(e) =>
                          updateRule(s.id, { clearanceMm: Math.max(0, Number(e.target.value) || 0) })
                        }
                        data-testid={`${testId}-set-${idx}-rule-clearance`}
                      />
                    </div>
                    <div className="catalog-form__field">
                      <label className="catalog-form__label">Estrategia</label>
                      <select
                        className="catalog-form__select"
                        value={rule?.selectionStrategy ?? 'max_fitting'}
                        onChange={(e) =>
                          updateRule(s.id, {
                            selectionStrategy: e.target.value as 'max_fitting' | 'exact',
                          })
                        }
                        data-testid={`${testId}-set-${idx}-rule-strategy`}
                      >
                        <option value="max_fitting">La más grande que entre</option>
                        <option value="exact">Exacta</option>
                      </select>
                    </div>
                  </div>
                  <div className="agregado-editor__item-fields">
                    <label className="catalog-form__label">Variantes</label>
                    {s.variants.map((v, vIdx) => (
                      <div className="agregado-recipe__variant" key={vIdx}>
                        <input
                          type="number"
                          className="catalog-form__input"
                          min={1}
                          value={v.nominalDimensionMm}
                          aria-label="Medida nominal mm"
                          onChange={(e) => {
                            const nominal = Number(e.target.value) || 0;
                            const variants = s.variants.map((vv, i) =>
                              i === vIdx ? { ...vv, nominalDimensionMm: nominal } : vv,
                            );
                            updateVariantSet(idx, { variants });
                          }}
                          data-testid={`${testId}-set-${idx}-variant-${vIdx}-nominal`}
                        />
                        <span className="agregado-recipe__variant-mm">mm</span>
                        <select
                          className="catalog-form__select"
                          value={v.hardwareId}
                          aria-label="Herraje de la variante"
                          onChange={(e) => {
                            const variants = s.variants.map((vv, i) =>
                              i === vIdx ? { ...vv, hardwareId: e.target.value } : vv,
                            );
                            updateVariantSet(idx, { variants });
                          }}
                          data-testid={`${testId}-set-${idx}-variant-${vIdx}-hardware`}
                        >
                          <option value="" disabled>
                            Herraje…
                          </option>
                          {catalogHardware.map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.code} — {h.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn btn--ghost btn--small btn--icon-only"
                          aria-label="Eliminar variante"
                          disabled={s.variants.length <= 1}
                          onClick={() =>
                            updateVariantSet(idx, {
                              variants: s.variants.filter((_, i) => i !== vIdx),
                            })
                          }
                          data-testid={`${testId}-set-${idx}-variant-${vIdx}-remove`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn btn--ghost btn--small"
                      onClick={() =>
                        updateVariantSet(idx, {
                          variants: [
                            ...s.variants,
                            {
                              nominalDimensionMm:
                                Math.max(0, ...s.variants.map((vv) => vv.nominalDimensionMm)) + 50,
                              hardwareId: catalogHardware[0]?.id ?? '',
                            },
                          ],
                        })
                      }
                      data-testid={`${testId}-set-${idx}-add-variant`}
                    >
                      <Plus size={13} /> Añadir variante
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Receta guardada (lectura, #1369) */}
      <details className="agregado-recipe__saved">
        <summary>Receta guardada (lectura)</summary>
        <AgregadoRecipePanel
          saved={saved}
          catalogHardware={catalogHardware}
          onSimulateChange={onSimulateChange}
          testId={`${testId}-saved`}
        />
      </details>
    </div>
  );
}
