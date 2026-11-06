/**
 * Accesorios del juego (#1519 F2, alta inline del owner): los grupos de
 * opciones kind:hardware vinculados a ESTE kit — galería/boxcap/boxcover de
 * MERIVOBOX — se declaran aquí sin salir del kit. Grupos queda como la vista
 * avanzada; el motor (#1504) materializa por bahía la elección del mueble.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { isHardwareKitPart, type OptionGroup } from '@granete/domain';
import { PackagePlus, X } from 'lucide-react';
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
}: {
  readonly kitId: string;
  readonly kitCode: string;
  readonly optionGroups?: readonly OptionGroup[];
  readonly hardware: readonly Hardware[];
  readonly canMutate: boolean;
  readonly onCreateGroup?: (draft: { code: string; name: string; required: boolean; kitHardwareId: string }) => void;
  readonly onUpdateGroup?: (id: string, draft: { code: string; name: string; required: boolean; optionIds: string[]; kitHardwareId: string }) => void;
  readonly onDeleteGroup?: (id: string) => void;
}): ReactNode {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRequired, setNewRequired] = useState(false);
  const [memberPickFor, setMemberPickFor] = useState<string | null>(null);

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
    onCreateGroup({ code: groupCodeFromName(name), name, required: newRequired, kitHardwareId: kitId });
    setNewName('');
    setNewRequired(false);
    setCreating(false);
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

  return (
    <fieldset className="catalog-form__section" data-testid="hardware-form-accessories">
      <legend className="catalog-form__section-title">
        Accesorios del juego{accessoryGroups.length > 0 ? ` · ${accessoryGroups.length}` : ''}
      </legend>
      <p className="catalog-form__hint">
        Los accesorios (galería, boxcap, boxcover…) se eligen por mueble y el motor
        los monta por cajón sobre este juego. Quien cotiza ve un selector con estas
        opciones.
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
                {og.optionIds.length > 0 ? (
                  <div className="catalog-hw-part__actions" style={{ flexWrap: 'wrap', gap: 4 }}>
                    {og.optionIds.map((id) => {
                      const hw = (hardware ?? []).find((h) => h.id === id);
                      return (
                        <span
                          key={id}
                          className="catalog-badge catalog-badge--kit"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          data-testid={`hardware-accessory-${og.code}-member-${hw?.code ?? id}`}
                        >
                          {hw ? `${hw.code} — ${hw.name}` : id}
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
              </div>
              {canMutate ? (
                <div className="catalog-hw-part__actions">
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => setMemberPickFor(memberPickFor === og.id ? null : og.id)}
                    data-testid={`hardware-accessory-${og.code}-add`}
                  >
                    Añadir opción
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    onClick={() => {
                      setMemberPickFor(null);
                      onDeleteGroup?.(og.id);
                    }}
                    data-testid={`hardware-accessory-${og.code}-delete`}
                  >
                    Eliminar grupo
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
              <span className="catalog-form__label">Nombre del accesorio</span>
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
                className="btn btn--sm btn--primary"
                onClick={createGroup}
                disabled={!newName.trim()}
                data-testid="hardware-accessory-new-create"
              >
                Crear accesorio
              </button>
              <button
                type="button"
                className="btn btn--sm btn--ghost"
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
  );
}
