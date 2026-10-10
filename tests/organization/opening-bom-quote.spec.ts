import { expect, test } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { GATE_MODULE_A_ID, putWorkingCopyCurrent, required } from './support/api';

// #1263 — the opening BOM vertical walk against the real backend: select a
// gola (Cymisa 8006 datasheet slice) on a design, save the intent, resolve
// through the server, quote, and REOPEN — the frozen commercial snapshot
// carries the exact profile run (meters + exact mm cut), supports and end
// caps, and the hardware prices through the one channel.

const STRUCTURE_ID = '71810000-0000-4000-8000-000000000001';
const LATERAL_COMPONENT_ID = '71810000-0000-4000-8000-000000000002';
const HW_PROFILE_8006 = '71810000-0000-4000-8000-000000000003';
const HW_SUPPORT_SU116 = '71810000-0000-4000-8000-000000000004';
const HW_CAPS_CF8006TP = '71810000-0000-4000-8000-000000000005';
const OPENING_PROFILE_ID = '71810000-0000-4000-8000-000000000006';
const OPENING_MODULE_ID = '71810000-0000-4000-8000-000000000009';
const LATERAL_MATERIAL_ID = '71810000-0000-4000-8000-000000000007';
const LATERAL_GROUP_CODE = 'LATERAL_MAT';

const PROJECT_NAME = 'Obra Gola BOM E2E';
const CUSTOMER_NAME = 'Cliente Gola BOM E2E';

interface OpeningBomLine {
  readonly lineId: string;
  readonly memberKey: 'profile' | 'supports' | 'endCaps';
  readonly hardwareId: string;
  readonly profileId: string;
  readonly profileVersion: number;
  readonly boundary: string;
  readonly rule: string;
  readonly quantity: number;
  readonly unit: 'meter' | 'piece';
  readonly cutLengthMm?: number;
}

interface DesignOpeningPayload {
  readonly opening?: { readonly system: string; readonly profileId?: string } | null;
  readonly resolution?: {
    readonly state: string;
    readonly reason?: string;
    readonly fronts?: readonly { readonly heightMm: number }[];
    readonly bom?: readonly OpeningBomLine[];
    readonly bomReason?: string;
    readonly bomEnds?: { readonly leftEnd: string; readonly rightEnd: string };
  } | null;
  readonly workingVersion: string;
  readonly dimsKnown: boolean;
}

