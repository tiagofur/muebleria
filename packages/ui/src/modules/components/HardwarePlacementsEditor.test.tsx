/**
 * @vitest-environment jsdom
 */
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Hardware, HardwarePlacement } from '@muebles/domain';
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
