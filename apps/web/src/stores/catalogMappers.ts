/**
 * Pure draft → entity mappers for catalogStore (F062).
 *
 * Extracted from App.tsx so the store owns catalog mutations and App.tsx
 * becomes a thin shell. All functions are pure — no IO, no React.
 */

import type {
  Component,
  Customer,
  Module,
  Structure,
} from '@granete/domain';
import type { ComponentPlacement } from '@granete/domain';
import {
  draftToModule as draftToModuleFromUi,
  edgesFromFlags,
  type ComponentDraft,
  type ModuleDraft,
  type StructureDraft,
} from '@granete/ui';

function optionalNotes(notes: string): string | undefined {
  const trimmed = notes.trim();
  return trimmed ? trimmed : undefined;
}

/** Re-export domain mapper from UI helpers (single source of truth). */
export function draftToModule(id: string, draft: ModuleDraft): Module {
  return draftToModuleFromUi(id, draft);
}

export function draftToStructure(id: string, draft: StructureDraft): Structure {
  const w = draft.widthMm;
  const h = draft.heightMm;
  const d = draft.depthMm;
  const hasDims = w > 0 || h > 0 || d > 0;
  return {
    id,
    code: draft.code.trim(),
    name: draft.name.trim(),
    notes: optionalNotes(draft.notes),
    active: draft.active !== false,
    externalDims: hasDims ? { width: w, height: h, depth: d } : undefined,
    presets: draft.presets && draft.presets.length > 0 ? draft.presets.map((pr) => ({
      id: pr.id,
      name: pr.name?.trim() || undefined,
      width: pr.width,
      height: pr.height,
      depth: pr.depth,
    })) : undefined,
    components: draft.components.length > 0
      ? draft.components.map((c) => ({
          componentId: c.componentId,
          quantity: c.quantity,
          placementOverride: c.placementOverride
            ? (c.placementOverride as ComponentPlacement)
            : undefined,
          // Per-instance spatial/formula overrides (structure_components.overrides).
          overrides: c.overrides,
        }))
      : undefined,
    agregados: draft.agregados && draft.agregados.length > 0
      ? draft.agregados.map((a) => ({
          id: a.id,
          agregadoId: a.agregadoId,
          name: a.name?.trim() || undefined,
          position: a.position ? { ...a.position } : undefined,
          dimensions: a.dimensions ? { ...a.dimensions } : undefined,
          quantity: a.quantity,
          layoutDirection: a.layoutDirection,
          gapMm: a.gapMm,
          mirrored: a.mirrored,
          optionOverrides: a.optionOverrides ? { ...a.optionOverrides } : undefined,
        }))
      : undefined,
  };
}

export function draftToComponent(id: string, draft: ComponentDraft): Component {
  return {
    id,
    code: draft.code.trim(),
    name: draft.name.trim(),
    placement: draft.placement as Component['placement'],
    geometry: {
      kind: 'rectangular_board',
      lengthMm: draft.lengthMm,
      widthMm: draft.widthMm,
      thicknessMm: draft.thicknessMm,
      lengthFormula: draft.lengthFormula.trim() || undefined,
      widthFormula: draft.widthFormula.trim() || undefined,
    },
    defaultEdges: edgesFromFlags(draft.edgeL1, draft.edgeL2, draft.edgeW1, draft.edgeW2),
    // Preserve perforations round-tripped via draft (no CNC editor yet — C2).
    perforations:
      draft.perforations && draft.perforations.length > 0
        ? draft.perforations
        : undefined,
    optionRoles: draft.optionRoles.split(',').map((s) => s.trim()).filter(Boolean),
    notes: optionalNotes(draft.notes),
    active: draft.active !== false,
    xFormula: draft.xFormula.trim() || undefined,
    yFormula: draft.yFormula.trim() || undefined,
    zFormula: draft.zFormula.trim() || undefined,
    // null = placement default; 0 is a valid explicit rotation
    rotateX: draft.rotateX ?? undefined,
    rotateY: draft.rotateY ?? undefined,
    rotateZ: draft.rotateZ ?? undefined,
  };
}

/**
 * Build a minimal Customer from a name (used by `createCustomer` action).
 * Caller resolves `ownerUserId` via `resolveOwnerOnCreate` before calling.
 */
export function buildCustomer(
  id: string,
  params: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    notes?: string;
    ownerUserId?: string;
  },
): Customer {
  const trimmedEmail = params.email?.trim();
  const trimmedPhone = params.phone?.trim();
  const trimmedAddress = params.address?.trim();
  const trimmedNotes = params.notes?.trim();
  return {
    id,
    name: params.name.trim(),
    email: trimmedEmail ? trimmedEmail : undefined,
    phone: trimmedPhone ? trimmedPhone : undefined,
    address: trimmedAddress ? trimmedAddress : undefined,
    notes: trimmedNotes ? trimmedNotes : undefined,
    ownerUserId: params.ownerUserId,
    active: true,
  };
}
