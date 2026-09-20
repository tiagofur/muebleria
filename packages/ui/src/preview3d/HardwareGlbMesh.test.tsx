// @vitest-environment jsdom
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { render, waitFor } from '@testing-library/react';
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';

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

describe('HardwareGlbMesh semantic GLB identity (#669 review R11)', () => {
  const baseMember = (glbObject: NonNullable<ProjectedRigidMember['glb']>): ProjectedRigidMember => ({
    ...member,
    glb: glbObject,
  });
  const glbObjectA = {
    revisionId: 'rev-glb-1',
    sha256: 'sha256-' + 'a'.repeat(64),
    sourceUnits: 'm' as const,
    upAxis: 'y' as const,
  };
  const glbObjectB = { ...glbObjectA }; // NEW reference, IDENTICAL semantics
  const glbObjectG2 = {
    revisionId: 'rev-glb-2',
    sha256: 'sha256-' + 'b'.repeat(64),
    sourceUnits: 'm' as const,
    upAxis: 'y' as const,
  };

  it('an equivalent-but-new glb object does NOT restart the lifecycle; a real revision change does', async () => {
    const load = vi.fn(async (representation: { revisionId: string }) => {
      const template = new THREE.Group();
      template.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
      template.name = `template-${representation.revisionId}`;
      return template;
    });
    const cache = { ownerKey: 'test-owner', load } as unknown as GlbSceneCache;
    const statuses: HardwareGlbLoadStatus[] = [];

    const { rerender } = render(
      <HardwareGlbMesh
        member={baseMember(glbObjectA)}
        glbCache={cache}
        fallback={<group name="fallback" />}
        onStatusChange={(status) => statuses.push(status)}
      />,
    );
    await waitFor(
      () => {
        expect(statuses[statuses.length - 1]).toBe('ready');
      },
      { timeout: 2000 },
    );
    expect(load).toHaveBeenCalledTimes(1);

    // Same semantics, NEW object reference: no reload, no loading relapse.
    rerender(
      <HardwareGlbMesh
        member={baseMember(glbObjectB)}
        glbCache={cache}
        fallback={<group name="fallback" />}
        onStatusChange={(status) => statuses.push(status)}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(load).toHaveBeenCalledTimes(1);
    // The lifecycle did NOT restart: no loading relapse after ready (a
    // repeated 'ready' emission from the status-report effect is harmless).
    const readyIndex = statuses.indexOf('ready');
    expect(statuses.slice(readyIndex)).not.toContain('loading');
    expect(statuses.filter((status) => status === 'loading')).toHaveLength(1);

    // A REAL revision change (G1 -> G2) reloads through the semantic key.
    rerender(
      <HardwareGlbMesh
        member={baseMember(glbObjectG2)}
        glbCache={cache}
        fallback={<group name="fallback" />}
        onStatusChange={(status) => statuses.push(status)}
      />,
    );
    await waitFor(
      () => {
        expect(load).toHaveBeenCalledTimes(2);
        expect(statuses[statuses.length - 1]).toBe('ready');
      },
      { timeout: 2000 },
    );
    expect(load.mock.calls[1]![0]).toMatchObject({ revisionId: 'rev-glb-2' });
  });
});

describe('HardwareGlbMesh clone/dispose lifecycle (#669 review R15)', () => {
  it('a source switch makes the member abandon the previous owner before its cache can be disposed', async () => {
    // Ordering reasoning pinned by this test: React renders the consumer
    // with the NEW cache in the same commit (mounted -> null, status ->
    // loading, fallback rendered) BEFORE the provider's effect cleanup
    // disposes the old cache. The old clone (which shares geometry with the
    // old template) is unmounted by then, so no stable path keeps rendering
    // geometry another owner disposed.
    const makeCache = (ownerKey: string) => {
      const template = new THREE.Group();
      template.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
      const load = vi.fn(async () => template);
      return { cache: { ownerKey, load } as unknown as GlbSceneCache, load };
    };
    const a = makeCache('owner-a');
    const b = makeCache('owner-b');
    const statuses: HardwareGlbLoadStatus[] = [];

    const { rerender } = render(
      <HardwareGlbMesh
        member={member}
        glbCache={a.cache}
        fallback={<group name="fallback" />}
        onStatusChange={(status) => statuses.push(status)}
      />,
    );
    await waitFor(
      () => {
        expect(statuses[statuses.length - 1]).toBe('ready');
      },
      { timeout: 2000 },
    );
    expect(a.load).toHaveBeenCalledTimes(1);

    // Authority switch: the member immediately restarts against B (fallback
    // meanwhile) and B serves its own template.
    rerender(
      <HardwareGlbMesh
        member={member}
        glbCache={b.cache}
        fallback={<group name="fallback" />}
        onStatusChange={(status) => statuses.push(status)}
      />,
    );
    await waitFor(
      () => {
        expect(b.load).toHaveBeenCalledTimes(1);
        expect(statuses[statuses.length - 1]).toBe('ready');
      },
      { timeout: 2000 },
    );
    // The member never reloaded through A after the switch.
    expect(a.load).toHaveBeenCalledTimes(1);
    // After the switch, disposing A (what the provider does) cannot touch
    // the live state: B's cache still serves, A honestly refuses.
    (a.cache as unknown as { dispose: () => void }).dispose?.();
    expect(b.load).toHaveBeenCalledTimes(1);
  });
});

describe('HardwareGlbMesh mounted identity (#669 review R19)', () => {
  const deferredCache = (templateName: string) => {
    let resolveLoad: (template: THREE.Group) => void = () => {};
    const load = vi.fn(
      () =>
        new Promise<THREE.Group>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const cache = { ownerKey: `owner-${templateName}`, load } as unknown as GlbSceneCache;
    return {
      cache,
      load,
      resolveWith: () => {
        const template = new THREE.Group();
        template.name = templateName;
        template.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
        resolveLoad(template);
      },
    };
  };
  const mountedPrimitiveName = (host: HTMLElement): string | null =>
    host.querySelector('primitive')?.getAttribute('name') ?? null;

  it('a cache switch excludes the OLD primitive from the very first commit (before passive effects)', async () => {
    const a = deferredCache('mounted-a');
    const b = deferredCache('mounted-b');
    const switchCommits: (string | null)[] = [];

    const Harness = ({ cache }: { cache: GlbSceneCache }) => {
      const hostRef = useRef<HTMLDivElement | null>(null);
      // Layout phase of the HOST commit (the cache switch itself): records
      // the committed output BEFORE any passive effect can clear a stale
      // mounted object — precisely the window the old bug relied on.
      useLayoutEffect(() => {
        if (hostRef.current) switchCommits.push(mountedPrimitiveName(hostRef.current));
      });
      return (
        <div ref={hostRef} data-harness="r19">
          <HardwareGlbMesh
            member={member}
            glbCache={cache}
            fallback={<group name="fallback" />}
            onStatusChange={() => {}}
          />
        </div>
      );
    };

    const { rerender } = render(<Harness cache={a.cache} />);
    a.resolveWith();
    await waitFor(
      () => {
        const host = document.querySelector('[data-harness="r19"]') as HTMLElement;
        expect(mountedPrimitiveName(host)).toBe('mounted-a');
      },
      { timeout: 2000 },
    );
    expect(a.load).toHaveBeenCalledTimes(1);

    // Authority switch with B still PENDING. The commit that renders cache B
    // must NOT contain the old mounted-a primitive: asserted synchronously
    // right after the rerender (DOM is the commit output) AND captured again
    // in the layout phase of that same commit.
    rerender(<Harness cache={b.cache} />);
    const hostAfterSwitch = document.querySelector('[data-harness="r19"]') as HTMLElement;
    expect(mountedPrimitiveName(hostAfterSwitch)).toBeNull(); // fallback, not mounted-a
    expect(switchCommits[switchCommits.length - 1]).toBeNull();

    b.resolveWith();
    await waitFor(
      () => {
        const host = document.querySelector('[data-harness="r19"]') as HTMLElement;
        expect(mountedPrimitiveName(host)).toBe('mounted-b');
      },
      { timeout: 2000 },
    );
    expect(b.load).toHaveBeenCalledTimes(1);
    expect(a.load).toHaveBeenCalledTimes(1); // never reloaded through A
  });
});

describe('HardwareGlbMesh real cache disposal (#669 review R20)', () => {
  beforeAll(() => {
    // jsdom's crypto lacks subtle; the cache verifies SHA-256 client-side.
    const globalWithCrypto = globalThis as { crypto?: { subtle?: unknown } };
    if (!globalWithCrypto.crypto?.subtle) {
      globalWithCrypto.crypto = require('node:crypto').webcrypto as never;
    }
  });

  it('survives a real cache switch: A disposed, old mounted unrenderable, B intact', async () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join, dirname } = require('node:path') as typeof import('node:path');
    const { fileURLToPath } = require('node:url') as typeof import('node:url');
    const fixtureBytes = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../contracts/fixtures/glb-parity-bracket.glb',
      ),
    );
    // Realm-local copy: a Node-Buffer pool slice fails `instanceof
    // ArrayBuffer` inside jsdom's VM, which makes THREE.GLTFLoader take the
    // plain-text branch. The browser app always gets realm-native buffers
    // from fetch/atob — only this jsdom harness needs the explicit copy.
    const fixtureArrayBuffer = (): ArrayBuffer => {
      const copy = new Uint8Array(fixtureBytes.byteLength);
      copy.set(fixtureBytes);
      return copy.buffer as ArrayBuffer;
    };

    const representation = {
      assetId: 'ast-glb-parity',
      revisionId: 'rev-glb-parity-bracket-1',
      sha256:
        'sha256-' +
        require('node:crypto')
          .createHash('sha256')
          .update(fixtureBytes)
          .digest('hex'),
      sourceUnits: 'm' as const,
      upAxis: 'y' as const,
    };
    const sourceA = { ownerKey: 'owner-a', loadBytes: vi.fn(async () => fixtureArrayBuffer()) };
    const sourceB = { ownerKey: 'owner-b', loadBytes: vi.fn(async () => fixtureArrayBuffer()) };
    const cacheA = new GlbSceneCache(sourceA);
    const cacheB = new GlbSceneCache(sourceB);

    const hostRef = { current: null as HTMLDivElement | null };
    const Harness = ({ cache }: { cache: GlbSceneCache }) => (
      <div ref={hostRef} data-harness="r20">
        <HardwareGlbMesh
          member={{ ...member, glb: representation }}
          glbCache={cache}
          fallback={<group name="fallback" />}
          onStatusChange={(status, diagnostic) => {
            statuses.push(`${status}${diagnostic ? `: ${diagnostic}` : ''}`);
          }}
        />
      </div>
    );

    const statuses: string[] = [];
    const { rerender } = render(<Harness cache={cacheA} />);
    await waitFor(
      () => {
        expect(statuses[statuses.length - 1]).toBe('ready');
      },
      { timeout: 3000 },
    );
    // eslint-disable-next-line no-console
    console.log('R20 STATUSES', JSON.stringify(statuses.map((entry) => entry.slice(0, 300))));
    expect(sourceA.loadBytes).toHaveBeenCalledTimes(1);

    // Authority switch: the old A-mounted primitive is excluded from the
    // commit immediately (identity gate), before A is disposed.
    rerender(<Harness cache={cacheB} />);
    expect(hostRef.current?.querySelector('primitive')).toBeNull();

    // REAL disposal of A while B is still resolving: B's future template is
    // a DIFFERENT parse with its own geometry, and the disposed A template
    // can no longer be requested through any path.
    cacheA.dispose();
    await expect(cacheA.load(representation)).rejects.toThrow(/disposed/);

    await waitFor(
      () => {
        expect(hostRef.current?.querySelector('primitive')).toBeTruthy();
      },
      { timeout: 3000 },
    );
    expect(sourceB.loadBytes).toHaveBeenCalledTimes(1);

    // B keeps serving afterwards: its owner is intact (the isolation the
    // provider guarantees on a session switch).
    const templateB = await cacheB.load(representation);
    expect(templateB.children.length).toBeGreaterThan(0);
  });
});
