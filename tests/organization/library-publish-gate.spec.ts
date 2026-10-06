/**
 * #1102 LIB-AUTH Slice C — browser gate de organización: el ciclo de
 * publicación del bibliotecario contra real Go + PostgreSQL desechable.
 *
 *   1. Editar el borrador (alta de material por la API que usa la UI) → el
 *      diff del draft lo muestra como agregado con label.
 *   2. Publicar → el release nuevo queda PUBLICADO y es el current.
 *   3. Ante error: publicar dos veces es 409 y el current queda intacto;
 *      sin perfiles activos el publish es 422 fail-closed y el release
 *      vigente no se toca; al recuperar el perfil, el mismo draft publica.
 *
 * API-level on purpose (mismo criterio que policy-draft-lifecycle): el gate
 * demuestra el contrato del ciclo, no el render.
 */

import { expect, test } from '@playwright/test';
import { GraneteApiClient, GraneteApiError } from '@granete/storage';
import { required } from './support/api';

const apiBase = required('ORGANIZATION_API_BASE');

async function postCatalog(
  token: string,
  path: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`${path} → ${response.status}: ${JSON.stringify(parsed).slice(0, 300)}`);
  }
  return parsed;
}

// El client generado valida la respuesta contra el schema estricto; algunas
// altas del catálogo no devuelven todas las props requeridas — el gate usa
// fetch crudo y aserta el status.
function clientToken(client: GraneteApiClient): string {
  return (client as unknown as { token?: string }).token ?? '';
}

const suffix = Date.now().toString(36);

async function expectApiError(
  run: () => Promise<unknown>,
  status: number,
): Promise<void> {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(GraneteApiError);
    expect((err as GraneteApiError).status).toBe(status);
    return;
  }
  throw new Error(`expected an API error with status ${status}`);
}

test.describe.serial('Library publish gate (#1102 Slice C)', () => {
  let token = '';
  let hardwareId = '';
  let profileId = '';
  let profileVersion = 0;
  const v1 = `0.gate1.${suffix}`;
  const v3 = `0.gate3.${suffix}`;

  test.beforeAll(async () => {
    // El owner de la org A es platform admin (el gate script lo crea así):
    // el mismo rol bibliotecario del ciclo.
    const login = await new GraneteApiClient(apiBase).login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    token = login.token;

    const hardware = (await postCatalog(token, '/catalog/hardware', {
      code: `GATEHW-${suffix}`,
      name: 'Herraje gate publicación',
      unit: 'piece',
      cost_per_unit: 1,
    })) as { id: string };
    hardwareId = hardware.id;
    const profile = (await postCatalog(token, '/catalog/hardware-profiles', {
      code: `PERF-GATE-${suffix}`,
      name: 'Perfil gate publicación',
      revision: 'r1',
      items: [{ hardwareId: hardware.id, quantity: 2, applicationRole: 'screw' }],
    })) as { id: string; version: number };
    profileId = profile.id;
    profileVersion = profile.version;
  });

  test('editar borrador → diff lo muestra → publicar → queda publicado', async () => {
    const client = new GraneteApiClient(apiBase);
    const draft = await client.createStandardLibraryRelease(token, { version: v1 });

    // EDITAR EL BORRADOR: alta de material — la misma operación de
    // Catálogos, que bajo esta arquitectura escribe el estado de autoría.
    const materialResponse = await fetch(`${apiBase}/catalog/materials`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code: `GATEMAT-${suffix}`,
        name: 'Tablero gate publicación',
        manufacturer: 'Gate Materiales',
        thickness_mm: 18,
        width_mm: 2750,
        length_mm: 1850,
        cost_per_m2: 10,
        active: true,
      }),
    });
    expect(materialResponse.status, 'POST materials = 201 (fabricante obligatorio)').toBe(201);
    const material = (await materialResponse.json()) as { id: string };

    // El DIFF del draft muestra el agregado con label — resumen previo al
    // publish.
    const diff = await client.getStandardLibraryDraftDiff(token, draft.id);
    const addedMaterial = diff.added.find(
      (change) => change.kind === 'material' && change.code === `GATEMAT-${suffix}`,
    );
    expect(addedMaterial, `diff added = ${JSON.stringify(diff.added)}`).toBeTruthy();

    // El draft es identificable en el listado del workspace.
    const drafts = await client.getStandardLibraryDraftReleases(token);
    expect(drafts.map((d) => d.version)).toContain(v1);

    // PUBLICAR: atómico, fail-closed.
    const published = await client.publishStandardLibraryRelease(token, draft.id);
    expect(published.manifestHash).toMatch(/^sha256:/);
    expect(published.resourceCount).toBeGreaterThan(0);

    const current = await client.getStandardCurrentRelease(token);
    expect(current.version).toBe(v1);
    expect(current.id).toBe(draft.id);
  });

  test('publicar dos veces es 409 y el current queda intacto', async () => {
    const client = new GraneteApiClient(apiBase);
    const before = await client.getStandardCurrentRelease(token);
    const drafts = await client.getStandardLibraryDraftReleases(token);
    const published = drafts.find((d) => d.version === v1) ?? (await client.getStandardCurrentRelease(token));

    await expectApiError(
      () => client.publishStandardLibraryRelease(token, published.id),
      409,
    );

    const after = await client.getStandardCurrentRelease(token);
    expect(after.id).toBe(before.id);
    expect(after.version).toBe(v1);
  });

  test('sin perfiles activos el publish es 422 fail-closed; recuperado, el mismo draft publica', async () => {
    const client = new GraneteApiClient(apiBase);
    const draft = await client.createStandardLibraryRelease(token, { version: v3 });

    // Romper la condición de compilación: sin perfiles activos no hay nada
    // que congelar — el validate lo reporta y el publish rechaza. Se
    // desactivan TODOS los activos: el stack puede compartir org con otros
    // specs (y el compile es global, no por perfil del spec).
    const activeProfiles = (await client.listHardwareProfiles(token)).filter((p) => p.active);
    expect(activeProfiles.length).toBeGreaterThan(0);
    for (const profile of activeProfiles) {
      await client.deactivateHardwareProfile(token, profile.id, profile.version);
    }

    const validation = await client.validateStandardLibraryDraft(token, draft.id);
    expect(validation.ok).toBe(false);
    expect(validation.compile.ok).toBe(false);

    await expectApiError(
      () => client.publishStandardLibraryRelease(token, draft.id),
      422,
    );

    // El release vigente (v1) queda EXACTAMENTE igual ante el error.
    const current = await client.getStandardCurrentRelease(token);
    expect(current.version).toBe(v1);

    // Recuperación: un perfil activo nuevo y el MISMO draft publica.
    await client.createHardwareProfile(token, {
      code: `PERF-GATE2-${suffix}`,
      name: 'Perfil gate recuperación',
      revision: 'r1',
      items: [{ hardwareId, quantity: 1, applicationRole: 'screw' }],
    });
    const recovered = await client.publishStandardLibraryRelease(token, draft.id);
    expect(recovered.manifestHash).toMatch(/^sha256:/);
    expect((await client.getStandardCurrentRelease(token)).version).toBe(v3);
    void profileId;
  });
});
