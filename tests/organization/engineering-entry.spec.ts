import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { allowLoggedOutSessionProbe, collectBrowserErrors } from './support/browserErrors';
import { GATE_MODULE_A_ID, required } from './support/api';

/**
 * #738 — browser E2E of the canonical Engineering entry:
 *
 *   fixture (Q1 accepted + R1 approved via the supported API commands) →
 *   release P1 through the real reconciliation UI → "Abrir Ingeniería"
 *   (primary contextual exit) → exact release context (Liberación #1 ·
 *   R1 · Q1) → honest pending preparation status → back to the
 *   queue → same obra visible there → reload the exact URL keeps the pinned
 *   release → ZERO business mutations caused by navigation/reads
 *   (Project.status stays draft; no engineering completion, no materials
 *   release, no produced stamp).
 *
 * SketchUp authoring stays out of scope (licensed host): the design revision
 * is published through the supported API exactly like the neighboring
 * #502/#644 gates do. Viewports 390/768/1280 + keyboard navigation pin the
 * affected content (queue card, workspace header strip, live-view notice).
 */

const PROJECT_ID = '99997777-cccc-4777-8777-7777777777ee';
const QUOTE_LINE_ID = '99998888-cccc-4888-8888-8888888888ee';
const CUSTOMER_ID = 'c0000000-0000-4000-8000-0000000000ee';
const ENTRY_HW = '72000000-0000-4000-8000-0000000000e1';
const ENTRY_STRUCT = '72000000-0000-4000-8000-0000000000e2';
const ENTRY_CHOICES = {};

interface SeededEngineeringEntry {
  readonly projectId: string;
  readonly designId: string;
  readonly r1Id: string;
  readonly q1Id: string;
  readonly token: string;
  readonly apiBase: string;
  readonly depthMm: number;
}

