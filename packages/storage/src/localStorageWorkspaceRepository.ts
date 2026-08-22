/**
 * LocalStorage implementation of WorkspaceRepository for Guest mode.
 */

import type {
  Catalog,
  Project,
  WorkshopSettings,
  ProjectTemplate,
  Workspace,
  ItemFloorStatus,
  FloorStatusEvent,
  LoadingProgress,
  ProjectPickingState,
  MaterialStock,
  StockMaterialKind,
  StockMovement,
  StockMovementType,
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseOrderStatus,
  Supplier,
} from '@muebles/domain';
import {
  withWorkshopSettings,
  advanceFloorStatus,
  appendFloorEvent,
  calculateLoadingProgress,
  nextItemFloorStatus,
  normalizeItemFloorStatus,
  pickingKey,
  poCanReceive,
  stockMovementDelta,
} from '@muebles/domain';
import type { WorkspaceRepository } from './workspaceRepository';
import { createSeedWorkspace } from './seed';
import { migrateWorkspace } from './migrateWorkspace';

/** Exported so the shell can probe for meaningful guest data (F118 S3). */
export const GUEST_WORKSPACE_STORAGE_KEY = 'muebles_guest_workspace';
const LOCAL_STORAGE_KEY = GUEST_WORKSPACE_STORAGE_KEY;
const PICKING_LOCAL_STORAGE_KEY = 'muebles_guest_picking';
const STOCK_LOCAL_STORAGE_KEY = 'muebles_guest_stock';
const STOCK_MOVEMENTS_LOCAL_STORAGE_KEY = 'muebles_guest_stock_movements';
const SUPPLIERS_LOCAL_STORAGE_KEY = 'muebles_guest_suppliers';
const PURCHASE_ORDERS_LOCAL_STORAGE_KEY = 'muebles_guest_purchase_orders';
const PO_COUNTER_LOCAL_STORAGE_KEY = 'muebles_guest_po_counter';

