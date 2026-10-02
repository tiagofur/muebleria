/**
 * #875 slice 2 proof: the SAVED factory construction policy governs the real
 * authoring resolve — the core acceptance the first #875 slice left open
 * ("a form that saves JSON but does not affect the resolver does NOT complete
 * this issue").
 *
 * Real browser login → real Go → disposable PostgreSQL:
 *   seed (demo profile with embedded recipe + real Standard publication)
 *     → demo cabinet whose definition carries a fixed-shelf-side STRUCTURE
 *       binding (targets declare their contact faces) + per-face side
 *       assignments
 *     → the factory saves shelfToSide = 4, then 2
 *     → each definition-default resolve (no authored relationship, no
 *       authored pattern) reaches MACHINING_READY through the pinned
 *       profile carrying THE FACTORY'S station pattern — 4, then 2, never
 *       the definition default 3 — with purchase demand and a different
 *       machining fingerprint per governed state.
 *
 * The two-factory (A vs B) case of the acceptance needs each organization
 * to hold a recipe-bearing profile; profiles authored by org admins carry
 * no recipe by design (#955 surface), and the platform seed provisions one
 * organization. That gap is named in the ODD; this gate proves the
 * governance mechanics the slice adds.
 */

import { expect, test, type Page } from '@playwright/test';
import { GraneteApiClient } from '@granete/storage';
import { ensurePublishedStandardRelease, required } from './support/api';

const apiBase = required('ORGANIZATION_API_BASE');
const DEMO_PROFILE_ID = 'a0000010-0000-0000-0000-000000000001';

// Distinct id series from the #955 demo spec: both specs may upsert in the
// same shard and must never write different bodies under one id. Each
// FACTORY gets its own series too — workshop catalog identities are
// org-scoped rows and the same uuid may not repeat across organizations.
const idsFor = (tenant: 'a' | 'b') => {
  const n = tenant === 'a' ? '1' : '2';
  // last group must be exactly 12 hex chars; n splits the tenant series,
  // k the resource kind.
  const last = (k: string) => `${n}${k}1111111111`;
  const id = (k: string) => `b3333333-8752-4333-8444-${last(k)}`;
  return {
    moduleId: id('1'),
    structureId: id('2'),
    sideId: id('3'),
    sideRId: id('4'),
    shelfId: id('5'),
  };
};

const client = new GraneteApiClient(apiBase);

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

async function loginAndCaptureToken(page: Page, emailEnv: string, orgName: RegExp): Promise<string> {
  let browserToken: string | null = null;
  page.on('request', (req) => {
    const auth = req.headers().authorization;
    if (auth?.startsWith('Bearer ')) browserToken = auth.slice('Bearer '.length);
  });
  await page.goto('/');
  await page.getByLabel('Email').fill(required(emailEnv));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText(orgName, { timeout: 15_000 });
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
  expect(browserToken, 'browser session token').toBeTruthy();
  return browserToken!;
}

/** The definition-default governed cabinet: fixed-shelf-side STRUCTURE
 * binding whose station parameter defaults to 3 — any resolved pattern that
 * is not 3 came from the factory policy, never from the definition. */