test('1263: gola selection resolves its BOM and the quote freezes it with exact lengths', async ({ page }) => {
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
  const repository = new APIWorkspaceRepository(apiBase, { getAccessToken: () => token });

  // Catalog: a module with 18mm LATERAL sides (the body fact the interior
  // width derives from: 600 − 2×18 = 564) plus the 8006 datasheet hardware.
  const catalog = await repository.getCatalog();
  const template = catalog.modules.find((module) => module.id === GATE_MODULE_A_ID) ?? catalog.modules[0]!;
  const depthMm = template.externalDims?.depth || 590;
  // La org gate viene sin materiales de tablero: el spec siembra el suyo y el
  // lateral lo consume (el validador exige al menos un rol de opción).
  await repository.saveCatalog({
    ...catalog,
    materials: [
      ...(catalog.materials ?? []).filter((material) => material.id !== LATERAL_MATERIAL_ID),
      {
        id: LATERAL_MATERIAL_ID,
        code: '1263-MEL-18',
        name: 'Melamina 18 lateral',
        widthMm: 2750,
        lengthMm: 1850,
        thicknessMm: 18,
        grainDefault: false,
        boardPrice: 480,
        wastePercent: 10,
        costPerM2: 132,
        active: true,
      },
    ],
    optionGroups: [
      ...catalog.optionGroups.filter((group) => group.code !== LATERAL_GROUP_CODE),
      {
        id: '71810000-0000-4000-8000-000000000008',
        code: LATERAL_GROUP_CODE,
        name: 'Laterales',
        kind: 'board' as const,
        required: true,
        optionIds: [LATERAL_MATERIAL_ID],
      },
    ],
    components: [
      ...(catalog.components ?? []).filter((component) => component.id !== LATERAL_COMPONENT_ID),
      {
        id: LATERAL_COMPONENT_ID,
        code: '1263-LATERAL',
        name: 'Lateral 18',
        placement: 'base' as const,
        geometry: { kind: 'rectangular_board' as const, lengthMm: 720, widthMm: 560, thicknessMm: 18 },
        defaultEdges: [],
        optionRoles: [LATERAL_GROUP_CODE],
        active: true,
        construction: { constructiveRole: 'lateral' as const },
      },
    ],
    structures: [
      ...(catalog.structures ?? []).filter((structure) => structure.id !== STRUCTURE_ID),
      {
        id: STRUCTURE_ID,
        code: '1263-EST-GOLA',
        name: 'Cuerpo gola',
        externalDims: { width: 600, height: 720, depth: depthMm },
        components: [{ componentId: LATERAL_COMPONENT_ID, quantity: 2 }],
        active: true,
      },
    ],
    hardware: [
      ...catalog.hardware.filter((item) => item.id !== HW_PROFILE_8006 && item.id !== HW_SUPPORT_SU116 && item.id !== HW_CAPS_CF8006TP),
      { id: HW_PROFILE_8006, code: '8006', name: 'Perfil GOLA L 8006', unit: 'meter' as const, costPerUnit: 100, active: true },
      { id: HW_SUPPORT_SU116, code: 'SU116', name: 'Soporte GOLA atornillar', unit: 'piece' as const, costPerUnit: 10, active: true },
      { id: HW_CAPS_CF8006TP, code: 'CF8006TP', name: 'Juego tapas terminales', unit: 'piece' as const, costPerUnit: 5, active: true },
    ],
    // Shard-isolation contract (same as production-release-continuity): the
    // shared seed module stays UNTOUCHED — later residents quote it with
    // empty choices. This spec quotes its OWN module wired to the gola
    // structure whose lateral consumes a material choice.
    modules: [
      ...catalog.modules,
      {
        ...template,
        id: OPENING_MODULE_ID,
        code: '1263-GOLA',
        name: 'Gabinete gola 1263',
        structureId: STRUCTURE_ID,
        components: [],
        hardwareLines: [],
        externalDims: { width: 600, height: 720, depth: depthMm },
      },
    ],
  });

  // The verified Cymisa 8006 datasheet slice (docs/fichas): reduction 38.5 +
  // clearance 1.5 ⇒ the ficha's H−40; BOM members with the ficha's SKUs.
  const spacingMm = 400;
  await client.request<unknown>('POST', '/catalog/opening-profiles', {
    token,
    body: {
      id: OPENING_PROFILE_ID,
      code: 'GOLA-L-8006',
      name: 'Gola L Cymisa 8006',
      grip_type: 'gola',
      cross_section_shape: 'L',
      compatible_placements: ['top'],
      front_reduction_mm: 38,
      grip_clearance_mm: 2,
      profile_height_mm: 27,
      profile_depth_mm: 56,
      geometry_origin: 'docs/fichas/perfil_gola_l_ficha_tecnica.pdf (Cymisa 8006)',
      datasheet_status: 'verified',
      body_modifiers: [],
      bom_members: {
        profile: { hardware_id: HW_PROFILE_8006, rule: 'interior_width', unit: 'meter' },
        supports: { hardware_id: HW_SUPPORT_SU116, rule: 'per_length', spacing_mm: spacingMm },
        endCaps: { hardware_id: HW_CAPS_CF8006TP, rule: 'per_exposed_end' },
      },
      active: true,
    },
  });

  const bootstrapped = await client.bootstrapProjectDesign(token, {
    projectName: PROJECT_NAME,
    designName: 'Diseño gola',
    newCustomer: { name: CUSTOMER_NAME },
  }, 'gate-1263-bootstrap');
  const projectId = bootstrapped.binding.project.id;
  const designId = bootstrapped.binding.design.id;

  const furniture = await client.createProjectFurnitureInstance(
    token,
    projectId,
    { furniture_definition_id: OPENING_MODULE_ID },
    'gate-1263-furniture',
  );
  await putWorkingCopyCurrent(client, token, designId, {
    items: [{
      furniture_instance_id: furniture.id,
      furniture_definition_id: OPENING_MODULE_ID,
      parameters: { widthMm: 600, heightMm: 720, depthMm },
      material_choices: { [LATERAL_GROUP_CODE]: LATERAL_MATERIAL_ID },
    }],
  });

  // Select the gola (the Inspector's Aplicar, one PUT) and read the resolved
  // BOM the server returns.
  const before = await client.getDesignWorkingCopy(token, designId);
  const applied = await client.request<DesignOpeningPayload>('PUT', `/designs/${designId}/opening`, {
    token,
    body: {
      system: 'gola',
      profileId: OPENING_PROFILE_ID,
      placements: ['top'],
      expectedWorkingVersion: before.updated_at,
    },
  });
  expect(applied.resolution?.state).toBe('resolved');
  expect(applied.resolution?.bomReason).toBeUndefined();
  expect(applied.resolution?.bomEnds).toEqual({ leftEnd: 'exposed', rightEnd: 'exposed' });
  const bom = applied.resolution?.bom ?? [];
  expect(bom).toHaveLength(3);
  const byMember = Object.fromEntries(bom.map((line) => [line.memberKey, line]));
  // Interior 600 − 2×18 = 564: the run in meters with the exact mm cut.
  expect(byMember.profile?.quantity).toBeCloseTo(0.564, 9);
  expect(byMember.profile?.cutLengthMm).toBe(564);
  expect(byMember.profile?.unit).toBe('meter');
  // ceil(564/400) + 1 = 3 supports; both ends exposed ⇒ 2 caps (v1 default).
  expect(byMember.supports?.quantity).toBe(3);
  expect(byMember.supports?.unit).toBe('piece');
  expect(byMember.endCaps?.quantity).toBe(2);
  // The front carries the ficha's consumption: 720 − 40 = 680.
  expect(applied.resolution?.fronts?.[0]?.heightMm).toBe(680);

  // REOPEN: the state rebuilds from the server — same intent, same lines.
  const reopened = await client.request<DesignOpeningPayload>('GET', `/designs/${designId}/opening`, { token });
  expect(reopened.opening).toEqual(applied.opening);
  expect(reopened.resolution?.bom).toEqual(bom);
  expect(reopened.workingVersion).toBe(applied.workingVersion);

  // Quote: the frozen snapshot carries the same lines and the hardware
  // prices through the one channel (0.564×100 + 3×10 + 2×5 = 96.4).
  const projection = await client.getDesignCommercialProjection(token, projectId, designId);
  expect(projection.status).toBe('current');
  const quote = await client.createInitialDesignQuoteRevision(token, projectId, designId, {
    workingVersion: projection.workingVersion,
    workingFingerprint: projection.workingFingerprint,
  }, 'gate-1263-create-initial-quote');
  expect(quote.revisionNumber).toBe(1);

  const revisions = await client.listProjectQuoteRevisions(token, projectId);
  const snapshot = revisions[0]?.commercialSnapshot;
  const opening = snapshot?.openingBom?.[0];
  expect(opening?.lines).toHaveLength(3);
  const quoteByMember = Object.fromEntries((opening?.lines ?? []).map((line) => [line.memberKey, line]));
  expect(quoteByMember.profile?.cutLengthMm).toBe(564);
  expect(quoteByMember.profile?.quantity).toBeCloseTo(0.564, 9);
  expect(quoteByMember.supports?.quantity).toBe(3);
  expect(quoteByMember.endCaps?.quantity).toBe(2);
  expect(opening?.quoteLineId).toBe(snapshot?.lines?.[0]?.quoteLineId);
  expect(snapshot?.breakdown?.hardwareTotal).toBeCloseTo(96.4, 6);

  // The reader shows the quoted project (the price the gola joined).
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_A_OWNER_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toBeVisible();
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
  await page.goto('/quotes');
  const card = page.getByTestId(`project-card-${projectId}`);
  await expect(card).toBeVisible();
  await expect(card).toContainText(PROJECT_NAME);
  await expect(card.getByTestId('commercial-status-badge')).toContainText('Q1');
});
