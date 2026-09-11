import { Buffer } from 'node:buffer';
import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

/**
 * [P0][DEMO] Canonical golden-path regression (#644, test-only) —
 * Quote → FurnitureInstances → Design → Pairing → working copy →
 * R1 → artifacts → R2 → approval → ProductionRelease.
 *
 * ONE deterministic kitchen quote driven through the REAL supported stack:
 * browser (React/Vite) + Go API + PostgreSQL + artifact filesystem. No SQL
 * bypass, no mocks. Licensed SketchUp-host execution stays out of CI by
 * contract: the authoring half is proven through the supported cross-surface
 * contracts (manifest source=sketchup, extension-credential pairing,
 * multipart publish pipeline) and classified RUBY CONTRACT where the TestUp
 * suites own it.
 *
 * Every stage asserts EXACT ids captured in `track` — the suite fails if any
 * stage silently retargets ("latest", working copy, first row).
 *
 * Truth contradictions and material-provenance losses are recorded as
 * explicit findings (`note`) instead of being smoothed over or silently
 * fixed. #642 resolved the recorded FOUND_DOUBLE_TRUTH: the golden release
 * now runs entirely with Project.status=draft and a negative proof pins that
 * a legacy 'accepted' stamp alone never authorizes a release.
 */

const PROJECT_ID = '77777777-4444-4777-8777-444444444444';
const GOLD_LINE_A = '88888888-4444-4888-8888-444444444444'; // Gabinete bajo, qty 2
const GOLD_LINE_B = '88888888-4444-4888-8888-444444444445'; // Alacena alta, qty 1
const CUSTOMER_ID = 'c0000000-0000-4000-8000-000000000004';

// Golden-specific catalog entities (never shared with other gate specs).
const GOLD_MAT_INTERIOR_BLANCO = 'a7770000-0000-4000-8000-000000000001';
const GOLD_MAT_INTERIOR_ROBLE = 'a7770000-0000-4000-8000-000000000002';
const GOLD_MAT_FRENTE_MADERA = 'a7770000-0000-4000-8000-000000000003';
const GOLD_OG_INTERIOR = 'a7770000-0000-4000-8000-000000000004';
const GOLD_OG_FRENTE = 'a7770000-0000-4000-8000-000000000005';
const GOLD_STRUCT = 'a7770000-0000-4000-8000-000000000006';
const GOLD_COMP_FRENTE = 'a7770000-0000-4000-8000-000000000007';
const GOLD_COMP_INTERIOR = 'a7770000-0000-4000-8000-000000000008';
const GOLD_MODULE = 'a7770000-0000-4000-8000-000000000009';
const GOLD_MODULE_NAME = 'Gabinete Cocina Dorada';
const GOLD_MODULE_RENAMED = 'Gabinete Cocina Dorada v2';

// Explicit quoted material choices per commercial line (the same authority
// #621/#637 consume: project line optionChoices with real catalog materials).
// Choice keys match the components' optionRoles / optionGroup codes — that is
// the mapping the manufacturing resolver uses to pin each board part.
const CHOICES_A = {
  'GOLD-INTERIOR': GOLD_MAT_INTERIOR_BLANCO,
  'GOLD-FRENTE': GOLD_MAT_FRENTE_MADERA,
} as const;
const CHOICES_B = {
  'GOLD-INTERIOR': GOLD_MAT_INTERIOR_ROBLE,
  'GOLD-FRENTE': GOLD_MAT_FRENTE_MADERA,
} as const;

interface GoldenPathTrack {
  projectId: string;
  quoteRevisionId: string;
  q2Id: string;
  furnitureInstanceIds: string[];
  designId: string;
  r1Id: string;
  r2Id: string;
  productionReleaseId: string;
}

const track: GoldenPathTrack = {
  projectId: '',
  quoteRevisionId: '',
  q2Id: '',
  furnitureInstanceIds: [],
  designId: '',
  r1Id: '',
  r2Id: '',
  productionReleaseId: '',
};

const findings: string[] = [];

function note(message: string): void {
  findings.push(message);
  console.log(`[golden-path-finding] ${message}`);
}

async function loginOwner(): Promise<{ token: string }> {
  return new GraneteApiClient(required('ORGANIZATION_API_BASE')).login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
}

async function loginExtension(): Promise<{ token: string }> {
  return new GraneteApiClient(required('ORGANIZATION_API_BASE')).login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'sketchup',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
}

/** Material provenance of one physical unit at one lifecycle surface. */
interface UnitProvenance {
  instanceId: string;
  surface: string;
  materialChoices: Record<string, string>;
}

const provenance: UnitProvenance[] = [];

// Expected quoted choices per physical unit, filled at materialization.
const expectedChoices = new Map<string, Record<string, string>>();

function recordProvenance(instanceId: string, surface: string, choices: Record<string, string> | undefined | null): void {
  provenance.push({ instanceId, surface, materialChoices: { ...(choices ?? {}) } });
}

/** Records the provenance surface and fails if quoted choices drift or disappear. */
function expectQuotedChoices(
  instanceId: string,
  surface: string,
  choices: Record<string, string> | undefined | null,
): void {
  recordProvenance(instanceId, surface, choices);
  const wanted = expectedChoices.get(instanceId) ?? {};
  expect(choices, `unit ${instanceId} quoted choices drifted at ${surface}`).toEqual(wanted);
}

function expectExactDimensions(parameters: Record<string, unknown>, widthMm = 600): void {
  expect(parameters).toEqual({ depthMm: 590, heightMm: 720, widthMm });
}

interface RevisionPresentationItem {
  furniture_instance_id: string;
  furniture_definition_id?: string | null;
  parameters: Record<string, unknown>;
  material_choices: Record<string, string>;
  descriptor_state: 'available' | 'unavailable_legacy';
  presentation_snapshot?: {
    schema_version: 1;
    definition: { name?: string; code?: string };
    parameters: readonly { key: string; label?: string; value: unknown; unit?: string; state: string }[];
    materials: readonly {
      role: string;
      role_label?: string;
      material_id?: string;
      name?: string;
      code?: string;
      effective_thickness_mm?: number;
      provenance: string;
    }[];
    room: { label?: string; state: string };
  };
}

