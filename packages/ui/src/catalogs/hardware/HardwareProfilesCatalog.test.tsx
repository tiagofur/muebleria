/** @vitest-environment jsdom */
/**
 * #914 hardware profiles catalog harness: pure-prop screen tests — create
 * flow with items, duplicate-code rejection, stale-write UX (modal stays
 * open with the draft) and deactivate.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraneteApiError } from '@granete/storage';
import type { Hardware } from '@granete/domain';
import {
  HardwareProfilesCatalog,
  type HardwareProfilesCatalogProps,
  type HardwareProfileRow,
  type HardwareProfileDraft,
} from './HardwareProfilesCatalog';

const hardware: Hardware[] = [
  {
    id: 'hw-1',
    code: 'SPAX-4X50',
    name: 'Tornillo SPAX 4x50',
    unit: 'piece',
    costPerUnit: 12,
    active: true,
  },
  {
    id: 'hw-2',
    code: 'HER-TAQ-8X30',
    name: 'Tarugo 8x30',
    unit: 'piece',
    costPerUnit: 3,
    active: true,
  },
];

const row = (overrides: Partial<HardwareProfileRow> = {}): HardwareProfileRow => ({
  id: 'p-1',
  code: 'PERF-SPAX-50',
  name: 'Unión lateral SPAX 4x50',
  description: '',
  revision: 'rev-1',
  itemCount: 1,
  hasRecipe: true,
  active: true,
  version: 3,
  items: [{ hardwareId: 'hw-1', quantity: 2, applicationRole: 'screw' }],
  ...overrides,
});

afterEach(cleanup);

function setup(overrides: Partial<HardwareProfilesCatalogProps> = {}) {
  const props: HardwareProfilesCatalogProps = {
    profiles: [row()],
    hardware,
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDeactivate: vi.fn().mockResolvedValue(undefined),
    canMutate: true,
    ...overrides,
  };
  render(<HardwareProfilesCatalog {...props} />);
  return { props };
}

async function fillAndSubmitForm(
  user: ReturnType<typeof userEvent.setup>,
  code: string,
): Promise<void> {
  await user.click(screen.getByTestId('hardware-profile-create-btn'));
  await user.type(screen.getByTestId('hardware-profile-code-input'), code);
  await user.type(screen.getByTestId('hardware-profile-name-input'), 'Unión de prueba');
  await user.click(screen.getByTestId('hardware-profile-item-add-btn'));
  await user.selectOptions(screen.getByTestId('hardware-profile-item-hardware-select'), 'hw-1');
  await user.click(screen.getByTestId('hardware-profile-form-submit-btn'));
}

describe('HardwareProfilesCatalog (#914)', () => {
  it('lists profiles with item count, revision and recipe badge', () => {
    setup();
    expect(screen.getByText('PERF-SPAX-50')).toBeTruthy();
    expect(screen.getByText('1 herraje')).toBeTruthy();
    expect(screen.getByText('rev-1')).toBeTruthy();
    expect(screen.getByText('Embebida')).toBeTruthy();
  });

  it('creates a profile with one hardware line', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await fillAndSubmitForm(user, 'PERF-NUEVO');
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    const firstCall = (props.onCreate as ReturnType<typeof vi.fn>).mock.calls[0] as
      | [HardwareProfileDraft]
      | undefined;
    expect(firstCall).toBeDefined();
    const draft = firstCall![0];
    expect(draft.code).toBe('PERF-NUEVO');
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]).toMatchObject({ hardwareId: 'hw-1', quantity: '1' });
  });

  it('rejects a duplicate code without calling onCreate', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await fillAndSubmitForm(user, 'PERF-SPAX-50');
    expect(props.onCreate).not.toHaveBeenCalled();
    expect(screen.getByText(/ya existe/i)).toBeTruthy();
  });

  it('rejects zero-quantity lines without calling onCreate', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.click(screen.getByTestId('hardware-profile-create-btn'));
    await user.type(screen.getByTestId('hardware-profile-code-input'), 'PERF-ZERO');
    await user.type(screen.getByTestId('hardware-profile-name-input'), 'Cantidad cero');
    await user.click(screen.getByTestId('hardware-profile-item-add-btn'));
    await user.selectOptions(screen.getByTestId('hardware-profile-item-hardware-select'), 'hw-1');
    const quantity = screen.getByTestId('hardware-profile-item-quantity-input');
    await user.clear(quantity);
    await user.type(quantity, '0');
    await user.click(screen.getByTestId('hardware-profile-form-submit-btn'));
    expect(props.onCreate).not.toHaveBeenCalled();
    expect(screen.getByText(/cantidad de la línea 1/i)).toBeTruthy();
  });

  it('keeps the modal and draft open on a stale write (412) with the reload message', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockRejectedValue(
      new GraneteApiError(412, {
        code: 'VERSION_CONFLICT' as never,
        message: 'conflict',
        fieldErrors: {},
        requestId: 'r',
        retryable: false,
        details: {},
      }),
    );
    setup({ onUpdate });
    await user.click(screen.getByRole('button', { name: /Editar PERF-SPAX-50/i }));
    await user.click(screen.getByTestId('hardware-profile-form-submit-btn'));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const updateCall = (onUpdate as ReturnType<typeof vi.fn>).mock.calls[0] as
      | [string, number, HardwareProfileDraft]
      | undefined;
    expect(updateCall).toBeDefined();
    expect(updateCall![0]).toBe('p-1');
    expect(updateCall![1]).toBe(3);
    const modal = screen.getByTestId('hardware-profile-form-modal');
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain('cambió en otra sesión');
    // The draft keeps the loaded code.
    const codeInput = screen.getByTestId('hardware-profile-code-input') as HTMLInputElement;
    expect(codeInput.value).toBe('PERF-SPAX-50');
  });

  it('deactivates with the row version', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.click(screen.getByRole('button', { name: /Desactivar PERF-SPAX-50/i }));
    expect(props.onDeactivate).toHaveBeenCalledWith('p-1', 3);
  });

  it('hides the create action when canMutate is false (row actions stay read-only)', () => {
    setup({ canMutate: false });
    expect(screen.queryByTestId('hardware-profile-create-btn')).toBeNull();
    expect(screen.getByRole('button', { name: /Editar PERF-SPAX-50/i })).toBeTruthy();
  });
});
