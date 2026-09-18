import { expect, test, type Download, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  type ArtifactManifest,
  type CutPlan,
  type ReleaseCuttingDemandView,
} from '@granete/domain';
import {
  compileCutPlanToPtxDocument,
  cutPlanPdfExport,
  parsePtxDocumentBytes,
  PTX_CADMATIC_4_R3_PROFILE,
  PTX_CADMATIC_4_R4_PROFILE,
  resolvePtxCompilerRoute,
  validatePtxDocument,
  verifyCutPlanPtxReadback,
} from '@granete/excel';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { allowLoggedOutSessionProbe, collectBrowserErrors } from './support/browserErrors';
import { GATE_MODULE_A_ID, required } from './support/api';

/**
 * #739 browser E2E against the real Go backend + PostgreSQL:
 *
 *   Q1 (600 mm ×3) → R2 (650 mm on unit 3) → Q2 accepted → P1
 *   → Ingeniería of the exact release → FROZEN cutting demand (never the
 *   mutable project/catálogo) → editable preparation (blade/trims/strategy)
 *   → plan saved with its exact base → reload recovers it
 *   → REAL PDF + PTX downloads of the SAME plan
 *   → configured CADmatic 4 r4 candidate with manifest provenance
 *     (productionReleaseId/designRevisionId/bomFingerprint) and independent
 *     byte readback (#650 parser/verifier).
 *
 * Zero business mutations: Project stays draft, the release stays active and
 * no engineering completion / materials release / produced stamp appears.
 */

const PROJECT_ID = 'aaa77739-cccc-4777-8777-777777777e01';
const QUOTE_LINE_ID = 'aaa77739-cccc-4777-8777-777777777e02';
const CUSTOMER_ID = 'aaa77739-0000-4000-8000-000000000e03';
const STRUCT_ID = 'aaa77739-0000-4000-8000-000000000e04';
const PANEL_COMP_ID = 'aaa77739-0000-4000-8000-000000000e05';
const MAT_ID = 'aaa77739-0000-4000-8000-000000000e06';
const MAT_CODE = 'ENG-739-TAB';
const MAT_NAME = 'MDF Prueba 739';
const DEPTH_MM = 590;

const CUTTING_CADMATIC4_DIGEST =
  '94401b8c17cd54b80e548bcc85cd184f80ba25ba97056ef6d46d81d1cb5114fc';

interface Seeded {
  readonly projectId: string;
  readonly designId: string;
  readonly r2Id: string;
  readonly q2Id: string;
  readonly releaseId: string;
  readonly fingerprint: string;
  readonly apiBase: string;
  readonly token: string;
}

