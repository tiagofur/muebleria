import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Materials catalog — empty vs no-results (#32) + create handoff (#33).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MaterialBoard } from '@muebles/domain';
import { resetRequestCreateKeyConsumers } from '../common/consumeRequestCreateKey';
import { MaterialsCatalog } from './MaterialsCatalog';

const here = dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  cleanup();
  resetRequestCreateKeyConsumers();
});

const sampleMaterial: MaterialBoard = {
  id: 'mat-1',
  code: 'MAT-01',
  name: 'Melamina blanca 15',
  widthMm: 1830,
  lengthMm: 2440,
  thicknessMm: 15,
  grainDefault: false,
  boardPrice: 100,
  wastePercent: 10,
  costPerM2: 25,
  active: true,
};

describe('MaterialsCatalog create handoff (#33)', () => {
  it('opens create modal when requestCreateKey bumps', async () => {
    const { rerender } = render(
      <MaterialsCatalog
        materials={[sampleMaterial]}
        edges={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        onCreateEdge={vi.fn(() => 'edge-new')}
        getCostPerM2={() => 25}
        requestCreateKey={0}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(
      <MaterialsCatalog
        materials={[sampleMaterial]}
        edges={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        onCreateEdge={vi.fn(() => 'edge-new')}
        getCostPerM2={() => 25}
        requestCreateKey={1}
      />,
    );
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});

describe('MaterialsCatalog empty states (#32)', () => {
  it('shows EmptyState when catalog is truly empty', () => {
    render(
      <MaterialsCatalog
        materials={[]}
        edges={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        onCreateEdge={vi.fn(() => 'edge-new')}
        getCostPerM2={() => 0}
      />,
    );
    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(screen.getByText('No hay materiales')).toBeTruthy();
    expect(screen.queryByTestId('empty-state-no-results')).toBeNull();
  });

  it('shows no-results and Limpiar filtros restores search + status', async () => {
    const user = userEvent.setup();
    render(
      <MaterialsCatalog
        materials={[sampleMaterial]}
        edges={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        onCreateEdge={vi.fn(() => 'edge-new')}
        getCostPerM2={() => 25}
      />,
    );

    expect(screen.getByText('MAT-01')).toBeTruthy();
    await user.type(
      screen.getByLabelText(/Buscar materiales/i),
      'zzzz-no-match',
    );
    await waitFor(() => {
      expect(screen.getByTestId('empty-state-no-results')).toBeTruthy();
    });
    expect(screen.getByText('Sin resultados')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Limpiar filtros/i }));
    await waitFor(() => {
      expect(screen.queryByTestId('empty-state-no-results')).toBeNull();
    });
    expect(screen.getByText('MAT-01')).toBeTruthy();
    expect(
      (screen.getByLabelText(/Buscar materiales/i) as HTMLInputElement).value,
    ).toBe('');
  });
});

describe('MaterialsCatalog image upload (F042)', () => {
  it('exposes image field and CatalogImage for materials', () => {
    const src = readFileSync(join(here, 'MaterialsCatalog.tsx'), 'utf8');
    expect(src).toContain('material-image-field');
    expect(src).toContain('onUploadImage');
    expect(src).toContain('imageUrl');
  });
});

describe('MaterialsCatalog form layout (Fase 3 UI)', () => {
  it('uses MD modal, grouped sections, and 3D disclosure collapsed on create', async () => {
    const user = userEvent.setup();
    render(
      <MaterialsCatalog
        materials={[sampleMaterial]}
        edges={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        onCreateEdge={vi.fn(() => 'edge-new')}
        getCostPerM2={() => 25}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Nuevo material/i }));
    expect(screen.getByTestId('material-form-modal')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Materiales' })).toBeTruthy();
    // Core price field visible without opening advanced.
    expect(screen.getByLabelText(/Precio del tablero/i)).toBeTruthy();
    expect(screen.getByLabelText(/Espesor/i)).toBeTruthy();
    // 3D fields stay collapsed until disclosure opens.
    expect(screen.queryByTestId('material-preview-3d-body')).toBeNull();
    expect(screen.queryByTestId('material-use-photo-texture')).toBeNull();

    await user.click(screen.getByTestId('material-preview-3d-toggle'));
    expect(screen.getByTestId('material-preview-3d-body')).toBeTruthy();
    expect(screen.getByTestId('material-use-photo-texture')).toBeTruthy();
  });

  it('opens Vista 3D when editing a material with preview config', async () => {
    const user = userEvent.setup();
    const withPreview: MaterialBoard = {
      ...sampleMaterial,
      previewColor: '#F5F5F0',
    };
    render(
      <MaterialsCatalog
        materials={[withPreview]}
        edges={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        onCreateEdge={vi.fn(() => 'edge-new')}
        getCostPerM2={() => 25}
      />,
    );

    await user.click(screen.getByText('MAT-01'));
    await user.click(screen.getByRole('button', { name: /^Editar$/i }));
    expect(screen.getByTestId('material-preview-3d-body')).toBeTruthy();
    expect(screen.getByTestId('material-preview-color-input')).toBeTruthy();
  });
});