async function loginToA(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await expect(page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' })).toBeVisible();
  await page.getByRole('button', { name: /Browser Gate A/ }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

/** Keyboard-only navigation from the queue card into the workspace. */
async function tabToAndEnter(page: Page, testId: string, maxTabs = 40): Promise<void> {
  for (let i = 0; i < maxTabs; i += 1) {
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.closest('[data-testid]')?.getAttribute('data-testid') ?? el?.getAttribute('data-testid') ?? null;
    });
    if (focused === testId) {
      await page.keyboard.press('Enter');
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error(`testid ${testId} was not reachable by keyboard within ${maxTabs} tabs`);
}

test.describe.serial('Engineering entry: canonical release → queue + workspace + exact URL (#738)', () => {
  let seeded!: SeededEngineeringEntry;
  let releaseId = '';

  test.beforeAll(async () => {
    const apiBase = required('ORGANIZATION_API_BASE');
    const client = new GraneteApiClient(apiBase);
    const owner = await client.login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });

    const repository = new APIWorkspaceRepository(apiBase, {
      getAccessToken: () => owner.token,
    });
    const catalog = await repository.getCatalog();
    const template = catalog.modules.find((m) => m.id === GATE_MODULE_A_ID) ?? catalog.modules[0]!;
    const depthMm = template.externalDims?.depth || 590;
    await repository.saveCatalog({
      ...catalog,
      structures: [...(catalog.structures ?? []), { id: ENTRY_STRUCT, code: 'ENG-ENTRY-STRUCT', name: 'Cuerpo Entrada Ingeniería', externalDims: { width: 600, height: 720, depth: depthMm }, components: [], active: true }],
      hardware: [...catalog.hardware, { id: ENTRY_HW, code: 'ENG-ENTRY-HW', name: 'Herraje Entrada', unit: 'piece', costPerUnit: 10, active: true }],
      modules: [
        {
          ...template,
          id: GATE_MODULE_A_ID,
          structureId: ENTRY_STRUCT,
          components: [],
          hardwareLines: [{ id: 'eng-entry-hardware-line', hardwareId: ENTRY_HW, quantity: 1, optionRole: '' }],
          externalDims: { width: 600, height: 720, depth: depthMm },
        },
      ],
      customers: [
        {
          id: CUSTOMER_ID,
          name: 'Cliente Entrada Ingeniería E2E',
          active: true,
        },
      ],
    });

    const now = new Date().toISOString();
    await repository.saveProject({
      id: PROJECT_ID,
      name: 'Obra Entrada Ingeniería E2E',
      customerId: CUSTOMER_ID,
      currency: 'MXN',
      marginFactor: 1.3,
      laborFixedCost: 0,
      status: 'draft' as const,
      createdAt: now,
      updatedAt: now,
      items: [
        {
          id: QUOTE_LINE_ID,
          moduleId: GATE_MODULE_A_ID,
          quantity: 2,
          optionChoices: ENTRY_CHOICES,
        },
      ],
    });

    const mat = await client.materializeQuoteLineFurniture(
      owner.token,
      PROJECT_ID,
      QUOTE_LINE_ID,
      'eng-entry-materialize-line',
    );
    if (mat.instances.length !== 2) {
      throw new Error(`expected 2 materialized instances, got ${mat.instances.length}`);
    }
    const instanceIds = mat.instances.map((i) => i.furniture_instance_id);

    const design = await client.createProjectDesign(
      owner.token,
      PROJECT_ID,
      { name: 'Cocina Entrada Ingeniería' },
      'eng-entry-create-design',
    );
    await client.updateDesignWorkingCopy(owner.token, design.id, {
      items: instanceIds.map((instanceId) => ({
        furniture_instance_id: instanceId,
        furniture_definition_id: GATE_MODULE_A_ID,
        parameters: { widthMm: 600, heightMm: 720, depthMm },
        material_choices: ENTRY_CHOICES,
      })),
    });
    const r1 = await client.publishDesignRevision(
      owner.token,
      design.id,
      { source_type: 'manual', base_revision_id: null },
      'eng-entry-publish-r1',
    );

    // Q1 draft → published → accepted, through the exact supported commands.
    const q1 = await client.createInitialProjectQuoteRevision(owner.token, PROJECT_ID, {
      notes: 'Entrada a Ingeniería — revisión inicial',
    }, 'eng-entry-q1-create');
    await client.publishProjectQuoteRevision(owner.token, PROJECT_ID, q1.id, 'eng-entry-q1-publish');
    await client.acceptProjectQuoteRevision(owner.token, PROJECT_ID, q1.id, 'eng-entry-q1-accept');

    // R1 approved against the exact accepted Q1 (#502 commercial gate).
    const approved = await client.approveProjectDesignRevisionForProduction(
      owner.token,
      PROJECT_ID,
      design.id,
      r1.id,
      { quoteRevisionId: q1.id },
      'eng-entry-approve-r1-q1',
    );
    if (approved.status !== 'approved') throw new Error(`R1 not approved: ${approved.status}`);

    seeded = {
      projectId: PROJECT_ID,
      designId: design.id,
      r1Id: r1.id,
      q1Id: q1.id,
      token: owner.token,
      apiBase,
      depthMm,
    };
  });

  /** Server truth snapshot used to prove navigation/reads don't mutate. */
  async function serverTruth(): Promise<Record<string, unknown>> {
    const detail = await (
      await fetch(`${seeded.apiBase}/projects/${PROJECT_ID}`, {
        headers: { Authorization: `Bearer ${seeded.token}` },
      })
    ).json();
    return detail as Record<string, unknown>;
  }

  test('release P1 through the UI → Abrir Ingeniería opens the exact released context', async ({ page }) => {
    test.setTimeout(240_000);
    await loginToA(page);

    // Exact Q/R context pinned in the URL (never an implicit latest).
    await page.goto(
      `/quotes/${PROJECT_ID}/reconciliacion?qrev=${seeded.q1Id}&design=${seeded.designId}&rev=${seeded.r1Id}`,
    );
    await expect(page.getByTestId('project-reconciliation-workspace')).toBeVisible();

    // P1 through the real release command UI.
    await expect(page.getByTestId('open-release-review-btn')).toBeEnabled();
    await page.getByTestId('open-release-review-btn').click();
    await expect(page.getByTestId('release-review-modal')).toBeVisible();
    await page.getByTestId('submit-release').click();
    await expect(page.getByTestId('release-success')).toBeVisible();

    // #738: the MAIN contextual exit is preparing the release in Engineering.
    const engineeringBtn = page.getByTestId('release-success-open-engineering');
    await expect(engineeringBtn).toBeVisible();
    await expect(engineeringBtn).toContainText('Abrir Ingeniería');
    await engineeringBtn.click();

    // The workspace opens pinned to the release the command returned.
    await expect(page).toHaveURL(new RegExp(`/engineering/${PROJECT_ID}\\?release=`));
    releaseId = page.url().split('release=')[1]!.split('&')[0]!;
    expect(releaseId).toMatch(/^[0-9a-f-]{36}$/i);

    await expect(page.getByTestId('eng-release-context')).toBeVisible();
    await expect(page.getByTestId('eng-release-context')).toContainText('Liberación #1');
    await expect(page.getByTestId('eng-release-context')).toContainText('R1 · Q1');

    // Honest preparation status: the release enables preparation; it does
    // NOT complete engineering.
    await expect(page.getByTestId('eng-entry-status')).toContainText('Pendiente');

    // Live data tabs are separated from frozen release content and the
    // live-data document downloads are not offered as release documents.
    await expect(page.getByTestId('eng-live-view-notice')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Documentos' })).toHaveCount(0);
    // Legacy handshake/log actions are absent for a canonical obra.
    await expect(page.getByTestId('eng-send-to-production')).toHaveCount(0);
    await expect(page.getByTestId('eng-mark-documented')).toHaveCount(0);
  });

  test('obra visible in the Engineering queue (Project still draft) and keyboard-reachable', async ({ page }) => {
    test.setTimeout(120_000);
    expect(releaseId).not.toBe('');
    await loginToA(page);
    await page.goto('/engineering');
    await expect(page.getByTestId('eng-project-' + PROJECT_ID)).toBeVisible();
    const card = page.getByTestId('eng-project-' + PROJECT_ID);
    await expect(card).toContainText('Pendiente');
    await expect(card).toContainText('Liberación #1');
    // No legacy "Iniciar" log action for the canonical obra.
    await expect(card.getByRole('button', { name: 'Iniciar' })).toHaveCount(0);

    // Keyboard: the queue card body is a button — tab to it and open.
    await tabToAndEnter(page, 'eng-project-' + PROJECT_ID);
    await expect(page).toHaveURL(new RegExp(`/engineering/${PROJECT_ID}`));
    await expect(page.getByTestId('eng-release-context')).toBeVisible();
    // Entering without an explicit pin resolves the server authority ONCE
    // into the URL — the exact context is then the URL, not a moving latest.
    await expect(page).toHaveURL(new RegExp(`release=${releaseId}`));
  });

  test('reloading the exact URL keeps the pinned release and reads cause zero business mutations', async ({ page }) => {
    test.setTimeout(120_000);
    expect(releaseId).not.toBe('');

    const truthBefore = await serverTruth();
    expect(truthBefore['status']).toBe('draft');
    expect((truthBefore['resolved_production_release'] as Record<string, unknown>)['source']).toBe('canonical');

    await loginToA(page);
    await page.goto(`/engineering/${PROJECT_ID}?release=${releaseId}`);
    await expect(page.getByTestId('eng-release-context')).toBeVisible();
    await expect(page.getByTestId('eng-release-context')).toContainText('Liberación #1');
    await expect(page.getByTestId('eng-entry-status')).toContainText('Pendiente');

    // Reload: the exact selection survives; no silent retarget.
    await page.reload();
    await expect(page.getByTestId('eng-release-context')).toBeVisible();
    await expect(page.getByTestId('eng-release-context')).toContainText('Liberación #1');
    await expect(page.getByTestId('eng-entry-status')).toContainText('Pendiente');
    await expect(page).toHaveURL(new RegExp(`release=${releaseId}`));

    // Authoritative readback: the pinned URL names the exact release of
    // this obra (an unknown/foreign selection would fail safe, not silently
    // resolve something else).
    const readback = await (
      await fetch(`${seeded.apiBase}/projects/${PROJECT_ID}/production-releases/${releaseId}`, {
        headers: { Authorization: `Bearer ${seeded.token}` },
      })
    ).json();
    expect(readback['id']).toBe(releaseId);
    expect(readback['project_id']).toBe(PROJECT_ID);
    expect(readback['release_number']).toBe(1);
    expect(readback['design_revision_id']).toBe(seeded.r1Id);
    expect(readback['quote_revision_id']).toBe(seeded.q1Id);

    // Navigation/reads fabricated NOTHING: no acceptance, no produced
    // stamp, no engineering completion log, no materials release.
    const truthAfter = await serverTruth();
    expect(truthAfter['status']).toBe('draft');
    expect(truthAfter['engineering_log']).toBeFalsy();
    expect(truthAfter['materials_release']).toBeFalsy();
    expect((truthAfter['resolved_production_release'] as Record<string, unknown>)['release_id']).toBe(releaseId);
  });

  test('affected content renders without overflow across 390/768/1280 with accessible state', async ({ page }) => {
    test.setTimeout(180_000);
    expect(releaseId).not.toBe('');
    await loginToA(page);

    for (const viewport of [
      { name: 'compact', width: 390, height: 844 },
      { name: 'medium', width: 768, height: 900 },
      { name: 'expanded', width: 1280, height: 800 },
    ] as const) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      // Queue: the obra card is visible and named accessibly.
      await page.goto('/engineering');
      const card = page.getByTestId('eng-project-' + PROJECT_ID);
      await expect(card).toBeVisible();
      await expect(card).toContainText('Pendiente');
      const cardButton = card.locator('.eng-project-card__body');
      await expect(cardButton).toBeVisible();
      expect(await cardButton.getAttribute('aria-label') ?? (await cardButton.textContent())!).toBeTruthy();

      const queueGeometry = await page.locator('html').evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(queueGeometry.scrollWidth).toBeLessThanOrEqual(queueGeometry.clientWidth);

      // Workspace: exact release strip + live-view notice stay visible and
      // readable; keyboard tab navigation reaches the tab bar.
      await page.goto(`/engineering/${PROJECT_ID}?release=${releaseId}`);
      const strip = page.getByTestId('eng-release-context');
      await expect(strip).toBeVisible();
      await expect(strip).toContainText('Liberación #1');
      await expect(page.getByTestId('eng-entry-status')).toBeVisible();
      await expect(page.getByTestId('eng-live-view-notice')).toBeVisible();

      const workspaceGeometry = await page.locator('html').evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(workspaceGeometry.scrollWidth).toBeLessThanOrEqual(workspaceGeometry.clientWidth);

      // Keyboard: activating the Despiece tab moves focus/selection.
      await page.getByRole('tab', { name: 'Despiece' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#eng-panel-despiece')).toBeVisible();
    }
  });

  // ------------------------------------------------------------------
  // #644 milestone negative — a pinned release that does not exist for this
  // obra is never silently substituted by the real P1: the workspace fails
  // SAFE with the honest "Liberación no disponible" state (#738 hook), and
  // no release-scoped content or downloads render for the bogus pin.
  // ------------------------------------------------------------------
  test('pinned nonexistent release fails safe: no substitution by the real P1', async ({ page }) => {
    test.setTimeout(90_000);
    expect(releaseId).not.toBe('');
    const browserErrors = collectBrowserErrors(page, {
      // This test deliberately pins an unknown release: the exact 404 the
      // probe provokes on the release-context endpoint is an EXPECTED
      // negative response, allowlisted by status AND endpoint so any other
      // console error still fails the journey.
      allow: (message, resourceUrl) =>
        allowLoggedOutSessionProbe(message, resourceUrl)
        || (message.includes('404') && resourceUrl.includes('/production-releases/')),
    });
    await loginToA(page);

    const nonexistentReleaseId = 'deadbeef-0000-4000-8000-0000000000ee';
    await page.goto(`/engineering/${PROJECT_ID}?release=${nonexistentReleaseId}`);

    await expect(page.getByText('Liberación no disponible')).toBeVisible();
    // No release strip, no workspace tabs: the real P1 never stands in.
    await expect(page.getByTestId('eng-release-context')).toHaveCount(0);
    await expect(page.getByTestId('eng-tab-despiece')).toHaveCount(0);
    await browserErrors.assertEmpty('engineering entry — nonexistent pinned release');
  });
});
