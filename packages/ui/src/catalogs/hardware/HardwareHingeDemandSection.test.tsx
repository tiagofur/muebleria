/**
 * @vitest-environment jsdom
 *
 * #1579 — sección «Bisagras por altura de puerta» del herraje: la tabla que
 * la bisagra declara para sí. Filas en texto dentro del draft, sugerencia
 * cargada sola sólo al crear una bisagra (nunca pisa lo ya declarado), y el
 * recargo por ancho con sus tres estados (heredar / desactivado / umbral).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import type { Hardware } from '@granete/domain';
import { validateHingeDemandTable } from '@granete/domain';
import { HardwareHingeDemandSection } from './HardwareHingeDemandSection';
import {
  emptyDraft,
  hingeDemandFromDraft,
  suggestedHingeDemandRows,
  toDraft,
  type HardwareDraft,
} from './hardwareDraft';

afterEach(() => {
  cleanup();
});

const SUGGESTED = [
  { upToHeightMm: '900', hinges: '2' },
  { upToHeightMm: '1600', hinges: '3' },
  { upToHeightMm: '2000', hinges: '4' },
  { upToHeightMm: '2400', hinges: '5' },
];

function Harness({
  initial,
  suggestOnCreate = false,
}: {
  initial?: Partial<HardwareDraft>;
  suggestOnCreate?: boolean;
}): ReactNode {
  const [draft, setDraft] = useState<HardwareDraft>(() => ({
    ...emptyDraft(),
    ...initial,
  }));
  return (
    <>
      <HardwareHingeDemandSection
        draft={draft}
        setDraft={setDraft}
        canMutate
        suggestOnCreate={suggestOnCreate}
      />
      <output data-testid="rows-out">{JSON.stringify(draft.hingeDemandRows ?? null)}</output>
      <output data-testid="surge-out">{draft.hingeDemandWidthSurgeMm ?? ''}</output>
    </>
  );
}

const rowsOf = () => JSON.parse(screen.getByTestId('rows-out').textContent ?? 'null') as unknown;

describe('HardwareHingeDemandSection (#1579)', () => {
  it('sin filas y sin forma de bisagra: desplegable cerrado con la sugerencia a un clic', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByTestId('hardware-hinge-demand-disclosure')).toBeDefined();
    expect(rowsOf()).toEqual([]);

    await user.click(screen.getByTestId('hardware-hinge-band-suggest'));
    expect(rowsOf()).toEqual(SUGGESTED);
    // Con tabla declarada el desplegable deja de ser necesario.
    expect(screen.queryByTestId('hardware-hinge-demand-disclosure')).toBeNull();
    expect(screen.queryByTestId('hardware-hinge-band-suggest')).toBeNull();
  });

  it('al crear una bisagra, la tabla sugerida se carga sola', () => {
    render(<Harness initial={{ previewShape: 'hinge' }} suggestOnCreate />);
    expect(rowsOf()).toEqual(SUGGESTED);
    expect(screen.queryByTestId('hardware-hinge-demand-disclosure')).toBeNull();
  });

  it('al crear un herraje que no es bisagra no se carga nada', () => {
    render(<Harness initial={{ previewShape: 'bar-pull' }} suggestOnCreate />);
    expect(rowsOf()).toEqual([]);
  });

  it('al editar una bisagra, la sugerencia jamás pisa lo que el taller declaró', () => {
    render(
      <Harness
        initial={{
          previewShape: 'hinge',
          hingeDemandRows: [{ upToHeightMm: '900', hinges: '3' }],
        }}
        suggestOnCreate
      />,
    );
    expect(rowsOf()).toEqual([{ upToHeightMm: '900', hinges: '3' }]);
  });

  it('editar filas: cambia la cantidad, añade una banda y la quita', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ previewShape: 'hinge', hingeDemandRows: [{ upToHeightMm: '900', hinges: '2' }] }} />);

    await user.clear(screen.getByTestId('hardware-hinge-band-0-hinges'));
    await user.type(screen.getByTestId('hardware-hinge-band-0-hinges'), '3');
    expect(rowsOf()).toEqual([{ upToHeightMm: '900', hinges: '3' }]);

    await user.click(screen.getByTestId('hardware-hinge-band-add'));
    expect(rowsOf()).toEqual([
      { upToHeightMm: '900', hinges: '3' },
      { upToHeightMm: '', hinges: '2' },
    ]);

    await user.clear(screen.getByTestId('hardware-hinge-band-1-height'));
    await user.type(screen.getByTestId('hardware-hinge-band-1-height'), '2400');
    await user.clear(screen.getByTestId('hardware-hinge-band-1-hinges'));
    await user.type(screen.getByTestId('hardware-hinge-band-1-hinges'), '5');

    await user.click(screen.getByTestId('hardware-hinge-band-0-remove'));
    expect(rowsOf()).toEqual([{ upToHeightMm: '2400', hinges: '5' }]);
  });

  it('el recargo por ancho se escribe en el draft', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ hingeDemandRows: [{ upToHeightMm: '900', hinges: '2' }] }} />);

    expect(screen.getByTestId('surge-out').textContent).toBe('');
    await user.type(screen.getByTestId('hardware-hinge-width-surge'), '600');
    expect(screen.getByTestId('surge-out').textContent).toBe('600');
  });
});

describe('hingeDemandFromDraft / toDraft (#1579)', () => {
  const base: Hardware = {
    id: 'hw-1',
    code: 'BIS-X',
    name: 'Bisagra X',
    unit: 'piece',
    costPerUnit: 68,
    active: true,
  };

  it('sin filas no hay tabla; con filas, las bandas y el recargo en su estado exacto', () => {
    expect(hingeDemandFromDraft({ hingeDemandRows: [] })).toBeUndefined();
    expect(hingeDemandFromDraft({})).toBeUndefined();

    const bands = [{ upToHeightMm: '900', hinges: '2' }];
    // Vacío = heredar la regla de librería: la clave no viaja.
    expect(hingeDemandFromDraft({ hingeDemandRows: bands, hingeDemandWidthSurgeMm: '' })).toEqual({
      bands: [{ upToHeightMm: 900, hinges: 2 }],
    });
    expect(
      hingeDemandFromDraft({ hingeDemandRows: bands, hingeDemandWidthSurgeMm: '0' }),
    ).toEqual({ bands: [{ upToHeightMm: 900, hinges: 2 }], widthSurgeOverMm: 0 });
    expect(
      hingeDemandFromDraft({ hingeDemandRows: bands, hingeDemandWidthSurgeMm: ' 600 ' }),
    ).toEqual({ bands: [{ upToHeightMm: 900, hinges: 2 }], widthSurgeOverMm: 600 });
  });

  it('toDraft conserva el estado del recargo: null y 0 son «sin recargo», ausente hereda', () => {
    const bands = [{ upToHeightMm: 900, hinges: 2 }];
    expect(toDraft({ ...base, hingeDemand: { bands } }).hingeDemandWidthSurgeMm).toBe('');
    expect(
      toDraft({ ...base, hingeDemand: { bands, widthSurgeOverMm: null } }).hingeDemandWidthSurgeMm,
    ).toBe('0');
    expect(
      toDraft({ ...base, hingeDemand: { bands, widthSurgeOverMm: 0 } }).hingeDemandWidthSurgeMm,
    ).toBe('0');
    expect(
      toDraft({ ...base, hingeDemand: { bands, widthSurgeOverMm: 600 } }).hingeDemandWidthSurgeMm,
    ).toBe('600');
    expect(toDraft(base).hingeDemandRows).toEqual([]);
  });

  it('la sugerencia es válida para el servidor y equivale a la escalera de librería', () => {
    const table = hingeDemandFromDraft({
      hingeDemandRows: suggestedHingeDemandRows(),
      hingeDemandWidthSurgeMm: '',
    });
    expect(validateHingeDemandTable(table)).toBeNull();
    expect(table?.bands).toEqual([
      { upToHeightMm: 900, hinges: 2 },
      { upToHeightMm: 1600, hinges: 3 },
      { upToHeightMm: 2000, hinges: 4 },
      { upToHeightMm: 2400, hinges: 5 },
    ]);
  });

  it('una cantidad fuera de 2..5 se rechaza antes de viajar', () => {
    const table = hingeDemandFromDraft({
      hingeDemandRows: [{ upToHeightMm: '900', hinges: '6' }],
    });
    expect(validateHingeDemandTable(table)).toBe(
      'bands[0].hinges debe ser un entero entre 2 y 5',
    );
  });
});