function expectPresentationSnapshot(
  item: RevisionPresentationItem,
  definitionName: string,
  materialNameSuffix = '',
  widthMm = 600,
): void {
  expect(item.descriptor_state).toBe('available');
  const snapshot = item.presentation_snapshot;
  expect(snapshot).toBeTruthy();
  expect(snapshot!.schema_version).toBe(1);
  expect(snapshot!.definition).toEqual({ code: 'GOLD-MOD-1', name: definitionName });
  expect(snapshot!.parameters).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: 'widthMm', label: 'Ancho', value: widthMm, unit: 'mm', state: 'available' }),
    expect.objectContaining({ key: 'heightMm', label: 'Alto', value: 720, unit: 'mm', state: 'available' }),
    expect.objectContaining({ key: 'depthMm', label: 'Profundidad', value: 590, unit: 'mm', state: 'available' }),
  ]));
  expect(snapshot!.room).toEqual({ state: 'unavailable' });

  const expected = expectedChoices.get(item.furniture_instance_id)!;
  expect(snapshot!.materials).toHaveLength(2);
  for (const [role, materialId] of Object.entries(expected)) {
    const descriptor = snapshot!.materials.find((material) => material.role === role);
    expect(descriptor).toBeTruthy();
    const expectedName = materialId === GOLD_MAT_INTERIOR_BLANCO
      ? `Arania Blanco${materialNameSuffix}`
      : materialId === GOLD_MAT_INTERIOR_ROBLE
        ? `Roble Interior${materialNameSuffix}`
        : `Madera Frente${materialNameSuffix}`;
    const expectedCode = materialId === GOLD_MAT_INTERIOR_BLANCO
      ? 'GOLD-TAB-ARA-BLA'
      : materialId === GOLD_MAT_INTERIOR_ROBLE
        ? 'GOLD-TAB-ROB'
        : 'GOLD-TAB-MAD-FRE';
    expect(descriptor).toEqual(expect.objectContaining({
      material_id: materialId,
      name: expectedName,
      code: expectedCode,
      effective_thickness_mm: 18,
      provenance: 'quoted',
    }));
  }
}

function revisionById(revisions: readonly { id: string }[], revisionId: string, label: string): { id: string } {
  const found = revisions.find((r) => r.id === revisionId);
  expect(found, `${label} ${revisionId} not found by exact id`).toBeTruthy();
  return found!;
}

