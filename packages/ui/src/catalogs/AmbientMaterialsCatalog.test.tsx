/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { AmbientMaterial } from '@muebles/domain';

import { AmbientMaterialsCatalog } from './AmbientMaterialsCatalog';

afterEach(() => {
  cleanup();
});

const floorMat: AmbientMaterial = {
  id: 'am-1',
  code: 'CERAMIC-BLACK',
  name: 'Cerámica negra',
  active: true,
  surfaceType: 'floor',
  previewColor: '#222222',
};

const wallMat: AmbientMaterial = {
  id: 'am-2',
  code: 'PORCELAIN-WHITE',
  name: 'Porcelanato blanco',
  active: true,
  surfaceType: 'wall',
  previewColor: '#eeeeee',
};

const inactiveMat: AmbientMaterial = {
  id: 'am-3',
  code: 'PAINT-BEIGE',
  name: 'Pintura beige',
  active: false,
  surfaceType: 'wall',
  previewColor: '#d2b48c',
};

describe('AmbientMaterialsCatalog', () => {
  it('renders table rows for each ambient material', () => {
    render(
      <AmbientMaterialsCatalog
        materials={[floorMat, wallMat]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        canMutate
      />,
    );
    expect(screen.getByText('CERAMIC-BLACK')).toBeTruthy();
    expect(screen.getByText('PORCELAIN-WHITE')).toBeTruthy();
    // surfaceType label rendered (Suelo / Pared)
    expect(screen.getByText('Suelo')).toBeTruthy();
    expect(screen.getByText('Pared')).toBeTruthy();
  });

  it('create flow opens modal and calls onCreate with the draft', () => {
    const onCreate = vi.fn();
    render(
      <AmbientMaterialsCatalog
        materials={[]}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        canMutate
      />,
    );
    fireEvent.click(screen.getByTestId('ambient-material-create'));
    // Modal is open
    const codeInput = screen.getByLabelText('Código');
    fireEvent.change(codeInput, { target: { value: 'GRANITE' } });
    fireEvent.change(screen.getByLabelText('Nombre'), {
      target: { value: 'Granito gris' },
    });
    // surfaceType defaults to floor; keep it
    fireEvent.click(screen.getByTestId('ambient-material-submit'));
    expect(onCreate).toHaveBeenCalledTimes(1);
    const draft = onCreate.mock.calls[0]![0];
    expect(draft.code).toBe('GRANITE');
    expect(draft.name).toBe('Granito gris');
    expect(draft.surfaceType).toBe('floor');
  });

  it('edit flow opens modal pre-filled and calls onUpdate', () => {
    const onUpdate = vi.fn();
    render(
      <AmbientMaterialsCatalog
        materials={[floorMat]}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        canMutate
      />,
    );
    // Click edit from the row action
    fireEvent.click(screen.getByLabelText(`Editar ${floorMat.code}`));
    const codeInput = screen.getByLabelText('Código');
    expect((codeInput as HTMLInputElement).value).toBe('CERAMIC-BLACK');
    fireEvent.change(codeInput, { target: { value: 'CERAMIC-GRAY' } });
    fireEvent.click(screen.getByTestId('ambient-material-submit'));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0]![0]).toBe('am-1');
    expect(onUpdate.mock.calls[0]![1].code).toBe('CERAMIC-GRAY');
  });

  it('deactivate calls onDeactivate with the id', () => {
    const onDeactivate = vi.fn();
    render(
      <AmbientMaterialsCatalog
        materials={[floorMat]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={onDeactivate}
        onReactivate={vi.fn()}
        canMutate
      />,
    );
    fireEvent.click(screen.getByLabelText(`Desactivar ${floorMat.code}`));
    expect(onDeactivate).toHaveBeenCalledWith('am-1');
  });

  it('reactivate calls onReactivate for inactive materials', () => {
    const onReactivate = vi.fn();
    render(
      <AmbientMaterialsCatalog
        materials={[inactiveMat]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={onReactivate}
        canMutate
      />,
    );
    // Default filter is 'active' — switch to 'Todos' to show inactive rows.
    fireEvent.click(screen.getByText('Todos'));
    fireEvent.click(screen.getByLabelText(`Reactivar ${inactiveMat.code}`));
    expect(onReactivate).toHaveBeenCalledWith('am-3');
  });

  it('hides all mutate actions when canMutate is false (read-only RBAC)', () => {
    render(
      <AmbientMaterialsCatalog
        materials={[floorMat]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        canMutate={false}
      />,
    );
    // No create button
    expect(screen.queryByTestId('ambient-material-create')).toBeNull();
    // No edit/deactivate on rows
    expect(screen.queryByLabelText(`Editar ${floorMat.code}`)).toBeNull();
    expect(screen.queryByLabelText(`Desactivar ${floorMat.code}`)).toBeNull();
    // Material still visible (read access)
    expect(screen.getByText('CERAMIC-BLACK')).toBeTruthy();
  });

  it('surfaceType select offers floor and wall options', () => {
    render(
      <AmbientMaterialsCatalog
        materials={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        canMutate
      />,
    );
    fireEvent.click(screen.getByTestId('ambient-material-create'));
    const select = screen.getByLabelText('Tipo de superficie');
    const options = (select as HTMLSelectElement).options;
    const values = Array.from(options).map((o) => o.value);
    expect(values).toContain('floor');
    expect(values).toContain('wall');
  });
});
