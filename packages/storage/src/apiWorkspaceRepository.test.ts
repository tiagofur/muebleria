import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APIWorkspaceRepository } from './apiWorkspaceRepository';

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
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => null,
    } as Response);

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

  it('saveCatalog PUTs snake_case ambientMaterials body', async () => {
    const putRequests: { url: string; body: Record<string, unknown> }[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === 'PUT' && url.includes('/catalog/ambient-materials/')) {
        putRequests.push({
          url,
          body: JSON.parse(String(init.body)) as Record<string, unknown>,
        });
        return { ok: true, json: async () => ({}) } as Response;
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

  it('saveCatalog POSTs material when PUT returns 404 not found', async () => {
    const methods: string[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const method = init?.method ?? 'GET';
      methods.push(`${method} ${String(input)}`);
      if (method === 'PUT') {
        return {
          ok: false,
          status: 404,
          text: async () => '{"error":"material board not found"}',
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

    expect(methods.some((m) => m.startsWith('PUT'))).toBe(true);
    expect(methods.some((m) => m.startsWith('POST'))).toBe(true);
  });

  it('saveCatalog treats PUT 409 conflict as already exists (no POST, no error)', async () => {
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
          text: async () => '{"error":"El código ingresado ya está registrado"}',
        } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const repo = new APIWorkspaceRepository();
    await repo.saveCatalog({
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
    });

    expect(methods.filter((m) => m.startsWith('PUT'))).toHaveLength(1);
    // No POST should follow a conflict: the entity already exists.
    expect(methods.some((m) => m.startsWith('POST'))).toBe(false);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('saveCatalog treats POST 409 conflict as already exists (no error logged)', async () => {
    const methods: string[] = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const method = init?.method ?? 'GET';
      methods.push(`${method} ${String(input)}`);
      if (method === 'PUT') {
        return {
          ok: false,
          status: 404,
          text: async () => '{"error":"not found"}',
        } as Response;
      }
      // POST collides (concurrent create / re-seed) → already exists.
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
    await repo.saveCatalog({
      materials: [],
      edges: [],
      hardware: [],
      optionGroups: [],
      modules: [],
      categories: [],
      customers: [
        { id: 'dup-cust', name: 'Dup', active: true },
      ],
    });

    expect(methods.some((m) => m.startsWith('PUT') && m.includes('/customers/'))).toBe(true);
    expect(methods.some((m) => m.startsWith('POST') && m.includes('/customers'))).toBe(true);
    // Conflict is not an error: console stays clean.
    expect(errSpy).not.toHaveBeenCalled();
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
