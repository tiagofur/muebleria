/**
 * #955 demo proof: the FULL hardware-profile chain walking on real
 * infrastructure — disposable PostgreSQL + real Go + a real browser login.
 *
 * seed (/api/seed: demo profile with embedded recipe + REAL publication of
 * the Standard release through the compiler)
 *   → component side assignment (per-face, tenant API)
 *   → authoring resolve with an authored fixed-shelf-side relationship
 *     declaring NO recipes
 *   → server-resolved recipes from the pinned profile
 *   → MACHINING_READY + productive operations with profile provenance
 *   → hardwareProfileDemand (minifix ×2, tarugo ×2 = per contact × 2).
 */

import { expect, test, type Page } from '@playwright/test';
import { required } from './support/api';

const apiBase = required('ORGANIZATION_API_BASE');
const DEMO_PROFILE_ID = 'a0000010-0000-0000-0000-000000000001';

const MODULE_ID = 'b3333333-2222-4333-8444-555555555501';
const STRUCTURE_ID = 'b3333333-2222-4333-8444-555555555502';
const SIDE_ID = 'b3333333-2222-4333-8444-555555555511';
const SIDE_R_ID = 'b3333333-2222-4333-8444-555555555512';
const SHELF_ID = 'b3333333-2222-4333-8444-555555555513';
const ST_SIDE_ID = `st-${SIDE_ID}`;
const ST_SIDE_R_ID = `st-${SIDE_R_ID}`;
const ST_SHELF_ID = `st-${SHELF_ID}`;

async function authedFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Request-ID': crypto.randomUUID(),
      ...(init?.headers ?? {}),
    },
  });
}

async function upsert(token: string, pathById: string, collection: string, body: unknown): Promise<void> {
  const put = await authedFetch(token, pathById, { method: 'PUT', body: JSON.stringify(body) });
  if (put.ok) return;
  if (put.status !== 404 && put.status !== 405) {
    const errText = await put.text().catch(() => '');
    throw new Error(`PUT ${pathById}: ${put.status} ${errText}`);
  }
  const created = await authedFetch(token, collection, { method: 'POST', body: JSON.stringify(body) });
  if (!created.ok) {
    throw new Error(`POST ${collection}: ${created.status} ${await created.text().catch(() => '')}`);
  }
}

/** Minimal asymmetric cabinet: two sides + a shelf, no construction binding
 * — the joint arrives as an AUTHORED relationship in the resolve request. */
async function seedDemoCatalog(token: string): Promise<void> {
  const board = (extra: Record<string, unknown>) => ({
    length_mm: 684, width_mm: 560, length_formula: '', width_formula: '',
    x_formula: '', y_formula: '', z_formula: '',
    rotate_x: null, rotate_y: null, rotate_z: null,
    default_edges: [], option_roles: [], notes: '', active: true,
    ...extra,
  });
  await upsert(token, `/catalog/components/${SIDE_ID}`, '/catalog/components', board({
    id: SIDE_ID, code: 'DP-LAT', name: 'Lateral Demo', placement: 'lateral_izquierdo',
    geometry_kind: 'rectangular_board', thickness_mm: 18,
    length_formula: 'PH - 2*T', width_formula: 'PD', option_roles: ['LATERAL'],
  }));
  await upsert(token, `/catalog/components/${SIDE_R_ID}`, '/catalog/components', board({
    id: SIDE_R_ID, code: 'DP-LATD', name: 'Lateral Derecho Demo', placement: 'lateral_derecho',
    geometry_kind: 'rectangular_board', thickness_mm: 18,
    length_formula: 'PH - 2*T', width_formula: 'PD', option_roles: ['LATERAL'],
  }));
  await upsert(token, `/catalog/components/${SHELF_ID}`, '/catalog/components', board({
    id: SHELF_ID, code: 'DP-ENTRE', name: 'Entrepaño Demo', placement: 'interno',
    geometry_kind: 'rectangular_board', thickness_mm: 18,
    length_formula: 'PW - 2*T', width_formula: 'PD - T', option_roles: ['INTERIOR'],
  }));
  // The definition's composition instantiates STRUCTURE COMPONENTS whose
  // ids (st-<uuid>) are the template ids occurrences must reference.
  await upsert(token, `/catalog/structures/${STRUCTURE_ID}`, '/catalog/structures', {
    id: STRUCTURE_ID, code: 'DP-CUERPO', name: 'Cuerpo Demo',
    components: [
      { componentId: SIDE_ID, quantity: 1 },
      { componentId: SIDE_R_ID, quantity: 1 },
      { componentId: SHELF_ID, quantity: 1 },
    ],
  });
  await upsert(token, `/catalog/modules/${MODULE_ID}`, '/catalog/modules', {
    id: MODULE_ID, code: 'DP-GAB-600', name: 'Gabinete Demo 600',
    base_labor_cost: 0, width_mm: 600, height_mm: 720, depth_mm: 560,
    categoryId: '', structure_id: STRUCTURE_ID, furniture_type: '', base_mode: '',
    base_clearance_mm: null, components: [], agregados: [], presets: [],
    image_url: '', notes: '', hardware_lines: [], parameter_definitions: [],
  });
}

interface ResolveResponse {
  status: string;
  libraryReleaseId?: string;
  resolved?: {
    machining?: {
      operations?: { provenance?: { technicalProfileId?: string; relationshipId?: string } }[];
      joineryStatuses?: { relationshipId: string; stage: string; contacts: { status: string }[] }[];
      hardwareProfileDemand?: { hardwareId: string; quantity: number }[];
    };
  };
}