async function seedPolicyCatalog(token: string, tenant: 'a' | 'b'): Promise<string> {
  const { moduleId: MODULE_ID, structureId: STRUCTURE_ID, sideId: SIDE_ID, sideRId: SIDE_R_ID, shelfId: SHELF_ID } = idsFor(tenant);
  const board = (extra: Record<string, unknown>) => ({
    length_mm: 684, width_mm: 560, length_formula: '', width_formula: '',
    x_formula: '', y_formula: '', z_formula: '',
    rotate_x: null, rotate_y: null, rotate_z: null,
    default_edges: [], option_roles: [], notes: '', active: true,
    ...extra,
  });
  await upsert(token, `/catalog/components/${SIDE_ID}`, '/catalog/components', board({
    id: SIDE_ID, code: 'FP-LAT', name: 'Lateral Política', placement: 'lateral_izquierdo',
    geometry_kind: 'rectangular_board', thickness_mm: 18,
    length_formula: 'PH - 2*T', width_formula: 'PD', option_roles: ['LATERAL'],
  }));
  await upsert(token, `/catalog/components/${SIDE_R_ID}`, '/catalog/components', board({
    id: SIDE_R_ID, code: 'FP-LATD', name: 'Lateral Derecho Política', placement: 'lateral_derecho',
    geometry_kind: 'rectangular_board', thickness_mm: 18,
    length_formula: 'PH - 2*T', width_formula: 'PD', option_roles: ['LATERAL'],
  }));
  await upsert(token, `/catalog/components/${SHELF_ID}`, '/catalog/components', board({
    id: SHELF_ID, code: 'FP-ENTRE', name: 'Entrepaño Política', placement: 'interno',
    geometry_kind: 'rectangular_board', thickness_mm: 18,
    length_formula: 'PW - 2*T', width_formula: 'PD - T', option_roles: ['INTERIOR'],
  }));
  await upsert(token, `/catalog/structures/${STRUCTURE_ID}`, '/catalog/structures', {
    id: STRUCTURE_ID, code: 'FP-CUERPO', name: 'Cuerpo Política',
    components: [
      { componentId: SIDE_ID, quantity: 1 },
      { componentId: SIDE_R_ID, quantity: 1 },
      { componentId: SHELF_ID, quantity: 1 },
    ],
  });
  await upsert(token, `/catalog/modules/${MODULE_ID}`, '/catalog/modules', {
    id: MODULE_ID, code: 'FP-GAB-600', name: 'Gabinete Política 600',
    base_labor_cost: 0, width_mm: 600, height_mm: 720, depth_mm: 560,
    categoryId: '', structure_id: STRUCTURE_ID, furniture_type: '', base_mode: '',
    base_clearance_mm: null, components: [], agregados: [], presets: [],
    image_url: '', notes: '', hardware_lines: [],
    parameter_definitions: [{
      name: 'shelfJoints', label: 'Fijaciones de entrepaño', type: 'number',
      defaultValue: 3, required: true, integer: true, unit: 'count',
      category: 'configuration',
      binding: {
        version: 1, kind: 'structureRelationship', componentId: SHELF_ID,
        relationship: {
          kind: 'fixed-shelf-side', sourceRole: 'shelf-edge',
          targets: [
            { componentId: SIDE_ID, role: 'side', face: 'front' },
            { componentId: SIDE_R_ID, role: 'side', face: 'back' },
          ],
          station: { startMarginMm: 40, endMarginMm: 40 },
        },
      },
    }],
  });
  // The pinned profile applies to the shelf's TARGET faces (left front /
  // right back), so the structural joint resolves recipes server-side.
  for (const [componentId, side] of [[SIDE_ID, 'front'], [SIDE_R_ID, 'back']] as const) {
    const put = await authedFetch(token, `/catalog/components/${componentId}/side-assignments`, {
      method: 'PUT',
      body: JSON.stringify({ side, profileId: DEMO_PROFILE_ID }),
    });
    const detail = put.ok ? '' : await put.text().catch(() => '');
    expect(put.ok, `assignment ${side}: ${put.status} ${detail}`).toBe(true);
  }
  return MODULE_ID;
}

async function saveShelfPolicy(token: string, stations: number): Promise<void> {
  const overrides: Record<string, unknown> = {
    'joint.shelfToSide.systemId': 'minifix-dowel',
    'joint.shelfToSide.stationsCount': stations,
    'joint.shelfToSide.startMarginMm': 40,
    'joint.shelfToSide.endMarginMm': 40,
  };
  const current = await client.getStandardCurrentRelease(token);
  const active = await client.getActiveStandardLibraryOverlay(token);
  if (active) {
    const merged = { ...((active.overrides ?? {}) as Record<string, unknown>), ...overrides };
    await client.updateLibraryOverlay(token, active.id, { overrides: merged });
    return;
  }
  await client.createLibraryOverlay(token, { baseReleaseId: current.id, overrides });
}

interface GovernedResolve {
  libraryReleaseId?: string;
  resolved?: {
    machining?: {
      manufacturingFingerprint?: string;
      operations?: { provenance?: { relationshipId?: string; technicalProfileId?: string }; holes?: unknown[] }[];
      joineryStatuses?: {
        relationshipId: string; stage: string;
        stations?: { stationCounts?: { stationCount: number }[] };
      }[];
      hardwareProfileDemand?: { hardwareId: string; quantity: number }[];
    };
  };
}

