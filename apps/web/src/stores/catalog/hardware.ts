/**
 * catalog/hardware — Hardware mutations incl. 3D preview fields (F069/F080).
 */

import { normalizeHardwarePartFinishes } from '@muebles/domain';
import type { Hardware } from '@muebles/domain';
import type { HardwareDraft } from '@muebles/ui';

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
  };
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
      const item = {
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
      };
      ctx.saveAndToast(
        (c) => ({ ...c, hardware: [...c.hardware, item] }),
        `✓ "${code}" creado`,
      );
    },

    updateHardware: (id, draft) => {
      const pkg = Number(draft.packageSize);
      const packageSize =
        Number.isFinite(pkg) && pkg > 0 ? pkg : undefined;
      ctx.saveAndToast(
        (c) => ({
          ...c,
          hardware: c.hardware.map((h) => {
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
              partFinishes: _dpf,
              machining: _dma,
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
            };
          }),
        }),
        '✓ Cambios guardados',
      );
    },

    setHardwareActive: (id, active) => {
      const target = ctx.get().catalog?.hardware.find((h) => h.id === id);
      ctx.saveAndToast(
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
