/**
 * #1078 — bisagras por banda de altura de puerta: E2E navegador real
 * (Chromium + Go + PostgreSQL, sin mocks).
 *
 * Números del navegador (módulo compuesto, SIN línea fija autorizada):
 *   - Puerta de despensa 2100×600 → banda ≤2400 → 5 bisagras
 *     (aceptación #1078: 2001–2400 → 5).
 *   - Elección Blum ($40): Herrajes $212.00 = 5 × $40 (banda derivada)
 *     + 1 × $12 (línea bulk de un módulo SIN puerta que sobrevive).
 *   - El gate (#1046) exige el grupo BISAGRA aunque ya no exista línea fija:
 *     el picker ofrece heredar + 2 miembros y la elección congela en Q1.
 *
 * La paridad exacta 720→2 / 1601→4 / 2100→5, el recargo Blum por ancho, el
 * swap de elección con re-cotización y la escalera C3 (fábrica + excepción
 * por componente) viven en contracts/hingeDemandBands.contract.json
 * (vitest + go test) y en PostgreSQL real (engine/storage Go tests).
 */
import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

const HWG_BLUM = '67777777-3333-4777-8777-333333333333';
const HWG_ECO = '67777777-4444-4777-8777-444444444444';
const HWG_GROUP = '67777777-5555-4777-8777-555555555555';
const HWG_DOOR_COMP = '67777777-6666-4777-8777-666666666666';
const HWG_STRUCT = '67777777-7777-4777-8777-777777777777';
const HWG_TALL_MODULE = '67777777-8888-4777-8777-888888888888';
const HWG_FLAT_MODULE = '67777777-9999-4777-8777-999999999999';
const HWG_CUSTOMER = 'c7777777-0000-4000-8000-000000010778';
const HWG_PROJECT = '67777777-1111-4777-8777-111111111111';
const HWG_TALL_LINE = '67777777-1212-4777-8777-121212121212';
const HWG_FLAT_LINE = '67777777-1313-4777-8777-131313131313';

async function loginOwner(): Promise<{ token: string }> {
  return new GraneteApiClient(required('ORGANIZATION_API_BASE')).login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
}

