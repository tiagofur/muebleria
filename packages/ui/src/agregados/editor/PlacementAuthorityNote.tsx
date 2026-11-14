/**
 * #1625: aviso de que la posición X/Y/Z de un miembro la manda el catálogo.
 * El motor la reescribe en cada resolve desde la pieza por lado del herraje
 * (o su etiqueta `pos:`), así que los editores de receta la muestran en solo
 * lectura y dicen dónde se edita. La rotación sigue siendo de la receta.
 */

import type { ReactNode } from 'react';
import type { Hardware, MemberPlacementAuthority } from '@granete/domain';

const SIDE_LABEL: Record<'left' | 'right' | 'center', string> = {
  left: 'izquierdo',
  right: 'derecho',
  center: 'centro',
};

export function PlacementAuthorityNote({
  authority,
  catalogHardware,
  testId,
}: {
  readonly authority: MemberPlacementAuthority | null;
  readonly catalogHardware: readonly Hardware[];
  readonly testId: string;
}): ReactNode {
  if (!authority) return null;
  const hw = catalogHardware.find((h) => h.id === authority.hardwareId);
  const who = hw ? `«${hw.code}»` : 'del herraje';
  return (
    <p className="catalog-form__hint" role="note" data-testid={testId}>
      {authority.kind === 'piece'
        ? `Posición tomada del herraje ${who}, lado ${SIDE_LABEL[authority.anchor]}. Se edita en su ficha, sección «Diseño — un SKP por lado».`
        : `Posición tomada de la etiqueta de posición del herraje ${who}. Se edita en su ficha, sección «Partes del diseño».`}{' '}
      Acá es solo lectura: el motor la recalcula en cada uso. La rotación sí se edita acá.
    </p>
  );
}
