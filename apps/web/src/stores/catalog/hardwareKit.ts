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
  AgregadoRigidMember,
  Hardware,
  HardwarePiece,
  HardwareKitCreateRequest,
  HardwareKitResult,
  HardwareVisualAssetBinding,
} from '@granete/domain';
import {
  HARDWARE_KIT_SYSTEM_HEIGHTS,
  KIT_TEMPLATE_DRAWER_HANDS_ID,
  planHardwareKit,
  planHardwareKitSystem,
  type HardwareKitSystemCreateRequest,
  type HardwareKitSystemEligibilityRequest,
  type HardwareKitTemplate,
  type OptionGroup,
} from '@granete/domain';

import type { CatalogStoreCtx, AddSystemHeightRequest } from './shared';
import type { Catalog } from '@granete/domain';

export type HardwareKitSlice = {
  readonly createHardwareKit: (req: HardwareKitCreateRequest) => Promise<HardwareKitResult>;
  /** #1546 M4: sistema generador — kits por altura + accesorios del E + agregado con variantes. */
  readonly createHardwareKitSystem: (req: HardwareKitSystemCreateRequest) => Promise<HardwareKitResult>;
  /** #1596 alcance 10: añadir una altura faltante a un sistema ya creado. */
  readonly addSystemHeight: (req: AddSystemHeightRequest) => Promise<{ readonly kitCode: string; readonly agregadoCode: string }>;
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
      // #1422 slice 2: las plantillas del taller participan de la
      // re-derivación — el plan NUNCA confía en el preview del cliente; una
      // plantilla custom inválida falla cerrado aquí igual que en la UI.
      const plan = planHardwareKit(
        req.input,
        {
          hardwareCodes: new Set(hardwareList.map((h) => h.code)),
          agregadoCodes: new Set((catalog.agregados ?? []).map((a) => a.code)),
        },
        ctx.get().kitTemplates,
      );
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
          notes: 'Juego comercial creado por el asistente de juego de herraje.',
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
        // #1518 F1 (was #1512 S2b hands): un grupo multi-diseño crea UNA
        // fila con pieces — el SKP de cada slot del grupo se vincula como la
        // pieza de ese ancla. El ancla sin upload queda sin asset: cae al
        // visualAsset global (box preview hasta subir el SKP, honesto).
        if (design.handsParts) {
          const pieces: HardwarePiece[] = design.handsParts
            .map((part) => {
              const binding = req.designs?.[part.slot];
              return binding ? ({ anchor: part.hand, asset: binding } as HardwarePiece) : null;
            })
            .filter((pc): pc is HardwarePiece => pc !== null);
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
            ...(pieces.length > 0 ? { pieces } : {}),
          });
          createdCodes.push(design.code);
          continue;
        }
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
        // Motion por plantilla (#1422 slice 2): translate (cajón), rotate
        // (bisagra/puerta) o ausente (jaladera). Mapeo tipado sin casts;
        // cálculo único (#1428 rev S5) — el E2E del wizard lo assertiona
        // (presentation_motion {kind: translate} en el readback).
        ...(presentationMotion ? { presentationMotion } : {}),
        rigidMembers: plan.designs.flatMap((design): AgregadoRigidMember[] => {
          // #1512 S2b: un grupo multi-diseño genera un MIEMBRO POR MANO —
          // todos apuntando a la fila compartida; la ref X va vacía y el
          // default por mano (EffectivePlacement) deriva el anclaje.
          if (design.handsParts) {
            const sharedId = idFor(design.code);
            return design.handsParts.map((part) => ({
              memberId: part.memberId,
              role: part.role,
              source: { kind: 'fixed' as const, fixed: { hardwareId: sharedId } },
              placement: {
                x: { offsetMm: part.offsetMm },
                y: { ref: 'min' as const, offsetMm: 0 },
                z: { ref: 'min' as const, offsetMm: 0 },
              },
              bomRole: 'included_in_kit' as const,
              actorMembership: part.membership,
              hand: part.hand,
            }));
          }
          return [
            {
              memberId: design.memberId,
              role: design.role,
              source: { kind: 'fixed', fixed: { hardwareId: idFor(design.code) } },
              placement: design.placement,
              bomRole: 'included_in_kit',
              actorMembership: design.membership,
            },
          ];
        }),
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

    // #1546 M4 + #1553: sistema generador — ejecuta el plan del sistema: un
    // kit multi-diseño por altura, herrajes accesorios del E con piezas por
    // ancla, grupo de accesorios vinculado al kit E y UN agregado con
    // variantes de altura cuya receta NO lleva miembros de kit fijos (el
    // sync por bahía materializa las partes del kit efectivo — paridad #1493).
    //
    // Con sesión, la aplicación es SERVER-SIDE (#1553): el plan materializado
    // viaja al endpoint transaccional y el servidor lo aplica en UNA
    // transacción (409 tipado con los códigos en conflicto, rollback total
    // ante cualquier falla); el estado local se hace con los códigos y los
    // ids de variant set que el SERVIDOR confirma. En guest (sin backend)
    // queda el camino local de una sola mutación — mismo modelado, sin
    // transacción multi-entidad.
    createHardwareKitSystem: async (req): Promise<HardwareKitResult> => {
      const catalog = ctx.get().catalog;
      if (!catalog) {
        throw new Error('El catálogo no está cargado.');
      }
      const hardwareList = catalog.hardware ?? [];
      const existing = {
        hardwareCodes: new Set(hardwareList.map((h) => h.code)),
        agregadoCodes: new Set((catalog.agregados ?? []).map((a) => a.code)),
      };
      const plan = planHardwareKitSystem(req.input, existing);
      if (plan.blockedCode) {
        throw new Error(
          `Ya existe un ensamble con el código «${plan.blockedCode}». Cambiá el código del sistema para continuar.`,
        );
      }

      const idByCode = new Map(hardwareList.map((h) => [h.code, h.id] as const));
      const idFor = (code: string): string => {
        const existingId = idByCode.get(code);
        if (existingId) return existingId;
        const fresh = ctx.newId();
        idByCode.set(code, fresh);
        return fresh;
      };

      const createdCodes: string[] = [];
      const reusedCodes: string[] = [];
      const newHardware: Hardware[] = [];
      const systemKitIds = new Map<string, string>(); // heightCode → kit id

      // 1. Kit multi-diseño por altura (FIJ/MOV con pieces por ancla).
      for (const kit of plan.kits) {
        const kitId = idFor(kit.code);
        systemKitIds.set(kit.heightCode, kitId);
        if (kit.exists) {
          reusedCodes.push(kit.code);
        } else {
          newHardware.push({
            id: kitId,
            code: kit.code,
            name: kit.name,
            unit: 'set',
            costPerUnit: req.input.kitCostPerUnit,
            active: true,
            notes: `Juego ${kit.heightCode} del sistema ${req.input.code.trim()} (M4).`,
          });
          createdCodes.push(kit.code);
        }
        // Filas multi-diseño del kit (FIJ/MOV): pieces desde los uploads.
        for (const design of kit.designs) {
          if (!design.handsParts) continue;
          if (design.exists) {
            reusedCodes.push(design.code);
            continue;
          }
          const pieces = design.handsParts
            .map((part) => {
              const binding = req.designs?.[`${kit.code}:${part.hand}:${design.code}`];
              return binding ? ({ anchor: part.hand, asset: binding } as HardwarePiece) : null;
            })
            .filter((pc): pc is HardwarePiece => pc !== null);
          newHardware.push({
            id: idFor(design.code),
            code: design.code,
            name: design.name,
            unit: 'piece',
            costPerUnit: 0,
            active: true,
            previewShape: 'slide',
            notes: DESIGN_NOTES(kit.code),
            kitHardwareId: kitId,
            ...(pieces.length > 0 ? { pieces } : {}),
          });
          createdCodes.push(design.code);
        }
      }

      // 2. Herrajes accesorios del E con piezas por ancla (F1). #1596: el
      // accesorio SIEMPRE declara sus piezas por ancla (con o sin SKP — el
      // lado queda con diseño pendiente, nunca invisible) con offsets
      // EXPLÍCITOS (decisión 2: dibuja en 0,0,0 y posiciona por offset) y la
      // declaración de movimiento que el motor ya lee (decisión 4: «Al
      // abrir» = actor:drawer por defecto, nunca inferido del nombre).
      const accessoryIds: string[] = [];
      for (const acc of plan.accessories) {
        const accId = idFor(acc.code);
        accessoryIds.push(accId);
        if (acc.exists) {
          reusedCodes.push(acc.code);
          continue;
        }
        const pieces = acc.anchors.map((anchor) => {
          const binding = req.designs?.[`${acc.code}:${anchor}`];
          const offset = acc.pieceOffsets?.[anchor] ?? { x: 0, y: 0, z: 0 };
          return {
            anchor,
            ...(binding ? { asset: binding } : {}),
            offsetMm: { x: offset.x, y: offset.y, z: offset.z },
          } as HardwarePiece;
        });
        const actorMembership = acc.actorMembership ?? 'actor:drawer';
        newHardware.push({
          id: accId,
          code: acc.code,
          name: acc.name,
          unit: 'piece',
          costPerUnit: 0,
          active: true,
          notes: `Accesorio del cajón E del sistema ${req.input.code.trim()} (#1519): se elige por mueble y el motor lo monta por cajón.`,
          pieces,
          designParts: [
            { componentName: acc.code, actorMembership, label: '', finishKey: '' },
          ],
        });
        createdCodes.push(acc.code);
      }

      // 3. Grupo de accesorios del kit E (#1519).
      // 4. UN agregado con variantes de altura — receta SIN miembros de kit
      // fijos: el sync por bahía (syncAgregadoRigidMembersFromCatalog con el
      // kit efectivo) materializa las partes de la altura elegida (#1493).
      const presentationMotion = presentationMotionFor(plan.agregado.motion, plan.agregado.depthMm);
      const baseKit = plan.kits[0]!;
      const variantSetId = ctx.newId(); // server-assigned en sesión; local en guest (#1553)
      const agregado: Agregado = {
        id: ctx.newId(),
        code: plan.agregado.code,
        name: plan.agregado.name,
        active: true,
        externalDims: {
          width: plan.agregado.widthMm,
          height: Math.max(...plan.agregado.variants.map((v) => v.khMinMm)),
          depth: plan.agregado.depthMm,
        },
        commercialKitHardwareId: idFor(baseKit.code),
        ...(presentationMotion ? { presentationMotion } : {}),
        variantSets: [
          {
            id: variantSetId,
            dimension: 'height',
            variants: plan.agregado.variants.map((v) => ({
              nominalDimensionMm: v.khMinMm,
              hardwareId: idFor(v.kitCode),
              commercialKitHardwareId: idFor(v.kitCode),
            })),
          },
        ],
      };

      // 5. Grupo de accesorios del E como opción (kind hardware, link al kit E).
      let accessoryGroupDraft: OptionGroup | null = null;
      if (plan.accessoryGroup) {
        const eKitId = systemKitIds.get('E');
        if (eKitId) {
          accessoryGroupDraft = {
            id: ctx.newId(),
            code: plan.accessoryGroup.code,
            name: plan.accessoryGroup.name,
            kind: 'hardware',
            required: plan.accessoryGroup.required,
            optionIds: accessoryIds,
            kitHardwareId: eKitId,
          };
        }
      }

      const serverApply = ctx.deps.createHardwareKitSystem;
      const authed = ctx.deps.getSession() === 'auth';
      if (serverApply && authed) {
        // Camino transaccional (#1553): el servidor valida vocabulario y
        // referencias, re-chequea códigos bajo advisory locks y aplica TODO
        // en una tx — un fallo a mitad no deja sistema a medias.
        const created = await serverApply({
          expected_existing_codes: reusedCodes,
          hardware: newHardware.map((h) => ({
            id: h.id,
            code: h.code,
            name: h.name,
            unit: h.unit === 'set' ? ('set' as const) : ('piece' as const),
            cost_per_unit: h.costPerUnit,
            active: h.active !== false,
            preview_shape: h.previewShape ?? null,
            notes: h.notes ?? null,
            kit_hardware_id: h.kitHardwareId ?? null,
            pieces: h.pieces?.map((p) => ({
              anchor: p.anchor,
              asset: p.asset
                ? { assetId: p.asset.assetId, assetRevisionId: p.asset.assetRevisionId }
                : undefined,
              // #1596: offsets explícitos — lo mostrado es lo que se guarda.
              offsetMm: p.offsetMm
                ? { x: p.offsetMm.x, y: p.offsetMm.y, z: p.offsetMm.z }
                : undefined,
            })),
            // #1596: la declaración de movimiento que el motor ya lee. El
            // vocabulario está cerrado en el contrato — un valor fuera de él
            // aborta el alta (fail-loud), nunca viaja ni se silencia.
            design_parts: h.designParts?.length
              ? h.designParts.map((dp) => {
                  const actor = dp.actorMembership;
                  if (actor !== 'body' && actor !== 'actor:drawer' && actor !== 'actor:door') {
                    throw new Error(
                      `«${h.code}» declara «Al abrir» inválido (${actor}): el alta usa Fija al mueble, viaja con el cajón o viaja con la puerta.`,
                    );
                  }
                  return {
                    component_name: dp.componentName,
                    actor_membership: actor,
                    label: dp.label || null,
                    finish_key: dp.finishKey || null,
                  };
                })
              : undefined,
          })),
          agregado: {
            id: agregado.id,
            code: agregado.code,
            name: agregado.name,
            active: agregado.active !== false,
            width_mm: agregado.externalDims?.width ?? 0,
            height_mm: agregado.externalDims?.height ?? 0,
            depth_mm: agregado.externalDims?.depth ?? 0,
            commercial_kit_hardware_id: agregado.commercialKitHardwareId ?? '',
            presentation_motion: (agregado.presentationMotion as unknown as Record<string, unknown>) ?? null,
            variant_sets: (agregado.variantSets ?? []).map((vs) => ({
              id: '', // el servidor lo asigna (fin del id derivado del nombre)
              dimension: vs.dimension,
              variants: vs.variants.map((v) => ({
                nominalDimensionMm: v.nominalDimensionMm,
                hardwareId: v.hardwareId,
                commercialKitHardwareId: v.commercialKitHardwareId ?? null,
              })),
            })),
          },
          option_group: accessoryGroupDraft
            ? {
                id: accessoryGroupDraft.id,
                code: accessoryGroupDraft.code,
                name: accessoryGroupDraft.name,
                kind: 'hardware' as const,
                required: accessoryGroupDraft.required,
                option_ids: accessoryGroupDraft.optionIds,
                kit_hardware_id: accessoryGroupDraft.kitHardwareId ?? '',
              }
            : null,
          // #1596 decisión 9: la elegibilidad se aplica en la MISMA
          // transacción del servidor.
          eligibility_group: req.eligibilityGroup
            ? req.eligibilityGroup.existingGroupId
              ? { existing_group_id: req.eligibilityGroup.existingGroupId }
              : {
                  id: req.eligibilityGroup.id ?? '',
                  code: req.eligibilityGroup.code ?? '',
                  name: req.eligibilityGroup.name ?? '',
                }
            : null,
        });

        // El estado local adopta la verdad del servidor: códigos creados/
        // reutilizados e ids de variant set asignados. Merge silencioso (la
        // persistencia ya ocurrió transaccionalmente).
        const serverAgregado: Agregado = {
          ...agregado,
          variantSets: (agregado.variantSets ?? []).map((vs, i) => ({
            ...vs,
            id: created.variant_set_ids[i] ?? vs.id,
          })),
        };
        const merged: Catalog = {
          ...catalog,
          hardware: [...(catalog.hardware ?? []), ...newHardware],
          agregados: [...(catalog.agregados ?? []), serverAgregado],
          ...(accessoryGroupDraft
            ? { optionGroups: [...(catalog.optionGroups ?? []), accessoryGroupDraft] }
            : {}),
        };
        ctx.set({ catalog: merged });
        ctx.toast({ type: 'success', message: `✓ Sistema «${req.input.code.trim()}» creado (${plan.kits.length} alturas)` });
        return {
          createdCodes: [...created.created_codes],
          reusedCodes: [...created.reused_codes],
          agregadoCode: created.agregado_code,
          agregadoId: created.agregado_id,
        };
      }

      // Guest (sin backend): la elegibilidad se aplica en la MISMA mutación
      // local — sin éxito aparente: un grupo inexistente aborta todo antes
      // de escribir (#1596 decisión 9).
      const guestOptionGroups = [...(catalog.optionGroups ?? [])];
      if (req.eligibilityGroup) {
        if (req.eligibilityGroup.existingGroupId) {
          const target = guestOptionGroups.find(
            (g) => g.id === req.eligibilityGroup!.existingGroupId,
          );
          if (!target) {
            throw new Error('El grupo de elegibilidad elegido ya no existe. Volvé a abrir el asistente y elegilo de nuevo.');
          }
          if (!target.optionIds.includes(agregado.id)) {
            const idx = guestOptionGroups.findIndex((g) => g.id === target.id);
            guestOptionGroups[idx] = { ...target, optionIds: [...target.optionIds, agregado.id] };
          }
        } else {
          guestOptionGroups.push({
            id: req.eligibilityGroup.id ?? ctx.newId(),
            code: req.eligibilityGroup.code ?? '',
            name: req.eligibilityGroup.name ?? '',
            kind: 'agregado',
            required: false,
            optionIds: [agregado.id],
          });
        }
      }

      await ctx.saveAndToast(
        (c) => ({
          ...c,
          hardware: [...(c.hardware ?? []), ...newHardware],
          agregados: [...(c.agregados ?? []), agregado],
          optionGroups:
            accessoryGroupDraft || req.eligibilityGroup
              ? guestOptionGroups
              : c.optionGroups,
        }),
        `✓ Sistema «${req.input.code.trim()}» creado (${plan.kits.length} alturas)`,
      );

      return {
        createdCodes,
        reusedCodes,
        agregadoCode: agregado.code,
        agregadoId: agregado.id,
      };
    },

    /**
     * #1596 alcance 10: añadir una altura FALTANTE a un sistema ya creado
     * (decisión 8 — el escenario real: MERIVOBOX existe y el asistente se
     * bloquea). Crea el kit de la altura (misma estructura drawer-hands que
     * el sistema) y añade la variante al ensamble por la VÍA DE EDICIÓN
     * existente (un saveAndToast; el PUT de receta valida con If-Match).
     * Si el ensamble aún no está en ningún grupo kind:agregado, la
     * elegibilidad viaja en el mismo request (#1596 decisión 9).
     */
    addSystemHeight: async (req) => {
      const catalog = ctx.get().catalog;
      if (!catalog) throw new Error('El catálogo no está cargado.');
      const agregado = (catalog.agregados ?? []).find((a) => a.id === req.agregadoId);
      if (!agregado) throw new Error('El ensamble del sistema ya no existe.');
      const systemCode = agregado.code.replace(/-CAJON$/, '');
      if (!systemCode || systemCode === agregado.code) {
        throw new Error(`«${agregado.code}» no es un ensamble de sistema (-CAJON).`);
      }
      const height = HARDWARE_KIT_SYSTEM_HEIGHTS.find((h) => h.code === req.heightCode);
      if (!height) throw new Error(`Altura «${req.heightCode}» fuera de la lista canónica.`);

      const hardwareList = catalog.hardware ?? [];
      const kitCode = `${systemCode}-${req.heightCode}`;
      const existing = {
        hardwareCodes: new Set(hardwareList.map((h) => h.code)),
        agregadoCodes: new Set((catalog.agregados ?? []).map((a) => a.code)),
      };
      if (existing.hardwareCodes.has(kitCode)) {
        throw new Error(`El juego «${kitCode}» ya existe en el catálogo.`);
      }
      const heightVs = (agregado.variantSets ?? []).find((vs) => vs.dimension === 'height');
      if (heightVs?.variants.some((v) => v.nominalDimensionMm === height.khMinMm)) {
        throw new Error(`El sistema ya tiene la altura ${req.heightCode} (${height.khMinMm} mm).`);
      }

      const systemName = agregado.name.replace(/^Cajón\s+/, '') || systemCode;
      const subPlan = planHardwareKit(
        {
          code: kitCode,
          name: `${systemName} ${req.heightCode}`,
          kitCostPerUnit: req.kitCostPerUnit,
          widthMm: req.widthMm,
          heightMm: height.khMinMm,
          depthMm: req.depthMm,
          templateId: KIT_TEMPLATE_DRAWER_HANDS_ID,
        },
        existing,
      );

      const idByCode = new Map(hardwareList.map((h) => [h.code, h.id] as const));
      const idFor = (code: string): string => {
        const found = idByCode.get(code);
        if (found) return found;
        const fresh = ctx.newId();
        idByCode.set(code, fresh);
        return fresh;
      };
      const kitId = idFor(kitCode);

      const newHardware: Hardware[] = [
        {
          id: kitId,
          code: kitCode,
          name: `${systemName} ${req.heightCode}`,
          unit: 'set',
          costPerUnit: req.kitCostPerUnit,
          active: true,
          notes: `Juego ${req.heightCode} añadido al sistema ${systemCode} (#1596).`,
        },
      ];
      for (const design of subPlan.designs) {
        if (!design.handsParts) continue;
        const pieces = design.handsParts
          .map((part) => {
            const binding = req.designs?.[`${kitCode}:${part.hand}:${design.code}`];
            return binding ? ({ anchor: part.hand, asset: binding } as HardwarePiece) : null;
          })
          .filter((pc): pc is HardwarePiece => pc !== null);
        newHardware.push({
          id: idFor(design.code),
          code: design.code,
          name: design.name,
          unit: 'piece',
          costPerUnit: 0,
          active: true,
          previewShape: 'slide',
          notes: DESIGN_NOTES(kitCode),
          kitHardwareId: kitId,
          ...(pieces.length > 0 ? { pieces } : {}),
        });
      }

      // La variante nueva entra en el variant set height EXISTENTE; la
      // altura externa del ensamble sube al máximo de sus variantes.
      const baseVs = heightVs ?? { id: ctx.newId(), dimension: 'height' as const, variants: [] };
      const nextVariantSets = (agregado.variantSets ?? []).some((vs) => vs.dimension === 'height')
        ? (agregado.variantSets ?? []).map((vs) =>
            vs.dimension === 'height'
              ? {
                  ...vs,
                  variants: [
                    ...vs.variants,
                    {
                      nominalDimensionMm: height.khMinMm,
                      hardwareId: kitId,
                      commercialKitHardwareId: kitId,
                    },
                  ],
                }
              : vs,
          )
        : [
            ...(agregado.variantSets ?? []),
            {
              ...baseVs,
              variants: [
                {
                  nominalDimensionMm: height.khMinMm,
                  hardwareId: kitId,
                  commercialKitHardwareId: kitId,
                },
              ],
            },
          ];
      const nextHeight = Math.max(
        ...nextVariantSets
          .find((vs) => vs.dimension === 'height')!
          .variants.map((v) => v.nominalDimensionMm),
      );
      const nextAgregado: Agregado = {
        ...agregado,
        externalDims: {
          width: agregado.externalDims?.width ?? 0,
          height: nextHeight,
          depth: agregado.externalDims?.depth ?? 0,
        },
        variantSets: nextVariantSets,
      };

      // Elegibilidad en la misma mutación (decisión 9).
      const nextOptionGroups = [...(catalog.optionGroups ?? [])];
      if (req.eligibilityGroup) {
        if (req.eligibilityGroup.existingGroupId) {
          const idx = nextOptionGroups.findIndex(
            (g) => g.id === req.eligibilityGroup!.existingGroupId,
          );
          const target = idx === -1 ? undefined : nextOptionGroups[idx];
          if (!target) {
            throw new Error('El grupo de elegibilidad elegido ya no existe.');
          }
          if (!target.optionIds.includes(agregado.id)) {
            nextOptionGroups[idx] = { ...target, optionIds: [...target.optionIds, agregado.id] };
          }
        } else {
          nextOptionGroups.push({
            id: req.eligibilityGroup.id ?? ctx.newId(),
            code: req.eligibilityGroup.code ?? '',
            name: req.eligibilityGroup.name ?? '',
            kind: 'agregado',
            required: false,
            optionIds: [agregado.id],
          });
        }
      }

      await ctx.saveAndToast(
        (c) => ({
          ...c,
          hardware: [...(c.hardware ?? []), ...newHardware],
          agregados: (c.agregados ?? []).map((a) => (a.id === nextAgregado.id ? nextAgregado : a)),
          optionGroups: req.eligibilityGroup ? nextOptionGroups : c.optionGroups,
        }),
        `✓ Altura ${req.heightCode} añadida a ${systemCode} (${kitCode})`,
      );
      return { kitCode, agregadoCode: agregado.code };
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
