import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { GATE_MODULE_A_ID, putWorkingCopyCurrent, required } from './support/api';

/**
 * #1070 browser E2E — the «Descargar programas KDT (.zip)» button never dies
 * silently. The demo defect (2026-10-04) was a click swallowed by a disabled
 * button: no toast, no network, no console signal.
 *
 *   seed (structured module whose placed panel drills at release time →
 *   quote → accept → release P1 whose frozen snapshot carries the drill)
 *   → Optimización WITHOUT a machining output: the click surfaces an error
 *     toast — a click on this button can never be a no-op.
 *
 * The toast names the release's REAL first blocker; which blocker that is
 * depends on the released content. Today composing the frozen drilling joins
 * the Go release BOM part ids (st-/mod- prefixed) against the TS live BOM ids
 * (unprefixed) and that identity divergence blocks EVERY structured release
 * before the output-configured check — it belongs to the export-bridge
 * parity debt, not to the never-mute contract this spec pins. The beforeAll
 * assert still proves the Go side of that chain (the release freezes real
 * drill operations).
 */

const PROJECT_ID = '5a170000-0000-4000-8000-000000001070';
const QUOTE_LINE_ID = '5a170000-0000-4000-8000-000000001071';
const CUSTOMER_ID = '5a170000-0000-4000-8000-000000001072';
const MAT_ID = '5a170000-0000-4000-8000-000000001073';
const HW_ID = '5a170000-0000-4000-8000-000000001074';
const COMP_ID = '5a170000-0000-4000-8000-000000001075';
const MODULE_ID = '5a170000-0000-4000-8000-000000001076';
const STRUCT_ID = '5a170000-0000-4000-8000-000000001078';
const BODY_COMP_ID = '5a170000-0000-4000-8000-000000001079';
const BODY_ROLE = 'KDT-1070-BODY';
const MAT_CODE = 'KDT-1070-TAB';
const DEPTH_MM = 560;

interface Seeded {
  readonly projectId: string;
  readonly releaseId: string;
  readonly token: string;
  readonly apiBase: string;
}

