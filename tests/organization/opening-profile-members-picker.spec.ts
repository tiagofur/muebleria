/**
 * #1526 browser proof: the opening profile editor picks its parts from the
 * catalogs (search by name or code, no UUID typing), keys hardware members by
 * the roles the engine reads, and carries spacing + envelope. The profile
 * created ONLY through the screen is then applied to a design and the server
 * resolves its three BOM lines (perfil, soportes, tapas).
 *
 * The catalog seeding mirrors opening-bom-quote.spec.ts (#1263) with its own
 * ids, so the two specs never share rows.
 */
import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { GATE_MODULE_A_ID, putWorkingCopyCurrent, required, moduleCreatePayload } from './support/api';

const RUN = Date.now().toString(36);
const STRUCTURE_ID = '71820000-0000-4000-8000-000000000001';
const LATERAL_COMPONENT_ID = '71820000-0000-4000-8000-000000000002';
const HW_PROFILE_8006 = '71820000-0000-4000-8000-000000000003';
const HW_SUPPORT_SU116 = '71820000-0000-4000-8000-000000000004';
const HW_CAPS_CF8006TP = '71820000-0000-4000-8000-000000000005';
const OPENING_MODULE_ID = '71820000-0000-4000-8000-000000000009';
const LATERAL_MATERIAL_ID = '71820000-0000-4000-8000-000000000007';
const LATERAL_GROUP_CODE = 'LATERAL_MAT_1526';
const PROFILE_ID = `profile.gola-1526-${RUN}`;

interface OpeningBomLine {
  readonly memberKey: string;
  readonly hardwareId: string;
  readonly quantity: number;
  readonly unit: string;
  readonly cutLengthMm?: number;
}

