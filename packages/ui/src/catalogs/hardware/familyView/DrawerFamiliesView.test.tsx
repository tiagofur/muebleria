/**
 * #1633 s2c-2 — vista «Familias de cajón»: cards con estado (icono + texto),
 * detalle con matriz alturas × insertos, abrir el juego/inserto, «Añadir
 * altura» sólo con permiso y vacío que enseña.
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DrawerFamilySummary } from '@granete/domain';

import { DrawerFamiliesView, familyMissingText } from './DrawerFamiliesView';

afterEach(cleanup);

const incomplete: DrawerFamilySummary = {
  agregadoId: 'agr',
  code: 'SYS-CAJON',
  name: 'Cajón Sistema',
  brand: 'Blum',
  line: 'Merivobox',
  guideWidthMm: 570,
  guideDepthMm: 530,
  availableIn: [],
  heights: [
    { label: 'M', khMinMm: 108, kit: { id: 'kit-m', code: 'SYS-M', name: 'M', costPerUnit: 420, designsMissing: 0, active: true }, selector: null, labelDerived: true },
    { label: 'E', khMinMm: 209, kit: { id: 'kit-e', code: 'SYS-E', name: 'E', costPerUnit: 0, designsMissing: 1, active: true }, selector: { id: 'g', code: 'SYS_LATERAL_E', defaultNone: false }, labelDerived: false },
  ],
  inserts: [{ key: 'GAL', label: 'Galería' }],
  cells: [
    {},
    { GAL: { hardwareId: 'e-gal', code: 'SYS-E-GAL', costPerUnit: 120, active: true, designMissing: false, isDefault: true } },
  ],
  missing: { kits: 0, designs: 1, prices: 1 },
  complete: false,
};
const complete: DrawerFamilySummary = {
  ...incomplete,
  agregadoId: 'agr2',
  code: 'LGX-CAJON',
  name: 'Cajón Legrabox',
  missing: { kits: 0, designs: 0, prices: 0 },
  complete: true,
};

describe('DrawerFamiliesView (#1633 s2c-2)', () => {
  it('lista: card por familia con alturas, insertos y estado en texto', () => {
    render(<DrawerFamiliesView families={[incomplete, complete]} onOpenHardware={vi.fn()} />);
    const card = screen.getByTestId('drawer-family-card-SYS-CAJON');
    expect(card).toHaveTextContent('Blum · Merivobox · SYS-CAJON');
    expect(card).toHaveTextContent('2 altura(s): M / E · 1 inserto(s)');
    expect(screen.getByTestId('drawer-family-status-SYS-CAJON')).toHaveTextContent('Le falta: 1 diseño(s), 1 precio(s)');
    expect(screen.getByTestId('drawer-family-status-LGX-CAJON')).toHaveTextContent('Completa');
  });

  it('detalle: matriz con «no aplica», por defecto, precio faltante y abrir el juego', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onAdd = vi.fn();
    render(<DrawerFamiliesView families={[incomplete]} onOpenHardware={onOpen} onAddHeight={onAdd} />);
    await user.click(screen.getByRole('button', { name: 'Ver la familia Cajón Sistema' }));
    const matrix = screen.getByTestId('drawer-family-matrix');
    expect(within(matrix).getByRole('columnheader', { name: 'Galería' })).toBeInTheDocument();
    expect(within(screen.getByTestId('drawer-family-row-M')).getByText('No aplica')).toBeInTheDocument();
    const row = screen.getByTestId('drawer-family-row-E');
    expect(row).toHaveTextContent('Falta precio');
    expect(row).toHaveTextContent('Faltan 1 diseño(s)');
    expect(screen.getByTestId('drawer-family-cell-E-GAL')).toHaveTextContent('Por defecto');
    await user.click(screen.getByRole('button', { name: 'Abrir el juego SYS-E' }));
    expect(onOpen).toHaveBeenCalledWith('kit-e');
    await user.click(screen.getByTestId('drawer-family-add-height'));
    expect(onAdd).toHaveBeenCalledWith('agr');
    // Brief: altura legada con etiqueta deducida, medidas de la guía y «Disponible en».
    expect(screen.getByTestId('drawer-family-derived-M')).toHaveTextContent('Etiqueta deducida');
    expect(screen.queryByTestId('drawer-family-derived-E')).toBeNull();
    expect(screen.getByTestId('drawer-family-guide')).toHaveTextContent('Ancho 570 mm × Fondo 530 mm');
    expect(screen.getByTestId('drawer-family-available')).toHaveTextContent('Ningún grupo');
    await user.click(screen.getByTestId('drawer-family-back'));
    expect(screen.getByTestId('drawer-families-list')).toBeInTheDocument();
  });

  it('sin permiso no hay «Añadir altura»; vacío enseña y ofrece crear sólo si se puede', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DrawerFamiliesView families={[incomplete]} onOpenHardware={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Ver la familia Cajón Sistema' }));
    expect(screen.queryByTestId('drawer-family-add-height')).toBeNull();
    const onCreate = vi.fn();
    rerender(<DrawerFamiliesView families={[]} onOpenHardware={vi.fn()} onCreateFamily={onCreate} />);
    expect(screen.getByText('Todavía no hay familias de cajón')).toBeInTheDocument();
    await user.click(screen.getByTestId('drawer-families-create'));
    expect(onCreate).toHaveBeenCalled();
  });

  it('familyMissingText: juegos inexistentes y familia sin alturas', () => {
    expect(familyMissingText({ ...complete, missing: { kits: 2, designs: 0, prices: 0 } })).toBe('2 juego(s) inexistente(s) o inactivo(s)');
    expect(familyMissingText({ ...complete, heights: [] })).toBe('sin alturas');
  });
});
