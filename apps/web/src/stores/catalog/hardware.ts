/**
 * catalog/hardware — Hardware mutations incl. 3D preview fields (F069/F080).
 */

import {
  agregadoDeclaresKitViaVariant,
  ensureAgregadoKitParts,
  normalizeHardwarePartFinishes,
  syncAgregadoWithKitParts,
  validateHardwareDesignParts,
  type Agregado,
  type HardwareDesignPart,
} from '@granete/domain';
import type { Hardware } from '@granete/domain';
import type { HardwareDraft } from '@granete/ui';

import type { CatalogState, CatalogStoreCtx } from './shared';
import { optionalNotes, parseDraftNum } from './shared';

const HARDWARE_SHAPES = ['knob', 'bar-pull', 'cup-pull', 'hinge', 'slide', 'rail', 'leg'];

/**
 * #1493: sincroniza un agregado con las partes efectivas de un kit. Las
 * recetas ligadas por commercialKitHardwareId usan el espejo destructivo
 * histórico (una parte desvinculada sale de la receta); las que declaran el
 * kit vía VARIANTE (una altura Blum MERIVOBOX = un kit) reciben el sync
 * aditivo — nunca remueve, porque el sync de un kit no puede borrar las
 * partes de otro.
 */
function syncAgregadoForKit(
  agregado: Agregado,
  kitId: string,
  hardware: readonly Hardware[],
): Agregado {
  const kitParts = hardware.filter((h) => h.active && h.kitHardwareId === kitId);
  // Review #1494: si la receta TAMBIÉN declara kits por variante, el espejo
  // destructivo del kit a nivel agregado borraría en silencio las partes de
  // los otros kits (el motor da precedencia a la variante) — en esa
  // combinación manda el sync aditivo.
  const declaresAnyVariantKit = (agregado.variantSets ?? []).some((vs) =>
    (vs.variants ?? []).some((v) => (v.commercialKitHardwareId ?? '').trim() !== ''),
  );
  if (agregado.commercialKitHardwareId === kitId && !declaresAnyVariantKit) {
    return syncAgregadoWithKitParts(agregado, kitParts);
  }
  if (agregado.commercialKitHardwareId === kitId || agregadoDeclaresKitViaVariant(agregado, kitId)) {
    return ensureAgregadoKitParts(agregado, kitParts);
  }
  return agregado;
}

/**
 * Extracts 3D preview fields from a HardwareDraft into a partial Hardware
 * object that can be spread into create/update. F069.
 */
function hardwarePreviewFields(
  draft: HardwareDraft,
): Pick<Hardware,
  | 'previewShape'
  | 'previewColor'
  | 'previewSizeMm'
  | 'previewDiameterMm'
  | 'previewProjectionMm'
  | 'previewRoughness'
  | 'previewMetalness'
  | 'previewClearcoat'
  | 'partFinishes'
  | 'maxOpeningAngleDeg'
  | 'dimensions'
> {
  const shape = HARDWARE_SHAPES.includes(draft.previewShape)
    ? (draft.previewShape as Hardware['previewShape'])
    : undefined;
  const color = draft.previewColor?.trim() || undefined;
  const partFinishes = normalizeHardwarePartFinishes({
    body: draft.partFinishes?.body || undefined,
    base: draft.partFinishes?.base || undefined,
    grip: draft.partFinishes?.grip || undefined,
  });
  const angle = Number(draft.maxOpeningAngleDeg);
  const maxOpeningAngleDeg = Number.isFinite(angle) && angle > 0 ? angle : undefined;
  return {
    ...(shape ? { previewShape: shape } : {}),
    ...(color ? { previewColor: color } : {}),
    ...(draft.previewSizeMm ? { previewSizeMm: parseDraftNum(draft.previewSizeMm) } : {}),
    ...(draft.previewDiameterMm ? { previewDiameterMm: parseDraftNum(draft.previewDiameterMm) } : {}),
    ...(draft.previewProjectionMm ? { previewProjectionMm: parseDraftNum(draft.previewProjectionMm) } : {}),
    ...(draft.previewRoughness ? { previewRoughness: parseDraftNum(draft.previewRoughness, true) } : {}),
    ...(draft.previewMetalness ? { previewMetalness: parseDraftNum(draft.previewMetalness, true) } : {}),
    ...(draft.previewClearcoat ? { previewClearcoat: parseDraftNum(draft.previewClearcoat, true) } : {}),
    ...(partFinishes ? { partFinishes } : {}),
    ...(maxOpeningAngleDeg ? { maxOpeningAngleDeg } : {}),
    ...hardwareDimensionsField(draft),
    ...hardwareDesignPartsField(draft),
    // #1422 slice 1: el link kit↔parte sobrevive a cualquier edición del form.
    ...(draft.kitHardwareId ? { kitHardwareId: draft.kitHardwareId } : {}),
  };
}

