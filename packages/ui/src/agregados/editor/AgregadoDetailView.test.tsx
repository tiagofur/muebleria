/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agregado, Component, Hardware } from '@granete/domain';
import { AgregadoDetailView } from './AgregadoDetailView';
import { Agregado3DModal } from './Agregado3DModal';
import type { Module3DCatalogInput } from '../../modules/module3dPreview';

const mockAgregado: Agregado = {
  id: 'agr-1',
  code: 'AGR-01',
  name: 'Cajón Estándar',
  externalDims: { width: 500, height: 200, depth: 450 },
  components: [
    { componentId: 'comp-1', quantity: 2 },
  ],
  hardwareLines: [
    { id: 'hl-1', quantity: 1, optionRole: 'CORREDERA' },
  ],
};

const mockCatalogComponents: Component[] = [
  {
    id: 'comp-1',
    code: 'LAT-CAJ',
    name: 'Lateral de Cajón',
    placement: 'lateral_izquierdo',
    geometry: {
      kind: 'rectangular_board',
      lengthMm: 450,
      widthMm: 200,
      thicknessMm: 18,
    },
    defaultEdges: [],
    optionRoles: ['CAJON'],
    active: true,
  },
];

const mockCatalogHardware: Hardware[] = [
  {
    id: 'hw-1',
    code: 'CORR-450',
    name: 'Corredera Telescópica 450mm',
    unit: 'piece',
    costPerUnit: 15,
    active: true,
  },
];

const mockCatalogInput: Module3DCatalogInput = {
  modules: [],
  structures: [],
  components: mockCatalogComponents,
  materials: [
    {
      id: 'mat-1',
      code: 'MDF18',
      name: 'MDF 18mm',
      widthMm: 1830,
      lengthMm: 2600,
      thicknessMm: 18,
      grainDefault: true,
      boardPrice: 100,
      wastePercent: 10,
      costPerM2: 20,
      active: true,
    },
  ],
  edges: [],
  hardware: mockCatalogHardware,
  optionGroups: [
    {
      id: 'og-cajon',
      code: 'CAJON',
      name: 'Cajón',
      kind: 'board',
      required: true,
      optionIds: ['mat-1'],
    },
  ],
};

describe('AgregadoDetailView', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders chrome, composition summary, and pieces/hardware lists', () => {
    render(
      <AgregadoDetailView
        agregado={mockAgregado}
        catalogComponents={mockCatalogComponents}
        catalogHardware={mockCatalogHardware}
        onBack={vi.fn()}
        onEdit={vi.fn()}
        canMutate={true}
      />,
    );

    expect(screen.getByTestId('agregado-detail-chrome')).toBeTruthy();
    expect(screen.getByText('Cajón Estándar')).toBeTruthy();
    expect(screen.getByTestId('agregado-summary').textContent).toBe(
      '500 × 200 × 450 mm',
    );
    expect(screen.getByTestId('agregado-detail-components')).toBeTruthy();
    expect(screen.getByTestId('agregado-detail-hardware')).toBeTruthy();
  });

  it('counts and displays both bulk hardware and positioned 3D hardware', () => {
    const agregadoWithPlacements: Agregado = {
      ...mockAgregado,
      components: [
        {
          componentId: 'comp-1',
          quantity: 1,
          overrides: {
            hardwarePlacements: [
              {
                hardwareId: 'hw-1',
                anchorFace: 'front',
                relativePosition: { xMm: 30, yMm: 0, yFormula: 'PH-30-HW/2' },
              },
            ],
          },
        },
      ],
      hardwareLines: [
        { id: 'hl-1', quantity: 2, hardwareId: 'hw-1', optionRole: 'HERRAJE' },
      ],
    };

    render(
      <AgregadoDetailView
        agregado={agregadoWithPlacements}
        catalogComponents={mockCatalogComponents}
        catalogHardware={mockCatalogHardware}
        onBack={vi.fn()}
        onEdit={vi.fn()}
        canMutate={true}
      />,
    );

    // Chrome total should show 2 herrajes (1 bulk + 1 positioned)
    expect(screen.getByText('1 piezas · 2 herrajes')).toBeTruthy();

    // Section title
    expect(screen.getByText('Herrajes incluidos (2)')).toBeTruthy();

    // Bulk hardware item rendered
    expect(screen.getByTestId('agregado-detail-bulk-hw-0')).toBeTruthy();
    expect(screen.getByText('Presupuesto / Cantidad')).toBeTruthy();

    // Positioned hardware item rendered with details
    expect(screen.getByTestId('agregado-detail-placement-0-0')).toBeTruthy();
    expect(screen.getByText(/Posicionado 3D en LAT-CAJ/)).toBeTruthy();
    expect(screen.getByText(/Cara: front · X: 30 · Y: PH-30-HW\/2/)).toBeTruthy();
  });

  it('renders Vista 3D button when onView3D is provided and triggers callback on click', () => {
    const handleView3D = vi.fn();
    render(
      <AgregadoDetailView
        agregado={mockAgregado}
        catalogComponents={mockCatalogComponents}
        catalogHardware={mockCatalogHardware}
        onBack={vi.fn()}
        onEdit={vi.fn()}
        onView3D={handleView3D}
        canMutate={true}
      />,
    );

    const btn = screen.getByTestId('agregado-detail-view-3d');
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(handleView3D).toHaveBeenCalledWith(mockAgregado);
  });
});

describe('Agregado3DModal', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders modal body and viewer when open', () => {
    render(
      <Agregado3DModal
        open={true}
        agregado={mockAgregado}
        catalog={mockCatalogInput}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId('agregado-3d-modal')).toBeTruthy();
    expect(screen.getByTestId('agregado-3d-modal-body')).toBeTruthy();
    expect(screen.getByTestId('agregado-3d-finishes')).toBeTruthy();
  });

  it('does not render modal content when closed', () => {
    render(
      <Agregado3DModal
        open={false}
        agregado={mockAgregado}
        catalog={mockCatalogInput}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('agregado-3d-modal-body')).toBeNull();
  });
});
