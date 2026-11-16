/**
 * Page toolbar — shared controls directly beneath a PageHeader.
 */

import type { ReactNode } from 'react';
import './pageHeader.css';

export type PageToolbarProps = {
  readonly ariaLabel: string;
  /** #1643: contenido principal de la izquierda (p. ej. tabs de vista) —
      se renderiza antes que búsqueda/filtros para que la decisión primaria
      encabece la fila. */
  readonly lead?: ReactNode;
  readonly search?: ReactNode;
  readonly filters?: ReactNode;
  readonly tabs?: ReactNode;
  readonly contextualControls?: ReactNode;
};

export function PageToolbar({
  ariaLabel,
  lead,
  search,
  filters,
  tabs,
  contextualControls,
}: PageToolbarProps): ReactNode {
  if (!lead && !search && !filters && !tabs && !contextualControls) return null;

  return (
    <div className="page-toolbar" aria-label={ariaLabel} data-testid="page-toolbar">
      {lead ? <div className="page-toolbar__lead">{lead}</div> : null}
      {search ? <div className="page-toolbar__search">{search}</div> : null}
      {filters ? <div className="page-toolbar__filters">{filters}</div> : null}
      {tabs ? <div className="page-toolbar__tabs">{tabs}</div> : null}
      {contextualControls ? (
        <div className="page-toolbar__contextual-controls">{contextualControls}</div>
      ) : null}
    </div>
  );
}
