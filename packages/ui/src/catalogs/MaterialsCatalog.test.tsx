import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Materials catalog — empty vs no-results (#32) + create handoff (#33).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MaterialBoard } from '@muebles/domain';
import { resetRequestCreateKeyConsumers } from '../common/consumeRequestCreateKey';
import { MaterialsCatalog } from './materials/MaterialsCatalog';

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
    const src = readFileSync(join(here, 'materials/MaterialFormModal.tsx'), 'utf8');
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
    await user.click(screen.getByRole('button', { name: 'Editar MAT-01' }));
    expect(screen.getByTestId('material-preview-3d-body')).toBeTruthy();
    expect(screen.getByTestId('material-preview-color-input')).toBeTruthy();
  });

  it('allows selecting PBR finish presets and submitting roughness/clearcoat/metalness', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <MaterialsCatalog
        materials={[sampleMaterial]}
        edges={[]}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        onCreateEdge={vi.fn(() => 'edge-new')}
        getCostPerM2={() => 25}
      />,
    );

    await user.click(screen.getByText('MAT-01'));
    await user.click(screen.getByRole('button', { name: 'Editar MAT-01' }));
    await user.click(screen.getByTestId('material-preview-3d-toggle'));
    expect(screen.getByTestId('material-pbr-section')).toBeTruthy();

    // Click "Alto Brillo / Laca" preset
    await user.click(screen.getByTestId('material-pbr-preset-gloss'));
    expect((screen.getByTestId('material-pbr-roughness-input') as HTMLInputElement).value).toBe('0.08');
    expect((screen.getByTestId('material-pbr-clearcoat-input') as HTMLInputElement).value).toBe('0.85');

    // F142: fabricante obligatorio — completarlo antes de enviar.
    fireEvent.change(screen.getByTestId('material-form-manufacturer'), {
      target: { value: 'Arauco' },
    });
    // Submit form
    const form = screen.getByTestId('material-form-modal').querySelector('form');
    fireEvent.submit(form!);
    expect(onUpdate).toHaveBeenCalledWith(
      'mat-1',
      expect.objectContaining({
        previewRoughness: 0.08,
        previewClearcoat: 0.85,
        previewMetalness: 0,
      }),
    );
  });

  it('renders category sidebar and allows creating a material category', async () => {
    const user = userEvent.setup();
    const onCreateCategory = vi.fn();
    render(
      <MaterialsCatalog
        materials={[sampleMaterial]}
        edges={[]}
        materialCategories={[
          { id: 'cat-wood', name: 'Maderas', sortOrder: 1 },
        ]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        onCreateEdge={vi.fn(() => 'edge-new')}
        onCreateCategory={onCreateCategory}
        getCostPerM2={() => 25}
      />,
    );

    // Sidebar should be present
    expect(screen.getByTestId('category-filter-panel')).toBeTruthy();
    expect(screen.getByTestId('category-filter-all')).toBeTruthy();
    expect(screen.getByTestId('category-filter-cat-wood')).toBeTruthy();

    // Click edit categories button
    await user.click(screen.getByTestId('category-filter-edit'));
    expect(screen.getByTestId('material-category-manage-modal')).toBeTruthy();

    // Click "Nueva categoría" inside manage modal
    await user.click(screen.getByTestId('material-category-create-btn'));
    expect(screen.getByTestId('material-category-form-modal')).toBeTruthy();

    // Type category name and submit
    fireEvent.change(screen.getByTestId('material-category-name-input'), {
      target: { value: 'Unicolores' },
    });
    const form = screen.getByTestId('material-category-form-modal').querySelector('form');
    fireEvent.submit(form!);

    expect(onCreateCategory).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Unicolores',
        parentId: '',
      }),
    );
  });

  it('allows progressive selection of 3-level subcategories in material form', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <MaterialsCatalog
        materials={[]}
        edges={[]}
        materialCategories={[
          { id: 'cat-maderas', name: 'Maderas', sortOrder: 1 },
          { id: 'cat-roble', name: 'Roble', parentId: 'cat-maderas', sortOrder: 1 },
          { id: 'cat-claro', name: 'Claro', parentId: 'cat-roble', sortOrder: 1 },
        ]}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        onCreateEdge={vi.fn(() => 'edge-new')}
        getCostPerM2={() => 25}
      />,
    );

    // Click "Agregar material"
    await user.click(screen.getByRole('button', { name: 'Agregar material' }));

    // Fill code, name, manufacturer
    fireEvent.change(screen.getByLabelText('Código'), { target: { value: 'MAT-02' } });
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Roble Claro 18' } });
    fireEvent.change(screen.getByTestId('material-form-manufacturer'), { target: { value: 'Arauco' } });

    // Level 1 category should be visible, L2 should not yet
    expect(screen.getByTestId('material-form-category-l1')).toBeTruthy();
    expect(screen.queryByTestId('material-form-category-l2')).toBeNull();

    // Select Level 1: "Maderas"
    fireEvent.change(screen.getByTestId('material-form-category-l1'), { target: { value: 'cat-maderas' } });

    // Level 2 should now appear
    expect(screen.getByTestId('material-form-category-l2')).toBeTruthy();
    expect(screen.queryByTestId('material-form-category-l3')).toBeNull();

    // Select Level 2: "Roble"
    fireEvent.change(screen.getByTestId('material-form-category-l2'), { target: { value: 'cat-roble' } });

    // Level 3 should now appear
    expect(screen.getByTestId('material-form-category-l3')).toBeTruthy();

    // Select Level 3: "Claro"
    fireEvent.change(screen.getByTestId('material-form-category-l3'), { target: { value: 'cat-claro' } });

    // Fill required dimensions/price
    fireEvent.change(screen.getByLabelText('Espesor (mm)'), { target: { value: '18' } });
    fireEvent.change(screen.getByLabelText('Ancho del tablero (mm)'), { target: { value: '1830' } });
    fireEvent.change(screen.getByLabelText('Largo del tablero — Veta (mm)'), { target: { value: '2440' } });
    fireEvent.change(screen.getByLabelText('Precio del tablero ($)'), { target: { value: '100' } });

    // Submit
    const form = screen.getByTestId('material-form-modal').querySelector('form');
    fireEvent.submit(form!);

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'MAT-02',
        name: 'Roble Claro 18',
        manufacturer: 'Arauco',
        categoryId: 'cat-claro',
      }),
    );
  });
});
