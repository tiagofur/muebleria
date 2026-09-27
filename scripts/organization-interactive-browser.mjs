import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

let context;
try {
  const webURL = required('ORGANIZATION_WEB_URL');
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(webURL)) throw new Error('unsafe web URL');
  context = await chromium.launchPersistentContext(required('ORGANIZATION_BROWSER_PROFILE'), {
    headless: false,
  });
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(webURL);
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true })
    .fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await page.getByRole('button', { name: required('ORGANIZATION_GATE_ORG_NAME') }).click();
  await page.locator('.app-topbar__organization-text strong').waitFor();
  const tour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await tour.isVisible()) await tour.getByRole('button', { name: 'Omitir' }).click();
  await writeFile(required('ORGANIZATION_BROWSER_READY'), 'ready\n', { mode: 0o600 });
  await new Promise((resolve) => {
    process.once('SIGTERM', resolve);
    process.once('SIGINT', resolve);
    context.once('close', resolve);
  });
  await context.close().catch(() => {});
} catch {
  if (context) await context.close().catch(() => {});
  process.stderr.write('interactive browser setup failed\n');
  process.exitCode = 1;
}
