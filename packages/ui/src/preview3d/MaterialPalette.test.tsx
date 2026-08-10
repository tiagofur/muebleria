/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AmbientMaterial } from '@muebles/domain';
import { MaterialPalette } from './MaterialPalette';
import { PAINT_DRAG_MIME, decodePaintDrag } from './paintMaterial';

afterEach(() => {
  cleanup();
});

const floors: AmbientMaterial[] = [
  {
    id: 'am-floor-1',
    code: 'F1',
    name: 'Madera Roble',
    active: true,
    surfaceType: 'floor',
    previewColor: '#8B4513',
  },
  {
    id: 'am-floor-2',
    code: 'F2',
    name: 'Cerámica Blanca',
    active: true,
    surfaceType: 'floor',
    previewTextureUrl: 'https://example.com/tile.png',
  },
  {
    id: 'am-floor-3',
    code: 'F3',
    name: 'Inactivo',
    active: false,
    surfaceType: 'floor',
    previewColor: '#000',
  },
];

const walls: AmbientMaterial[] = [
  {
    id: 'am-wall-1',
    code: 'W1',
    name: 'Pintura Beige',
    active: true,
    surfaceType: 'wall',
    previewColor: '#F5F5DC',
  },
];

const materials = [...floors, ...walls];

describe('MaterialPalette', () => {
  it('renders hint text', () => {
    render(<MaterialPalette materials={materials} />);
    expect(
      screen.getByText(/Arrastrá un material al piso o muro/i),
    ).toBeTruthy();
  });

  it('separates floor and wall materials into groups', () => {
    render(<MaterialPalette materials={materials} />);
    // 2 floors activos (el inactivo no) + 1 wall
    expect(screen.getByTestId('material-palette-floor-am-floor-1')).toBeTruthy();
    expect(screen.getByTestId('material-palette-floor-am-floor-2')).toBeTruthy();
    expect(screen.queryByTestId('material-palette-floor-am-floor-3')).toBeNull();
    expect(screen.getByTestId('material-palette-wall-am-wall-1')).toBeTruthy();
  });

  it('shows empty message when no floor materials', () => {
    render(<MaterialPalette materials={walls} />);
    expect(screen.getByText(/Sin materiales de piso/i)).toBeTruthy();
  });

  it('marks the active floor material', () => {
    render(
      <MaterialPalette
        materials={materials}
        activeFloorId="am-floor-1"
      />,
    );
    const active = screen.getByTestId('material-palette-floor-am-floor-1');
    expect(active.getAttribute('aria-pressed')).toBe('true');
    const inactive = screen.getByTestId('material-palette-floor-am-floor-2');
    expect(inactive.getAttribute('aria-pressed')).toBe('false');
  });

  it('marks the active wall material', () => {
    render(
      <MaterialPalette materials={materials} activeWallId="am-wall-1" />,
    );
    expect(
      screen.getByTestId('material-palette-wall-am-wall-1').getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('sets paint drag payload in dataTransfer on dragStart', () => {
    render(<MaterialPalette materials={materials} />);
    const chip = screen.getByTestId('material-palette-floor-am-floor-1');

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
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'am-floor-1');

    const payload = decodePaintDrag(dataStore.get(PAINT_DRAG_MIME)!);
    expect(payload).toEqual({ materialId: 'am-floor-1', surfaceType: 'floor' });
  });

  it('encodes wall surfaceType correctly on drag', () => {
    render(<MaterialPalette materials={materials} />);
    const chip = screen.getByTestId('material-palette-wall-am-wall-1');

    const dataStore = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: null as string | null,
      setData: vi.fn((mime: string, data: string) => {
        dataStore.set(mime, data);
      }),
      getData: vi.fn(),
    };

    fireEvent.dragStart(chip, { dataTransfer });
    const payload = decodePaintDrag(dataStore.get(PAINT_DRAG_MIME)!);
    expect(payload?.surfaceType).toBe('wall');
  });

  it('renders texture thumbnail when previewTextureUrl present', () => {
    render(<MaterialPalette materials={materials} />);
    const chip = screen.getByTestId('material-palette-floor-am-floor-2');
    const img = chip.querySelector('img.material-palette__thumb-img');
    expect(img?.getAttribute('src')).toBe('https://example.com/tile.png');
  });

  it('renders color swatch when only previewColor present', () => {
    render(<MaterialPalette materials={materials} />);
    const chip = screen.getByTestId('material-palette-floor-am-floor-1');
    const svg = chip.querySelector('svg.material-palette__swatch');
    expect(svg).toBeTruthy();
  });
});
