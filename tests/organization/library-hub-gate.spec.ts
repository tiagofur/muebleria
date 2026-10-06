/**
 * #1184 — browser gate de organización: el hub Biblioteca y la línea
 * contextual de las superficies de autoría, contra real Go + PostgreSQL
 * desechable y un login de browser real.
 *
 *   1. Superficie de autoría (/hardware): la línea contextual identifica el
 *      borrador, el stack de revisiones NO está (sin banner, sin acciones de
 *      publicación) y el link sale al hub.
 *   2. Hub (/library): banner del borrador + historial abierto + vista
 *      consumidor; Publicar abre el modal de confirmación (diff) y se puede
 *      cancelar. Es la ÚNICA superficie con esas acciones.
 *   3. Sin autoridad de plataforma, /library rebota al inicio (paridad con
 *      /platform) y el ítem de nav no existe.
 */

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

const apiBase = required('ORGANIZATION_API_BASE');
const suffix = Date.now().toString(36);

// #1184: capturas de evidencia fuera del repo (artifacts-local está
// gitignoreado) — el PR las cita, la imagen no entra al árbol.
const EVIDENCE_DIR = join(
  process.cwd(),
  'artifacts-local',
  `library-hub-gate-${suffix}`,
);

async function shoot(page: import('@playwright/test').Page, name: string) {
  const path = join(EVIDENCE_DIR, name);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: true });
}

async function uiLogin(page: import('@playwright/test').Page, email: string, orgTopbar: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText(orgTopbar);
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

test.describe.serial('Library hub gate (#1184)', () => {
  const draftVersion = `0.hub.${suffix}`;

  test.beforeAll(async () => {
    // El owner de la org A es platform admin (el gate script lo crea así):
    // el mismo rol bibliotecario. Borrador único — el stack compartido del
    // gate tiene datos de otros specs.
    const login = await new GraneteApiClient(apiBase).login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    await new GraneteApiClient(apiBase).createStandardLibraryRelease(login.token, {
      version: draftVersion,
    });
  });

  test('superficie de autoría: línea contextual sin stack y salida al hub', async ({ page }) => {
    test.setTimeout(120_000);
    await uiLogin(page, required('ORGANIZATION_GATE_A_OWNER_EMAIL'), 'Browser Gate A');

    await page.goto('/hardware');
    const line = page.getByTestId('library-draft-context-line');
    await expect(line).toBeVisible();
    await expect(line).toContainText(`borrador v${draftVersion}`);

    // El stack ya no vive en la superficie: sin banner ni acciones.
    await expect(page.getByTestId('library-draft-workspace-banner')).toHaveCount(0);
    await expect(page.getByTestId('library-publish-open-btn')).toHaveCount(0);
    await expect(page.getByTestId('library-consumer-view-panel')).toHaveCount(0);

    // El ítem Biblioteca existe en la nav del bibliotecario.
    await expect(page.locator('nav a[href="/library"]')).toBeVisible();
    await shoot(page, 'superficie-herrajes-linea-contextual.png');

    // El link de la línea sale al hub.
    await page.getByTestId('library-draft-context-link').click();
    await expect(page).toHaveURL(/\/library$/);    const banner = page.getByTestId('library-draft-workspace-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(`próxima versión v${draftVersion}`);
    await expect(page.getByTestId('library-publish-history-panel')).toBeVisible();
    // El historial del hub nace abierto (defaultOpen).
    await expect(page.getByTestId('library-publish-history-list')).toBeVisible();
    await expect(page.getByTestId('library-consumer-view-panel')).toBeVisible();
    await shoot(page, 'hub-biblioteca.png');
  });

  test('hub: Publicar abre el modal de confirmación y se puede cancelar', async ({ page }) => {
    test.setTimeout(120_000);
    await uiLogin(page, required('ORGANIZATION_GATE_A_OWNER_EMAIL'), 'Browser Gate A');

    await page.goto('/library');
    await expect(page.getByTestId('library-draft-workspace-banner')).toBeVisible();
    await page.getByTestId('library-publish-open-btn').click();
    // El modal pide el diff al abrirse (#1102 Slice C): carga, diff o el
    // 422 del borrador que no compila (el stack puede no tener perfiles
    // activos) — cualquier estado honesto del contrato sirve.
    const modal = page.getByTestId('library-publish-modal');
    await expect(modal).toBeVisible();
    await expect(
      modal.getByTestId('library-publish-diff-loading')
        .or(modal.getByTestId('library-publish-diff-summary'))
        .or(modal.getByTestId('library-publish-diff-error')),
    ).toBeVisible();
    await page.getByTestId('library-publish-cancel-btn').click();
    await expect(modal).toHaveCount(0);
    // Cancelar no muta nada: el banner sigue presente en su estado actual.
    await expect(page.getByTestId('library-draft-workspace-banner')).toBeVisible();
  });

  test('sin autoridad de plataforma /library rebota y no hay ítem de nav', async ({ page }) => {
    test.setTimeout(120_000);
    // El owner de la org B es admin de su organización pero NO platform admin.
    await uiLogin(page, required('ORGANIZATION_GATE_B_OWNER_EMAIL'), 'Browser Gate B');

    await expect(page.locator('nav a[href="/library"]')).toHaveCount(0);
    await page.goto('/library');
    await expect(page).not.toHaveURL(/\/library/);
    await expect(page.getByTestId('library-draft-workspace-banner')).toHaveCount(0);
    await expect(page.getByTestId('library-draft-context-line')).toHaveCount(0);
  });
});
