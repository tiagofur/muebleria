import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { GATE_MODULE_A_ID, required } from './support/api';

/**
 * #642 Legacy Quote Recovery — real browser E2E (Chromium + Go + PostgreSQL).
 *
 * Old quotes created before `commercialSnapshot` exist must NOT feel "broken":
 * their persisted furniture/configuration is shown read-only, unavailability is
 * honest (never $0, never recalculated), and the user can modernize by minting
 * the NEXT revision with a canonical snapshot. The legacy revision itself is
 * never mutated.
 *
 * The legacy row shape (snapshot-less quote revision) predates migration
 * 000130 and no API can produce it — the fixture seeds it through the admin
 * DSN the gate exports (fixture only; the verified flow is pure API/UI).
 */

const PROJECT_ID = '77777777-8888-4777-8777-888888888888';
const QUOTE_LINE_ID = '88888888-8888-4888-8888-888888888888';
const CUSTOMER_ID = 'c0000000-0000-4000-8000-000000000088';
const LEGACY_REVISION_ID = '99999999-8888-4888-8888-888888888888';
const PROJECT_NAME = 'Obra Legacy Recovery E2E';
const CUSTOMER_NAME = 'Cliente Legacy E2E';

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

test.describe.serial('#642 legacy quote recovery', () => {
  let token: string;
  let client: GraneteApiClient;
  let instanceIds: string[];
  let templateDepthMm: number;

  test.beforeAll(async () => {
    const apiBase = required('ORGANIZATION_API_BASE');
    client = new GraneteApiClient(apiBase);
    const aOwner = await client.login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    token = aOwner.token;

    const repository = new APIWorkspaceRepository(apiBase, { getAccessToken: () => token });
    const catalog = await repository.getCatalog();
    const template = catalog.modules.find((m) => m.id === GATE_MODULE_A_ID) ?? catalog.modules[0]!;
    const depthMm = template.externalDims?.depth || 590;
    await repository.saveCatalog({
      ...catalog,
      customers: [...(catalog.customers ?? []).filter((c) => c.id !== CUSTOMER_ID), { id: CUSTOMER_ID, name: CUSTOMER_NAME, active: true }],
      modules: [
        ...catalog.modules.filter((m) => m.id !== GATE_MODULE_A_ID),
        { ...template, id: GATE_MODULE_A_ID, externalDims: { width: 600, height: 720, depth: depthMm } },
      ],
    });

    const now = new Date().toISOString();
    await repository.saveProject({
      id: PROJECT_ID,
      name: PROJECT_NAME,
      customerId: CUSTOMER_ID,
      currency: 'MXN',
      marginFactor: 1.3,
      laborFixedCost: 0,
      status: 'draft' as const,
      createdAt: now,
      updatedAt: now,
      items: [{ id: QUOTE_LINE_ID, moduleId: GATE_MODULE_A_ID, quantity: 3, optionChoices: {} }],
    });

    // Materialize the line's 3 physical units through the supported API.
    templateDepthMm = depthMm;
    const mat = await client.materializeQuoteLineFurniture(
      token,
      PROJECT_ID,
      QUOTE_LINE_ID,
      'gate-legacy-recovery-materialize',
    );
    instanceIds = mat.instances.map((i) => i.furniture_instance_id);
    if (instanceIds.length !== 3) throw new Error(`expected 3 materialized units, got ${instanceIds.length}`);

    // Seed the pre-#642 row shape: an ACCEPTED legacy revision without
    // commercial snapshot, with its per-unit items persisted. This shape only
    // exists pre-migration 000130; the gate's admin DSN exists exactly for
    // fixture seeding like this.
    const pool = new Pool({ connectionString: required('ORGANIZATION_TEST_DATABASE_URL') });
    try {
      await pool.query('BEGIN');
      await pool.query('ALTER TABLE quote_revisions DISABLE TRIGGER protect_quote_revisions_immutable');
      const org = await pool.query<{ organization_id: string }>(
        'SELECT organization_id::text AS organization_id FROM projects WHERE id = $1',
        [PROJECT_ID],
      );
      const organizationId = org.rows[0]!.organization_id;
      await pool.query(
        `INSERT INTO quote_revisions
           (id, organization_id, project_id, revision_number, status, source_type, notes,
            created_at, published_at, accepted_at, commercial_snapshot)
         VALUES ($1, $2, $3, 1, 'accepted', 'manual', 'Presupuesto anterior (pre-congelado)',
                 NOW() - INTERVAL '30 days', NOW() - INTERVAL '29 days', NOW() - INTERVAL '28 days', NULL)`,
        [LEGACY_REVISION_ID, organizationId, PROJECT_ID],
      );
      for (const instanceId of instanceIds) {
        await pool.query(
          `INSERT INTO quote_revision_items
             (quote_revision_id, organization_id, project_id, furniture_instance_id,
              furniture_definition_id, parameters, material_choices, lifecycle_status)
           VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, 'active')`,
          [
            LEGACY_REVISION_ID,
            organizationId,
            PROJECT_ID,
            instanceId,
            GATE_MODULE_A_ID,
            JSON.stringify({ widthMm: 600, heightMm: 720, depthMm }),
          ],
        );
      }
      await pool.query('ALTER TABLE quote_revisions ENABLE TRIGGER protect_quote_revisions_immutable');
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK').catch(() => undefined);
      await pool.query('ALTER TABLE quote_revisions ENABLE TRIGGER protect_quote_revisions_immutable').catch(() => undefined);
      throw error;
    } finally {
      await pool.end();
    }
  });

  test('legacy detail shows persisted furniture, honest unavailability and modernize path', async ({ page }) => {
    test.setTimeout(120_000);
    await loginToA(page);

    // The LIST card is honest: "Cotización anterior", 3 muebles, no fake price.
    await page.goto('/quotes');
    const card = page.getByTestId(`project-card-${PROJECT_ID}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText('Q1 · Aceptada');
    await expect(card).toContainText('Cotización anterior');
    await expect(card).toContainText('3 muebles');
    await expect(card.getByTestId(`project-card-price-legacy-${PROJECT_ID}`)).toContainText('No disponible');
    const cardText = await card.textContent();
    expect(cardText).not.toContain('$0');
    expect(cardText).not.toContain('Sin cotización');

    // The DETAIL renders the persisted units read-only — no empty screen.
    await card.click();
    const detail = page.getByTestId('project-detail');
    await expect(detail.getByTestId('quote-legacy-badge')).toContainText('Q1 · Cotización anterior');
    await expect(detail.getByTestId('quote-legacy-header-badge')).toContainText('Q1 · Cotización anterior');
    for (const instanceId of instanceIds) {
      await expect(detail.getByTestId(`quote-legacy-unit-${instanceId}`)).toBeVisible();
    }
    await expect(detail.getByTestId('quote-legacy-dimensions-' + instanceIds[0]!)).toContainText(`600×720×${templateDepthMm} mm`);
    await expect(detail.getByTestId('project-items-legacy')).toContainText('antes del historial comercial congelado');

    // Honest money: unavailable, never zero, never recalculated.
    await expect(detail.getByTestId('legacy-price-unavailable')).toContainText('No disponible con precisión');
    expect(await detail.getByTestId('project-detail-total').textContent()).not.toContain('$0');

    // Modernize: the CTA routes to reconciliation with the exact legacy base.
    await detail.getByTestId('legacy-modernize-btn').first().click();
    await expect(page.getByTestId('legacy-modernize-panel')).toBeVisible();
    await expect(page.getByTestId('legacy-modernize-panel')).toContainText('Q1 · Cotización anterior');

    // Mint the modern Q2 through the real command. This fixture has NO design
    // context on purpose: modernization mints the next revision from the
    // current editable commercial state and must work without one. Success is
    // the panel switching off (the context now pins the modern Q2) plus the
    // API readback below.
    await page.getByTestId('legacy-modernize-btn').click();
    await expect(page.getByTestId('legacy-modernize-panel')).toHaveCount(0);

    // Q2 exists as a modern draft; Q1 is byte-intact (still accepted, still
    // snapshot-less, items untouched).
    const revisions = await client.listProjectQuoteRevisions(token, PROJECT_ID);
    const q1 = revisions.find((r) => r.id === LEGACY_REVISION_ID);
    const q2 = revisions.find((r) => r.revisionNumber === 2);
    expect(q1?.status).toBe('accepted');
    expect(q1?.commercialSnapshot ?? null).toBeNull();
    expect(q1?.items).toHaveLength(3);
    expect(q2?.status).toBe('draft');
    expect(q2?.commercialSnapshot).toBeTruthy();
    expect(q2?.baseQuoteRevisionId).toBe(LEGACY_REVISION_ID);

    // While Q2 is only a draft, the accepted legacy Q1 REMAINS the commercial
    // authority of the detail (accepted wins until superseded — 2A rule).
    await page.goto(`/quotes/${PROJECT_ID}`);
    const draftStageDetail = page.getByTestId('project-detail');
    await expect(draftStageDetail.getByTestId('quote-legacy-badge')).toContainText('Q1 · Cotización anterior');

    // #642 re-entry: with the modern Q2 already existing, coming back to the
    // detail must NOT offer a second modernization of the stale legacy base —
    // the honest action resumes the existing modern draft.
    await expect(draftStageDetail.getByTestId('legacy-modernize-btn')).toHaveCount(0);
    const continueBtn = draftStageDetail.getByTestId('legacy-continue-btn').first();
    await expect(continueBtn).toContainText('Continuar Q2');
    await continueBtn.click();

    // Reconciliation highlights the existing modern draft: no modernize CTA
    // for the stale legacy, and opening Q2 changes the context without
    // minting anything (no Q3).
    await expect(page.getByTestId('legacy-resume-latest-panel')).toBeVisible();
    await expect(page.getByTestId('legacy-resume-latest-panel')).toContainText('Ya existe una revisión moderna más reciente');
    await expect(page.getByTestId('legacy-modernize-btn')).toHaveCount(0);
    await page.getByTestId('legacy-resume-latest-btn').click();
    await expect(page.getByTestId('legacy-resume-latest-panel')).toHaveCount(0);
    await expect(page.getByTestId('legacy-modernize-panel')).toHaveCount(0);
    expect(await client.listProjectQuoteRevisions(token, PROJECT_ID)).toHaveLength(2);

    // Walk Q2 through the normal modern lifecycle (draft → published →
    // accepted); acceptance atomically supersedes the legacy baseline.
    await client.publishProjectQuoteRevision(token, PROJECT_ID, q2!.id, 'gate-legacy-q2-publish');
    const acceptedResponse = await client.acceptProjectQuoteRevision(token, PROJECT_ID, q2!.id, 'gate-legacy-q2-accept');
    expect(acceptedResponse.status).toBe('accepted');
    const acceptedViaApi = await client.listProjectQuoteRevisions(token, PROJECT_ID);
    expect(acceptedViaApi.find((r) => r.id === q2!.id)?.status).toBe('accepted');

    // The detail now renders the modern frozen authority... (the re-entry arc
    // ended on the reconciliation page — navigate back to the obra first).
    await page.goto(`/quotes/${PROJECT_ID}`);
    await page.reload();
    const modernDetail = page.getByTestId('project-detail');
    await expect(modernDetail).toBeVisible({ timeout: 20_000 });
    await expect(modernDetail.getByTestId('quote-revision-badge')).toContainText('Q2 · Solo lectura', { timeout: 20_000 });
    await expect(modernDetail.getByTestId('quote-legacy-badge')).toHaveCount(0);
    await expect(modernDetail.getByTestId('legacy-price-unavailable')).toHaveCount(0);

    // ...and the legacy row is only superseded — never rewritten, never
    // backfilled: snapshot still NULL, items still 3.
    const afterAccept = await client.listProjectQuoteRevisions(token, PROJECT_ID);
    expect(afterAccept).toHaveLength(2);
    const q1After = afterAccept.find((r) => r.id === LEGACY_REVISION_ID);
    expect(q1After?.status).toBe('superseded');
    expect(q1After?.commercialSnapshot ?? null).toBeNull();
    expect(q1After?.items).toHaveLength(3);
  });
});
