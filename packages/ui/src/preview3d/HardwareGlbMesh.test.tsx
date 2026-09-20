// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { render, waitFor } from '@testing-library/react';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import type { ProjectedRigidMember } from '@granete/domain';
import { GlbSceneCache } from './glbSceneCache';
import { HardwareGlbMesh, type HardwareGlbLoadStatus } from './HardwareGlbMesh';

// #669 review R7: the mounted GLB keeps a stable lifecycle across unrelated
// re-renders — the load effect must NOT re-run (a re-created mounted object
// is exactly how R3F primitives lose their imperatively added children; the
// real-browser children/world-point proof is Point 12, which failed while
// that bug existed). jsdom cannot run WebGL, so this unit guard pins the
// observable lifecycle contracts: one load per revision, no state reset, no
// churn while foreign re-renders happen.

const member: ProjectedRigidMember = {
  memberId: 'member-glb',
  role: 'side',
  hardwareId: 'hw-glb',
  bomRole: 'included_in_kit',
  assetId: 'ast-glb',
  assetRevisionId: 'rev-skp-1',
  glb: {
    revisionId: 'rev-glb-1',
    sha256: 'sha256-' + 'a'.repeat(64),
    sourceUnits: 'm',
    upAxis: 'y',
  },
  localTransform: {
    translationMm: [0, 0, 0],
    basis: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
  },
  effectiveTransform: {
    translationMm: [0, 0, 0],
    basis: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
  },
  renderStatus: 'exact',
};

function makeReadyCache(): { cache: GlbSceneCache; template: THREE.Group; load: ReturnType<typeof vi.fn> } {
  const template = new THREE.Group();
  template.name = 'granete-glb-asset-mm';
  template.add(new THREE.Mesh(new THREE.BoxGeometry(70, 54, 18), new THREE.MeshStandardMaterial()));
  const load = vi.fn(async () => template);
  const cache = { ownerKey: 'test-owner', load } as unknown as GlbSceneCache;
  return { cache, template, load };
}

describe('HardwareGlbMesh stable lifecycle across unrelated re-renders', () => {
  it('loads once per revision and keeps ready state through foreign re-renders', async () => {
    const { cache, load } = makeReadyCache();
    const statuses: HardwareGlbLoadStatus[] = [];
    const onStatusChange = (status: HardwareGlbLoadStatus) => {
      statuses.push(status);
    };

    function Host() {
      const [foreign, setForeign] = useState(0);
      useEffect(() => {
        if (foreign < 3) {
          const timer = setTimeout(() => setForeign(foreign + 1), 5);
          return () => clearTimeout(timer);
        }
        return undefined;
      }, [foreign]);
      return (
        <div data-foreign={foreign}>
          <HardwareGlbMesh
            member={member}
            glbCache={cache}
            fallback={<group name="fallback" />}
            onStatusChange={onStatusChange}
          />
        </div>
      );
    }

    render(<Host />);

    // Reaches ready and STAYS ready through the foreign re-render storm.
    await waitFor(
      () => {
        expect(statuses[statuses.length - 1]).toBe('ready');
      },
      { timeout: 2000 },
    );
    await waitFor(() => {
      expect(document.querySelector('[data-foreign]')?.getAttribute('data-foreign')).toBe('3');
    });

    // Exactly one load: the effect never re-ran for unrelated renders, so the
    // mounted object identity (and its children) cannot have been churned.
    expect(load).toHaveBeenCalledTimes(1);
    // No loading/corrupt relapse after ready.
    const readyIndex = statuses.indexOf('ready');
    expect(readyIndex).toBeGreaterThanOrEqual(0);
    expect(statuses.slice(readyIndex)).toEqual(['ready']);
  });

  it('falls back honestly and classifies failures when the cache rejects', async () => {
    const load = vi.fn(async () => {
      throw new Error('grant expired');
    });
    const cache = { ownerKey: 'test-owner', load } as unknown as GlbSceneCache;
    const statuses: HardwareGlbLoadStatus[] = [];

    render(
      <HardwareGlbMesh
        member={member}
        glbCache={cache}
        fallback={<group name="fallback" />}
        onStatusChange={(status) => statuses.push(status)}
      />,
    );

    await waitFor(
      () => {
        expect(statuses[statuses.length - 1]).toBe('inaccessible');
      },
      { timeout: 2000 },
    );
  });
});
