import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

/**
 * #989 aceptación browser — real browser E2E (Chromium + Go + PostgreSQL, sin
 * mocks): la verdad comercial de un proyecto cuyo herraje viene SÓLO de
 * joinery por perfil (asignación → perfil pineado → contactos verificados),
 * con números a mano en el navegador — no sólo "no explota".
 *
 * Qué prueba cada test (estado del producto hoy, post #642/#1124/#974):
 *
 * 1. NO-INVENCIÓN: un proyecto sobre catálogo gobernado (asignaciones +
 *    release + binding) cuyo diseño NUNCA fue colocado en SketchUp congela
 *    herrajes $0 y venta $100 — las dims colocadas viven sólo en la working
 *    copy del host, fuera del contrato de la unidad no hay demanda, y ni la
 *    cotización ni el preview inventan hardware. Skip contract fail-closed
 *    visible en el navegador, con números exactos.
 *
 * 2. Preview HONESTO: la proyección comercial del screen de Diseño (la misma
 *    proyección servida que renderiza el HUD del plugin) para un diseño web
 *    sin SketchUp: status incomplete con issue working_copy_empty y SIN
 *    montos — nunca un $0 silencioso. La paridad preview ≡ cotización CON
 *    números necesita el diseño colocado en SketchUp (camino host, fuera del
 *    alcance browser); la derivación y freeze de la demanda colocada ya está
 *    probada lado servidor en PostgreSQL real por quote_profile_demand_test.go.
 *
 * 3. Regresión clásica: sin joinery gobernado, la Q1 es la línea manual
 *    ($20 × 1.5 + 100 = 130) — la gobernanza ausente no altera el camino
 *    existente.
 *
 * Materiales a costo 0 y MO fija 100 al margen 1.5 → venta = herrajes × 1.5
 * + 100, números legibles en las aserciones.
 */

const PD_SIDE_L = '88990000-0000-4000-8000-000000000001';
const PD_SIDE_R = '88990000-0000-4000-8000-000000000002';
const PD_SHELF = '88990000-0000-4000-8000-000000000003';
const PD_STRUCTURE = '88990000-0000-4000-8000-000000000011';
const PD_MODULE = '88990000-0000-4000-8000-000000000021';
const PD_MATERIAL = '88990000-0000-4000-8000-000000000031';
const PD_GROUP = '88990000-0000-4000-8000-000000000041';
const PD_CUSTOMER = '88990000-0000-4000-8000-000000000061';
const PD_PROJECT = '88990000-0000-4000-8000-000000000101';
const PD_LINE = '88990000-0000-4000-8000-000000000102';
const PD_HW_REG = '88990000-0000-4000-8000-000000000051';
const PD_MODULE_REG = '88990000-0000-4000-8000-000000000022';
const PD_PROJECT_REG = '88990000-0000-4000-8000-000000000201';
const PD_LINE_REG = '88990000-0000-4000-8000-000000000202';
const REG_HW_COST = 20;

const apiBase = required('ORGANIZATION_API_BASE');

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
  // Guarded catalog writes (#1096): learn the server version first (404 keeps
  // the POST-create fallback), then PUT under If-Match.
  const learn = await authedFetch(token, pathById);
  if (learn.ok) {
    const current = (await learn.json()) as { version?: number };
    const put = await authedFetch(token, pathById, {
      method: 'PUT',
      headers: { 'If-Match': `"v${current.version}"` },
      body: JSON.stringify(body),
    });
    if (put.ok) return;
    const errText = await put.text().catch(() => '');
    throw new Error(`PUT ${pathById}: ${put.status} ${errText}`);
  }
  if (learn.status !== 404 && learn.status !== 405) {
    const errText = await learn.text().catch(() => '');
    throw new Error(`GET ${pathById}: ${learn.status} ${errText}`);
  }
  const created = await authedFetch(token, collection, { method: 'POST', body: JSON.stringify(body) });
  if (!created.ok) {
    throw new Error(`POST ${collection}: ${created.status} ${await created.text().catch(() => '')}`);
  }
}

