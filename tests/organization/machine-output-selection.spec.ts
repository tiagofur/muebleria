import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { optimizeCutPlan } from '@granete/domain';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

/**
 * #591 / WEB-MFG-2 browser E2E against the real Go backend + PostgreSQL:
 * the factory pins the EXACT machine/profile/adapter tuple per operation,
 * it survives reload, the resolver read model returns only that target, a
 * blocked CADmatic 3 selection produces blockers (never a silent fallback to
 * ptx-generic), the CADmatic 4 candidate revision (r2, #650) resolves ready
 * while staying an unvalidated candidate, stale writes conflict, and org B
 * never sees org A's config.
 */

const CUTTING_GENERIC = {
  operation: 'cutting',
  machineProfileId: 'client-a-machine-b-hpp250',
  machineProfileRevisionId: 'r1',
  outputProfileId: 'ptx-generic',
  outputProfileRevisionId: 'r1',
  adapterId: 'granete-ptx',
  adapterVersion: '1.2.0',
  adapterImplementationDigest: '954fd63d08425a241309826d936597a4f20f857ae18b94741643480d679f7236',
} as const;

const CUTTING_CADMATIC4_CANDIDATE = {
  ...CUTTING_GENERIC,
  outputProfileId: 'ptx-cadmatic-4',
  outputProfileRevisionId: 'r3',
} as const;
const EXPORT_PROJECT_ID = '77777777-6910-4691-8691-777777777777';

