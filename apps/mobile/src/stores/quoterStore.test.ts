import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useQuoterStore,
  uuidV4Fallback,
  __resetQuoterIntentionHydration,
} from './quoterStore';
import { useCatalogStore } from './catalogStore';
import {
  setQuoterIntentionStorage,
} from '../services/quoterIntentionStorage';
import { DomainError, seedCatalogExpandedLatAm } from '@granete/domain';

const postMock = vi.fn();
const getMock = vi.fn();
vi.mock('../services/apiClient', () => ({
  apiClient: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('quoterStore Mobile (Fase 3)', () => {
  beforeEach(() => {
    useQuoterStore.setState({
      items: [],
      customerName: 'Cliente Particular',
      projectTitle: 'Presupuesto de Mobiliario',
      commercialMarginPercent: 35,
      pendingSaveIntention: null,
    });
  });

  it('agrega módulos al cotizador y calcula costos con @granete/domain', () => {
    const store = useQuoterStore.getState();
    const mod = seedCatalogExpandedLatAm.modules[0];

    store.addModuleToCart(mod);

    const state = useQuoterStore.getState();
    expect(state.items.length).toBe(1);
    expect(state.items[0].moduleId).toBe(mod.id);
    expect(state.items[0].unitPrice).toBeGreaterThan(0);
    expect(state.items[0].totalPrice).toBe(state.items[0].unitPrice);
    expect(state.items[0].m2Boards).toBeGreaterThan(0);

    const totals = state.getTotals();
    expect(totals.total).toBe(state.items[0].totalPrice);
    expect(totals.totalQuantity).toBe(1);
    expect(totals.marginAmount).toBeGreaterThan(0);
  });

  it('actualiza cantidades y recalcula el total de la cotización', () => {
    const store = useQuoterStore.getState();
    const mod = seedCatalogExpandedLatAm.modules[0];

    store.addModuleToCart(mod);
    const itemId = useQuoterStore.getState().items[0].id;
    const unitPrice = useQuoterStore.getState().items[0].unitPrice;

    store.updateItemQuantity(itemId, 3);

    const updated = useQuoterStore.getState().items[0];
    expect(updated.quantity).toBe(3);
    expect(updated.totalPrice).toBe(unitPrice * 3);

    const totals = useQuoterStore.getState().getTotals();
    expect(totals.totalQuantity).toBe(3);
  });

  it('ajusta medidas de módulo y recalcula el costo en tiempo real', () => {
    const store = useQuoterStore.getState();
    const mod = seedCatalogExpandedLatAm.modules[0];

    store.addModuleToCart(mod);
    const item = useQuoterStore.getState().items[0];
    const initialPrice = item.unitPrice;

    // Expand width
    store.updateItemDimensions(item.id, { lengthMm: item.lengthMm + 400 });

    const expanded = useQuoterStore.getState().items[0];
    expect(expanded.lengthMm).toBe(item.lengthMm + 400);
    expect(expanded.unitPrice).toBeGreaterThanOrEqual(initialPrice);
  });

  it('genera texto formateado para compartir por WhatsApp', () => {
    const store = useQuoterStore.getState();
    const mod = seedCatalogExpandedLatAm.modules[0];

    store.setCustomerName('Estudio Arq. Gómez');
    store.setProjectTitle('Reforma Cocina');
    store.addModuleToCart(mod);

    const waText = useQuoterStore.getState().generateWhatsAppText();

    expect(waText).toContain('PRESUPUESTO ESTIMADO DE CARPINTERÍA');
    expect(waText).toContain('Estudio Arq. Gómez');
    expect(waText).toContain('Reforma Cocina');
    expect(waText).toContain(mod.name);
    expect(waText).toContain('TOTAL ESTIMADO');
  });
});

describe('saveAsQuote — transición atómica Customer+Project (#715)', () => {
  const UUID_V4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const initialCustomers = useCatalogStore.getState().customers;

  function memoryStorage() {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => Promise.resolve(map.get(k) ?? null),
      setItem: (k: string, v: string) => {
        map.set(k, v);
        return Promise.resolve();
      },
      removeItem: (k: string) => {
        map.delete(k);
        return Promise.resolve();
      },
      __dump: () => map,
    };
  }

  let storage: ReturnType<typeof memoryStorage>;

  /** Server double for POST /projects: the #712 inline transition answers
   * 201 with the flat project plus the server-minted inline customer. */
  function mockInlineCreateSuccess(customerId = 'cust-server-1') {
    postMock.mockImplementation(async (endpoint: string, body: any) => {
      if (endpoint !== '/projects') {
        throw new Error(`POST inesperado: ${endpoint}`);
      }
      return {
        id: body.id,
        customer_id: customerId,
        inline_customer: {
          id: customerId,
          name: body.inline_customer_name,
          active: true,
        },
      };
    });
  }

  function seedCart(name = 'Ana') {
    const store = useQuoterStore.getState();
    store.setCustomerName(name);
    store.addModuleToCart(seedCatalogExpandedLatAm.modules[0]);
  }

  beforeEach(() => {
    postMock.mockReset();
    getMock.mockReset();
    // Working storage by default (fail-closed persistence requires a
    // backend); specific tests inject failing/corrupt variants.
    storage = memoryStorage();
    setQuoterIntentionStorage(storage);
    __resetQuoterIntentionHydration();
    useQuoterStore.setState({
      items: [],
      customerName: 'Cliente Particular',
      projectTitle: 'Presupuesto de Mobiliario',
      commercialMarginPercent: 35,
      pendingSaveIntention: null,
    });
    useCatalogStore.setState({ customers: [...initialCustomers] });
  });

  it('uuidV4Fallback genera UUID v4 con formato válido para el servidor', () => {
    for (let i = 0; i < 50; i++) {
      expect(uuidV4Fallback()).toMatch(UUID_V4);
    }
  });

  it('cliente nuevo: UN único POST /projects con inline_customer_name; el id del cliente es server-owned', async () => {
    mockInlineCreateSuccess('cust-server-1');
    seedCart('Ana');

    const result = await useQuoterStore.getState().saveAsQuote();

    // Una única transición: nunca POST /customers ni GET /customers.
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock.mock.calls[0][0]).toBe('/projects');
    expect(getMock).not.toHaveBeenCalled();

    const body = postMock.mock.calls[0][1];
    expect(body.id).toMatch(UUID_V4);
    expect(body.customer_id).toBe('');
    expect(body.inline_customer_name).toBe('Ana');

    // Respuesta autoritativa: projectId del server y customerId == customer
    // server-owned devuelto (nunca un id fabricado por Mobile).
    expect(result).toEqual({ projectId: body.id, customerName: 'Ana' });

    // Estado local reconciliado desde la respuesta, no fabricado.
    expect(
      useCatalogStore.getState().customers.find((c) => c.id === 'cust-server-1'),
    ).toMatchObject({ id: 'cust-server-1', name: 'Ana' });
    expect(useQuoterStore.getState().pendingSaveIntention).toBeNull();
  });

  it('homónimos: no deduplica por nombre aunque exista un cliente idéntico', async () => {
    // El servidor tiene una "Ana" (mayúsculas/minúsculas distintos): el
    // camino móvil ni siquiera debe consultarla.
    getMock.mockResolvedValue([{ id: 'cust-existente', name: 'aNA' }]);
    mockInlineCreateSuccess('cust-server-2');
    seedCart('Ana');

    const result = await useQuoterStore.getState().saveAsQuote();

    expect(getMock).not.toHaveBeenCalled();
    expect(postMock).toHaveBeenCalledTimes(1);
    const body = postMock.mock.calls[0][1];
    expect(body.customer_id).toBe('');
    expect(body.customer_id).not.toBe('cust-existente');
    expect(body.inline_customer_name).toBe('Ana');
    expect(result.projectId).toBe(body.id);
  });

  it('fallo server-side: error honesto, sin cliente/cotización fantasma local y draft conservado', async () => {
    mockInlineCreateSuccess();
    seedCart('Ana');
    postMock.mockRejectedValueOnce(
      new DomainError('Error interno del servidor', { status: 500 }),
    );

    await expect(useQuoterStore.getState().saveAsQuote()).rejects.toThrow(
      'Error interno del servidor',
    );

    // Sin estado local fantasma: el catálogo no adoptó ningún cliente nuevo.
    const customers = useCatalogStore.getState().customers;
    expect(customers).toHaveLength(initialCustomers.length);

    // El draft queda intacto para reintento.
    const state = useQuoterStore.getState();
    expect(state.items.length).toBe(1);
    expect(state.customerName).toBe('Ana');
    // La intención queda pendiente con su id estable para el reintento.
    const pendingId = state.pendingSaveIntention?.projectId;
    expect(pendingId).toMatch(UUID_V4);
  });

  it('retry de la MISMA intención tras error de red: mismo id, mismo payload, un único par final', async () => {
    mockInlineCreateSuccess('cust-server-3');
    seedCart('Ana');
    postMock.mockRejectedValueOnce(
      new DomainError('Error de red al conectar con el servidor', { url: 'u' }),
    );

    await expect(useQuoterStore.getState().saveAsQuote()).rejects.toThrow(
      'Error de red',
    );

    const result = await useQuoterStore.getState().saveAsQuote();

    expect(postMock).toHaveBeenCalledTimes(2);
    const [firstBody, secondBody] = [
      postMock.mock.calls[0][1],
      postMock.mock.calls[1][1],
    ];
    // Same semantic payload + same id en cada intento.
    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody).toEqual(firstBody);
    expect(result.projectId).toBe(firstBody.id);
    expect(useQuoterStore.getState().pendingSaveIntention).toBeNull();
    // Un único customer adoptado localmente: el del commit autoritativo.
    const added = useCatalogStore
      .getState()
      .customers.filter((c) => c.id === 'cust-server-3');
    expect(added).toHaveLength(1);
  });

  it('respuesta perdida (commit + 409 en retry): reconcilia por read-back sin duplicar el par', async () => {
    mockInlineCreateSuccess('cust-server-4');
    seedCart('Ana');

    // Primer intento: el commit llegó al server pero la respuesta se perdió.
    const networkFailure = new DomainError('Error de red', { url: 'u' });
    postMock.mockRejectedValueOnce(networkFailure);
    // Reintento con el mismo id: el server responde 409 (ya existe).
    postMock.mockRejectedValueOnce(
      new DomainError('El registro ya existe', { status: 409 }),
    );
    getMock.mockImplementation(async (endpoint: string) => {
      if (endpoint.startsWith('/projects/')) {
        return {
          id: endpoint.slice('/projects/'.length),
          customer_id: 'cust-server-4',
          name: 'Presupuesto de Mobiliario',
        };
      }
      if (endpoint.startsWith('/customers/')) {
        return { id: 'cust-server-4', name: 'Ana', active: true };
      }
      throw new Error(`GET inesperado: ${endpoint}`);
    });

    await expect(useQuoterStore.getState().saveAsQuote()).rejects.toThrow(
      'Error de red',
    );
    const result = await useQuoterStore.getState().saveAsQuote();

    // Ambos POST usaron el MISMO id de intención.
    expect(postMock.mock.calls[1][1].id).toBe(postMock.mock.calls[0][1].id);
    // La reconciliación leyó el par persistido, no creó nada nuevo.
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      projectId: postMock.mock.calls[0][1].id,
      customerName: 'Ana',
    });
    expect(useQuoterStore.getState().pendingSaveIntention).toBeNull();
    expect(
      useCatalogStore.getState().customers.filter((c) => c.id === 'cust-server-4'),
    ).toHaveLength(1);
  });

  it('cambio de intención: el payload distinto usa un id nuevo', async () => {
    mockInlineCreateSuccess('cust-server-5');
    seedCart('Ana');
    postMock.mockRejectedValueOnce(new DomainError('Error de red', { url: 'u' }));

    await expect(useQuoterStore.getState().saveAsQuote()).rejects.toThrow(
      'Error de red',
    );

    // El usuario cambia el contenido de la intención: es una intención nueva.
    useQuoterStore.getState().setCustomerName('Beatriz');
    await useQuoterStore.getState().saveAsQuote();

    const [firstBody, secondBody] = [
      postMock.mock.calls[0][1],
      postMock.mock.calls[1][1],
    ];
    expect(secondBody.id).not.toBe(firstBody.id);
    expect(secondBody.inline_customer_name).toBe('Beatriz');
    expect(secondBody.id).toMatch(UUID_V4);
  });

  it('respuesta 201 sin inline_customer: error honesto y la intención queda reintento-segura', async () => {
    seedCart('Ana');
    // Contrato roto: 201 sin el par autoritativo.
    postMock.mockResolvedValueOnce({ id: 'proj-x', customer_id: '' });

    await expect(useQuoterStore.getState().saveAsQuote()).rejects.toThrow(
      'El servidor no devolvió el par cliente+cotización creado',
    );

    // Sin cliente fantasma local y la intención conserva su id para el retry.
    expect(useCatalogStore.getState().customers).toHaveLength(
      initialCustomers.length,
    );
    const pending = useQuoterStore.getState().pendingSaveIntention;
    expect(pending?.projectId).toMatch(UUID_V4);
  });

  it('restart + respuesta perdida tras commit: rehidrata la intención, reintenta con el MISMO id y reconcilia por read-back', async () => {
    mockInlineCreateSuccess('cust-restart');
    seedCart('Ana');

    // 1) El POST pudo haber hecho commit pero la respuesta se perdió.
    postMock.mockRejectedValueOnce(
      new DomainError('Error de red al conectar con el servidor', { url: 'u' }),
    );
    await expect(useQuoterStore.getState().saveAsQuote()).rejects.toThrow(
      'Error de red',
    );
    const firstId = postMock.mock.calls[0][1].id as string;

    // 2) La intención persistida es sólo evidencia técnica mínima:
    // digest + projectId; sin nombre ni payload comercial.
    const raw = storage.__dump().get('granete_quoter_intention_v1');
    expect(raw).toBeDefined();
    const persisted = JSON.parse(raw as string);
    expect(persisted.projectId).toBe(firstId);
    expect(persisted.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(raw).not.toContain('Ana');
    expect(raw).not.toContain('Presupuesto');

    // 3) "App restart": memoria a estado inicial, hidratación re-ejecutada.
    useQuoterStore.setState({
      items: [],
      customerName: 'Cliente Particular',
      projectTitle: 'Presupuesto de Mobiliario',
      commercialMarginPercent: 35,
      pendingSaveIntention: null,
    });
    __resetQuoterIntentionHydration();
    expect(useQuoterStore.getState().pendingSaveIntention).toBeNull();

    // 4) El usuario re-ingresa el MISMO draft semántico.
    useQuoterStore.getState().setCustomerName('Ana');
    useQuoterStore.getState().addModuleToCart(
      seedCatalogExpandedLatAm.modules[0],
    );

    // 5) El commit del primer intento ya existía → reintento con mismo id → 409.
    postMock.mockRejectedValueOnce(
      new DomainError('El registro ya existe', { status: 409 }),
    );
    getMock.mockImplementation(async (endpoint: string) => {
      if (endpoint === `/projects/${firstId}`) {
        return {
          id: firstId,
          customer_id: 'cust-restart',
          name: 'Presupuesto de Mobiliario',
        };
      }
      if (endpoint === '/customers/cust-restart') {
        return { id: 'cust-restart', name: 'Ana', active: true };
      }
      throw new Error(`GET inesperado: ${endpoint}`);
    });

    const result = await useQuoterStore.getState().saveAsQuote();

    // 6) Mismo projectId recuperado tras el reinicio — sin par duplicado.
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(postMock.mock.calls[1][1].id).toBe(firstId);
    expect(result).toEqual({ projectId: firstId, customerName: 'Ana' });

    // 7) Un solo Customer + Project adoptados localmente.
    expect(
      useCatalogStore.getState().customers.filter((c) => c.id === 'cust-restart'),
    ).toHaveLength(1);

    // 8) Success confirmado → intención limpia en memoria Y persistencia.
    expect(useQuoterStore.getState().pendingSaveIntention).toBeNull();
    expect(storage.__dump().has('granete_quoter_intention_v1')).toBe(false);
  });

  it('409 con read-back incoherente: fallo honesto, nunca un 409 ciego', async () => {
    const storage = memoryStorage();
    setQuoterIntentionStorage(storage);
    mockInlineCreateSuccess();
    seedCart('Ana');

    // El id de la intención choca con un proyecto ajeno (nombre distinto).
    postMock.mockRejectedValueOnce(
      new DomainError('El registro ya existe', { status: 409 }),
    );
    getMock.mockImplementation(async (endpoint: string) => {
      if (endpoint.startsWith('/projects/')) {
        return {
          id: endpoint.slice('/projects/'.length),
          customer_id: 'cust-ajeno',
          name: 'Cocina de otro cliente',
        };
      }
      throw new Error(`GET inesperado: ${endpoint}`);
    });

    await expect(useQuoterStore.getState().saveAsQuote()).rejects.toThrow(
      'no coincide con esta intención',
    );

    // La intención se conserva para diagnóstico/reintento; sin adopción local.
    expect(useQuoterStore.getState().pendingSaveIntention).not.toBeNull();
    expect(storage.__dump().has('granete_quoter_intention_v1')).toBe(true);
    expect(useCatalogStore.getState().customers).toHaveLength(
      initialCustomers.length,
    );
    // Nunca se consultó el customer del proyecto ajeno.
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('fallo de escritura durable: fail-closed — 0 POST, error honesto, sin intención adoptada', async () => {
    mockInlineCreateSuccess();
    seedCart('Ana');
    const failing = memoryStorage();
    failing.setItem = () => Promise.reject(new Error('disk full'));
    setQuoterIntentionStorage(failing);

    await expect(useQuoterStore.getState().saveAsQuote()).rejects.toThrow(
      'No se pudo registrar el intento de guardado de forma segura',
    );

    // Fail-closed: sin POST no hay Customer ni Project posibles.
    expect(postMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
    // La intención no se adopta en memoria sin write durable confirmado.
    expect(useQuoterStore.getState().pendingSaveIntention).toBeNull();
    expect(useCatalogStore.getState().customers).toHaveLength(
      initialCustomers.length,
    );
  });

  it('intención persistida corrupta/inválida: fail-closed — 0 POST y sin nueva intención silenciosa', async () => {
    mockInlineCreateSuccess();
    const variants: ReadonlyArray<[string, string]> = [
      ['JSON inválido', '{no-es-json'],
      ['projectId inválido', JSON.stringify({ fingerprint: 'abcd1234abcd1234', projectId: 'no-uuid' })],
      ['fingerprint inválido', JSON.stringify({ fingerprint: '', projectId: uuidV4Fallback() })],
    ];

    for (const [label, raw] of variants) {
      postMock.mockReset();
      useQuoterStore.setState({
        items: [],
        customerName: 'Cliente Particular',
        projectTitle: 'Presupuesto de Mobiliario',
        commercialMarginPercent: 35,
        pendingSaveIntention: null,
      });
      storage.__dump().set('granete_quoter_intention_v1', raw);
      seedCart('Ana');

      await expect(useQuoterStore.getState().saveAsQuote()).rejects.toThrow(
        /corrupta|inválida/,
      );

      // Podría existir un commit previo irrecuperable tras esa fila: jamás
      // se acuña un projectId nuevo ni se envía nada.
      expect(postMock).not.toHaveBeenCalled();
      expect(useQuoterStore.getState().pendingSaveIntention).toBeNull();
      // La fila corrupta no se sobreescribe silenciosamente.
      expect(storage.__dump().get('granete_quoter_intention_v1')).toBe(raw);
      expect(label).toBeTruthy();
    }
  });

  it('fallo de lectura del storage: fail-closed — 0 POST', async () => {
    mockInlineCreateSuccess();
    seedCart('Ana');
    const unreadable = memoryStorage();
    unreadable.getItem = () => Promise.reject(new Error('io error'));
    setQuoterIntentionStorage(unreadable);

    await expect(useQuoterStore.getState().saveAsQuote()).rejects.toThrow(
      'No se pudo leer la intención de guardado persistida',
    );
    expect(postMock).not.toHaveBeenCalled();
    expect(useQuoterStore.getState().pendingSaveIntention).toBeNull();
  });

  it('sin backend de persistencia inyectado: fail-closed — 0 POST', async () => {
    mockInlineCreateSuccess();
    seedCart('Ana');
    setQuoterIntentionStorage(null);

    await expect(useQuoterStore.getState().saveAsQuote()).rejects.toThrow(
      'Persistencia local de la intención no disponible',
    );
    expect(postMock).not.toHaveBeenCalled();
    expect(useQuoterStore.getState().pendingSaveIntention).toBeNull();
  });
});
