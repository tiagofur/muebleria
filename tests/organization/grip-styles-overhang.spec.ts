/**
 * #1531 browser + API proof: grip styles.
 *
 * - Settings › Diseño e Ingeniería shows that the grip is now configured as
 *   styles (the old capabilities section wrote an overlay blob that is gone).
 * - A style's overhang rejects 0 and decimals (422) and accepts 10 and 20.
 * - Making it the default replaces the previous default, and a design that
 *   selects the rebase resolves with that style's millimetres (720 → 740).
 * - The default cannot be deleted until another style is the default.
 */
import { expect, test, type Page } from '@playwright/test';
import { GraneteApiClient, type GripStyle, type GripStyleWrite } from '@granete/storage';
import { GATE_MODULE_A_ID, putWorkingCopyCurrent, required } from './support/api';

const RUN = Date.now().toString(36);

interface DesignOpeningPayload {
  readonly resolution?: {
    readonly state: string;
    readonly reason?: string;
    readonly fronts?: readonly { readonly heightMm: number }[];
  } | null;
  readonly workingVersion: string;
}

async function loginToA(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /Browser Gate A/ }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

function overhangStyle(name: string, overhangMm: number, isDefault: boolean): GripStyleWrite {
  return {
    name,
    offered: true,
    isDefault,
    byFurnitureType: {
      inferior: { mode: 'handle' },
      superior: { mode: 'bottom_overhang', overhangMm },
      alto: { mode: 'handle' },
    },
  };
}

function asWrite(style: GripStyle, isDefault: boolean): GripStyleWrite {
  return { name: style.name, offered: style.offered, isDefault, byFurnitureType: style.byFurnitureType };
}

test('1531: el rebase sale del estilo de agarre predeterminado y la pantalla vieja ya no existe', async ({ page }) => {
  test.setTimeout(240_000);
  const apiBase = required('ORGANIZATION_API_BASE');
  const client = new GraneteApiClient(apiBase);
  const owner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  const token = owner.token;

  // Every organization has exactly one default style (seed «Jaladera»).
  const initial = await client.listGripStyles(token);
  const previousDefault = initial.find((style) => style.isDefault);
  expect(previousDefault, 'the organization must have a default grip style').toBeDefined();
  expect(initial.filter((style) => style.isDefault)).toHaveLength(1);

  // The overhang rejects 0 and decimals with a Spanish 422.
  for (const bad of [0, 12.5]) {
    const refused = await client.createGripStyle(token, overhangStyle(`Rebase malo ${RUN}-${bad}`, bad, false)).then(
      () => null,
      (err: unknown) => err as { status?: number },
    );
    expect(refused?.status, `overhang ${bad} must be refused`).toBe(422);
  }

  // 10 is accepted; 20 after an If-Match update; then it becomes the default.
  const created = await client.createGripStyle(token, overhangStyle(`Rebase E2E ${RUN}`, 10, false));
  const twenty = await client.updateGripStyle(token, created.id, created.version, overhangStyle(created.name, 20, false));
  const asDefault = await client.updateGripStyle(token, twenty.id, twenty.version, overhangStyle(twenty.name, 20, true));
  const afterSwitch = await client.listGripStyles(token);
  expect(afterSwitch.filter((style) => style.isDefault).map((style) => style.id)).toEqual([asDefault.id]);

  // The default cannot be deleted.
  const deleteDefault = await client.deleteGripStyle(token, asDefault.id, asDefault.version).then(
    () => null,
    (err: unknown) => err as { status?: number },
  );
  expect(deleteDefault?.status).toBe(422);

  const bootstrapped = await client.bootstrapProjectDesign(token, {
    projectName: `Obra rebase 1531 E2E ${RUN}`,
    designName: 'Alacena con rebase',
    newCustomer: { name: `Cliente rebase 1531 E2E ${RUN}` },
  }, `gate-1531-bootstrap-${RUN}`);
  const projectId = bootstrapped.binding.project.id;
  const designId = bootstrapped.binding.design.id;
  const furniture = await client.createProjectFurnitureInstance(
    token,
    projectId,
    { furniture_definition_id: GATE_MODULE_A_ID },
    `gate-1531-furniture-${RUN}`,
  );
  await putWorkingCopyCurrent(client, token, designId, {
    items: [{
      furniture_instance_id: furniture.id,
      furniture_definition_id: GATE_MODULE_A_ID,
      parameters: { widthMm: 600, heightMm: 720, depthMm: 350 },
    }],
  });
  const workingCopy = await client.getDesignWorkingCopy(token, designId);
  const applied = await client.request<DesignOpeningPayload>('PUT', `/designs/${designId}/opening`, {
    token,
    body: { system: 'bottom_overhang', expectedWorkingVersion: workingCopy.updated_at },
  });
  expect(applied.resolution?.state).toBe('resolved');
  expect(applied.resolution?.fronts?.[0]?.heightMm).toBe(740);

  // #1533: Ajustes › Agarres REPLACED the notice — the styles are edited in
  // the new tab and both the old notice and the old section are gone.
  await loginToA(page);
  await page.goto('/settings');
  await page.getByTestId('settings-tab-tab-agarres').click();
  await expect(page.getByTestId('grip-styles-list')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('settings-grip-notice')).toHaveCount(0);
  await expect(page.getByTestId('settings-section-opening')).toHaveCount(0);

  // Leave the shared org as other specs expect it.
  const previous = (await client.listGripStyles(token)).find((style) => style.id === previousDefault?.id);
  if (previous) await client.updateGripStyle(token, previous.id, previous.version, asWrite(previous, true));
  const mine = (await client.listGripStyles(token)).find((style) => style.id === asDefault.id);
  if (mine) await client.deleteGripStyle(token, mine.id, mine.version);
});
