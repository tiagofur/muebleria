// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HardwareVisualAssetBinding } from '@granete/domain';

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="r3f-canvas-mock">{children}</div>
  ),
}));
vi.mock('../../preview3d/HardwareGlbMesh', () => ({
  HardwareGlbMesh: () => <div data-testid="hardware-glb-mesh-mock" />,
}));
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
import { bindingHasCompleteGlb } from './HardwareGlbViewport';
import { Hardware3DSection } from './Hardware3DSection';

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
    sourceUnits: 'm',
    upAxis: 'y',
  },
};

function draftWith(binding: HardwareVisualAssetBinding): HardwareDraft {
  return { ...emptyDraft(), visualAsset: binding };
}

function renderSection(draft: HardwareDraft) {
  return render(
    <Hardware3DSection draft={draft} setDraft={vi.fn()} canMutate={false} />,
  );
}

describe('bindingHasCompleteGlb (#669 review blocker)', () => {
  it('is true only with the full coordinate space declared', () => {
    expect(bindingHasCompleteGlb(glbBinding)).toBe(true);
  });

  it('is false when units or axes are missing', () => {
    expect(
      bindingHasCompleteGlb({
        ...glbBinding,
        glb: { revisionId: 'rev-glb-1', sha256: 'g'.repeat(64), sourceUnits: 'm' },
      }),
    ).toBe(false);
    expect(
      bindingHasCompleteGlb({
        ...glbBinding,
        glb: { revisionId: 'rev-glb-1', sha256: 'g'.repeat(64), upAxis: 'y' },
      }),
    ).toBe(false);
  });

  it('is false for an SKP-only binding', () => {
    const { glb: _dropped, ...skpOnly } = glbBinding;
    expect(bindingHasCompleteGlb(skpOnly)).toBe(false);
  });
});

describe('Hardware3DSection bound-card notice honesty (#669 review blocker)', () => {
  it('claims the exact model only when a complete GLB exists', async () => {
    renderSection(draftWith(glbBinding));
    await waitFor(() =>
      expect(screen.getByTestId('hardware-3d-section-body')).toBeInTheDocument(),
    );
    const notice = screen.getByTestId('hardware-bound-card');
    expect(notice).toHaveTextContent(
      'El visor web de arriba muestra el modelo exacto vinculado (GLB).',
    );
    // The viewport's own load-status marker may honestly mention the generic
    // fallback while the exact model loads; the NOTICE itself must only make
    // the exact claim. Scope the negative to the notice element.
    const noticeLine = within(notice).getByText(/El visor web de arriba muestra/, {
      selector: '.hardware-bound-card__notice span',
    });
    expect(noticeLine).not.toHaveTextContent('representación genérica');
  });

  it('claims the generic representation when no GLB is derived', async () => {
    const { glb: _dropped, ...skpOnly } = glbBinding;
    renderSection(draftWith(skpOnly));
    await waitFor(() =>
      expect(screen.getByTestId('hardware-3d-section-body')).toBeInTheDocument(),
    );
    const notice = screen.getByTestId('hardware-bound-card');
    expect(notice).toHaveTextContent(
      'El visor web de arriba muestra una representación genérica hasta que exista un GLB derivado.',
    );
    expect(notice).not.toHaveTextContent('modelo exacto');
  });
});
