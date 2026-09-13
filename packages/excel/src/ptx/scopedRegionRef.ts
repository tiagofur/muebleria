/** Job-wide identity for a region whose regionId is only local to one sheet. */
export interface ScopedRegionRef {
  readonly sheetIndex: number;
  readonly regionId: string;
}

/** Stable in-memory lookup key. Never serialized as a replacement for regionId. */
export function scopedRegionKey(ref: ScopedRegionRef): string {
  return `${ref.sheetIndex}\u0000${ref.regionId}`;
}
