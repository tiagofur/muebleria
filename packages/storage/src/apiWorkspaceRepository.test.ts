import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Hardware, MaterialBoard } from '@granete/domain';
import { APIWorkspaceRepository } from './apiWorkspaceRepository';
import type { Catalog } from '@granete/domain';
import { ProjectInlineUpdateHttpError } from './workspaceRepository';

describe('APIWorkspaceRepository', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('maps a project-scoped production claim without item or module data', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        activity: {
          id: 'activity-1',
          project_id: 'p1',
          project_name: 'Cocina López',
          sector: 'cutting',
          type: 'claim',
          operator_id: 'u1',
          operator_name: 'Ramón',
          started_at: '2026-08-18T10:00:00Z',
          created_at: '2026-08-18T10:00:00Z',
        },
      }),
    } as Response);

    const repo = new APIWorkspaceRepository();
    const activity = await repo.claimProductionActivity({
      projectId: 'p1',
      sector: 'cutting',
    });

    expect(activity).toMatchObject({
      id: 'activity-1',
      projectId: 'p1',
      projectName: 'Cocina López',
      sector: 'cutting',
      operatorId: 'u1',
    });
    expect(activity.itemId).toBeUndefined();
    expect(activity.moduleCode).toBeUndefined();
  });

  it('loads catalog and projects mapping snake_case from API', async () => {
    const mockMaterials = [
      {
        id: 'm1',
        code: 'MAT1',
        name: 'Board 1',
        width_mm: 1830,
        length_mm: 2440,
        thickness_mm: 15,
        grain_default: false,
        board_price: 100,
        waste_percent: 10,
        cost_per_m2: 20,
        active: true,
      },
    ];

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/catalog/materials')) {
        return {
          ok: true,
          json: async () => mockMaterials,
        } as Response;
      }
      if (url.includes('/projects')) {
        return {
          ok: true,
          json: async () => [
            {
              id: 'p1',
              name: 'Proj',
              customer_id: 'c1',
              currency: 'UYU',
              margin_factor: 1.35,
              labor_fixed_cost: 0,
              status: 'draft',
              items: [],
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
            },
          ],
        } as Response;
      }
      return {
        ok: true,
        json: async () => [],
      } as Response;
    });

    const repo = new APIWorkspaceRepository();
    const ws = await repo.load();

    expect(ws.catalog.materials[0]?.widthMm).toBe(1830);
    expect(ws.projects[0]?.customerId).toBe('c1');
    expect(ws.catalog.modules).toEqual([]);
  });

  it('loads ambient materials and maps them through getCatalog', async () => {
    const mockAmbient = [
      {
        id: 'am1',
        code: 'CERAM',
        name: 'Cerámica blanca',
        active: true,
        surface_type: 'floor',
        preview_color: '#eeeeee',
        preview_texture_url: '/api/media/ceram.webp',
        preview_texture_tile_width_mm: 400,
        preview_texture_tile_length_mm: 400,
      },
    ];

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/catalog/ambient-materials')) {
        return { ok: true, json: async () => mockAmbient } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository();
    const ws = await repo.load();
    const ambient = ws.catalog.ambientMaterials ?? [];

    expect(ambient).toHaveLength(1);
    expect(ambient[0]?.surfaceType).toBe('floor');
    expect(ambient[0]?.previewColor).toBe('#eeeeee');
    expect(ambient[0]?.previewTextureTileWidthMm).toBe(400);
  });

  it('getCatalog tolerates a missing ambient-materials endpoint (older backend)', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/catalog/ambient-materials')) {
        return { ok: false, status: 404, statusText: 'Not Found' } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository();
    const ws = await repo.load();

    // .catch(() => []) keeps older backends working: ambient renders as none.
    expect(ws.catalog.ambientMaterials).toEqual([]);
  });

  it('normalizes JSON null list payloads to empty arrays', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      // Modules and hardware ride the generated contract: those lists must be
      // real arrays; every other endpoint keeps the legacy null payload under
      // test.
      const url = String(input);
      if (url.endsWith('/catalog/modules') || url.endsWith('/catalog/hardware')) {
        return { ok: true, json: async () => [] } as Response;
      }
      return { ok: true, json: async () => null } as Response;
    });

    const repo = new APIWorkspaceRepository();
    const ws = await repo.load();

    expect(ws.projects).toEqual([]);
    expect(ws.catalog.materials).toEqual([]);
    expect(ws.catalog.modules).toEqual([]);
    expect(ws.catalog.customers).toEqual([]);
  });

  it('saveCatalog PUTs snake_case material body', async () => {
    const putBodies: string[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === 'PUT' && url.includes('/catalog/materials/')) {
        putBodies.push(String(init.body));
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (url.includes('/catalog/materials/m1') && (init?.method ?? 'GET') === 'GET') {
        // #1091: the guarded write learns the server version first.
        return { ok: true, json: async () => ({ id: 'm1', version: 2 }) } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository();
    await repo.saveCatalog({
      materials: [
        {
          id: 'm1',
          code: 'T1',
          name: 'Tab',
          widthMm: 100,
          lengthMm: 200,
          thicknessMm: 15,
          grainDefault: false,
          boardPrice: 10,
          wastePercent: 0,
          costPerM2: 1,
          active: true,
        },
      ],
      edges: [],
      hardware: [],
      optionGroups: [],
      modules: [],
      categories: [],
      customers: [],
    });

    expect(putBodies).toHaveLength(1);
    const body = JSON.parse(putBodies[0]!);
    expect(body.width_mm).toBe(100);
    expect(body.board_price).toBe(10);
  });

  it('saveCatalog PUTs module parameter_definitions verbatim (#905)', async () => {
    const putBodies: Record<string, unknown>[] = [];
    const mod905Wire = {
      id: 'mod-905',
      code: 'M-905',
      name: 'Gabinete 905',
      base_labor_cost: 0,
      width_mm: 0,
      height_mm: 0,
      depth_mm: 0,
      categoryId: '',
      structure_id: '',
      components: [],
      agregados: [],
      presets: [],
      image_url: '',
      notes: '',
      hardware_lines: [],
      parameter_definitions: [],
      version: 2,
    };
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === 'PUT' && url.includes('/catalog/modules/')) {
        putBodies.push(JSON.parse(String(init.body)));
        return { ok: true, json: async () => mod905Wire } as Response;
      }
      if (init?.method === 'GET' && url.includes('/catalog/modules/mod-905')) {
        return { ok: true, json: async () => mod905Wire } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository();
    await repo.saveCatalog({
      materials: [],
      edges: [],
      hardware: [],
      optionGroups: [],
      modules: [
        {
          id: 'mod-905',
          code: 'M-905',
          name: 'Gabinete 905',
          baseLaborCost: 0,
          hardwareLines: [],
          parameterDefinitions: [
            {
              name: 'baseJointStations',
              label: 'Fijaciones base por unión',
              type: 'number',
              defaultValue: 3,
              required: true,
              unit: 'count',
              category: 'configuration',
              integer: true,
              binding: {
                version: 1,
                kind: 'structureRelationship',
                componentId: 'comp-floor',
                relationship: {
                  kind: 'floor-side',
                  sourceRole: 'floor-edge',
                  targets: [{ componentId: 'comp-side', role: 'inside-face', face: 'front' }],
                  station: { startMarginMm: 40, endMarginMm: 40 },
                },
              },
            },
          ],
        } as unknown as Catalog['modules'][number],
      ],
      categories: [],
      customers: [],
    });

    expect(putBodies).toHaveLength(1);
    const definitions = putBodies[0]!.parameter_definitions as Record<string, unknown>[];
    expect(definitions).toHaveLength(1);
    expect(definitions[0]!.name).toBe('baseJointStations');
    expect((definitions[0]!.binding as Record<string, unknown>).kind).toBe('structureRelationship');
  });

  it('saveCatalog PUTs snake_case ambientMaterials body', async () => {
    const putRequests: {
      url: string;
      body: Record<string, unknown>;
      ifMatch?: string;
    }[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === 'PUT' && url.includes('/catalog/ambient-materials/')) {
        putRequests.push({
          url,
          body: JSON.parse(String(init.body)) as Record<string, unknown>,
          ifMatch: (init.headers as Record<string, string>)['If-Match'],
        });
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (init?.method === 'GET' && url.includes('/catalog/ambient-materials/')) {
        // #1091/#1149: the guarded write learns the server version first.
        return { ok: true, json: async () => ({ id: 'amb-1', version: 1 }) } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository();
    await repo.saveCatalog({
      materials: [],
      edges: [],
      hardware: [],
      optionGroups: [],
      modules: [],
      categories: [],
      customers: [],
      ambientMaterials: [
        {
          id: 'amb-1',
          code: 'PISO-01',
          name: 'Porcelanato Gris 60x60',
          active: true,
          surfaceType: 'floor',
          previewColor: '#cccccc',
          previewTextureTileWidthMm: 600,
          previewTextureTileLengthMm: 600,
        },
      ],
    });

  expect(putRequests).toHaveLength(1);
  expect(putRequests[0]?.url).toContain('/catalog/ambient-materials/amb-1');
  expect(putRequests[0]?.body.code).toBe('PISO-01');
  expect(putRequests[0]?.body.surface_type).toBe('floor');
  expect(putRequests[0]?.body.preview_color).toBe('#cccccc');
  expect(putRequests[0]?.body.preview_texture_tile_width_mm).toBe(600);
  // #1149: the edit goes out under If-Match — a bare PUT is now a server 428.
  expect(putRequests[0]?.ifMatch).toBe('"v1"');
});

it('saveCatalog edits an existing material category under If-Match (#1149)', async () => {
  const requests: { method: string; url: string; ifMatch?: string }[] = [];
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/catalog/material-categories/')) {
      requests.push({
        method,
        url,
        ifMatch: (init?.headers as Record<string, string> | undefined)?.['If-Match'],
      });
      if (method === 'GET') {
        return {
          ok: true,
          json: async () => ({ id: 'mcat-1', name: 'Maderas', version: 3 }),
        } as Response;
      }
      if (method === 'PUT') {
        return { ok: true, json: async () => ({ id: 'mcat-1', version: 4 }) } as Response;
      }
    }
    return { ok: true, json: async () => [] } as Response;
  });

  const repo = new APIWorkspaceRepository();
  await repo.saveCatalog({
    materials: [],
    edges: [],
    hardware: [],
    optionGroups: [],
    modules: [],
    categories: [],
    customers: [],
    materialCategories: [{ id: 'mcat-1', name: 'Maderas editada', sortOrder: 0 }],
  });

  const put = requests.find(
    (r) => r.method === 'PUT' && r.url.includes('/catalog/material-categories/mcat-1'),
  );
  expect(put, 'PUT material-categories/mcat-1').toBeTruthy();
  expect(put?.ifMatch, 'If-Match from learned version').toBe('"v3"');
});

it('saveCatalog reuses the version seeded by getCatalog for material categories (#1149)', async () => {
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if ((init?.method ?? 'GET') === 'GET' && url.includes('/catalog/material-categories')) {
      return {
        ok: true,
        json: async () => [
          { id: 'mcat-1', name: 'Maderas', parent_id: null, sort_order: 0, version: 7 },
        ],
      } as Response;
    }
    if (init?.method === 'PUT' && url.includes('/catalog/material-categories/mcat-1')) {
      return { ok: true, json: async () => ({ id: 'mcat-1', version: 8 }) } as Response;
    }
    return { ok: true, json: async () => [] } as Response;
  });

  const repo = new APIWorkspaceRepository();
  await repo.getCatalog();
  const seen: { method: string; url: string; ifMatch?: string }[] = [];
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/catalog/material-categories/')) {
      seen.push({
        method,
        url,
        ifMatch: (init?.headers as Record<string, string> | undefined)?.['If-Match'],
      });
      if (method === 'PUT') {
        return { ok: true, json: async () => ({ id: 'mcat-1', version: 8 }) } as Response;
      }
    }
    return { ok: true, json: async () => [] } as Response;
  });

  await repo.saveCatalog({
    materials: [],
    edges: [],
    hardware: [],
    optionGroups: [],
    modules: [],
    categories: [],
    customers: [],
    materialCategories: [{ id: 'mcat-1', name: 'Maderas v2', sortOrder: 0 }],
  });

  const learnGets = seen.filter((r) => r.method === 'GET');
  expect(learnGets, 'no learn GET needed: version was seeded').toHaveLength(0);
  const put = seen.find((r) => r.method === 'PUT');
  expect(put?.ifMatch).toBe('"v7"');
});

