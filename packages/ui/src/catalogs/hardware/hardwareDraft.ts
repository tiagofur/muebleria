/**
 * Hardware draft model (string-typed form fields) shared by the hardware
 * screen and its form modal.
 */

import {
  DEFAULT_HINGE_DEMAND_POLICY,
  type Hardware,
  type HingeDemandPolicy,
  type HardwareMachiningProfile,
  type HardwarePiece,
  type HardwareUnit,
  type HardwareVisualAssetBinding,
} from '@granete/domain';

export const UNIT_LABELS: Record<HardwareUnit, string> = {
  piece: 'Pieza',
  set: 'Juego',
  meter: 'Metro',
};

/**
 * #1579: una fila de la tabla «bisagras por altura de puerta» — el alto
 * máximo de la banda y cuántas bisagras lleva la puerta. Texto, como el
 * resto del form.
 */
export type HingeBandsDraftRow = {
  upToHeightMm: string;
  hinges: string;
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
  /**
   * #1453 F1: canonical bounding box W×H×D (mm). All three set (and > 0) =
   * complete dimensions; all three empty = none. Partial states are a form
   * error caught on submit. Fields can be suggested from the bound 3D design
   * («Cargar del diseño») and stay editable — the manual value wins.
   */
  dimensionWidthMm: string;
  dimensionHeightMm: string;
  dimensionDepthMm: string;
  previewRoughness: string;
  previewMetalness: string;
  previewClearcoat: string;
  /**
   * F080: per-part finish preset ids ('' = inherit the global finish).
   */
  partFinishes: { body: string; base: string; grip: string };
  /**
   * F127: CNC machining footprint (structured — validated with
   * validateMachiningProfile on submit). Null = cost-only hardware.
   */
  machining: HardwareMachiningProfile | null;
  /**
   * #667 M1/M2: Exact versioned 3D asset revision bound to this hardware.
   * Null = no exact model associated (generic procedural preview).
   */
  visualAsset: HardwareVisualAssetBinding | null;
  /**
   * Maximum physical opening angle in degrees for kinematic hardware (e.g. 110, 95).
   * Empty string or undefined = not specified / not rotational.
   */
  maxOpeningAngleDeg?: string;
  /**
   * #1417: partes internas del SKP pineado por nombre de componente. Cada
   * fila es la forma de form (strings); la validación estricta corre en el
   * dominio al armar el payload.
   */
  designParts?: { componentName: string; actorMembership: string; label: string; finishKey: string }[];
  /**
   * #1422 slice 1: kit al que pertenece esta parte de diseño (solo lectura
   * en el form — lo escribe el asistente; el payload lo repite para que
   * editar una parte NO borre su link).
   */
  kitHardwareId?: string;
  /**
   * #1518 F1 (was #1512 hands): piezas del herraje multi-diseño (asset y
   * offsets por ancla). Ausente = simétrico/legacy. Estructura idéntica al
   * dominio (binding completo con facts; el write persiste identifiers).
   */
  pieces?: readonly HardwarePiece[];
  /**
   * #1507: subgrupo del catálogo de herrajes ('' = sin categoría). El select
   * lista el árbol `hardwareCategories` de la org.
   */
  categoryId?: string;
  /** #1507: marca/serie en texto libre ('' = sin marca). */
  brand?: string;
  /**
   * #1596: tipo de ítem del alta — sólo forma (qué secciones muestra el
   * modal); los registros persistidos son los mismos que el motor consume.
   * Al editar se infiere de los datos (pieces I/D → par; juego → kit).
   */
  itemType?: HardwareItemType;
  /** #1596 alcance 3: juego al que el inserto queda añadido como opción. */
  insertoKitId?: string;
  /** #1596: nombre del selector si hay que crearlo (vacío = «Insertos de <kit>»). */
  insertoSelectorName?: string;
  /**
   * #1596 (review B2): identidad del inserto decidida UNA vez y reutilizada
   * en reintentos — si la persistencia a mitad dejó el herraje en el
   * servidor, el reintento con el MISMO id converge (GET 200 → PUT) en vez
   * de crear un duplicado con 409 en bucle.
   */
  insertoPendingId?: string;
  /**
   * #1579: filas de la tabla «bisagras por altura de puerta» que este
   * herraje declara para sí. Sin filas = sin tabla: la puerta que lo elige
   * usa la política de fábrica y luego la escalera de librería. La
   * validación estricta corre al enviar; `hingeDemandFromDraft` arma el dato.
   */
  hingeDemandRows?: HingeBandsDraftRow[];
  /**
   * #1579: umbral del recargo por ancho (+1 bisagra si la puerta es más
   * ancha). Vacío = heredar la regla de librería (650 mm); «0» = sin recargo.
   */
  hingeDemandWidthSurgeMm?: string;
};