async function resolveDefinitionDefault(token: string, moduleId: string): Promise<GovernedResolve> {
  const defs = await authedFetch(token, '/furniture/definitions');
  const defsJson = (await defs.json()) as { revisionId?: string };
  expect(defsJson.revisionId).toBeDefined();
  const resolved = await authedFetch(token, '/furniture/authoring/resolve', {
    method: 'POST',
    body: JSON.stringify({
      schemaId: 'granete.sketchup-authoring-resolve.v1',
      schemaName: 'granete.sketchup-authoring-resolve',
      schemaVersion: '1.0',
      messageId: `policy-${crypto.randomUUID()}`,
      idempotencyKey: `policy:${crypto.randomUUID()}`,
      sentAt: new Date().toISOString(),
      source: { client: 'granete-web-policy-gate', clientVersion: '1.0.0', host: 'web', hostVersion: 'gate' },
      units: { length: 'mm', angle: 'deg', precisionMm: 0.01 },
      coordinateSystem: { handedness: 'right', projectFrameId: 'frame-policy', upAxis: 'z' },
      furniture: { furnitureDefinitionId: moduleId, catalogRevision: defsJson.revisionId },
    }),
  });
  const body = (await resolved.json()) as GovernedResolve;
  expect(resolved.ok, `resolve: ${resolved.status} ${JSON.stringify(body).slice(0, 400)}`).toBe(true);
  return body;
}

function shelfEvidence(result: GovernedResolve): { stations: number; profileOps: number; holes: number[]; fingerprint: string; demand: Map<string, number> } {
  const machining = result.resolved?.machining;
  const status = machining?.joineryStatuses?.[0];
  expect(status?.stage, 'joint must reach MACHINING_READY').toBe('MACHINING_READY');
  const stations = status?.stations?.stationCounts?.[0]?.stationCount ?? 0;
  const ops = (machining?.operations ?? []).filter((op) => op.provenance?.relationshipId === 'parameter-shelfJoints-1');
  const holes = ops.filter((op) => op.provenance?.technicalProfileId === DEMO_PROFILE_ID).map((op) => op.holes?.length ?? 0);
  return {
    stations,
    profileOps: ops.length,
    holes,
    fingerprint: machining?.manufacturingFingerprint ?? '',
    demand: new Map((machining?.hardwareProfileDemand ?? []).map((line) => [line.hardwareId, line.quantity])),
  };
}

test.describe.serial('Factory policy governs the real resolve (#875 slice 2)', () => {
  test.beforeAll(async () => {
    await ensurePublishedStandardRelease();
  });

  test('la política guardada decide el patrón: default 3 → fábrica 4 → fábrica 2', async ({ page }) => {
    test.setTimeout(180_000);

    // Real browser session (platform-admin owner), seed + catalog + ITS
    // policy. The definition-default resolve carries NO station pattern of
    // its own beyond the parameter default 3 — every other value can only
    // come from the saved overlay.
    const tokenA = await loginAndCaptureToken(page, 'ORGANIZATION_GATE_A_OWNER_EMAIL', 'Browser Gate A');
    const seeded = await authedFetch(tokenA, '/seed', { method: 'POST' });
    expect(seeded.ok, `seed: ${seeded.status}`).toBe(true);
    const moduleId = await seedPolicyCatalog(tokenA, 'a');

    // 0. Baseline: no factory policy → the definition default governs.
    const base = shelfEvidence(await resolveDefinitionDefault(tokenA, moduleId));
    expect(base.stations).toBe(3);
    expect(base.fingerprint).toMatch(/^sha256-/);

    // 1. Factory saves 4 → the resolve obeys the factory, not the definition.
    await saveShelfPolicy(tokenA, 4);
    const four = shelfEvidence(await resolveDefinitionDefault(tokenA, moduleId));
    expect(four.stations).toBe(4);
    expect(four.profileOps).toBe(4); // minifix + dowel rules × 2 contacts
    expect(four.holes).not.toEqual(base.holes); // the pattern physically differs
    expect(four.demand.size).toBeGreaterThan(0);
    expect(four.fingerprint).not.toBe(base.fingerprint);

    // 2. Factory saves 2 → same definition, new governed truth.
    await saveShelfPolicy(tokenA, 2);
    const two = shelfEvidence(await resolveDefinitionDefault(tokenA, moduleId));
    expect(two.stations).toBe(2);
    expect(two.holes).not.toEqual(four.holes);
    expect(two.demand.size).toBeGreaterThan(0);
    expect(two.fingerprint).not.toBe(four.fingerprint);
  });
});
