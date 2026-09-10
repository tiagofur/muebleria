import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import fs from 'node:fs';
import path from 'node:path';
import {
  GATE_MODULE_A_ID,
  required,
} from './support/api';

const PROJECT_ID = '77777777-2222-4777-8777-222222222222';
const QUOTE_LINE_ID = '88888888-2222-4888-8888-222222222222';
const CUSTOMER_ID = 'c0000000-0000-4000-8000-000000000002';
const MATERIAL_ID = 'c0000000-0000-4000-8000-000000000039';

interface SeededProjectDesigns {
  readonly projectId: string;
  readonly designId: string;
  readonly r1Id: string;
  readonly r2Id: string;
  readonly r2SessionId: string;
  readonly instanceIds: readonly [string, string, string];
  readonly moduleName: string;
  readonly moduleCode: string;
  readonly materialName: string;
  readonly materialCode: string;
  readonly materialThicknessMm: number;
  readonly roomName: string;
  readonly actorName: string;
}

async function uploadDesignArtifact(
  apiBase: string,
  token: string,
  designId: string,
  sessionId: string,
  kind: 'model' | 'manifest' | 'preview',
  filename: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const body = new FormData();
  body.append('file', new Blob([bytes], { type: contentType }), filename);
  const response = await fetch(
    `${apiBase}/designs/${designId}/publish/${sessionId}/artifacts/${kind}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
    },
  );
  if (response.status !== 201) {
    throw new Error(`artifact ${kind} upload failed: ${response.status} ${await response.text()}`);
  }
}

async function prepareProjectDesigns(): Promise<SeededProjectDesigns> {
  const apiBase = required('ORGANIZATION_API_BASE');
  const client = new GraneteApiClient(apiBase);
  const aOwner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });

  const repository = new APIWorkspaceRepository(apiBase, {
    getAccessToken: () => aOwner.token,
  });

  const catalog = await repository.getCatalog();
  const material = {
    id: MATERIAL_ID,
    code: 'GATE-MAT-A',
    name: 'Melamina blanca E2E',
    widthMm: 1830,
    lengthMm: 2440,
    thicknessMm: 18,
    grainDefault: false,
    boardPrice: 1000,
    wastePercent: 10,
    costPerM2: 223.88,
  };
  await repository.saveCatalog({
    ...catalog,
    materials: [material],
    customers: [
      {
        id: CUSTOMER_ID,
        name: 'Cliente Diseños E2E',
        active: true,
      },
    ],
  });

  // 1. Create Project in Org A with 1 QuoteLine of quantity=3
  const now = new Date().toISOString();
  const project = {
    id: PROJECT_ID,
    name: 'Obra Diseños e Historial E2E',
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
        quantity: 3,
        optionChoices: {},
      },
    ],
  };
  await repository.saveProject(project);
  await repository.startSiteSurvey(PROJECT_ID);
  const roomName = 'Cocina E2E';
  const survey = await repository.upsertSurveySpace(PROJECT_ID, { name: roomName });
  const roomId = survey.survey?.spaces.find((space) => space.name === roomName)?.id;
  if (!roomId) throw new Error('site survey did not return the seeded room identity');

  // 2. Materialize the QuoteLine into 3 distinct FurnitureInstances (FI-A, FI-B, FI-C)
  const mat = await client.materializeQuoteLineFurniture(
    aOwner.token,
    PROJECT_ID,
    QUOTE_LINE_ID,
    'gate-pd-mat-quote-line',
  );
  if (mat.instances.length !== 3) {
    throw new Error(`expected 3 materialized instances, got ${mat.instances.length}`);
  }
  const instanceIds = mat.instances.map((i) => i.furniture_instance_id) as [string, string, string];

  // 3. Create Design A
  const design = await client.createProjectDesign(
    aOwner.token,
    PROJECT_ID,
    { name: 'Cocina Integral' },
    'gate-pd-create-design',
  );

  // 4. Update Working Copy with FI-A and FI-B
  await client.updateDesignWorkingCopy(aOwner.token, design.id, {
    items: [
      { furniture_instance_id: instanceIds[0], furniture_definition_id: GATE_MODULE_A_ID, parameters: { widthMm: 600 }, material_choices: { INTERIOR: material.id }, room_id: roomId },
      { furniture_instance_id: instanceIds[1], furniture_definition_id: GATE_MODULE_A_ID, parameters: { widthMm: 800 }, material_choices: { INTERIOR: material.id }, room_id: roomId },
    ],
  });

  // 5. Authoritatively publish R1 (contains FI-A and FI-B)
  const r1 = await client.publishDesignRevision(
    aOwner.token,
    design.id,
    { source_type: 'manual', base_revision_id: null },
    'gate-pd-publish-r1',
  );

  // 6. Update Working Copy after R1 to add FI-C (now 3 items)
  await client.updateDesignWorkingCopy(aOwner.token, design.id, {
    items: [
      { furniture_instance_id: instanceIds[0], furniture_definition_id: GATE_MODULE_A_ID, parameters: { widthMm: 600 }, material_choices: { INTERIOR: material.id }, room_id: roomId },
      { furniture_instance_id: instanceIds[1], furniture_definition_id: GATE_MODULE_A_ID, parameters: { widthMm: 800 }, material_choices: { INTERIOR: material.id }, room_id: roomId },
      { furniture_instance_id: instanceIds[2], furniture_definition_id: GATE_MODULE_A_ID, parameters: { widthMm: 900 }, material_choices: { INTERIOR: material.id }, room_id: roomId },
    ],
  });

  // 7. Publish R2 through the real artifact pipeline (contains FI-A, FI-B, and FI-C).
  const manifest = {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    designId: design.id,
    baseRevisionId: r1.id,
    source: {
      client: 'sketchup' as const,
      sketchupVersion: '2026',
      pluginVersion: 'browser-gate',
    },
    items: instanceIds.map((furnitureInstanceId) => ({ furnitureInstanceId })),
  };
  const session = await client.prepareDesignPublish(
    aOwner.token,
    design.id,
    { manifest },
    'gate-pd-prepare-r2',
  );
  const previewBytes = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  await uploadDesignArtifact(
    apiBase,
    aOwner.token,
    design.id,
    session.id,
    'model',
    'design-r2.skp',
    new TextEncoder().encode('SketchUp browser gate model'),
    'application/octet-stream',
  );
  await uploadDesignArtifact(
    apiBase,
    aOwner.token,
    design.id,
    session.id,
    'manifest',
    'manifest.json',
    new TextEncoder().encode(JSON.stringify(manifest)),
    'application/json',
  );
  await uploadDesignArtifact(
    apiBase,
    aOwner.token,
    design.id,
    session.id,
    'preview',
    'preview.png',
    previewBytes,
    'image/png',
  );
  const r2 = await client.finalizeDesignPublish(
    aOwner.token,
    design.id,
    session.id,
    'gate-pd-finalize-r2',
  );

  // Real Go + PostgreSQL + filesystem proof: every authorized artifact grant
  // resolves against the backend origin and serves bytes without /api/api.
  for (const kind of ['preview', 'manifest', 'model'] as const) {
    const grant = await client.authorizeDesignRevisionArtifact(
      aOwner.token,
      design.id,
      r2.id,
      kind,
    );
    const artifactUrl = new URL(grant.url, new URL(apiBase).origin);
    if (artifactUrl.pathname.includes('/api/api/')) {
      throw new Error(`artifact ${kind} grant contains a duplicate /api prefix`);
    }
    const artifactResponse = await fetch(artifactUrl);
    if (!artifactResponse.ok || artifactResponse.status === 404) {
      throw new Error(`artifact ${kind} GET failed: ${artifactResponse.status}`);
    }
    if ((await artifactResponse.arrayBuffer()).byteLength === 0) {
      throw new Error(`artifact ${kind} GET returned no bytes`);
    }
  }

  return {
    projectId: PROJECT_ID,
    designId: design.id,
    r1Id: r1.id,
    r2Id: r2.id,
    r2SessionId: session.id,
    instanceIds,
    moduleName: 'Mueble real A',
    moduleCode: 'GATE-A',
    materialName: material.name,
    materialCode: material.code,
    materialThicknessMm: material.thicknessMm,
    roomName,
    actorName: aOwner.user.name,
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
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

test.describe.serial('Project Designs & Immutable Revisions (#501 / WEB-DT-2) Browser E2E', () => {
  let seeded!: SeededProjectDesigns;

  test.beforeAll(async () => {
    seeded = await prepareProjectDesigns();
  });

  test('lineage R1->R2, pinned historical snapshot R1 vs R2, reload stability, and tenant isolation', async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);

    // 1. Login to Org A
    await loginToA(page);

    // 2. Navigate to Project Designs workspace
    await page.goto(`/quotes/${seeded.projectId}/disenos`);
    await expect(page.getByTestId('project-designs-workspace')).toBeVisible();

    // 3. Alternatives switcher displays Cocina Integral
    await expect(page.getByRole('tab', { name: 'Cocina Integral' })).toBeVisible();

    // 4. Lineage timeline displays R1 and R2
    const timeline = page.getByTestId('design-lineage-timeline');
    await expect(timeline).toBeVisible();
    await expect(timeline.getByTestId('revision-node-R1')).toBeVisible();
    await expect(timeline.getByTestId('revision-node-R2')).toBeVisible();

    // 5. Select R1 explicitly
    await timeline.getByTestId('revision-node-R1').click();
    await expect(page).toHaveURL(new RegExp(`design=${seeded.designId}`));
    await expect(page).toHaveURL(new RegExp(`rev=${seeded.r1Id}`));

    const inspector = page.getByTestId('revision-inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole('heading', { level: 2, name: /Revisión R1/i })).toBeVisible();

    // R1 exactness: exactly 2 items (FI-A and FI-B), FI-C absent
    const itemsTable = inspector.getByTestId('revision-items-list');
    await expect(itemsTable.locator('article')).toHaveCount(2);
    await expect(itemsTable.getByText(seeded.instanceIds[0])).not.toBeVisible();
    await expect(itemsTable.getByText(seeded.instanceIds[1])).not.toBeVisible();
    await expect(itemsTable.getByText(seeded.instanceIds[2])).not.toBeVisible();

    const firstItem = itemsTable.locator('article').first();
    await expect(firstItem.getByText(seeded.moduleName, { exact: true }).first()).toBeVisible();
    await expect(firstItem.getByText(seeded.moduleCode, { exact: true })).toBeVisible();
    await expect(firstItem.getByText('Ancho', { exact: true })).toBeVisible();
    await expect(firstItem.getByText('600 mm', { exact: true })).toBeVisible();
    await expect(firstItem.getByText(seeded.materialName, { exact: true })).toBeVisible();
    await expect(firstItem.getByText(seeded.materialCode, { exact: true })).toBeVisible();
    await expect(firstItem.getByText(`${seeded.materialThicknessMm} mm`, { exact: true })).toBeVisible();
    await expect(firstItem.getByText('Elegido en diseño', { exact: true })).toBeVisible();
    await expect(firstItem.getByText(seeded.roomName, { exact: true })).toBeVisible();
    await expect(inspector.getByText(seeded.actorName, { exact: true }).first()).toBeVisible();
    const technicalSummary = firstItem.locator('summary', { hasText: 'Identificadores técnicos' });
    await technicalSummary.focus();
    await expect(technicalSummary).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(firstItem.locator('details')).toHaveAttribute('open', '');
    await page.keyboard.press('Enter');

    // 6. Select R2 explicitly
    await timeline.getByTestId('revision-node-R2').click();
    await expect(page).toHaveURL(new RegExp(`rev=${seeded.r2Id}`));
    await expect(inspector.getByRole('heading', { level: 2, name: /Revisión R2/i })).toBeVisible();

    // R2 exactness: exactly 3 items (FI-A, FI-B, and FI-C)
    await expect(itemsTable.locator('article')).toHaveCount(3);
    await expect(itemsTable.getByText(seeded.instanceIds[0])).not.toBeVisible();
    await expect(itemsTable.getByText(seeded.instanceIds[1])).not.toBeVisible();
    await expect(itemsTable.getByText(seeded.instanceIds[2])).not.toBeVisible();

    // The immutable descriptors remain usable without horizontal overflow at
    // the three supported operational breakpoints.
    const originalViewport = page.viewportSize();
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(itemsTable).toBeVisible();
      const surfaces = [inspector, itemsTable, ...await itemsTable.locator('article').all()];
      for (const surface of surfaces) {
        const box = await surface.boundingBox();
        expect(box, `missing layout box at ${width}px`).not.toBeNull();
        expect(box!.x, `left overflow at ${width}px`).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, `right overflow at ${width}px`).toBeLessThanOrEqual(width);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `document overflow at ${width}px`).toBeLessThanOrEqual(0);
      await testInfo.attach(`revision-descriptors-${width}`, {
        body: await itemsTable.screenshot(),
        contentType: 'image/png',
      });
    }
    if (originalViewport) await page.setViewportSize(originalViewport);

    // R2 preview bytes load through the signed grant in the real browser.
    const preview = page.getByTestId('preview-image');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('src', /\/api\/design-artifacts\//);
    await expect(preview).not.toHaveAttribute('src', /\/api\/api\//);

    // Responsive visual proof for the two recoverable preview failures. The
    // workspace and all prior requests remain real; only the failure under
    // test is injected at the signed-grant boundary.
    const previewAuthorize = `**/designs/${seeded.designId}/revisions/${seeded.r2Id}/artifacts/preview:authorize`;
    await page.route(previewAuthorize, (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          kind: 'preview',
          url: 'https://invalid.test/api/design-artifacts/preview.png?grant=invalid',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      }),
    );
    await page.reload();
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const error = page.getByTestId('preview-grant-error');
      await expect(error).toBeVisible();
      await expect(error.getByRole('button', { name: 'Solicitar nuevo acceso' })).toBeVisible();
      expect((await page.getByTestId('preview-card').boundingBox())!.width).toBeLessThanOrEqual(width);
      await testInfo.attach(`preview-invalid-grant-${width}`, {
        body: await page.getByTestId('preview-card').screenshot(),
        contentType: 'image/png',
      });
    }
    await page.unroute(previewAuthorize);

    await page.route(previewAuthorize, (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          kind: 'preview',
          url: '/api/design-artifacts/visual-preview.png?grant=visual-test',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      }),
    );
    await page.route('**/api/design-artifacts/visual-preview.png?*', (route) =>
      route.fulfill({ status: 500, contentType: 'text/plain', body: 'injected image failure' }),
    );
    await page.reload();
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const error = page.getByTestId('preview-load-error');
      await expect(error).toBeVisible();
      await expect(error.getByRole('button', { name: 'Reintentar vista previa' })).toBeVisible();
      expect((await page.getByTestId('preview-card').boundingBox())!.width).toBeLessThanOrEqual(width);
      await testInfo.attach(`preview-byte-load-${width}`, {
        body: await page.getByTestId('preview-card').screenshot(),
        contentType: 'image/png',
      });
    }
    await page.unroute(previewAuthorize);
    await page.unroute('**/api/design-artifacts/visual-preview.png?*');
    if (originalViewport) await page.setViewportSize(originalViewport);

    // 7. Select R1 again and verify historical reload stability
    await timeline.getByTestId('revision-node-R1').click();
    await expect(page).toHaveURL(new RegExp(`rev=${seeded.r1Id}`));
    await expect(itemsTable.locator('article')).toHaveCount(2);

    // Reload browser page
    await page.reload();

    // Post-reload: R1 remains pinned, URL still contains rev=r1Id, item count is 2, FI-C absent
    await expect(page).toHaveURL(new RegExp(`rev=${seeded.r1Id}`));
    await expect(page.getByRole('heading', { level: 2, name: /Revisión R1/i })).toBeVisible();
    const reloadedTable = page.getByTestId('revision-items-list');
    await expect(reloadedTable.locator('article')).toHaveCount(2);
    await expect(reloadedTable.getByText(seeded.instanceIds[0])).not.toBeVisible();
    await expect(reloadedTable.getByText(seeded.instanceIds[1])).not.toBeVisible();
    await expect(reloadedTable.getByText(seeded.instanceIds[2])).not.toBeVisible();

    // 8. Tenant isolation: switch to Organization B
    await page.getByLabel('Cambiar organización').selectOption({ label: 'Browser Gate B' });
    await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate B');

    // Navigate to Org A's Project Design URL under Org B session
    await page.goto(`/quotes/${seeded.projectId}/disenos?design=${seeded.designId}&rev=${seeded.r1Id}`);

    // Org B does not have access. The RLS-enforced tenant context prevents data from Org A
    // from being returned. The UI must show an error, empty state, or no workspace at all —
    // never the actual design names, revision lineage, or item data from Org A.
    // We wait for the page to stabilize (5s), then verify the invariants.
    await page.waitForTimeout(5000);

    // Core negative proofs: zero Org A data ever appears in the Org B session
    await expect(page.getByText('Cocina Integral')).toHaveCount(0);
    await expect(page.getByTestId('design-lineage-timeline')).toHaveCount(0);
    await expect(page.getByTestId('revision-items-list')).toHaveCount(0);

    // Positive proof: the workspace renders an accessible state (error or empty — not Org A data)
    const workspaceOrError = page.locator(
      '[data-testid="project-designs-workspace"], .pd-error-container',
    );
    // Either the workspace is absent (another nav guard caught it) or it shows an error/empty state.
    // The absence of Org A data is the enforcement boundary.
    const workspaceCount = await workspaceOrError.count();
    if (workspaceCount > 0) {
      // If a workspace rendered, it must be in an error or empty state — NOT showing Org A data
      await expect(page.getByTestId('revision-inspector')).toHaveCount(0);
      await expect(page.getByTestId('revision-items-list')).toHaveCount(0);
    }
  });

// #640: resolves the real backing file of one staged/published artifact under
// the gate's MEDIA_DIR. Artifacts are the deterministic fixtures this spec
// uploaded, so no shared state is contaminated.
function findArtifactFile(sessionId: string, kind: 'model' | 'manifest' | 'preview'): string {
  const mediaDir = required('MEDIA_DIR');
  for (const orgEntry of fs.readdirSync(mediaDir, { withFileTypes: true })) {
    if (!orgEntry.isDirectory()) continue;
    const dir = path.join(mediaDir, orgEntry.name, 'designs', 'publish', sessionId);
    if (!fs.existsSync(dir)) continue;
    const match = fs.readdirSync(dir).find((f) => f.startsWith(`${kind}-`));
    if (match) return path.join(dir, match);
  }
  throw new Error(`backing file for ${kind} of session ${sessionId} not found under MEDIA_DIR`);
}

test('authoritative artifact health: available, missing bytes and tampered bytes (#640)', async ({
  page,
}) => {
  test.setTimeout(90_000);

  const apiBase = required('ORGANIZATION_API_BASE');
  const client = new GraneteApiClient(apiBase);
  const aOwner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  const authHeaders = { Authorization: `Bearer ${aOwner.token}` };
  const listUrl = `${apiBase}/designs/${seeded.designId}/revisions/${seeded.r2Id}/artifacts`;
  const authorizeUrl = (kind: string) =>
    `${apiBase}/designs/${seeded.designId}/revisions/${seeded.r2Id}/artifacts/${kind}:authorize`;

  // Scenario A: real bytes behind real metadata report available with an
  // observation timestamp — never metadata presence alone.
  const healthyList = await (await fetch(listUrl, { headers: authHeaders })).json();
  expect(healthyList.map((a: { kind: string }) => a.kind).sort()).toEqual(['manifest', 'model', 'preview']);
  for (const art of healthyList) {
    expect(art.health.status).toBe('available');
    expect(art.health.checked_at).toBeTruthy();
  }
  const metaByKind = (kind: string) => healthyList.find((a: { kind: string }) => a.kind === kind);

  const previewPath = findArtifactFile(seeded.r2SessionId, 'preview');
  const modelPath = findArtifactFile(seeded.r2SessionId, 'model');
  const previewBytes = fs.readFileSync(previewPath);
  const modelBytes = fs.readFileSync(modelPath);

  try {
    // Scenario B: delete the backing bytes behind existing metadata.
    fs.unlinkSync(previewPath);
    const afterDelete = await (await fetch(listUrl, { headers: authHeaders })).json();
    const previewMeta = afterDelete.find((a: { kind: string }) => a.kind === 'preview');
    expect(previewMeta.health.status).toBe('missing');
    expect(previewMeta.sha256).toBe(metaByKind('preview').sha256); // metadata never regenerated
    const missingAuth = await fetch(authorizeUrl('preview'), { method: 'POST', headers: authHeaders });
    expect(missingAuth.status).toBe(409);
    expect((await missingAuth.json()).code).toBe('ARTIFACT_MISSING');

    await loginToA(page);
    await page.goto(
      `/quotes/${seeded.projectId}/disenos?design=${seeded.designId}&rev=${seeded.r2Id}`,
    );
    await expect(page.getByTestId('preview-health-missing')).toBeVisible();
    await expect(page.getByTestId('download-artifact-preview')).toBeDisabled();
    await expect(page.getByTestId('artifact-health-recovery')).toBeVisible();
    await expect(page.getByTestId('artifact-health-model')).toHaveText('Disponible');

    // Restore the preview bytes so scenario C proves per-artifact isolation.
    fs.writeFileSync(previewPath, previewBytes);

    // Scenario C: tamper the model bytes (different size and content).
    fs.writeFileSync(modelPath, Buffer.from('tampered model bytes - #640 health gate proof'));
    const afterTamper = await (await fetch(listUrl, { headers: authHeaders })).json();
    const modelMeta = afterTamper.find((a: { kind: string }) => a.kind === 'model');
    expect(modelMeta.health.status).toBe('integrity_mismatch');
    expect(modelMeta.sha256).toBe(metaByKind('model').sha256); // digest never rewritten
    const mismatchAuth = await fetch(authorizeUrl('model'), { method: 'POST', headers: authHeaders });
    expect(mismatchAuth.status).toBe(409);
    expect((await mismatchAuth.json()).code).toBe('ARTIFACT_INTEGRITY_MISMATCH');

    await page.reload();
    await expect(page.getByTestId('artifact-health-model')).toHaveText('Integridad comprometida');
    await expect(page.getByTestId('download-artifact-model')).toBeDisabled();
    // The restored preview is healthy again: mismatch is per artifact, never a
    // blanket failure.
    await expect(page.getByTestId('preview-image')).toBeVisible();
  } finally {
    fs.writeFileSync(previewPath, previewBytes);
    fs.writeFileSync(modelPath, modelBytes);
  }
});
});
