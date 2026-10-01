/**
 * String-typed draft model for the hardware profile form (#914): the form
 * owns strings; conversion to the #912 contract happens at submit time.
 */

export interface HardwareProfileItemDraft {
  readonly hardwareId: string;
  readonly quantity: string;
  readonly applicationRole: string;
}

export interface HardwareProfileDraft {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly revision: string;
  readonly items: readonly HardwareProfileItemDraft[];
}

export function emptyProfileDraft(): HardwareProfileDraft {
  return {
    code: '',
    name: '',
    description: '',
    revision: 'rev-1',
    items: [],
  };
}

export function emptyProfileItemDraft(): HardwareProfileItemDraft {
  return { hardwareId: '', quantity: '1', applicationRole: '' };
}

export interface HardwareProfileRowItemLike {
  readonly hardwareId: string;
  readonly quantity: number;
  readonly applicationRole: string;
}

export interface HardwareProfileRowLike {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly revision: string;
  readonly items: readonly HardwareProfileRowItemLike[];
}

/** Edit-draft conversion from a listed profile row (items included). */
export function toProfileDraft(row: HardwareProfileRowLike): HardwareProfileDraft {
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    revision: row.revision,
    items: row.items.map((item) => ({
      hardwareId: item.hardwareId,
      quantity: String(item.quantity),
      applicationRole: item.applicationRole,
    })),
  };
}
