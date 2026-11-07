import { expect, test } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { GATE_MODULE_A_ID, putWorkingCopyCurrent, required, moduleCreatePayload } from './support/api';

// #1532 — the project grip with per-furniture overrides against the real
// backend: the project applies a gola style (ONE complete frozen snapshot),
// one furniture carries a handle exception, the quote freezes the effective
// grip's exact values, a workshop edit never changes the project until the
// explicit «Actualizar» (audited), and clearing the exception inherits again.

const STRUCTURE_ID = '71820000-0000-4000-8000-000000000001';
const LATERAL_COMPONENT_ID = '71820000-0000-4000-8000-000000000002';
const DOOR_COMPONENT_ID = '71820000-0000-4000-8000-00000000000a';
const HW_PROFILE_8006 = '71820000-0000-4000-8000-000000000003';
const HW_SUPPORT_SU116 = '71820000-0000-4000-8000-000000000004';
const HW_CAPS_CF8006TP = '71820000-0000-4000-8000-000000000005';
const OPENING_PROFILE_ID = '71820000-0000-4000-8000-000000000006';
const GRIP_MODULE_ID = '71820000-0000-4000-8000-000000000009';
const LATERAL_MATERIAL_ID = '71820000-0000-4000-8000-000000000007';
const LATERAL_GROUP_CODE = 'LATERAL_MAT_1532';

const PROJECT_NAME = 'Obra Agarre Proyecto E2E';
const CUSTOMER_NAME = 'Cliente Agarre Proyecto E2E';
const GOLA_STYLE_NAME = 'Gola E2E 1532';
const HANDLE_STYLE_NAME = 'Jaladera E2E 1532';

interface GripStyleRecipe {
  readonly mode: string;
  readonly topProfileId?: string;
}

interface ProjectGripState {
  readonly projectId: string;
  readonly gripStyleId: string | null;
  readonly gripVersion: number;
  readonly snapshot: {
    readonly styleId: string;
    readonly recipes: Record<string, GripStyleRecipe>;
  } | null;
  readonly overrides: readonly { readonly furnitureInstanceId: string }[];
  readonly report?: {
    readonly items: readonly {
      readonly furnitureInstanceId: string;
      readonly source: 'project' | 'override';
      readonly recipeMode: string;
      readonly layout?: {
        readonly state: string;
        readonly rows?: readonly { readonly id: string; readonly bottomMm: number; readonly heightMm: number }[];
      };
    }[];
  };
}

