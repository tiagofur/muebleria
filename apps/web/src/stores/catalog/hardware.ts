/**
 * catalog/hardware — Hardware mutations incl. 3D preview fields (F069/F080).
 */

import {
  normalizeHardwarePartFinishes,
  syncAgregadoWithKitParts,
  validateHardwareDesignParts,
  type HardwareDesignPart,
} from '@granete/domain';
import type { Hardware } from '@granete/domain';
import type { HardwareDraft } from '@granete/ui';

import type { CatalogState, CatalogStoreCtx } from './shared';
import { optionalNotes, parseDraftNum } from './shared';

const HARDWARE_SHAPES = ['knob', 'bar-pull', 'cup-pull', 'hinge', 'slide', 'rail', 'leg'];

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
  'createHardware' | 'updateHardware' | 'setHardwareActive'
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
        ...hardwarePreviewFields(draft),
        ...hardwareMachiningField(draft),
        ...(draft.visualAsset ? { visualAsset: draft.visualAsset } : {}),
      };
      return ctx.saveAndToast(
        (c) => {
          const nextHardware = [...c.hardware, item];
          const nextAgregados = item.kitHardwareId
            ? (c.agregados ?? []).map((a) =>
                a.commercialKitHardwareId === item.kitHardwareId
                  ? syncAgregadoWithKitParts(
                      a,
                      nextHardware.filter((h) => h.active && h.kitHardwareId === item.kitHardwareId),
                    )
                  : a,
              )
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
              ...hardwarePreviewFields(draft),
              ...hardwareMachiningField(draft),
              ...(draft.visualAsset ? { visualAsset: draft.visualAsset } : {}),
            };
          });
          const affectedKitIds = new Set<string>();
          if (prevTarget?.kitHardwareId) affectedKitIds.add(prevTarget.kitHardwareId);
          if (draft.kitHardwareId) affectedKitIds.add(draft.kitHardwareId);
          const nextAgregados =
            affectedKitIds.size > 0
              ? (c.agregados ?? []).map((a) =>
                  a.commercialKitHardwareId && affectedKitIds.has(a.commercialKitHardwareId)
                    ? syncAgregadoWithKitParts(
                        a,
                        nextHardware.filter(
                          (h) => h.active && h.kitHardwareId === a.commercialKitHardwareId,
                        ),
                      )
                    : a,
                )
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
  };
}
