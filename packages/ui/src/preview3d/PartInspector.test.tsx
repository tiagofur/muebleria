/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ResolvedBoardPart } from '@muebles/domain';
import { PartInspector } from './PartInspector';
import { PartList } from './PartList';

afterEach(() => {
  cleanup();
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

    expect(screen.getByTestId('part-inspector-title').textContent).toMatch(
      /Lateral izquierdo/,
    );
    expect(screen.getByTestId('part-inspector-role').textContent).toBe(
      'INTERIOR',
    );
    expect(screen.getByTestId('part-inspector-dims').textContent).toMatch(
      /720 mm/,
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