async function api() {
  const base = required('ORGANIZATION_API_BASE');
  const loginResponse = await new GraneteApiClient(base).login({
    email: required('ORGANIZATION_GATE_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  return {
    base,
    repository: new APIWorkspaceRepository(base, { getAccessToken: () => loginResponse.token }),
    client: new GraneteApiClient(base),
    token: loginResponse.token,
  };
}

async function loginToA(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await expect(page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' })).toBeVisible();
  await page.getByRole('button', { name: /Browser Gate A/ }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
}

async function openEngineeringSettings(page: Page): Promise<void> {
  await page.goto('/settings');
  await page.getByTestId('settings-tab-tab-ingenieria').click();
  await expect(page.getByTestId('machine-output-cutting')).toBeVisible();
}

/** Polls the server read model — the button flash is only 2s and races. */
async function waitForCuttingProfile(
  repository: APIWorkspaceRepository,
  profileId: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const readModel = await repository.getMachineOutputSelections();
        return readModel.selections.find((s) => s.selection.selection.operation === 'cutting')
          ?.selection.selection.outputCompatibilityProfileId;
      },
      { timeout: 15_000 },
    )
    .toBe(profileId);
}

async function saveCuttingSelection(
  page: Page,
  repository: APIWorkspaceRepository,
  machineLabel: string,
  profileLabel: string,
  expectedProfileId: string,
): Promise<void> {
  await page.getByTestId('machine-output-cutting-machine').selectOption({ label: machineLabel });
  await page.getByTestId('machine-output-cutting-profile').selectOption({ label: profileLabel });
  await page.getByTestId('machine-output-cutting-save').click();
  await waitForCuttingProfile(repository, expectedProfileId);
}

async function seedCuttingProject(repository: APIWorkspaceRepository): Promise<void> {
  const catalog = await repository.getCatalog();
  const customer = { id: 'c0000000-6910-4691-8691-000000000000', name: 'CAD4 E2E', active: true };
  await repository.saveCatalog({ ...catalog, customers: [...(catalog.customers ?? []), customer] });
  const now = new Date().toISOString();
  const cutPlan = optimizeCutPlan(EXPORT_PROJECT_ID, [{
    quantity: 1, lengthMm: 600, widthMm: 400, description: 'Panel E2E',
    materialName: 'MDF E2E', materialCode: 'MDF-E2E', thicknessMm: 18,
    grain: 0, L1: 0, L2: 0, W1: 0, W2: 0,
  }], [], undefined, 'Salida CADmatic 4 E2E');
  await repository.saveProject({
    id: EXPORT_PROJECT_ID, name: 'Salida CADmatic 4 E2E', customerId: customer.id,
    currency: 'MXN', marginFactor: 1.3, laborFixedCost: 0, status: 'draft',
    createdAt: now, updatedAt: now, items: [], cutPlan,
  });
}

test.describe.serial('Machine output selection (#591) browser E2E', () => {
  test('select exact tuple → persists across reload → resolver returns only this target', async ({ page }) => {
    test.setTimeout(90_000);
    const { repository } = await api();

    await loginToA(page);
    await openEngineeringSettings(page);
    await saveCuttingSelection(page, repository, 'HOLZMA (HOMAG) HPP 250', 'PTX (dialecto Granete)', 'ptx-generic');

    // Reload: exact tuple survives.
    await page.reload();
    await page.getByTestId('settings-tab-tab-ingenieria').click();
    await expect(page.getByTestId('machine-output-cutting-status')).toHaveText('Candidato — no validado en máquina');
    await expect(page.getByTestId('machine-output-cutting-readiness')).toHaveText('Listo');
    await page.getByText('Detalle técnico').click();
    const tech = page.getByTestId('machine-output-cutting');
    await expect(tech.getByText('profile: ptx-generic@r1')).toBeVisible();
    await expect(tech.getByText('adapter: granete-ptx@1.2.0')).toBeVisible();

    // Server read model: exactly ONE configured target, no blockers.
    const readModel = await repository.getMachineOutputSelections();
    const cutting = readModel.selections.find((s) => s.selection.selection.operation === 'cutting');
    expect(cutting).toBeDefined();
    expect(cutting!.selection.selection.outputCompatibilityProfileId).toBe('ptx-generic');
    expect(cutting!.blockers).toEqual([]);
    expect(readModel.selections.filter((s) => s.selection.selection.operation === 'cutting')).toHaveLength(1);
  });

  test('blocked CADmatic 3 stays selected with visible blockers — no fallback to generic', async ({ page }) => {
    test.setTimeout(90_000);

    const { repository } = await api();
    await loginToA(page);
    await openEngineeringSettings(page);
    await saveCuttingSelection(page, repository, 'HOLZMA (HOMAG) HPP 250', 'PTX · CADmatic 3', 'ptx-cadmatic-3');

    await expect(page.getByTestId('machine-output-cutting-status')).toHaveText('Candidato — no validado en máquina');
    await expect(page.getByTestId('machine-output-cutting-readiness')).toHaveText('Bloqueado');
    await expect(page.getByTestId('machine-output-cutting-blocked')).toContainText(
      'No se puede generar este archivo todavía',
    );

    // Server still holds CADmatic 3 — never silently swapped for ptx-generic.
    const readModel = await repository.getMachineOutputSelections();
    const cutting = readModel.selections.find((s) => s.selection.selection.operation === 'cutting');
    expect(cutting!.selection.selection.outputCompatibilityProfileId).toBe('ptx-cadmatic-3');

    // Machining selection of the pending MPR serializer is valid and surfaces
    // the structural blocker (selection ≠ generation).
    await page.getByTestId('machine-output-machining-machine').selectOption({ label: 'WEEKE (HOMAG) BHX 050' });
    await page.getByTestId('machine-output-machining-profile').selectOption({ label: 'MPR · woodWOP' });
    await page.getByTestId('machine-output-machining-save').click();
    await expect
      .poll(
        async () => {
          const readModel = await repository.getMachineOutputSelections();
          return readModel.selections.find((s) => s.selection.selection.operation === 'machining')
            ?.selection.selection.outputCompatibilityProfileId;
        },
        { timeout: 15_000 },
      )
      .toBe('mpr-woodwop');
    await expect(page.getByTestId('machine-output-machining-readiness')).toHaveText('Bloqueado');
    await expect(page.getByTestId('machine-output-machining-blocked')).toContainText(
      'serializador',
    );
  });

  test('CADmatic 4 candidate (r3, #661) resolves ready while staying an unvalidated candidate', async ({ page }) => {
    test.setTimeout(90_000);

    const { repository } = await api();
    await loginToA(page);
    await openEngineeringSettings(page);
    // Switching is an explicit user action — never an automatic fallback.
    await saveCuttingSelection(page, repository, 'HOLZMA (HOMAG) HPP 250', 'PTX · CADmatic 4', 'ptx-cadmatic-4');
    await page.reload();
    await page.getByTestId('settings-tab-tab-ingenieria').click();

    // Ready (the revision's real compilation preflight passes) but honest
    // about field state: candidate, not validated on the machine.
    await expect(page.getByTestId('machine-output-cutting-status')).toHaveText('Candidato — no validado en máquina');
    await expect(page.getByTestId('machine-output-cutting-readiness')).toHaveText('Listo');

    const readModel = await repository.getMachineOutputSelections();
    const cutting = readModel.selections.find((s) => s.selection.selection.operation === 'cutting');
    expect(cutting!.selection.selection.outputCompatibilityProfileId).toBe('ptx-cadmatic-4');
    expect(cutting!.selection.selection.outputCompatibilityProfileRevisionId).toBe('r3');
    expect(cutting!.blockers).toEqual([]);
    expect(cutting!.supportStatus).toBe('NOT_TESTED');

    await seedCuttingProject(repository);
    await page.goto(`/engineering/${EXPORT_PROJECT_ID}`);
    await page.getByTestId('eng-tab-optimizacion').click();
    const exportButton = page.getByTestId('prod-opt-export-ptx');
    await expect(exportButton).toBeEnabled();
    const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);
    const path = await download.path();
    const text = new TextDecoder().decode(await readFile(path!));
    expect(download.suggestedFilename()).toMatch(/^corte-.*\.ptx$/);
    expect(text.startsWith('HEADER,')).toBe(true);
    expect(text).not.toContain('[HEADER]');
  });

  test('stale editor gets a typed VERSION_CONFLICT, never a silent overwrite', async () => {
    const { client, token } = await api();

    const latest = await client.listMachineOutputSelections(token);
    const cutting = latest.selections.find((s) => s.selection.operation === 'cutting');
    const version = cutting?.selection.version ?? 0;

    // Editor A moves the version forward.
    await client.upsertMachineOutputSelection(token, 'cutting', {
      selection: { ...CUTTING_GENERIC },
      expectedVersion: version,
    });

    // Editor B still holds the previous version: typed conflict.
    await expect(
      client.upsertMachineOutputSelection(token, 'cutting', {
        selection: { ...CUTTING_CADMATIC4_CANDIDATE },
        expectedVersion: version,
      }),
    ).rejects.toMatchObject({ status: 409, payload: { code: 'VERSION_CONFLICT' } });
  });

  test('org B never reads org A machine output configuration', async () => {
    const base = required('ORGANIZATION_API_BASE');
    const bOwner = await new GraneteApiClient(base).login({
      email: required('ORGANIZATION_GATE_B_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_B_SLUG'),
    });
    const repositoryB = new APIWorkspaceRepository(base, { getAccessToken: () => bOwner.token });
    const readModelB = await repositoryB.getMachineOutputSelections();
    expect(readModelB.selections).toEqual([]);
  });

  for (const lateStatus of [200, 500]) test(`late org A ${lateStatus} cannot govern org B`, async ({ page }) => {
    test.setTimeout(90_000);
    let releaseA = () => undefined;
    let markAStarted = () => undefined;
    const started = new Promise<void>((resolve) => { markAStarted = resolve; });
    const gate = new Promise<void>((resolve) => { releaseA = resolve; });
    let firstGet = true;
    await page.route('**/api/machine-output-selections', async (route) => {
      if (route.request().method() !== 'GET' || !firstGet) return route.continue();
      firstGet = false;
      const response = await route.fetch();
      markAStarted();
      await gate;
      return lateStatus === 200
        ? route.fulfill({ response }).catch(() => undefined)
        : route.fulfill({ status: 500, body: '{}' }).catch(() => undefined);
    });

    await loginToA(page);
    await started;
    const bResponse = page.waitForResponse((response) =>
      response.url().includes('/api/machine-output-selections'),
    );
    await page.getByLabel('Cambiar organización').selectOption({ label: 'Browser Gate B' });
    await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate B');
    expect((await bResponse).status()).toBe(403);
    releaseA();
    await page.waitForTimeout(150);
    await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate B');
  });

  test.afterAll(async () => {
    // Leave org A in a clean, ready state for other suites. Re-read the
    // version right before the write and retry once on conflict.
    const { client, token } = await api();
    for (let attempt = 0; attempt < 2; attempt++) {
      const latest = await client.listMachineOutputSelections(token);
      const cutting = latest.selections.find((s) => s.selection.operation === 'cutting');
      const expected = cutting?.selection.version ?? 0;
      try {
        await client.upsertMachineOutputSelection(token, 'cutting', {
          selection: { ...CUTTING_GENERIC },
          expectedVersion: expected,
        });
        return;
      } catch (error) {
        if (attempt === 1) throw error;
      }
    }
  });
});