it('saveCatalog creates a locally-new material category via POST fallback (#1149)', async () => {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.includes('/catalog/material-categories/mcat-new')) {
      // Locally-created entity: the server does not know it yet.
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }
    if (method === 'POST' && url.endsWith('/catalog/material-categories')) {
      posts.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return { ok: true, json: async () => ({ id: 'mcat-new', version: 1 }) } as Response;
    }
    return { ok: true, json: async () => [] } as Response;
  });

  const repo = new APIWorkspaceRepository();
  await repo.saveCatalog({
    materials: [],
    edges: [],
    hardware: [],
    optionGroups: [],
    modules: [],
    categories: [],
    customers: [],
    materialCategories: [{ id: 'mcat-new', name: 'Nueva categoría', sortOrder: 0 }],
  });

  expect(posts).toHaveLength(1);
  expect(posts[0]?.body.name).toBe('Nueva categoría');
});

  it('saveCatalog PUTs ambientCategories body', async () => {
    const putRequests: { url: string; body: Record<string, unknown> }[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === 'PUT' && url.includes('/catalog/ambient-categories/')) {
        putRequests.push({
          url,
          body: JSON.parse(String(init.body)) as Record<string, unknown>,
        });
        return { ok: true, json: async () => ({}) } as Response;
      }
      if ((init?.method ?? 'GET') === 'GET' && url.includes('/catalog/ambient-categories/')) {
        // #1091: the guarded write learns the server version first.
        return { ok: true, json: async () => ({ id: 'acat-1', version: 1 }) } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository();
    await repo.saveCatalog({
      materials: [],
      edges: [],
      hardware: [],
      optionGroups: [],
      modules: [],
      categories: [],
      customers: [],
      ambientCategories: [
        {
          id: 'acat-1',
          name: 'Maderas',
          sortOrder: 0,
        },
      ],
    });

    expect(putRequests).toHaveLength(1);
    expect(putRequests[0]?.url).toContain('/catalog/ambient-categories/acat-1');
    expect(putRequests[0]?.body.name).toBe('Maderas');
  });

  it('createProject POSTs only (no PUT probe)', async () => {
    const methods: string[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      methods.push(`${init?.method ?? 'GET'} ${String(input)}`);
      return { ok: true, status: 201, json: async () => ({}) } as Response;
    });

    const repo = new APIWorkspaceRepository('http://localhost:8080/api');
    await repo.createProject({
      id: 'new-p',
      name: 'Nuevo',
      customerId: 'c1',
      currency: 'UYU',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      items: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    expect(methods).toEqual(['POST http://localhost:8080/api/projects']);
  });

  it('saveCatalog POSTs material when the learn GET returns 404 not found', async () => {
    const methods: string[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const method = init?.method ?? 'GET';
      methods.push(`${method} ${String(input)}`);
      // #1091: the guarded upsert learns first; a 404 goes straight to POST.
      if (method === 'GET') {
        return {
          ok: false,
          status: 404,
          text: async () => '{"code":"NOT_FOUND","message":"material board not found"}',
        } as Response;
      }
      if (method === 'POST') {
        return { ok: true, status: 201, json: async () => ({}) } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository();
    await repo.saveCatalog({
      materials: [
        {
          id: 'new-id',
          code: 'NEW',
          name: 'Nuevo',
          widthMm: 100,
          lengthMm: 200,
          thicknessMm: 15,
          grainDefault: false,
          boardPrice: 10,
          wastePercent: 0,
          costPerM2: 1,
          active: true,
        },
      ],
      edges: [],
      hardware: [],
      optionGroups: [],
      modules: [],
      categories: [],
      customers: [],
    });

    expect(methods.some((m) => m.startsWith('PUT'))).toBe(false);
    expect(methods.some((m) => m.startsWith('POST'))).toBe(true);
  });

  it('F116 C2: saveCatalog rejects on PUT 409 conflict (code collision surfaces)', async () => {
    const methods: string[] = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const method = init?.method ?? 'GET';
      methods.push(`${method} ${String(input)}`);
      // PUT reports the material already exists → upsert is done.
      if (method === 'PUT') {
        return {
          ok: false,
          status: 409,
          json: async () => ({ code: 'CONFLICT', message: 'El código ingresado ya está registrado', fieldErrors: {}, requestId: 'r', retryable: false, details: {} }),
        } as unknown as Response;
      }
      if (method === 'GET') {
        return { ok: true, json: async () => ({ id: 'dup-id', version: 2 }) } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository();
    // The conflict must reject so the shell can surface an error instead of
    // claiming success over data the server never accepted (F116 C2).
    await expect(
      repo.saveCatalog({
        materials: [
          {
            id: 'dup-id',
            code: 'DUP',
            name: 'Dup',
            widthMm: 100,
            lengthMm: 200,
            thicknessMm: 15,
            grainDefault: false,
            boardPrice: 10,
            wastePercent: 0,
            costPerM2: 1,
            active: true,
          },
        ],
        edges: [],
        hardware: [],
        optionGroups: [],
        modules: [],
        categories: [],
        customers: [],
      }),
    ).rejects.toThrow(/código/i);

    expect(methods.filter((m) => m.startsWith('PUT'))).toHaveLength(1);
    // No POST should follow a conflict. #1091: the typed GraneteApiError
    // rejects directly — the shell surfaces it without a console round-trip.
    expect(methods.some((m) => m.startsWith('POST'))).toBe(false);
  });

  it('F116 C2: saveCatalog rejects on POST 409 conflict (silent data loss fixed)', async () => {
    const methods: string[] = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const method = init?.method ?? 'GET';
      methods.push(`${method} ${String(input)}`);
      // #1091: the guarded upsert learns first; a 404 goes straight to POST,
      // which collides (concurrent create / re-seed) → already exists.
      if (method === 'GET') {
        return {
          ok: false,
          status: 404,
          text: async () => '{"code":"NOT_FOUND","message":"not found"}',
        } as Response;
      }
      if (method === 'POST') {
        return {
          ok: false,
          status: 409,
          text: async () => '{"error":"El registro ya existe"}',
        } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository();
    await expect(
      repo.saveCatalog({
        materials: [],
        edges: [],
        hardware: [],
        optionGroups: [],
        modules: [],
        categories: [],
        customers: [
          { id: 'dup-cust', name: 'Dup', active: true },
        ],
      }),
    ).rejects.toThrow(/create failed/i);

    // #1091: learn-404 goes straight to POST — no PUT probe anymore.
    expect(methods.some((m) => m.startsWith('PUT') && m.includes('/customers/'))).toBe(false);
    expect(methods.some((m) => m.startsWith('POST') && m.includes('/customers'))).toBe(true);
  });

  it('saveCatalog PUTs agregados body', async () => {
    const putBodies: { url: string; body: Record<string, unknown> }[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === 'PUT' && url.includes('/catalog/agregados/')) {
        putBodies.push({
          url,
          body: JSON.parse(String(init.body)) as Record<string, unknown>,
        });
        return { ok: true, json: async () => ({}) } as Response;
      }
      if ((init?.method ?? 'GET') === 'GET' && url.includes('/catalog/agregados/')) {
        // #1096: the guarded write learns the server version first.
        return { ok: true, json: async () => ({ id: 'agr-1', version: 2 }) } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository();
    await repo.saveCatalog({
      materials: [],
      edges: [],
      hardware: [],
      optionGroups: [],
      modules: [],
      categories: [],
      customers: [],
      agregados: [
        {
          id: 'agr-1',
          code: 'AGR-CAJON-3',
          name: 'Cuerpo 3 Cajones',
          components: [],
          active: true,
        },
      ],
    });

    expect(putBodies).toHaveLength(1);
    expect(putBodies[0]!.url).toContain('/catalog/agregados/agr-1');
    expect(putBodies[0]!.body['code']).toBe('AGR-CAJON-3');
    expect(putBodies[0]!.body['name']).toBe('Cuerpo 3 Cajones');
  });

  it('performs floorScan and parses response with loading progress', async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === 'POST' && url.includes('/projects/p1/floor-scan')) {
        const parsed = JSON.parse(String(init.body)) as Record<string, unknown>;
        return {
          ok: true,
          json: async () => ({
            project_id: 'p1',
            project_name: 'Cocina Ana',
            item_id: parsed.item_id ?? 'it-1',
            factory_code: 'GAB-01',
            module_code: 'GAB-01',
            module_name: 'Gabinete Bajo',
            status_before: 'pending',
            status_after: parsed.target_status ?? 'cut',
            next_status: 'edged',
            loading_progress: {
              total_packages: 4,
              packaged_packages: 2,
              loaded_packages: 1,
              installed_packages: 0,
              packaging_percentage: 50,
              loading_percentage: 25,
              all_packaged: false,
              all_loaded: false,
              can_release_to_delivery: false,
            },
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    const repo = new APIWorkspaceRepository();
    const result = await repo.floorScan('p1', {
      itemId: 'it-1',
      targetStatus: 'loaded',
    });

    expect(result.projectId).toBe('p1');
    expect(result.statusAfter).toBe('loaded');
    expect(result.loadingProgress.totalPackages).toBe(4);
    expect(result.loadingProgress.loadedPackages).toBe(1);
    expect(result.loadingProgress.canReleaseToDelivery).toBe(false);
  });

  it('gets loading status for a project', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/projects/p1/loading-status')) {
        return {
          ok: true,
          json: async () => ({
            project_id: 'p1',
            project_name: 'Cocina Ana',
            loading_progress: {
              total_packages: 2,
              packaged_packages: 2,
              loaded_packages: 2,
              installed_packages: 0,
              packaging_percentage: 100,
              loading_percentage: 100,
              all_packaged: true,
              all_loaded: true,
              can_release_to_delivery: true,
            },
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    const repo = new APIWorkspaceRepository();
    const result = await repo.getProjectLoadingStatus('p1');

    expect(result.projectId).toBe('p1');
    expect(result.loadingProgress.allLoaded).toBe(true);
    expect(result.loadingProgress.canReleaseToDelivery).toBe(true);
  });

  it('listPickingStates maps snake_case rows from /api/picking', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/picking')) {
        return {
          ok: true,
          json: async () => [
            {
              project_id: 'p1',
              material: 'herrajes',
              status: 'despachado',
              marked_at: '2026-08-17T10:00:00Z',
              marked_by: 'a1',
              marked_by_name: 'Admin',
            },
            {
              project_id: 'p1',
              material: 'tableros',
              status: 'pendiente',
            },
          ],
        } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository();
    const states = await repo.listPickingStates();

    expect(states).toHaveLength(2);
    expect(states[0]).toEqual({
      projectId: 'p1',
      material: 'herrajes',
      status: 'despachado',
      markedAt: '2026-08-17T10:00:00Z',
      markedBy: 'Admin',
    });
    expect(states[1]?.status).toBe('pendiente');
    expect(states[1]?.markedAt).toBeUndefined();
  });

  it('setProjectPickingState PUTs snake_case body to /api/picking', async () => {
    const putRequests: { url: string; body: Record<string, unknown> }[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (init?.method === 'PUT' && String(input).includes('/picking')) {
        putRequests.push({
          url: String(input),
          body: JSON.parse(String(init.body)) as Record<string, unknown>,
        });
        return { ok: true, json: async () => ({}) } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository('http://localhost:8080/api');
    await repo.setProjectPickingState({
      projectId: 'p1',
      material: 'cintillas',
      status: 'despachado',
    });

    expect(putRequests).toHaveLength(1);
    expect(putRequests[0]?.url).toBe('http://localhost:8080/api/picking');
    expect(putRequests[0]?.body).toEqual({
      project_id: 'p1',
      material: 'cintillas',
      status: 'despachado',
    });
  });

  it('getStock maps snake_case rows with derived shape', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/stock')) {
        return {
          ok: true,
          json: async () => [
            {
              kind: 'herrajes',
              material_id: 'h1',
              quantity: 38,
              min_stock: 50,
              updated_at: '2026-08-17T10:00:00Z',
              status: 'bajo',
            },
          ],
        } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository();
    const stock = await repo.getStock();

    expect(stock).toHaveLength(1);
    expect(stock[0]).toEqual({
      kind: 'herrajes',
      materialId: 'h1',
      quantity: 38,
      minStock: 50,
      updatedAt: '2026-08-17T10:00:00Z',
    });
  });

  it('upsertStockMin PUTs snake_case body to /api/stock', async () => {
    const putRequests: { url: string; body: Record<string, unknown> }[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (init?.method === 'PUT' && String(input).includes('/stock')) {
        putRequests.push({
          url: String(input),
          body: JSON.parse(String(init.body)) as Record<string, unknown>,
        });
        return {
          ok: true,
          json: async () => ({
            kind: 'tableros',
            material_id: 'm1',
            quantity: 14,
            min_stock: 10,
          }),
        } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository('http://localhost:8080/api');
    const result = await repo.upsertStockMin({
      kind: 'tableros',
      materialId: 'm1',
      minStock: 10,
    });

    expect(putRequests).toHaveLength(1);
    expect(putRequests[0]?.url).toBe('http://localhost:8080/api/stock');
    expect(putRequests[0]?.body).toEqual({
      kind: 'tableros',
      material_id: 'm1',
      min_stock: 10,
    });
    expect(result.quantity).toBe(14);
  });

  it('recordStockMovement POSTs despacho and maps balance_after', async () => {
    const postRequests: { url: string; body: Record<string, unknown> }[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (init?.method === 'POST' && String(input).includes('/stock/movements')) {
        postRequests.push({
          url: String(input),
          body: JSON.parse(String(init.body)) as Record<string, unknown>,
        });
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'sm-1',
            kind: 'herrajes',
            material_id: 'h1',
            type: 'despacho',
            delta: -12,
            balance_after: 26,
            project_id: 'p1',
            by_user_id: 'a1',
            by_name: 'Admin',
            at: '2026-08-17T10:00:00Z',
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    const repo = new APIWorkspaceRepository('http://localhost:8080/api');
    const mov = await repo.recordStockMovement({
      kind: 'herrajes',
      materialId: 'h1',
      type: 'despacho',
      quantity: 12,
      projectId: 'p1',
    });

    expect(postRequests).toHaveLength(1);
    expect(postRequests[0]?.url).toBe('http://localhost:8080/api/stock/movements');
    expect(postRequests[0]?.body).toEqual({
      kind: 'herrajes',
      material_id: 'h1',
      type: 'despacho',
      quantity: 12,
      project_id: 'p1',
      note: '',
      reverts_id: '',
    });
    expect(mov.balanceAfter).toBe(26);
    expect(mov.byName).toBe('Admin');
  });

  it('listStockMovements builds the query string', async () => {
    const urls: string[] = [];
    vi.mocked(fetch).mockImplementation(async (input) => {
      urls.push(String(input));
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository('http://localhost:8080/api');
    await repo.listStockMovements({ kind: 'herrajes', limit: 50 });

    expect(urls[0]).toBe('http://localhost:8080/api/stock/movements?kind=herrajes&limit=50');
  });

  it('suppliers map snake_case and hit the right endpoints', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const supplierRow = {
      id: 's1',
      name: 'Maderera Norte',
      contact_name: 'Juan',
      active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      calls.push({ url: String(input), init });
      return {
        ok: true,
        json: async () => (init?.method === 'GET' ? [supplierRow] : supplierRow),
      } as Response;
    });

    const repo = new APIWorkspaceRepository('http://localhost:8080/api');
    const created = await repo.createSupplier({
      id: 's1',
      name: 'Maderera Norte',
      contactName: 'Juan',
    });
    expect(created.contactName).toBe('Juan');
    expect(created.active).toBe(true);
    expect(calls[0]!.url).toBe('http://localhost:8080/api/suppliers');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init?.body))).toMatchObject({
      id: 's1',
      name: 'Maderera Norte',
      contact_name: 'Juan',
      active: true,
    });

    const list = await repo.listSuppliers();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('Maderera Norte');
  });

  it('purchase orders map status/items and lifecycle endpoints', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      calls.push({ url: String(input), init });
      return {
        ok: true,
        json: async () => ({
          id: 'po1',
          number: 'OC-PO1',
          supplier_id: 's1',
          status: 'borrador',
          items: [
            {
              kind: 'herrajes',
              material_id: 'h1',
              quantity: 50,
              received_quantity: 0,
            },
          ],
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        }),
      } as Response;
    });

    const repo = new APIWorkspaceRepository('http://localhost:8080/api');
    const po = await repo.createPurchaseOrder({
      id: 'po1',
      supplierId: 's1',
      items: [{ kind: 'herrajes', materialId: 'h1', quantity: 50 }],
    });
    expect(po.status).toBe('borrador');
    expect(po.items[0]?.materialId).toBe('h1');
    expect(po.items[0]?.receivedQuantity).toBe(0);
    expect(calls[0]!.url).toBe('http://localhost:8080/api/purchase-orders');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init?.body))).toMatchObject({
      id: 'po1',
      supplier_id: 's1',
      items: [{ kind: 'herrajes', material_id: 'h1', quantity: 50 }],
    });

    await repo.emitPurchaseOrder('po1');
    expect(calls[1]!.url).toBe('http://localhost:8080/api/purchase-orders/po1/emit');
    expect(calls[1]!.init?.method).toBe('POST');

    await repo.receivePurchaseOrder('po1', [
      { kind: 'herrajes', materialId: 'h1', quantity: 30 },
    ]);
    expect(calls[2]!.url).toBe('http://localhost:8080/api/purchase-orders/po1/receive');
    expect(JSON.parse(String(calls[2]!.init?.body))).toMatchObject({
      lines: [{ kind: 'herrajes', material_id: 'h1', quantity: 30 }],
    });
  });

  it('maps production active jobs from snake_case API to camelCase', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        jobs: [
          {
            activity_id: 'act-1',
            project_id: 'p1',
            project_name: 'Cocina Nellly',
            sector: 'cutting',
            item_id: '',
            module_code: '',
            operator_id: 'u1',
            operator_name: 'Ramón',
            machine_id: 'm1',
            machine_name: 'Sierra 1',
            started_at: '2026-08-18T14:32:00Z',
            duration_min: 15.5,
          },
        ],
      }),
    } as Response);

    const repo = new APIWorkspaceRepository();
    const jobs = await repo.getProductionActiveJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      activityId: 'act-1',
      projectId: 'p1',
      projectName: 'Cocina Nellly',
      sector: 'cutting',
      operatorId: 'u1',
      operatorName: 'Ramón',
      machineId: 'm1',
      machineName: 'Sierra 1',
      startedAt: '2026-08-18T14:32:00Z',
      durationMin: 15.5,
    });
    // Empty string item_id should be mapped to undefined
    expect(jobs[0]!.itemId).toBeUndefined();
  });

  it('maps production active jobs with project-level claim (no item_id)', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        jobs: [
          {
            activity_id: 'act-2',
            project_id: 'p2',
            project_name: 'Placard Martínez',
            sector: 'edge_banding',
            item_id: '',
            module_code: '',
            operator_id: 'u2',
            operator_name: 'Ana',
            started_at: '2026-08-18T15:00:00Z',
            duration_min: 5,
          },
        ],
      }),
    } as Response);

    const repo = new APIWorkspaceRepository();
    const jobs = await repo.getProductionActiveJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.projectId).toBe('p2');
    expect(jobs[0]!.sector).toBe('edge_banding');
    expect(jobs[0]!.operatorName).toBe('Ana');
  });

  it('maps production dashboard metrics from snake_case API to camelCase', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        metrics: {
          total_projects: 3,
          total_items: 12,
          total_installed: 2,
          avg_progress: 65.5,
          today_completed: 4,
          today_damages: 1,
          sectors: [
            {
              sector: 'cutting',
              label: 'Corte',
              active_operators: 2,
              queue_length: 5,
              items_in_progress: 3,
              items_completed_today: 2,
              avg_time_minutes: 15.5,
              active_jobs: [
                {
                  activity_id: 'act-1',
                  project_id: 'p1',
                  project_name: 'Cocina López',
                  sector: 'cutting',
                  item_id: '',
                  module_code: '',
                  operator_id: 'u1',
                  operator_name: 'Ramón',
                  started_at: '2026-08-18T14:32:00Z',
                  duration_min: 15.5,
                },
              ],
            },
            {
              sector: 'edge_banding',
              label: 'Encintado',
              active_operators: 1,
              queue_length: 3,
              items_in_progress: 1,
              items_completed_today: 1,
              avg_time_minutes: 8.0,
              active_jobs: [],
            },
          ],
        },
      }),
    } as Response);

    const repo = new APIWorkspaceRepository();
    const metrics = await repo.getProductionDashboard();

    // Top-level fields mapped
    expect(metrics.totalProjects).toBe(3);
    expect(metrics.totalItems).toBe(12);
    expect(metrics.totalInstalled).toBe(2);
    expect(metrics.avgProgress).toBe(65.5);
    expect(metrics.todayCompleted).toBe(4);
    expect(metrics.todayDamages).toBe(1);

    // Sectors mapped
    expect(metrics.sectors).toHaveLength(2);
    expect(metrics.sectors[0]).toMatchObject({
      sector: 'cutting',
      label: 'Corte',
      activeOperators: 2,
      queueLength: 5,
      itemsInProgress: 3,
      itemsCompletedToday: 2,
      avgTimeMinutes: 15.5,
    });

    // Nested activeJobs mapped
    expect(metrics.sectors[0]!.activeJobs).toHaveLength(1);
    expect(metrics.sectors[0]!.activeJobs[0]).toMatchObject({
      activityId: 'act-1',
      projectId: 'p1',
      projectName: 'Cocina López',
      sector: 'cutting',
      operatorName: 'Ramón',
    });
    expect(metrics.sectors[0]!.activeJobs[0]!.itemId).toBeUndefined();

    // Empty activeJobs sector
    expect(metrics.sectors[1]!.activeJobs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// #460 SEC-4B — auth por dependencia de memoria, nunca storage
// ---------------------------------------------------------------------------

describe('APIWorkspaceRepository auth dependency (SEC-4B)', () => {
  function memoryStorage(seed: Record<string, string> = {}): Storage {
    const map = new Map<string, string>(Object.entries(seed));
    return {
      get length() {
        return map.size;
      },
      key: (index: number) => [...map.keys()][index] ?? null,
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
      clear: () => map.clear(),
    } as Storage;
  }

  function catalogOk(input?: Parameters<typeof fetch>[0]): Response {
    const url = String(input);
    const body = url.endsWith('/catalog/modules') || url.endsWith('/catalog/hardware')
      ? []
      : { materials: [], edges: [], hardware: [], optionGroups: [], categories: [], customers: [], modules: [], structures: [], components: [] };
    return { ok: true, json: async () => body } as Response;
  }

  it('usa el token de memoria (getAccessToken) y NUNCA un granete_token de localStorage', async () => {
    const storage = memoryStorage({ granete_token: 'FAKE-STORAGE-TOKEN' });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => catalogOk(input));
    try {
      const repo = new APIWorkspaceRepository('http://test/api', {
        getAccessToken: () => 'memory-token',
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      await repo.getCatalog();

      const headers = new Headers(
        (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers,
      );
      expect(headers.get('Authorization')).toBe('Bearer memory-token');
    } finally {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  it('sin token en memoria no envía Authorization alguna', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => catalogOk(input));
    const repo = new APIWorkspaceRepository('http://test/api', {
      getAccessToken: () => null,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await repo.getCatalog();

    const headers = new Headers(
      (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers,
    );
    expect(headers.get('Authorization')).toBeNull();
  });

  it('uploadProjectPhoto usa la misma dependencia de memoria (multipart sin storage)', async () => {
    const storage = memoryStorage({ granete_token: 'FAKE-STORAGE-TOKEN' });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ id: 'photo-1', url: '/api/media/x.png', stage: 'before' }),
    } as Response));
    try {
      const repo = new APIWorkspaceRepository('http://test/api', {
        getAccessToken: () => 'memory-token',
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      await repo.uploadProjectPhoto('p1', new Blob(['x']));

      const headers = new Headers(
        (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers,
      );
      expect(headers.get('Authorization')).toBe('Bearer memory-token');
    } finally {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  // --- #712: atomic inline-customer create ---
  describe('createProjectWithInlineCustomer', () => {
    const draftProject = {
      id: 'p-712',
      name: 'Cocina Ana',
      customerId: 'must-be-ignored',
      currency: 'MXN',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft' as const,
      items: [],
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T00:00:00.000Z',
    };

    const serverPair = {
      id: 'p-712',
      name: 'Cocina Ana',
      customer_id: 'c-srv-1',
      currency: 'MXN',
      margin_factor: 1.35,
      labor_fixed_cost: 0,
      status: 'draft',
      items: [],
      created_at: '2026-09-13T00:00:01.000Z',
      updated_at: '2026-09-13T00:00:01.000Z',
      inline_customer: {
        id: 'c-srv-1',
        name: 'Ana López',
        email: '',
        phone: '',
        address: '',
        notes: '',
        active: true,
        owner_user_id: '',
      },
    };

    it('sends inline_customer_name with an empty customer_id and returns the server pair', async () => {
      const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => ({
        ok: true,
        json: async () => serverPair,
      } as Response));
      const repo = new APIWorkspaceRepository('http://test/api', {
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      const created = await repo.createProjectWithInlineCustomer!(
        draftProject,
        'Ana López',
      );

      expect(created.project.customerId).toBe('c-srv-1');
      expect(created.customer).toMatchObject({ id: 'c-srv-1', name: 'Ana López', active: true });

      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('http://test/api/projects');
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      // The UI never fabricates a customer id: the payload forces the field
      // empty so the server's minted identity is the only one in play.
      expect(body.customer_id).toBe('');
      expect(body.inline_customer_name).toBe('Ana López');
      expect(body.id).toBe('p-712');
    });

    it('reconciles from the server truth on a 409 replay instead of duplicating', async () => {
      const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
        const url = String(input);
        if (url === 'http://test/api/projects' ) {
          return {
            ok: false,
            status: 409,
            json: async () => ({}),
            text: async () => 'El registro ya existe',
          } as Response;
        }
        if (url === 'http://test/api/projects/p-712') {
          return {
            ok: true,
            json: async () => ({ ...serverPair, inline_customer: undefined }),
          } as Response;
        }
        if (url === 'http://test/api/customers/c-srv-1') {
          return {
            ok: true,
            json: async () => serverPair.inline_customer,
          } as Response;
        }
        throw new Error('unexpected fetch ' + url);
      });
      const repo = new APIWorkspaceRepository('http://test/api', {
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      const created = await repo.createProjectWithInlineCustomer!(
        draftProject,
        'Ana López',
      );

      expect(created.project.customerId).toBe('c-srv-1');
      expect(created.customer.id).toBe('c-srv-1');
      // Exactly one POST — the replay read the pair back, never re-created it.
      const posts = fetchMock.mock.calls.filter(
        (c) => (c[1] as RequestInit | undefined)?.method === 'POST',
      );
      expect(posts).toHaveLength(1);
    });

    it('fails honestly on a non-conflict server error', async () => {
      const fetchMock = vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => 'boom',
      } as Response));
      const repo = new APIWorkspaceRepository('http://test/api', {
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      await expect(
        repo.createProjectWithInlineCustomer!(draftProject, 'Ana López'),
      ).rejects.toThrow('Failed to create project: 500');
    });
  });

  describe('updateProjectWithInlineCustomer (#714)', () => {
    const draftProject = {
      id: 'p-714',
      name: 'Cocina editada',
      customerId: 'client-id-must-not-travel',
      currency: 'MXN',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft' as const,
      items: [],
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T00:00:00.000Z',
    };

    const serverPair = {
      id: 'p-714',
      name: 'Nombre autoritativo',
      customer_id: 'c-srv-714',
      currency: 'MXN',
      margin_factor: 1.35,
      labor_fixed_cost: 0,
      status: 'draft',
      items: [],
      created_at: '2026-09-13T00:00:00.000Z',
      updated_at: '2026-09-13T00:00:02.000Z',
      inline_customer: {
        id: 'c-srv-714',
        name: 'Ana López',
        active: true,
      },
    };

    it('sends the exact idempotent inline command and returns the authoritative pair', async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => serverPair,
      } as Response));
      const repo = new APIWorkspaceRepository('http://test/api', {
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      const result = await repo.updateProjectWithInlineCustomer!(
        draftProject,
        'Ana López',
        {
          replacesCustomerId: 'c-base',
          expectedProjectUpdatedAt: '2026-09-13T00:00:00.000Z',
          idempotencyKey: 'web:714-retry-key',
        },
      );

      expect(result.project).toMatchObject({
        id: 'p-714',
        name: 'Nombre autoritativo',
        customerId: 'c-srv-714',
        updatedAt: '2026-09-13T00:00:02.000Z',
      });
      expect(result.customer).toMatchObject({
        id: 'c-srv-714',
        name: 'Ana López',
        active: true,
      });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('http://test/api/projects/p-714');
      expect(init.method).toBe('PUT');
      expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(
        'web:714-retry-key',
      );
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body.customer_id).toBe('');
      expect(body.inline_customer_name).toBe('Ana López');
      expect(body.inline_customer_replaces).toBe('c-base');
      expect(body.expected_project_updated_at).toBe(
        '2026-09-13T00:00:00.000Z',
      );
    });

    it('rejects a malformed success without the persisted customer identity', async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ ...serverPair, inline_customer: undefined }),
      } as Response));
      const repo = new APIWorkspaceRepository('http://test/api', {
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      await expect(
        repo.updateProjectWithInlineCustomer!(draftProject, 'Ana López', {
          replacesCustomerId: 'c-base',
          expectedProjectUpdatedAt: '2026-09-13T00:00:00.000Z',
          idempotencyKey: 'web:714-retry-key',
        }),
      ).rejects.toThrow('Server did not return the inline customer identity');
    });

    it('exposes a typed 409 so callers can require an authoritative refresh', async () => {
      const fetchMock = vi.fn(async () => ({
        ok: false,
        status: 409,
        text: async () => '{"error":"project changed concurrently"}',
      } as Response));
      const repo = new APIWorkspaceRepository('http://test/api', {
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      const request = repo.updateProjectWithInlineCustomer!(draftProject, 'Ana López', {
        replacesCustomerId: 'c-base',
        expectedProjectUpdatedAt: '2026-09-13T00:00:00.000Z',
        idempotencyKey: 'web:714-conflict-key',
      });

      await expect(request).rejects.toMatchObject({
        name: 'ProjectInlineUpdateHttpError',
        status: 409,
      } satisfies Partial<ProjectInlineUpdateHttpError>);
    });
  });
});

// ---------------------------------------------------------------------------
// #497 T2 — module optimistic concurrency on the repository boundary
// ---------------------------------------------------------------------------

describe('APIWorkspaceRepository — module optimistic concurrency (#497)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  function jsonRes(body: unknown, ok = true, status = 200): Response {
    return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
  }

  const modulePayload = {
    id: 'mod-497',
    code: 'M-497',
    name: 'Gabinete',
    base_labor_cost: 0,
    width_mm: 0,
    height_mm: 0,
    depth_mm: 0,
    categoryId: '',
    structure_id: '',
    components: [],
    agregados: [],
    presets: [],
    image_url: '',
    notes: '',
    hardware_lines: [],
    parameter_definitions: [],
    version: 4,
  };

  /** Routes a full getCatalog: real module list, empty everything else. */
  function mockCatalog(modules: unknown[]): (url: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response> {
    return async (url, init) => {
      const method = init?.method ?? 'GET';
      const target = String(url);
      if (method === 'GET') {
        if (target.endsWith('/catalog/modules')) return jsonRes(modules);
        return jsonRes([]);
      }
      throw new Error(`unexpected ${method} ${target}`);
    };
  }

  it('PUTs with If-Match from the cached version and refreshes it from each response', async () => {
    const ifMatchSeen: Array<string | undefined> = [];
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if ((init?.method ?? 'GET') === 'GET') return mockCatalog([modulePayload])(url, init);
      ifMatchSeen.push(new Headers(init?.headers).get('If-Match') ?? undefined);
      return jsonRes({ ...modulePayload, version: (ifMatchSeen.length) + 4 });
    });

    const repo = new APIWorkspaceRepository();
    const catalog = await repo.getCatalog();
    expect(catalog.modules[0]?.version).toBe(4);

    await repo.saveCatalog({
      ...(catalog as unknown as Catalog),
      modules: [{ ...catalog.modules[0]!, name: 'Editado' }],
    });
    expect(ifMatchSeen).toEqual(['"v4"']);

    // The accepted PUT refreshed the cache to 5: the next save sends v5.
    await repo.saveCatalog({
      ...(catalog as unknown as Catalog),
      modules: [{ ...catalog.modules[0]!, name: 'Editado 2' }],
    });
    expect(ifMatchSeen).toEqual(['"v4"', '"v5"']);
  });

  it('surfaces a 412 as GraneteApiError with code VERSION_CONFLICT', async () => {
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if ((init?.method ?? 'GET') === 'GET') return mockCatalog([modulePayload])(url, init);
      return {
        ok: false,
        status: 412,
        json: async () => ({
          code: 'VERSION_CONFLICT',
          message: 'El mueble cambió en otra sesión.',
          fieldErrors: {},
          requestId: 'req-1',
          retryable: false,
          details: {},
        }),
        text: async () => JSON.stringify({
          code: 'VERSION_CONFLICT',
          message: 'El mueble cambió en otra sesión.',
          fieldErrors: {},
          requestId: 'req-1',
          retryable: false,
          details: {},
        }),
      } as Response;
    });

    const repo = new APIWorkspaceRepository();
    const catalog = await repo.getCatalog();

    await expect(
      repo.saveCatalog({
        ...(catalog as unknown as Catalog),
        modules: [{ ...catalog.modules[0]!, name: 'Viejo' }],
      }),
    ).rejects.toMatchObject({ name: 'GraneteApiError', code: 'VERSION_CONFLICT', status: 412 });
  });

  it('learns the version with GET-by-id and sends the PUT under If-Match', async () => {
    const putIfMatch: Array<string | undefined> = [];
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const method = init?.method ?? 'GET';
      const target = String(url);
      if (method === 'GET') {
        if (target.endsWith('/catalog/modules/mod-497')) {
          return jsonRes({ ...modulePayload, version: 9 });
        }
        return mockCatalog([JSON.parse(JSON.stringify({ ...modulePayload, version: undefined }))])(url, init);
      }
      if (method === 'PUT') {
        console.log('DEBUG-PUT-HEADERS', init?.headers instanceof Headers ? [...(init?.headers as Headers).entries()] : init?.headers);
        putIfMatch.push(new Headers(init?.headers).get('If-Match') ?? undefined);
        return jsonRes({ ...modulePayload, version: 10 });
      }
      return jsonRes({ ...modulePayload });
    });

    const repo = new APIWorkspaceRepository();
    const catalog = await repo.getCatalog();
    expect(catalog.modules[0]?.version).toBeUndefined();

    await repo.saveCatalog({
      ...(catalog as unknown as Catalog),
      modules: [{ ...catalog.modules[0]!, name: 'X' }],
    });
    expect(putIfMatch).toEqual(['"v9"']);
  });

  it('fails closed when the learned module carries no version, without writing', async () => {
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const method = init?.method ?? 'GET';
      const target = String(url);
      if (method === 'GET') {
        if (target.endsWith('/catalog/modules/mod-497')) {
          return jsonRes(JSON.parse(JSON.stringify({ ...modulePayload, version: undefined })));
        }
        return mockCatalog([JSON.parse(JSON.stringify({ ...modulePayload, version: undefined }))])(url, init);
      }
      return jsonRes({ ...modulePayload });
    });

    const repo = new APIWorkspaceRepository();
    const catalog = await repo.getCatalog();

    await expect(
      repo.saveCatalog({
        ...(catalog as unknown as Catalog),
        modules: [{ ...catalog.modules[0]!, name: 'X' }],
      }),
    ).rejects.toMatchObject({ name: 'ModuleVersionUnknownError' });
    // No write may leave the client: not a PUT, and not a blind POST create.
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => {
      const method = (init as RequestInit | undefined)?.method;
      return method === 'PUT' || method === 'POST';
    })).toHaveLength(0);
  });

  it('creates through POST when the learned module is missing (locally-new)', async () => {
    const calls: Array<{ method?: string; url: string }> = [];
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const method = init?.method ?? 'GET';
      const target = String(url);
      if (method === 'GET') {
        if (target.endsWith('/catalog/modules/mod-497')) {
          return { ok: false, status: 404, json: async () => ({ code: 'NOT_FOUND', message: 'module not found', fieldErrors: {}, requestId: 'r', retryable: false, details: {} }), text: async () => 'not found' } as Response;
        }
        return mockCatalog([JSON.parse(JSON.stringify({ ...modulePayload, version: undefined }))])(url, init);
      }
      calls.push({ method, url: target });
      return jsonRes({ ...modulePayload, version: 1 });
    });

    const repo = new APIWorkspaceRepository();
    const catalog = await repo.getCatalog();

    await repo.saveCatalog({
      ...(catalog as unknown as Catalog),
      modules: [{ ...catalog.modules[0]!, name: 'Nuevo' }],
    });
    expect(calls.map((c) => c.method)).toEqual(['POST']);
  });
});

