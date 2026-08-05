/**
 * Board finish (option group) pickers for 3D material preview.
 * Changes which catalog material is resolved for INTERIOR / FRENTE / etc.
 */

import type { ReactNode } from 'react';
import type { BoardFinishPickerGroup } from '../moduleHelpers';

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
    <div
      className="board-finish-pickers"
      data-testid={testId}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.75rem',
        marginBottom: '0.75rem',
        alignItems: 'flex-end',
      }}
    >
      <p
        className="catalog-form__hint"
        style={{ flex: '1 1 100%', margin: 0 }}
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
            className="catalog-form__field"
            style={{ marginBottom: 0, minWidth: '11rem' }}
            data-testid={`${testId}-group-${g.code}`}
          >
            <label htmlFor={`${testId}-${g.code}`}>
              {g.name}
              {selectedOpt?.grainDefault ? ' · veta' : ''}
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {selectedOpt?.previewColor ? (
                <span
                  aria-hidden
                  title={selectedOpt.previewColor}
                  style={{
                    width: '1.1rem',
                    height: '1.1rem',
                    borderRadius: 'var(--radius-sm, 4px)',
                    border: '1px solid var(--border, #ccc)',
                    background: selectedOpt.previewColor,
                    flexShrink: 0,
                  }}
                />
              ) : null}
              <select
                id={`${testId}-${g.code}`}
                value={selected}
                onChange={(e) => onChange(g.code, e.target.value)}
                data-testid={`${testId}-select-${g.code}`}
                style={{ flex: 1 }}
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
