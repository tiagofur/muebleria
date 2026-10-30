/**
 * Hardware kit wizard store action (#1416).
 *
 * Executes the pure domain plan (planHardwareKit) against REAL catalog state:
 * the UI preview is a courtesy, this re-derivation is what decides create vs
 * reuse. One saveAndToast adds every new hardware AND the agregado in a single
 * catalog mutation so state and persistence stay coherent (the repository's
 * upsert path POSTs hardware/agregados with client ids and the server keeps
 * validating recipes fail-closed — nothing here bypasses server authority).
 */

import type {
  Agregado,
  Hardware,
  HardwareKitCreateRequest,
  HardwareKitResult,
} from '@granete/domain';
import { planHardwareKit, type HardwareKitTemplate } from '@granete/domain';

import type { CatalogStoreCtx } from './shared';

export type HardwareKitSlice = {
  readonly createHardwareKit: (req: HardwareKitCreateRequest) => Promise<HardwareKitResult>;
};

const DESIGN_NOTES = (kitCode: string): string =>
  `Parte de diseño del juego ${kitCode}: se dibuja y abre, no cotiza por sí sola (#1416).`;

export function createHardwareKitActions(ctx: CatalogStoreCtx): HardwareKitSlice {
  return {
    createHardwareKit: async (req): Promise<HardwareKitResult> => {
      const catalog = ctx.get().catalog;
      if (!catalog) {
        throw new Error('El catálogo no está cargado.');
      }

      const hardwareList = catalog.hardware ?? [];
      const plan = planHardwareKit(req.input, {
        hardwareCodes: new Set(hardwareList.map((h) => h.code)),
        agregadoCodes: new Set((catalog.agregados ?? []).map((a) => a.code)),
      });
      if (plan.blockedCode) {
        throw new Error(
          `Ya existe un ensamble con el código «${plan.blockedCode}». Cambiá el código del ensamble para continuar.`,
        );
      }

      // Reuse resolves ids from the live catalog; new entries get fresh ids so
      // the recipe can reference them before anything is persisted. Ids are
      // decided EXACTLY ONCE per code (Map): a `?? ctx.newId()` inline would
      // mint a different id per call and leave the recipe referencing
      // hardware rows that were never created.
      const idByCode = new Map(hardwareList.map((h) => [h.code, h.id] as const));
      const idFor = (code: string): string => {
        const existingId = idByCode.get(code);
        if (existingId) return existingId;
        const fresh = ctx.newId();
        idByCode.set(code, fresh);
        return fresh;
      };
      // El id del kit se decide UNA vez antes de crear/vincular partes
      // (#1422 slice 1): el link de cada parte apunta aquí.
      const kitId = idFor(plan.kit.code);

      const createdCodes: string[] = [];
      const reusedCodes: string[] = [];
      const newHardware: Hardware[] = [];
      const updatedHardware: Hardware[] = [];

      if (plan.kit.exists) {
        reusedCodes.push(plan.kit.code);
      } else {
        newHardware.push({
          id: idFor(plan.kit.code),
          code: plan.kit.code,
          name: plan.kit.name,
          unit: 'set',
          costPerUnit: plan.kit.costPerUnit,
          active: true,
          notes: 'Juego comercial creado por el asistente de juego de herraje (#1416).',
        });
        createdCodes.push(plan.kit.code);
      }

      for (const design of plan.designs) {
        if (design.exists) {
          reusedCodes.push(design.code);
          // #1422 slice 1: un juego legacy (creado antes del link) se
          // vincula al RE-ejecutar el asistente — misma mutación, sin UI
          // extra. Solo si la parte aún no tiene kit.
          const existingPart = hardwareList.find((h) => h.code === design.code);
          if (existingPart && !existingPart.kitHardwareId) {
            updatedHardware.push({
              ...existingPart,
              kitHardwareId: kitId,
            });
          }
          continue;
        }
        const binding = req.designs?.[design.slot];
        newHardware.push({
          id: idFor(design.code),
          code: design.code,
          name: design.name,
          unit: 'piece',
          costPerUnit: 0,
          active: true,
          previewShape: 'slide',
          notes: DESIGN_NOTES(plan.kit.code),
          kitHardwareId: kitId,
          ...(binding ? { visualAsset: binding } : {}),
        });
        createdCodes.push(design.code);
      }

      const presentationMotion = presentationMotionFor(plan.agregado.motion, plan.agregado.depthMm);
      const agregado: Agregado = {
        id: ctx.newId(),
        code: plan.agregado.code,
        name: plan.agregado.name,
        active: true,
        externalDims: {
          width: plan.agregado.widthMm,
          height: plan.agregado.heightMm,
          depth: plan.agregado.depthMm,
        },
        // Motion por plantilla (#1422 slice 2): translate (cajón), rotate
        // (bisagra/puerta) o none (jaladera). Mapeo tipado sin casts; el
        // switch cubre la unión y el default (none) omite el campo
        // (#1424 rev; cálculo único — #1428 rev S5).
        commercialKitHardwareId: idFor(plan.kit.code),
        rigidMembers: plan.designs.map((design) => ({
          memberId: design.memberId,
          role: design.role,
          source: { kind: 'fixed', fixed: { hardwareId: idFor(design.code) } },
          placement: design.placement,
          bomRole: 'included_in_kit',
          actorMembership: design.membership,
        })),
      };

      await ctx.saveAndToast(
        (c) => ({
          ...c,
          hardware: [
            ...(c.hardware ?? []).map((h) => updatedHardware.find((u) => u.id === h.id) ?? h),
            ...newHardware,
          ],
          agregados: [...(c.agregados ?? []), agregado],
        }),
        `✓ Juego «${plan.kit.code}» creado`,
      );

      return {
        createdCodes,
        reusedCodes,
        agregadoCode: agregado.code,
        agregadoId: agregado.id,
      };
    },
  };
}

/**
 * #1422 slice 2 (#1424 rev): motion de la plantilla → presentationMotion del
 * agregado, con la MISMA convención del editor (agregadoDraft.draftToAgregado).
 * Tipo de retorno sin casts — el shape lo verifica tsc.
 */
function presentationMotionFor(
  motion: HardwareKitTemplate['motion'],
  depthMm: number,
): Agregado['presentationMotion'] {
  switch (motion) {
    case 'translate':
      return {
        kind: 'translate',
        axis: { x: 0, y: 1, z: 0 },
        distanceMm: Math.round(depthMm * 0.8),
      };
    case 'rotate_left':
      return {
        kind: 'rotate',
        pivot: 'left',
        axis: { x: 0, y: 0, z: 1 },
        openAngleDeg: 110,
      };
    case 'rotate_right':
      return {
        kind: 'rotate',
        pivot: 'right',
        axis: { x: 0, y: 0, z: -1 },
        openAngleDeg: 110,
      };
    default:
      return undefined;
  }
}