test.describe.serial('Hardware profile demo chain (#955)', () => {
  test('seed → assignment → resolve: perforations + purchase demand', async ({ page }) => {
    test.setTimeout(120_000);

    // Real browser session in Browser Gate A using the platform-admin owner.
    // The browser session token stored in localStorage is used for the API chain.
    await page.goto('/');
    await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_A_OWNER_EMAIL'));
    await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
    await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
    await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
    const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
    if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();

    const token = await page.evaluate(() => localStorage.getItem('granete_token'));
    expect(token, 'browser session token').toBeTruthy();

    // 1. The demo seed: profile with embedded recipe + REAL publication of
    // the Standard release (the seed replaces the gate's placeholder flip).
    const seeded = await authedFetch(token!, '/seed', { method: 'POST' });
    expect(seeded.ok, `seed: ${seeded.status}`).toBe(true);

    // The published release carries a REAL manifest (not the placeholder).
    const current = await authedFetch(token!, '/manufacturing-libraries/standard/releases/current');
    expect(current.ok).toBe(true);
    const currentJson = (await current.json()) as { id: string; manifestHash?: string };
    expect(currentJson.manifestHash).toBeDefined();
    expect(currentJson.manifestHash).not.toMatch(/^sha256:0+1$/);

    // 2. Catalog + per-face assignment: the demo profile applies to the
    // LEFT side's front face and the RIGHT side's back face.
    await seedDemoCatalog(token!);
    for (const [componentId, side] of [[SIDE_ID, 'front'], [SIDE_R_ID, 'back']] as const) {
      const put = await authedFetch(token!, `/catalog/components/${componentId}/side-assignments`, {
        method: 'PUT',
        body: JSON.stringify({ side, profileId: DEMO_PROFILE_ID }),
      });
      expect(put.ok, `assignment ${side}: ${put.status}`).toBe(true);
    }

    // 3. Authoring resolve: authored fixed-shelf-side relationship with NO
    // recipes — the server synthesizes them from the pinned profile.
    const defs = await authedFetch(token!, '/furniture/definitions');
    const defsJson = (await defs.json()) as { revisionId?: string };
    expect(defsJson.revisionId).toBeDefined();

    const resolveBody = {
      schemaId: 'granete.sketchup-authoring-resolve.v1',
      schemaName: 'granete.sketchup-authoring-resolve',
      schemaVersion: '1.0',
      messageId: `demo-${crypto.randomUUID()}`,
      idempotencyKey: `demo:${crypto.randomUUID()}`,
      sentAt: new Date().toISOString(),
      source: { client: 'granete-web-demo', clientVersion: '1.0.0', host: 'web', hostVersion: 'demo' },
      units: { length: 'mm', angle: 'deg', precisionMm: 0.01 },
      coordinateSystem: { handedness: 'right', projectFrameId: 'frame-demo', upAxis: 'z' },
      furniture: {
        furnitureDefinitionId: MODULE_ID,
        catalogRevision: defsJson.revisionId,
        components: [
          { componentDefinitionId: ST_SIDE_ID, componentInstanceId: 'dp-side-left' },
          { componentDefinitionId: ST_SIDE_R_ID, componentInstanceId: 'dp-side-right', transform: { frame: 'assembly', translationMm: [582, 18, 0] } },
          { componentDefinitionId: ST_SHELF_ID, componentInstanceId: 'dp-shelf', transform: { frame: 'assembly', translationMm: [18, 18, 400] } },
        ],
        relationships: [{
          relationshipId: 'dp-fixed-shelf',
          kind: 'fixed-shelf-side',
          source: { componentInstanceId: 'dp-shelf', role: 'shelf-edge' },
          targets: [
            { componentInstanceId: 'dp-side-left', role: 'side', face: 'front' },
            { componentInstanceId: 'dp-side-right', role: 'side', face: 'back' },
          ],
          parameters: { stationCount: 3, startMarginMm: 30, endMarginMm: 50 },
        }],
      },
    };
    const resolved = await authedFetch(token!, '/furniture/authoring/resolve', {
      method: 'POST',
      body: JSON.stringify(resolveBody),
    });
    expect(resolved.ok, `resolve: ${resolved.status}`).toBe(true);
    const result = (await resolved.json()) as ResolveResponse;

    // 4. The chain produced perforations + demand from the pinned profile.

    expect(result.libraryReleaseId).toBeDefined();
    const machining = result.resolved?.machining;
    expect(machining?.joineryStatuses?.[0]?.stage).toBe('MACHINING_READY');
    expect(machining?.joineryStatuses?.[0]?.contacts.every((c) => c.status === 'VALID')).toBe(true);

    const profileOps = (machining?.operations ?? []).filter(
      (op) => op.provenance?.relationshipId === 'dp-fixed-shelf');
    expect(profileOps.length).toBe(4); // 2 rules × 2 contacts
    expect(profileOps.every((op) => op.provenance?.technicalProfileId === DEMO_PROFILE_ID)).toBe(true);

    const demand = machining?.hardwareProfileDemand ?? [];
    const byHardware = new Map(demand.map((line) => [line.hardwareId, line.quantity]));
    // 1 minifix + 1 tarugo per contact × 2 verified contacts.
    expect(byHardware.get('a0000003-0000-0000-0000-000000000012')).toBe(2);
    expect(byHardware.get('a0000003-0000-0000-0000-000000000011')).toBe(2);
  });
});
