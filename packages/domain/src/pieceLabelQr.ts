/**
 * Compact QR payload for workshop piece labels (#141).
 * Offline-friendly JSON (not a URL) for scanner apps / future deep links.
 */

export type PieceLabelQrFields = {
  readonly projectId: string;
  readonly moduleCode: string;
  readonly partCode?: string;
  readonly description: string;
  readonly materialCode: string;
  readonly lengthMm: number;
  readonly widthMm: number;
};

/** Versioned payload string for QR encoding. */
export function pieceLabelQrPayload(fields: PieceLabelQrFields): string {
  return JSON.stringify({
    v: 1,
    projectId: fields.projectId,
    module: fields.moduleCode,
    part: fields.partCode ?? '',
    desc: fields.description.slice(0, 80),
    material: fields.materialCode,
    L: fields.lengthMm,
    W: fields.widthMm,
  });
}