/** The #392/#633 SketchUp publish contract: manifest prepare → multipart artifacts → finalize. */
async function publishViaSketchUpContract(
  client: GraneteApiClient,
  token: string,
  designId: string,
  instanceIds: readonly string[],
  baseRevisionId: string | null,
  key: string,
): Promise<{ id: string; revision_number: number; parent_revision_id: string | null; source_type: string; items: readonly RevisionPresentationItem[] }> {
  const apiBase = required('ORGANIZATION_API_BASE');
  const manifest = {
    schemaVersion: 1,
    projectId: track.projectId,
    designId,
    baseRevisionId,
    source: {
      client: 'sketchup' as const,
      sketchupVersion: '2026',
      pluginVersion: 'golden-path-regression',
    },
    items: instanceIds.map((furnitureInstanceId) => ({ furnitureInstanceId })),
  };
  const session = await client.prepareDesignPublish(token, designId, { manifest }, `${key}-prepare`);
  expect(session.status).toBe('prepared');
  expect([...session.required_artifacts].sort()).toEqual(['manifest', 'model', 'preview']);
  for (const [kind, filename, contentType, bytes] of [
    ['model', 'kitchen.skp', 'application/octet-stream', new TextEncoder().encode('SketchUp golden-path model bytes (CI stand-in for the licensed host .skp)')],
    ['manifest', 'manifest.json', 'application/json', new TextEncoder().encode(JSON.stringify(manifest))],
    ['preview', 'preview.png', 'image/png', Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))],
  ] as const) {
    const form = new FormData();
    form.append('file', new Blob([bytes.buffer as ArrayBuffer], { type: contentType }), filename);
    const response = await fetch(`${apiBase}/designs/${designId}/publish/${session.id}/artifacts/${kind}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    expect(response.status, `artifact ${kind} upload failed: ${await response.text()}`).toBe(201);
  }
  return (await client.finalizeDesignPublish(token, designId, session.id, `${key}-finalize`)) as unknown as {
    id: string;
    revision_number: number;
    parent_revision_id: string | null;
    source_type: string;
    items: readonly RevisionPresentationItem[];
  };
}

/** Signed-grant artifact readback (#392 §§31–32, post-#636 canonical path). */
async function assertArtifactReadback(
  client: GraneteApiClient,
  token: string,
  designId: string,
  revisionId: string,
): Promise<void> {
  const artifacts = await client.listDesignRevisionArtifacts(token, designId, revisionId);
  expect(artifacts.length).toBe(3);
  for (const artifact of artifacts) {
    expect(artifact.size_bytes).toBeGreaterThan(0);
  }
  for (const kind of ['preview', 'manifest', 'model'] as const) {
    const grant = await client.authorizeDesignRevisionArtifact(token, designId, revisionId, kind);
    const artifactUrl = new URL(grant.url, new URL(required('ORGANIZATION_API_BASE')).origin);
    expect(artifactUrl.pathname, 'artifact URL must use the canonical /api/design-artifacts/ path').toMatch(/^\/api\/design-artifacts\//);
    expect(artifactUrl.pathname).not.toContain('/api/api/');
    const bytes = await fetch(artifactUrl);
    expect(bytes.status, `artifact ${kind} GET failed`).toBe(200);
    expect((await bytes.arrayBuffer()).byteLength).toBeGreaterThan(0);
  }
}

async function loginToA(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await expect(page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' })).toBeVisible();
  await page.getByRole('button', { name: /Browser Gate A/ }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

test.describe.serial('DEMO golden path: Quote → SketchUp → DesignRevision → ProductionRelease (#644)', () => {
  let owner!: { token: string };
  let client!: GraneteApiClient;

  test.beforeAll(async () => {
    client = new GraneteApiClient(required('ORGANIZATION_API_BASE'));
    owner = await loginOwner();
  });

  // ------------------------------------------------------------------
  // Stage 1 — Quote: the real QuoteRevision lifecycle (draft→published→
  // accepted) through the supported API commands (#571). The kitchen
  // carries TWO lines: base cabinet qty=2 and upper cabinet qty=1, both
  // with EXPLICIT quoted material choices.
  // ------------------------------------------------------------------
  test('stage 1 — accepted QuoteRevision with lines, quantities and quoted finishes', async () => {
    test.setTimeout(60_000);
    const repository = new APIWorkspaceRepository(required('ORGANIZATION_API_BASE'), {
      getAccessToken: () => owner.token,
    });
    const catalog = await repository.getCatalog();
    await repository.saveCatalog({
      ...catalog,
      materials: [
        ...catalog.materials,
        { id: GOLD_MAT_INTERIOR_BLANCO, code: 'GOLD-TAB-ARA-BLA', name: 'Arania Blanco', widthMm: 1830, lengthMm: 2440, thicknessMm: 18, grainDefault: false, boardPrice: 100, wastePercent: 0, costPerM2: 100, active: true },
        { id: GOLD_MAT_INTERIOR_ROBLE, code: 'GOLD-TAB-ROB', name: 'Roble Interior', widthMm: 1830, lengthMm: 2440, thicknessMm: 18, grainDefault: false, boardPrice: 140, wastePercent: 0, costPerM2: 140, active: true },
        { id: GOLD_MAT_FRENTE_MADERA, code: 'GOLD-TAB-MAD-FRE', name: 'Madera Frente', widthMm: 1830, lengthMm: 2440, thicknessMm: 18, grainDefault: true, boardPrice: 220, wastePercent: 0, costPerM2: 220, active: true },
      ],
      optionGroups: [
        ...catalog.optionGroups,
        { id: GOLD_OG_INTERIOR, code: 'GOLD-INTERIOR', name: 'Interior Dorado', kind: 'board', required: true, optionIds: [GOLD_MAT_INTERIOR_BLANCO, GOLD_MAT_INTERIOR_ROBLE] },
        { id: GOLD_OG_FRENTE, code: 'GOLD-FRENTE', name: 'Frente Dorado', kind: 'board', required: true, optionIds: [GOLD_MAT_FRENTE_MADERA] },
      ],
      structures: [
        ...(catalog.structures ?? []),
        {
          id: GOLD_STRUCT,
          code: 'GOLD-STRUCT',
          name: 'Gabinete Dorado',
          externalDims: { width: 600, height: 720, depth: 590 },
          components: [
            { componentId: GOLD_COMP_FRENTE, quantity: 1 },
            { componentId: GOLD_COMP_INTERIOR, quantity: 2 },
          ],
          active: true,
        },
      ],
      components: [
        ...(catalog.components ?? []),
        {
          id: GOLD_COMP_FRENTE,
          code: 'GOLD-COMP-FRE',
          name: 'Puerta/Frente',
          placement: 'interno',
          geometry: { kind: 'rectangular_board', lengthMm: 720, widthMm: 600, thicknessMm: 18 },
          defaultEdges: [
            { side: 'L1', enabled: false },
            { side: 'L2', enabled: false },
            { side: 'W1', enabled: false },
            { side: 'W2', enabled: false },
          ],
          optionRoles: ['GOLD-FRENTE'],
          active: true,
        },
        {
          id: GOLD_COMP_INTERIOR,
          code: 'GOLD-COMP-INT',
          name: 'Panel Interior',
          placement: 'interno',
          geometry: { kind: 'rectangular_board', lengthMm: 720, widthMm: 590, thicknessMm: 18 },
          defaultEdges: [
            { side: 'L1', enabled: false },
            { side: 'L2', enabled: false },
            { side: 'W1', enabled: false },
            { side: 'W2', enabled: false },
          ],
          optionRoles: ['GOLD-INTERIOR'],
          active: true,
        },
      ],
      modules: [
        ...catalog.modules,
        {
          id: GOLD_MODULE,
          code: 'GOLD-MOD-1',
          name: GOLD_MODULE_NAME,
          externalDims: { width: 600, height: 720, depth: 590 },
          structureId: GOLD_STRUCT,
          components: [],
          hardwareLines: [],
        },
      ],
      customers: [
        ...(catalog.customers ?? []).filter((c) => c.id !== CUSTOMER_ID),
        { id: CUSTOMER_ID, name: 'Cliente Cocina Dorada', active: true },
      ],
    });

    const now = new Date().toISOString();
    await repository.saveProject({
      id: PROJECT_ID,
      name: 'Cocina Dorada DEMO',
      customerId: CUSTOMER_ID,
      currency: 'MXN',
      marginFactor: 1.3,
      laborFixedCost: 0,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      items: [
        { id: GOLD_LINE_A, moduleId: GOLD_MODULE, quantity: 2, optionChoices: { ...CHOICES_A } },
        { id: GOLD_LINE_B, moduleId: GOLD_MODULE, quantity: 1, optionChoices: { ...CHOICES_B } },
      ],
    });

    // The current quote LINE is one material authority (#621/#637).
    const storedLineA = (await repository.getProjects()).find((p) => p.id === PROJECT_ID)!.items.find((i) => i.id === GOLD_LINE_A)!;
    expect(storedLineA.quantity).toBe(2);
    expect(storedLineA.optionChoices).toEqual(CHOICES_A);
    const storedLineB = (await repository.getProjects()).find((p) => p.id === PROJECT_ID)!.items.find((i) => i.id === GOLD_LINE_B)!;
    expect(storedLineB.optionChoices).toEqual(CHOICES_B);

    // Q1 draft → published → accepted, through the exact commands.
    const q1 = await client.createInitialProjectQuoteRevision(owner.token, PROJECT_ID, {
      notes: 'Cocina dorada — revisión inicial',
    }, 'golden-q1-create');
    track.projectId = PROJECT_ID;
    track.quoteRevisionId = q1.id;
    expect(q1.revisionNumber).toBe(1);
    expect(q1.status).toBe('draft');

    expect((await client.publishProjectQuoteRevision(owner.token, PROJECT_ID, q1.id, 'golden-q1-publish')).status).toBe('published');
    expect((await client.acceptProjectQuoteRevision(owner.token, PROJECT_ID, q1.id, 'golden-q1-accept')).status).toBe('accepted');

    // Exact readback: the accepted QuoteRevision exists and is identifiable.
    const revisions = await client.listProjectQuoteRevisions(owner.token, PROJECT_ID);
    const accepted = revisionById(revisions, track.quoteRevisionId, 'accepted QuoteRevision') as unknown as {
      id: string;
      status: string;
      revisionNumber: number;
      items: readonly { furnitureInstanceId: string; furnitureDefinitionId?: string | null; parameters: Record<string, unknown>; materialChoices: Record<string, string>; lifecycleStatus: string }[];
    };
    expect(accepted.status).toBe('accepted');
    expect(accepted.revisionNumber).toBe(1);
    expect(accepted.items).toHaveLength(3);
    for (const item of accepted.items) {
      expect(item.furnitureDefinitionId).toBe(GOLD_MODULE);
      expect(item.lifecycleStatus).toBe('active');
      expectExactDimensions(item.parameters);
    }
    const q1A = accepted.items.filter((item) => item.materialChoices['GOLD-INTERIOR'] === GOLD_MAT_INTERIOR_BLANCO);
    const q1B = accepted.items.filter((item) => item.materialChoices['GOLD-INTERIOR'] === GOLD_MAT_INTERIOR_ROBLE);
    expect(q1A).toHaveLength(2);
    expect(q1B).toHaveLength(1);
    for (const item of q1A) expect(item.materialChoices).toEqual(CHOICES_A);
    for (const item of q1B) expect(item.materialChoices).toEqual(CHOICES_B);
    track.furnitureInstanceIds = [...q1A, ...q1B].map((item) => item.furnitureInstanceId);
    for (const item of q1A) expectedChoices.set(item.furnitureInstanceId, { ...CHOICES_A });
    for (const item of q1B) expectedChoices.set(item.furnitureInstanceId, { ...CHOICES_B });
    note(`truth: Project.status=draft at acceptance time (QuoteRevision Q1 accepted independently — separate truth sources)`);
  });

  // ------------------------------------------------------------------
  // Stage 2 — FurnitureInstances: quantity=2 materializes TWO distinct
  // physical identities carrying the quoted dimensions and finishes (#621).
  // ------------------------------------------------------------------
  test('stage 2 — physical units materialized with quoted identity', async () => {
    test.setTimeout(60_000);
    const matA = await client.materializeQuoteLineFurniture(owner.token, PROJECT_ID, GOLD_LINE_A, 'golden-mat-line-a-units');
    expect(matA.instances).toHaveLength(2);
    const matB = await client.materializeQuoteLineFurniture(owner.token, PROJECT_ID, GOLD_LINE_B, 'golden-mat-line-b-units');
    expect(matB.instances).toHaveLength(1);

    const materializedIds = [
      matA.instances[0]!.furniture_instance_id,
      matA.instances[1]!.furniture_instance_id,
      matB.instances[0]!.furniture_instance_id,
    ];
    expect(new Set(materializedIds).size).toBe(3);
    expect(new Set(materializedIds)).toEqual(new Set(track.furnitureInstanceIds));

    // Exact placement inputs (#389/#621): the LIST surface carries the
    // server-computed authoring display per unit — project, definition
    // provenance, quoted dimensions and the quoted finishes.
    const instances = await client.listProjectFurnitureInstances(owner.token, PROJECT_ID);
    const goldenInstances = instances.filter((i) => track.furnitureInstanceIds.includes(i.id));
    expect(goldenInstances).toHaveLength(3);
    for (const instanceId of track.furnitureInstanceIds) {
      const instance = goldenInstances.find((i) => i.id === instanceId)!;
      expect(instance.project_id).toBe(PROJECT_ID);
      expect(instance.furniture_definition_id).toBe(GOLD_MODULE);
      const display = instance.display;
      expect(display, `unit ${instanceId} missing authoring display`).toBeTruthy();
      expect(display!.dimensions_mm).toEqual({ depth: 590, height: 720, width: 600 });
      expectQuotedChoices(instanceId, 'furniture-instance-display', display!.material_choices);
    }

    // The Web /muebles workspace shows the same 3 physical units.
    const workspace = await client.getProjectFurnitureWorkspace(owner.token, PROJECT_ID, {});
    expect(workspace.units.filter((u) => track.furnitureInstanceIds.includes(u.furnitureInstance.id))).toHaveLength(3);

    // Idempotency: re-materializing never mints extra identities.
    const matAgain = await client.materializeQuoteLineFurniture(owner.token, PROJECT_ID, GOLD_LINE_A, 'golden-mat-a-again');
    expect(matAgain.instances).toHaveLength(2);
    expect(new Set(matAgain.instances.map((i) => i.furniture_instance_id))).toEqual(new Set(track.furnitureInstanceIds.slice(0, 2)));
  });

  // ------------------------------------------------------------------
  // Stage 3 — Design: the first canonical design through the real API with
  // the exact accepted QuoteRevision as commercial source; Web handoff.
  // ------------------------------------------------------------------
  test('stage 3 — first Design with zero revisions and Web handoff', async ({ page }) => {
    test.setTimeout(120_000);
    const design = await client.createProjectDesign(owner.token, PROJECT_ID, {
      name: 'Cocina Dorada — Diseño',
      source_quote_revision_id: track.quoteRevisionId,
    }, 'golden-create-design');
    track.designId = design.id;
    expect(design.project_id).toBe(PROJECT_ID);

    expect(await client.listDesignRevisions(owner.token, design.id)).toHaveLength(0);

    const working = await client.getDesignWorkingCopy(owner.token, design.id);
    expect(working.base_revision_id ?? null).toBeNull();
    expect(working.items).toHaveLength(0);

    // Web handoff is available before any revision exists (base null).
    await loginToA(page);
    await page.goto(`/quotes/${PROJECT_ID}/disenos`);
    await expect(page.getByTestId('project-designs-workspace')).toBeVisible();
    await page.getByRole('tab', { name: 'Cocina Dorada — Diseño' }).click();
    await page.getByTestId('open-in-sketchup-btn').click();
    await expect(page.getByTestId('sketchup-pairing-modal')).toBeVisible();
    await expect(page.getByTestId('pairing-base-label')).toHaveText('Base: Sin revisión publicada');
    await page.keyboard.press('Escape');
  });

  // ------------------------------------------------------------------
  // Stage 4 — Pairing: grant exact Project/Design/base=null, exchange via
  // the extension credential, exact identity returned, terminal confirmed.
  // ------------------------------------------------------------------
  test('stage 4 — pairing grant, extension exchange and confirmed binding', async ({ page }) => {
    test.setTimeout(120_000);
    const extension = await loginExtension();

    await loginToA(page);
    await page.goto(`/quotes/${PROJECT_ID}/disenos`);
    await page.getByRole('tab', { name: 'Cocina Dorada — Diseño' }).click();
    await page.getByTestId('open-in-sketchup-btn').click();
    await expect(page.getByTestId('pairing-base-label')).toHaveText('Base: Sin revisión publicada');
    const codeText = (await page.getByTestId('pairing-code').textContent()) ?? '';
    const code = codeText.replace(/\s+/g, '');
    expect(code).toMatch(/^[A-Z2-9]{12}$/);

    // Exchange through the extension credential (transport 'sketchup').
    const exchanged = await client.exchangeDesignPairingGrant(extension.token, { code });
    expect(exchanged.design.id).toBe(track.designId);
    expect(exchanged.project.id).toBe(PROJECT_ID);
    expect(exchanged.pinned_base_revision_id ?? null).toBeNull();
    expect(exchanged.grant_id).toBeTruthy();

    // Confirm the exact persisted identity → terminal confirmed.
    const confirmed = await client.confirmDesignPairingGrant(extension.token, exchanged.grant_id, {
      project_id: PROJECT_ID,
      design_id: track.designId,
    });
    expect(confirmed.status).toBe('confirmed');

    // The Web sheet observes the terminal confirmation through polling.
    await expect(page.getByTestId('pairing-confirmed')).toContainText('Diseño vinculado en SketchUp', { timeout: 30_000 });
    await page.keyboard.press('Escape');

    // Replay: a consumed code cannot bind twice.
    await expect(client.exchangeDesignPairingGrant(extension.token, { code })).rejects.toThrow();
  });

  // ------------------------------------------------------------------
  // Stage 5 — Working copy (SketchUp authoring contract): placement inputs
  // carry exact dimensions + quoted finishes + unique instance identities;
  // definition_version stays a valid integer or omitted.
  // ------------------------------------------------------------------
  test('stage 5 — working copy carries quoted identity for every unit', async () => {
    test.setTimeout(60_000);
    await client.updateDesignWorkingCopy(owner.token, track.designId, {
      source_type: 'sketchup',
      items: track.furnitureInstanceIds.map((instanceId, index) => ({
        furniture_instance_id: instanceId,
        furniture_definition_id: GOLD_MODULE,
        // Both allowed forms: explicit integer version on one unit, omitted
        // on the others (#625 contract — never a catalog semver string).
        ...(index === 2 ? { definition_version: 1 } : {}),
        parameters: { widthMm: 600, heightMm: 720, depthMm: 590 },
        material_choices: { ...(index === 2 ? CHOICES_B : CHOICES_A) },
        transform: { translation_mm: [index * 600, 0, 0], rotation_deg: [0, 0, 0] },
      })),
    });
    const working = await client.getDesignWorkingCopy(owner.token, track.designId);
    expect(working.items).toHaveLength(3);
    expect(new Set(working.items.map((i) => i.furniture_instance_id))).toEqual(new Set(track.furnitureInstanceIds));
    for (const item of working.items) {
      expectExactDimensions(item.parameters);
      if (item.definition_version !== null && item.definition_version !== undefined) {
        expect(Number.isInteger(item.definition_version)).toBe(true);
      }
      expectQuotedChoices(item.furniture_instance_id, 'working-copy', item.material_choices);
    }
  });

  // ------------------------------------------------------------------
  // Stage 6 — Publish R1 through the SketchUp publish contract (manifest
  // source=sketchup, parent null), exact instances and finishes in the
  // immutable snapshot; artifacts registered and readable.
  // ------------------------------------------------------------------
  test('stage 6 — R1 published from the SketchUp contract', async () => {
    test.setTimeout(60_000);
    const r1 = await publishViaSketchUpContract(client, owner.token, track.designId, track.furnitureInstanceIds, null, 'golden-publish-r1');
    track.r1Id = r1.id;
    expect(r1.revision_number).toBe(1);
    expect(r1.parent_revision_id ?? null).toBeNull();
    expect(r1.source_type).toBe('sketchup');
    expect(r1.items.map((i) => i.furniture_instance_id).sort()).toEqual([...track.furnitureInstanceIds].sort());
    for (const item of r1.items) {
      expectExactDimensions(item.parameters);
      expectQuotedChoices(item.furniture_instance_id, 'R1', item.material_choices);
      expectPresentationSnapshot(item, GOLD_MODULE_NAME);
    }
    // The working copy advanced to R1 as its base.
    const working = await client.getDesignWorkingCopy(owner.token, track.designId);
    expect(working.base_revision_id).toBe(track.r1Id);
    await assertArtifactReadback(client, owner.token, track.designId, track.r1Id);
  });

  // ------------------------------------------------------------------
  // Stage 7 — Artifact readback detail: the manifest content itself proves
  // the SketchUp source contract end to end. NOT #636: no browser preview
  // UI behavior is asserted here, only the canonical signed path.
  // ------------------------------------------------------------------
  test('stage 7 — manifest readback proves the exact SketchUp publish identity', async () => {
    test.setTimeout(60_000);
    await assertArtifactReadback(client, owner.token, track.designId, track.r1Id);
    const grant = await client.authorizeDesignRevisionArtifact(owner.token, track.designId, track.r1Id, 'manifest');
    const manifest = await (await fetch(new URL(grant.url, new URL(required('ORGANIZATION_API_BASE')).origin))).json();
    expect(manifest.source.client).toBe('sketchup');
    expect(manifest.designId).toBe(track.designId);
    expect(manifest.projectId).toBe(PROJECT_ID);
    expect(manifest.baseRevisionId ?? null).toBeNull();
    expect(manifest.items.map((i: { furnitureInstanceId: string }) => i.furnitureInstanceId).sort())
      .toEqual([...track.furnitureInstanceIds].sort());
  });

  // ------------------------------------------------------------------
  // Stage 8 — R2: modify the exact unit through the supported authoring
  // path, publish through the SketchUp contract with base R1. R1 stays
  // immutable; the changed data is isolated to R2; Web shows both.
  // ------------------------------------------------------------------
  test('stage 8 — R2 parented to R1, R1 immutable, Web shows both', async ({ page }) => {
    test.setTimeout(120_000);
    const r1Before = revisionById(await client.listDesignRevisions(owner.token, track.designId), track.r1Id, 'R1') as unknown as { items: readonly RevisionPresentationItem[] };

    // Mutable catalog labels change after R1, but must never retarget R1's
    // immutable presentation snapshot (#639).
    const repository = new APIWorkspaceRepository(required('ORGANIZATION_API_BASE'), { getAccessToken: () => owner.token });
    const catalog = await repository.getCatalog();
    await repository.saveCatalog({
      ...catalog,
      modules: catalog.modules.map((module) => module.id === GOLD_MODULE ? { ...module, name: GOLD_MODULE_RENAMED } : module),
      materials: catalog.materials.map((material) => (
        [GOLD_MAT_INTERIOR_BLANCO, GOLD_MAT_INTERIOR_ROBLE, GOLD_MAT_FRENTE_MADERA].includes(material.id)
          ? { ...material, name: `${material.name} v2` }
          : material
      )),
    });
    const r1AfterCatalogRename = revisionById(await client.listDesignRevisions(owner.token, track.designId), track.r1Id, 'R1 after catalog rename') as unknown as { items: readonly RevisionPresentationItem[] };
    expect(r1AfterCatalogRename).toEqual(r1Before);
    for (const item of r1AfterCatalogRename.items) expectPresentationSnapshot(item, GOLD_MODULE_NAME);

    const modifiedWidth = 650;
    await client.updateDesignWorkingCopy(owner.token, track.designId, {
      source_type: 'sketchup',
      items: track.furnitureInstanceIds.map((instanceId, index) => ({
        furniture_instance_id: instanceId,
        furniture_definition_id: GOLD_MODULE,
        parameters: { widthMm: index === 2 ? modifiedWidth : 600, heightMm: 720, depthMm: 590 },
        material_choices: { ...(index === 2 ? CHOICES_B : CHOICES_A) },
        transform: { translation_mm: [index * 600, 0, 0], rotation_deg: [0, 0, 0] },
      })),
    });
    const r2 = await publishViaSketchUpContract(client, owner.token, track.designId, track.furnitureInstanceIds, track.r1Id, 'golden-publish-r2');
    track.r2Id = r2.id;
    expect(r2.revision_number).toBe(2);
    expect(r2.parent_revision_id).toBe(track.r1Id);

    // The API projection of R1 remains semantically stable (immutable history).
    const r1After = revisionById(await client.listDesignRevisions(owner.token, track.designId), track.r1Id, 'R1 after R2');
    expect(r1After).toEqual(r1Before);

    // R2 carries the isolated change (unit B width 600 → 650).
    const modifiedItem = r2.items.find((i) => i.furniture_instance_id === track.furnitureInstanceIds[2]);
    expect(modifiedItem!.parameters.widthMm).toBe(modifiedWidth);
    const untouched = r2.items.find((i) => i.furniture_instance_id === track.furnitureInstanceIds[0]);
    expect(untouched!.parameters.widthMm).toBe(600);
    for (const item of r2.items) {
      const widthMm = item.furniture_instance_id === track.furnitureInstanceIds[2] ? modifiedWidth : 600;
      expectExactDimensions(item.parameters, widthMm);
      expectQuotedChoices(item.furniture_instance_id, 'R2', item.material_choices);
      expectPresentationSnapshot(item, GOLD_MODULE_RENAMED, ' v2', widthMm);
    }

    // Web readback shows both revisions of the exact lineage.
    await loginToA(page);
    await page.goto(`/quotes/${PROJECT_ID}/disenos`);
    await expect(page.getByTestId('project-designs-workspace')).toBeVisible();
    await page.getByRole('tab', { name: 'Cocina Dorada — Diseño' }).click();
    await expect(page.getByTestId('revision-node-R1')).toBeVisible();
    await expect(page.getByTestId('revision-node-R2')).toBeVisible();
    await page.getByTestId('revision-node-R1').click();
    await expect(page.getByTestId('revision-inspector')).toBeVisible();
  });

  // ------------------------------------------------------------------
  // Stage 9 — Approval of the EXACT R2 through the canonical production
  // approval command (#502 commercial gate): R2 changed quoted reality, so
  // the gate first REJECTS the outdated Q1 baseline, the scenario requotes
  // explicitly (Q2 ← R2), accepts it, and only then approves R2 against
  // the exact Q2.
  // ------------------------------------------------------------------
  test('stage 9 — exact R2 approved against exact Q2 after explicit requote', async () => {
    test.setTimeout(60_000);

    // The #502 gate: approving R2 against the now-outdated Q1 must fail.
    let outdatedRejected = false;
    try {
      await client.approveProjectDesignRevisionForProduction(
        owner.token, PROJECT_ID, track.designId, track.r2Id,
        { quoteRevisionId: track.quoteRevisionId }, 'golden-approve-r2-outdated',
      );
    } catch (error) {
      outdatedRejected = String(error).includes('la línea base comercial está desactualizada')
        || String(error).includes('commercial baseline is outdated');
    }
    expect(outdatedRejected, 'approval against outdated Q1 baseline must be rejected by the #502 gate').toBe(true);

    // Explicit re-quote: Q2 incorporates the R2 change for the exact unit.
    const requote = await client.requoteProjectQuote(owner.token, PROJECT_ID, {
      baseQuoteRevisionId: track.quoteRevisionId,
      designRevisionId: track.r2Id,
      includeFurnitureInstanceIds: [track.furnitureInstanceIds[2]!],
    }, 'golden-requote-q2');
    track.q2Id = requote.quoteRevision.id;
    expect(requote.quoteRevision.revisionNumber).toBe(2);
    expect(requote.quoteRevision.status).toBe('draft');
    expect((await client.publishProjectQuoteRevision(owner.token, PROJECT_ID, track.q2Id, 'golden-q2-publish')).status).toBe('published');
    expect((await client.acceptProjectQuoteRevision(owner.token, PROJECT_ID, track.q2Id, 'golden-q2-accept')).status).toBe('accepted');

    // #571 semantics: accepting Q2 atomically supersedes Q1 — exactly one
    // accepted commercial baseline per project at any time.
    const q1 = revisionById(await client.listProjectQuoteRevisions(owner.token, PROJECT_ID), track.quoteRevisionId, 'Q1') as unknown as { status: string };
    expect(q1.status).toBe('superseded');

    const approved = await client.approveProjectDesignRevisionForProduction(
      owner.token,
      PROJECT_ID,
      track.designId,
      track.r2Id,
      { quoteRevisionId: track.q2Id },
      'golden-approve-r2-q2',
    ) as unknown as { id: string; status: string; approved_at: string | null; approved_by: string | null };
    expect(approved.id).toBe(track.r2Id);
    expect(approved.status).toBe('approved');
    expect(approved.approved_at ?? null).toBeTruthy();
    expect(approved.approved_by ?? null).toBeTruthy();

    // Exact readback, never "latest".
    const readback = revisionById(await client.listDesignRevisions(owner.token, track.designId), track.r2Id, 'R2') as unknown as { status: string };
    expect(readback.status).toBe('approved');
    // R1 stays published (never implicitly approved with R2).
    const r1 = revisionById(await client.listDesignRevisions(owner.token, track.designId), track.r1Id, 'R1') as unknown as { status: string };
    expect(r1.status).toBe('published');
  });

  // ------------------------------------------------------------------
  // Stage 10 — ProductionRelease pinned to the exact approved revision and
  // exact accepted quote; physical identities preserved in the frozen
  // execution units. The lane ENDS here — no machine adapters.
  // ------------------------------------------------------------------
  test('stage 10 — ProductionRelease pinned to exact revisions with frozen snapshot', async () => {
    test.setTimeout(120_000);
    const apiBase = required('ORGANIZATION_API_BASE');

    // #642: commercial acceptance lives in the exact QuoteRevision. Accepting
    // Q2 never rewrote Project.status (recorded at stage 1), and the release
    // below runs ENTIRELY against the draft operational project — no legacy
    // Project.status = accepted is written as golden-path preparation.
    const repository = new APIWorkspaceRepository(apiBase, { getAccessToken: () => owner.token });
    const stored = (await repository.getProjects()).find((p) => p.id === PROJECT_ID)!;
    expect(stored.status).toBe('draft');

    const release = await client.createProductionRelease(owner.token, PROJECT_ID, {
      design_revision_id: track.r2Id,
      quote_revision_id: track.q2Id,
    }, 'golden-release-1');
    track.productionReleaseId = release.id;
    expect(release.design_revision_id).toBe(track.r2Id);
    expect(release.design_revision_number).toBe(2);
    expect(release.quote_revision_id ?? null).toBe(track.q2Id);
    expect(release.release_number).toBe(1);
    expect(release.status).toBe('active');
    expect(release.manufacturing_fingerprint).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(release.released_by).toBeTruthy();

    // Exact readback, stable identity: GET by id replays the same row.
    const readback = await client.getProjectProductionRelease(owner.token, PROJECT_ID, track.productionReleaseId);
    expect(readback.id).toBe(track.productionReleaseId);
    expect(readback.design_revision_id).toBe(track.r2Id);
    const list = await client.listProjectProductionReleases(owner.token, PROJECT_ID);
    expect(list.map((r) => r.id)).toEqual([track.productionReleaseId]);

    // Frozen manufacturing snapshot: exact PartExecutions derived from the
    // release (empty client body — client payloads are refused), one unit
    // per FurnitureInstance, every piece stamped with the exact release.
    const headers = { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' };
    const generation = await fetch(`${apiBase}/projects/${PROJECT_ID}/part-executions`, {
      method: 'PUT', headers, body: JSON.stringify({}),
    });
    expect(generation.status).toBe(200);
    const generated = (await generation.json()) as {
      part_instances: Array<{ id: string; production_revision: string }>;
      module_units: Array<{ id: string; production_revision: string }>;
    };
    expect(generated.module_units.map((u) => u.id).sort()).toEqual(
      track.furnitureInstanceIds.map((fi) => `${track.productionReleaseId}:${fi}:u1`).sort(),
    );
    for (const unit of generated.module_units) {
      expect(unit.production_revision).toBe(track.productionReleaseId);
    }
    // Board-bearing structure: 3 frozen pieces per unit (1 frente + 2 interiores).
    expect(generated.part_instances).toHaveLength(9);
    for (const instanceId of track.furnitureInstanceIds) {
      expect(generated.part_instances.filter((p) => p.id.startsWith(`${track.productionReleaseId}:${instanceId}:`))).toHaveLength(3);
    }

    // The release projection is canonical and frozen-routing backed.
    const detail = (await (await fetch(`${apiBase}/projects/${PROJECT_ID}`, { headers })).json()) as {
      status?: string;
      production_release?: unknown;
      resolved_production_release?: { source: string; release_id: string; design_revision_id: string; frozen_routing: boolean };
    };
    expect(detail.resolved_production_release?.source).toBe('canonical');
    expect(detail.resolved_production_release?.release_id).toBe(track.productionReleaseId);
    expect(detail.resolved_production_release?.design_revision_id).toBe(track.r2Id);
    expect(detail.resolved_production_release?.frozen_routing).toBe(true);
    expect(detail.production_release ?? null).toBeNull();

    // #642 negative proof: a legacy 'accepted' Project.status alone authorizes
    // nothing. Stamping the operational status while the exact quote is
    // published-but-not-accepted must keep the release closed — regression
    // guard against the old Project.status-as-commercial-acceptance model.
    const stampedProject = (await repository.getProjects()).find((p) => p.id === PROJECT_ID)!;
    await repository.saveProject({ ...stampedProject, status: 'accepted' });

    // A REAL pending commercial change (width 650 → 700 on the golden unit)
    // grounds quote Q3 through the supported requote command; it is published
    // but deliberately NOT accepted.
    await client.updateDesignWorkingCopy(owner.token, track.designId, {
      source_type: 'sketchup',
      items: track.furnitureInstanceIds.map((instanceId, index) => ({
        furniture_instance_id: instanceId,
        furniture_definition_id: GOLD_MODULE,
        parameters: { widthMm: index === 2 ? 700 : 600, heightMm: 720, depthMm: 590 },
        material_choices: { ...(index === 2 ? CHOICES_B : CHOICES_A) },
        transform: { translation_mm: [index * 600, 0, 0], rotation_deg: [0, 0, 0] },
      })),
    });
    const r3 = await publishViaSketchUpContract(client, owner.token, track.designId, track.furnitureInstanceIds, track.r2Id, 'golden-publish-r3');
    const requoteQ3 = await client.requoteProjectQuote(owner.token, PROJECT_ID, {
      baseQuoteRevisionId: track.q2Id,
      designRevisionId: r3.id,
      includeFurnitureInstanceIds: [track.furnitureInstanceIds[2]!],
    }, 'golden-requote-q3');
    expect(requoteQ3.quoteRevision.status).toBe('draft');
    expect((await client.publishProjectQuoteRevision(owner.token, PROJECT_ID, requoteQ3.quoteRevision.id, 'golden-q3-publish')).status).toBe('published');
    let legacyStatusRejected = false;
    try {
      await client.createProductionRelease(owner.token, PROJECT_ID, {
        design_revision_id: track.r2Id,
        quote_revision_id: requoteQ3.quoteRevision.id,
      }, 'golden-release-negative');
    } catch (error) {
      legacyStatusRejected = (error as { status?: number }).status === 409
        && String(error).includes('la cotización base no está aceptada');
    }
    expect(legacyStatusRejected, 'Project.status=accepted must NOT authorize a release over a non-accepted quote').toBe(true);

    // Restore the honest operational state: the golden path never needed the
    // legacy stamp, and the exact Q2/R2/P1 pins survive the round-trip.
    const stamped = (await repository.getProjects()).find((p) => p.id === PROJECT_ID)!;
    await repository.saveProject({ ...stamped, status: 'draft' });
    const restored = (await repository.getProjects()).find((p) => p.id === PROJECT_ID)!;
    expect(restored.status).toBe('draft');
    const releasesAfterNegative = await client.listProjectProductionReleases(owner.token, PROJECT_ID);
    expect(releasesAfterNegative.map((r) => r.id)).toEqual([track.productionReleaseId]);

    // Final truth ledger: lifecycle values read directly from their owners.
    const quotes = await client.listProjectQuoteRevisions(owner.token, PROJECT_ID);
    const q1 = revisionById(quotes, track.quoteRevisionId, 'Q1') as unknown as { status: string };
    const q2 = revisionById(quotes, track.q2Id, 'Q2') as unknown as { status: string };
    // The published-not-accepted Q3 never disturbed the accepted baseline.
    expect(q2.status).toBe('accepted');
    const revisions = await client.listDesignRevisions(owner.token, track.designId);
    const r1 = revisionById(revisions, track.r1Id, 'R1') as unknown as { status: string };
    const r2 = revisionById(revisions, track.r2Id, 'R2') as unknown as { status: string };
    note(`truth: Project.status=${restored.status} / QuoteRevision(Q1).status=${q1.status} / QuoteRevision(Q2).status=${q2.status} / DesignRevision(R1).status=${r1.status} / DesignRevision(R2).status=${r2.status} / ProductionRelease(P1).status=${release.status}`);
    note(`provenance: ${JSON.stringify(provenance)}`);
    note(`ids: project=${track.projectId} Q1=${track.quoteRevisionId} Q2=${track.q2Id} instances=[${track.furnitureInstanceIds.join(', ')}] design=${track.designId} R1=${track.r1Id} R2=${track.r2Id} release=${track.productionReleaseId}`);
    note(`findings total: ${findings.length}`);
  });
});