async function loginToA(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_A_OWNER_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const tour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await tour.isVisible()) await tour.getByRole('button', { name: 'Omitir' }).click();
}

/** Governed cabinet (definition-default): dos laterales + entrepaño con el
 * binding de fijaciones (3 estaciones por defecto) en el módulo. */
async function seedGovernedCatalog(token: string): Promise<void> {
  const board = (extra: Record<string, unknown>) => ({
    length_mm: 684, width_mm: 560, length_formula: '', width_formula: '',
    x_formula: '', y_formula: '', z_formula: '',
    rotate_x: null, rotate_y: null, rotate_z: null,
    default_edges: [], notes: '', active: true,
    ...extra,
  });
  await upsert(token, `/catalog/components/${PD_SIDE_L}`, '/catalog/components', board({
    id: PD_SIDE_L, code: 'PD-LAT', name: 'Preview lateral izq', placement: 'lateral_izquierdo',
    geometry_kind: 'rectangular_board', thickness_mm: 18,
    length_formula: 'PH - 2*T', width_formula: 'PD', option_roles: ['BODY-PD'],
  }));
  await upsert(token, `/catalog/components/${PD_SIDE_R}`, '/catalog/components', board({
    id: PD_SIDE_R, code: 'PD-LATD', name: 'Preview lateral der', placement: 'lateral_derecho',
    geometry_kind: 'rectangular_board', thickness_mm: 18,
    length_formula: 'PH - 2*T', width_formula: 'PD', option_roles: ['BODY-PD'],
  }));
  await upsert(token, `/catalog/components/${PD_SHELF}`, '/catalog/components', board({
    id: PD_SHELF, code: 'PD-ENTRE', name: 'Preview entrepaño', placement: 'interno',
    geometry_kind: 'rectangular_board', thickness_mm: 18,
    length_formula: 'PW - 2*T', width_formula: 'PD - T', option_roles: ['BODY-PD'],
  }));
  await upsert(token, `/catalog/structures/${PD_STRUCTURE}`, '/catalog/structures', {
    id: PD_STRUCTURE, code: 'PD-CUERPO', name: 'Cuerpo Preview',
    components: [
      { componentId: PD_SIDE_L, quantity: 1 },
      { componentId: PD_SIDE_R, quantity: 1 },
      { componentId: PD_SHELF, quantity: 1 },
    ],
  });
  // The definition's OWN binding with its station default of 3 — the same
  // definition-default demand quote_profile_demand_test.go froze (2 contactos
  // × 3 estaciones = 6+6 por unidad).
  const binding = [{
    name: 'shelfJoints', label: 'Fijaciones de entrepaño', type: 'number',
    defaultValue: 3, required: true, integer: true, unit: 'count',
    category: 'configuration',
    binding: {
      version: 1, kind: 'structureRelationship', componentId: PD_SHELF,
      relationship: {
        kind: 'fixed-shelf-side', sourceRole: 'shelf-edge',
        targets: [
          { componentId: PD_SIDE_L, role: 'side', face: 'front' },
          { componentId: PD_SIDE_R, role: 'side', face: 'back' },
        ],
        station: { startMarginMm: 40, endMarginMm: 40 },
      },
    },
  }];
  await upsert(token, `/catalog/modules/${PD_MODULE}`, '/catalog/modules', {
    id: PD_MODULE, code: 'PD-GAB', name: 'Gabinete Preview Demand',
    base_labor_cost: 0, width_mm: 600, height_mm: 720, depth_mm: 560,
    categoryId: '', structure_id: PD_STRUCTURE, furniture_type: '', base_mode: '',
    base_clearance_mm: null, components: [], agregados: [], presets: [],
    image_url: '', notes: '', hardware_lines: [], parameter_definitions: binding,
  });
}

