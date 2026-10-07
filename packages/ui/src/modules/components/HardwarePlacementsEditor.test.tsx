/**
 * @vitest-environment jsdom
 */
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Hardware, HardwarePlacement } from '@granete/domain';
import { HardwarePlacementsEditor } from './HardwarePlacementsEditor';

afterEach(() => {
  cleanup();
});

const mockHardware: readonly Hardware[] = [
  {
    id: 'hw-1',
    code: 'HW1',
    name: 'Jaladera',
    unit: 'piece',
    costPerUnit: 10,
    active: true,
    previewShape: 'bar-pull',
  },
  {
    id: 'hw-2',
    code: 'HW2',
    name: 'Bisagra',
    unit: 'piece',
    costPerUnit: 5,
    active: true,
    previewShape: 'hinge',
  },
];

function Harness({
  initial = [],
}: {
  readonly initial?: readonly HardwarePlacement[];
}) {
  const [placements, setPlacements] = useState<readonly HardwarePlacement[]>(
    initial,
  );
  return (
    <HardwarePlacementsEditor
      placements={placements}
      catalogHardware={mockHardware}
      onChange={(next) => setPlacements(next ?? [])}
    />
  );
}

describe('HardwarePlacementsEditor', () => {
  it('shows empty state when there are no placements', () => {
    render(<Harness />);
    expect(
      screen.getByTestId('instance-hardware-placements').textContent,
    ).toContain('Sin herrajes posicionados');
  });

  it('adds a placement with sensible defaults (front, 50/50)', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTestId('instance-hardware-placements-add'));

    expect(
      screen.getByTestId('instance-hardware-placement-0'),
    ).toBeTruthy();
    // Default cara = front, X/Y = 50.
    expect(
      (screen.getByTestId('instance-hardware-placement-0-face') as HTMLSelectElement)
        .value,
    ).toBe('front');
    expect(
      (screen.getByTestId('instance-hardware-placement-0-x') as HTMLInputElement)
        .value,
    ).toBe('50');
    expect(
      (screen.getByTestId('instance-hardware-placement-0-y') as HTMLInputElement)
        .value,
    ).toBe('50');
  });

  it('updates X (mm) on the first placement', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[
          {
            hardwareId: 'hw-1',
            anchorFace: 'front',
            relativePosition: { xMm: 50, yMm: 50 },
          },
        ]}
      />,
    );

    const xInput = screen.getByTestId(
      'instance-hardware-placement-0-x',
    ) as HTMLInputElement;
    await user.clear(xInput);
    await user.type(xInput, '25');

    expect(xInput.value).toBe('25');
  });

  it('removes a placement and goes back to empty state', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[
          {
            hardwareId: 'hw-1',
            anchorFace: 'front',
            relativePosition: { xMm: 50, yMm: 50 },
          },
        ]}
      />,
    );

    await user.click(
      screen.getByTestId('instance-hardware-placement-0-remove'),
    );

    expect(
      screen.getByTestId('instance-hardware-placements').textContent,
    ).toContain('Sin herrajes posicionados');
  });

  it('allows typing a formula into Y position field (e.g. L - 80)', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[
          {
            hardwareId: 'hw-1',
            anchorFace: 'front',
            relativePosition: { xMm: 50, yMm: 50 },
          },
        ]}
      />,
    );

    const yInput = screen.getByTestId(
      'instance-hardware-placement-0-y',
    ) as HTMLInputElement;
    await user.clear(yInput);
    await user.type(yInput, 'L - 80');

    expect(yInput.value).toBe('L - 80');
  });

  it('supports long parametric formulas in both X and Y position fields without truncation', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[
          {
            hardwareId: 'hw-1',
            anchorFace: 'front',
            relativePosition: { xMm: 50, yMm: 50 },
          },
        ]}
      />,
    );

    const xInput = screen.getByTestId(
      'instance-hardware-placement-0-x',
    ) as HTMLInputElement;
    const yInput = screen.getByTestId(
      'instance-hardware-placement-0-y',
    ) as HTMLInputElement;

    await user.clear(xInput);
    await user.type(xInput, 'PW / 2 - 30');

    await user.clear(yInput);
    await user.type(yInput, 'PH-30-HW/2');

    expect(xInput.value).toBe('PW / 2 - 30');
    expect(yInput.value).toBe('PH-30-HW/2');
    expect(xInput.parentElement?.classList.contains('catalog-form__field--narrow')).toBe(false);
    expect(yInput.parentElement?.classList.contains('catalog-form__field--narrow')).toBe(false);
  });
});

const mockOptionGroups = [
  {
    id: 'og-bisagra',
    code: 'BISAGRA',
    name: 'Bisagras',
    kind: 'hardware' as const,
    required: true,
    optionIds: ['hw-2', 'hw-1'],
  },
  {
    id: 'og-interior',
    code: 'INTERIOR',
    name: 'Interiores',
    kind: 'board' as const,
    required: true,
    optionIds: [],
  },
];

