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
  it('renders hint text and target surface switcher', () => {
    render(<MaterialPalette materials={sampleMaterials} categories={sampleCategories} />);
    expect(screen.getByText(/Hacé clic en un acabado para aplicarlo/i)).toBeTruthy();
    expect(screen.getByTestId('material-palette-target-floor')).toBeTruthy();
    expect(screen.getByTestId('material-palette-target-wall')).toBeTruthy();
    expect(screen.getByTestId('material-palette-target-ceiling')).toBeTruthy();
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

  it('filters materials when category pill is clicked', () => {
    render(<MaterialPalette materials={sampleMaterials} categories={sampleCategories} />);
    const woodPill = screen.getByTestId('material-palette-cat-cat-wood');
    fireEvent.click(woodPill);

    expect(screen.getByTestId('material-palette-chip-am-1')).toBeTruthy();
    expect(screen.queryByTestId('material-palette-chip-am-2')).toBeNull();
    expect(screen.queryByTestId('material-palette-chip-am-4')).toBeNull();
  });

  it('filters materials using search input', () => {
    render(<MaterialPalette materials={sampleMaterials} categories={sampleCategories} />);
    const searchInput = screen.getByPlaceholderText(/Buscar acabado por nombre o código/i);
    fireEvent.change(searchInput, { target: { value: 'Beige' } });

    expect(screen.getByTestId('material-palette-chip-am-4')).toBeTruthy();
    expect(screen.queryByTestId('material-palette-chip-am-1')).toBeNull();
  });

  it('calls onSelectMaterial with selected target surface when clicked', () => {
    const onSelect = vi.fn();
    render(
      <MaterialPalette
        materials={sampleMaterials}
        categories={sampleCategories}
        onSelectMaterial={onSelect}
      />,
    );

    // Default target surface is 'floor'
    fireEvent.click(screen.getByTestId('material-palette-chip-am-1'));
    expect(onSelect).toHaveBeenCalledWith(sampleMaterials[0], 'floor');

    // Switch target to 'wall'
    fireEvent.click(screen.getByTestId('material-palette-target-wall'));
    fireEvent.click(screen.getByTestId('material-palette-chip-am-4'));
    expect(onSelect).toHaveBeenCalledWith(sampleMaterials[3], 'wall');
  });

  it('marks chip as active when matches current target surface', () => {
    render(
      <MaterialPalette
        materials={sampleMaterials}
        categories={sampleCategories}
        activeFloorId="am-1"
        activeWallId="am-4"
      />,
    );

    // Target surface is floor -> am-1 should be active
    const chip1 = screen.getByTestId('material-palette-chip-am-1');
    expect(chip1.getAttribute('aria-pressed')).toBe('true');

    // Switch to wall -> am-4 should be active
    fireEvent.click(screen.getByTestId('material-palette-target-wall'));
    const chip4 = screen.getByTestId('material-palette-chip-am-4');
    expect(chip4.getAttribute('aria-pressed')).toBe('true');
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
});

