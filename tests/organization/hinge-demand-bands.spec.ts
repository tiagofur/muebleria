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
 *
 * #1579 — la tabla que cada bisagra declara para sí (segundo test): la
 * económica declara por API una tabla que termina en 2000 mm; la MISMA puerta
 * de 2100 pasa de 5 a 4 bisagras en la cotización del servidor (Go +
 * PostgreSQL reales), la Blum sin tabla sigue en la escalera de librería, y la
 * tabla vuelve a leerse tal cual por la API (columna hardwares.hinge_demand).
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
// #1579: segunda obra con la bisagra que declara tabla.
const HWG_TABLE_PROJECT = '67777777-2222-4777-8777-222222222222';
const HWG_TABLE_TALL_LINE = '67777777-2323-4777-8777-232323232323';
const HWG_TABLE_FLAT_LINE = '67777777-2424-4777-8777-242424242424';
const ECO_TABLE = {
  bands: [
    { upToHeightMm: 900, hinges: 2 },
    { upToHeightMm: 2000, hinges: 4 },
  ],
  widthSurgeOverMm: 0,
};

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
    // El código FRENTE lo siembran otros specs del mismo shard (el reparto
    // se re-balancea al añadir specs): REUTILIZAR su id si ya existe —
    // crear otro group con el mismo código es 409 y el upsert no lo sabe.
    const existingFrente = (catalog.optionGroups ?? []).find((g) => g.code === 'FRENTE');
    const frenteGroupId = existingFrente?.id ?? '77777777-0000-4777-8777-000000000002';
    // Mismo tratamiento para BISAGRA: hardware-group-quote siembra el mismo
    // código en este shard — reutilizar su id si existe.
    const existingBisagra = (catalog.optionGroups ?? []).find((g) => g.code === 'BISAGRA');
    const bisagraGroupId = existingBisagra?.id ?? HWG_GROUP;
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
          id: frenteGroupId,
          code: 'FRENTE',
          name: 'Frente',
          kind: 'board' as const,
          required: true,
          optionIds: [frenteMaterialId],
        },
        ...catalog.optionGroups.filter((g) => g.id !== bisagraGroupId && g.id !== frenteGroupId),
        {
          id: bisagraGroupId,
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
    // La instancia congelada lleva su propio furnitureInstanceId; el ítem
    // alto se reconoce por su choice FRENTE (única en la obra).
    const tallItem = frozen?.items.find(
      (i) => i.materialChoices['FRENTE'] === frenteMaterialId,
    );
    expect(tallItem?.materialChoices['BISAGRA']).toBe(HWG_BLUM);
  });

  test('#1579 — la tabla que declara la bisagra cambia lo que cotiza la misma puerta', async ({ page }) => {
    test.setTimeout(240_000);
    const repository = new APIWorkspaceRepository(required('ORGANIZATION_API_BASE'), {
      getAccessToken: () => owner.token,
    });
    const catalog = await repository.getCatalog();
    const eco = (catalog.hardware ?? []).find((h) => h.id === HWG_ECO);
    const frenteMaterialId = '77777777-0000-4777-8777-000000000001';

    // La económica declara su tabla por la API del catálogo (sin tocar SQL).
    await repository.saveCatalog({
      ...catalog,
      hardware: [
        ...(catalog.hardware ?? []).filter((h) => h.id !== HWG_ECO),
        { ...eco, hingeDemand: ECO_TABLE } as (typeof catalog.hardware)[number],
      ],
    });
    try {
      // Readback: la tabla vuelve del servidor tal cual (columna JSONB).
      const reread = (await repository.getCatalog()).hardware.find((h) => h.id === HWG_ECO);
      expect(reread?.hingeDemand).toEqual(ECO_TABLE);

      const now = new Date().toISOString();
      await repository.saveProject({
        id: HWG_TABLE_PROJECT,
        name: 'Bandas 1579 E2E (tabla por bisagra)',
        customerId: HWG_CUSTOMER,
        currency: 'MXN',
        marginFactor: 1,
        laborFixedCost: 0,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
        items: [
          {
            id: HWG_TABLE_TALL_LINE,
            moduleId: HWG_TALL_MODULE,
            quantity: 1,
            optionChoices: { FRENTE: frenteMaterialId, BISAGRA: HWG_ECO },
          },
          {
            id: HWG_TABLE_FLAT_LINE,
            moduleId: HWG_FLAT_MODULE,
            quantity: 1,
            optionChoices: {},
          },
        ],
      });

      // La MISMA puerta de 2100: con la económica (tabla hasta 2000) cotiza 4,
      // no las 5 de la escalera de librería que sigue comprando la Blum.
      const q1 = await client.createInitialProjectQuoteRevision(
        owner.token,
        HWG_TABLE_PROJECT,
        { notes: '1579 — tabla declarada por la bisagra' },
        'e2e1579-q1-create-20261123',
      );
      expect(q1.revisionNumber).toBe(1);

      // Sesión del taller A: cada test abre una página nueva.
      await loginToA(page);
      await page.goto(`/quotes/${HWG_TABLE_PROJECT}`);
      const totals = page.locator('.project-totals');
      // 4 × $12 (puerta 2100 bajo la tabla de la económica) + 1 × $12 (línea
      // bulk del módulo sin puerta, que no es puerta y no entra en la banda).
      await expect(totals).toContainText('Herrajes$60.00 MXN', { timeout: 20_000 });
    } finally {
      // La bisagra vuelve a quedar sin tabla para los demás specs del shard.
      const latest = await repository.getCatalog();
      const { hingeDemand: _dropped, ...plainEco } = latest.hardware.find((h) => h.id === HWG_ECO) ?? eco ?? {};
      await repository.saveCatalog({
        ...latest,
        hardware: [
          ...latest.hardware.filter((h) => h.id !== HWG_ECO),
          plainEco as (typeof latest.hardware)[number],
        ],
      });
    }
  });

  test('#1579 PR2 — la receta con patrón countRule compra por el alto REAL de cada bahía', async ({ page }) => {
    test.setTimeout(240_000);
    const repository = new APIWorkspaceRepository(required('ORGANIZATION_API_BASE'), {
      getAccessToken: () => owner.token,
    });
    const catalog = await repository.getCatalog();
    const frenteMaterialId = '77777777-0000-4777-8777-000000000001';

    // AUTOCONTENIDO: este test puede correr solo en una org fresca (--grep),
    // así que siembra TODO lo que necesita con ids fijos (upserts
    // idempotentes — los mismos del test 1) antes de su siembra propia.
    const ecoSeeded: (typeof catalog.hardware)[number] = (catalog.hardware ?? []).find((h) => h.id === HWG_ECO) ?? {
      id: HWG_ECO,
      code: 'HWG-ECO-1078',
      name: 'Bisagra económica',
      unit: 'piece' as const,
      costPerUnit: 12,
      active: true,
    };
    const PAT_AGR = '67777777-3333-4733-8777-333333333333';
    const PAT_STRUCT = '67777777-3434-4734-8777-343434343434';
    const PAT_MODULE_720 = '67777777-3535-4735-8777-353535353535';
    const PAT_MODULE_2100 = '67777777-3d3d-473d-8777-3d3d3d3d3d3d';
    const PAT_STRUCT_2100 = '67777777-3e3e-473e-8777-3e3e3e3e3e3e';
    const PAT_DOOR_COMP = '67777777-3636-4736-8777-363636363636';
    const PAT_PROJECT_720 = '67777777-3737-4737-8777-373737373737';
    const PAT_PROJECT_2100 = '67777777-3838-4738-8777-383838383838';

    await repository.saveCatalog({
      ...catalog,
      materials: [
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
      ],
      hardware: [
        ...(catalog.hardware ?? []).filter((h) => h.id !== HWG_ECO),
        { ...ecoSeeded, hingeDemand: ECO_TABLE } as (typeof catalog.hardware)[number],
      ],
      optionGroups: [
        {
          id: '77777777-0000-4777-8777-000000000002',
          code: 'FRENTES',
          name: 'Frentes',
          kind: 'board' as const,
          required: true,
          optionIds: [frenteMaterialId],
        },
        ...((catalog.optionGroups ?? []).filter(
          (g) => g.code !== 'BISAGRA' && g.id !== '77777777-0000-4777-8777-000000000002',
        ) as (typeof catalog.optionGroups)[number][]),
        {
          id: HWG_GROUP,
          code: 'BISAGRA',
          name: 'Bisagras',
          kind: 'hardware' as const,
          required: true,
          optionIds: [HWG_BLUM, HWG_ECO],
        },
      ],
      customers: [
        ...(catalog.customers ?? []).filter((c) => c.id !== HWG_CUSTOMER),
        { id: HWG_CUSTOMER, name: 'Cliente 1078 E2E', active: true },
      ],
      components: [
        ...(catalog.components ?? []).filter((c) => c.id !== PAT_DOOR_COMP),
        {
          id: PAT_DOOR_COMP,
          code: 'HWG-PUE-PATRON',
          name: 'Puerta patrón (fórmulas)',
          placement: 'puerta' as const,
          geometry: {
            kind: 'rectangular_board' as const,
            lengthMm: 700,
            widthMm: 600,
            thicknessMm: 18,
            lengthFormula: 'PH - 3',
            widthFormula: 'PW - 3',
          },
          defaultEdges: [],
          optionRoles: ['FRENTES'],
          active: true,
        },
      ],
      agregados: [
        ...(catalog.agregados ?? []).filter((a) => a.id !== PAT_AGR),
        {
          id: PAT_AGR,
          code: 'HWG-AGR-PUE-PATRON',
          name: 'Puerta patrón (countRule)',
          active: true,
          components: [
            {
              componentId: PAT_DOOR_COMP,
              quantity: 1,
              placementOverride: 'puerta' as const,
              overrides: {
                hardwarePlacements: [
                  {
                    optionRole: 'BISAGRA',
                    anchorFace: 'back' as const,
                    countRule: { kind: 'hingeDemand' as const, endOffsetBottomMm: 90, endOffsetTopMm: 90 },
                    relativePosition: { xMm: 20.5, yMm: 90 },
                  },
                ],
              },
            },
          ],
          hardwareLines: [],
        } as unknown as (typeof catalog.agregados)[number],
      ],
      structures: [
        ...(catalog.structures ?? []).filter((s) => s.id !== PAT_STRUCT && s.id !== PAT_STRUCT_2100),
        {
          id: PAT_STRUCT,
          code: 'HWG-EST-PATRON',
          name: 'Cuerpo patrón',
          components: [],
          agregados: [
            {
              id: 'inst-patron',
              agregadoId: PAT_AGR,
              quantity: 1,
            },
          ],
          active: true,
        } as (typeof catalog.structures)[number],
        {
          id: PAT_STRUCT_2100,
          code: 'HWG-EST-PATRON-2100',
          name: 'Cuerpo patrón 2100',
          components: [],
          agregados: [
            {
              id: 'inst-patron-2100',
              agregadoId: PAT_AGR,
              quantity: 1,
            },
          ],
          active: true,
        } as (typeof catalog.structures)[number],
      ],
      modules: [
        ...catalog.modules.filter((m) => m.id !== PAT_MODULE_720 && m.id !== PAT_MODULE_2100),
        {
          id: PAT_MODULE_720,
          code: 'HWG-PATRON-1579-720',
          name: 'Módulo puerta patrón 720',
          structureId: PAT_STRUCT,
          externalDims: { width: 600, height: 720, depth: 560 },
          components: [],
          hardwareLines: [],
        },
        {
          id: PAT_MODULE_2100,
          code: 'HWG-PATRON-1579-2100',
          name: 'Módulo puerta patrón 2100',
          structureId: PAT_STRUCT_2100,
          externalDims: { width: 600, height: 2100, depth: 560 },
          components: [],
          hardwareLines: [],
        },
      ],
    });
    try {
      // Readback: el patrón sobrevive el round-trip de la API (countRule).
      const reread = (await repository.getCatalog()).agregados?.find((a) => a.id === PAT_AGR);
      const patternPlacement = reread?.components?.[0]?.overrides?.hardwarePlacements?.[0];
      expect(patternPlacement?.countRule).toEqual({
        kind: 'hingeDemand',
        endOffsetBottomMm: 90,
        endOffsetTopMm: 90,
      });

      const now = new Date().toISOString();
      // Un módulo POR alto (sin customDims): la cotización de ítems con
      // instancia de mueble resuelve desde la instancia sembrada al crear la
      // obra (envolvente del módulo) — el interplay customDims→cotización es
      // otra superficie, fuera de #1579. La RECETA es la misma; lo que
      // cambia el conteo es la envolvente de la bahía.
      const projectFor = (id: string, name: string, moduleId: string, itemId: string) => ({
        id,
        name,
        customerId: HWG_CUSTOMER,
        currency: 'MXN',
        marginFactor: 1,
        laborFixedCost: 0,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
        items: [
          {
            id: itemId,
            moduleId,
            quantity: 1,
            optionChoices: { FRENTES: frenteMaterialId, BISAGRA: HWG_ECO },
          },
        ],
      });
      await repository.saveProject(
        projectFor(PAT_PROJECT_720, 'Patrón 1579 (720)', PAT_MODULE_720, '67777777-3939-4739-8777-393939393939') as Parameters<typeof repository.saveProject>[0],
      );
      await repository.saveProject(
        projectFor(PAT_PROJECT_2100, 'Patrón 1579 (2100)', PAT_MODULE_2100, '67777777-3a3a-473a-8777-3a3a3a3a3a3a') as Parameters<typeof repository.saveProject>[0],
      );

      // La MISMA receta en dos bahías: 717 mm (PH-3) compra 2; 2097 mm cae en
      // la banda ≤2000 de la económica → 4. Congelado en Q1 de cada obra.
      const quoteOrThrow = async (projectId: string, notes: string, key: string) => {
        try {
          return await client.createInitialProjectQuoteRevision(owner.token, projectId, { notes }, key);
        } catch (err) {
          const payload = (err as { payload?: unknown }).payload ?? err;
          throw new Error(`Q rechazada (${key}): ${JSON.stringify(payload)}`);
        }
      };
      const q720 = await quoteOrThrow(PAT_PROJECT_720, '1579 PR2 — patrón 720', 'e2e1579-pr2-create-720');
      expect(q720.revisionNumber).toBe(1);
      const q2100 = await quoteOrThrow(PAT_PROJECT_2100, '1579 PR2 — patrón 2100', 'e2e1579-pr2-create-2100');
      expect(q2100.revisionNumber).toBe(1);
      // Diagnóstico temporal (retirar al cerrar): líneas congeladas reales.
      const revisions2100 = await client.listProjectQuoteRevisions(owner.token, PAT_PROJECT_2100);
      const frozen2100 = revisions2100.find((r) => r.id === q2100.id);
      (await import('node:fs')).writeFileSync('/tmp/granete-1579/frozen2100.json', JSON.stringify(frozen2100 ?? null));
      expect(q2100.revisionNumber).toBe(1);

      await loginToA(page);
      await page.goto(`/quotes/${PAT_PROJECT_720}`);
      await expect(page.locator('.project-totals')).toContainText('Herrajes$24.00 MXN', { timeout: 20_000 });
      await page.goto(`/quotes/${PAT_PROJECT_2100}`);
      await expect(page.locator('.project-totals')).toContainText('Herrajes$48.00 MXN', { timeout: 20_000 });
    } finally {
      // La bisagra vuelve a quedar sin tabla para el resto del shard.
      const latest = await repository.getCatalog();
      const current = latest.hardware.find((h) => h.id === HWG_ECO) ?? eco ?? {};
      const { hingeDemand: _dropped, ...plainEco } = current;
      await repository.saveCatalog({
        ...latest,
        hardware: [
          ...latest.hardware.filter((h) => h.id !== HWG_ECO),
          plainEco as (typeof latest.hardware)[number],
        ],
      });
    }
  });
});