/** #1596: los cuatro tipos de ítem del alta (decisión 1). */
export type HardwareItemType = 'piece' | 'pair' | 'kit' | 'inserto';

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
  dimensionWidthMm: '',
  dimensionHeightMm: '',
  dimensionDepthMm: '',
  previewRoughness: '',
  previewMetalness: '',
  previewClearcoat: '',
  partFinishes: emptyPartFinishes(),
  machining: null,
  visualAsset: null,
  maxOpeningAngleDeg: '',
  designParts: [],
  categoryId: '',
  brand: '',
  hingeDemandRows: [],
  hingeDemandWidthSurgeMm: '',
});

/**
 * #1579: la escalera de librería como filas de formulario — la sugerencia
 * (Blum · Hettich · Salice) que el taller edita al crear una bisagra.
 */
export const suggestedHingeDemandRows = (): HingeBandsDraftRow[] =>
  DEFAULT_HINGE_DEMAND_POLICY.bands.map((band) => ({
    upToHeightMm: String(band.upToHeightMm),
    hinges: String(band.hinges),
  }));

/** null y 0 significan «sin recargo por ancho»; undefined, heredar el de librería. */
function widthSurgeToDraft(value: number | null | undefined): string {
  if (value === undefined) return '';
  return String(value ?? 0);
}

/**
 * #1579: la tabla como dato de dominio, o undefined si el form no declara
 * filas. NO valida: convierte los valores tal cual y la validación estricta
 * (`validateHingeDemandTable`) decide si son usables.
 */
export function hingeDemandFromDraft(
  draft: Pick<HardwareDraft, 'hingeDemandRows' | 'hingeDemandWidthSurgeMm'>,
): HingeDemandPolicy | undefined {
  const rows = draft.hingeDemandRows ?? [];
  if (rows.length === 0) return undefined;
  const surge = draft.hingeDemandWidthSurgeMm?.trim() ?? '';
  return {
    bands: rows.map((row) => ({
      upToHeightMm: Number(row.upToHeightMm),
      hinges: Number(row.hinges),
    })),
    ...(surge === '' ? {} : { widthSurgeOverMm: Number(surge) }),
  };
}

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
    dimensionWidthMm: item.dimensions !== undefined ? String(item.dimensions.widthMm) : '',
    dimensionHeightMm: item.dimensions !== undefined ? String(item.dimensions.heightMm) : '',
    dimensionDepthMm: item.dimensions !== undefined ? String(item.dimensions.depthMm) : '',
    previewRoughness: item.previewRoughness !== undefined ? String(item.previewRoughness) : '',
    previewMetalness: item.previewMetalness !== undefined ? String(item.previewMetalness) : '',
    previewClearcoat: item.previewClearcoat !== undefined ? String(item.previewClearcoat) : '',
    partFinishes: {
      body: item.partFinishes?.body ?? '',
      base: item.partFinishes?.base ?? '',
      grip: item.partFinishes?.grip ?? '',
    },
    machining: item.machining ?? null,
    visualAsset: item.visualAsset ? { ...item.visualAsset } : null,
    maxOpeningAngleDeg: item.maxOpeningAngleDeg !== undefined ? String(item.maxOpeningAngleDeg) : '',
    designParts: (item.designParts ?? []).map((p) => ({
      componentName: p.componentName,
      actorMembership: p.actorMembership,
      label: p.label ?? '',
      finishKey: p.finishKey ?? '',
    })),
    kitHardwareId: item.kitHardwareId,
    ...(item.pieces ? { pieces: item.pieces } : {}),
    categoryId: item.categoryId ?? '',
    brand: item.brand ?? '',
    hingeDemandRows: (item.hingeDemand?.bands ?? []).map((band) => ({
      upToHeightMm: String(band.upToHeightMm),
      hinges: String(band.hinges),
    })),
    hingeDemandWidthSurgeMm: widthSurgeToDraft(item.hingeDemand?.widthSurgeOverMm),
    itemType: inferHardwareItemType(item),
  };
}

/**
 * #1596: el tipo se INFiERE de los datos al editar — sin migración (un par
 * creado con «Piezas de diseño» abre en el alta nueva como par). El alta de
 * inserto edita como 'pair' (misma forma; el vínculo al selector ya vive en
 * el grupo del juego y no en el herraje).
 */
export function inferHardwareItemType(
  item: Pick<Hardware, 'unit' | 'pieces' | 'kitHardwareId'>,
): HardwareItemType {
  if (item.unit === 'set' || item.kitHardwareId) return 'kit';
  if (item.pieces && item.pieces.length > 0) return 'pair';
  return 'piece';
}
