/**
 * Import nesting software results (pliegos reales) — #142.
 * CSV: material_code,sheets_used[,area_m2]
 */

export type NestingImportRow = {
  readonly materialCode: string;
  readonly sheetsUsed: number;
  readonly areaM2?: number;
};

export type NestingImportResult = {
  readonly importedAt: string;
  readonly sourceName?: string;
  readonly rows: readonly NestingImportRow[];
};

/**
 * Parse a simple CSV from external nesting tools.
 * Header optional. Columns: material_code | sheets_used | area_m2 (optional).
 */
export function parseNestingImportCsv(text: string): NestingImportRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  let start = 0;
  const header = lines[0]!.toLowerCase();
  if (header.includes('material') || header.includes('pliego') || header.includes('sheet')) {
    start = 1;
  }

  const rows: NestingImportRow[] = [];
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i]!.split(/[,;\t]/).map((p) => p.trim().replace(/^"|"$/g, ''));
    if (parts.length < 2) continue;
    const materialCode = parts[0]!;
    const sheetsUsed = Number(parts[1]);
    if (!materialCode || !Number.isFinite(sheetsUsed) || sheetsUsed < 0) continue;
    const areaM2 =
      parts[2] !== undefined && parts[2] !== ''
        ? Number(parts[2])
        : undefined;
    rows.push({
      materialCode,
      sheetsUsed: Math.floor(sheetsUsed),
      areaM2:
        areaM2 !== undefined && Number.isFinite(areaM2) && areaM2 >= 0
          ? areaM2
          : undefined,
    });
  }
  return rows;
}

export function nestingImportFromRows(
  rows: readonly NestingImportRow[],
  nowIso: string,
  sourceName?: string,
): NestingImportResult {
  return {
    importedAt: nowIso,
    sourceName,
    rows: [...rows],
  };
}
