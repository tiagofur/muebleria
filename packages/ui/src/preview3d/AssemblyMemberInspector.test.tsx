/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Hardware, ProjectedAssembly, ProjectedRigidMember } from '@granete/domain';
import { AssemblyMemberInspector } from './AssemblyMemberInspector';

afterEach(() => {
  cleanup();
});

const IDENTITY = {
  translationMm: [0, 0, 0] as const,
  basis: { x: [1, 0, 0] as const, y: [0, 1, 0] as const, z: [0, 0, 1] as const },
};

const HARDWARE: readonly Hardware[] = [
  {
    id: 'hw-runner-500',
    code: 'MRV-500',
    name: 'Corredera MERIVOBOX NL 500',
    unit: 'piece',
    costPerUnit: 0,
    active: true,
  },
];

function member(
  memberId: string,
  overrides: Partial<ProjectedRigidMember> = {},
): ProjectedRigidMember {
  return {
    memberId,
    role: 'side_right',
    hardwareId: 'hw-runner-500',
    bomRole: 'included_in_kit',
    localTransform: IDENTITY,
    effectiveTransform: IDENTITY,
    renderStatus: 'exact',
    assetRevisionId: 'rev-abc',
    ...overrides,
  };
}

function drawer(
  instanceId: string,
  overrides: Partial<ProjectedAssembly> = {},
): ProjectedAssembly {
  return {
    assemblyInstanceId: instanceId,
    agregadoId: 'agr-merivobox-m',
    recipeRevision: 3,
    isHistorical: false,
    placement: { originMm: [0, 0, 0] },
    rigidMembers: [member('side-right')],
    fabricatedComponents: [
      {
        componentId: 'comp-bottom',
        quantity: 1,
        widthMm: 512,
        lengthMm: 484,
        thicknessMm: 16,
        materialId: 'mat-mdf-16',
        transform: IDENTITY,
      },
    ],
    ...overrides,
  };
}

const text = (testId: string): string => screen.getByTestId(testId).textContent ?? '';
const attr = (testId: string, name: string): string | null =>
  screen.getByTestId(testId).getAttribute(name);

describe('AssemblyMemberInspector', () => {
  it('renders nothing when there is no selection', () => {
    const { container } = render(
      <AssemblyMemberInspector assemblies={[drawer('fi-a')]} selection={null} />,
    );
    expect(container.childElementCount).toBe(0);
  });

  it('shows identity (agregado · instancia · miembro), hardware name and exact render status', () => {
    render(
      <AssemblyMemberInspector
        assemblies={[drawer('fi-a'), drawer('fi-b')]}
        selection={{ kind: 'rigid', assemblyInstanceId: 'fi-b', memberId: 'side-right' }}
        hardwareCatalog={HARDWARE}
        testId="ins"
      />,
    );
    expect(attr('ins', 'data-kind')).toBe('rigid');
    expect(text('ins-title')).toBe('Corredera MERIVOBOX NL 500');
    expect(text('ins-code')).toBe('side-right');
    expect(text('ins-agregado')).toBe('agr-merivobox-m');
    expect(text('ins-instance')).toBe('fi-b');
    expect(text('ins-recipe')).toBe('Receta en vivo · rev. 3');
    expect(text('ins-hardware')).toBe('MRV-500 · Corredera MERIVOBOX NL 500');
    expect(text('ins-bom-role')).toBe('Incluido en el juego');
    expect(text('ins-render-status')).toBe('Estado 3D: Exacta (recurso 3D fijado)');
    expect(attr('ins-render-status', 'data-tone')).toBe('ok');
    expect(attr('ins-render-status', 'role')).toBe('status');
    expect(text('ins-asset-revision')).toBe('rev-abc');
    expect(text('ins-glb-revision')).toBe('Representación procedural');
    expect(screen.queryByTestId('ins-diagnostic')).toBeNull();
  });

  it('surfaces a missing historical asset as an alert with its diagnostic, never a silent fallback', () => {
    const historical = drawer('fi-a', {
      isHistorical: true,
      snapshotId: 'snap-9',
      recipeRevision: undefined,
      rigidMembers: [
        member('side-right', {
          renderStatus: 'historical_asset_missing',
          statusDiagnostic: 'assetRevisionId rev-abc no está disponible en este entorno',
          assetRevisionId: 'rev-abc',
        }),
      ],
    });
    render(
      <AssemblyMemberInspector
        assemblies={[historical]}
        selection={{ kind: 'rigid', assemblyInstanceId: 'fi-a', memberId: 'side-right' }}
        testId="ins"
      />,
    );
    expect(attr('ins-render-status', 'role')).toBe('alert');
    expect(attr('ins-render-status', 'data-tone')).toBe('danger');
    expect(text('ins-render-status')).toContain('Recurso histórico no disponible');
    expect(text('ins-diagnostic')).toContain('rev-abc no está disponible');
    expect(text('ins-recipe')).toBe('Snapshot publicado snap-9');
    // Without a catalog the hardware id is shown verbatim (no invented name).
    expect(text('ins-title')).toBe('side_right');
    expect(text('ins-hardware')).toBe('hw-runner-500');
  });

  it('renders a fabricated component with its authoritative dimensions and material', () => {
    render(
      <AssemblyMemberInspector
        assemblies={[drawer('fi-a')]}
        selection={{ kind: 'fabricated', assemblyInstanceId: 'fi-a', componentId: 'comp-bottom' }}
        testId="ins"
      />,
    );
    expect(attr('ins', 'data-kind')).toBe('fabricated');
    expect(text('ins-title')).toBe('Tablero fabricado del conjunto');
    expect(text('ins-code')).toBe('comp-bottom');
    expect(text('ins-quantity')).toBe('1');
    expect(text('ins-width')).toBe('512 mm');
    expect(text('ins-length')).toBe('484 mm');
    expect(text('ins-thickness')).toBe('16 mm');
    expect(text('ins-material')).toBe('mat-mdf-16');
  });

  it('shows an explicit stale state when the selected instance no longer exists', () => {
    render(
      <AssemblyMemberInspector
        assemblies={[drawer('fi-a')]}
        selection={{ kind: 'rigid', assemblyInstanceId: 'fi-gone', memberId: 'side-right' }}
        onClear={() => {}}
        testId="ins"
      />,
    );
    expect(attr('ins', 'role')).toBe('status');
    expect(text('ins-stale')).toContain('ya no existe en esta vista');
    expect(screen.getByTestId('ins-clear')).toBeTruthy();
  });

  it('calls onClear from the header button', async () => {
    const onClear = vi.fn();
    render(
      <AssemblyMemberInspector
        assemblies={[drawer('fi-a')]}
        selection={{ kind: 'rigid', assemblyInstanceId: 'fi-a', memberId: 'side-right' }}
        onClear={onClear}
        testId="ins"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Quitar selección' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
