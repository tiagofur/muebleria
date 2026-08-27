/**
 * Clickable list of resolved board parts — linked to 3D selection.
 */

import type { ReactNode } from 'react';
import type { OptionGroup, ResolvedBoardPart } from '@granete/domain';
import { optionRoleLabel } from '../optionGroups/optionRoleLabel';

export type PartListProps = {
  readonly parts: readonly ResolvedBoardPart[];
  readonly selectedPartId?: string | null;
  readonly onSelectPart: (partId: string) => void;
  readonly testId?: string;
  /** Option groups — the role chip prefers the group name (#403). */
  readonly optionGroups?: readonly OptionGroup[];
};

export function PartList({
  parts,
  selectedPartId = null,
  onSelectPart,
  testId = 'part-list',
  optionGroups,
}: PartListProps): ReactNode {
  if (parts.length === 0) {
    return null;
  }

  return (
    <ul className="part-list" data-testid={testId} role="listbox" aria-label="Piezas del mueble">
      {parts.map((part) => {
        const selected = part.id === selectedPartId;
        const label = part.description || part.code || part.id;
        return (
          <li key={part.id} role="option" aria-selected={selected}>
            <button
              type="button"
              className={
                selected
                  ? 'part-list__item part-list__item--selected'
                  : 'part-list__item'
              }
              onClick={() => onSelectPart(part.id)}
              data-testid={`${testId}-item-${part.id}`}
            >
              <span className="part-list__name">{label}</span>
              <span className="part-list__meta">
                {part.optionRole
                  ? `${optionRoleLabel(part.optionRole, optionGroups)} · `
                  : ''}
                {Math.round(part.lengthMm)}×{Math.round(part.widthMm)}×
                {Math.round(part.thicknessMm)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
