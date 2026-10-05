import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { putWorkingCopyCurrent, required } from './support/api';

const STRUCTURE_ID = '89800000-0000-4000-8000-000000000001';
const HARDWARE_ID = '89800000-0000-4000-8000-000000000002';
const MATERIAL_ID = '89800000-0000-4000-8000-000000000003';
const EDGE_ID = '89800000-0000-4000-8000-000000000004';
const COMPONENT_ID = '89800000-0000-4000-8000-000000000005';
const BODY_GROUP_ID = '89800000-0000-4000-8000-000000000006';
const ZOCLO_GROUP_ID = '89800000-0000-4000-8000-000000000007';
const PATAS_GROUP_ID = '89800000-0000-4000-8000-000000000008';
const PRESET_ID = '89800000-0000-4000-8000-000000000009';
const MODULE_ID = '89800000-0000-4000-8000-000000000010';
const MODULE_CODE = 'DISCOVERY-P1';
const BODY_ROLE = 'DISCOVERY-P1-BODY';
const WIDTH_R1_MM = 600;
const WIDTH_R2_MM = 650;
const HEIGHT_MM = 720;
const BASE_CLEARANCE_MM = 100;
const PROJECT_NAME = 'Obra descubrimiento P1 E2E';
const CUSTOMER_NAME = 'Cliente descubrimiento P1 E2E';
const DESIGN_NAME = 'Diseño descubrimiento P1 E2E';