async function loginToA(page: Page): Promise<void> {
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

test.describe.serial('#1078 — bisagras por banda de altura: demanda derivada y gate', () => {
  let owner!: { token: string };
  let client!: GraneteApiClient;

  test.beforeAll(async () => {
    client = new GraneteApiClient(required('ORGANIZATION_API_BASE'));
    owner = await loginOwner();
  });

  test('puerta de 2100 compra 5; el gate exige el grupo; la elección congela en Q1', async ({ page }) => {
    test.setTimeout(240_000);
    const repository = new APIWorkspaceRepository(required('ORGANIZATION_API_BASE'), {
      getAccessToken: () => owner.token,
    });
    const catalog = await repository.getCatalog();
    // La org gate viene sin materiales de tablero: el spec siembra el suyo
    // (igual que siembra hardware/grupo/componente) y la parte FRENTE lo
    // elige — sin esa choice el estado comercial no produce revisión.
    const frenteMaterialId = '77777777-0000-4777-8777-000000000001';
    const materials = [
      ...(catalog.materials ?? []).filter((m) => m.id !== frenteMaterialId),
      {
        id: frenteMaterialId,
        code: 'MEL-BL-18',
        name: 'Melamina blanca 18',
        widthMm: 2750,
        lengthMm: 1850,
        thicknessMm: 18,
        grainDefault: false,
        boardPrice: 480,
        wastePercent: 10,
        costPerM2: 132,
        active: true,
      },
    ];
    await repository.saveCatalog({
      ...catalog,
      materials,
      hardware: [
        ...(catalog.hardware ?? []).filter((h) => h.id !== HWG_BLUM && h.id !== HWG_ECO),
        { id: HWG_BLUM, code: 'HWG-BLUM-1078', name: 'Bisagra Blum CL', unit: 'piece' as const, costPerUnit: 40, active: true },
        { id: HWG_ECO, code: 'HWG-ECO-1078', name: 'Bisagra económica', unit: 'piece' as const, costPerUnit: 12, active: true },
      ],
      optionGroups: [
        // El grupo FRENTE también lo siembra el spec: la parte de la puerta
        // consume la choice y el snapshot exige el label comercial del grupo.
        {
          id: '77777777-0000-4777-8777-000000000002',
          code: 'FRENTE',
          name: 'Frente',
          kind: 'board' as const,
          required: true,
          optionIds: [frenteMaterialId],
        },
        ...catalog.optionGroups.filter((g) => g.id !== HWG_GROUP && g.code !== 'FRENTE'),
        {
          id: HWG_GROUP,
          code: 'BISAGRA',
          name: 'Bisagras',
          kind: 'hardware' as const,
          required: true,
          optionIds: [HWG_BLUM, HWG_ECO],
        },
      ],
      components: [
        ...(catalog.components ?? []).filter((c) => c.id !== HWG_DOOR_COMP),
        {
          id: HWG_DOOR_COMP,
          code: 'HWG-PUE-2100',
          name: 'Puerta despensa 2100',
          placement: 'puerta' as const,
          geometry: {
            kind: 'rectangular_board' as const,
            lengthMm: 2100,
            widthMm: 600,
            thicknessMm: 18,
          },
          defaultEdges: [],
          optionRoles: ['FRENTE'],
          active: true,
        },
      ],
      structures: [
        ...(catalog.structures ?? []).filter((s) => s.id !== HWG_STRUCT),
        {
          id: HWG_STRUCT,
          code: 'HWG-EST-ALTO',
          name: 'Cuerpo despensa 2100',
          externalDims: { width: 600, height: 2100, depth: 560 },
          components: [
            {
              componentId: HWG_DOOR_COMP,
              quantity: 1,
              placementOverride: 'puerta' as const,
            },
          ],
          active: true,
        },
      ],
      modules: [
        ...catalog.modules.filter((m) => m.id !== HWG_TALL_MODULE && m.id !== HWG_FLAT_MODULE),
        {
          // Sin línea fija de bisagras: la demanda DERIVA de la banda.
          id: HWG_TALL_MODULE,
          code: 'HWG-ALTO-1078',
          name: 'Despensa 2100 (banda)',
          structureId: HWG_STRUCT,
          externalDims: { width: 600, height: 2100, depth: 560 },
          components: [],
          hardwareLines: [],
        },
        {
          // Módulo plano SIN puerta: su línea bulk sobrevive intacta
          // (sin puerta no se inventa demanda).
          id: HWG_FLAT_MODULE,
          code: 'HWG-PLANO-1078',
          name: 'Cajón plano (línea sobrevive)',
          externalDims: { width: 500, height: 300, depth: 500 },
          hardwareLines: [
            { id: 'e2e1078-flat-line', quantity: 1, optionRole: 'BISAGRA', hardwareId: HWG_ECO },
          ],
        },
      ],
      customers: [
        ...(catalog.customers ?? []).filter((c) => c.id !== HWG_CUSTOMER),
        { id: HWG_CUSTOMER, name: 'Cliente 1078 E2E', active: true },
      ],
    });

    // La parte FRENTE de la puerta exige la elección de material del rol —
    // sin ella el estado comercial no produce revisión (fail-closed correcto).
    const now = new Date().toISOString();
    await repository.saveProject({
      id: HWG_PROJECT,
      name: 'Bandas 1078 E2E',
      customerId: HWG_CUSTOMER,
      currency: 'MXN',
      marginFactor: 1,
      laborFixedCost: 0,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      items: [
        {
          id: HWG_TALL_LINE,
          moduleId: HWG_TALL_MODULE,
          quantity: 1,
          optionChoices: { FRENTE: frenteMaterialId },
        },
        { id: HWG_FLAT_LINE, moduleId: HWG_FLAT_MODULE, quantity: 1, optionChoices: {} },
      ],
    });

    await loginToA(page);
    await page.goto(`/quotes/${HWG_PROJECT}`);

    // El gate no adivina: sin elección el picker del grupo ofrece heredar + 2.
    const choice = page.getByTestId(`item-choice-${HWG_TALL_LINE}-BISAGRA`);
    await expect(choice).toBeVisible({ timeout: 20_000 });
    await expect(choice.locator('option')).toHaveCount(3);

    // La elección Blum hecha EN EL PROYECTO, desde la UI.
    await choice.selectOption(HWG_BLUM);
    await expect(choice).toHaveValue(HWG_BLUM);

    // Q1 congela la verdad comercial: 5 bisagras derivadas × $40 (banda de
    // la puerta 2100) + 1 × $12 (línea bulk del módulo sin puerta).
    let q1;
    try {
      q1 = await client.createInitialProjectQuoteRevision(
      owner.token,
      HWG_PROJECT,
      { notes: '1078 — revisión inicial con banda' },
      'e2e1078-q1-create-20261007',
    );
    } catch (err) {
      const payload = (err as { payload?: unknown }).payload ?? err;
      throw new Error(`Q1 rechazada: ${JSON.stringify(payload)}`);
    }
    expect(q1.revisionNumber).toBe(1);

    await page.reload();
    const totals = page.locator('.project-totals');
    await expect(totals).toContainText('Herrajes$212.00 MXN', { timeout: 20_000 });

    // La verdad congelada lleva la elección por grupo en la unidad de banda.
    const revisions = await client.listProjectQuoteRevisions(owner.token, HWG_PROJECT);
    const frozen = revisions.find((r) => r.id === q1.id);
    expect(frozen?.status).toBe('draft');
    const tallItem = frozen?.items.find((i) => i.furnitureInstanceId === HWG_TALL_LINE);
    expect(tallItem?.materialChoices['BISAGRA']).toBe(HWG_BLUM);
  });
});
