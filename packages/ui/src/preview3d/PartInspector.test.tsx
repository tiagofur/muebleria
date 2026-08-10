/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ResolvedBoardPart } from '@muebles/domain';
import { PartInspector } from './PartInspector';
import { PartList } from './PartList';

const STORAGE_KEY = 'muebles.part-inspector.sections.v1';

/**
 * jsdom en este repo no habilita localStorage por defecto. Instalamos un
 * mock tipo Map para que useInspectorSectionState persista como en producción
 * y los tests de colapso/persistencia sean determinísticos.
 */
function installLocalStorageMock(): void {
  const store = new Map<string, string>();
  const mock: Storage = {
    get length(): number {
      return store.size;
    },
    clear: (): void => store.clear(),
    getItem: (key: string): string | null => store.get(key) ?? null,
    key: (index: number): string | null => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string): void => {
      store.delete(key);
    },
    setItem: (key: string, value: string): void => {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: mock,
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  installLocalStorageMock();
});

afterEach(() => {
  cleanup();
  globalThis.localStorage?.clear();
});

const samplePart: ResolvedBoardPart = {
  id: 'lat-copy-0',
  code: 'COM-LAT',
  description: 'Lateral izquierdo',
  quantity: 1,
  lengthMm: 720,
  widthMm: 560,
  thicknessMm: 18,
  grain: 1,
  edges: [],
  optionRole: 'INTERIOR',
  materialId: 'mat-a',
  x: 0,
  y: 0,
  z: 0,
  rotateX: 90,
  rotateY: 180,
  rotateZ: 90,
};

describe('PartInspector', () => {
  it('shows empty hint when no part is selected', () => {
    render(<PartInspector part={null} />);
    expect(
      screen.getByText(/Seleccioná una pieza en el 3D/i),
    ).toBeTruthy();
  });

  it('renders dims, pose, role and clear action', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    const onIsolateChange = vi.fn();
    render(
      <PartInspector
        part={samplePart}
        onClear={onClear}
        isolateSelected={false}
        onIsolateChange={onIsolateChange}
      />,
    );

    // Título y código (siempre visibles en el header)
    expect(screen.getByTestId('part-inspector-title').textContent).toMatch(
      /Lateral izquierdo/,
    );
    // Dimensiones: sección abierta por defecto
    expect(screen.getByTestId('part-inspector-dims').textContent).toMatch(
      /720 mm/,
    );
    expect(screen.getByTestId('part-inspector-qty').textContent).toBe('1');

    // Avanzado (role, pose, rotation, isolate) arranca CERRADO por defecto.
    // Abrimos la sección antes de validar sus campos.
    await user.click(screen.getByTestId('part-inspector-section-advanced'));
    expect(screen.getByTestId('part-inspector-role').textContent).toBe(
      'INTERIOR',
    );
    expect(screen.getByTestId('part-inspector-pose').textContent).toMatch(
      /0 mm/,
    );
    expect(screen.getByTestId('part-inspector-rotation').textContent).toMatch(
      /90°/,
    );

    await user.click(screen.getByTestId('part-inspector-clear'));
    expect(onClear).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('part-inspector-isolate-checkbox'));
    expect(onIsolateChange).toHaveBeenCalledWith(true);
  });

  it('renders all 5 section headers', () => {
    render(<PartInspector part={samplePart} />);
    expect(screen.getByTestId('part-inspector-section-dimensions')).toBeTruthy();
    expect(screen.getByTestId('part-inspector-section-material')).toBeTruthy();
    expect(screen.getByTestId('part-inspector-section-hardware')).toBeTruthy();
    expect(screen.getByTestId('part-inspector-section-finish')).toBeTruthy();
    expect(screen.getByTestId('part-inspector-section-advanced')).toBeTruthy();
  });

  it('toggles a section open→closed (body hides) and back', async () => {
    const user = userEvent.setup();
    render(<PartInspector part={samplePart} />);

    // Dimensions arranca abierto → dims visible
    expect(screen.getByTestId('part-inspector-dims')).toBeTruthy();

    // Cerrar dimensions
    await user.click(screen.getByTestId('part-inspector-section-dimensions'));
    expect(screen.queryByTestId('part-inspector-dims')).toBeNull();

    // Reabrir
    await user.click(screen.getByTestId('part-inspector-section-dimensions'));
    expect(screen.getByTestId('part-inspector-dims')).toBeTruthy();
  });

  it('advanced starts collapsed (role not rendered until opened)', () => {
    render(<PartInspector part={samplePart} />);
    expect(screen.queryByTestId('part-inspector-role')).toBeNull();
  });

  it('shows hardware and finish placeholders', () => {
    render(<PartInspector part={samplePart} />);
    expect(
      screen.getByTestId('part-inspector-hardware-placeholder').textContent,
    ).toMatch(/Sin herrajes definidos/i);
    expect(
      screen.getByTestId('part-inspector-finish-section-placeholder')
        .textContent,
    ).toMatch(/Acabado del material/i);
  });

  it('persists collapse state across remounts', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<PartInspector part={samplePart} />);

    // Cerrar dimensions
    await user.click(screen.getByTestId('part-inspector-section-dimensions'));
    expect(screen.queryByTestId('part-inspector-dims')).toBeNull();

    // Verificamos que se persistió
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.dimensions).toBe(false);

    // Desmontar y remontar — la sección sigue cerrada
    unmount();
    render(<PartInspector part={samplePart} />);
    expect(screen.queryByTestId('part-inspector-dims')).toBeNull();

    // Y al abrir de nuevo, vuelve el contenido
    await user.click(screen.getByTestId('part-inspector-section-dimensions'));
    expect(screen.getByTestId('part-inspector-dims')).toBeTruthy();
  });
});

describe('PartList', () => {
  it('selects a part from the list', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <PartList
        parts={[samplePart]}
        selectedPartId={null}
        onSelectPart={onSelect}
      />,
    );
    await user.click(screen.getByTestId('part-list-item-lat-copy-0'));
    expect(onSelect).toHaveBeenCalledWith('lat-copy-0');
  });
});
