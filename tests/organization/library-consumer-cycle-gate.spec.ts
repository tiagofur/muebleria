/**
 * #1102 LIB-AUTH Slice D — browser gate de organización: el CICLO COMPLETO
 * del issue contra real Go + PostgreSQL desechable.
 *
 *   editar borrador → validar → publicar → UN consumidor fijado a la versión
 *   vieja sigue leyendo la vieja; otro fijado a la nueva la ve; el viejo se
 *   actualiza (mueve su pin) y recién ahí la ve él también.
 *
 * Dos consumidores = dos pins del authoring resolve + los pinned reads de
 * perfiles por release. La geometría resuelta viene del freeze (restante
 * D.1): el ancho congelado de R1 (600) y el editado de R2 (777) son
 * distinguibles en el resultado del resolve. API-level on purpose.
 */

import { expect, test } from '@playwright/test';
import { GraneteApiClient } from '@granete/storage';
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
const schema = {
  schemaId: 'granete.sketchup-authoring-resolve.v1',
  schemaName: 'granete.sketchup-authoring-resolve',
  schemaVersion: '1.0',
};

test.describe.serial('Library consumer cycle gate (#1102 Slice D)', () => {
  let token = '';
  let moduleId = '';
  let releaseR1 = '';
  let releaseR2 = '';
  const v1 = `0.cycle1.${suffix}`;
  const v2 = `0.cycle2.${suffix}`;

  const resolveAuthoring = async (
    definitionId: string,
    pin: string | null,
    catalogRevision: string,
  ) => {
    const client = new GraneteApiClient(apiBase);
    const response = await client.resolveAuthoringLayout(token, {
      ...schema,
      messageId: `gate-${suffix}-${Math.random().toString(36).slice(2)}`,
      idempotencyKey: `gate:${suffix}:${Math.random().toString(36).slice(2)}`,
      sentAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      source: { client: 'granete-browser-gate', clientVersion: '0.0.0', host: 'sketchup', hostVersion: '2026.2' },
      units: { length: 'mm', angle: 'deg', precisionMm: 0.01 },
      coordinateSystem: { handedness: 'right', upAxis: 'z', projectFrameId: 'gate' },
      furniture: {
        furnitureDefinitionId: definitionId,
        catalogRevision,
        ...(pin ? { libraryReleaseId: pin } : {}),
      },
    });
    expect(response.status).toBe('accepted');
    return response;
  };

  // Pineado: la revisión es advisory — el pin es el ancla.
  const resolvePinned = (definitionId: string, pin: string | null) =>
    resolveAuthoring(definitionId, pin, 'gate-frozen-advisory');

  // Vivo: la revisión del catálogo es obligatoria (no hay implícito).
  const resolvePinnedWithRevision = (definitionId: string, pin: string | null, revision: string) =>
    resolveAuthoring(definitionId, pin, revision);

  test.beforeAll(async () => {
    const client = new GraneteApiClient(apiBase);
    const login = await client.login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    token = login.token;

    const hardware = (await postCatalog(token, '/catalog/hardware', {
      code: `CYCHW-${suffix}`,
      name: 'Herraje gate ciclo',
      unit: 'piece',
      cost_per_unit: 2,
    })) as { id: string };
    await postCatalog(token, '/catalog/hardware-profiles', {
      code: `PERF-CYC-${suffix}`,
      name: 'Perfil gate ciclo',
      revision: 'r1',
      items: [{ hardwareId: hardware.id, quantity: 1, applicationRole: 'screw' }],
    });

    // MUEBLE del ciclo: geometría simple, sin estructura ni parámetros —
    // ValidModule pide código, nombre y medidas positivas.
    const module = await client.createCatalogModule(token, {
      code: `CYCMOD-${suffix}`,
      name: 'Mueble gate ciclo',
      width_mm: 600,
      height_mm: 720,
      depth_mm: 560,
    });
    moduleId = module.id;

    // v1 publicada: el estado que el consumidor A fija.
    const draft = await client.createStandardLibraryRelease(token, { version: v1 });
    const published = await client.publishStandardLibraryRelease(token, draft.id);
    expect(published.resourceCount).toBeGreaterThan(0);
    const current = await client.getStandardCurrentRelease(token);
    releaseR1 = current.id;
    expect(current.version).toBe(v1);
  });

  test('el consumidor A fijado a R1 resuelve la geometría congelada de R1', async () => {
    const response = await resolvePinned(moduleId, releaseR1);
    const dimensions = response.resolved?.layout?.dimensionsMm as number[] | undefined;
    expect(dimensions, JSON.stringify(response.resolved ?? {})).toEqual([600, 720, 560]);
  });

  test('editar el borrador NO toca al consumidor pineado', async () => {
    const client = new GraneteApiClient(apiBase);
    const current = await client.getCatalogModule(token, moduleId);
    await client.updateCatalogModule(
      token,
      moduleId,
      current.version,
      {
        code: current.code,
        name: current.name,
        width_mm: 777,
        height_mm: 722,
        depth_mm: 563,
      },
    );

    // Sin pin (estado de autoría): el edit es visible inmediatamente. El
    // path vivo exige la revisión viva real (no hay implícito).
    const definitions = await client.listFurnitureDefinitions(token);
    const live = await resolvePinnedWithRevision(moduleId, null, definitions.revisionId);
    expect(live.resolved?.layout?.dimensionsMm).toEqual([777, 722, 563]);

    // Con el pin en R1: la geometría congelada manda — 600, jamás 777.
    const pinned = await resolvePinned(moduleId, releaseR1);
    expect(pinned.resolved?.layout?.dimensionsMm).toEqual([600, 720, 560]);
  });

  test('publicar v2: el consumidor B la ve, A queda en la vieja hasta actualizar', async () => {
    const client = new GraneteApiClient(apiBase);
    const draft = await client.createStandardLibraryRelease(token, { version: v2 });
    const validation = await client.validateStandardLibraryDraft(token, draft.id);
    expect(validation.ok).toBe(true);
    await client.publishStandardLibraryRelease(token, draft.id);
    const current = await client.getStandardCurrentRelease(token);
    releaseR2 = current.id;
    expect(current.version).toBe(v2);

    // A sigue pineado a R1: la vieja.
    const a = await resolvePinned(moduleId, releaseR1);
    expect(a.resolved?.layout?.dimensionsMm).toEqual([600, 720, 560]);

    // B fija la nueva: la ve.
    const b = await resolvePinned(moduleId, releaseR2);
    expect(b.resolved?.layout?.dimensionsMm).toEqual([777, 722, 563]);

    // A "actualiza su biblioteca" (mueve su pin a R2): recién ahí la ve.
    const aUpdated = await resolvePinned(moduleId, releaseR2);
    expect(aUpdated.resolved?.layout?.dimensionsMm).toEqual([777, 722, 563]);
  });

  test('los pinned reads de perfiles también respetan el pin', async () => {
    // fetch crudo: el blob del perfil no lleva version (server-owned), que el
    // schema estricto del cliente exige.
    const readPinned = async (releaseId: string): Promise<ReadonlyArray<{ code: string }>> => {
      const response = await fetch(
        `${apiBase}/manufacturing-libraries/standard/releases/${releaseId}/hardware-profiles`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(response.ok, `pinned read ${releaseId}: ${response.status}`).toBe(true);
      return (await response.json()) as ReadonlyArray<{ code: string }>;
    };
    const r1Profiles = await readPinned(releaseR1);
    const r2Profiles = await readPinned(releaseR2);
    expect(r1Profiles.map((p) => p.code)).toEqual(r2Profiles.map((p) => p.code));
    expect(r1Profiles.length).toBeGreaterThan(0);
  });
});
