/**
 * @vitest-environment jsdom
 */

import React from 'react';

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { WarrantyTicketsPanel } from './WarrantyTicketsPanel';
import type { WarrantyTicket } from '@muebles/domain';

afterEach(() => {
  cleanup();
});


const mockTickets: WarrantyTicket[] = [
  {
    id: 'ticket-1',
    ticketNumber: 'GAR-001',
    projectId: 'proj-1',
    title: 'Frente de cajón rayado',
    description: 'Rayón visible en la parte inferior',
    category: 'damaged_part',
    priority: 'urgent',
    status: 'open',
    refabricationPieces: [
      {
        pieceDescription: 'Frente Cajon 800',
        materialName: 'Roble Nebraska',
        lengthMm: 796,
        widthMm: 196,
        quantity: 1,
        grain: 1,
        L1: 1,
        L2: 1,
        W1: 1,
        W2: 1,
      },
    ],
    photos: [],
    createdAt: '2026-08-15T12:00:00Z',
    updatedAt: '2026-08-15T12:00:00Z',
  },
];

describe('WarrantyTicketsPanel component', () => {
  it('renders ticket details, refabrication pieces and action buttons', () => {
    const onExportMock = vi.fn();

    render(
      <WarrantyTicketsPanel
        projectId="proj-1"
        tickets={mockTickets}
        onCreateTicket={vi.fn()}
        onUpdateTicket={vi.fn()}
        onExportRefabricationOptimizer={onExportMock}
      />,
    );

    expect(screen.getByText('Mesa de Garantías & Re-corte')).toBeDefined();
    expect(screen.getByText('Frente de cajón rayado')).toBeDefined();
    expect(screen.getByText('GAR-001')).toBeDefined();
    expect(screen.getByText('1 pieza(s) en orden')).toBeDefined();

    const optimizerBtn = screen.getByText('Descargar para Optimizer (.xlsx)');
    expect(optimizerBtn).toBeDefined();
    fireEvent.click(optimizerBtn);
    expect(onExportMock).toHaveBeenCalledWith(mockTickets[0]);
  });

  it('filters tickets by status', () => {
    render(
      <WarrantyTicketsPanel
        projectId="proj-1"
        tickets={mockTickets}
        onCreateTicket={vi.fn()}
        onUpdateTicket={vi.fn()}
      />,
    );

    const resolvedFilter = screen.getByText('Resueltos (0)');
    fireEvent.click(resolvedFilter);

    expect(
      screen.getByText('No hay tickets de garantía registrados con este filtro.'),
    ).toBeDefined();
  });
});
