/**
 * Selector del kit comercial de un agregado (#1460): única superficie de
 * autoría para `commercialKitHardwareId` — las pestañas Herrajes y Receta
 * usan EL MISMO picker y el mismo feedback. Sólo lista herrajes con
 * `unit === 'set'`: cualquier otro ítem del catálogo no es un juego comercial.
 */

import type { ReactNode } from 'react';
import type { AgregadoRigidMember, Hardware } from '@granete/domain';
import { CatalogPicker } from '../../catalogs/CatalogPicker';

export type KitCommercialPickerProps = {
  readonly catalogHardware: readonly Hardware[];
  readonly value: string;
  readonly onChange: (kitId: string | undefined) => void;
  readonly label: string;
  readonly id: string;
  readonly testId: string;
};

export function kitPartsOf(
  catalogHardware: readonly Hardware[],
  kitId: string,
): Hardware[] {
  return kitId
    ? catalogHardware.filter((h) => h.kitHardwareId === kitId)
    : [];
}

/**
 * #1460: un miembro es derivado del kit cuando su herraje es una parte del
 * juego seleccionado. El rol `included_in_kit` NO basta — un miembro añadido
 * a mano con el kit activo también lo lleva. El kit manda: estos miembros se
 * muestran de solo lectura y el sync del catálogo los re-deriva.
 */
export function isKitDerivedMember(
  member: AgregadoRigidMember,
  kitPartIds: ReadonlySet<string>,
): boolean {
  return (
    member.source.kind === 'fixed' &&
    kitPartIds.has(member.source.fixed?.hardwareId ?? '')
  );
}

export function KitCommercialPicker({
  catalogHardware,
  value,
  onChange,
  label,
  id,
  testId,
}: KitCommercialPickerProps): ReactNode {
  const kitOptions = catalogHardware.filter((h) => h.unit === 'set');
  const parts = kitPartsOf(catalogHardware, value);

  return (
    <>
      <CatalogPicker
        id={id}
        label={label}
        placeholder="Sin kit (compra por herraje)"
        searchPlaceholder="Buscar juego…"
        value={value}
        onChange={(hardwareId) => onChange(hardwareId || undefined)}
        items={kitOptions.map((h) => ({
          id: h.id,
          code: h.code,
          name: h.name,
          active: h.active,
        }))}
        data-testid={testId}
      />
      {value === '' ? (
        <p className="catalog-form__hint">
          Los herrajes «incluido en el juego» no generan línea de compra propia:
          el kit cotiza una vez.
        </p>
      ) : parts.length > 0 ? (
        <p className="catalog-form__hint" data-testid={`${testId}-parts`}>
          El juego agrupa {parts.length} herraje(s): cotiza una vez y sus partes
          se administran en Catálogos.
        </p>
      ) : (
        <p className="catalog-form__hint" data-testid={`${testId}-parts`}>
          El juego no tiene partes todavía: crealas en Catálogos (herrajes con
          «parte de kit»).
        </p>
      )}
    </>
  );
}
