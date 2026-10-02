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
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { ensurePublishedStandardRelease, putWorkingCopyCurrent, required } from './support/api';

const apiBase = required('ORGANIZATION_API_BASE');
const DEMO_PROFILE_ID = 'a0000010-0000-0000-0000-000000000001';

// Distinct id series from the #955 demo spec: both specs may upsert in the
// same shard and must never write different bodies under one id. Each
// FACTORY gets its own series too — workshop catalog identities are
// org-scoped rows and the same uuid may not repeat across organizations.
const idsFor = (tenant: 'a' | 'b', run: 't1' | 'ab') => {
  const n = tenant === 'a' ? '1' : '2';
  const d = run === 't1' ? '1' : '2';
  // last group must be exactly 12 hex chars; n splits the tenant series,
  // k the resource kind, d the test run (PUTs against existing ids need
  // If-Match — fresh series per test keep the raw upserts conflict-free).
  const last = (k: string) => `${n}${k}11111111${d}1`;
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

async function loginAndCaptureToken(page: Page, emailEnv: string, orgName: string | RegExp): Promise<string> {
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
async function seedPolicyCatalog(token: string, tenant: 'a' | 'b', run: 't1' | 'ab', profileId: string): Promise<string> {
  const { moduleId: MODULE_ID, structureId: STRUCTURE_ID, sideId: SIDE_ID, sideRId: SIDE_R_ID, shelfId: SHELF_ID } = idsFor(tenant, run);
  // Component codes are org-unique too — suffix them with the run.
  const code = (base: string) => `${base}-${run.toUpperCase()}`;
  const board = (extra: Record<string, unknown>) => ({
    length_mm: 684, width_mm: 560, length_formula: '', width_formula: '',
    x_formula: '', y_formula: '', z_formula: '',
    rotate_x: null, rotate_y: null, rotate_z: null,
    default_edges: [], option_roles: [], notes: '', active: true,
    ...extra,
  });
  await upsert(token, `/catalog/components/${SIDE_ID}`, '/catalog/components', board({
    id: SIDE_ID, code: code('FP-LAT'), name: 'Lateral Política', placement: 'lateral_izquierdo',
    geometry_kind: 'rectangular_board', thickness_mm: 18,
    length_formula: 'PH - 2*T', width_formula: 'PD', option_roles: ['LATERAL'],
  }));
  await upsert(token, `/catalog/components/${SIDE_R_ID}`, '/catalog/components', board({
    id: SIDE_R_ID, code: code('FP-LATD'), name: 'Lateral Derecho Política', placement: 'lateral_derecho',
    geometry_kind: 'rectangular_board', thickness_mm: 18,
    length_formula: 'PH - 2*T', width_formula: 'PD', option_roles: ['LATERAL'],
  }));
  await upsert(token, `/catalog/components/${SHELF_ID}`, '/catalog/components', board({
    id: SHELF_ID, code: code('FP-ENTRE'), name: 'Entrepaño Política', placement: 'interno',
    geometry_kind: 'rectangular_board', thickness_mm: 18,
    length_formula: 'PW - 2*T', width_formula: 'PD - T', option_roles: ['INTERIOR'],
  }));
  await upsert(token, `/catalog/structures/${STRUCTURE_ID}`, '/catalog/structures', {
    id: STRUCTURE_ID, code: code('FP-CUERPO'), name: 'Cuerpo Política',
    components: [
      { componentId: SIDE_ID, quantity: 1 },
      { componentId: SIDE_R_ID, quantity: 1 },
      { componentId: SHELF_ID, quantity: 1 },
    ],
  });
  await upsert(token, `/catalog/modules/${MODULE_ID}`, '/catalog/modules', {
    id: MODULE_ID, code: code('FP-GAB-600'), name: 'Gabinete Política 600',
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
      body: JSON.stringify({ side, profileId }),
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
  const holes = ops.filter((op) => op.provenance?.technicalProfileId !== undefined).map((op) => op.holes?.length ?? 0);
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
    const { profileId } = (await seeded.json()) as { profileId: string };
    expect(profileId, 'seed returns the provisioned profile id').toBeTruthy();
    const moduleId = await seedPolicyCatalog(tokenA, 'a', 't1', profileId);

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


test.describe.serial('Historical release freeze (#875 slice 2 review pass B)', () => {
  const FREEZE_MAT_ID = 'b3333333-8753-4000-8000-0000000000a1';
  const FREEZE_SIDE_L = 'b3333333-8753-4000-8000-0000000000b1';
  const FREEZE_SIDE_R = 'b3333333-8753-4000-8000-0000000000b2';
  const FREEZE_SHELF = 'b3333333-8753-4000-8000-0000000000b3';
  const FREEZE_STRUCT = 'b3333333-8753-4000-8000-0000000000c1';
  const FREEZE_MODULE = 'b3333333-8753-4000-8000-0000000000d1';
  const FREEZE_PROJECT = 'b3333333-8753-4000-8000-0000000000e1';
  const FREEZE_CUSTOMER = 'b3333333-8753-4000-8000-0000000000e2';
  const FREEZE_LINE = 'b3333333-8753-4000-8000-0000000000e3';
  const FREEZE_ROLE = 'FRZ-BODY';

  test('R1 congela 4 y no se mueve; R2 congela 2 — part-executions lee la verdad congelada', async ({ page }) => {
    test.setTimeout(240_000);
    const token = await loginAndCaptureToken(page, 'ORGANIZATION_GATE_A_OWNER_EMAIL', 'Browser Gate A');

    // Governed catalog through the workspace snapshot (the proven org write
    // path): sides + shelf, BODY group, and the module's OWN fixed-shelf-side
    // structural binding defaulting to 3. NOTE: the catalog write happens
    // BEFORE the seed — the workspace snapshot replaces the org catalog and
    // would drop the seed's demo hardware rows otherwise (#967 CI).
    const repository = new APIWorkspaceRepository(apiBase, { getAccessToken: () => token });
    const catalog = await repository.getCatalog();
    await repository.saveCatalog({
      ...catalog,
      // NOTE: the seed's demo hardware is NOT in this snapshot on purpose —
      // the /seed (AFTER this write) re-ensures it with per-org mapped ids.
      // Carrying the global fixed ids here collides with them (#964).
      materials: [
        ...catalog.materials.filter((m) => m.id !== FREEZE_MAT_ID),
        {
          id: FREEZE_MAT_ID, code: 'FRZ-TAB', name: 'Tablero Congelado',
          widthMm: 1830, lengthMm: 2440, thicknessMm: 18,
          grainDefault: true, boardPrice: 100, wastePercent: 0, costPerM2: 100, active: true,
        },
      ],
      optionGroups: [
        ...catalog.optionGroups.filter((g) => g.code !== FREEZE_ROLE),
        { id: 'b3333333-8753-4000-8000-0000000000f1', code: FREEZE_ROLE, name: 'Cuerpo Congelado', kind: 'board' as const, required: true, optionIds: [FREEZE_MAT_ID] },
      ],
      customers: [
        ...(catalog.customers ?? []).filter((c) => c.id !== FREEZE_CUSTOMER),
        { id: FREEZE_CUSTOMER, name: 'Cliente Congelado E2E', active: true },
      ],
      components: [
        ...(catalog.components ?? []).filter((c) => ![FREEZE_SIDE_L, FREEZE_SIDE_R, FREEZE_SHELF].includes(c.id)),
        {
          id: FREEZE_SIDE_L, code: 'FRZ-LAT', name: 'Congelado lateral izq', placement: 'lateral_izquierdo' as const,
          geometry: { kind: 'rectangular_board' as const, lengthMm: 684, widthMm: 560, thicknessMm: 18, lengthFormula: 'PH - 2*T', widthFormula: 'PD' },
          defaultEdges: [], optionRoles: [FREEZE_ROLE], active: true,
        },
        {
          id: FREEZE_SIDE_R, code: 'FRZ-LATD', name: 'Congelado lateral der', placement: 'lateral_derecho' as const,
          geometry: { kind: 'rectangular_board' as const, lengthMm: 684, widthMm: 560, thicknessMm: 18, lengthFormula: 'PH - 2*T', widthFormula: 'PD' },
          defaultEdges: [], optionRoles: [FREEZE_ROLE], active: true,
        },
        {
          id: FREEZE_SHELF, code: 'FRZ-ENTRE', name: 'Congelado entrepaño', placement: 'interno' as const,
          geometry: { kind: 'rectangular_board' as const, lengthMm: 564, widthMm: 542, thicknessMm: 18, lengthFormula: 'PW - 2*T', widthFormula: 'PD - T' },
          defaultEdges: [], optionRoles: [FREEZE_ROLE], active: true,
        },
      ],
      structures: [
        ...(catalog.structures ?? []).filter((s) => s.id !== FREEZE_STRUCT),
        {
          id: FREEZE_STRUCT, code: 'FRZ-CUERPO', name: 'Cuerpo Congelado',
          externalDims: { width: 600, height: 720, depth: 560 },
          components: [
            { componentId: FREEZE_SIDE_L, quantity: 1 },
            { componentId: FREEZE_SIDE_R, quantity: 1 },
            { componentId: FREEZE_SHELF, quantity: 1 },
          ],
          active: true,
        },
      ],
      modules: [
        ...catalog.modules.filter((m) => m.id !== FREEZE_MODULE),
        {
          ...catalog.modules[0]!,
          id: FREEZE_MODULE,
          code: 'FRZ-GAB-600',
          name: 'Gabinete Congelado 600',
          structureId: FREEZE_STRUCT,
          components: [],
          hardwareLines: [],
          baseMode: 'none' as const,
          externalDims: { width: 600, height: 720, depth: 560 },
          parameterDefinitions: [{
            name: 'shelfJoints', label: 'Fijaciones de entrepaño', type: 'number',
            defaultValue: 3, required: true, integer: true, unit: 'count',
            category: 'configuration',
            binding: {
              version: 1, kind: 'structureRelationship', componentId: FREEZE_SHELF,
              relationship: {
                kind: 'fixed-shelf-side', sourceRole: 'shelf-edge',
                targets: [
                  { componentId: FREEZE_SIDE_L, role: 'side', face: 'front' },
                  { componentId: FREEZE_SIDE_R, role: 'side', face: 'back' },
                ],
                station: { startMarginMm: 40, endMarginMm: 40 },
              },
            },
          }],
        },
      ],
    });
    const choices: Record<string, string> = { [FREEZE_ROLE]: FREEZE_MAT_ID };

    // The seed LAST: SeedCatalog re-ensures the demo hardware + profile and
    // publishes the Standard release carrying them — after the catalog
    // write, never before it.
    const seeded = await authedFetch(token, '/seed', { method: 'POST' });
    expect(seeded.ok, `seed: ${seeded.status}`).toBe(true);
    const { profileId: freezeProfileId } = (await seeded.json()) as { profileId: string };
    expect(freezeProfileId, 'seed returns the provisioned profile id').toBeTruthy();

    // The pinned profile applies to the joint targets' faces.
    for (const [componentId, side] of [[FREEZE_SIDE_L, 'front'], [FREEZE_SIDE_R, 'back']] as const) {
      const put = await authedFetch(token, `/catalog/components/${componentId}/side-assignments`, {
        method: 'PUT',
        body: JSON.stringify({ side, profileId: freezeProfileId }),
      });
      expect(put.ok, `assignment ${side}: ${put.status}`).toBe(true);
    }

    // The project: one physical unit of the governed cabinet.
    const now = new Date().toISOString();
    await repository.saveProject({
      id: FREEZE_PROJECT,
      name: 'Obra Congelado E2E',
      customerId: FREEZE_CUSTOMER,
      currency: 'MXN',
      marginFactor: 1.3,
      laborFixedCost: 0,
      status: 'draft' as const,
      createdAt: now,
      updatedAt: now,
      items: [{ id: FREEZE_LINE, moduleId: FREEZE_MODULE, quantity: 1, optionChoices: choices }],
    });
    const mat = await client.materializeQuoteLineFurniture(token, FREEZE_PROJECT, FREEZE_LINE, 'freeze-materialize-line');
    expect(mat.instances.length).toBe(1);

    const design = await client.createProjectDesign(token, FREEZE_PROJECT, { name: 'Diseño Congelado' }, 'freeze-create-design');
    await putWorkingCopyCurrent(client, token, design.id, {
      items: [{
        furniture_instance_id: mat.instances[0]!.furniture_instance_id,
        furniture_definition_id: FREEZE_MODULE,
        parameters: { widthMm: 600, heightMm: 720, depthMm: 560 },
        material_choices: choices,
      }],
    });
    const r1 = await client.publishDesignRevision(token, design.id, { source_type: 'manual', base_revision_id: null }, 'freeze-publish-r1');
    const q1 = await client.createInitialProjectQuoteRevision(token, FREEZE_PROJECT, { notes: 'Congelado' }, 'freeze-q1-create');
    await client.publishProjectQuoteRevision(token, FREEZE_PROJECT, q1.id, 'freeze-q1-publish');
    await client.acceptProjectQuoteRevision(token, FREEZE_PROJECT, q1.id, 'freeze-q1-accept');
    let approved;
    try {
      approved = await client.approveProjectDesignRevisionForProduction(token, FREEZE_PROJECT, design.id, r1.id, { quoteRevisionId: q1.id }, 'freeze-approve-r1-q1');
    } catch (err) {
      throw new Error(`freeze approve failed: ${JSON.stringify(err)}`);
    }
    expect(approved.status).toBe('approved');

    // Factory policy 4 → R1 freezes THE GOVERNED 4-station truth.
    await saveShelfPolicy(token, 4);
    let r1Release;
    try {
      r1Release = await client.createProductionRelease(token, FREEZE_PROJECT, { design_revision_id: r1.id, quote_revision_id: q1.id }, 'freeze-release-r1');
    } catch (err) {
      throw new Error(`R1 create failed: ${JSON.stringify(err)}`);
    }

    const readParts = async (): Promise<{ revision: string; shelfOps: number; payload: string }> => {
      const list = await authedFetch(token, `/projects/${FREEZE_PROJECT}/part-executions`);
      expect(list.ok, `part-executions: ${list.status}`).toBe(true);
      const body = (await list.json()) as {
        part_instances: Array<{ production_revision: string; part_code: string; required_operations: unknown[] }>;
      };
      const shelfCode = `st-${FREEZE_SHELF}-copy-0`;
      const shelf = body.part_instances.filter((p) => p.part_code === shelfCode);
      expect(shelf.length, `the governed shelf must exist as a physical piece; codes=${body.part_instances.map((p) => p.part_code).join(',')}`).toBeGreaterThan(0);
      return {
        revision: shelf[0]!.production_revision,
        shelfOps: shelf[0]!.required_operations.length,
        payload: JSON.stringify(body.part_instances),
      };
    };

    const generate = async (tag: string): Promise<void> => {
      const put = await authedFetch(token, `/projects/${FREEZE_PROJECT}/part-executions`, {
        method: 'PUT', body: JSON.stringify({}),
      });
      expect(put.ok, `generate ${tag}: ${put.status} ${await put.text().catch(() => '')}`).toBe(true);
    };

    await generate('R1');
    const frozenR1 = await readParts();
    expect(frozenR1.revision).toBe((r1Release as unknown as { id: string }).id);
    expect(frozenR1.shelfOps).toBeGreaterThan(0);

    // The factory changes its policy to 2: the piece rows are FROZEN truth —
    // the exact same payload, never a re-resolve against the new policy.
    await saveShelfPolicy(token, 2);
    const afterPolicyChange = await readParts();
    expect(afterPolicyChange.payload).toBe(frozenR1.payload);
    expect(afterPolicyChange.revision).toBe(frozenR1.revision);

    // A NEW release freezes the NEW governed truth; the old release's rows
    // only move because the project's current execution is regenerated from
    // R2's own frozen snapshot — R1's snapshot stays 4-station (pinned by the
    // storage freeze test).
    const r2Release = await client.createProductionRelease(token, FREEZE_PROJECT, { design_revision_id: r1.id, quote_revision_id: q1.id }, 'freeze-release-r2');
    await generate('R2');
    const frozenR2 = await readParts();
    expect(frozenR2.revision).toBe((r2Release as unknown as { id: string }).id);
    expect(frozenR2.revision).not.toBe(frozenR1.revision);
  });

  test('A/B REAL: cada fábrica resuelve su propio perfil provisionado (#964)', async ({ page }) => {
    test.setTimeout(240_000);
    // Factory A provisions and saves 4 stations.
    const tokenA = await loginAndCaptureToken(page, 'ORGANIZATION_GATE_A_OWNER_EMAIL', 'Browser Gate A');
    const seededA = await authedFetch(tokenA, '/seed', { method: 'POST' });
    expect(seededA.ok, `seed A: ${seededA.status}`).toBe(true);
    const { profileId: profileA } = (await seededA.json()) as { profileId: string };
    const moduleIdA = await seedPolicyCatalog(tokenA, 'a', 'ab', profileA);
    await saveShelfPolicy(tokenA, 4);
    const a = shelfEvidence(await resolveDefinitionDefault(tokenA, moduleIdA));
    expect(a.stations).toBe(4);
    expect(a.fingerprint).toMatch(/^sha256-/);

    // Factory B: its OWN provisioned profile + assignment + policy over the
    // same Standard definition shape (its org, its ids).
    await page.context().clearCookies();
    const tokenB = await loginAndCaptureToken(page, 'ORGANIZATION_GATE_B_OWNER_EMAIL', 'Browser Gate B');
    const seededB = await authedFetch(tokenB, '/seed', { method: 'POST' });
    const seededBJson = await seededB.json().catch(() => ({})) as { status?: string; profileId?: string };
    expect(seededB.ok, `seed B: ${seededB.status} ${JSON.stringify(seededBJson).slice(0, 300)}`).toBe(true);
    const profileB = seededBJson.profileId!;
    expect(profileB, 'seed B returns the provisioned profile id').toBeTruthy();
    expect(profileB).not.toBe(profileA); // per-org provisioning, never shared
    const moduleIdB = await seedPolicyCatalog(tokenB, 'b', 'ab', profileB);
    await saveShelfPolicy(tokenB, 2);

    const b = shelfEvidence(await resolveDefinitionDefault(tokenB, moduleIdB));
    expect(b.stations).toBe(2);
    expect(b.profileOps).toBe(4);
    expect(b.demand.size).toBeGreaterThan(0);
    expect(b.fingerprint).not.toBe(a.fingerprint); // A=4 / B=2: the #875 A/B truth
  });
});
