import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APIWorkspaceRepository } from './apiWorkspaceRepository';

describe('APIWorkspaceRepository', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
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
});