/**
 * #1417: convierte las filas de form a partes de dominio. Una fila sin
 * componentName se descarta (fila vacía del form); cualquier invalidez real
 * lanza — el modal muestra el mensaje y nada persiste (fail-closed).
 */
function hardwareDesignPartsField(draft: HardwareDraft): Pick<Hardware, 'designParts'> | {} {
  const rows = (draft.designParts ?? [])
    .filter((p) => p.componentName.trim() !== '')
    .map((p) => ({
      componentName: p.componentName.trim(),
      actorMembership: p.actorMembership,
      ...(p.label.trim() ? { label: p.label.trim() } : {}),
      ...(p.finishKey.trim() ? { finishKey: p.finishKey.trim() } : {}),
    }));
  if (rows.length === 0) return {};
  const parts: HardwareDesignPart[] = rows;
  validateHardwareDesignParts(parts);
  return { designParts: parts };
}

/**
 * #1453 F1: canonical bounding box — the three fields travel together or not
 * at all. Partial input throws (the modal catches it and nothing persists);
 * all-empty keeps the hardware deriving effective dims from preview*.
 */
function hardwareDimensionsField(
  draft: HardwareDraft,
): Pick<Hardware, 'dimensions'> {
  const w = draft.dimensionWidthMm.trim();
  const h = draft.dimensionHeightMm.trim();
  const d = draft.dimensionDepthMm.trim();
  const filled = [w, h, d].filter((v) => v !== '').length;
  if (filled === 0) return {};
  if (filled !== 3) {
    throw new Error('Las dimensiones W×H×D van completas o vacías — completá las tres o dejá las tres en blanco');
  }
  // parseDraftNum devuelve undefined ante basura; 0 cae en el guard > 0 con
  // el mismo mensaje (nunca un NaN hacia el servidor).
  const widthMm = parseDraftNum(w) ?? 0;
  const heightMm = parseDraftNum(h) ?? 0;
  const depthMm = parseDraftNum(d) ?? 0;
  if (!(widthMm > 0) || !(heightMm > 0) || !(depthMm > 0)) {
    throw new Error('Las dimensiones W×H×D deben ser mayores a 0 mm');
  }
  return { dimensions: { widthMm, heightMm, depthMm } };
}

type HardwareSlice = Pick<
  CatalogState,
  | 'createHardware'
  | 'updateHardware'
  | 'setHardwareActive'
  | 'createHardwareCategory'
  | 'updateHardwareCategory'
  | 'deleteHardwareCategory'
>;

/**
 * F127: machining footprint travels with the draft as structured data —
 * the modal already validated it with validateMachiningProfile on submit.
 * Empty/null profile keeps the hardware cost-only.
 */
function hardwareMachiningField(
  draft: HardwareDraft,
): Pick<Hardware, 'machining'> {
  return draft.machining && draft.machining.parts.length > 0
    ? { machining: draft.machining }
    : {};
}

