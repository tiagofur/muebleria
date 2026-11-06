/**
 * #1329 → #1531 proof: the workshop's STANDARD gola profile per section now
 * comes from its default grip style (the overlay curation it was saved to is
 * retired). The SketchUp extension reads it from
 * GET /catalog/opening-capabilities, projected from the styles.
 *
 * Two usable gola L of different makers exist; the default style uses one
 * of them on top, so that one is the L standard and both stay offered only
 * when a style references them.
 */
import { expect, test } from '@playwright/test';
import { GraneteApiClient, type GripStyle, type GripStyleWrite } from '@granete/storage';
import { required } from './support/api';

const RUN = Date.now().toString(36);

interface CapabilitiesPayload {
  readonly opening_capabilities: {
    readonly grips: Record<string, { readonly enabled: boolean; readonly profiles?: readonly string[]; readonly standardProfiles?: Record<string, string> }>;
  } | null;
}

function asWrite(style: GripStyle, isDefault: boolean): GripStyleWrite {
  return { name: style.name, offered: style.offered, isDefault, byFurnitureType: style.byFurnitureType };
}

test('1531: el estándar L sale del estilo de agarre predeterminado', async () => {
  test.setTimeout(180_000);
  const client = new GraneteApiClient(required('ORGANIZATION_API_BASE'));
  const owner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  const token = owner.token;

  const idScilm = `profile.gola-l-scilm-${RUN}`;
  const idMarcaB = `profile.gola-l-marca-b-${RUN}`;
  const seedProfile = (id: string, code: string, name: string, manufacturer: string) =>
    client.request<unknown>('POST', '/catalog/opening-profiles', {
      token,
      body: {
        id,
        code,
        name,
        manufacturer,
        material: 'aluminum',
        cross_section_shape: 'L',
        positions: ['top'],
        front_discount_top_mm: 40,
        profile_height_mm: 56.5,
        profile_depth_mm: 27.2,
        geometry_origin: `Ficha E2E #1531 (${manufacturer})`,
        body_modifiers: [],
        bom_members: {},
        active: true,
      },
    });
  await seedProfile(idScilm, `GOLA-L-SCILM-${RUN}`, 'Gola L SCILM 8006', 'SCILM');
  await seedProfile(idMarcaB, `GOLA-L-MARCA-B-${RUN}`, 'Gola L Marca B', 'Marca B');

  const previousDefault = (await client.listGripStyles(token)).find((style) => style.isDefault);
  expect(previousDefault).toBeDefined();

  const gola = await client.createGripStyle(token, {
    name: `Gola SCILM ${RUN}`,
    offered: true,
    isDefault: true,
    byFurnitureType: {
      inferior: { mode: 'gola', topProfileId: idScilm },
      superior: { mode: 'handle' },
      alto: { mode: 'gola', topProfileId: idScilm },
    },
  });

  const read = await client.request<CapabilitiesPayload>('GET', '/catalog/opening-capabilities', { token });
  const golaCaps = read.opening_capabilities?.grips.gola;
  expect(golaCaps?.enabled).toBe(true);
  expect(golaCaps?.profiles).toContain(idScilm);
  expect(golaCaps?.profiles ?? []).not.toContain(idMarcaB);
  expect(golaCaps?.standardProfiles?.L).toBe(idScilm);

  // A style that references an unusable position is refused (422).
  const refused = await client.createGripStyle(token, {
    name: `Gola entre mala ${RUN}`,
    offered: true,
    isDefault: false,
    byFurnitureType: {
      inferior: { mode: 'gola', topProfileId: idScilm, betweenProfileId: idMarcaB },
      superior: { mode: 'handle' },
      alto: { mode: 'handle' },
    },
  }).then(() => null, (err: unknown) => err as { status?: number });
  expect(refused?.status).toBe(422);

  // Leave the shared org as other specs expect it.
  const previous = (await client.listGripStyles(token)).find((style) => style.id === previousDefault?.id);
  if (previous) await client.updateGripStyle(token, previous.id, previous.version, asWrite(previous, true));
  const mine = (await client.listGripStyles(token)).find((style) => style.id === gola.id);
  if (mine) await client.deleteGripStyle(token, mine.id, mine.version);
});
