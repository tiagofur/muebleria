/**
 * #875 slice 5: the construction policy DRAFT/ACTIVATE lifecycle, end to end
 * against real Go + disposable PostgreSQL:
 *
 *   1. An INVALID draft persists (the contract's conservable incomplete
 *      draft — stationsCount 1 is below the engine floor) and the ACTIVE
 *      policy keeps governing: nothing moves.
 *   2. Activating an invalid draft is refused with nothing partial.
 *   3. Activating a VALID draft swaps it into the active overrides, clears
 *      the draft, bumps the version — atomic. The resolve effect of an
 *      activated factory policy is already proven by slice 2's gate; the
 *      frozen-history pinning by its R1/R2 test.
 *
 * Uses the GENERATED client methods directly (the draft keys are granular;
 * the typed savePolicyDraft wrapper is the UI's full-policy path, covered by
 * unit tests). API-level on purpose: this is a server lifecycle contract.
 */

import { expect, test } from '@playwright/test';
import { GraneteApiClient, type LibraryOverlayDetail } from '@granete/storage';
import { ensurePublishedStandardRelease, required } from './support/api';

const apiBase = required('ORGANIZATION_API_BASE');

function detail(id: string, version: number): LibraryOverlayDetail {
  return {
    id,
    organizationId: '00000000-0000-0000-0000-000000000000',
    libraryId: '00000000-0000-0000-0000-000000000001',
    baseReleaseId: '00000000-0000-0000-0002-000000000001',
    status: 'active',
    overrides: {},
    customResourceIds: [],
    version,
    createdAt: '2026-10-03T00:00:00Z',
    updatedAt: '2026-10-03T00:00:00Z',
  };
}

test.describe.serial('Policy draft/activate lifecycle (#875 slice 5)', () => {
  let token = '';
  let overlayId = '';
  let version = 0;

  test.beforeAll(async () => {
    await ensurePublishedStandardRelease();
    const client = new GraneteApiClient(apiBase);
    const login = await client.login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    token = login.token;

    const seeded = await fetch(`${apiBase}/seed`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-Request-ID': crypto.randomUUID() },
    });
    expect(seeded.ok, `seed: ${seeded.status}`).toBe(true);

    // Single-spec runs start without an overlay: seed it (the same create
    // the settings save performs).
    let active = await client.getActiveStandardLibraryOverlay(token);
    if (!active) {
      const currentRel = await client.getStandardCurrentRelease(token);
      active = await client.createLibraryOverlay(token, {
        baseReleaseId: currentRel.id,
        overrides: {},
      });
    }
    overlayId = active.id;
    version = active.version;
  });

  test('an INVALID draft persists; the active policy keeps governing', async () => {
    const client = new GraneteApiClient(apiBase);
    // stationsCount 1: below the engine's floor (2) — conservable as a
    // draft, unactivatable by design.
    const updated = await client.saveLibraryOverlayPolicyDraft(token, overlayId, version, {
      overrides: { 'joint.shelfToSide.stationsCount': 1 },
    });
    expect(updated.policyDraft, 'the staged draft rides the overlay detail').toBeTruthy();
    expect(updated.version).toBe(version + 1);
    // The ACTIVE overrides are untouched: the resolve keeps the old policy.
    expect(
      (updated.overrides as Record<string, unknown>)['joint.shelfToSide.stationsCount'],
    ).not.toBe(1);
    version = updated.version;
  });

  test('activating the invalid draft is refused with nothing partial', async () => {
    const client = new GraneteApiClient(apiBase);
    await expect(
      client.activateLibraryOverlayPolicy(token, overlayId, version),
    ).rejects.toThrow();
    const overlay = await client.getLibraryOverlayById(token, overlayId);
    expect(overlay.version).toBe(version);
    expect(overlay.policyDraft).toBeTruthy();
    expect(
      (overlay.overrides as Record<string, unknown>)['joint.shelfToSide.stationsCount'],
    ).not.toBe(1);
  });

  test('a VALID draft activates: overrides swap, draft clears, version bumps', async () => {
    const client = new GraneteApiClient(apiBase);
    const staged = await client.saveLibraryOverlayPolicyDraft(token, overlayId, version, {
      overrides: {
        'joint.shelfToSide.stationsCount': 5,
        'joint.shelfToSide.startMarginMm': 35,
        'joint.shelfToSide.endMarginMm': 35,
      },
    });
    version = staged.version;

    const activated = await client.activateLibraryOverlayPolicy(token, overlayId, version);
    expect(activated.policyDraft ?? null).toBeNull();
    expect(activated.version).toBe(version + 1);
    expect(
      (activated.overrides as Record<string, unknown>)['joint.shelfToSide.stationsCount'],
    ).toBe(5);

    // Re-read through the active-overlay read: the activated policy IS the
    // active policy now.
    const active = await client.getActiveStandardLibraryOverlay(token);
    expect(active!.version).toBe(activated.version);
    expect(
      (active!.overrides as Record<string, unknown>)['joint.shelfToSide.stationsCount'],
    ).toBe(5);
  });

  test('a second activation without a new draft is refused', async () => {
    const client = new GraneteApiClient(apiBase);
    await expect(
      client.activateLibraryOverlayPolicy(token, overlayId, version),
    ).rejects.toThrow();
  });
});
