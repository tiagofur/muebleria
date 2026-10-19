// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HardwareVisualAssetBinding } from '@granete/domain';

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="r3f-canvas-mock">{children}</div>
  ),
}));

vi.mock('../../preview3d/HardwareGlbMesh', async () => {
  const { useEffect } = await import('react');
  return {
    HardwareGlbMesh: ({
      member,
      onStatusChange,
    }: {
      member: { glb?: unknown };
      onStatusChange?: (status: string, diagnostic?: string) => void;
    }) => {
      useEffect(() => {
        const status =
          (globalThis as Record<string, unknown>).__glbMockStatus ?? 'ready';
        onStatusChange?.(status as never);
      }, []);
      return (
        <div
          data-testid="hardware-glb-mesh-mock"
          data-has-glb={member.glb ? 'yes' : 'no'}
        />
      );
    },
  };
});

vi.mock('../../preview3d/HardwareMesh', () => ({
  HardwareMesh: () => <div data-testid="hardware-mesh-fallback-mock" />,
}));

vi.mock('../../preview3d/webglSupport', () => ({
  canUseWebGL: () => true,
}));

vi.mock('../../preview3d/glbAssetSourceContext', () => ({
  useGlbAssetAuthority: () => ({ source: undefined, cache: undefined }),
}));

import { emptyDraft, type HardwareDraft } from './hardwareDraft';
import { HardwareGlbViewport, hardwareDraftToMember, hardwareDraftToProcedural } from './HardwareGlbViewport';

afterEach(cleanup);

const glbBinding: HardwareVisualAssetBinding = {
  assetId: 'asset-1',
  assetRevisionId: 'rev-skp-1',
  representation: 'skp',
  sha256: 's'.repeat(64),
  validationState: 'validated',
  glb: {
    revisionId: 'rev-glb-1',
    sha256: 'g'.repeat(64),
    sourceRevisionId: 'rev-skp-1',
    sourceUnits: 'm',
    upAxis: 'y',
  },
  mountFrame: {
    originMm: [25, 30, 15],
    basis: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
  },
};

const draftWithShape: HardwareDraft = {
  ...emptyDraft(),
  code: 'JAL-128',
  name: 'Jaladera',
  previewShape: 'bar-pull',
  previewColor: '#333333',
  previewSizeMm: '128',
  previewProjectionMm: '32',
};

describe('hardwareDraftToMember (#669)', () => {
  it('adapts binding + mountFrame into one member at identity with GLB', () => {
    const member = hardwareDraftToMember(draftWithShape, glbBinding);

    expect(member.memberId).toBe('hardware-editor-asset-1');
    expect(member.assetId).toBe('asset-1');
    expect(member.assetRevisionId).toBe('rev-skp-1');
    expect(member.localTransform.translationMm).toEqual([0, 0, 0]);
    expect(member.effectiveTransform.translationMm).toEqual([0, 0, 0]);
    expect(member.mountFrame?.originMm).toEqual([25, 30, 15]);
    expect(member.glb?.revisionId).toBe('rev-glb-1');
    expect(member.glb?.sourceUnits).toBe('m');
    expect(member.glb?.upAxis).toBe('y');
    expect(member.renderStatus).toBe('exact');
  });

  it('omits GLB when the coordinate space is incomplete (honest fallback)', () => {
    const member = hardwareDraftToMember(draftWithShape, {
      ...glbBinding,
      glb: { revisionId: 'rev-glb-1', sha256: 'g'.repeat(64) },
    });

    expect(member.glb).toBeUndefined();
  });

  it('omits GLB when the binding has no co-representation', () => {
    const { glb: _dropped, ...skpOnly } = glbBinding;
    const member = hardwareDraftToMember(draftWithShape, skpOnly);

    expect(member.glb).toBeUndefined();
    expect(member.assetId).toBe('asset-1');
  });

  it('falls back to identity when no mountFrame is resolved', () => {
    const { mountFrame: _dropped, ...noFrame } = glbBinding;
    const member = hardwareDraftToMember(draftWithShape, noFrame);

    expect(member.mountFrame).toBeUndefined();
    expect(member.localTransform.translationMm).toEqual([0, 0, 0]);
  });
});

describe('hardwareDraftToProcedural (#669)', () => {
  it('parses draft preview fields like the catalog store', () => {
    const hardware = hardwareDraftToProcedural(draftWithShape);

    expect(hardware.previewShape).toBe('bar-pull');
    expect(hardware.previewColor).toBe('#333333');
    expect(hardware.previewSizeMm).toBe(128);
    expect(hardware.previewProjectionMm).toBe(32);
  });

  it('drops invalid shape and non-finite numbers', () => {
    const hardware = hardwareDraftToProcedural({
      ...draftWithShape,
      previewShape: 'no-existe',
      previewSizeMm: 'abc',
    });

    expect(hardware.previewShape).toBeUndefined();
    expect(hardware.previewSizeMm).toBeUndefined();
  });
});

describe('HardwareGlbViewport (#669)', () => {
  it('renders the exact GLB branch and the marker reports ready', async () => {
    (globalThis as Record<string, unknown>).__glbMockStatus = 'ready';
    render(<HardwareGlbViewport draft={draftWithShape} binding={glbBinding} />);

    expect(screen.getByTestId('hardware-glb-viewport')).toBeInTheDocument();
    expect(screen.getByTestId('hardware-glb-mesh-mock')).toHaveAttribute(
      'data-has-glb',
      'yes',
    );
    await waitFor(() =>
      expect(screen.getByTestId('hardware-glb-viewport-marker')).toHaveTextContent(
        'Modelo exacto del archivo vinculado (GLB).',
      ),
    );
  });

  it('marker stays honest while the exact model loads or fails (review note)', async () => {
    (globalThis as Record<string, unknown>).__glbMockStatus = 'loading';
    render(<HardwareGlbViewport draft={draftWithShape} binding={glbBinding} />);
    await waitFor(() =>
      expect(screen.getByTestId('hardware-glb-viewport-marker')).toHaveTextContent(
        'Cargando el modelo exacto…',
      ),
    );

    cleanup();
    (globalThis as Record<string, unknown>).__glbMockStatus = 'corrupt';
    render(<HardwareGlbViewport draft={draftWithShape} binding={glbBinding} />);
    await waitFor(() =>
      expect(screen.getByTestId('hardware-glb-viewport-marker')).toHaveTextContent(
        'No se pudo cargar el modelo exacto (corrupt); se muestra la representación genérica.',
      ),
    );
    delete (globalThis as Record<string, unknown>).__glbMockStatus;
  });

  it('renders the procedural path with an explicit marker when no GLB exists', () => {
    const { glb: _dropped, ...skpOnly } = glbBinding;
    render(<HardwareGlbViewport draft={draftWithShape} binding={skpOnly} />);

    expect(screen.getByTestId('hardware-glb-viewport')).toBeInTheDocument();
    expect(
      screen.queryByTestId('hardware-glb-mesh-mock'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('hardware-glb-viewport-marker')).toHaveTextContent(
      'Representación genérica: este vínculo aún no tiene GLB derivado.',
    );
  });
});
