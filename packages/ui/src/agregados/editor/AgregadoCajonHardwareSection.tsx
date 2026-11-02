/**
 * Nivel «Del agregado» de la pestaña Herrajes (#1451): autoría común de los
 * miembros rígidos FIXED de la receta del borrador (`draft.rigidMembers`,
 * #1412) con vocabulario de taller — «borde izq./centro/borde der. + mm»,
 * «¿se mueve con una parte?», «compra». Aplica a CUALQUIER agregado (el kit
 * de correderas de un cajón fue el caso seminal, pero son las bisagras de una
 * puerta o los soportes de un entrepaño también). Edita el MISMO array que la
 * pestaña Receta: acá vive lo común (herraje, lado, movimiento, compra); los
 * sets de variantes, la rotación y la identidad avanzada siguen en Receta, y
 * un miembro variante se muestra read-only con puntero.
 *
 * Invariante de paridad (#670/#1412): izquierda y derecha son miembros
 * separados, nunca un espejo — la plantilla «Kit con par izq/der» crea
 * registros explícitos por lado.
 */

import {
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type {
  AgregadoRigidMember,
  AssemblyAxisRef,
  Hardware,
  RigidMemberBOMRole,
} from '@granete/domain';
import { Plus, Trash2 } from 'lucide-react';
import { CatalogPicker } from '../../catalogs/CatalogPicker';
import { isKitDerivedMember, KitCommercialPicker, kitPartsOf } from './KitCommercialPicker';
import type { AgregadoDraft } from '../agregadoDraft';

export type AgregadoCajonHardwareSectionProps = {
  readonly draft: AgregadoDraft;
  readonly setDraft: Dispatch<SetStateAction<AgregadoDraft>>;
  readonly catalogHardware: readonly Hardware[];
  /** Fábrica de miembro del form (la comparte el chooser «+ Añadir herraje»). */
  readonly onAddMember: () => void;
  /** #1460: abrir el juego comercial en Catálogos. Ausente ⇒ CTA oculto. */
  readonly onEditKit?: (kitHardwareId: string) => void;
  readonly testId?: string;
};

/** Vocabulario único de compra para el miembro (#1451: misma voz en Herrajes y Receta). */
export const BOM_ROLES: { value: RigidMemberBOMRole; label: string }[] = [
  { value: 'included_in_kit', label: 'Incluido en el juego (kit)' },
  { value: 'separately_purchased', label: 'Compra separada' },
  { value: 'non_purchasing', label: 'Solo visual (no se compra)' },
];

export function uniqueMemberId(members: readonly AgregadoRigidMember[]): string {
  let n = members.length + 1;
  while (members.some((m) => m.memberId === `miembro-${n}`)) n += 1;
  return `miembro-${n}`;
}

export function axisLabel(name: 'x' | 'y' | 'z'): string {
  // Assembly space: +X ancho/dcha, +Y fondo/frente, +Z alto (contrato #670).
  return name === 'x' ? 'X (ancho)' : name === 'y' ? 'Y (fondo)' : 'Z (alto)';
}

const SIDE_REFS: { value: AssemblyAxisRef; label: string }[] = [
  { value: 'min', label: 'Borde izquierdo' },
  { value: 'center', label: 'Centro' },
  { value: 'max', label: 'Borde derecho' },
];

function membershipKind(m: AgregadoRigidMember): 'none' | 'body' | 'actor' {
  if (m.actorMembership === 'body') return 'body';
  if (m.actorMembership !== undefined && m.actorMembership.startsWith('actor:')) return 'actor';
  return 'none';
}

export function AgregadoCajonHardwareSection({
  draft,
  setDraft,
  catalogHardware,
  onAddMember,
  onEditKit,
  testId = 'agregado-cajon-hardware',
}: AgregadoCajonHardwareSectionProps): ReactNode {
  const members = draft.rigidMembers ?? [];
  const kitId = draft.commercialKitHardwareId ?? '';
  // #1460: resumen de pendientes — «Kit con par izq/der» deja 4 tarjetas con
  // herraje vacío a propósito; el fail-closed por tarjeta no cambia, pero el
  // estado se narra como pendiente y no como catástrofe.
  const pendingCount = members.filter(
    (m) =>
      m.source.kind === 'fixed' &&
      !(m.source.fixed?.hardwareId ?? '').trim(),
  ).length;

  // #1460: el kit manda. Los miembros cuya parte pertenece al juego seleccionado
  // se muestran en UNA tarjeta resumen de solo lectura; lo añadido a mano
  // conserva su tarjeta editable. Los índices originales viajan para que
  // update/remove sigan apuntando al array del draft.
  const kitEntity = kitId
    ? catalogHardware.find((h) => h.id === kitId)
    : undefined;
  const kitPartIds = new Set(
    kitPartsOf(catalogHardware, kitId).map((h) => h.id),
  );
  const memberEntries = members.map((m, idx) => ({ m, idx }));
  const ownEntries = memberEntries.filter(
    ({ m }) => !isKitDerivedMember(m, kitPartIds),
  );
  const kitEntries = memberEntries.filter(({ m }) =>
    isKitDerivedMember(m, kitPartIds),
  );
  const hardwareCode = (hardwareId: string): string =>
    catalogHardware.find((h) => h.id === hardwareId)?.code ?? hardwareId;
  const memberSide = (m: AgregadoRigidMember): string => {
    if (m.placement.x.ref === 'center') return 'centrado';
    return m.placement.x.ref === 'max' ? 'derecha' : 'izquierda';
  };

  const patchDraft = (patch: Partial<AgregadoDraft>) =>
    setDraft((prev) => ({ ...prev, ...patch }));

  const updateMember = (idx: number, patch: Partial<AgregadoRigidMember>) => {
    patchDraft({
      rigidMembers: members.map((m, i) => (i === idx ? { ...m, ...patch } : m)),
    });
  };

  const removeMember = (idx: number) => {
    patchDraft({ rigidMembers: members.filter((_, i) => i !== idx) });
  };

  // Plantilla del taller: guías fijas + correderas móviles, izquierda y
  // derecha como miembros separados (nunca espejo). Herraje vacío a propósito:
  // el usuario elige el herraje real en cada tarjeta — sin default encubierto.
  const [presetConfirm, setPresetConfirm] = useState(false);
  const applyPairPreset = () => {
    const bomRole: AgregadoRigidMember['bomRole'] =
      kitId !== '' ? 'included_in_kit' : 'separately_purchased';
    const mk = (
      id: string,
      role: string,
      ref: 'min' | 'max',
      sign: 1 | -1,
      membership: string,
    ): AgregadoRigidMember => ({
      memberId: id,
      role,
      source: { kind: 'fixed', fixed: { hardwareId: '' } },
      placement: {
        x: { ref, offsetMm: sign * 10 },
        y: { ref: 'min', offsetMm: 0 },
        z: { ref: 'min', offsetMm: 0 },
      },
      bomRole,
      actorMembership: membership,
    });
    patchDraft({
      rigidMembers: [
        mk('fixed_rail_left', 'fixed_rail', 'min', 1, 'body'),
        mk('fixed_rail_right', 'fixed_rail', 'max', -1, 'body'),
        mk('moving_rail_left', 'moving_rail', 'min', 1, 'actor:drawer'),
        mk('moving_rail_right', 'moving_rail', 'max', -1, 'actor:drawer'),
      ],
    });
  };

  const hardwareItems = catalogHardware.map((h) => ({
    id: h.id,
    code: h.code,
    name: h.name,
    active: h.active,
  }));

  return (
    <div className="agregado-cajon-hardware" data-testid={testId}>
      <div className="agregado-editor__panel-header">
        <div className="agregado-editor__panel-actions">
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={() => {
              if (members.length === 0) {
                applyPairPreset();
                return;
              }
              setPresetConfirm(true);
            }}
            disabled={catalogHardware.length === 0}
            title="Arma 4 miembros: guías fijas y correderas móviles, izquierda y derecha separadas"
            data-testid={`${testId}-preset-pair`}
          >
            Kit con par izq/der
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={onAddMember}
            disabled={catalogHardware.length === 0}
            data-testid={`${testId}-add-member`}
          >
            <Plus size={14} /> Añadir herraje del agregado
          </button>
        </div>
      </div>

      {presetConfirm ? (
        <div
          className="agregado-recipe__preset-confirm"
          role="alertdialog"
          aria-label="Confirmar reemplazo de herrajes del agregado"
          data-testid={`${testId}-preset-confirm`}
        >
          <span>
            ¿Reemplazar los {members.length} herraje(s) del agregado por la
            plantilla del kit?
          </span>
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={() => {
              applyPairPreset();
              setPresetConfirm(false);
            }}
            data-testid={`${testId}-preset-confirm-yes`}
          >
            Reemplazar
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={() => setPresetConfirm(false)}
            data-testid={`${testId}-preset-confirm-no`}
          >
            Cancelar
          </button>
        </div>
      ) : null}

      {/* #1460: mismo picker que Receta — única superficie para el kit, sólo
          juegos reales (unit === 'set') y con feedback de sus partes. */}
      <div className="catalog-form__field">
        <KitCommercialPicker
          catalogHardware={catalogHardware}
          value={kitId}
          onChange={(hardwareId) =>
            patchDraft({ commercialKitHardwareId: hardwareId })
          }
          label="Kit comercial (el juego que se vende junto)"
          id={`${testId}-kit`}
          testId={`${testId}-kit`}
        />
      </div>

      {/* #1460 — tarjeta única del kit: los subitems del juego NO se editan
          acá; viven en Catálogos y el sync los re-deriva. */}
      {kitId ? (
        <div
          className="agregado-editor__item-row agregado-editor__item-row--block"
          data-testid={`${testId}-kit-card`}
        >
          <div className="agregado-editor__item-header">
            <strong className="agregado-editor__item-title">
              <span className="catalog-badge catalog-badge--kit">Kit comercial</span>{' '}
              {kitEntity ? (
                <span className="eng-detail__mono">
                  {kitEntity.code} — {kitEntity.name}
                </span>
              ) : null}
            </strong>
          </div>
          {kitEntity ? (
            <>
              <p className="catalog-form__hint">
                {kitEntries.length} herraje(s) incluido(s) en el juego · cotiza
                una vez. Los subitems se administran en Catálogos — el juego
                manda.
              </p>
              {kitEntries.length > 0 ? (
                <div className="agregado-editor__item-fields">
                  {kitEntries.map(({ m, idx }) => (
                    <p
                      key={m.memberId}
                      className="catalog-form__hint"
                      data-testid={`${testId}-kit-member-${idx}`}
                    >
                      <span className="eng-detail__mono">{m.memberId}</span>
                      {' · '}
                      {hardwareCode(m.source.fixed?.hardwareId ?? '')}
                      {' · '}
                      {memberSide(m)}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="catalog-form__hint">
                  El juego todavía no sincronizó partes: crealas en Catálogos
                  (herrajes con «parte de kit»).
                </p>
              )}
              {onEditKit ? (
                <button
                  type="button"
                  className="btn btn--secondary btn--small"
                  onClick={() => onEditKit(kitId)}
                  data-testid={`${testId}-kit-card-edit`}
                >
                  Editar juego en Catálogos
                </button>
              ) : null}
            </>
          ) : (
            <p
              className="catalog-form__error"
              role="alert"
              data-testid={`${testId}-kit-card-missing`}
            >
              El juego asignado ya no existe en el catálogo: elegí otro o quitá
              el kit.
            </p>
          )}
        </div>
      ) : null}

      {ownEntries.length === 0 ? (
        <p className="catalog-empty" data-testid={`${testId}-empty`}>
          {kitId
            ? 'El juego comercial cubre los herrajes del ensamble. Si necesitás otro herraje anclado al agregado, añadilo con «Añadir herraje del agregado».'
            : 'Sin herrajes del agregado. El kit de correderas de un cajón, las bisagras de una puerta o un riel central van acá: se anclan a la caja del ensamble — no a una pieza —, se ven en el 3D y viajan como revisión al guardar.'}
        </p>
      ) : (
        <ul className="agregado-editor__item-list">
          {pendingCount > 0 ? (
            <li>
              <p
                className="catalog-form__hint"
                role="status"
                data-testid={`${testId}-pending-summary`}
              >
                Pendiente: {pendingCount} de {ownEntries.length} sin herraje —
                el guardado espera la receta completa.
              </p>
            </li>
          ) : null}
          {ownEntries.map(({ m, idx }) => {
            const sideLabel = (ref: AssemblyAxisRef): string =>
              SIDE_REFS.find((r) => r.value === ref)?.label ?? ref;
            if (m.source.kind === 'variant') {
              return (
                <li
                  key={idx}
                  className="agregado-editor__item-row"
                  data-testid={`${testId}-member-${idx}-variant`}
                >
                  <span className="eng-detail__list-main eng-detail__mono">
                    {m.memberId}
                  </span>
                  <p className="catalog-form__hint">
                    Variante del set «{m.source.variant?.variantSetId}»: el herraje
                    se elige por medida al cotizar. Se edita en la pestaña Receta.
                  </p>
                </li>
              );
            }
            const hwId = m.source.fixed?.hardwareId ?? '';
            const membership = membershipKind(m);
            const actorId =
              membership === 'actor' && m.actorMembership !== undefined
                ? m.actorMembership.slice('actor:'.length)
                : '';
            return (
              <li
                key={idx}
                className="agregado-editor__item-row agregado-editor__item-row--block"
                data-testid={`${testId}-member-${idx}`}
              >
                <div className="agregado-editor__item-header agregado-editor__item-header--flex">
                  <strong className="agregado-editor__item-title">
                    {m.memberId}
                    {sideLabel(m.placement.x.ref) === 'Borde derecho' ? ' · derecha' : ''}
                    {sideLabel(m.placement.x.ref) === 'Borde izquierdo' ? ' · izquierda' : ''}
                    {m.placement.x.ref === 'center' ? ' · centrado' : ''}
                  </strong>
                  <button
                    type="button"
                    className="btn btn--ghost btn--small btn--icon-only"
                    aria-label={`Quitar herraje del agregado ${m.memberId}`}
                    onClick={() => removeMember(idx)}
                    data-testid={`${testId}-member-${idx}-remove`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

                <div className="agregado-editor__item-fields agregado-editor__item-fields--grid">
                  <div className="catalog-form__field">
                    <CatalogPicker
                      id={`${testId}-member-${idx}-hardware`}
                      label="Herraje"
                      placeholder="Seleccionar herraje…"
                      searchPlaceholder="Buscar herraje…"
                      value={hwId}
                      onChange={(hardwareId) =>
                        updateMember(idx, {
                          source: { kind: 'fixed', fixed: { hardwareId } },
                        })
                      }
                      items={hardwareItems}
                      data-testid={`${testId}-member-${idx}-hardware`}
                    />
                    {hwId === '' ? (
                      <p
                        className="catalog-form__error"
                        role="alert"
                        data-testid={`${testId}-member-${idx}-identity-error`}
                      >
                        Elegí un herraje: sin herraje este elemento no resuelve y
                        bloquea el guardado.
                      </p>
                    ) : null}
                  </div>
                  <div className="catalog-form__field">
                    <label
                      className="catalog-form__label"
                      htmlFor={`${testId}-member-${idx}-lado`}
                    >
                      Desde
                    </label>
                    <select
                      id={`${testId}-member-${idx}-lado`}
                      className="catalog-form__select"
                      value={m.placement.x.ref}
                      onChange={(e) =>
                        updateMember(idx, {
                          placement: {
                            ...m.placement,
                            x: {
                              ...m.placement.x,
                              ref: e.target.value as AssemblyAxisRef,
                            },
                          },
                        })
                      }
                      data-testid={`${testId}-member-${idx}-lado`}
                    >
                      {SIDE_REFS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="catalog-form__field">
                    <label
                      className="catalog-form__label"
                      htmlFor={`${testId}-member-${idx}-offset-x`}
                    >
                      Desplazamiento (mm)
                    </label>
                    <input
                      id={`${testId}-member-${idx}-offset-x`}
                      type="text"
                      className="catalog-form__input"
                      value={m.placement.x.offsetFormula ?? String(m.placement.x.offsetMm)}
                      onChange={(e) => {
                        const raw = e.target.value;
                        // Vacío → 0 sin fórmula; número → mm; lo demás es
                        // fórmula acotada (#1418: PW/PH/PD). Mismo parseo que
                        // Receta para que ambas superficies no pisen datos.
                        const isPlainNumber =
                          raw.trim() !== '' && !Number.isNaN(Number(raw));
                        updateMember(idx, {
                          placement: {
                            ...m.placement,
                            x: {
                              ...m.placement.x,
                              offsetMm: isPlainNumber
                                ? Number(raw)
                                : raw.trim() === ''
                                ? 0
                                : m.placement.x.offsetMm,
                              offsetFormula:
                                isPlainNumber || raw.trim() === '' ? undefined : raw,
                            },
                          },
                        });
                      }}
                      placeholder="ej. 10 ó PW/2 - 100"
                      data-testid={`${testId}-member-${idx}-offset-x`}
                    />
                  </div>
                  <div className="catalog-form__field">
                    <label
                      className="catalog-form__label"
                      htmlFor={`${testId}-member-${idx}-membership`}
                    >
                      ¿Se mueve con una parte?
                    </label>
                    <select
                      id={`${testId}-member-${idx}-membership`}
                      className="catalog-form__select"
                      value={membership}
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
                      <option value="body">No — fijo al agregado</option>
                      <option value="actor">Sí — parte móvil (se traslada)</option>
                      <option value="none">Sin membresía</option>
                    </select>
                  </div>
                  {membership === 'actor' ? (
                    <div className="catalog-form__field">
                      <label
                        className="catalog-form__label"
                        htmlFor={`${testId}-member-${idx}-membership-actor`}
                      >
                        Parte móvil
                      </label>
                      <input
                        id={`${testId}-member-${idx}-membership-actor`}
                        type="text"
                        className="catalog-form__input"
                        value={actorId}
                        placeholder="drawer"
                        onChange={(e) =>
                          updateMember(idx, {
                            actorMembership: `actor:${e.target.value.trim()}`,
                          })
                        }
                        data-testid={`${testId}-member-${idx}-membership-actor`}
                      />
                    </div>
                  ) : null}
                  <div className="catalog-form__field">
                    <label
                      className="catalog-form__label"
                      htmlFor={`${testId}-member-${idx}-bom-role`}
                    >
                      Compra
                    </label>
                    <select
                      id={`${testId}-member-${idx}-bom-role`}
                      className="catalog-form__select"
                      value={m.bomRole}
                      onChange={(e) =>
                        updateMember(idx, {
                          bomRole: e.target.value as RigidMemberBOMRole,
                        })
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
                </div>

                <details className="agregado-recipe__advanced">
                  <summary>Anclaje fino e identidad</summary>
                  <div className="agregado-editor__item-fields agregado-editor__item-fields--grid">
                    {(['y', 'z'] as const).map((axis) => (
                      <div className="catalog-form__field" key={axis}>
                        <label
                          className="catalog-form__label"
                          htmlFor={`${testId}-member-${idx}-anchor-${axis}`}
                        >
                          {axisLabel(axis)}
                        </label>
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
                            <option value="min">Mínimo</option>
                            <option value="center">Centro</option>
                            <option value="max">Máximo</option>
                          </select>
                          <input
                            id={`${testId}-member-${idx}-anchor-${axis}`}
                            type="text"
                            className="catalog-form__input"
                            value={
                              m.placement[axis].offsetFormula ??
                              String(m.placement[axis].offsetMm)
                            }
                            onChange={(e) => {
                              const raw = e.target.value;
                              const isPlainNumber =
                                raw.trim() !== '' && !Number.isNaN(Number(raw));
                              updateMember(idx, {
                                placement: {
                                  ...m.placement,
                                  [axis]: {
                                    ...m.placement[axis],
                                    offsetMm: isPlainNumber
                                      ? Number(raw)
                                      : raw.trim() === ''
                                      ? 0
                                      : m.placement[axis].offsetMm,
                                    offsetFormula:
                                      isPlainNumber || raw.trim() === ''
                                        ? undefined
                                        : raw,
                                  },
                                },
                              });
                            }}
                            placeholder="mm"
                            aria-label={`${axisLabel(axis)} offset mm o fórmula`}
                            data-testid={`${testId}-member-${idx}-anchor-${axis}-offset`}
                          />
                        </div>
                      </div>
                    ))}
                    <div className="catalog-form__field">
                      <label
                        className="catalog-form__label"
                        htmlFor={`${testId}-member-${idx}-id`}
                      >
                        ID del miembro
                      </label>
                      <input
                        id={`${testId}-member-${idx}-id`}
                        type="text"
                        className="catalog-form__input"
                        value={m.memberId}
                        onChange={(e) =>
                          updateMember(idx, { memberId: e.target.value })
                        }
                        data-testid={`${testId}-member-${idx}-id`}
                      />
                    </div>
                    <div className="catalog-form__field">
                      <label
                        className="catalog-form__label"
                        htmlFor={`${testId}-member-${idx}-role`}
                      >
                        Rol
                      </label>
                      <input
                        id={`${testId}-member-${idx}-role`}
                        type="text"
                        className="catalog-form__input"
                        value={m.role}
                        placeholder="fixed_rail / runner_right…"
                        onChange={(e) => updateMember(idx, { role: e.target.value })}
                        data-testid={`${testId}-member-${idx}-role`}
                      />
                    </div>
                  </div>
                  <p className="catalog-form__hint">
                    Rotación y variantes por medida: pestaña Receta.
                  </p>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