async function login(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' })).toBeVisible();
  await page.getByRole('button', { name: /Browser Gate A/ }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

test.describe.serial('Descarga de programas KDT nunca queda muda (#1070)', () => {
  let seeded!: Seeded;

  test.beforeAll(async () => {
    const apiBase = required('ORGANIZATION_API_BASE');
    const client = new GraneteApiClient(apiBase);
    const owner = await client.login({
      email: required('ORGANIZATION_GATE_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    const token = owner.token;
    const repository = new APIWorkspaceRepository(apiBase, { getAccessToken: () => token });

    const catalog = await repository.getCatalog();
    const template = catalog.modules.find((m) => m.id === GATE_MODULE_A_ID) ?? catalog.modules[0]!;
    await repository.saveCatalog({
      ...catalog,
      materials: [
        ...catalog.materials.filter((m) => m.id !== MAT_ID),
        {
          id: MAT_ID,
          code: MAT_CODE,
          name: 'MDF KDT 1070',
          widthMm: 1830,
          lengthMm: 2440,
          thicknessMm: 18,
          grainDefault: true,
          boardPrice: 100,
          wastePercent: 0,
          costPerM2: 100,
          active: true,
        },
      ],
      // The known hinge profile (BIS-BLUM-110 → cup 35×13 front) is what
      // turns the placement into a frozen drill operation at release time.
      hardware: [
        ...catalog.hardware.filter((h) => h.id !== HW_ID),
        { id: HW_ID, code: 'BIS-BLUM-110', name: 'Bisagra Blum 110 E2E 1070', unit: 'piece' as const, costPerUnit: 45, active: true },
      ],
      optionGroups: [
        ...catalog.optionGroups.filter((g) => g.code !== BODY_ROLE),
        { id: '5a170000-0000-4000-8000-000000001077', code: BODY_ROLE, name: 'Cuerpo KDT 1070', kind: 'board' as const, required: true, optionIds: [MAT_ID] },
      ],
      components: [
        ...(catalog.components ?? []).filter((c) => c.id !== COMP_ID && c.id !== BODY_COMP_ID),
        {
          id: COMP_ID,
          code: 'KDT-1070-PANEL',
          name: 'Panel KDT 1070',
          placement: 'interno' as const,
          geometry: { kind: 'rectangular_board' as const, lengthMm: DEPTH_MM, widthMm: 600, thicknessMm: 18 },
          defaultEdges: [
            { side: 'L1' as const, enabled: false },
            { side: 'L2' as const, enabled: false },
            { side: 'W1' as const, enabled: false },
            { side: 'W2' as const, enabled: false },
          ],
          optionRoles: [BODY_ROLE],
          active: true,
        },
        {
          id: BODY_COMP_ID,
          code: 'KDT-1070-BODY-PANEL',
          name: 'Base KDT 1070',
          placement: 'interno' as const,
          geometry: { kind: 'rectangular_board' as const, lengthMm: DEPTH_MM, widthMm: 600, thicknessMm: 18 },
          defaultEdges: [
            { side: 'L1' as const, enabled: false },
            { side: 'L2' as const, enabled: false },
            { side: 'W1' as const, enabled: false },
            { side: 'W2' as const, enabled: false },
          ],
          optionRoles: [BODY_ROLE],
          active: true,
        },
      ],
      structures: [
        ...(catalog.structures ?? []).filter((s) => s.id !== STRUCT_ID),
        {
          id: STRUCT_ID,
          code: 'KDT-1070-STRUCT',
          name: 'Cuerpo KDT 1070',
          externalDims: { width: 600, height: 720, depth: DEPTH_MM },
          components: [{ componentId: BODY_COMP_ID, quantity: 1 }],
          active: true,
        },
      ],
      modules: [
        ...catalog.modules,
        {
          // Structure module (the proven quote→release path); the hinge
          // placement rides the MODULE-level component instance overrides
          // ("mod-" boards also expand on structure modules).
          ...template,
          id: MODULE_ID,
          code: 'KDT-1070',
          name: 'Módulo KDT 1070',
          structureId: STRUCT_ID,
          components: [{
            componentId: COMP_ID,
            quantity: 1,
            overrides: {
              hardwarePlacements: [{
                hardwareId: HW_ID,
                anchorFace: 'front' as const,
                relativePosition: { xMm: 300, yMm: 100 },
              }],
            },
          }],
          hardwareLines: [],
          externalDims: { width: 600, height: 720, depth: DEPTH_MM },
        },
      ],
      customers: [
        ...(catalog.customers ?? []).filter((c) => c.id !== CUSTOMER_ID),
        { id: CUSTOMER_ID, name: 'Cliente KDT 1070', active: true },
      ],
    });

    const now = new Date().toISOString();
    await repository.saveProject({
      id: PROJECT_ID,
      name: 'Obra KDT 1070',
      customerId: CUSTOMER_ID,
      currency: 'MXN',
      marginFactor: 1.3,
      laborFixedCost: 0,
      status: 'draft' as const,
      createdAt: now,
      updatedAt: now,
      items: [{ id: QUOTE_LINE_ID, moduleId: MODULE_ID, quantity: 1, optionChoices: { [BODY_ROLE]: MAT_ID } }],
    });

    const materialized = await client.materializeQuoteLineFurniture(token, PROJECT_ID, QUOTE_LINE_ID, 'kdt-1070-materialize-line');
    const instanceIds = materialized.instances.map((instance) => instance.furniture_instance_id);
    const design = await client.createProjectDesign(token, PROJECT_ID, { name: 'Diseño KDT 1070' }, 'kdt-1070-create-design');
    await putWorkingCopyCurrent(client, token, design.id, {
      items: instanceIds.map((furnitureInstanceId) => ({
        furniture_instance_id: furnitureInstanceId,
        furniture_definition_id: MODULE_ID,
        parameters: { widthMm: 600, heightMm: 720, depthMm: DEPTH_MM },
        material_choices: { [BODY_ROLE]: MAT_ID },
      })),
    });
    const r1 = await client.publishDesignRevision(token, design.id, { source_type: 'manual', base_revision_id: null }, 'kdt-1070-publish-r1');
    const q1 = await client.createInitialProjectQuoteRevision(token, PROJECT_ID, { notes: 'KDT 1070' }, 'kdt-1070-q1-create');
    await client.publishProjectQuoteRevision(token, PROJECT_ID, q1.id, 'kdt-1070-q1-publish-rev');
    await client.acceptProjectQuoteRevision(token, PROJECT_ID, q1.id, 'kdt-1070-q1-accept-rev');
    const approved = await client.approveProjectDesignRevisionForProduction(
      token, PROJECT_ID, design.id, r1.id, { quoteRevisionId: q1.id }, 'kdt-1070-approve-r1-q1',
    );
    if (approved.status !== 'approved') throw new Error(`R1 not approved: ${approved.status}`);
    const release = await client.createProductionRelease(
      token, PROJECT_ID, { design_revision_id: r1.id, quote_revision_id: q1.id }, 'kdt-1070-release-p1-flow',
    );

    // The handler's export gate requires an accepted project (production is a
    // physical fact, not a commercial draft).
    await repository.saveProject({
      id: PROJECT_ID,
      name: 'Obra KDT 1070',
      customerId: CUSTOMER_ID,
      currency: 'MXN',
      marginFactor: 1.3,
      laborFixedCost: 0,
      status: 'accepted' as const,
      createdAt: now,
      updatedAt: new Date().toISOString(),
      items: [{ id: QUOTE_LINE_ID, moduleId: MODULE_ID, quantity: 1, optionChoices: { [BODY_ROLE]: MAT_ID } }],
    });

    // Fail fast with the fixture's own truth: the Go release freeze DID
    // materialize the placement into a frozen drill operation.
    const snapshot = await client.getProjectProductionManufacturingSnapshot(token, PROJECT_ID, release.id);
    const frozenDrills = (snapshot.routing.units ?? []).flatMap((unit) =>
      (unit.parts ?? []).flatMap((part) => (part.operations ?? []).filter((op) => op.operation === 'drill')),
    );
    expect(frozenDrills.length, `frozen drill operations: ${JSON.stringify(snapshot.routing).slice(0, 400)}`).toBeGreaterThan(0);

    seeded = { projectId: PROJECT_ID, releaseId: release.id, token, apiBase };
  });

  test('sin salida de mecanizado configurada, el clic explica el bloqueo (toast) — nunca queda mudo', async ({ page }) => {
    await login(page);
    await page.goto(`/engineering/${seeded.projectId}?release=${seeded.releaseId}`);
    await page.getByTestId('eng-tab-optimizacion').click();

    await expect(page.getByTestId('prod-opt-machining-output')).toBeVisible();
    await expect(page.getByTestId('prod-opt-machining-output-summary')).toContainText('sin salida de mecanizado configurada');

    // #1070: the exact demo defect — the button used to render disabled and
    // swallow the click. It stays enabled and the click ALWAYS surfaces the
    // release's real first blocker as an error toast (which blocker that is
    // depends on the released content — see the header note).
    const button = page.getByTestId('prod-opt-export-kdt');
    await expect(button).toBeEnabled();
    await button.click();

    const toast = page.getByTestId('ui-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toHaveAttribute('data-toast-type', 'error');
    await expect(toast).not.toContainText('undefined');
  });
});
