/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AmbientCategory, AmbientMaterial } from '@muebles/domain';
import { MaterialPalette } from './MaterialPalette';
import { PAINT_DRAG_MIME, decodePaintDrag } from './paintMaterial';

afterEach(() => {
  cleanup();
});

const sampleCategories: AmbientCategory[] = [
  { id: 'cat-wood', name: 'Maderas', sortOrder: 1 },
  { id: 'cat-oak', name: 'Robles', parentId: 'cat-wood', sortOrder: 1 },
  { id: 'cat-paint', name: 'Pinturas', sortOrder: 2 },
];

const sampleMaterials: AmbientMaterial[] = [
  {
    id: 'am-1',
    code: 'F1',
    name: 'Madera Roble Claro',
    active: true,
    categoryId: 'cat-oak',
    previewColor: '#8B4513',
  },
  {
    id: 'am-2',
    code: 'F2',
    name: 'Cerámica Blanca',
    active: true,
    categoryId: 'cat-paint',
    previewTextureUrl: 'https://example.com/tile.png',
  },
  {
    id: 'am-3',
    code: 'F3',
    name: 'Inactivo',
    active: false,
    previewColor: '#000',
  },
  {
    id: 'am-4',
    code: 'W1',
    name: 'Pintura Beige',
    active: true,
    categoryId: 'cat-paint',
    previewColor: '#F5F5DC',
  },
];

describe('MaterialPalette', () => {
  it('renders category comboboxes without click-apply controls', () => {
    render(<MaterialPalette materials={sampleMaterials} categories={sampleCategories} />);
    expect(screen.getByTestId('material-palette-select-l1')).toBeTruthy();
    // Drag-only: no hay selector de superficie para aplicar con clic.
    expect(screen.queryByTestId('material-palette-target-floor')).toBeNull();
    expect(screen.queryByText(/Aplicar con clic/i)).toBeNull();
  });

  it('groups materials by category taxonomy', () => {
    render(<MaterialPalette materials={sampleMaterials} categories={sampleCategories} />);
    // 3 active materials rendered (am-3 is inactive and not shown)
    expect(screen.getByTestId('material-palette-chip-am-1')).toBeTruthy();
    expect(screen.getByTestId('material-palette-chip-am-2')).toBeTruthy();
    expect(screen.queryByTestId('material-palette-chip-am-3')).toBeNull();
    expect(screen.getByTestId('material-palette-chip-am-4')).toBeTruthy();

    // Headers with breadcrumb paths
    expect(screen.getByText('Maderas › Robles')).toBeTruthy();
    expect(screen.getByText('Pinturas')).toBeTruthy();
  });

  it('filters materials and cascades subcategories when combobox is changed', () => {
    render(<MaterialPalette materials={sampleMaterials} categories={sampleCategories} />);
    const l1Select = screen.getByTestId('material-palette-select-l1');
    fireEvent.change(l1Select, { target: { value: 'cat-wood' } });

    // Shows only wood materials (am-1)
    expect(screen.getByTestId('material-palette-chip-am-1')).toBeTruthy();
    expect(screen.queryByTestId('material-palette-chip-am-2')).toBeNull();
    expect(screen.queryByTestId('material-palette-chip-am-4')).toBeNull();

    // Cascaded L2 select appears with children of 'cat-wood' (Robles)
    const l2Select = screen.getByTestId('material-palette-select-l2');
    expect(l2Select).toBeTruthy();

    fireEvent.change(l2Select, { target: { value: 'cat-oak' } });
    expect(screen.getByTestId('material-palette-chip-am-1')).toBeTruthy();
  });

  it('filters materials using search input', () => {
    render(<MaterialPalette materials={sampleMaterials} categories={sampleCategories} />);
    const searchInput = screen.getByPlaceholderText(/Buscar acabado por nombre o código/i);
    fireEvent.change(searchInput, { target: { value: 'Beige' } });

    expect(screen.getByTestId('material-palette-chip-am-4')).toBeTruthy();
    expect(screen.queryByTestId('material-palette-chip-am-1')).toBeNull();
  });

  it('chips are drag-only cards, not clickable buttons', () => {
    render(<MaterialPalette materials={sampleMaterials} categories={sampleCategories} />);
    const chip = screen.getByTestId('material-palette-chip-am-1');
    // Drag-only: la tarjeta no es un botón — se aplica arrastrando al canvas.
    expect(chip.tagName).toBe('DIV');
    expect(chip.getAttribute('draggable')).toBe('true');
    expect(chip.getAttribute('aria-label')).toContain('arrastrar al plano');
  });

  it('marks chips applied to any surface as active', () => {
    render(
      <MaterialPalette
        materials={sampleMaterials}
        categories={sampleCategories}
        activeFloorId="am-1"
        activeWallId="am-4"
      />,
    );

    const chip1 = screen.getByTestId('material-palette-chip-am-1');
    const chip4 = screen.getByTestId('material-palette-chip-am-4');
    expect(chip1.className).toContain('material-palette__chip--active');
    expect(chip4.className).toContain('material-palette__chip--active');

    const chip2 = screen.getByTestId('material-palette-chip-am-2');
    expect(chip2.className).not.toContain('material-palette__chip--active');
  });

  it('sets paint drag payload in dataTransfer on dragStart', () => {
    render(<MaterialPalette materials={sampleMaterials} categories={sampleCategories} />);
    const chip = screen.getByTestId('material-palette-chip-am-1');

    const dataStore = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: null as string | null,
      setData: vi.fn((mime: string, data: string) => {
        dataStore.set(mime, data);
      }),
      getData: vi.fn((mime: string) => dataStore.get(mime) ?? ''),
    };

    fireEvent.dragStart(chip, { dataTransfer });

    expect(dataTransfer.effectAllowed).toBe('copy');
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      PAINT_DRAG_MIME,
      expect.any(String),
    );
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'am-1');

    const payload = decodePaintDrag(dataStore.get(PAINT_DRAG_MIME)!);
    expect(payload?.materialId).toBe('am-1');
  });

  it('renders texture thumbnail and color swatch', () => {
    render(<MaterialPalette materials={sampleMaterials} categories={sampleCategories} />);
    const chipWithImg = screen.getByTestId('material-palette-chip-am-2');
    const img = chipWithImg.querySelector('img.material-palette__thumb-img');
    expect(img?.getAttribute('src')).toBe('https://example.com/tile.png');

    const chipWithColor = screen.getByTestId('material-palette-chip-am-1');
    const svg = chipWithColor.querySelector('svg.material-palette__swatch');
    expect(svg).toBeTruthy();
  });

  it('renders Mesada badge for the active countertop material', () => {
    render(
      <MaterialPalette
        materials={sampleMaterials}
        categories={sampleCategories}
        activeCountertopId="am-2"
      />,
    );

    const chip2 = screen.getByTestId('material-palette-chip-am-2');
    expect(chip2.textContent).toContain('Mesada');
    expect(chip2.className).toContain('material-palette__chip--active');
  });
});

