/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InstanceOverridesEditor } from './InstanceOverridesEditor';

afterEach(() => {
  cleanup();
});

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
});
