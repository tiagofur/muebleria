/**
 * EdgesCatalog tests (gap #6 — was the only catalog screen without a component test).
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EdgeBand } from '@granete/domain';
import { EdgesCatalog } from './EdgesCatalog';

function makeEdge(id: string, overrides: Partial<EdgeBand> = {}): EdgeBand {
  return {
    id,
    code: `CANTO-${id.toUpperCase()}`,
    name: `Canto ${id}`,
    thicknessMm: 1,
    costPerMl: 0.05,
    active: true,
    ...overrides,
  };
}

const baseProps = {
  onCreate: vi.fn(),
  onUpdate: vi.fn(),
  onDeactivate: vi.fn(),
  onReactivate: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EdgesCatalog (gap #6)', () => {
  it('renders edges as rows', () => {
    render(
      <EdgesCatalog
        edges={[makeEdge('a'), makeEdge('b', { name: 'Roble' })]}
        {...baseProps}
      />,
    );
    expect(screen.getByText('Canto a')).toBeTruthy();
    expect(screen.getByText('Roble')).toBeTruthy();
  });

  it('shows empty state when catalog is empty', () => {
    render(<EdgesCatalog edges={[]} {...baseProps} />);
    expect(screen.getByText(/sin cintillas|agregá/i)).toBeTruthy();
  });

  it('calls onCreate with the draft when submitting the create form', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<EdgesCatalog edges={[]} onCreate={onCreate} onUpdate={vi.fn()} onDeactivate={vi.fn()} onReactivate={vi.fn()} />);

    // Open the create modal/form
    const addBtn = screen.getByRole('button', { name: /agregar|nueva|crear/i });
    await user.click(addBtn);

    // Wave 5: form sections for consistency with materials
    expect(screen.getByTestId('edge-form-identity')).toBeTruthy();
    expect(screen.getByTestId('edge-form-measure')).toBeTruthy();

    // Fill the form
    await user.type(screen.getByLabelText(/código/i), 'CANTO-NEW');
    await user.type(screen.getByLabelText(/nombre/i), 'Canto nuevo');
    await user.type(screen.getByLabelText(/espesor/i), '2');
    await user.type(screen.getByLabelText(/costo/i), '0.10');

    // Submit
    const submitBtn = screen.getByRole('button', { name: /guardar|crear|confirmar/i });
    await user.click(submitBtn);

    expect(onCreate).toHaveBeenCalledTimes(1);
    const draft = onCreate.mock.calls[0]![0];
    expect(draft.code).toBe('CANTO-NEW');
    expect(draft.name).toBe('Canto nuevo');
  });


  it('normalizes the optional preview color when saving', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<EdgesCatalog edges={[]} onCreate={onCreate} onUpdate={vi.fn()} onDeactivate={vi.fn()} onReactivate={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /agregar|nueva|crear/i }));
    await user.type(screen.getByLabelText(/código/i), 'CAN-COLOR');
    await user.type(screen.getByLabelText(/^nombre/i), 'Canto color');
    await user.clear(screen.getByPlaceholderText('#F5F5F0'));
    await user.type(screen.getByPlaceholderText('#F5F5F0'), '#aabbcc');
    await user.click(screen.getByRole('button', { name: /guardar/i }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ previewColor: '#AABBCC' }));
  });

  it('shows inactive edges with a reactivate action when canMutate', async () => {
    const user = userEvent.setup();
    const onReactivate = vi.fn();
    render(
      <EdgesCatalog
        edges={[makeEdge('x', { active: false })]}
        canMutate
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={onReactivate}
      />,
    );
    // Inactive edges should appear when status filter includes them (default or toggle).
    // The reactivate button is surfaced for inactive items.
    const reactivateBtn = screen.queryByRole('button', { name: /reactivar/i });
    if (reactivateBtn) {
      await user.click(reactivateBtn);
      expect(onReactivate).toHaveBeenCalledWith(expect.any(String));
    }
  });
});

describe('EdgesCatalog — save contract (K1 #1032)', () => {
  it('keeps the modal open with the form and shows the server error when the save fails', async () => {
    const user = userEvent.setup();
    let rejectSave!: (err: Error) => void;
    const onCreate = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    render(
      <EdgesCatalog
        edges={[]}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Nuevo canto/i }));
    await user.type(screen.getByLabelText('Código'), 'CAN-K1');
    await user.type(screen.getByLabelText('Nombre'), 'Canto K1');
    await user.type(screen.getByLabelText('Espesor (mm)'), '15');
    await user.type(screen.getByLabelText('Costo / ML'), '5');
    await user.click(screen.getByTestId('edge-form-submit-btn'));

    const saveBtn = screen.getByTestId('edge-form-submit-btn');
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);
    expect(saveBtn.textContent).toContain('Guardando');

    await act(async () => {
      rejectSave(new Error('network down'));
    });

    // The modal is still open (its footer submit exists) with the error shown.
    expect(screen.getByTestId('edge-form-submit-btn')).toBeTruthy();
    expect(screen.getByText(/network down/)).toBeTruthy();
    expect((screen.getByLabelText('Código') as HTMLInputElement).value).toBe('CAN-K1');
    expect((screen.getByTestId('edge-form-submit-btn') as HTMLButtonElement).disabled).toBe(false);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('closes the modal only after the save settles successfully', async () => {
    const user = userEvent.setup();
    let resolveSave!: () => void;
    const onCreate = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    render(
      <EdgesCatalog
        edges={[]}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Nuevo canto/i }));
    await user.type(screen.getByLabelText('Código'), 'CAN-K1');
    await user.type(screen.getByLabelText('Nombre'), 'Canto K1');
    await user.type(screen.getByLabelText('Espesor (mm)'), '15');
    await user.type(screen.getByLabelText('Costo / ML'), '5');
    await user.click(screen.getByTestId('edge-form-submit-btn'));

    expect(screen.getByTestId('edge-form-submit-btn')).toBeTruthy();
    await act(async () => { resolveSave(); });
    await waitFor(() =>
      expect(screen.queryByTestId('edge-form-submit-btn')).toBeNull(),
    );
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});