test('1532: el agarre del proyecto hereda, la excepción por mueble manda y la cotización congela los valores', async ({ page }) => {
  test.setTimeout(300_000);
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

  // Catalog: a 600-wide module with 18mm lateral sides (interior 564), the
  // 8006 hardware and the v2 gola profile (workshop discount 40 at the top).
  const catalog = await repository.getCatalog();
  const template = catalog.modules.find((module) => module.id === GATE_MODULE_A_ID) ?? catalog.modules[0]!;
  const depthMm = template.externalDims?.depth || 590;
  await repository.saveCatalog({
    ...catalog,
    materials: [
      ...(catalog.materials ?? []).filter((material) => material.id !== LATERAL_MATERIAL_ID),
      {
        id: LATERAL_MATERIAL_ID,
        code: '1532-MEL-18',
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
      ...(catalog.components ?? []).filter((component) => component.id !== LATERAL_COMPONENT_ID && component.id !== DOOR_COMPONENT_ID),
      {
        id: DOOR_COMPONENT_ID,
        code: '1532-DOOR',
        name: 'Puerta agarre',
        placement: 'puerta' as const,
        geometry: { kind: 'rectangular_board' as const, lengthMm: 716, widthMm: 560, thicknessMm: 18 },
        defaultEdges: [],
        optionRoles: [LATERAL_GROUP_CODE],
        active: true,
      },
      {
        id: LATERAL_COMPONENT_ID,
        code: '1532-LATERAL',
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
        code: '1532-EST-GRIP',
        name: 'Cuerpo agarre',
        externalDims: { width: 600, height: 720, depth: depthMm },
        components: [
          { componentId: LATERAL_COMPONENT_ID, quantity: 2 },
          { componentId: DOOR_COMPONENT_ID, quantity: 1 },
        ],
        active: true,
      },
    ],
    hardware: [
      ...catalog.hardware.filter((item) => item.id !== HW_PROFILE_8006 && item.id !== HW_SUPPORT_SU116 && item.id !== HW_CAPS_CF8006TP),
      { id: HW_PROFILE_8006, code: '8006', name: 'Perfil GOLA L 8006', unit: 'meter' as const, costPerUnit: 100, active: true },
      { id: HW_SUPPORT_SU116, code: 'SU116', name: 'Soporte GOLA atornillar', unit: 'piece' as const, costPerUnit: 10, active: true },
      { id: HW_CAPS_CF8006TP, code: 'CF8006TP', name: 'Juego tapas terminales', unit: 'piece' as const, costPerUnit: 5, active: true },
    ],
    modules: [
      ...catalog.modules,
      {
        ...moduleCreatePayload(template),
        id: GRIP_MODULE_ID,
        code: '1532-GRIP',
        name: 'Gabinete agarre 1532',
        structureId: STRUCTURE_ID,
        components: [],
        hardwareLines: [],
        externalDims: { width: 600, height: 720, depth: depthMm },
      },
    ],
  });

  // The v2 gola profile: the workshop discount 40 at the top drives the same
  // H−40 arithmetic; the BOM members are the ficha's SKUs.
  const spacingMm = 400;
  await client.request<unknown>('POST', '/catalog/opening-profiles', {
    token,
    body: {
      id: OPENING_PROFILE_ID,
      code: 'GOLA-L-8006-1532',
      name: 'Gola L Cymisa 8006',
      grip_type: 'gola',
      cross_section_shape: 'L',
      material: 'aluminum',
      positions: ['top'],
      front_discount_top_mm: 40,
      profile_height_mm: 56.5,
      profile_depth_mm: 27.2,
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

  // The two workshop styles: gola (the project's choice) and handle (the
  // furniture exception).
  const golaStyle = await client.request<{ readonly id: string }>('POST', '/catalog/grip-styles', {
    token,
    body: {
      name: GOLA_STYLE_NAME,
      offered: true,
      isDefault: false,
      byFurnitureType: {
        inferior: { mode: 'gola', topProfileId: OPENING_PROFILE_ID },
        superior: { mode: 'gola', topProfileId: OPENING_PROFILE_ID },
        alto: { mode: 'gola', topProfileId: OPENING_PROFILE_ID },
      },
    },
  });
  const handleStyle = await client.request<{ readonly id: string }>('POST', '/catalog/grip-styles', {
    token,
    body: {
      name: HANDLE_STYLE_NAME,
      offered: true,
      isDefault: false,
      byFurnitureType: {
        inferior: { mode: 'handle' },
        superior: { mode: 'handle' },
        alto: { mode: 'handle' },
      },
    },
  });

  const bootstrapped = await client.bootstrapProjectDesign(token, {
    projectName: PROJECT_NAME,
    designName: 'Diseño agarre',
    newCustomer: { name: CUSTOMER_NAME },
  }, 'gate-1532-bootstrap');
  const projectId = bootstrapped.binding.project.id;
  const designId = bootstrapped.binding.design.id;

  const furnitureA = await client.createProjectFurnitureInstance(
    token,
    projectId,
    { furniture_definition_id: GRIP_MODULE_ID },
    'gate-1532-furniture-a',
  );
  const furnitureB = await client.createProjectFurnitureInstance(
    token,
    projectId,
    { furniture_definition_id: GRIP_MODULE_ID },
    'gate-1532-furniture-b',
  );
  await putWorkingCopyCurrent(client, token, designId, {
    items: [
      {
        furniture_instance_id: furnitureA.id,
        furniture_definition_id: GRIP_MODULE_ID,
        parameters: { widthMm: 600, heightMm: 720, depthMm },
        material_choices: { [LATERAL_GROUP_CODE]: LATERAL_MATERIAL_ID },
      },
      {
        furniture_instance_id: furnitureB.id,
        furniture_definition_id: GRIP_MODULE_ID,
        parameters: { widthMm: 600, heightMm: 720, depthMm },
        material_choices: { [LATERAL_GROUP_CODE]: LATERAL_MATERIAL_ID },
      },
    ],
  });

  // The project applies the gola style: ONE complete frozen snapshot (A7).
  const initialGrip = await client.request<ProjectGripState>('GET', `/projects/${projectId}/grip`, { token });
  const afterApply = await client.request<ProjectGripState>('PUT', `/projects/${projectId}/grip`, {
    token,
    body: { gripStyleId: golaStyle.id },
    ifMatch: initialGrip.gripVersion,
  });
  expect(afterApply.gripVersion).toBe(initialGrip.gripVersion + 1);
  expect(afterApply.snapshot?.styleId).toBe(golaStyle.id);
  expect(afterApply.snapshot?.recipes.inferior.mode).toBe('gola');

  // The facade (the plugin's card until #1535): the design derives the
  // effective grip of its furniture — the frozen discount 40 gives 680.
  // (Checked before any override exists, so every furniture inherits.)
  const facade = await client.request<{
    readonly opening?: { readonly system: string } | null;
    readonly resolution?: { readonly state: string; readonly fronts?: readonly { readonly heightMm: number }[] } | null;
  }>('GET', `/designs/${designId}/opening`, { token });
  expect(facade.opening?.system).toBe('gola');
  expect(facade.resolution?.state).toBe('resolved');
  expect(facade.resolution?.fronts?.[0]?.heightMm).toBe(680);

  // available ≠ valid: a stale If-Match on the style change is a conflict
  // (the client surfaces non-2xx as thrown errors with the status).
  const stale = await client.request<unknown>('PUT', `/projects/${projectId}/grip`, {
    token,
    body: { gripStyleId: handleStyle.id },
    ifMatch: initialGrip.gripVersion,
  }).then(
    () => null,
    (err: unknown) => err as { status?: number },
  );
  expect(stale?.status).toBe(412);

  // The exception: furniture B freezes the handle style (one operation).
  const afterOverride = await client.request<ProjectGripState>('PUT', `/projects/${projectId}/grip/furniture`, {
    token,
    body: { overrides: [{ furnitureInstanceId: furnitureB.id, gripStyleId: handleStyle.id }] },
    ifMatch: afterApply.gripVersion,
  });
  expect(afterOverride.gripVersion).toBe(afterApply.gripVersion + 1);

  // The report: A inherits the project's gola; B carries its own handle
  // override; the A3 layout rows ride with the inherited grip.
  const reported = await client.request<ProjectGripState>('GET', `/projects/${projectId}/grip`, { token });
  const reportByInstance = Object.fromEntries((reported.report?.items ?? []).map((item) => [item.furnitureInstanceId, item]));
  expect(reportByInstance[furnitureA.id]?.source).toBe('project');
  expect(reportByInstance[furnitureA.id]?.recipeMode).toBe('gola');
  expect(reportByInstance[furnitureB.id]?.source).toBe('override');
  expect(reportByInstance[furnitureB.id]?.recipeMode).toBe('handle');
  expect(reportByInstance[furnitureA.id]?.layout?.state).toBe('resolved');

  // Quote: the frozen snapshot section carries exactly the inherited grip's
  // lines for the gola unit (0.564 m run, 3 supports, 2 caps); the handle
  // unit contributes none — its exception governs.
  const projection = await client.getDesignCommercialProjection(token, projectId, designId);
  expect(projection.status).toBe('current');
  const quote = await client.createInitialDesignQuoteRevision(token, projectId, designId, {
    workingVersion: projection.workingVersion,
    workingFingerprint: projection.workingFingerprint,
  }, 'gate-1532-create-initial-quote');
  const revisions = await client.listProjectQuoteRevisions(token, projectId);
  const snapshot = revisions[0]?.commercialSnapshot;
  const openingSections = snapshot?.openingBom ?? [];
  expect(openingSections).toHaveLength(1);
  expect(openingSections[0]?.lines).toHaveLength(3);
  const quoteByMember = Object.fromEntries((openingSections[0]?.lines ?? []).map((line) => [line.memberKey, line]));
  expect(quoteByMember.profile?.cutLengthMm).toBe(564);
  expect(quoteByMember.profile?.quantity).toBeCloseTo(0.564, 9);
  expect(quoteByMember.supports?.quantity).toBe(3);
  expect(quoteByMember.endCaps?.quantity).toBe(2);
  // The provenance is the FROZEN copy: the frozen BOM revision, never a
  // live join.
  expect(quoteByMember.profile?.profileCode).toBe('GOLA-L-8006-1532');

  // A workshop edit never changes an existing project (A7): the profile's
  // discount moves 40 → 60 in the taller, and the frozen fronts stay 680.
  const profileRead = await client.request<{ readonly version: number }>('GET', `/catalog/opening-profiles/${OPENING_PROFILE_ID}`, { token });
  await client.request<unknown>('PUT', `/catalog/opening-profiles/${OPENING_PROFILE_ID}`, {
    token,
    body: {
      code: 'GOLA-L-8006-1532',
      name: 'Gola L Cymisa 8006',
      grip_type: 'gola',
      cross_section_shape: 'L',
      material: 'aluminum',
      positions: ['top'],
      front_discount_top_mm: 60,
      profile_height_mm: 56.5,
      profile_depth_mm: 27.2,
      datasheet_status: 'verified',
      body_modifiers: [],
      bom_members: {
        profile: { hardware_id: HW_PROFILE_8006, rule: 'interior_width', unit: 'meter' },
        supports: { hardware_id: HW_SUPPORT_SU116, rule: 'per_length', spacing_mm: spacingMm },
        endCaps: { hardware_id: HW_CAPS_CF8006TP, rule: 'per_exposed_end' },
      },
      active: true,
    },
    ifMatch: profileRead.version,
  });
  const afterWorkshopEdit = await client.request<ProjectGripState>('GET', `/projects/${projectId}/grip`, { token });
  const frozenItem = afterWorkshopEdit.report?.items.find((item) => item.furnitureInstanceId === furnitureA.id);
  expect(frozenItem?.layout?.state, JSON.stringify(afterWorkshopEdit.report)).toBe('resolved');
  const frozenRows = frozenItem?.layout?.rows ?? [];
  const frozenDoor = frozenRows[frozenRows.length - 1];
  expect(frozenDoor?.heightMm).toBe(680);

  // «Actualizar a los valores actuales del taller» (explicit + If-Match):
  // the project re-freezes from the style's current values — 720 − 60 = 660.
  const refreshed = await client.request<ProjectGripState>('POST', `/projects/${projectId}/grip:refresh`, {
    token,
    body: { includeOverrides: true },
    ifMatch: afterWorkshopEdit.gripVersion,
  });
  expect(refreshed.gripVersion).toBe(afterWorkshopEdit.gripVersion + 1);
  const afterRefresh = await client.request<ProjectGripState>('GET', `/projects/${projectId}/grip`, { token });
  const refreshedRows = afterRefresh.report?.items.find((item) => item.furnitureInstanceId === furnitureA.id)?.layout?.rows ?? [];
  const refreshedDoor = refreshedRows[refreshedRows.length - 1];
  expect(refreshedDoor?.heightMm).toBe(660);

  // Clearing the exception: the furniture inherits the project again — the
  // handle override disappears and the report says so.
  const afterClear = await client.request<ProjectGripState>('PUT', `/projects/${projectId}/grip/furniture`, {
    token,
    body: { overrides: [{ furnitureInstanceId: furnitureB.id, gripStyleId: null }] },
    ifMatch: refreshed.gripVersion,
  });
  expect(afterClear.gripVersion).toBe(refreshed.gripVersion + 1);
  const finalReport = await client.request<ProjectGripState>('GET', `/projects/${projectId}/grip`, { token });
  const finalByInstance = Object.fromEntries((finalReport.report?.items ?? []).map((item) => [item.furnitureInstanceId, item]));
  expect(finalByInstance[furnitureB.id]?.source).toBe('project');
  expect(finalByInstance[furnitureB.id]?.recipeMode).toBe('gola');
});
