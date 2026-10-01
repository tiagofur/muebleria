/** @vitest-environment jsdom */
/**
 * #915 UI: per-face assignment panel — six canonical faces, immediate-write
 * callbacks, save-first hint for unsaved components, auth hint for guests.
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ComponentSideAssignmentsPanel,
  type ComponentProfileOption,
} from './ComponentSideAssignmentsPanel';

afterEach(cleanup);

const profiles: ComponentProfileOption[] = [
  { id: 'prof-1', code: 'PERF-SPAX-50', name: 'Unión lateral SPAX', revision: 'rev-1', active: true },
  { id: 'prof-2', code: 'PERF-MINIFIX', name: 'Minifix + tarugo', revision: 'rev-2', active: true },
];

function setup(overrides: Partial<Parameters<typeof ComponentSideAssignmentsPanel>[0]> = {}) {
  const props: Parameters<typeof ComponentSideAssignmentsPanel>[0] = {
    hidden: false,
    componentId: 'comp-1',
    authenticated: true,
    assignments: [],
    profiles,
    canMutate: true,
    savingSide: null,
    error: null,
    onSet: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<ComponentSideAssignmentsPanel {...props} />);
  return { props };
}

describe('ComponentSideAssignmentsPanel (#915 UI)', () => {
  it('renders one row per canonical face', () => {
    setup();
    for (const face of ['front', 'back', 'left', 'right', 'top', 'bottom']) {
      expect(screen.getByTestId(`side-assignment-row-${face}`)).toBeTruthy();
    }
  });

  it('sets an assignment through the select and reports the chosen face', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.selectOptions(screen.getByTestId('side-assignment-select-left'), 'prof-1');
    expect(props.onSet).toHaveBeenCalledWith('left', 'prof-1');
  });

  it('removes through the quitar button', async () => {
    const user = userEvent.setup();
    const { props } = setup({
      assignments: [{ side: 'back', profileId: 'prof-2' }],
    });
    await user.click(screen.getByTestId('side-assignment-remove-back'));
    expect(props.onRemove).toHaveBeenCalledWith('back');
  });

  it('selecting the inherited option removes the assignment', async () => {
    const user = userEvent.setup();
    const { props } = setup({
      assignments: [{ side: 'top', profileId: 'prof-1' }],
    });
    await user.selectOptions(screen.getByTestId('side-assignment-select-top'), '');
    expect(props.onRemove).toHaveBeenCalledWith('top');
  });

  it('shows the save-first hint for unsaved components and no rows', () => {
    setup({ componentId: null });
    expect(screen.getByTestId('side-assignments-save-hint')).toBeTruthy();
    expect(screen.queryByTestId('side-assignment-row-front')).toBeNull();
  });

  it('shows the auth hint for guest sessions', () => {
    setup({ authenticated: false });
    expect(screen.getByTestId('side-assignments-auth-hint')).toBeTruthy();
  });

  it('surfaces the error when present', () => {
    setup({ error: 'referencia inválida' });
    expect(screen.getByTestId('side-assignments-error').textContent).toContain('referencia inválida');
  });
});
