/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Hardware, HardwarePlacement } from '@granete/domain';
import { InstanceOverridesEditor } from './InstanceOverridesEditor';

afterEach(() => {
  cleanup();
});

const mockHardware: Hardware = {
  id: 'hw-1',
  code: 'HW1',
  name: 'Jaladera',
  unit: 'piece',
  costPerUnit: 10,
  active: true,
  previewShape: 'bar-pull',
};

const mockPlacements: readonly HardwarePlacement[] = [
  {
    hardwareId: 'hw-1',
    anchorFace: 'front',
    relativePosition: { xMm: 50, yMm: 50 },
  },
];

describe('InstanceOverridesEditor', () => {
  it('stays collapsed by default and expands formulas', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <InstanceOverridesEditor
        overrides={undefined}
        onChange={onChange}
        testIdSuffix="0"
      />,
    );

    expect(screen.getByTestId('instance-overrides-0-summary').textContent).toBe(
      'automático',
    );
    expect(screen.queryByTestId('instance-overrides-0-content')).toBeNull();

    await user.click(screen.getByTestId('instance-overrides-0-toggle'));
    expect(screen.getByTestId('instance-overrides-0-content')).toBeTruthy();

    await user.type(screen.getByTestId('instance-overrides-0-x'), '0');
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]![0];
    expect(last?.xFormula).toBe('0');
  });

  it('shows active summary and resets to automatic', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <InstanceOverridesEditor
        overrides={{ xFormula: 'PW', rotateX: 90 }}
        onChange={onChange}
        testIdSuffix="1"
      />,
    );
    expect(screen.getByTestId('instance-overrides-1-summary').textContent).toMatch(
      /X=PW/,
    );

    await user.click(screen.getByTestId('instance-overrides-1-toggle'));
    await user.click(screen.getByTestId('instance-overrides-1-reset'));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('preserves hardwarePlacements when editing a formula (gotcha paso 1)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <InstanceOverridesEditor
        overrides={{ xFormula: 'PW', hardwarePlacements: mockPlacements }}
        onChange={onChange}
        catalogHardware={[mockHardware]}
        testIdSuffix="2"
      />,
    );

    await user.click(screen.getByTestId('instance-overrides-2-toggle'));
    await user.type(screen.getByTestId('instance-overrides-2-x'), '0');

    const last = onChange.mock.calls[onChange.mock.calls.length - 1]![0];
    // Formula updated…
    expect(last?.xFormula).toBe('PW0');
    // …and hardwarePlacements survived the patch (regresión del gotcha).
    expect(last?.hardwarePlacements).toEqual(mockPlacements);
  });

  it('reset clears formulas but preserves positioned hardware', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <InstanceOverridesEditor
        overrides={{ xFormula: 'PW', hardwarePlacements: mockPlacements }}
        onChange={onChange}
        catalogHardware={[mockHardware]}
        testIdSuffix="3"
      />,
    );

    await user.click(screen.getByTestId('instance-overrides-3-toggle'));
    await user.click(screen.getByTestId('instance-overrides-3-reset'));

    const last = onChange.mock.calls[onChange.mock.calls.length - 1]![0];
    expect(last).toEqual({ hardwarePlacements: mockPlacements });
  });
});