async function prepareCatalog(): Promise<number> {
  const apiBase = required('ORGANIZATION_API_BASE');
  const owner = await new GraneteApiClient(apiBase).login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  const repository = new APIWorkspaceRepository(apiBase, { getAccessToken: () => owner.token });
  const catalog = await repository.getCatalog();
  const template = catalog.modules.find((module) => module.code === 'GATE-A') ?? catalog.modules[0]!;
  const depthMm = template.externalDims?.depth || 590;
  const dimensions = { width: WIDTH_R1_MM, height: HEIGHT_MM, depth: depthMm };
  const isolatedCatalogWrite = () => ({
    ...catalog,
    materials: [], edges: [], hardware: [], optionGroups: [], modules: [],
    structures: [], components: [], agregados: [], categories: [], customers: [],
    ambientMaterials: [], ambientCategories: [], materialCategories: [],
  });

  // Catalog persistence writes materials before edge bands. Establish the
  // referenced edge first so the material's defaultEdgeBandId satisfies the
  // real PostgreSQL foreign key rather than weakening the fixture.
  await repository.saveCatalog({
    ...isolatedCatalogWrite(),
    edges: [{
      id: EDGE_ID,
      code: 'DISCOVERY-P1-EDGE',
      name: 'Discovery P1 edge',
      thicknessMm: 1,
      costPerMl: 4,
      active: true,
    }],
  });

  await repository.saveCatalog({
    ...isolatedCatalogWrite(),
    materials: [{
        id: MATERIAL_ID,
        code: 'DISCOVERY-P1-BOARD',
        name: 'Discovery P1 board',
        widthMm: 1830,
        lengthMm: 2440,
        thicknessMm: 18,
        grainDefault: true,
        boardPrice: 125,
        wastePercent: 5,
        costPerM2: 125,
        defaultEdgeBandId: EDGE_ID,
        active: true,
      }],
    edges: [{
        id: EDGE_ID,
        code: 'DISCOVERY-P1-EDGE',
        name: 'Discovery P1 edge',
        thicknessMm: 1,
        costPerMl: 4,
        active: true,
      }],
    optionGroups: [
      { id: BODY_GROUP_ID, code: BODY_ROLE, name: 'Discovery P1 body', kind: 'board' as const, required: true, optionIds: [MATERIAL_ID] },
      { id: ZOCLO_GROUP_ID, code: 'ZOCLO', name: 'Discovery P1 plinth', kind: 'board' as const, required: false, optionIds: [MATERIAL_ID] },
      { id: PATAS_GROUP_ID, code: 'PATAS', name: 'Discovery P1 legs', kind: 'hardware' as const, required: false, optionIds: [HARDWARE_ID] },
    ],
    structures: [{
        id: STRUCTURE_ID,
        code: 'DISCOVERY-P1-STRUCT',
        name: 'Discovery P1 structure',
        externalDims: dimensions,
        components: [{ componentId: COMPONENT_ID, quantity: 1 }],
        active: true,
      }],
    components: [{
        id: COMPONENT_ID,
        code: 'DISCOVERY-P1-PANEL',
        name: 'Discovery P1 panel',
        placement: 'interno' as const,
        geometry: {
          kind: 'rectangular_board' as const,
          lengthMm: depthMm,
          widthMm: WIDTH_R1_MM,
          thicknessMm: 18,
          lengthFormula: 'D',
          widthFormula: 'W',
        },
        defaultEdges: [
          { side: 'L1' as const, enabled: true },
          { side: 'L2' as const, enabled: false },
          { side: 'W1' as const, enabled: false },
          { side: 'W2' as const, enabled: false },
        ],
        optionRoles: [BODY_ROLE],
        active: true,
      }],
    hardware: [{
        id: HARDWARE_ID,
        code: 'DISCOVERY-P1-LEG',
        name: 'Discovery P1 adjustable leg',
        unit: 'piece',
        costPerUnit: 10,
        active: true,
      }],
    modules: [
      {
        ...template,
        id: MODULE_ID,
        code: MODULE_CODE,
        name: 'Discovery P1 module',
        structureId: STRUCTURE_ID,
        baseMode: 'plinth_board',
        baseClearanceMm: BASE_CLEARANCE_MM,
        components: [],
        hardwareLines: [{ id: 'discovery-p1-legs-line', quantity: 1, optionRole: 'PATAS' }],
        externalDims: dimensions,
        presets: [
          { id: PRESET_ID, name: 'Discovery P1 600', width: WIDTH_R1_MM, height: HEIGHT_MM, depth: depthMm },
        ],
      },
    ],
  });

  const persisted = await repository.getCatalog();
  expect(persisted.modules.find((module) => module.id === template.id)).toEqual(template);
  expect(persisted.modules.find((module) => module.id === MODULE_ID)).toMatchObject({
    id: MODULE_ID,
    code: MODULE_CODE,
    presets: [expect.objectContaining({ id: PRESET_ID, name: 'Discovery P1 600' })],
  });
  expect(persisted.edges.find((edge) => edge.id === EDGE_ID)).toMatchObject({ id: EDGE_ID, code: 'DISCOVERY-P1-EDGE' });
  expect(persisted.materials.find((material) => material.id === MATERIAL_ID)).toMatchObject({
    id: MATERIAL_ID,
    code: 'DISCOVERY-P1-BOARD',
    defaultEdgeBandId: EDGE_ID,
  });
  expect(persisted.optionGroups).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: BODY_GROUP_ID, code: BODY_ROLE, optionIds: [MATERIAL_ID] }),
    expect.objectContaining({ id: ZOCLO_GROUP_ID, code: 'ZOCLO', optionIds: [MATERIAL_ID] }),
    expect.objectContaining({ id: PATAS_GROUP_ID, code: 'PATAS', optionIds: [HARDWARE_ID] }),
  ]));

  return depthMm;
}

async function loginOwner(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_A_OWNER_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

async function readFrozenPricingContexts(
  projectId: string,
  organizationId: string,
  quoteRevisionId: string,
): Promise<Array<{ furnitureInstanceId: string; pricingContext: Record<string, unknown> }>> {
  const database = new Client({ connectionString: required('DATABASE_URL') });
  await database.connect();
  try {
    await database.query('BEGIN READ ONLY');
    await database.query(
      `SELECT set_config('app.organization_id', $1, true),
              set_config('app.authorized_organization_ids', $1, true),
              set_config('row_security', 'on', true)`,
      [organizationId],
    );
    const role = await database.query<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean; tenant: string }>(
      `SELECT current_user, rolsuper, rolbypassrls, current_setting('app.organization_id') AS tenant
         FROM pg_roles WHERE rolname = current_user`,
    );
    expect(role.rows[0]).toEqual({ current_user: 'granete_app', rolsuper: false, rolbypassrls: false, tenant: organizationId });
    const result = await database.query<{ units: Array<{ furnitureInstanceId: string; pricingContext: Record<string, unknown> }> }>(
      `SELECT commercial_snapshot->'units' AS units
         FROM quote_revisions
        WHERE id = $1 AND project_id = $2`,
      [quoteRevisionId, projectId],
    );
    return result.rows[0]?.units ?? [];
  } finally {
    await database.query('ROLLBACK').catch(() => undefined);
    await database.end();
  }
}

