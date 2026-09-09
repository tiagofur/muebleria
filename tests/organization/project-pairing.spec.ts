import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { GATE_MODULE_A_ID, required } from './support/api';

const PROJECT_ID = '77777777-3333-4777-8777-333333333333';
const QUOTE_LINE_ID = '88888888-3333-4888-8888-333333333333';
const CUSTOMER_ID = 'c0000000-0000-4000-8000-000000000003';

interface SeededPairingProject {
  readonly projectId: string;
  readonly designId: string;
  readonly r1Id: string;
  readonly instanceIds: readonly string[];
}

/**
 * #499 Slice 2 — visible Web handoff against the REAL backend: the browser
 * creates the design, opens the pairing sheet, and the test consumes the
 * code through a genuine extension-credential exchange (transport
 * 'sketchup', the same client class the plugin boundary uses). The Web may
 * only report "code accepted" — "model opened" stays Slice 3.
 */
async function seedPairingProject(): Promise<SeededPairingProject> {
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
  const cat = await repository.getCatalog();
  await repository.saveCatalog({
    ...cat,
    customers: [
      ...(cat.customers ?? []).filter((c) => c.id !== CUSTOMER_ID),
      { id: CUSTOMER_ID, name: 'Cliente Pairing E2E', active: true },
    ],
  });

  const now = new Date().toISOString();
  await repository.saveProject({
    id: PROJECT_ID,
    name: 'Obra Pairing E2E',
    customerId: CUSTOMER_ID,
    currency: 'MXN',
    marginFactor: 1.3,
    laborFixedCost: 0,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    items: [
      {
        id: QUOTE_LINE_ID,
        moduleId: GATE_MODULE_A_ID,
        quantity: 2,
        optionChoices: {},
      },
    ],
  });

  const mat = await client.materializeQuoteLineFurniture(
    owner.token,
    PROJECT_ID,
    QUOTE_LINE_ID,
    'gate-pairing-mat',
  );
  const instanceIds = mat.instances.map((i) => i.furniture_instance_id);

  const design = await client.createProjectDesign(owner.token, PROJECT_ID, {
    name: 'Cocina Pairing',
  }, 'gate-pairing-create-design');

  await client.updateDesignWorkingCopy(owner.token, design.id, {
    items: instanceIds.map((fid) => ({
      furniture_instance_id: fid,
      parameters: { width: 700 },
      material_choices: {},
    })),
  });

  const r1 = await client.publishDesignRevision(
    owner.token,
    design.id,
    { source_type: 'manual', base_revision_id: null },
    'gate-pairing-publish-r1',
  );

  return { projectId: PROJECT_ID, designId: design.id, r1Id: r1.id, instanceIds };
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

test.describe.serial('SketchUp pairing handoff (#499 Slice 2) Browser E2E', () => {
  let seeded!: SeededPairingProject;

  test.beforeAll(async () => {
    seeded = await seedPairingProject();
  });

  test('create design flow, exact pairing code, real exchange, accepted wording, /muebles CTA', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await loginToA(page);

    // 1. /disenos — project context visible, CTA available.
    await page.goto(`/quotes/${seeded.projectId}/disenos`);
    const workspace = page.getByTestId('project-designs-workspace');
    await expect(workspace).toBeVisible();
    await expect(page.getByText('Obra Pairing E2E')).toBeVisible();
    await expect(page.getByTestId('open-in-sketchup-btn')).toBeVisible();

    // 2. Select the exact published revision R1 before opening the sheet.
    await page.getByTestId('revision-node-R1').click();
    await expect(page.getByTestId('revision-inspector')).toBeVisible();

    // 3. Open the pairing sheet: pending state + visible code + frozen base.
    await page.getByTestId('open-in-sketchup-btn').click();
    const modal = page.getByTestId('sketchup-pairing-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('pairing-pending')).toContainText('Esperando conexión con SketchUp');
    await expect(page.getByTestId('pairing-base-label')).toHaveText('Base: R1');
    const codeText = (await page.getByTestId('pairing-code').textContent()) ?? '';
    const code = codeText.replace(/\s+/g, '');
    expect(code).toMatch(/^[A-Z2-9]{12}$/);

    // 4. Consume the code through the REAL extension-credential boundary.
    const apiBase = required('ORGANIZATION_API_BASE');
    const client = new GraneteApiClient(apiBase);
    const extensionSession = await client.login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'sketchup',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    const exchanged = await client.exchangeDesignPairingGrant(extensionSession.token, { code });
    // Slice 1 contract: exact design + authoritative working-copy base R1.
    expect(exchanged.design.id).toBe(seeded.designId);
    expect(exchanged.working_copy.base_revision_id).toBe(seeded.r1Id);
    expect(exchanged.pinned_base_revision_id).toBe(seeded.r1Id);

    // 5. The Web sheet observes the exchange — honest wording only.
    await expect(page.getByTestId('pairing-exchanged')).toContainText(
      'Código aceptado por SketchUp',
    );
    await expect(page.getByText(/abierto correctamente/i)).toHaveCount(0);

    // Close: an exchanged grant is NOT cancelled on close.
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);

    // 6. /muebles — physical units and the designs CTA.
    await page.goto(`/quotes/${seeded.projectId}/muebles`);
    await expect(page.getByTestId('pf-table')).toBeVisible();
    await expect(page.getByTestId('pf-table').locator('tbody tr')).toHaveCount(seeded.instanceIds.length);
    const gotoDesigns = page.getByTestId('pf-goto-designs-btn');
    if (await gotoDesigns.isVisible()) {
      await gotoDesigns.click();
      await expect(page).toHaveURL(new RegExp(`/quotes/${seeded.projectId}/disenos`));
    }

    // 7. Responsive: the sheet stays usable at ~390px.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/quotes/${seeded.projectId}/disenos`);
    await expect(page.getByTestId('open-in-sketchup-btn')).toBeVisible();
    await page.getByTestId('open-in-sketchup-btn').click();
    await expect(page.getByTestId('sketchup-pairing-modal')).toBeVisible();
    await expect(page.getByTestId('pairing-code')).toBeVisible();
    await expect(page.getByTestId('pairing-copy-btn')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  // #499 Slice 3 cross-surface proof: the full confirmed handoff plus the
  // publish round-trip. The plugin's HTTP halves (exchange through the
  // extension credential + confirm of the exact persisted identity) run
  // through the same API surface and transport the plugin uses; the host
  // dictionary persistence half is proven by TC_PairingConnectSmoke under
  // TestUp (real SketchUp), which CI cannot host.
  test('confirmed handoff, publish R1→R2 immutable lineage, stale-base pin', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const apiBase = required('ORGANIZATION_API_BASE');
    const client = new GraneteApiClient(apiBase);
    const owner = await client.login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    const extension = await client.login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'sketchup',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });

    await loginToA(page);

    // 1. New design (no published revision yet) → grant pins null.
    const design = await client.createProjectDesign(owner.token, seeded.projectId, {
      name: 'Cocina Confirmada',
    }, 'gate-pairing3-create-design');

    await page.goto(`/quotes/${seeded.projectId}/disenos`);
    await page.getByRole('tab', { name: 'Cocina Confirmada' }).click();
    await page.getByTestId('open-in-sketchup-btn').click();
    await expect(page.getByTestId('pairing-base-label')).toHaveText('Base: Sin revisión publicada');
    const codeText1 = (await page.getByTestId('pairing-code').textContent()) ?? '';
    const code1 = codeText1.replace(/\s+/g, '');

    // 2. Plugin receive halves through the extension credential: exchange
    //    returns the exact context; the "persisted binding" is the exact
    //    identity a plugin readback would confirm.
    const exchange1 = await client.exchangeDesignPairingGrant(extension.token, { code: code1 });
    expect(exchange1.design.id).toBe(design.id);
    expect(exchange1.pinned_base_revision_id).toBeNull();
    const confirm1 = await client.confirmDesignPairingGrant(extension.token, exchange1.grant_id, {
      project_id: seeded.projectId,
      design_id: design.id,
    });
    expect(confirm1.status).toBe('confirmed');

    // 3. Web observes CONFIRMATION — the honest terminal wording.
    // The modal polls every four seconds. Its in-flight request may have read
    // pending immediately before the extension committed confirmation, so
    // allow the next authoritative poll instead of racing a five-second CI
    // window.
    try {
      // 30s = CI timer slack, not a weaker assertion: the server already
      // confirmed (asserted above); the sheet only needs ONE 4s poll to
      // observe it. On shared CI runners the interval can be delayed well
      // past 15s while the box runs postgres+go+vite+chromium together.
      await expect(page.getByTestId('pairing-confirmed')).toContainText(
        'Diseño vinculado en SketchUp',
        { timeout: 30_000 },
      );
    } catch (err) {
      // Diagnostics for the intermittent CI-only miss of this wait: capture
      // what the sheet actually held (state line, poll error, modal presence)
      // plus the server's authoritative grant, then rethrow.
      const sheet = await page.evaluate(() => {
        const modal = document.querySelector('[data-testid="sketchup-pairing-modal"]');
        const status = modal?.querySelector('[data-testid^="pairing-"]')?.textContent ?? null;
        const pollError = document.querySelector('[data-testid="pairing-poll-error"]')?.textContent ?? null;
        return {
          url: window.location.href,
          modalPresent: modal !== null,
          statusLine: status,
          pollError,
          modalText: modal?.textContent?.slice(0, 400) ?? null,
        };
      });
      const grantState = await client
        .getDesignPairingGrant(owner.token, seeded.projectId, design.id, exchange1.grant_id)
        .catch((e: unknown) => `lookup failed: ${String(e)}`);
      console.log('[pairing-confirm-debug]', JSON.stringify({ sheet, grantState }));
      throw err;
    }
    await page.keyboard.press('Escape');

    // 4. Publish R1 through the existing revision pipeline.
    await client.updateDesignWorkingCopy(owner.token, design.id, {
      items: [{ furniture_instance_id: seeded.instanceIds[0]!, parameters: { width: 650 }, material_choices: {} }],
    });
    const r1 = await client.publishDesignRevision(owner.token, design.id, {
      source_type: 'manual', base_revision_id: null,
    }, 'gate-pairing3-r1');

    // 5. Web reload sees R1 (server authority, no optimistic UI).
    await page.reload();
    await page.getByRole('tab', { name: 'Cocina Confirmada' }).click();
    await expect(page.getByTestId('revision-node-R1')).toBeVisible();

    // 6. Edit and publish R2; R1 stays immutable in the lineage.
    await client.updateDesignWorkingCopy(owner.token, design.id, {
      items: [
        { furniture_instance_id: seeded.instanceIds[0]!, parameters: { width: 650 }, material_choices: {} },
        { furniture_instance_id: seeded.instanceIds[1]!, parameters: { width: 750 }, material_choices: {} },
      ],
    });
    const r2 = await client.publishDesignRevision(owner.token, design.id, {
      source_type: 'manual', base_revision_id: r1.id,
    }, 'gate-pairing3-r2');

    await page.reload();
    await expect(page.getByTestId('revision-node-R1')).toBeVisible();
    await expect(page.getByTestId('revision-node-R2')).toBeVisible();
    await page.getByTestId('revision-node-R1').click();
    const inspector = page.getByTestId('revision-inspector');
    await expect(inspector.getByTestId('revision-items-table').locator('tbody tr')).toHaveCount(1);

    // 7. Stale-base pin: with R2 published, the Web pins the SELECTED R1 and
    //    the exchange keeps R1 verbatim while carrying the R2 working truth.
    await page.getByTestId('open-in-sketchup-btn').click();
    await expect(page.getByTestId('pairing-base-label')).toHaveText('Base: R1');
    const codeText2 = (await page.getByTestId('pairing-code').textContent()) ?? '';
    const code2 = codeText2.replace(/\s+/g, '');
    const exchange2 = await client.exchangeDesignPairingGrant(extension.token, { code: code2 });
    expect(exchange2.pinned_base_revision_id).toBe(r1.id);
    // The authoritative working truth advanced to R2 while the grant keeps
    // its exact R1 pin — never a silent rebase.
    expect(exchange2.working_copy.base_revision_id).toBe(r2.id);
    // A stale pin (R1) confirmed against the R1 grant identity is exact.
    const confirm2 = await client.confirmDesignPairingGrant(extension.token, exchange2.grant_id, {
      project_id: seeded.projectId,
      design_id: design.id,
      base_revision_id: r1.id,
    });
    expect(confirm2.status).toBe('confirmed');

    // 8. Replay: the consumed code cannot bind a second time.
    await expect(
      client.exchangeDesignPairingGrant(extension.token, { code: code2 }),
    ).rejects.toThrow();
    await page.keyboard.press('Escape');
  });
});
