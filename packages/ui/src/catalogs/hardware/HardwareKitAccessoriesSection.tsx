/**
 * Accesorios del juego (#1519 F2, alta inline del owner): los grupos de
 * opciones kind:hardware vinculados a ESTE kit — galería/boxcap/boxcover de
 * MERIVOBOX — se declaran aquí sin salir del kit. Grupos queda como la vista
 * avanzada; el motor (#1504) materializa por bahía la elección del mueble.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { isHardwareKitPart, type OptionGroup } from '@granete/domain';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, PackagePlus, X } from 'lucide-react';
import type { Hardware } from '@granete/domain';
import { CatalogPicker } from '../CatalogPicker';

const groupCodeFromName = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

export function HardwareKitAccessoriesSection({
  kitId,
  kitCode,
  optionGroups,
  hardware,
  canMutate,
  onCreateGroup,
  onUpdateGroup,
  onDeleteGroup,
  onAddInserto,
  defaultOpen = true,
}: {
  readonly kitId: string;
  readonly kitCode: string;
  readonly optionGroups?: readonly OptionGroup[];
  readonly hardware: readonly Hardware[];
  readonly canMutate: boolean;
  readonly onCreateGroup?: (draft: { code: string; name: string; required: boolean; kitHardwareId: string }) => void;
  readonly onUpdateGroup?: (
    id: string,
    draft: {
      code: string;
      name: string;
      required: boolean;
      optionIds: string[];
      kitHardwareId: string;
      /** #1627: ausente = conserva el default guardado. */
      defaultChoice?: 'first_active' | 'none';
    },
  ) => void;
  readonly onDeleteGroup?: (id: string) => Promise<void> | void;
  /** #1596 alcance 3: alta de inserto nuevo que cae en ESTE selector. */
  readonly onAddInserto?: () => void;
  /** #1641: en la ficha del juego nace cerrado (gestión de cola larga). */
  readonly defaultOpen?: boolean;
}): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRequired, setNewRequired] = useState(false);
  const [memberPickFor, setMemberPickFor] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Los accesorios de ESTE kit: grupos kind:hardware vinculados por kit.
  const accessoryGroups = useMemo(
    () =>
      (optionGroups ?? []).filter(
        (og) => og.kind === 'hardware' && og.kitHardwareId === kitId,
      ),
    [optionGroups, kitId],
  );

  // Miembros elegibles: herrajes/kits activos que no sean parte de otro kit
  // (#1436: una parte no se compra sola) ni ya miembros del grupo.
  const memberCandidates = useMemo(() => {
    const group = memberPickFor
      ? accessoryGroups.find((og) => og.id === memberPickFor)
      : null;
    const members = new Set(group?.optionIds ?? []);
    return (hardware ?? [])
      .filter(
        (h) =>
          h.active &&
          !isHardwareKitPart(h) &&
          h.id !== kitId &&
          !members.has(h.id),
      )
      .map((h) => ({ id: h.id, code: h.code, name: h.name, active: h.active }));
  }, [hardware, accessoryGroups, memberPickFor, kitId]);

  const createGroup = () => {
    const name = newName.trim();
    if (!name || !onCreateGroup) return;
    // #1519 (review P2-1): el código es UNIQUE por organización — prefijo del
    // kit para que «Galería» en dos kits distintos no choque con 409.
    const code = groupCodeFromName(kitCode + ' ' + name);
    if (!code) return;
    onCreateGroup({ code, name, required: newRequired, kitHardwareId: kitId });
    setNewName('');
    setNewRequired(false);
    setCreating(false);
  };

  // #1627: el orden de las opciones es el orden guardado; la primera activa
  // es el inserto que lleva el cajón cuando el mueble no elige.
  const moveMember = (group: OptionGroup, idx: number, delta: -1 | 1) => {
    const target = idx + delta;
    if (target < 0 || target >= group.optionIds.length) return;
    const next = [...group.optionIds];
    [next[idx], next[target]] = [next[target]!, next[idx]!];
    onUpdateGroup?.(group.id, {
      code: group.code,
      name: group.name,
      required: group.required,
      optionIds: next,
      kitHardwareId: group.kitHardwareId ?? '',
    });
  };
  const defaultOptionId = (group: OptionGroup): string | undefined =>
    group.defaultChoice === 'none'
      ? undefined
      : group.optionIds.find((id) => (hardware ?? []).some((h) => h.id === id && h.active));
  const setDefaultChoice = (group: OptionGroup, value: 'first_active' | 'none') => {
    onUpdateGroup?.(group.id, {
      code: group.code,
      name: group.name,
      required: group.required,
      optionIds: [...group.optionIds],
      kitHardwareId: group.kitHardwareId ?? '',
      defaultChoice: value,
    });
  };

  const removeMember = (group: OptionGroup, optionId: string) => {
    onUpdateGroup?.(group.id, {
      code: group.code,
      name: group.name,
      required: group.required,
      optionIds: group.optionIds.filter((id) => id !== optionId),
      kitHardwareId: group.kitHardwareId ?? '',
    });
  };

  /** #1596 alcance 7: estado de cada opción — qué lados tienen diseño. */
  const optionDesignState = (id: string): string => {
    const hw = (hardware ?? []).find((h) => h.id === id);
    if (!hw) return '';
    const sides = ['left', 'right', 'center'] as const;
    const label: Record<(typeof sides)[number], string> = { left: 'Izq', right: 'Der', center: 'Ctro' };
    if (!hw.pieces || hw.pieces.length === 0) return 'sin piezas por lado';
    return hw.pieces
      .map((pc) => `${label[pc.anchor]} ${pc.asset?.assetId ? '✓' : 'pendiente'}`)
      .join(' · ');
  };

  const optionMotionState = (id: string): string => {
    const hw = (hardware ?? []).find((h) => h.id === id);
    const actor = hw?.designParts?.[0]?.actorMembership;
    if (actor === 'actor:drawer') return 'viaja con el cajón';
    if (actor === 'actor:door') return 'viaja con la puerta';
    if (actor === 'body') return 'fija al mueble';
    return 'al abrir: sin declarar';
  };

  return (
    <div className="catalog-form__disclosure" data-testid="hardware-form-accessories">
      <button
        type="button"
        className="catalog-form__disclosure-header"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="hardware-accessories-toggle"
      >
        {open ? (
          <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
        ) : (
          <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
        )}
        <span className="catalog-form__disclosure-title">Insertos del juego</span>
        <span className="catalog-form__disclosure-summary">
          {accessoryGroups.length > 0
            ? `${accessoryGroups.length} ${accessoryGroups.length === 1 ? 'selector' : 'selectores'}`
            : 'sin selectores aún'}
        </span>
      </button>
      {open ? (
      <div className="catalog-form__disclosure-body">
      <fieldset className="catalog-form__section">
      <legend className="catalog-form__section-title">
        Insertos del juego{accessoryGroups.length > 0 ? ` · ${accessoryGroups.length}` : ''}
      </legend>
      <p className="catalog-form__hint">
        Cada selector (galería, boxcap, boxcover…) ofrece opciones que se eligen por
        cajón y el motor monta sobre este juego. Si el mueble no elige, el cajón lleva
        la opción marcada «Por defecto» (la primera activa de la lista; cambiala con las
        flechas) o ninguna, según lo que elijas en «Si el mueble no elige». En cada
        mueble también se puede elegir «Sin inserto» si el selector no es obligatorio.
      </p>
      {accessoryGroups.length > 0 ? (
        <div className="catalog-hw-part" data-testid="hardware-accessories-rows">
          {accessoryGroups.map((og) => (
            <div className="catalog-hw-part__row" key={og.id} data-testid={`hardware-accessory-${og.code}`}>
              <div className="catalog-hw-part__identity">
                <strong className="catalog-hw-part__title">{og.name}</strong>
                <span className="catalog-hw-part__meta">
                  {og.code}
                  {og.required ? ' · requerido' : ' · opcional'} ·{' '}
                  {og.optionIds.length} {og.optionIds.length === 1 ? 'opción' : 'opciones'}
                </span>
                <label className="catalog-hw-part__meta" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>Si el mueble no elige:</span>
                  <select
                    value={og.defaultChoice === 'none' ? 'none' : 'first_active'}
                    disabled={!canMutate || !onUpdateGroup}
                    onChange={(e) => setDefaultChoice(og, e.target.value as 'first_active' | 'none')}
                    aria-label={`Qué lleva el cajón sin elección en ${og.name}`}
                    data-testid={`hardware-accessory-${og.code}-default-choice`}
                  >
                    <option value="first_active">Primera opción activa</option>
                    <option value="none">Sin inserto</option>
                  </select>
                </label>
                {og.defaultChoice === 'none' && og.required ? (
                  <span className="catalog-hw-part__meta" role="note" data-testid={`hardware-accessory-${og.code}-required-none`}>
                    Es obligatorio y no tiene default: cada mueble tiene que elegir un inserto.
                  </span>
                ) : null}
                {og.optionIds.length > 0 ? (
                  <div className="catalog-hw-part__actions" style={{ flexWrap: 'wrap', gap: 4 }}>
                    {og.optionIds.map((id, idx) => {
                      const hw = (hardware ?? []).find((h) => h.id === id);
                      const isDefault = defaultOptionId(og) === id;
                      return (
                        <span
                          key={id}
                          className="catalog-badge catalog-badge--kit"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          data-testid={`hardware-accessory-${og.code}-member-${hw?.code ?? id}`}
                        >
                          {hw ? `${hw.code} — ${hw.name}` : id}
                          {isDefault ? (
                            <strong data-testid={`hardware-accessory-${og.code}-default-${hw?.code ?? id}`}>
                              · Por defecto
                            </strong>
                          ) : null}
                          {canMutate && onUpdateGroup && og.optionIds.length > 1 ? (
                            <>
                              <button
                                type="button"
                                className="btn btn--ghost btn--small"
                                style={{ padding: '0 2px' }}
                                disabled={idx === 0}
                                aria-label={`Subir ${hw?.name ?? id} en ${og.name}`}
                                onClick={() => moveMember(og, idx, -1)}
                                data-testid={`hardware-accessory-${og.code}-up-${hw?.code ?? id}`}
                              >
                                <ArrowUp size={12} strokeWidth={1.5} aria-hidden />
                              </button>
                              <button
                                type="button"
                                className="btn btn--ghost btn--small"
                                style={{ padding: '0 2px' }}
                                disabled={idx === og.optionIds.length - 1}
                                aria-label={`Bajar ${hw?.name ?? id} en ${og.name}`}
                                onClick={() => moveMember(og, idx, 1)}
                                data-testid={`hardware-accessory-${og.code}-down-${hw?.code ?? id}`}
                              >
                                <ArrowDown size={12} strokeWidth={1.5} aria-hidden />
                              </button>
                            </>
                          ) : null}
                          {canMutate && onUpdateGroup ? (
                            <button
                              type="button"
                              className="btn btn--ghost btn--small"
                              style={{ padding: '0 2px' }}
                              aria-label={`Quitar ${hw?.name ?? id} de ${og.name}`}
                              onClick={() => removeMember(og, id)}
                              data-testid={`hardware-accessory-${og.code}-remove-${hw?.code ?? id}`}
                            >
                              <X size={12} strokeWidth={1.5} aria-hidden />
                            </button>
                          ) : null}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <span className="catalog-hw-part__meta">Sin opciones todavía.</span>
                )}
                {og.optionIds.length > 0 ? (
                  <ul
                    className="catalog-hw-part__meta"
                    style={{ margin: '4px 0 0', paddingLeft: 16 }}
                    data-testid={`hardware-accessory-${og.code}-states`}
                  >
                    {og.optionIds.map((id) => {
                      const hw = (hardware ?? []).find((h) => h.id === id);
                      return (
                        <li key={id}>
                          {hw?.code ?? id}: {optionDesignState(id)} · {optionMotionState(id)}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
              {canMutate ? (
                <div className="catalog-hw-part__actions">
                  {onAddInserto ? (
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={onAddInserto}
                      data-testid={`hardware-accessory-${og.code}-add-inserto`}
                    >
                      <PackagePlus size={13} strokeWidth={1.5} aria-hidden />
                      Añadir inserto
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => setMemberPickFor(memberPickFor === og.id ? null : og.id)}
                    data-testid={`hardware-accessory-${og.code}-add`}
                  >
                    Añadir existente
                  </button>
                  <button
                    type="button"
                    className="btn btn--small btn--ghost"
                    disabled={deletingId === og.id}
                    onClick={async () => {
                      setMemberPickFor(null);
                      if (onDeleteGroup) {
                        setDeletingId(og.id);
                        try {
                          await onDeleteGroup(og.id);
                        } catch {
                          // Error handled by store/toast; button resets in finally to allow retry
                        } finally {
                          setDeletingId(null);
                        }
                      }
                    }}
                    data-testid={`hardware-accessory-${og.code}-delete`}
                  >
                    {deletingId === og.id ? 'Eliminando…' : 'Eliminar selector'}
                  </button>
                </div>
              ) : null}
              {memberPickFor === og.id ? (
                <div style={{ marginTop: 8 }}>
                  <CatalogPicker
                    label="Herraje o kit accesorio"
                    placeholder="Seleccionar…"
                    searchPlaceholder="Buscar herraje…"
                    value=""
                    onChange={(id) => {
                      onUpdateGroup?.(og.id, {
                        code: og.code,
                        name: og.name,
                        required: og.required,
                        optionIds: [...og.optionIds, id],
                        kitHardwareId: og.kitHardwareId ?? '',
                      });
                      setMemberPickFor(null);
                    }}
                    items={memberCandidates}
                    data-testid={`hardware-accessory-${og.code}-picker`}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="catalog-hw-part__meta" data-testid="hardware-accessories-empty">
          Sin accesorios: este juego se monta siempre igual.
        </p>
      )}
      {canMutate && onCreateGroup ? (
        creating ? (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label className="catalog-form__field">
              <span className="catalog-form__label">Nombre del selector</span>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ej. Lateral superior E (galería)"
                data-testid="hardware-accessory-new-name"
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={newRequired}
                onChange={(e) => setNewRequired(e.target.checked)}
                data-testid="hardware-accessory-new-required"
              />
              <span>Requerido (bloquea el precio sin elección)</span>
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn--small btn--primary"
                onClick={createGroup}
                disabled={!newName.trim() || !groupCodeFromName(kitCode + ' ' + newName)}
                data-testid="hardware-accessory-new-create"
              >
                Crear selector
              </button>
              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={() => setCreating(false)}
                data-testid="hardware-accessory-new-cancel"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            style={{ marginTop: 8 }}
            onClick={() => setCreating(true)}
            data-testid="hardware-accessory-new-open"
          >
            <PackagePlus size={14} strokeWidth={1.5} aria-hidden />
            Nuevo accesorio del juego
          </button>
        )
      ) : null}
      </fieldset>
      </div>
      ) : null}
    </div>
  );
}