test('#642 discovers one UI-created draft project with canonical P1 on the production dashboard', async ({ page }) => {
  test.setTimeout(300_000);
  const depthMm = await prepareCatalog();
  const apiBase = required('ORGANIZATION_API_BASE');
  const client = new GraneteApiClient(apiBase);
  const owner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });

  await loginOwner(page);

  // Customer + Project are created through the normal React quote flow.
  await page.goto('/quotes');
  await page.getByRole('button', { name: 'Nueva cotización' }).first().click();
  const projectModal = page.getByRole('dialog', { name: 'Nueva cotización' });
  await projectModal.getByLabel('Nombre').fill(PROJECT_NAME);
  await projectModal.getByLabel('Nuevo cliente').check();
  await projectModal.getByRole('textbox', { name: 'Cliente', exact: true }).fill(CUSTOMER_NAME);
  const projectResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/api/projects'));
  await projectModal.getByRole('button', { name: 'Guardar' }).click();
  const projectResponse = await projectResponsePromise;
  expect(projectResponse.status()).toBe(201);
  const project = await projectResponse.json() as { id: string; organization_id: string };
  expect(project.id).toMatch(/^[0-9a-f-]{36}$/i);
  await page.getByTestId(`project-card-${project.id}`).click();

  // The quote line is also authored through React. Its exact preset, finish,
  // plinth and feet choices create two physical FurnitureInstances. The first
  // Design command materializes them but still sends no geometry.
  await page.getByRole('button', { name: 'Agregar mueble' }).click();
  const lineModal = page.getByRole('dialog', { name: 'Agregar mueble' });
  await lineModal.getByLabel('Mueble').click();
  await lineModal.locator(`#add-module-listbox-opt-${MODULE_ID}`).click();
  await lineModal.getByLabel('Cantidad').fill('2');
  await expect(lineModal.getByTestId('add-item-measure-preset')).toHaveValue(PRESET_ID);
  await expect(lineModal.getByLabel(/Discovery P1 body/)).toHaveValue(MATERIAL_ID);
  await expect(lineModal.getByLabel(/Discovery P1 plinth/)).toHaveValue(MATERIAL_ID);
  await lineModal.getByLabel(/Discovery P1 legs/).selectOption(HARDWARE_ID);
  await expect(lineModal.getByLabel(/Discovery P1 legs/)).toHaveValue(HARDWARE_ID);
  await lineModal.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(lineModal).not.toBeVisible();

  const editableProject = await (
    await fetch(`${apiBase}/projects/${project.id}`, { headers: { Authorization: `Bearer ${owner.token}` } })
  ).json() as {
    items: Array<{
      id: string;
      module_id: string;
      quantity: number;
      option_choices: Record<string, string>;
      measure_preset_id: string;
      base_mode: string;
    }>;
  };
  expect(editableProject.items).toHaveLength(1);
  const quoteLine = editableProject.items[0]!;
  expect(quoteLine).toMatchObject({
    module_id: MODULE_ID,
    quantity: 2,
    option_choices: { [BODY_ROLE]: MATERIAL_ID, ZOCLO: MATERIAL_ID, PATAS: HARDWARE_ID },
    measure_preset_id: PRESET_ID,
    base_mode: 'plinth_board',
  });

  await page.goto(`/quotes/${project.id}/disenos`);
  await page.getByRole('button', { name: 'Crear primer diseño' }).click();
  await page.getByLabel(/Nombre de la alternativa/i).fill(DESIGN_NAME);
  const designResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === `/api/projects/${project.id}/designs`);
  await page.getByTestId('submit-create-design').click();
  const designResponse = await designResponsePromise;
  expect(designResponse.status()).toBe(201);
  const designRequest = designResponse.request().postDataJSON() as Record<string, unknown>;
  expect(designRequest).toEqual({ name: DESIGN_NAME });
  expect(designRequest).not.toHaveProperty('items');
  expect(designRequest).not.toHaveProperty('geometry');
  const design = await designResponse.json() as { id: string; project_id: string };
  expect(design.project_id).toBe(project.id);

  const instances = await client.listProjectFurnitureInstances(owner.token, project.id);
  expect(instances).toHaveLength(2);
  expect(instances).toEqual(expect.arrayContaining([
    expect.objectContaining({
      project_id: project.id,
      furniture_definition_id: MODULE_ID,
      origin: 'quote',
      lifecycle_status: 'active',
    }),
    expect.objectContaining({
      project_id: project.id,
      furniture_definition_id: MODULE_ID,
      origin: 'quote',
      lifecycle_status: 'active',
    }),
  ]));
  const instanceIds = instances.map((instance) => instance.id).sort();
  expect(new Set(instanceIds).size).toBe(2);
  const emptyWorkingCopy = await client.getDesignWorkingCopy(owner.token, design.id);
  expect(emptyWorkingCopy.items).toEqual([]);

  // Canonical Q1 is created, published, and accepted through React before a
  // DesignRevision exists. Q lifecycle and DesignRevision publication are
  // deliberately separate commands.
  await page.goto(`/quotes/${project.id}/reconciliacion`);
  await expect(page.getByTestId('create-initial-quote-btn')).toBeVisible();
  await page.getByTestId('create-initial-quote-btn').click();
  const quoteSelect = page.getByTestId('quote-revision-select');
  await expect(quoteSelect.locator('option')).toHaveCount(1);
  const q1Id = await quoteSelect.locator('option').first().getAttribute('value');
  expect(q1Id).toMatch(/^[0-9a-f-]{36}$/i);

  await page.getByTestId('publish-quote-btn').click();
  await expect(page.getByTestId('quote-lifecycle-success')).toContainText('Revisión Q1 publicada');
  await page.getByTestId('accept-quote-btn').click();
  await expect(page.getByTestId('accept-quote-modal')).toBeVisible();
  await page.getByTestId('confirm-accept-quote-btn').click();
  await expect(page.getByTestId('quote-lifecycle-success')).toContainText('Revisión Q1 aceptada');

  const quotesAfterAccept = await client.listProjectQuoteRevisions(owner.token, project.id);
  const q1 = quotesAfterAccept.find((revision) => revision.id === q1Id);
  expect(q1).toMatchObject({ projectId: project.id, revisionNumber: 1, status: 'accepted' });
  expect(q1?.commercialSnapshot?.project).toMatchObject({ id: project.id, name: PROJECT_NAME });
  expect(q1?.commercialSnapshot?.customer.name).toBe(CUSTOMER_NAME);
  expect(q1?.items.map((item) => item.furnitureInstanceId).sort()).toEqual(instanceIds);
  expect(q1?.items).toEqual(expect.arrayContaining(instanceIds.map((instanceId) => expect.objectContaining({
    furnitureInstanceId: instanceId,
    furnitureDefinitionId: MODULE_ID,
    parameters: { widthMm: WIDTH_R1_MM, heightMm: HEIGHT_MM, depthMm },
    materialChoices: { [BODY_ROLE]: MATERIAL_ID, ZOCLO: MATERIAL_ID, PATAS: HARDWARE_ID },
  }))));
  expect(q1?.commercialSnapshot?.lines).toEqual([
    expect.objectContaining({
      quoteLineId: quoteLine.id,
      quantity: 2,
      furnitureInstanceIds: expect.arrayContaining(instanceIds),
      amounts: expect.objectContaining({
        materialsCost: expect.any(Number),
        hardwareTotal: expect.any(Number),
        directCost: expect.any(Number),
        salePrice: expect.any(Number),
      }),
    }),
  ]);
  const q1LineAmounts = q1!.commercialSnapshot!.lines[0]!.amounts;
  expect(q1LineAmounts.materialsCost).toBeGreaterThan(0);
  expect(q1LineAmounts.hardwareTotal).toBeGreaterThan(0);
  expect(q1LineAmounts.directCost).toBeGreaterThan(0);
  expect(q1LineAmounts.salePrice).toBeGreaterThan(0);
  expect(q1?.commercialSnapshot?.breakdown.salePrice).toBeGreaterThan(0);
  expect(q1?.commercialSnapshot?.units).toHaveLength(2);
  for (const unit of q1!.commercialSnapshot!.units) {
    expect(instanceIds).toContain(unit.furnitureInstanceId);
    expect(unit.quoteLineId).toBe(quoteLine.id);
    expect(unit.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ groupCode: BODY_ROLE, choiceId: MATERIAL_ID }),
      expect.objectContaining({ groupCode: 'ZOCLO', choiceId: MATERIAL_ID }),
      expect.objectContaining({ groupCode: 'PATAS', choiceId: HARDWARE_ID }),
    ]));
  }
  // PricingContext is internal and omitted from the public QuoteRevision DTO.
  // Read it through the actual granete_app runtime DSN under RLS, not through
  // the superuser fixture DSN.
  const q1PricingContexts = await readFrozenPricingContexts(project.id, project.organization_id, q1Id!);
  expect(q1PricingContexts.map((unit) => unit.furnitureInstanceId).sort()).toEqual(instanceIds);
  for (const unit of q1PricingContexts) {
    expect(unit.pricingContext).toMatchObject({
      measurePresetId: PRESET_ID,
      baseMode: 'plinth_board',
      baseClearanceMm: BASE_CLEARANCE_MM,
      structureRevisionPin: expect.any(Number),
    });
  }
  const catalogRepository = new APIWorkspaceRepository(apiBase, { getAccessToken: () => owner.token });
  const liveCatalog = await catalogRepository.getCatalog();
  const originalModule = liveCatalog.modules.find((module) => module.id === MODULE_ID)!;
  const saveModuleDefault = (baseMode: 'plinth_board' | 'legs') => catalogRepository.saveCatalog({
    ...liveCatalog, materials: [], edges: [], hardware: [], optionGroups: [], components: [],
    structures: [], agregados: [], categories: [], customers: [],
    ambientMaterials: [], ambientCategories: [], materialCategories: [],
    modules: [{ ...originalModule, baseMode }],
  });
  await saveModuleDefault('legs');
  expect((await catalogRepository.getCatalog())
    .modules.find((module) => module.id === MODULE_ID)?.baseMode).toBe('legs');
  expect(await client.listDesignRevisions(owner.token, design.id)).toEqual([]);

  // React does not author geometry yet. Use only the supported backend working
  // copy + publish commands to create canonical R1 for this exact UI-created FI.
  await putWorkingCopyCurrent(client, owner.token, design.id, {
    items: instanceIds.map((instanceId) => ({
        furniture_instance_id: instanceId,
        furniture_definition_id: MODULE_ID,
        parameters: { widthMm: WIDTH_R1_MM, heightMm: HEIGHT_MM, depthMm },
        material_choices: { [BODY_ROLE]: MATERIAL_ID, ZOCLO: MATERIAL_ID, PATAS: HARDWARE_ID },
      })),
  });
  const r1 = await client.publishDesignRevision(
    owner.token,
    design.id,
    { source_type: 'manual', base_revision_id: null },
    '642-production-discovery-publish-r1',
  );
  expect(r1).toMatchObject({ design_id: design.id, revision_number: 1, status: 'published' });
  expect(r1.items.map((item) => item.furniture_instance_id).sort()).toEqual(instanceIds);
  expect(r1.items).toEqual(expect.arrayContaining(instanceIds.map((instanceId) => expect.objectContaining({
    furniture_instance_id: instanceId,
    furniture_definition_id: MODULE_ID,
    parameters: { widthMm: WIDTH_R1_MM, heightMm: HEIGHT_MM, depthMm },
    material_choices: { [BODY_ROLE]: MATERIAL_ID, ZOCLO: MATERIAL_ID, PATAS: HARDWARE_ID },
  }))));

  // Pin the exact accepted Q1 + published R1. The authoritative quoted
  // preflight must be ready before approval and P1 creation are available.
  await page.goto(`/quotes/${project.id}/reconciliacion?qrev=${q1Id}&design=${design.id}&rev=${r1.id}`);
  await expect(page.getByTestId('project-reconciliation-workspace')).toBeVisible();
  await expect(page.getByTestId('quote-revision-select')).toHaveValue(q1Id!);
  await expect(page.getByTestId('design-select')).toHaveValue(design.id);
  await expect(page.getByTestId('design-revision-select')).toHaveValue(r1.id);
  await expect(page.getByTestId('preflight-status')).toContainText('Listo');
  await expect(page.getByTestId('reconciliation-next-action')).toContainText('comercialmente sincronizado con Q1');

  await expect(page.getByTestId('approve-revision-btn')).toBeEnabled();
  await expect(page.getByTestId('approve-revision-btn')).toContainText('Aprobar R1 para Q1');
  await page.getByTestId('approve-revision-btn').click();
  await expect(page.getByTestId('approval-success')).toContainText('R1 aprobada');

  await page.getByTestId('open-release-review-btn').click();
  const releaseModal = page.getByTestId('release-review-modal');
  await expect(releaseModal).toContainText('base comercial exacta');
  await expect(releaseModal).toContainText('Q1 · Aceptada');
  await expect(releaseModal).toContainText('R1');
  await expect(releaseModal).toContainText('Listo');
  const releaseResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === `/api/projects/${project.id}/production-releases`);
  await page.getByTestId('submit-release').click();
  const releaseResponse = await releaseResponsePromise;
  expect(releaseResponse.status(), await releaseResponse.text()).toBe(201);
  const release = await releaseResponse.json() as {
    id: string;
    project_id: string;
    design_revision_id: string;
    quote_revision_id: string;
    release_number: number;
    manufacturing_fingerprint: string;
  };
  expect(release).toMatchObject({
    project_id: project.id,
    design_revision_id: r1.id,
    quote_revision_id: q1Id,
    release_number: 1,
    manufacturing_fingerprint: expect.stringMatching(/^sha256-[0-9a-f]{64}$/),
  });

  // Although the live module default is now legs, exact Q1 authority must keep
  // P1 on plinth_board: each unit retains its ZOCLO-AUTO board below.
  const p1Demand = await client.getProjectProductionReleaseCuttingDemand(owner.token, project.id, release.id);
  expect(p1Demand).toMatchObject({
    release_id: release.id,
    release_number: 1,
    design_revision_id: r1.id,
    design_revision_number: 1,
    manufacturing_fingerprint: release.manufacturing_fingerprint,
  });
  expect(p1Demand.units.map((unit) => unit.furniture_instance_id).sort()).toEqual(instanceIds);
  for (const unit of p1Demand.units) {
    expect(unit).toMatchObject({
      furniture_definition_id: MODULE_ID,
      module_width_mm: WIDTH_R1_MM,
      module_height_mm: HEIGHT_MM,
      module_depth_mm: depthMm,
      module_code: expect.any(String),
      module_name: expect.any(String),
    });
    expect(unit.pieces.length).toBeGreaterThanOrEqual(2);
    expect(unit.pieces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        part_id: expect.stringContaining(COMPONENT_ID),
        description: 'Discovery P1 panel',
        length_mm: depthMm,
        width_mm: WIDTH_R1_MM,
        thickness_mm: 18,
        material_id: MATERIAL_ID,
        material_code: 'DISCOVERY-P1-BOARD',
        edge_band_id: EDGE_ID,
        edge_band_code: 'DISCOVERY-P1-EDGE',
        option_role: BODY_ROLE,
      }),
      expect.objectContaining({
        part_code: 'ZOCLO-AUTO',
        length_mm: WIDTH_R1_MM,
        width_mm: BASE_CLEARANCE_MM,
        thickness_mm: 18,
        material_id: MATERIAL_ID,
        option_role: 'ZOCLO',
      }),
    ]));
  }
  await saveModuleDefault('plinth_board');

  const projectDetail = await (
    await fetch(`${apiBase}/projects/${project.id}`, {
      headers: { Authorization: `Bearer ${owner.token}` },
    })
  ).json() as {
    status: string;
    resolved_production_release: {
      release_id: string;
      design_revision_id: string;
      quote_revision_id: string;
    };
  };
  expect(projectDetail.status).toBe('draft');
  expect(projectDetail.resolved_production_release).toMatchObject({
    release_id: release.id,
    design_revision_id: r1.id,
    quote_revision_id: q1Id,
  });

  await page.goto('/production-dashboard');
  await expect(
    page.getByRole('heading', { name: 'Dashboard de Producción' }),
  ).toBeVisible();
  await expect(page.getByTestId(`pm-project-row-${project.id}`)).toBeVisible();
});