interface DesignOpeningPayload {
  readonly resolution?: {
    readonly state: string;
    readonly bom?: readonly OpeningBomLine[];
    readonly bomReason?: string;
  } | null;
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

async function addHardwareMember(page: Page, index: number, role: string, query: string, option: RegExp): Promise<void> {
  await page.getByTestId('opening-profile-member-add').click();
  const row = page.getByTestId('opening-profile-member-row').nth(index);
  await row.getByTestId('opening-profile-member-role').selectOption(role);
  const picker = row.getByTestId('opening-profile-member-picker');
  await picker.getByRole('button').first().click();
  await picker.getByLabel('Nombre o código').fill(query);
  await picker.getByRole('option', { name: option }).click();
}

test('1526: el perfil se arma eligiendo herrajes por nombre o código y su BOM resuelve', async ({ page }) => {
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
        code: '1526-MEL-18',
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
        id: '71820000-0000-4000-8000-000000000008',
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
        code: '1526-LATERAL',
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
        code: '1526-EST-GOLA',
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
        ...moduleCreatePayload(template),
        id: OPENING_MODULE_ID,
        code: '1526-GOLA',
        name: 'Gabinete gola 1263',
        structureId: STRUCTURE_ID,
        components: [],
        hardwareLines: [],
        externalDims: { width: 600, height: 720, depth: depthMm },
      },
    ],
  });

  // The profile is created ONLY through the screen: parts picked by name or
  // code from the catalog, roles from the select, spacing and envelope typed.
  await loginToA(page);
  await page.goto('/opening-profiles');
  await page.getByTestId('opening-profile-create-btn').click();
  await page.getByTestId('opening-profile-id-input').fill(PROFILE_ID);
  await page.getByTestId('opening-profile-code-input').fill(`GOLA-1526-${RUN}`);
  await page.getByTestId('opening-profile-name-input').fill('Gola L 8006 (picker)');
  await expect(page.getByTestId('opening-profile-grip-select').locator('option')).toHaveCount(1);
  await page.getByTestId('opening-profile-status-select').selectOption('verified');
  await page.getByTestId('opening-profile-door-reduction').fill('40');
  await page.getByTestId('opening-profile-height').fill('56.5');
  await page.getByTestId('opening-profile-depth').fill('27.2');
  await page.getByTestId('opening-profile-origin-input').fill('Ficha SCILM 2022-04-01 p. 42 (E2E #1526)');

  await addHardwareMember(page, 0, 'profile', 'Perfil GOLA', /Perfil GOLA L 8006/);
  await addHardwareMember(page, 1, 'supports', 'SU116', /Soporte GOLA atornillar/);
  const supports = page.getByTestId('opening-profile-member-row').nth(1);
  await supports.getByTestId('opening-profile-member-spacing').fill('600');
  await supports.getByTestId('opening-profile-member-dim-0').fill('39.5');
  await supports.getByTestId('opening-profile-member-dim-1').fill('16.5');
  await supports.getByTestId('opening-profile-member-dim-2').fill('20');
  await addHardwareMember(page, 2, 'endCaps', 'tapas', /Juego tapas terminales/);
  await expect(page.getByTestId('opening-profile-member-ref')).toHaveCount(0);
  await page.getByTestId('opening-profile-form-submit-btn').click();
  await expect(page.getByTestId('opening-profile-form-modal')).toHaveCount(0, { timeout: 15_000 });

  // The server stored the exact keys, references, spacing and envelope.
  const stored = await client.request<{ bom_members: Record<string, { hardware_id: string; rule: string; spacing_mm?: number; dimensions_mm?: number[] }> }>(
    'GET', `/catalog/opening-profiles/${PROFILE_ID}`, { token },
  );
  expect(Object.keys(stored.bom_members).sort()).toEqual(['endCaps', 'profile', 'supports']);
  expect(stored.bom_members.profile).toMatchObject({ hardware_id: HW_PROFILE_8006, rule: 'interior_width' });
  expect(stored.bom_members.supports).toMatchObject({ hardware_id: HW_SUPPORT_SU116, rule: 'per_length', spacing_mm: 600, dimensions_mm: [39.5, 16.5, 20] });
  expect(stored.bom_members.endCaps).toMatchObject({ hardware_id: HW_CAPS_CF8006TP, rule: 'per_exposed_end' });

  // Applied to a design, the server resolves the three BOM lines.
  const bootstrapped = await client.bootstrapProjectDesign(token, {
    projectName: `Obra picker 1526 ${RUN}`,
    designName: 'Diseño gola picker',
    newCustomer: { name: `Cliente picker 1526 ${RUN}` },
  }, `gate-1526-bootstrap-${RUN}`);
  const projectId = bootstrapped.binding.project.id;
  const designId = bootstrapped.binding.design.id;
  const furniture = await client.createProjectFurnitureInstance(
    token, projectId, { furniture_definition_id: OPENING_MODULE_ID }, `gate-1526-furniture-${RUN}`,
  );
  await putWorkingCopyCurrent(client, token, designId, {
    items: [{
      furniture_instance_id: furniture.id,
      furniture_definition_id: OPENING_MODULE_ID,
      parameters: { widthMm: 600, heightMm: 720, depthMm },
      material_choices: { [LATERAL_GROUP_CODE]: LATERAL_MATERIAL_ID },
    }],
  });
  const before = await client.getDesignWorkingCopy(token, designId);
  const applied = await client.request<DesignOpeningPayload>('PUT', `/designs/${designId}/opening`, {
    token,
    body: { system: 'gola', profileId: PROFILE_ID, placements: ['top'], expectedWorkingVersion: before.updated_at },
  });
  expect(applied.resolution?.state).toBe('resolved');
  expect(applied.resolution?.bomReason).toBeUndefined();
  const byMember = Object.fromEntries((applied.resolution?.bom ?? []).map((line) => [line.memberKey, line]));
  expect(Object.keys(byMember).sort()).toEqual(['endCaps', 'profile', 'supports']);
  // Interior 600 − 2×18 = 564; ceil(564/600) + 1 = 2 supports; 2 exposed ends.
  expect(byMember.profile?.cutLengthMm).toBe(564);
  expect(byMember.supports?.quantity).toBe(2);
  expect(byMember.endCaps?.quantity).toBe(2);
});