/** Crea el diseño desde la UI y devuelve su id. */
async function createDesign(page: Page, projectId: string, name: string): Promise<string> {
  await page.goto(`/quotes/${projectId}/disenos`);
  await page.getByRole('button', { name: 'Crear primer diseño' }).click();
  await page.getByLabel(/Nombre de la alternativa/i).fill(name);
  const designResponse = page.waitForResponse((r) => r.request().method() === 'POST' &&
    new URL(r.url()).pathname === `/api/projects/${projectId}/designs`);
  await page.getByTestId('submit-create-design').click();
  const created = await designResponse;
  expect(created.status()).toBe(201);
  const design = (await created.json()) as { id: string; project_id: string };
  expect(design.project_id).toBe(projectId);
  return design.id;
}

interface ProjectionBody {
  status: 'current' | 'incomplete';
  pricingAuthority: string;
  amounts?: { saleTotal?: number };
  issues?: string[];
}

async function fetchProjection(token: string, projectId: string, designId: string): Promise<ProjectionBody> {
  const res = await authedFetch(token, `/projects/${projectId}/designs/${designId}/commercial-projection`);
  expect(res.ok, `projection: ${res.status}`).toBe(true);
  return (await res.json()) as ProjectionBody;
}

interface FrozenSnapshot {
  commercialSnapshot?: {
    breakdown?: { hardwareTotal?: number; salePrice?: number };
  };
}

