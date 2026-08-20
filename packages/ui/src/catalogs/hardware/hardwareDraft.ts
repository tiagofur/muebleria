/**
 * Hardware draft model (string-typed form fields) shared by the hardware
 * screen and its form modal.
 */

import type { Hardware, HardwareUnit } from '@muebles/domain';

export const UNIT_LABELS: Record<HardwareUnit, string> = {
  piece: 'Pieza',
  set: 'Juego',
  meter: 'Metro',
};

export type HardwareDraft = {
  code: string;
  name: string;
  unit: HardwareUnit;
  costPerUnit: number;
  /**
   * Package size in the same unit (e.g. 4 for 4 m bars when unit is meter).
   * Empty string = no packaging.
   */
  packageSize: string;
  /** Relative media path (F040/F042). */
  imageUrl: string;
  notes: string;
  // --- F069: 3D preview fields ---
  previewShape: string;
  previewColor: string;
  previewSizeMm: string;
  previewDiameterMm: string;
  previewProjectionMm: string;
  previewRoughness: string;
  previewMetalness: string;
  previewClearcoat: string;
  /**
   * F080: per-part finish preset ids ('' = inherit the global finish).
   */
  partFinishes: { body: string; base: string; grip: string };
};

export const emptyPartFinishes = (): { body: string; base: string; grip: string } => ({
  body: '',
  base: '',
  grip: '',
});

export const emptyDraft = (): HardwareDraft => ({
  code: '',
  name: '',
  unit: 'piece',
  costPerUnit: 0,
  packageSize: '',
  imageUrl: '',
  notes: '',
  previewShape: '',
  previewColor: '',
  previewSizeMm: '',
  previewDiameterMm: '',
  previewProjectionMm: '',
  previewRoughness: '',
  previewMetalness: '',
  previewClearcoat: '',
  partFinishes: emptyPartFinishes(),
});

export function toDraft(item: Hardware): HardwareDraft {
  return {
    code: item.code,
    name: item.name,
    unit: item.unit,
    costPerUnit: item.costPerUnit,
    packageSize:
      item.packageSize !== undefined ? String(item.packageSize) : '',
    imageUrl: item.imageUrl ?? '',
    notes: item.notes ?? '',
    previewShape: item.previewShape ?? '',
    previewColor: item.previewColor ?? '',
    previewSizeMm: item.previewSizeMm !== undefined ? String(item.previewSizeMm) : '',
    previewDiameterMm: item.previewDiameterMm !== undefined ? String(item.previewDiameterMm) : '',
    previewProjectionMm: item.previewProjectionMm !== undefined ? String(item.previewProjectionMm) : '',
    previewRoughness: item.previewRoughness !== undefined ? String(item.previewRoughness) : '',
    previewMetalness: item.previewMetalness !== undefined ? String(item.previewMetalness) : '',
    previewClearcoat: item.previewClearcoat !== undefined ? String(item.previewClearcoat) : '',
    partFinishes: {
      body: item.partFinishes?.body ?? '',
      base: item.partFinishes?.base ?? '',
      grip: item.partFinishes?.grip ?? '',
    },
  };
}