describe('APIWorkspaceRepository hardware optimistic concurrency (#1084 / #443 slice 1)', () => {
  const hwWire = (version: number) => ({
    id: 'hw-1',
    code: 'BIS-1',
    name: 'Bisagra',
    unit: 'piece',
    cost_per_unit: 10,
    active: true,
    version,
  });
  const hwDomain = (id = 'hw-1'): Hardware =>
    ({
      id,
      code: 'BIS-1',
      name: 'Bisagra',
      unit: 'piece',
      costPerUnit: 10,
      active: true,
    }) as unknown as Hardware;

  const saveCatalogWith = async (repo: APIWorkspaceRepository, hardware: Hardware[]) => {
    await repo.saveCatalog({
      materials: [],
      edges: [],
      hardware,
      optionGroups: [],
      modules: [],
      categories: [],
      customers: [],
    });
  };

  it('saveCatalog aprende la versión (GET) y envía If-Match en el PUT', async () => {
    const ifMatchSeen: (string | null)[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const headers = new Headers(init?.headers);
      if (method === 'GET' && url.includes('/catalog/hardware/hw-1')) {
        return { ok: true, json: async () => hwWire(3) } as Response;
      }
      if (method === 'PUT' && url.includes('/catalog/hardware/hw-1')) {
        ifMatchSeen.push(headers.get('If-Match'));
        return { ok: true, json: async () => hwWire(4) } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository();
    await saveCatalogWith(repo, [hwDomain()]);
    expect(ifMatchSeen).toEqual(['"v3"']);
  });

  it('el segundo guardado usa la versión aprendida de la respuesta (sin re-GET)', async () => {
    let learnGets = 0;
    const ifMatchSeen: (string | null)[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const headers = new Headers(init?.headers);
      if (method === 'GET' && url.includes('/catalog/hardware/hw-1')) {
        learnGets += 1;
        return { ok: true, json: async () => hwWire(3) } as Response;
      }
      if (method === 'PUT' && url.includes('/catalog/hardware/hw-1')) {
        ifMatchSeen.push(headers.get('If-Match'));
        return { ok: true, json: async () => hwWire(Number(headers.get('If-Match')!.slice(2, -1)) + 1) } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository();
    await saveCatalogWith(repo, [hwDomain()]);
    // #1168: a byte-identical re-save is a no-op — no re-learn, no re-PUT.
    await saveCatalogWith(repo, [hwDomain()]);
    expect(learnGets).toBe(1);
    expect(ifMatchSeen).toEqual(['"v3"']);
    // A real change goes out under the version remembered from the write-back.
    await saveCatalogWith(repo, [{ ...hwDomain(), name: 'Bisagra editada' }]);
    expect(learnGets).toBe(1);
    expect(ifMatchSeen).toEqual(['"v3"', '"v4"']);
  });

  it('saveCatalog crea por POST sin If-Match cuando el herraje no existe (404 al aprender)', async () => {
    const methods: { method: string; ifMatch: string | null }[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const headers = new Headers(init?.headers);
      if (method === 'GET' && url.includes('/catalog/hardware/hw-1')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ code: 'NOT_FOUND', message: 'hardware not found', fieldErrors: {}, requestId: 'r', retryable: false, details: {} }),
        } as unknown as Response;
      }
      if (method === 'POST' && url.endsWith('/catalog/hardware')) {
        methods.push({ method, ifMatch: headers.get('If-Match') });
        return { ok: true, json: async () => hwWire(1) } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository();
    await saveCatalogWith(repo, [hwDomain()]);
    expect(methods).toEqual([{ method: 'POST', ifMatch: null }]);
  });

  it('un PUT 412 VERSION_CONFLICT rechaza saveCatalog con el error tipado del contrato', async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/catalog/hardware/hw-1')) {
        return { ok: true, json: async () => hwWire(3) } as Response;
      }
      if (method === 'PUT' && url.includes('/catalog/hardware/hw-1')) {
        return {
          ok: false,
          status: 412,
          json: async () => ({ code: 'VERSION_CONFLICT', message: 'la versión del herraje cambió; recargá y reintentá', fieldErrors: {}, requestId: 'r', retryable: false, details: {} }),
        } as unknown as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository();
    await expect(saveCatalogWith(repo, [hwDomain()])).rejects.toMatchObject({
      status: 412,
      code: 'VERSION_CONFLICT',
    });
  });

  it('getCatalog siembra la caché de versiones (save posterior no re-aprende)', async () => {
    let learnGets = 0;
    const ifMatchSeen: (string | null)[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const headers = new Headers(init?.headers);
      if (method === 'GET' && url.endsWith('/catalog/hardware')) {
        return { ok: true, json: async () => [hwWire(5)] } as Response;
      }
      if (method === 'GET' && url.includes('/catalog/hardware/hw-1')) {
        learnGets += 1;
        return { ok: true, json: async () => hwWire(5) } as Response;
      }
      if (method === 'PUT' && url.includes('/catalog/hardware/hw-1')) {
        ifMatchSeen.push(headers.get('If-Match'));
        return { ok: true, json: async () => hwWire(6) } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository();
    const ws = await repo.load();
    expect(ws.catalog.hardware).toHaveLength(1);
    // #1168: getCatalog also seeds the skip-unchanged baseline, so a save
    // identical to the loaded state is a no-op instead of a rewrite.
    await saveCatalogWith(repo, [hwDomain()]);
    expect(learnGets).toBe(0);
    expect(ifMatchSeen).toEqual([]);
    // A real change goes out under the version seeded by getCatalog.
    await saveCatalogWith(repo, [{ ...hwDomain(), name: 'Bisagra editada' }]);
    expect(learnGets).toBe(0);
    expect(ifMatchSeen).toEqual(['"v5"']);
  });
});

describe('APIWorkspaceRepository simple families concurrency (#1091 / #443 slice 2)', () => {
  const wire = (id: string, version: number) => ({
    id,
    code: 'X1',
    name: 'Entidad S2',
    width_mm: 100,
    length_mm: 200,
    thickness_mm: 15,
    cost_per_m2: 1,
    board_price: 1,
    waste_percent: 0,
    grain_default: false,
    active: true,
    version,
  });
  const matDomain = (id = 'mat-1'): MaterialBoard =>
    ({
      id,
      code: 'X1',
      name: 'Entidad S2',
      widthMm: 100,
      lengthMm: 200,
      thicknessMm: 15,
      grainDefault: false,
      boardPrice: 1,
      wastePercent: 0,
      costPerM2: 1,
      active: true,
    }) as unknown as MaterialBoard;

  const saveCatalogWith = async (repo: APIWorkspaceRepository, materials: MaterialBoard[]) => {
    await repo.saveCatalog({
      materials,
      edges: [],
      hardware: [],
      optionGroups: [],
      modules: [],
      categories: [],
      customers: [],
    });
  };

  it('materials: siembra la caché en load y manda If-Match sin re-aprender', async () => {
    let learnGets = 0;
    const ifMatchSeen: (string | null)[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const headers = new Headers(init?.headers);
      if (method === 'GET' && url.endsWith('/catalog/materials')) {
        return { ok: true, json: async () => [wire('mat-1', 5)] } as Response;
      }
      if (method === 'GET' && url.includes('/catalog/materials/mat-1')) {
        learnGets += 1;
        return { ok: true, json: async () => wire('mat-1', 5) } as Response;
      }
      if (method === 'PUT' && url.includes('/catalog/materials/mat-1')) {
        ifMatchSeen.push(headers.get('If-Match'));
        return { ok: true, json: async () => wire('mat-1', 6) } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository();
    const ws = await repo.load();
    expect(ws.catalog.materials).toHaveLength(1);
    // #1168: a save identical to the loaded state is a no-op (seeded baseline).
    await saveCatalogWith(repo, [matDomain()]);
    expect(learnGets).toBe(0);
    expect(ifMatchSeen).toEqual([]);
    // A real change goes out guarded with the version seeded by the load.
    await saveCatalogWith(repo, [{ ...matDomain(), name: 'Entidad S2 editada' }]);
    expect(learnGets).toBe(0);
    expect(ifMatchSeen).toEqual(['"v5"']);
  });

  it('materials: sin caché aprende por GET y el write-back refresca la versión', async () => {
    let learnGets = 0;
    const ifMatchSeen: (string | null)[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const headers = new Headers(init?.headers);
      if (method === 'GET' && url.includes('/catalog/materials/mat-1')) {
        learnGets += 1;
        return { ok: true, json: async () => wire('mat-1', 3) } as Response;
      }
      if (method === 'PUT' && url.includes('/catalog/materials/mat-1')) {
        ifMatchSeen.push(headers.get('If-Match'));
        return { ok: true, json: async () => wire('mat-1', Number(headers.get('If-Match')!.slice(2, -1)) + 1) } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository();
    await saveCatalogWith(repo, [matDomain()]);
    // #1168: a byte-identical re-save is a no-op — no re-learn, no re-PUT.
    // Rewriting every entity on each save is what turned one mapping loss
    // into catalog-wide data damage.
    await saveCatalogWith(repo, [matDomain()]);
    expect(learnGets).toBe(1);
    expect(ifMatchSeen).toEqual(['"v3"']);

    // A real change goes out guarded with the remembered version.
    await saveCatalogWith(repo, [{ ...matDomain(), name: 'Entidad S2 editada' }]);
    expect(ifMatchSeen).toEqual(['"v3"', '"v4"']);
  });

  it('#1168: sesión fresca — guardar un agregado editado emite exactamente un PUT de esa entidad, no N', async () => {
    const wireAgregado = (id: string, code: string, name: string, version: number) => ({
      id,
      code,
      name,
      active: true,
      components: [],
      hardware_lines: [],
      version,
    });
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/catalog/agregados')) {
        return {
          ok: true,
          json: async () => [
            wireAgregado('agr-1', 'AGR-1', 'A uno', 3),
            wireAgregado('agr-2', 'AGR-2', 'A dos', 5),
          ],
        } as Response;
      }
      if (method === 'PUT' && url.includes('/catalog/agregados/agr-1')) {
        return { ok: true, json: async () => ({ id: 'agr-1', version: 4 }) } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository();
    const catalog = await repo.getCatalog();

    // Fase de guardado: contar toda escritura no-GET.
    const writes: { method: string; url: string }[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method !== 'GET') writes.push({ method, url });
      if (method === 'PUT' && url.includes('/catalog/agregados/agr-1')) {
        return { ok: true, json: async () => ({ id: 'agr-1', version: 4 }) } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const edited: Catalog = {
      ...catalog,
      agregados: (catalog.agregados ?? []).map((a) =>
        a.id === 'agr-1' ? { ...a, name: 'A uno editado' } : a,
      ),
    };
    await repo.saveCatalog(edited);

    // El re-save masivo terminaba en N PUTs (116 escrituras medidas en el
    // browser real: materiales, cantos, herrajes, componentes, clientes…).
    // Con el baseline sembrado por getCatalog, sólo la entidad editada
    // difiere de lo cargado → exactamente un PUT.
    expect(writes).toHaveLength(1);
    expect(writes[0]?.method).toBe('PUT');
    expect(writes[0]?.url).toContain('/catalog/agregados/agr-1');

    // Re-guardar lo mismo (sin recargar) sigue siendo 0 escrituras.
    writes.length = 0;
    await repo.saveCatalog(edited);
    expect(writes).toHaveLength(0);
  });

  it('materials: un PUT 412 VERSION_CONFLICT rechaza saveCatalog con el error tipado', async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/catalog/materials/mat-1')) {
        return { ok: true, json: async () => wire('mat-1', 3) } as Response;
      }
      if (method === 'PUT' && url.includes('/catalog/materials/mat-1')) {
        return {
          ok: false,
          status: 412,
          json: async () => ({ code: 'VERSION_CONFLICT', message: 'la versión cambió; recargá y reintentá', fieldErrors: {}, requestId: 'r', retryable: false, details: {} }),
        } as unknown as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository();
    await expect(saveCatalogWith(repo, [matDomain()])).rejects.toMatchObject({
      status: 412,
      code: 'VERSION_CONFLICT',
    });
  });

  it('materials: 404 al aprender mantiene el fallback POST-create sin If-Match', async () => {
    const methods: { method: string; ifMatch: string | null }[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const headers = new Headers(init?.headers);
      if (method === 'GET' && url.includes('/catalog/materials/mat-9')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ code: 'NOT_FOUND', message: 'material board not found', fieldErrors: {}, requestId: 'r', retryable: false, details: {} }),
        } as unknown as Response;
      }
      if (method === 'POST' && url.endsWith('/catalog/materials')) {
        methods.push({ method, ifMatch: headers.get('If-Match') });
        return { ok: true, json: async () => wire('mat-9', 1) } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository();
    await saveCatalogWith(repo, [matDomain('mat-9')]);
    expect(methods).toEqual([{ method: 'POST', ifMatch: null }]);
  });
});
