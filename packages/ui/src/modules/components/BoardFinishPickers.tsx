/**
 * Board finish (option group) pickers for 3D material preview.
 * Changes which catalog material is resolved for INTERIOR / FRENTE / etc.
 */

import type { ReactNode } from 'react';
import type { BoardFinishPickerGroup } from '../moduleHelpers';
import './boardFinishPickers.css';

export type BoardFinishPickersProps = {
  readonly groups: readonly BoardFinishPickerGroup[];
  readonly choices: Readonly<Record<string, string>>;
  readonly onChange: (groupCode: string, materialId: string) => void;
  readonly testId?: string;
};

export function BoardFinishPickers({
  groups,
  choices,
  onChange,
  testId = 'board-finish-pickers',
}: BoardFinishPickersProps): ReactNode {
  if (groups.length === 0) return null;

  return (
    <div className="board-finish-pickers" data-testid={testId}>
      <p
        className="catalog-form__hint board-finish-pickers__intro"
        data-testid={`${testId}-intro`}
      >
        Acabados de preview (solo esta vista 3D — no guarda la cotización):
      </p>
      {groups.map((g) => {
        const selected = choices[g.code] ?? g.options[0]?.id ?? '';
        const selectedOpt = g.options.find((o) => o.id === selected);
        return (
          <div
            key={g.code}
            className="catalog-form__field board-finish-pickers__field"
            data-testid={`${testId}-group-${g.code}`}
          >
            <label htmlFor={`${testId}-${g.code}`}>
              {g.name}
              {selectedOpt?.grainDefault ? ' · veta' : ''}
            </label>
            <div className="board-finish-pickers__control">
              {selectedOpt?.previewColor ? (
                <span
                  className="board-finish-pickers__swatch"
                  aria-hidden
                  title={selectedOpt.previewColor}
                  style={{ background: selectedOpt.previewColor }}
                />
              ) : null}
              <select
                id={`${testId}-${g.code}`}
                className="board-finish-pickers__select"
                value={selected}
                onChange={(e) => onChange(g.code, e.target.value)}
                data-testid={`${testId}-select-${g.code}`}
              >
                {g.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.code} — {o.name}
                    {o.grainDefault ? ' (veta)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        );
      })}
    </div>
  );
}
