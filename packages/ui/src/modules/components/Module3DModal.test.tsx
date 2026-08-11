/**
 * Module 3D modal — catalog photo capture chrome.
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  Agregado,
  Component,
  EdgeBand,
  Hardware,
  MaterialBoard,
  Module,
  OptionGroup,
  Structure,
} from '@muebles/domain';
import { Module3DModal } from './Module3DModal';

vi.mock('../../common/Furniture3DViewer', () => ({
  Furniture3DViewer: (props: {
    readonly testId?: string;
    readonly catalogPhotoViewToken?: number;
    readonly lightingMode?: string;
    readonly initialSurfaceMode?: string;
    readonly initialShowOutlines?: boolean;
    readonly parts?: readonly { readonly id: string }[];
    readonly resolvedHardwarePlacements?: readonly {
      readonly componentInstanceId?: string;
    }[];
  }) => (
    <div
      data-testid={props.testId ?? 'furniture-3d-viewer'}
      data-catalog-photo-token={String(props.catalogPhotoViewToken ?? 0)}
      data-lighting={props.lightingMode ?? ''}
      data-surface={props.initialSurfaceMode ?? ''}
      data-outlines={String(props.initialShowOutlines ?? true)}
      data-parts-count={String(props.parts?.length ?? 0)}
      data-hardware-count={String(props.resolvedHardwarePlacements?.length ?? 0)}
      data-first-hardware-instance={
        props.resolvedHardwarePlacements?.[0]?.componentInstanceId ?? ''
      }
    >
      <canvas data-testid="mock-3d-canvas" width={8} height={8} />
    </div>
  ),
}));

const edge: EdgeBand = {
  id: 'edge-a',
  code: 'EDGE-A',
  name: 'Canto blanco',
  thicknessMm: 1,
  costPerMl: 0.5,
  active: true,
};

const material: MaterialBoard = {
  id: 'mat-a',
  code: 'MAT-A',
  name: 'Blanco',
  widthMm: 1830,
  lengthMm: 2750,
  thicknessMm: 18,
  boardPrice: 100,
  wastePercent: 10,
  costPerM2: 50,
  grainDefault: false,
  active: true,
  defaultEdgeBandId: 'edge-a',
  previewColor: '#F5F5F0',
};

const optionGroups: OptionGroup[] = [
  {
    id: 'og-int',
    code: 'INTERIOR',
    name: 'Interior',
    kind: 'board',
    required: true,
    optionIds: ['mat-a'],
  },
];

const comp: Component = {
  id: 'c1',
  code: 'COM-1',
  name: 'Costado',
  placement: 'lateral_izquierdo',
  geometry: {
    kind: 'rectangular_board',
    lengthMm: 720,
    widthMm: 560,
    thicknessMm: 18,
    lengthFormula: 'PH',
    widthFormula: 'PD',
  },
  defaultEdges: [
    { side: 'L1', enabled: true },
    { side: 'L2', enabled: true },
    { side: 'W1', enabled: true },
    { side: 'W2', enabled: true },
  ],
  optionRoles: ['INTERIOR'],
  active: true,
  xFormula: 'i * (PW - T)',
  yFormula: '0',
  zFormula: '0',
  rotateY: 90,
};

const structure: Structure = {
  id: 'st1',
  code: 'EST-1',
  name: 'Cuerpo',
  externalDims: { width: 600, height: 720, depth: 560 },
  components: [{ componentId: 'c1', quantity: 2 }],
  active: true,
};

const baseModule: Module = {
  id: 'm1',
  code: 'BASE-600',
  name: 'Bajo mesada',
  structureId: 'st1',
  components: [],
  hardwareLines: [],
  externalDims: { width: 600, height: 720, depth: 560 },
  presets: [
    { id: 'p600', name: '600', width: 600, height: 720, depth: 560 },
  ],
};

const catalog = {
  modules: [baseModule],
  structures: [structure],
  components: [comp],
  materials: [material],
  edges: [edge],
  hardware: [] as readonly Hardware[],
  optionGroups,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Module3DModal catalog photo', () => {
  it('shows save-as-photo when upload+apply provided', () => {
    render(
      <Module3DModal
        open
        module={baseModule}
        catalog={catalog}
        onClose={() => {}}
        onUploadImage={async () => '/api/media/x.png'}
        onApplyCatalogImage={() => {}}
      />,
    );
    expect(screen.getByTestId('module-3d-catalog-photo').textContent).toMatch(
      /Usar como foto del mueble/,
    );
  });

  it('shows download label when upload not available', () => {
    render(
      <Module3DModal
        open
        module={baseModule}
        catalog={catalog}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId('module-3d-catalog-photo').textContent).toMatch(
      /Descargar imagen 3D/,
    );
  });

  it('opens with catalog lighting + texture + outlines off for product still', () => {
    render(
      <Module3DModal
        open
        module={baseModule}
        catalog={catalog}
        onClose={() => {}}
      />,
    );
    const viewer = screen.getByTestId('module-3d-viewer');
    expect(viewer.getAttribute('data-lighting')).toBe('catalog');
    expect(viewer.getAttribute('data-surface')).toBe('texture');
    expect(viewer.getAttribute('data-outlines')).toBe('false');
    expect(
      Number(viewer.getAttribute('data-catalog-photo-token')),
    ).toBeGreaterThan(0);
  });

  it('uploads PNG and applies imageUrl on capture', async () => {
    const user = userEvent.setup();
    const onUploadImage = vi.fn(async (file: File) => {
      expect(file.name).toMatch(/BASE-600/);
      expect(file.type).toBe('image/png');
      return '/api/media/gen.png';
    });
    const onApplyCatalogImage = vi.fn();

    HTMLCanvasElement.prototype.toBlob = function (
      cb: BlobCallback,
      _type?: string,
    ) {
      cb(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));
    };

    render(
      <Module3DModal
        open
        module={baseModule}
        catalog={catalog}
        onClose={() => {}}
        onUploadImage={onUploadImage}
        onApplyCatalogImage={onApplyCatalogImage}
      />,
    );

    await user.click(screen.getByTestId('module-3d-catalog-photo'));

    await waitFor(() => {
      expect(onUploadImage).toHaveBeenCalledTimes(1);
      expect(onApplyCatalogImage).toHaveBeenCalledWith(
        'm1',
        '/api/media/gen.png',
      );
    });

    expect(screen.getByTestId('module-3d-catalog-photo-ok').textContent).toMatch(
      /actualizada/i,
    );
  });

  it('#4181: resolves agregado hardware placements in the editor 3D view', () => {
    // The module editor used to call resolveModuleHardwarePlacements with NO
    // options, so agregado component instances were never iterated and their
    // hardware placements resolved to [] (#4181). With { structures, agregados }
    // passed, the agregado door's knob resolves against its own prefixed board.
    const doorComponent: Component = {
      id: 'c-agr-puerta',
      code: 'COM-AGR-PUERTA',
      name: 'Puerta (agregado)',
      placement: 'frontal',
      geometry: {
        kind: 'rectangular_board',
        lengthMm: 720,
        widthMm: 596,
        thicknessMm: 18,
      },
      defaultEdges: [
        { side: 'L1', enabled: true },
        { side: 'L2', enabled: true },
        { side: 'W1', enabled: true },
        { side: 'W2', enabled: true },
      ],
      optionRoles: ['INTERIOR'],
      active: true,
    };
    const doorAgregado: Agregado = {
      id: 'agr-door',
      code: 'AGR-DOOR',
      name: 'Puerta con jaladera',
      components: [
        {
          componentId: 'c-agr-puerta',
          quantity: 1,
          overrides: {
            hardwarePlacements: [
              {
                hardwareId: 'hw-knob',
                anchorFace: 'front',
                relativePosition: { xPercent: 50, yPercent: 50 },
              },
            ],
          },
        },
      ],
    };
    const knobHardware: Hardware = {
      id: 'hw-knob',
      code: 'HW-KNOB',
      name: 'Jaladera knob',
      unit: 'piece',
      costPerUnit: 0,
      active: true,
      previewShape: 'knob',
      previewDiameterMm: 32,
      previewProjectionMm: 25,
      previewColor: '#888888',
      previewMetalness: 0.9,
      previewRoughness: 0.25,
    };
    const moduleWithAgregado: Module = {
      ...baseModule,
      id: 'm-agr',
      components: [],
      agregados: [{ agregadoId: 'agr-door', quantity: 1 }],
    };
    const catalogWithAgregado = {
      ...catalog,
      modules: [moduleWithAgregado],
      components: [comp, doorComponent],
      hardware: [knobHardware],
      agregados: [doorAgregado],
    };

    render(
      <Module3DModal
        open
        module={moduleWithAgregado}
        catalog={catalogWithAgregado}
        onClose={() => {}}
      />,
    );
    const viewer = screen.getByTestId('module-3d-viewer');
    // Agregado board parts render in the editor.
    expect(Number(viewer.getAttribute('data-parts-count'))).toBeGreaterThan(0);
    // The agregado placement resolves and links to its own prefixed board.
    expect(viewer.getAttribute('data-hardware-count')).toBe('1');
    expect(viewer.getAttribute('data-first-hardware-instance')).toBe(
      'agr-0-c-agr-puerta-copy-0',
    );
  });
});