async function login(page: Page): Promise<void> {
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

async function fetchDemand(seeded: Seeded): Promise<ReleaseCuttingDemandView> {
  const raw = await (
    await fetch(`${seeded.apiBase}/projects/${seeded.projectId}/production-releases/${seeded.releaseId}/cutting-demand`, {
      headers: { Authorization: `Bearer ${seeded.token}` },
    })
  ).json();
  if (!raw || !Array.isArray(raw.units)) throw new Error(`unexpected demand payload: ${JSON.stringify(raw).slice(0, 200)}`);
  return {
    releaseId: raw.release_id,
    releaseNumber: raw.release_number,
    designRevisionId: raw.design_revision_id,
    designRevisionNumber: raw.design_revision_number,
    manufacturingFingerprint: raw.manufacturing_fingerprint,
    schemaVersion: raw.schema_version,
    units: raw.units.map((unit: Record<string, unknown>) => ({
      furnitureInstanceId: String(unit.furniture_instance_id),
      furnitureDefinitionId: String(unit.furniture_definition_id),
      pieces: (unit.pieces as ReadonlyArray<Record<string, unknown>>).map((piece) => ({
        partId: String(piece.part_id),
        partCode: (piece.part_code as string | null) ?? null,
        description: String(piece.description),
        quantity: Number(piece.quantity),
        lengthMm: Number(piece.length_mm),
        widthMm: Number(piece.width_mm),
        thicknessMm: Number(piece.thickness_mm),
        materialId: String(piece.material_id),
        edgeBandId: (piece.edge_band_id as string | null) ?? null,
        grain: Number(piece.grain) as 0 | 1,
        l1: Number(piece.l1) as 0 | 1,
        l2: Number(piece.l2) as 0 | 1,
        w1: Number(piece.w1) as 0 | 1,
        w2: Number(piece.w2) as 0 | 1,
        optionRole: (piece.option_role as string | null) ?? null,
      })),
    })),
  };
}

async function captureDownloads(page: Page, trigger: () => Promise<void>, count: number): Promise<{ name: string; bytes: Uint8Array }[]> {
  const downloads: Download[] = [];
  const capture = (download: Download): void => { downloads.push(download); };
  page.on('download', capture);
  try {
    await trigger();
    await expect.poll(() => downloads.length, { timeout: 20_000 }).toBe(count);
  } finally {
    page.off('download', capture);
  }
  return Promise.all(
    downloads.map(async (download) => ({
      name: download.suggestedFilename(),
      bytes: new Uint8Array(await readFile((await download.path())!)),
    })),
  );
}

/** The EXACT plan the browser generated and persisted for this release. */
async function savedReleasePlan(page: Page, releaseId: string): Promise<CutPlan> {
  const raw = await page.evaluate(() => globalThis.localStorage.getItem('granete_release_cut_plans_v1'));
  const store = raw ? (JSON.parse(raw) as Record<string, CutPlan>) : {};
  const plan = Object.values(store).find(
    (candidate) => candidate?.releaseBase?.releaseId === releaseId,
  );
  if (!plan) throw new Error('No release-scoped plan persisted in localStorage');
  return plan;
}

test.describe.serial('Engineering frozen cutting demand → plan → real PDF + PTX (#739)', () => {
  let seeded!: Seeded;

  test.beforeAll(async () => {
    const apiBase = required('ORGANIZATION_API_BASE');
    const client = new GraneteApiClient(apiBase);
    const owner = await client.login({
      email: required('ORGANIZATION_GATE_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    const token = owner.token;
    const repository = new APIWorkspaceRepository(apiBase, { getAccessToken: () => token });

    const catalog = await repository.getCatalog();
    const template = catalog.modules.find((m) => m.id === GATE_MODULE_A_ID) ?? catalog.modules[0]!;
    await repository.saveCatalog({
      ...catalog,
      materials: [
        ...catalog.materials.filter((m) => m.id !== MAT_ID),
        {
          id: MAT_ID,
          code: MAT_CODE,
          name: MAT_NAME,
          widthMm: 1830,
          lengthMm: 2440,
          thicknessMm: 18,
          grainDefault: true,
          boardPrice: 100,
          wastePercent: 0,
          costPerM2: 100,
          active: true,
        },
      ],
      optionGroups: [
        ...catalog.optionGroups.filter((g) => g.code !== 'ENG-739-BODY'),
        { id: 'aaa77739-0000-4000-8000-000000000e07', code: 'ENG-739-BODY', name: 'Cuerpo 739', kind: 'board' as const, required: true, optionIds: [MAT_ID] },
      ],
      structures: [
        ...(catalog.structures ?? []).filter((s) => s.id !== STRUCT_ID),
        {
          id: STRUCT_ID,
          code: 'ENG-739-STRUCT',
          name: 'Cuerpo 739',
          externalDims: { width: 600, height: 720, depth: DEPTH_MM },
          components: [{ componentId: PANEL_COMP_ID, quantity: 1 }],
          active: true,
        },
      ],
      components: [
        ...(catalog.components ?? []).filter((c) => c.id !== PANEL_COMP_ID),
        {
          id: PANEL_COMP_ID,
          code: 'ENG-739-PANEL',
          name: 'Panel 739',
          placement: 'interno' as const,
          // Parametric: the piece follows the unit's W/D, so the 650 mm unit
          // produces a 650-wide piece and the frozen demand proves it.
          geometry: {
            kind: 'rectangular_board' as const,
            lengthMm: DEPTH_MM,
            widthMm: 600,
            thicknessMm: 18,
            lengthFormula: 'D',
            widthFormula: 'W',
          },
          defaultEdges: [
            { side: 'L1' as const, enabled: false },
            { side: 'L2' as const, enabled: false },
            { side: 'W1' as const, enabled: false },
            { side: 'W2' as const, enabled: false },
          ],
          optionRoles: ['ENG-739-BODY'],
          active: true,
        },
      ],
      modules: [
        ...catalog.modules.filter((m) => m.id !== template.id),
        {
          ...template,
          id: template.id,
          structureId: STRUCT_ID,
          components: [],
          hardwareLines: [],
          externalDims: { width: 600, height: 720, depth: DEPTH_MM },
        },
      ],
      customers: [
        ...(catalog.customers ?? []).filter((c) => c.id !== CUSTOMER_ID),
        { id: CUSTOMER_ID, name: 'Cliente Prueba 739', active: true },
      ],
    });

    const now = new Date().toISOString();
    await repository.saveProject({
      id: PROJECT_ID,
      name: 'Obra Prueba 739 E2E',
      customerId: CUSTOMER_ID,
      currency: 'MXN',
      marginFactor: 1.3,
      laborFixedCost: 0,
      status: 'draft' as const,
      createdAt: now,
      updatedAt: now,
      items: [
        { id: QUOTE_LINE_ID, moduleId: template.id, quantity: 3, optionChoices: { 'ENG-739-BODY': MAT_ID } },
      ],
    });

    const mat = await client.materializeQuoteLineFurniture(token, PROJECT_ID, QUOTE_LINE_ID, 'eng739-materialize');
    if (mat.instances.length !== 3) throw new Error(`expected 3 instances, got ${mat.instances.length}`);
    const instanceIds = mat.instances.map((i) => i.furniture_instance_id);

    const design = await client.createProjectDesign(token, PROJECT_ID, { name: 'Cocina 739' }, 'eng739-design-cutting');
    const workingItem = (instanceId: string, widthMm: number) => ({
      furniture_instance_id: instanceId,
      furniture_definition_id: template.id,
      parameters: { widthMm, heightMm: 720, depthMm: DEPTH_MM },
      material_choices: { 'ENG-739-BODY': MAT_ID },
    });
    // R1: all three units at 600 mm.
    await client.updateDesignWorkingCopy(token, design.id, {
      items: instanceIds.map((id) => workingItem(id, 600)),
    });
    const r1 = await client.publishDesignRevision(token, design.id, { source_type: 'manual', base_revision_id: null }, 'eng739-r1-cutting');

    // Q1 accepted over R1's 600 mm world.
    const q1 = await client.createInitialProjectQuoteRevision(token, PROJECT_ID, { notes: 'Q1 739' }, 'eng739-q1-cutting');
    await client.publishProjectQuoteRevision(token, PROJECT_ID, q1.id, 'eng739-q1-pub-cutting');
    await client.acceptProjectQuoteRevision(token, PROJECT_ID, q1.id, 'eng739-q1-acc-cutting');

    // R2: unit 3 grows to 650 mm (the manufacturing truth P1 will freeze).
    await client.updateDesignWorkingCopy(token, design.id, {
      items: instanceIds.map((id, index) => workingItem(id, index === 2 ? 650 : 600)),
    });
    const r2 = await client.publishDesignRevision(token, design.id, { source_type: 'manual', base_revision_id: r1.id }, 'eng739-r2-cutting');

    // Approving R2 against Q1 must fail (outdated commercial baseline)…
    await expect(
      client.approveProjectDesignRevisionForProduction(token, PROJECT_ID, design.id, r2.id, { quoteRevisionId: q1.id }, 'eng739-approve-stale'),
    ).rejects.toThrow();
    // …so the commercial flow requotes: Q2 from R2 (only the changed unit).
    const requote = await client.requoteProjectQuote(
      token,
      PROJECT_ID,
      { baseQuoteRevisionId: q1.id, designRevisionId: r2.id, includeFurnitureInstanceIds: [instanceIds[2]!] },
      'eng739-q2-cutting',
    );
    const q2Id = requote.quoteRevision.id;
    await client.publishProjectQuoteRevision(token, PROJECT_ID, q2Id, 'eng739-q2-pub-cutting');
    await client.acceptProjectQuoteRevision(token, PROJECT_ID, q2Id, 'eng739-q2-acc-cutting');
    const approved = await client.approveProjectDesignRevisionForProduction(
      token,
      PROJECT_ID,
      design.id,
      r2.id,
      { quoteRevisionId: q2Id },
      'eng739-approve-r2',
    );
    if (approved.status !== 'approved') throw new Error(`R2 not approved: ${approved.status}`);

    // P1: the exact liberation whose frozen demand Engineering prepares.
    const release = await client.createProductionRelease(
      token,
      PROJECT_ID,
      { design_revision_id: r2.id, quote_revision_id: q2Id },
      'eng739-release-1',
    );
    seeded = {
      projectId: PROJECT_ID,
      designId: design.id,
      r2Id: r2.id,
      q2Id,
      releaseId: release.id,
      fingerprint: release.manufacturing_fingerprint,
      apiBase,
      token,
    };
  });

  async function serverTruth(): Promise<Record<string, unknown>> {
    return (await (
      await fetch(`${seeded.apiBase}/projects/${PROJECT_ID}`, {
        headers: { Authorization: `Bearer ${seeded.token}` },
      })
    ).json()) as Record<string, unknown>;
  }

  test('despiece y optimización usan las piezas congeladas de P1 (no el proyecto ni el catálogo vivos)', async ({ page }) => {
    test.setTimeout(150_000);
    const browserErrors = collectBrowserErrors(page, { allow: allowLoggedOutSessionProbe });
    await login(page);
    await page.goto(`/engineering/${PROJECT_ID}?release=${seeded.releaseId}`);
    await expect(page.getByTestId('eng-release-context')).toContainText('Liberación #1 · Diseño R2');

    // Despiece: frozen rows — the 650 mm unit is there with its full demand
    // (3 units × 1 panel), never the live project rows (which have no 650).
    await page.getByTestId('eng-tab-despiece').click();
    await expect(page.getByTestId('eng-release-prep-notice')).toContainText('no modifica la cotización');
    const despieceText = await page.locator('#eng-panel-despiece').innerText();
    expect(despieceText).toContain('650');
    expect(despieceText).toContain('600');
    expect((despieceText.match(/Panel 739/g) ?? []).length).toBeGreaterThanOrEqual(3);

    // Server-side divergence: rename the material and resize the module in
    // the live catalog; the frozen demand (dims/quantities) must not move.
    const repository = new APIWorkspaceRepository(seeded.apiBase, { getAccessToken: () => seeded.token });
    const catalog = await repository.getCatalog();
    await repository.saveCatalog({
      ...catalog,
      materials: catalog.materials.map((m) => (m.id === MAT_ID ? { ...m, name: 'MDF Renombrado 739' } : m)),
      modules: catalog.modules.map((m) =>
        m.id === (catalog.modules.find((x) => x.structureId === STRUCT_ID)?.id ?? '')
          ? { ...m, externalDims: { width: 999, height: 999, depth: 999 } }
          : m,
      ),
    });

    await page.reload();
    await expect(page.getByTestId('eng-release-context')).toContainText('Liberación #1 · Diseño R2');
    await page.getByTestId('eng-tab-despiece').click();
    const afterDivergence = await page.locator('#eng-panel-despiece').innerText();
    expect(afterDivergence).toContain('650');
    expect((afterDivergence.match(/Panel 739/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(afterDivergence).not.toContain('999');

    // Zero business mutations from preparing/reading engineering.
    const truth = await serverTruth();
    expect(truth['status']).toBe('draft');
    expect((truth['engineering_log'] as Record<string, unknown> | null)).toBeFalsy();
    expect((truth['materials_release'] as Record<string, unknown> | null)).toBeFalsy();

    // #644 — the frozen-despiece surface is part of the milestone journey:
    // it renders without overflow across the supported viewports (the entry
    // surface is already pinned by engineering-entry.spec.ts).
    for (const viewport of [
      { name: 'compact', width: 390, height: 844 },
      { name: 'medium', width: 768, height: 900 },
      { name: 'expanded', width: 1280, height: 800 },
    ] as const) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/engineering/${PROJECT_ID}?release=${seeded.releaseId}`);
      await expect(page.getByTestId('eng-release-context')).toContainText('Liberación #1');
      await page.getByTestId('eng-tab-despiece').click();
      await expect(page.locator('#eng-panel-despiece')).toBeVisible();
      const geometry = await page.locator('html').evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(geometry.scrollWidth, `viewport ${viewport.name}`).toBeLessThanOrEqual(geometry.clientWidth);
    }

    await browserErrors.assertEmpty('frozen despiece journey');
  });

  test('ajustar disco genera otro resultado técnico; guardar + recargar recupera el plan con su base', async ({ page }) => {
    test.setTimeout(120_000);
    const browserErrors = collectBrowserErrors(page, { allow: allowLoggedOutSessionProbe });
    await login(page);
    await page.goto(`/engineering/${PROJECT_ID}?release=${seeded.releaseId}`);
    await page.getByTestId('eng-tab-optimizacion').click();
    await expect(page.getByTestId('eng-release-prep-notice')).toBeVisible();

    // Generate with defaults, save, and confirm honest success.
    await page.getByRole('button', { name: /Generar Plan de Corte 2D/i }).click();
    await expect(page.getByTestId('prod-opt-summary')).toContainText('tablero');
    await page.getByRole('button', { name: /Guardar Plan/i }).click();
    await expect(page.getByTestId('prod-opt-save-ok')).toBeVisible();

    // Changing the blade is a TECHNICAL adjustment: exports block until the
    // plan is regenerated (no stale result presented as current).
    const kerf = page.getByTestId('prod-opt-config').locator('input[type="number"]').first();
    await kerf.fill('5');
    await expect(page.getByTestId('prod-opt-config-drift')).toBeVisible();
    await expect(page.getByTestId('prod-opt-export-pdf-manual')).toBeDisabled();
    await page.getByRole('button', { name: /Generar Plan de Corte 2D/i }).click();
    await expect(page.getByTestId('prod-opt-config-drift')).toBeHidden();

    // Reload: the plan (with its parameters and exact base) comes back.
    await page.reload();
    await page.getByTestId('eng-tab-optimizacion').click();
    await expect(page.getByText(/Plan activo ·/)).toBeVisible();
    await expect(page.getByTestId('prod-opt-summary')).toContainText('tablero');

    // The saved plan's exact base is revalidated server-side: the demand's
    // fingerprint/release still match (no cross-release mixing).
    const demand = await fetchDemand(seeded);
    expect(demand.releaseId).toBe(seeded.releaseId);
    expect(demand.manufacturingFingerprint).toBe(seeded.fingerprint);
    expect(demand.units).toHaveLength(3);
    const widths = demand.units
      .flatMap((unit) => unit.pieces.map((piece) => piece.widthMm))
      .sort((a, b) => a - b);
    expect(widths).toEqual([600, 600, 650]);
    expect(demand.units.every((unit) => unit.pieces.every((piece) => piece.materialId === MAT_ID))).toBe(true);
    expect(demand.units.every((unit) => unit.pieces.every((piece) => piece.thicknessMm === 18))).toBe(true);
    await browserErrors.assertEmpty('plan save + reload journey');
  });

  test('descarga real de PDF y PTX genérico del mismo plan (org sin salida configurada)', async ({ page }) => {
    test.setTimeout(120_000);
    const browserErrors = collectBrowserErrors(page, { allow: allowLoggedOutSessionProbe });
    await login(page);
    await page.goto(`/engineering/${PROJECT_ID}?release=${seeded.releaseId}`);
    await page.getByTestId('eng-tab-optimizacion').click();
    // Each Playwright test owns an isolated context: generate + persist the
    // plan HERE, then download from that exact saved plan.
    await page.getByRole('button', { name: /Generar Plan de Corte 2D/i }).click();
    await expect(page.getByTestId('prod-opt-summary')).toContainText('tablero');
    await page.getByRole('button', { name: /Guardar Plan/i }).click();
    await expect(page.getByTestId('prod-opt-save-ok')).toBeVisible();
    const plan = await savedReleasePlan(page, seeded.releaseId);
    expect(plan.releaseBase).toMatchObject({
      releaseId: seeded.releaseId,
      designRevisionId: seeded.r2Id,
      manufacturingFingerprint: seeded.fingerprint,
    });

    // PDF of the cut plan — no machine validation involved. The downloaded
    // bytes are the deterministic render of the SAME saved plan.
    const [pdf] = await captureDownloads(page, () =>
      page.getByTestId('prod-opt-export-pdf-manual').click(), 1,
    );
    expect(pdf.name).toBe(`${plan.projectName}-plan-de-corte.pdf`);
    const pdfHead = new TextDecoder().decode(pdf.bytes.slice(0, 5));
    expect(pdfHead).toBe('%PDF-');
    const expectedPdf = await cutPlanPdfExport({ cutPlan: plan, projectName: plan.projectName });
    expect(createHash('sha256').update(pdf.bytes).digest('hex')).toBe(
      createHash('sha256').update(expectedPdf).digest('hex'),
    );

    // Generic PTX v1.14 (unconfigured org): same plan, machine-readable.
    const [ptx] = await captureDownloads(page, () =>
      page.getByTestId('prod-opt-export-ptx').click(), 1,
    );
    expect(ptx.name.endsWith('.ptx')).toBe(true);
    const text = new TextDecoder().decode(ptx.bytes);
    expect(text).toContain('[HEADER]');
    expect(text).toContain('SYSTEM=GRANETE_APP');
    expect(text).toContain('JOB_NAME=Obra Prueba 739 E2E');
    expect(text).toContain('TOTAL_PIECES=3');
    expect(text).toContain('650');
    expect(text).toContain('600');
    expect(text).toContain(MAT_CODE);
    await browserErrors.assertEmpty('PDF + PTX download journey');
  });

  test('candidato CADmatic 4 r4: manifiesto con procedencia del release + lectura independiente de bytes', async ({ page }) => {
    test.setTimeout(150_000);
    const browserErrors = collectBrowserErrors(page, { allow: allowLoggedOutSessionProbe });

    // Configure the exact output tuple through the real Settings UI (#591).
    await login(page);
    await page.goto('/settings');
    await page.getByTestId('settings-tab-tab-ingenieria').click();
    await expect(page.getByTestId('machine-output-cutting')).toBeVisible();
    await page.getByTestId('machine-output-cutting-machine').selectOption({ label: 'HOLZMA (HOMAG) HPP 250' });
    await page.getByTestId('machine-output-cutting-profile').selectOption({ label: 'PTX · CADmatic 4 · r4' });
    await page.getByTestId('machine-output-cutting-save').click();
    await expect(page.getByTestId('machine-output-cutting-status')).toHaveText('Candidato — no validado en máquina');

    // The engineering page reads the server read model: wait for the exact
    // profile to be durably selected before navigating (no empty-state race).
    const repository = new APIWorkspaceRepository(seeded.apiBase, { getAccessToken: () => seeded.token });
    await expect
      .poll(
        async () =>
          (await repository.getMachineOutputSelections()).selections.find(
            (s) => s.selection.selection.operation === 'cutting',
          )?.selection.selection.outputCompatibilityProfileId,
        { timeout: 15_000 },
      )
      .toBe('ptx-cadmatic-4');

    await page.goto(`/engineering/${PROJECT_ID}?release=${seeded.releaseId}`);
    await page.getByTestId('eng-tab-optimizacion').click();
    await expect(page.getByTestId('prod-opt-cutting-output')).toContainText('ptx-cadmatic-4@r4');
    await page.getByRole('button', { name: /Generar Plan de Corte 2D/i }).click();
    await expect(page.getByTestId('prod-opt-summary')).toContainText('tablero');
    await page.getByRole('button', { name: /Guardar Plan/i }).click();
    await expect(page.getByTestId('prod-opt-save-ok')).toBeVisible();

    const files = await captureDownloads(page, () =>
      page.getByTestId('prod-opt-export-ptx').click(), 2,
    );
    const manifestFile = files.find((f) => f.name.endsWith('.manifest.json'))!;
    const ptxFile = files.find((f) => f.name.endsWith('.ptx'))!;
    const manifest = JSON.parse(new TextDecoder().decode(manifestFile.bytes)) as ArtifactManifest;

    // Provenance: the exact liberation pins travel with the artifact.
    expect(manifest.outputCompatibilityProfileDigest).toBe(CUTTING_CADMATIC4_DIGEST);
    expect(manifest.provenance).toMatchObject({
      projectId: PROJECT_ID,
      productionReleaseId: seeded.releaseId,
      designRevisionId: seeded.r2Id,
      bomFingerprint: seeded.fingerprint,
    });
    expect(manifest.missingProvenance).toEqual([]);

    // Independent readback (#650 parser + verifier): the downloaded bytes must
    // correspond to the EXACT plan the browser generated from the frozen
    // demand (read back from its release-scoped persistence).
    const plan = await savedReleasePlan(page, seeded.releaseId);
    const route = resolvePtxCompilerRoute(PTX_CADMATIC_4_R4_PROFILE);
    expect(route.reasons).toEqual([]);
    expect(route.config).toBeDefined();
    const { mapping } = compileCutPlanToPtxDocument(plan, route.config!.compileOptions);
    const parsed = parsePtxDocumentBytes(ptxFile.bytes);
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(verifyCutPlanPtxReadback(parsed, plan, mapping, route.config!.compileOptions)).toEqual([]);

    // Dimensions/quantities of the frozen demand are IN the machine program:
    // PARTS_REQ carries the required pieces with their exact sizes.
    const partsReq = parsed.records.filter((record) => record.type === 'PARTS_REQ');
    expect(partsReq.length).toBeGreaterThan(0);
    const demandedWidths = partsReq
      .flatMap((record) => Array.from({ length: (record as { requiredQuantity: number }).requiredQuantity }, () => record))
      .map((record) => (record as { width: number }).width)
      .sort((a, b) => a - b);
    expect(demandedWidths).toEqual([600, 600, 650]);
    await browserErrors.assertEmpty('CADmatic candidate + readback journey');
  });
});
