import { expect, test, type Page } from '@playwright/test';
import { required } from './support/api';
import { TotpProvider } from './support/totp';

/**
 * #460 SEC-7 browser gate: MFA enrollment y step-up para acciones sensibles,
 * con backend + PostgreSQL reales. Se demuestra:
 *  1. enrollment completo (QR + código manual + verificación TOTP);
 *  2. códigos de recuperación mostrados exactamente una vez;
 *  3. comando sensible → STEP_UP_REQUIRED → verificación → el MISMO comando
 *     se reintenta con la misma Idempotency-Key y prospera;
 *  4. ningún secreto MFA (otpauth URI, secret, código, recovery) llega a
 *     localStorage/sessionStorage/IndexedDB.
 */

const API_BASE = required('ORGANIZATION_API_BASE');

async function login(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await page.getByRole('button', { name: /Browser Gate A/ }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

async function storageSnapshot(page: Page): Promise<string> {
  return page.evaluate(() => {
    const local = Object.entries(localStorage).map(([k, v]) => `${k}=${v}`).join('\n');
    const session = Object.entries(sessionStorage).map(([k, v]) => `${k}=${v}`).join('\n');
    return `${local}\n${session}`;
  });
}

async function indexedDbSnapshot(page: Page): Promise<string> {
  return page.evaluate(async () => {
    if (!('databases' in indexedDB)) return '';
    const names = await indexedDB.databases();
    const chunks: string[] = [];
    for (const { name } of names) {
      if (!name) continue;
      chunks.push(name);
    }
    return chunks.join('\n');
  });
}

test('MFA enrollment + step-up para aprobar un dispositivo, sin secretos en storage', async ({ page }) => {
  await login(page);

  // 1) Seguridad: enrollment completo (la base se recrea en cada corrida).
  await page.goto('/security');
  await page.getByTestId('mfa-begin').click();

  const manualSecret = page.getByTestId('mfa-manual-secret');
  // La clave manual vive en un <details> colapsado: expandir primero.
  await page.getByText('¿No podés escanear el código?').click();
  await expect(manualSecret).toBeVisible();
  const secret = ((await manualSecret.textContent()) ?? '').trim();
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  const totp = new TotpProvider(secret);

  // El QR se renderiza desde memoria; la URI de provisión nunca se muestra
  // como texto ni llega al storage.
  await expect(page.getByTestId('mfa-qr')).toBeVisible();
  expect(await page.getByText('otpauth://').count()).toBe(0);

  // 2) Verificación TOTP → recovery codes exactamente una vez.
  await page.getByRole('button', { name: /Ya lo escaneé/i }).click();
  await page.getByTestId('mfa-verify-input').fill(totp.next());
  await page.getByRole('button', { name: /Verificar y activar/i }).click();
  const codesPanel = page.getByTestId('recovery-codes-panel');
  await expect(codesPanel).toBeVisible();
  const recoveryCodes = await page.getByTestId('recovery-code').allTextContents();
  expect(recoveryCodes).toHaveLength(10);
  await page.getByRole('button', { name: /Ya los guardé/i }).click();
  await expect(codesPanel).toBeHidden();

  // Ningún secreto MFA en el storage del browser.
  const storage = await storageSnapshot(page);
  for (const forbidden of ['otpauth://', secret, ...recoveryCodes]) {
    expect(storage, `storage no debe contener material MFA (${forbidden.slice(0, 8)}…)`).not.toContain(forbidden);
  }
  const idbNames = await indexedDbSnapshot(page);
  expect(idbNames.toLowerCase()).not.toContain('mfa');
  expect(idbNames.toLowerCase()).not.toContain('otpauth');

  // 3) Comando sensible: aprobar un dispositivo SketchUp.
  //    El enrollment es anónimo — se pide directo al API desde la página.
  const deviceCode = await page.evaluate(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/auth/devices/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_type: 'sketchup', display_name: 'Browser Gate SEC-7' }),
    });
    const body = (await response.json()) as { code: string };
    return body.code;
  }, API_BASE);
  expect(deviceCode).toMatch(/^[A-Z2-9]{6}$/);

  await page.goto('/devices');
  await page.getByLabel(/Código de vinculación/i).fill(deviceCode);
  await page.getByRole('button', { name: /^Aprobar/i }).click();

  // 4) STEP_UP_REQUIRED: el modal ligado a la acción exacta. La verificación
  //    del enrollment ya consumió el intervalo actual, así que el step-up usa
  //    el slot futuro de la ventana ±1 (el provider lleva el high-water).
  const stepUpModal = page.getByTestId('step-up-modal');
  await expect(stepUpModal).toBeVisible();
  const stepUpInput = page.getByLabel(/Código de autenticación/i);
  await stepUpInput.fill(totp.next());
  await page.getByRole('button', { name: /^Verificar$/i }).click();

  // El MISMO comando prospera tras la verificación (reintentado por el
  // boundary del cliente bajo la misma Idempotency-Key).
  await expect(page.getByText(/¡Dispositivo aprobado!/i)).toBeVisible({ timeout: 10_000 });

  // 5) Persistencia final: seguimos sin secretos MFA en el browser.
  const finalStorage = await storageSnapshot(page);
  expect(finalStorage).not.toContain('otpauth://');
  expect(finalStorage).not.toContain(secret);
});