export class LocalStorageWorkspaceRepository implements WorkspaceRepository {
  private getWorkspace(): Workspace {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
      return createSeedWorkspace();
    }
    try {
      const raw = globalThis.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (raw) {
        // F116 C6: guest workspaces persisted at an older schemaVersion must
        // migrate on load, exactly like the JSON file storage does.
        return withWorkshopSettings(migrateWorkspace(JSON.parse(raw) as Workspace));
      }
    } catch {
      // ignore
    }
    return createSeedWorkspace();
  }

  private saveWorkspace(ws: Workspace): void {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) return;
    try {
      globalThis.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(ws));
    } catch {
      // ignore
    }
  }

  async load(): Promise<Workspace> {
    return this.getWorkspace();
  }

  async save(workspace: Workspace): Promise<void> {
    this.saveWorkspace(workspace);
  }

  async getCatalog(): Promise<Catalog> {
    return this.getWorkspace().catalog;
  }

  async saveCatalog(catalog: Catalog): Promise<void> {
    const ws = this.getWorkspace();
    this.saveWorkspace({
      ...ws,
      catalog,
    });
  }

  async saveWorkshopSettings(settings: WorkshopSettings): Promise<void> {
    // F118 S1: patch settings in the STORED workspace — never re-save an
    // in-memory snapshot (it may hold stale catalog/projects).
    const ws = this.getWorkspace();
    this.saveWorkspace({ ...ws, settings });
  }

  async getProjects(): Promise<readonly Project[]> {
    return this.getWorkspace().projects;
  }

  async createProject(project: Project): Promise<void> {
    return this.saveProject(project);
  }

  async saveProject(project: Project): Promise<void> {
    const ws = this.getWorkspace();
    const exists = ws.projects.some((p) => p.id === project.id);
    const projects = exists
      ? ws.projects.map((p) => (p.id === project.id ? project : p))
      : [...ws.projects, project];
    this.saveWorkspace({
      ...ws,
      projects,
    });
  }

  async deleteProject(projectId: string): Promise<void> {
    const ws = this.getWorkspace();
    this.saveWorkspace({
      ...ws,
      projects: ws.projects.filter((p) => p.id !== projectId),
    });
  }

  // --- Project templates (#110 / H15) ---

  async getProjectTemplates(): Promise<readonly ProjectTemplate[]> {
    return this.getWorkspace().projectTemplates ?? [];
  }

  async createProjectTemplate(template: ProjectTemplate): Promise<void> {
    return this.saveProjectTemplate(template);
  }

  async saveProjectTemplate(template: ProjectTemplate): Promise<void> {
    const ws = this.getWorkspace();
    const current = ws.projectTemplates ?? [];
    const exists = current.some((t) => t.id === template.id);
    const projectTemplates = exists
      ? current.map((t) => (t.id === template.id ? template : t))
      : [...current, template];
    this.saveWorkspace({ ...ws, projectTemplates });
  }

  async deleteProjectTemplate(templateId: string): Promise<void> {
    const ws = this.getWorkspace();
    this.saveWorkspace({
      ...ws,
      projectTemplates: (ws.projectTemplates ?? []).filter(
        (t) => t.id !== templateId,
      ),
    });
  }

  // --- Floor scan & Loading status (PROD-3.1 / F092) ---

  async floorScan(
    projectId: string,
    payload: {
      module?: string;
      factoryCode?: string;
      itemId?: string;
      targetStatus?: ItemFloorStatus;
      advance?: boolean;
    },
  ): Promise<{
    projectId: string;
    projectName: string;
    itemId: string;
    factoryCode: string;
    moduleCode: string;
    moduleName: string;
    statusBefore: ItemFloorStatus;
    statusAfter: ItemFloorStatus;
    nextStatus: string;
    loadingProgress: LoadingProgress;
    event?: FloorStatusEvent | null;
  }> {
    const ws = this.getWorkspace();
    const project = ws.projects.find((p) => p.id === projectId);
    if (!project) throw new Error('Obra no encontrada');

    const item = payload.itemId
      ? project.items.find((it) => it.id === payload.itemId)
      : project.items[0];
    if (!item) throw new Error('Item no encontrado');

    const before = normalizeItemFloorStatus(item.floorStatus);
    // Floor-scan contract keeps arbitrary targets (dispatch module labels):
    // allowJump preserves behavior while the event records the skip (F092).
    const advance = advanceFloorStatus({
      projectId: project.id,
      itemId: item.id,
      current: before,
      target: payload.targetStatus,
      advance: payload.advance,
      allowJump: true,
      source: 'scan',
    });
    const after = advance.ok ? advance.status : before;
    const event = advance.ok ? advance.event : null;

    const updatedItems = project.items.map((it) =>
      it.id === item.id ? { ...it, floorStatus: after } : it,
    );
    let updatedProject: Project = { ...project, items: updatedItems };
    if (event) updatedProject = appendFloorEvent(updatedProject, event);
    const updatedWs = {
      ...ws,
      projects: ws.projects.map((p) => (p.id === projectId ? updatedProject : p)),
    };
    this.saveWorkspace(updatedWs);

    const progress = calculateLoadingProgress(updatedProject);
    const mod = ws.catalog.modules.find((m) => m.id === item.moduleId);

    return {
      projectId: project.id,
      projectName: project.name,
      itemId: item.id,
      factoryCode: mod?.code ?? item.moduleId,
      moduleCode: mod?.code ?? item.moduleId,
      moduleName: mod?.name ?? '',
      statusBefore: before,
      statusAfter: after,
      nextStatus: nextItemFloorStatus(after) ?? '',
      loadingProgress: progress,
      event,
    };
  }

  async getProjectLoadingStatus(projectId: string): Promise<{
    projectId: string;
    projectName: string;
    loadingProgress: LoadingProgress;
  }> {
    const ws = this.getWorkspace();
    const project = ws.projects.find((p) => p.id === projectId);
    if (!project) throw new Error('Obra no encontrada');
    return {
      projectId: project.id,
      projectName: project.name,
      loadingProgress: calculateLoadingProgress(project),
    };
  }

  async setProjectItemFloorStatus(
    projectId: string,
    itemId: string,
    status?: ItemFloorStatus,
  ): Promise<{
    projectId: string;
    itemId: string;
    floorStatus: ItemFloorStatus;
    nextStatus: string;
    event?: FloorStatusEvent | null;
  }> {
    const ws = this.getWorkspace();
    const project = ws.projects.find((p) => p.id === projectId);
    if (!project) throw new Error('Obra no encontrada');
    const item = project.items.find((it) => it.id === itemId);
    if (!item) throw new Error('Item no encontrado');

    const currentStatus = normalizeItemFloorStatus(item.floorStatus);
    // Arbitrary select (Modules tab) stays supported; jumps get audited.
    const advance = advanceFloorStatus({
      projectId,
      itemId,
      current: currentStatus,
      target: status,
      advance: !status,
      allowJump: true,
      source: 'manual',
    });
    const resolvedStatus = advance.ok ? advance.status : currentStatus;
    const event = advance.ok ? advance.event : null;

    const updatedItems = project.items.map((it) =>
      it.id === itemId ? { ...it, floorStatus: resolvedStatus } : it,
    );
    let updatedProject: Project = { ...project, items: updatedItems };
    if (event) updatedProject = appendFloorEvent(updatedProject, event);
    this.saveWorkspace({
      ...ws,
      projects: ws.projects.map((p) => (p.id === projectId ? updatedProject : p)),
    });

    return {
      projectId,
      itemId,
      floorStatus: resolvedStatus,
      nextStatus: nextItemFloorStatus(resolvedStatus) ?? '',
      event,
    };
  }

  async listFloorEvents(
    projectId: string,
  ): Promise<readonly FloorStatusEvent[]> {
    const ws = this.getWorkspace();
    const project = ws.projects.find((p) => p.id === projectId);
    return project?.floorEvents ?? [];
  }

  // --- Compras / Almacén picking (Fase 3) ---

  private getPicking(): ProjectPickingState[] {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
      return [];
    }
    try {
      const raw = globalThis.localStorage.getItem(PICKING_LOCAL_STORAGE_KEY);
      if (raw) {
        const list = JSON.parse(raw) as ProjectPickingState[];
        return Array.isArray(list) ? list : [];
      }
    } catch {
      // ignore
    }
    return [];
  }

  private savePicking(list: ProjectPickingState[]): void {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
      return;
    }
    try {
      globalThis.localStorage.setItem(
        PICKING_LOCAL_STORAGE_KEY,
        JSON.stringify(list),
      );
    } catch {
      // ignore
    }
  }

  async listPickingStates(): Promise<readonly ProjectPickingState[]> {
    return this.getPicking();
  }

  async setProjectPickingState(state: ProjectPickingState): Promise<void> {
    // Guest mode has no authenticated actor; stamp the client time on
    // despacho, clear the stamp when back to pendiente (server parity).
    const stamped: ProjectPickingState =
      state.status === 'despachado'
        ? {
            ...state,
            markedAt: state.markedAt ?? new Date().toISOString(),
          }
        : { ...state, markedAt: undefined, markedBy: undefined };
    const key = pickingKey(state.projectId, state.material);
    const next = this.getPicking().filter(
      (p) => pickingKey(p.projectId, p.material) !== key,
    );
    next.push(stamped);
    this.savePicking(next);
  }

  // --- Compras / Almacén stock (Fase 3b) ---

  private getStockRows(): MaterialStock[] {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
      return [];
    }
    try {
      const raw = globalThis.localStorage.getItem(STOCK_LOCAL_STORAGE_KEY);
      if (raw) {
        const list = JSON.parse(raw) as MaterialStock[];
        return Array.isArray(list) ? list : [];
      }
    } catch {
      // ignore
    }
    return [];
  }

  private saveStockRows(list: MaterialStock[]): void {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
      return;
    }
    try {
      globalThis.localStorage.setItem(STOCK_LOCAL_STORAGE_KEY, JSON.stringify(list));
    } catch {
      // ignore
    }
  }

  private getStockMovements(): StockMovement[] {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
      return [];
    }
    try {
      const raw = globalThis.localStorage.getItem(STOCK_MOVEMENTS_LOCAL_STORAGE_KEY);
      if (raw) {
        const list = JSON.parse(raw) as StockMovement[];
        return Array.isArray(list) ? list : [];
      }
    } catch {
      // ignore
    }
    return [];
  }

  private saveStockMovements(list: StockMovement[]): void {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
      return;
    }
    try {
      globalThis.localStorage.setItem(
        STOCK_MOVEMENTS_LOCAL_STORAGE_KEY,
        JSON.stringify(list),
      );
    } catch {
      // ignore
    }
  }

  async getStock(): Promise<readonly MaterialStock[]> {
    return this.getStockRows();
  }

  async upsertStockMin(stock: {
    kind: StockMaterialKind;
    materialId: string;
    minStock: number;
  }): Promise<MaterialStock> {
    const rows = this.getStockRows();
    const existing = rows.find(
      (r) => r.kind === stock.kind && r.materialId === stock.materialId,
    );
    const updated: MaterialStock = {
      kind: stock.kind,
      materialId: stock.materialId,
      quantity: existing?.quantity ?? 0,
      minStock: stock.minStock,
      updatedAt: new Date().toISOString(),
    };
    const next = existing
      ? rows.map((r) =>
          r.kind === stock.kind && r.materialId === stock.materialId ? updated : r,
        )
      : [...rows, updated];
    this.saveStockRows(next);
    return updated;
  }

  async recordStockMovement(payload: {
    kind: StockMaterialKind;
    materialId: string;
    type: StockMovementType;
    quantity: number;
    projectId?: string;
    note?: string;
    revertsId?: string;
  }): Promise<StockMovement> {
    const rows = this.getStockRows();
    const current = rows.find(
      (r) => r.kind === payload.kind && r.materialId === payload.materialId,
    );
    const moves = this.getStockMovements();

    // Despacho con reverts_id → reversión: acredita (paridad con el server).
    let reverting = false;
    if (payload.revertsId) {
      if (payload.type !== 'despacho') {
        throw new Error('solo un movimiento de tipo despacho puede tener reverts_id');
      }
      const original = moves.find((m) => m.id === payload.revertsId);
      if (!original) {
        throw new Error('movimiento a revertir no encontrado');
      }
      if (original.type !== 'despacho') {
        throw new Error('solo se puede revertir un despacho');
      }
      if (original.kind !== payload.kind || original.materialId !== payload.materialId) {
        throw new Error('el movimiento a revertir no corresponde a este material');
      }
      if (Math.abs(payload.quantity) - Math.abs(original.delta) > 1e-6 || Math.abs(original.delta) - Math.abs(payload.quantity) > 1e-6) {
        throw new Error('el monto de la reversión debe ser exactamente igual al despacho original');
      }
      const alreadyReverted = moves.some((m) => m.revertsId === payload.revertsId);
      if (alreadyReverted) {
        throw new Error('este despacho ya fue revertido');
      }
      reverting = true;
    }

    let delta = stockMovementDelta(payload.type, payload.quantity);
    if (reverting) delta = -delta;

    const balance =
      (current?.quantity ?? 0) + delta;
    if (!current && payload.type !== 'entrada') {
      throw new Error('material sin stock cargado — recibí una entrada primero');
    }
    if (balance < 0) {
      throw new Error(`stock insuficiente: faltan ${Math.abs(balance).toFixed(2)}`);
    }

    const now = new Date().toISOString();
    const movement: StockMovement = {
      id:
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `sm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: payload.kind,
      materialId: payload.materialId,
      type: payload.type,
      delta,
      balanceAfter: balance,
      projectId: payload.projectId,
      note: payload.note,
      revertsId: payload.revertsId,
      byUserId: 'guest',
      at: now,
    };

    const nextRows = current
      ? rows.map((r) =>
          r.kind === payload.kind && r.materialId === payload.materialId
            ? { ...r, quantity: balance, updatedAt: now }
            : r,
        )
      : [
          ...rows,
          {
            kind: payload.kind,
            materialId: payload.materialId,
            quantity: balance,
            minStock: 0,
            updatedAt: now,
          } as MaterialStock,
        ];
    this.saveStockRows(nextRows);
    this.saveStockMovements([movement, ...this.getStockMovements()]);
    return movement;
  }

  async listStockMovements(filter?: {
    kind?: StockMaterialKind;
    materialId?: string;
    projectId?: string;
    limit?: number;
  }): Promise<readonly StockMovement[]> {
    let list = this.getStockMovements();
    if (filter?.kind) list = list.filter((m) => m.kind === filter.kind);
    if (filter?.materialId) {
      list = list.filter((m) => m.materialId === filter.materialId);
    }
    if (filter?.projectId) {
      list = list.filter((m) => m.projectId === filter.projectId);
    }
    if (filter?.limit) list = list.slice(0, filter.limit);
    return list;
  }

  // --- Compras / Almacén proveedores + órdenes de compra (Fase 3c) ---

  private getSuppliers(): Supplier[] {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
      return [];
    }
    try {
      const raw = globalThis.localStorage.getItem(SUPPLIERS_LOCAL_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Supplier[]) : [];
    } catch {
      return [];
    }
  }

  private saveSuppliers(list: Supplier[]): void {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) return;
    try {
      globalThis.localStorage.setItem(SUPPLIERS_LOCAL_STORAGE_KEY, JSON.stringify(list));
    } catch {
      // ignore
    }
  }

  private getPurchaseOrders(): PurchaseOrder[] {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
      return [];
    }
    try {
      const raw = globalThis.localStorage.getItem(PURCHASE_ORDERS_LOCAL_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as PurchaseOrder[]) : [];
    } catch {
      return [];
    }
  }

  private savePurchaseOrders(list: PurchaseOrder[]): void {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) return;
    try {
      globalThis.localStorage.setItem(PURCHASE_ORDERS_LOCAL_STORAGE_KEY, JSON.stringify(list));
    } catch {
      // ignore
    }
  }

  private nextPoNumber(): string {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
      return 'OC-0001';
    }
    try {
      const raw = globalThis.localStorage.getItem(PO_COUNTER_LOCAL_STORAGE_KEY);
      const current = raw ? parseInt(raw, 10) : 0;
      const next = isNaN(current) || current < 0 ? 1 : current + 1;
      globalThis.localStorage.setItem(PO_COUNTER_LOCAL_STORAGE_KEY, String(next));
      return `OC-${String(next).padStart(4, '0')}`;
    } catch {
      return 'OC-0001';
    }
  }

  async listSuppliers(): Promise<readonly Supplier[]> {
    return this.getSuppliers();
  }

  async createSupplier(supplier: {
    id: string;
    name: string;
    contactName?: string;
    email?: string;
    phone?: string;
    notes?: string;
    active?: boolean;
  }): Promise<Supplier> {
    const now = new Date().toISOString();
    const sp: Supplier = {
      id: supplier.id,
      name: supplier.name,
      contactName: supplier.contactName,
      email: supplier.email,
      phone: supplier.phone,
      notes: supplier.notes,
      active: supplier.active ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.saveSuppliers([...this.getSuppliers(), sp]);
    return sp;
  }

  async updateSupplier(supplier: {
    id: string;
    name: string;
    contactName?: string;
    email?: string;
    phone?: string;
    notes?: string;
    active?: boolean;
  }): Promise<Supplier> {
    const list = this.getSuppliers();
    const next = list.map((sp) =>
      sp.id === supplier.id
        ? {
            ...sp,
            name: supplier.name,
            contactName: supplier.contactName,
            email: supplier.email,
            phone: supplier.phone,
            notes: supplier.notes,
            active: supplier.active ?? sp.active,
            updatedAt: new Date().toISOString(),
          }
        : sp,
    );
    this.saveSuppliers(next);
    const found = next.find((sp) => sp.id === supplier.id);
    if (!found) {
      throw new Error(`proveedor no encontrado: ${supplier.id}`);
    }
    return found;
  }

  async deactivateSupplier(id: string): Promise<void> {
    this.saveSuppliers(
      this.getSuppliers().map((sp) =>
        sp.id === id ? { ...sp, active: false, updatedAt: new Date().toISOString() } : sp,
      ),
    );
  }

  async listPurchaseOrders(): Promise<readonly PurchaseOrder[]> {
    return this.getPurchaseOrders();
  }

  async getPurchaseOrder(id: string): Promise<PurchaseOrder | null> {
    return this.getPurchaseOrders().find((po) => po.id === id) ?? null;
  }

  async createPurchaseOrder(po: {
    id: string;
    supplierId: string;
    notes?: string;
    requiredBy?: string;
    expectedAt?: string;
    items: readonly {
      kind: StockMaterialKind;
      materialId: string;
      quantity: number;
      unitCost?: number;
      allocatedProjectId?: string;
    }[];
  }): Promise<PurchaseOrder> {
    const now = new Date().toISOString();
    const order: PurchaseOrder = {
      id: po.id,
      number: this.nextPoNumber(),
      supplierId: po.supplierId,
      status: 'borrador',
      items: po.items.map((it) => ({
        kind: it.kind,
        materialId: it.materialId,
        quantity: it.quantity,
        receivedQuantity: 0,
        unitCost: it.unitCost,
        allocatedProjectId: it.allocatedProjectId,
      })),
      notes: po.notes,
      requiredBy: po.requiredBy,
      expectedAt: po.expectedAt,
      createdAt: now,
      updatedAt: now,
      createdBy: 'guest',
    };
    this.savePurchaseOrders([...this.getPurchaseOrders(), order]);
    return order;
  }

  async updatePurchaseOrder(po: {
    id: string;
    supplierId: string;
    notes?: string;
    requiredBy?: string;
    expectedAt?: string;
    items: readonly {
      kind: StockMaterialKind;
      materialId: string;
      quantity: number;
      unitCost?: number;
      allocatedProjectId?: string;
    }[];
  }): Promise<PurchaseOrder> {
    const list = this.getPurchaseOrders();
    const index = list.findIndex((p) => p.id === po.id);
    const current = list[index];
    if (!current) throw new Error(`orden no encontrada: ${po.id}`);
    if (current.status !== 'borrador') {
      throw new Error('solo se puede editar una orden en borrador');
    }
    const updated: PurchaseOrder = {
      ...current,
      supplierId: po.supplierId,
      notes: po.notes,
      requiredBy: po.requiredBy,
      expectedAt: po.expectedAt,
      items: po.items.map((it) => ({
        kind: it.kind,
        materialId: it.materialId,
        quantity: it.quantity,
        receivedQuantity: 0,
        unitCost: it.unitCost,
        allocatedProjectId: it.allocatedProjectId,
      })),
      updatedAt: new Date().toISOString(),
    };
    this.savePurchaseOrders(list.map((p, i) => (i === index ? updated : p)));
    return updated;
  }

  async emitPurchaseOrder(id: string): Promise<PurchaseOrder> {
    return this.transitionPO(id, 'emitida');
  }

  async cancelPurchaseOrder(id: string): Promise<PurchaseOrder> {
    return this.transitionPO(id, 'cancelada');
  }

  private transitionPO(id: string, to: PurchaseOrderStatus): PurchaseOrder {
    const list = this.getPurchaseOrders();
    const index = list.findIndex((p) => p.id === id);
    const current = list[index];
    if (!current) throw new Error(`orden no encontrada: ${id}`);
    const allowed =
      to === 'emitida'
        ? current.status === 'borrador'
        : current.status === 'borrador' || current.status === 'emitida';
    if (!allowed) {
      throw new Error(
        to === 'emitida'
          ? 'solo una orden en borrador se puede emitir'
          : 'esta orden no se puede cancelar (estado terminal)',
      );
    }
    const updated: PurchaseOrder = {
      ...current,
      status: to,
      updatedAt: new Date().toISOString(),
    };
    this.savePurchaseOrders(list.map((p, i) => (i === index ? updated : p)));
    return updated;
  }

  async receivePurchaseOrder(
    id: string,
    lines: readonly { kind: StockMaterialKind; materialId: string; quantity: number }[],
  ): Promise<PurchaseOrder> {
    const list = this.getPurchaseOrders();
    const index = list.findIndex((p) => p.id === id);
    const current = list[index];
    if (!current) throw new Error(`orden no encontrada: ${id}`);
    if (!poCanReceive(current.status)) {
      throw new Error('solo una orden emitida se puede recibir');
    }

    // Validar líneas antes de modificar stock o la orden
    const itemMap = new Map<string, PurchaseOrderItem>();
    for (const it of current.items) {
      itemMap.set(`${it.kind}:${it.materialId}`, it);
    }
    const byQty = new Map<string, number>();
    for (const line of lines) {
      if (line.quantity <= 0) {
        throw new Error('la cantidad a recibir debe ser mayor a cero');
      }
      const key = `${line.kind}:${line.materialId}`;
      const poItem = itemMap.get(key);
      if (!poItem) {
        throw new Error(`el material ${line.materialId} (${line.kind}) no pertenece a esta orden de compra`);
      }
      const prevQty = byQty.get(key) ?? 0;
      const totalAttempted = prevQty + line.quantity;
      if (poItem.receivedQuantity + totalAttempted > poItem.quantity + 1e-6) {
        throw new Error(`la cantidad a recibir de ${line.materialId} excede el restante pendiente`);
      }
      byQty.set(key, totalAttempted);
    }

    // Stock entradas for every received line (note references the OC number).
    for (const line of lines) {
      await this.recordStockMovement({
        kind: line.kind,
        materialId: line.materialId,
        type: 'entrada',
        quantity: line.quantity,
        note: current.number,
      });
    }

    const items: PurchaseOrderItem[] = current.items.map((it) => {
      const received = it.receivedQuantity + (byQty.get(`${it.kind}:${it.materialId}`) ?? 0);
      return { ...it, receivedQuantity: received };
    });
    const fullyReceived =
      items.length > 0 && items.every((it) => it.receivedQuantity >= it.quantity);
    const updated: PurchaseOrder = {
      ...current,
      items,
      status: fullyReceived ? 'recibida' : current.status,
      receivedAt: fullyReceived ? new Date().toISOString() : current.receivedAt,
      updatedAt: new Date().toISOString(),
    };
    this.savePurchaseOrders(list.map((p, i) => (i === index ? updated : p)));
    return updated;
  }
}
