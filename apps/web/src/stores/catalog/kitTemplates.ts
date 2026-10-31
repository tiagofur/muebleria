/**
 * catalog/kitTemplates (#1422 slice 2) — plantillas de juego del taller.
 *
 * Estado FUERA del catálogo JSON (son datos de planificación del asistente,
 * no entidades del BOM): CRUD directo contra /catalog/kit-templates con el
 * mismo token/tenant que el resto del store. La carga tolera backends viejos
 * (lista vacía) y los fallos de red degradan el select a las embebidas —
 * jamás bloquean el catálogo.
 */

import type { WorkshopKitTemplateRow } from '@granete/storage';
import type { CatalogState, CatalogStoreCtx } from './shared';

export type KitTemplatesSlice = {
  readonly kitTemplates: readonly WorkshopKitTemplateRow[];
  readonly kitTemplatesLoading: boolean;
  /** Aviso visible en el asistente cuando la carga falló (no es 404). */
  readonly kitTemplatesError: string | null;
  readonly loadKitTemplates: () => Promise<void>;
  /** Crea o actualiza según si el id ya existe en el estado (versión incluida). */
  readonly saveKitTemplate: (
    row: WorkshopKitTemplateRow,
  ) => Promise<WorkshopKitTemplateRow>;
  readonly deleteKitTemplate: (id: string, expectedVersion: number) => Promise<void>;
};

export function createKitTemplatesActions(ctx: CatalogStoreCtx): KitTemplatesSlice {
  const fetchImpl = ctx.deps.fetchImpl ?? globalThis.fetch;
  const baseUrl = ctx.deps.baseUrl;

  const authedHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = ctx.deps.getAuthToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  };

  const readRow = async (res: Response): Promise<WorkshopKitTemplateRow> => {
    const payload = (await res.json().catch(() => null)) as
      | { code?: string; message?: string; field?: string }
      | null;
    if (!res.ok) {
      const detail = payload?.message ?? `HTTP ${res.status}`;
      throw new Error(
        payload?.code === 'KIT_TEMPLATE_INVALID' && payload.field
          ? `La plantilla no es válida (${payload.field}): ${detail}`
          : detail,
      );
    }
    return payload as WorkshopKitTemplateRow;
  };

  return {
    kitTemplates: [],
    kitTemplatesLoading: false,
    kitTemplatesError: null,

    loadKitTemplates: async () => {
      ctx.set({ kitTemplatesLoading: true, kitTemplatesError: null });
      try {
        const res = await fetchImpl(`${baseUrl}/catalog/kit-templates`, {
          headers: authedHeaders(),
        });
        if (res.status === 404) {
          // Backend viejo sin el endpoint: se degrada a las embebidas, sin
          // aviso — es el estado legítimo «este backend no tiene la familia».
          ctx.set({ kitTemplates: [], kitTemplatesLoading: false, kitTemplatesError: null });
          return;
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const rows = (await res.json()) as WorkshopKitTemplateRow[];
        ctx.set({
          kitTemplates: Array.isArray(rows) ? rows : [],
          kitTemplatesLoading: false,
          kitTemplatesError: null,
        });
      } catch {
        // Red caída o error real: la lista previa queda STALE (no se borra —
        // borrarla escondería plantillas que siguen existiendo) y el asistente
        // muestra el aviso; los estados nunca se disfrazan de «sin datos».
        const stale = ctx.get().kitTemplates.length > 0;
        ctx.set({
          kitTemplatesLoading: false,
          kitTemplatesError: stale
            ? 'No se pudieron cargar las plantillas del taller; se muestran las últimas conocidas.'
            : 'No se pudieron cargar las plantillas del taller; el asistente ofrece las incorporadas.',
        });
      }
    },

    saveKitTemplate: async (row) => {
      const existing = ctx.get().kitTemplates.find((t) => t.id === row.id);
      const res = await fetchImpl(
        existing
          ? `${baseUrl}/catalog/kit-templates/${encodeURIComponent(row.id)}`
          : `${baseUrl}/catalog/kit-templates`,
        {
          method: existing ? 'PUT' : 'POST',
          headers: existing
            ? { ...authedHeaders(), 'If-Match': `"v${row.version}"` }
            : authedHeaders(),
          body: JSON.stringify({
            id: row.id,
            code: row.code,
            labelEs: row.labelEs,
            agregadoLabelEs: row.agregadoLabelEs,
            motion: row.motion,
            slots: row.slots,
          }),
        },
      );
      const saved = await readRow(res);
      ctx.set({
        kitTemplates: existing
          ? ctx.get().kitTemplates.map((t) => (t.id === saved.id ? saved : t))
          : [...ctx.get().kitTemplates, saved],
      });
      return saved;
    },

    deleteKitTemplate: async (id, expectedVersion) => {
      const res = await fetchImpl(
        `${baseUrl}/catalog/kit-templates/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
          headers: { ...authedHeaders(), 'If-Match': `"v${expectedVersion}"` },
        },
      );
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? `No se pudo eliminar la plantilla (HTTP ${res.status}).`);
      }
      ctx.set({ kitTemplates: ctx.get().kitTemplates.filter((t) => t.id !== id) });
    },
  };
}