export function createHardwareActions(ctx: CatalogStoreCtx): HardwareSlice {
  return {
    createHardware: (draft) => {
      const code = draft.code.trim();
      const pkg = Number(draft.packageSize);
      const packageSize =
        Number.isFinite(pkg) && pkg > 0 ? pkg : undefined;
      const item: Hardware = {
        id: ctx.newId(),
        code,
        name: draft.name.trim(),
        unit: draft.unit,
        costPerUnit: draft.costPerUnit,
        ...(packageSize === undefined ? {} : { packageSize }),
        imageUrl: draft.imageUrl?.trim() || undefined,
        notes: optionalNotes(draft.notes),
        active: true,
        categoryId: draft.categoryId || undefined,
        brand: draft.brand?.trim() || undefined,
        ...hardwarePreviewFields(draft),
        ...hardwareMachiningField(draft),
        ...(draft.visualAsset ? { visualAsset: draft.visualAsset } : {}),
        ...(draft.pieces ? { pieces: draft.pieces } : {}),
      };
      return ctx.saveAndToast(
        (c) => {
          const nextHardware = [...c.hardware, item];
          const newKitId = item.kitHardwareId;
          const nextAgregados = newKitId
            ? (c.agregados ?? []).map((a) => syncAgregadoForKit(a, newKitId, nextHardware))
            : c.agregados;
          return {
            ...c,
            hardware: nextHardware,
            ...(nextAgregados ? { agregados: nextAgregados } : {}),
          };
        },
        `✓ "${code}" creado`,
      );
    },

    updateHardware: (id, draft) => {
      const pkg = Number(draft.packageSize);
      const packageSize =
        Number.isFinite(pkg) && pkg > 0 ? pkg : undefined;
      return ctx.saveAndToast(
        (c) => {
          const prevTarget = c.hardware.find((h) => h.id === id);
          const nextHardware = c.hardware.map((h) => {
            if (h.id !== id) return h;
            const {
              packageSize: _drop,
              previewShape: _ds,
              previewColor: _dc,
              previewSizeMm: _dsm,
              previewDiameterMm: _ddm,
              previewProjectionMm: _dpm,
              previewRoughness: _dr,
              previewMetalness: _dm,
              previewClearcoat: _dcl,
              dimensions: _ddim,
              partFinishes: _dpf,
              machining: _dma,
              visualAsset: _dva,
              maxOpeningAngleDeg: _dmoa,
              designParts: _ddp,
              kitHardwareId: _dkid,
              categoryId: _dcat,
              brand: _dbrand,
              pieces: _dpieces,
              ...rest
            } = h;
            return {
              ...rest,
              code: draft.code.trim(),
              name: draft.name.trim(),
              unit: draft.unit,
              costPerUnit: draft.costPerUnit,
              ...(packageSize === undefined ? {} : { packageSize }),
              imageUrl: draft.imageUrl?.trim() || undefined,
              notes: optionalNotes(draft.notes),
              categoryId: draft.categoryId || undefined,
              brand: draft.brand?.trim() || undefined,
              ...hardwarePreviewFields(draft),
              ...hardwareMachiningField(draft),
              ...(draft.visualAsset ? { visualAsset: draft.visualAsset } : {}),
              ...(draft.pieces ? { pieces: draft.pieces } : {}),
            };
          });
          const affectedKitIds = new Set<string>();
          if (prevTarget?.kitHardwareId) affectedKitIds.add(prevTarget.kitHardwareId);
          if (draft.kitHardwareId) affectedKitIds.add(draft.kitHardwareId);
          // #1493: una receta con kits por variante puede recibir partes de
          // VARIOS kits afectados — el sync aditivo se aplica por cada kit que
          // declare; la receta legacy se espeja una sola vez (comportamiento
          // histórico intacto).
          const nextAgregados =
            affectedKitIds.size > 0
              ? (c.agregados ?? []).map((a) => {
                  let next = a;
                  if (a.commercialKitHardwareId && affectedKitIds.has(a.commercialKitHardwareId)) {
                    return syncAgregadoForKit(a, a.commercialKitHardwareId, nextHardware);
                  }
                  for (const kitId of affectedKitIds) {
                    if (agregadoDeclaresKitViaVariant(next, kitId)) {
                      next = ensureAgregadoKitParts(
                        next,
                        nextHardware.filter((h) => h.active && h.kitHardwareId === kitId),
                      );
                    }
                  }
                  return next;
                })
              : c.agregados;
          return {
            ...c,
            hardware: nextHardware,
            ...(nextAgregados ? { agregados: nextAgregados } : {}),
          };
        },
        '✓ Cambios guardados',
      );
    },

    setHardwareActive: (id, active) => {
      const target = ctx.get().catalog?.hardware.find((h) => h.id === id);
      return ctx.saveAndToast(
        (c) => ({
          ...c,
          hardware: c.hardware.map((h) => (h.id === id ? { ...h, active } : h)),
        }),
        target
          ? active
            ? `↑ "${target.name}" reactivado`
            : `↓ "${target.name}" desactivado`
          : null,
        'info',
      );
    },

    // #1507: subgrupos de herrajes — espejo de los actions de tableros (F142).
    createHardwareCategory: (draft) => {
      const item = {
        id: ctx.newId(),
        name: draft.name.trim(),
        parentId: draft.parentId.trim() || undefined,
        sortOrder: Number(draft.sortOrder) || 0,
      };
      ctx.saveAndToast(
        (c) => ({
          ...c,
          hardwareCategories: [...(c.hardwareCategories ?? []), item],
        }),
        `✓ Categoría "${item.name}" creada`,
      );
    },

    updateHardwareCategory: (id, draft) => {
      ctx.saveAndToast(
        (cat) => ({
          ...cat,
          hardwareCategories: (cat.hardwareCategories ?? []).map((c) =>
            c.id === id
              ? {
                  ...c,
                  name: draft.name.trim(),
                  parentId: draft.parentId.trim() || undefined,
                  sortOrder: Number(draft.sortOrder) || 0,
                }
              : c,
          ),
        }),
        'Categoría actualizada',
      );
    },

    deleteHardwareCategory: async (id) => {
      const cats = ctx.get().catalog?.hardwareCategories ?? [];
      const hasChildren = cats.some((c) => c.parentId === id);
      if (hasChildren) {
        ctx.toast({
          type: 'warning',
          message: 'No se puede eliminar: tiene subcategorías',
        });
        return;
      }
      const saved = await ctx.patchSaved((c) => ({
        ...c,
        hardwareCategories: (c.hardwareCategories ?? []).filter((cat) => cat.id !== id),
        hardware: (c.hardware ?? []).map((h) =>
          h.categoryId === id ? { ...h, categoryId: undefined } : h,
        ),
      }));
      if (!saved) return;
      const ok = await ctx.hardDeleteOnAuth(`/catalog/hardware-categories/${id}`);
      if (ok) {
        ctx.toast({ type: 'info', message: 'Categoría eliminada' });
      }
    },
  };
}