function GroupHarness({
  initial = [],
}: {
  readonly initial?: readonly HardwarePlacement[];
}) {
  const [placements, setPlacements] = useState<readonly HardwarePlacement[]>(
    initial,
  );
  return (
    <HardwarePlacementsEditor
      placements={placements}
      catalogHardware={mockHardware}
      optionGroups={mockOptionGroups}
      onChange={(next) => setPlacements(next ?? [])}
    />
  );
}

describe('HardwarePlacementsEditor — modo por grupo (#1046)', () => {
  it('hides the Modo selector when no option groups exist (backwards compatible)', () => {
    render(<Harness initial={[{ hardwareId: 'hw-2', anchorFace: 'front', relativePosition: { xMm: 1, yMm: 2 } }]} />);
    expect(screen.queryByTestId('instance-hardware-placement-0-mode')).toBeNull();
  });

  it('switches a specific placement to group mode: clears hardwareId, sets the role and lists members', async () => {
    const user = userEvent.setup();
    render(
      <GroupHarness
        initial={[{ hardwareId: 'hw-2', anchorFace: 'front', relativePosition: { xMm: 1, yMm: 2 } }]}
      />,
    );

    await user.selectOptions(screen.getByTestId('instance-hardware-placement-0-mode'), 'grupo');

    const groupSelect = screen.getByTestId(
      'instance-hardware-placement-0-group',
    ) as HTMLSelectElement;
    expect(groupSelect.value).toBe('BISAGRA');
    expect(screen.getByTestId('instance-hardware-placement-0-members').textContent).toContain(
      'HW2 — Bisagra',
    );
    expect(screen.getByTestId('instance-hardware-placement-0-members').textContent).toContain(
      'Se elige al cotizar',
    );
    // #1046: the member hint carries the unit cost — what the author sees is
    // what each member costs when the quote picks it.
    expect(screen.getByTestId('instance-hardware-placement-0-members').textContent).toContain(
      'HW2 — Bisagra ($5.00)',
    );
  });

  it('keeps a saved role that is no longer in the catalog visible without rewriting it', () => {
    render(
      <GroupHarness
        initial={[{ optionRole: 'CORREDERA_VIEJA', anchorFace: 'front', relativePosition: { xMm: 1, yMm: 2 } }]}
      />,
    );
    const groupSelect = screen.getByTestId(
      'instance-hardware-placement-0-group',
    ) as HTMLSelectElement;
    expect(groupSelect.value).toBe('CORREDERA_VIEJA');
    expect(groupSelect.textContent).toContain('CORREDERA_VIEJA (guardado)');
  });

  it('switches back to specific mode: clears the role and selects concrete hardware', async () => {
    const user = userEvent.setup();
    render(
      <GroupHarness
        initial={[{ optionRole: 'BISAGRA', anchorFace: 'front', relativePosition: { xMm: 1, yMm: 2 } }]}
      />,
    );

    await user.selectOptions(screen.getByTestId('instance-hardware-placement-0-mode'), 'especifico');

    const picker = screen.getByTestId('instance-hardware-placement-0-hw');
    expect(picker.textContent).toContain('HW1');
  });
});

describe('HardwarePlacementsEditor — fila sin identidad (#1147)', () => {
  it('flags a placement with neither hardwareId nor optionRole as invalid, visibly', () => {
    render(
      <GroupHarness
        initial={[{ anchorFace: 'front', relativePosition: { xMm: 1, yMm: 2 } }]}
      />,
    );

    const error = screen.getByTestId('instance-hardware-placement-0-identity-error');
    expect(error.textContent).toContain('Sin identidad');
    expect(error.textContent).toContain('no resuelve');
  });

  it('a valid row shows no identity error', () => {
    render(
      <GroupHarness
        initial={[
          { hardwareId: 'hw-1', anchorFace: 'front', relativePosition: { xMm: 1, yMm: 2 } },
        ]}
      />,
    );
    expect(
      screen.queryByTestId('instance-hardware-placement-0-identity-error'),
    ).toBeNull();
  });

  it('an identity-less row fixes itself by switching to group mode (auto-picks the first group)', async () => {
    const user = userEvent.setup();
    render(
      <GroupHarness
        initial={[{ anchorFace: 'front', relativePosition: { xMm: 1, yMm: 2 } }]}
      />,
    );
    expect(screen.getByTestId('instance-hardware-placement-0-identity-error')).toBeTruthy();

    // The fix path: switch to group mode — the editor auto-picks the first
    // group, so the row NEVER stays identity-less after a mode change.
    await user.selectOptions(screen.getByTestId('instance-hardware-placement-0-mode'), 'grupo');

    expect(screen.queryByTestId('instance-hardware-placement-0-identity-error')).toBeNull();
    const groupSelect = screen.getByTestId(
      'instance-hardware-placement-0-group',
    ) as HTMLSelectElement;
    expect(groupSelect.value).toBe('BISAGRA');
  });
});