test.describe.serial('#989 — verdad comercial con demanda gobernada y preview honesto', () => {
  let owner!: { token: string };
  let client!: GraneteApiClient;
  let repository!: APIWorkspaceRepository;
  let minifixCost = 0;
  let tarugoCost = 0;

  test.beforeAll(async () => {
    client = new GraneteApiClient(apiBase);
    owner = await client.login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    repository = new APIWorkspaceRepository(apiBase, { getAccessToken: () => owner.token });

    // 1. Commercial scaffold via saveCatalog (materiales $0, grupo requerido,
    // cliente, herraje y módulo del camino de regresión) — ANTES del seed:
    // el mapper TS valida el catálogo estricto y las filas demo que /seed
    // agrega después (hardware_lines de demo sin option_role) no pasan ese
    // validador; el camino raw de abajo no pasa por él.
    const catalog = await repository.getCatalog();
    await repository.saveCatalog({
      ...catalog,
      materials: [
        ...(catalog.materials ?? []).filter((m) => m.id !== PD_MATERIAL),
        {
          id: PD_MATERIAL, code: 'PD-MAT', name: 'Tablero Preview $0',
          widthMm: 2750, lengthMm: 1850, thicknessMm: 18,
          grainDefault: false, boardPrice: 0, wastePercent: 0, costPerM2: 0,
          active: true,
        },
      ],
      optionGroups: [
        ...catalog.optionGroups.filter((g) => g.id !== PD_GROUP),
        {
          id: PD_GROUP, code: 'BODY-PD', name: 'Cuerpo Preview',
          kind: 'board', required: true, optionIds: [PD_MATERIAL],
        },
      ],
      customers: [
        ...(catalog.customers ?? []).filter((c) => c.id !== PD_CUSTOMER),
        { id: PD_CUSTOMER, name: 'Cliente Preview Demand', active: true },
      ],
      hardware: [
        ...(catalog.hardware ?? []).filter((h) => h.id !== PD_HW_REG),
        { id: PD_HW_REG, code: 'PD-HW-REG', name: 'Herraje regresión', unit: 'piece', costPerUnit: REG_HW_COST, active: true },
      ],
      modules: [
        ...catalog.modules.filter((m) => m.id !== PD_MODULE_REG),
        {
          id: PD_MODULE_REG,
          code: 'PD-REG',
          name: 'Módulo Regresión',
          externalDims: { width: 700, height: 400, depth: 18 },
          components: [],
          hardwareLines: [{ id: 'pd-reg-hw-line', hardwareId: PD_HW_REG, quantity: 1, optionRole: '' }],
        },
      ],
    });

    // 2. Demo profile per org + REAL Standard release publication — the same
    // seed hardware-profile-demo proved end to end (6+6 por 3 estaciones × 2
    // contactos). Va DESPUÉS del scaffold validado (ver arriba).
    const seeded = await authedFetch(owner.token, '/seed', { method: 'POST' });
    expect(seeded.ok, `seed: ${seeded.status}`).toBe(true);
    const { profileId: provisionedProfileId } = (await seeded.json()) as { profileId: string };
    expect(provisionedProfileId).toBeTruthy();

    // 3. Governed cabinet (las asignaciones van después del sanado de perfil).
    await seedGovernedCatalog(owner.token);

    // 4. Los costos del seed (números a mano, resueltos por código estable).
    const hardwareList = await (await authedFetch(owner.token, '/catalog/hardware', {})).json() as Array<{ id: string; code: string; cost_per_unit: number }>;
    const byCode = new Map(hardwareList.map((hw) => [hw.code, hw]));
    minifixCost = byCode.get('HER-MIN-15')?.cost_per_unit ?? 0;
    tarugoCost = byCode.get('HER-TAQ-8X30')?.cost_per_unit ?? 0;
    expect(minifixCost).toBeGreaterThan(0);
    expect(tarugoCost).toBeGreaterThan(0);

    // Auto-sanado: specs previos del mismo shard comparten la org y pueden
    // dejar TODOS los perfiles inactivos (library-publish-gate los desactiva
    // y puede fallar antes de su recuperación; la desactivación es one-way —
    // el PUT preserva el flag activo). La asignación exige un perfil activo:
    // si el provisto no lo está, se crea uno mínimo. La prueba de no-invención
    // no depende de la receta: sin dims colocadas no hay derivación que correr.
    let assignmentProfileId = provisionedProfileId;
    const provisionedProfile = await client.getHardwareProfile(owner.token, provisionedProfileId);
    if (!provisionedProfile.active) {
      const healed = await client.createHardwareProfile(owner.token, {
        code: `PD-HEAL-${crypto.randomUUID().slice(0, 8)}`,
        name: 'Perfil sanado para asignación',
        revision: 'r1',
        items: [{ hardwareId: byCode.get('HER-MIN-15')!.id, quantity: 1, applicationRole: 'cam' }],
      });
      assignmentProfileId = healed.id;
    }

    for (const [componentId, side] of [[PD_SIDE_L, 'front'], [PD_SIDE_R, 'back']] as const) {
      const put = await authedFetch(owner.token, `/catalog/components/${componentId}/side-assignments`, {
        method: 'PUT',
        body: JSON.stringify({ side, profileId: assignmentProfileId }),
      });
      expect(put.ok, `assignment ${side}: ${put.status}`).toBe(true);
    }

    // 5. Proyecto con demanda (dims explícitas: el contrato de skip del
    // resolve las exige) + proyecto de regresión sin joinery.
    const now = new Date().toISOString();
    await repository.saveProject({
      id: PD_PROJECT,
      name: 'Preview Demand E2E',
      customerId: PD_CUSTOMER,
      currency: 'MXN',
      marginFactor: 1.5,
      laborFixedCost: 100,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      items: [{
        id: PD_LINE,
        moduleId: PD_MODULE,
        quantity: 1,
        optionChoices: { 'BODY-PD': PD_MATERIAL },
        customDims: { widthMm: 600, heightMm: 720, depthMm: 560 },
      }],
    });
    await repository.saveProject({
      id: PD_PROJECT_REG,
      name: 'Preview Regresión E2E',
      customerId: PD_CUSTOMER,
      currency: 'MXN',
      marginFactor: 1.5,
      laborFixedCost: 100,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      items: [{
        id: PD_LINE_REG,
        moduleId: PD_MODULE_REG,
        quantity: 1,
        optionChoices: {},
      }],
    });
  });

  test('un diseño nunca colocado no inventa demanda: la Q1 congela herrajes $0 sin mentir', async ({ page }) => {
    test.setTimeout(180_000);
    await loginToA(page);

    // Q1 desde la UI (reconciliación → emitir): el mismo gesto real del ciclo
    // prequote. El catálogo está gobernado (asignaciones + release + binding
    // con 3 estaciones) pero el diseño jamás fue colocado en SketchUp: no hay
    // dims colocadas, no hay unidad en el contrato, no hay demanda.
    await page.goto(`/quotes/${PD_PROJECT}/reconciliacion`);
    await expect(page.getByTestId('create-initial-quote-btn')).toBeVisible({ timeout: 20_000 });
    const q1Response = page.waitForResponse((r) => r.request().method() === 'POST' &&
      new URL(r.url()).pathname === `/api/projects/${PD_PROJECT}/quote-revisions`);
    await page.getByTestId('create-initial-quote-btn').click();
    const q1 = await q1Response;
    if (q1.status() !== 201) {
      const error = await q1.json() as { code?: string; message?: string; details?: { reason?: string } };
      throw new Error(`Q1 status=${q1.status()} code=${error.code ?? 'missing'} reason=${error.details?.reason ?? 'missing'}`);
    }
    const q1Body = await q1.json() as { id: string; revisionNumber: number };

    // La verdad congelada: herrajes 0 (nada colocado → nada derivado, nunca
    // inventado) y venta = 0 × 1.5 + 100 de MO fija.
    const revisions = await client.listProjectQuoteRevisions(owner.token, PD_PROJECT);
    const frozen = revisions.find((r) => r.id === q1Body.id);
    const snapshot = (frozen as unknown as FrozenSnapshot)?.commercialSnapshot;
    expect(snapshot?.breakdown?.hardwareTotal).toBeCloseTo(0, 6);
    expect(snapshot?.breakdown?.salePrice).toBeCloseTo(100, 6);

    // La pantalla de cotización muestra esos números congelados.
    await page.goto(`/quotes/${PD_PROJECT}`);
    const totals = page.locator('.project-totals');
    await expect(totals).toContainText('Herrajes$0.00', { timeout: 20_000 });
    await expect(totals).toContainText('$100.00');
  });

  test('el preview de un diseño web sin SketchUp es honesto: incomplete, sin montos, sin $0 silencioso', async ({ page }) => {
    test.setTimeout(120_000);
    await loginToA(page);

    const designId = await createDesign(page, PD_PROJECT, 'Diseño preview honesto');

    // La working copy es verdad colocada del host (#974): un diseño creado en
    // web, sin SketchUp, no tiene unidades colocadas y la proyección lo dice.
    const projection = await fetchProjection(owner.token, PD_PROJECT, designId);
    expect(projection.pricingAuthority).toBe('calc-project-breakdown');
    expect(projection.status).toBe('incomplete');
    expect(projection.issues ?? []).toContain('working_copy_empty');
    expect(projection.amounts?.saleTotal).toBeUndefined();

    // Y el panel lo comunica con su copy de datos faltantes — no un total.
    await page.goto(`/quotes/${PD_PROJECT}/disenos`);
    await expect(page.getByTestId('commercial-projection-panel')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('commercial-projection-panel')).toContainText('Estimación informativa; no crea ni modifica una cotización');
    await expect(page.getByTestId('commercial-projection-panel')).toContainText('Faltan datos para completar este estimado');
  });

  test('sin joinery gobernado la Q1 es la línea manual clásica (regresión)', async ({ page }) => {
    test.setTimeout(120_000);
    const saleReg = REG_HW_COST * 1.5 + 100;
    const q1 = await client.createInitialProjectQuoteRevision(owner.token, PD_PROJECT_REG, {
      notes: 'PD — regresión sin demanda',
    }, `pd-q1-create-${PD_PROJECT_REG}`);
    expect(q1.revisionNumber).toBe(1);
    const revisions = await client.listProjectQuoteRevisions(owner.token, PD_PROJECT_REG);
    const frozen = revisions.find((r) => r.id === q1.id);
    const snapshot = (frozen as unknown as FrozenSnapshot)?.commercialSnapshot;
    expect(snapshot?.breakdown?.hardwareTotal).toBeCloseTo(REG_HW_COST, 6);
    expect(snapshot?.breakdown?.salePrice).toBeCloseTo(saleReg, 6);
  });
});
