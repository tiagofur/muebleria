# odd/tasks/1596-alta-herrajes-por-tipo

Issue: #1596 — alta de herrajes por tipo de ítem (pieza / par I/D / juego / inserto), un solo «Nuevo», absorbe asistentes, extensión de sistema existente y elegibilidad SISTEMA_CAJON.
Lane: Delegated Direct. Writer: sesión 11-11/12 (brief aprobado en sesión: issuecomment-6810231791; issue con decisiones 7-9 plegadas + status:approved). Base: origin/main f92b6efd. Rama: feat/1596-alta-herrajes-por-tipo (worktree 1596-alta-por-tipo).

## Outcome observable (entregado)

Un solo «Nuevo» en Herrajes pregunta el tipo (pieza / par I/D / juego / inserto) y cada tipo muestra sólo sus campos. Par/inserto: SKP por lado subir/elegir en el mismo lugar, offsets X/Y/Z siempre visibles y persistidos (el default 10/35 del motor se materializa al editar legacy), «Al abrir» explícito en DesignParts[0] (lo que kitPieceMember ya lee), «copiar al otro lado» visible y nunca automático, precio del par, avanzado colapsado. Inserto se crea desde el juego en UNA mutación (herraje + selector si falta + opción) con fallo visible y reintentable; estado por opción (lados con diseño pendiente). Juego: sistema por alturas con insertos COMPLETOS (offsets + Al abrir) y paso de elegibilidad (decisión 9) con omisión confirmada; juego simple sigue disponible. Extensión de sistema existente: «Añadir altura» (sólo faltantes, vía de edición existente) con elegibilidad si falta. Los botones «Juego de herraje» y «Nuevo sistema» se retiraron del header (absorbidos).

## Fix de raíz encontrado en el camino

- `updateHardware` NO re-aplicaba designParts del draft (el destructure los eliminaba y el PUT los nulaba) — cambiar «Al abrir» en un herraje existente no persistía. Ahora update re-aplica `hardwareDesignPartsField(draft)`; sin filas en el form = legacy intacto.
- `createHardware` no persistía designParts y no devolvía el id — corregido (el alta nueva declara «Al abrir» desde la creación; el inserto necesita el id para el selector).
- El endpoint de sistema (#1553) no transportaba design_parts/offsets por pieza ni elegibilidad — contrato extendido (ver abajo).

## Superficie cambiada

- Contrato: `contracts/openapi/granete-api.v1.yaml` (design_parts en fila de herraje de sistema, HardwareKitSystemDesignPartRow, eligibility_group + HardwareKitSystemEligibilityGroupRow) + DTOs regenerados (Go y TS por scripts/generate_openapi.py).
- Backend: `backend-go/internal/api/hardware_kit_system.go` (design_parts con vocabulario cerrado fail-loud; elegibilidad resuelta ANTES del primer insert porque un 4xx posterior committearía sistema a medias; append a grupo existente vía UpdateOptionGroup con version; grupo nuevo kind:agregado con el agregado como único miembro).
- Domain TS: `packages/domain/src/hardwareKit.ts` (HardwareKitSystemAccessory gana pieceOffsets/actorMembership; HardwareKitSystemEligibilityRequest; defaultPieceOffsetMm).
- Store web: `hardwareKit.ts` (accesorios SIEMPRE con piezas por ancla + offsets explícitos + design_parts; elegibilidad server y guest; addSystemHeight), `hardware.ts` (createInsertoForKit; fixes de raíz), `shared.ts` (shapes).
- UI: HardwareTypePickerModal (nuevo), HardwareSystemHeightAddModal (nuevo), HardwarePiecesSection (rework #1596), HardwareFormModal (forma por tipo + avanzado), HardwareKitAccessoriesSection (estado por opción + Añadir inserto + copy selector), HardwareCatalog (entrada única, inserto, sistema), HardwareKitSystemWizardModal (insertos completos + elegibilidad).

## Verificación

- V0: tsc --noEmit limpio en domain/storage/ui/web; go build + gofmt limpio; openapi regenerado sin drift.
- V1 Go (PG desechable, GRANETE_TEST_DATABASE=1): `go test ./internal/api/ -run TestHardwareKitSystem` — 8/8 (5 de #1553 + 3 nuevos: inserto end-to-end con SQL readback de design_parts/pieces/eligibility; append a grupo existente; fail-closed de elegibilidad sin escrituras).
- V1 motor: `TestAccessoryKitInsertoPiecesTwoMembersDeclaredMotion_1596` — el inserto con Pieces I/D + actor:drawer resuelve en la bahía como 2 miembros (mano left/right), movimiento declarado y offsets verbatim (12.5/3/1 vs default 10). Suite accesorios completa 8/8.
- V1 UI: vitest packages/ui directorio hardware 87/87 (incluye HardwareTypedCreate.test.tsx nuevo: par offsets distintos al draft, copiar-sólo-al-pulsar sin espejo, fallo de vínculo visible y reintentable sin herraje huérfano); packages/domain 2182/2182.
- E2E specs de organización actualizados al flujo nuevo (hardware-3d-catalog, hardware-design-parts).
- V2 navegador real + vivo SketchUp: NOT_RUN — owner (aceptación: sobre MBOX-IRIDIUN-E crear galería/BOXCOVER/BOXCAP, insertar, cambiar y abrir el cajón; ProjectAddItemModal ofrece el selector).

## Delivery

PR `Closes #1596` / `Delivery: complete` (código+tests+CI; V2 navegador/vivo queda como condición de cierre del owner, patrón #1590/#1593). Riesgo: UI de alta nueva ampliamente ejercitada por vitest pero no corrida en navegador real antes del owner.

## Ronda de corrección (review 1: CHANGES_REQUESTED 3 blockers / 8 sugerencias)

- B1 (P0): el replace de specs insertó `#1596:` sin `//` en hardware-3d-catalog (SyntaxError → shard 2/3 abortado). Corregido (3 líneas comentadas).
- B2 (P1): los specs que aún abrían los botones retirados migrados al picker — kit-wizard, kit-hands (juego simple), kit-system (sistema por alturas; el bloque debug referenciaba test-ids retirados, sustituido).
- S3: grupo de elegibilidad de «Añadir altura» unificado al canónico SISTEMA_CAJON.
- S4: este artifact se COMMITEA en la rama candidata (estaba untracked en el checkout principal).
- S5: slip de formato en shared.ts (RecipeChangeActions) corregido.
- S6: chevron con rotación CSS en el bloque Avanzado (§4.2).
- S7: «Subir diseño» deja de ser primary dentro de las filas (una primaria por modal).
- S1: límite de defaultPieceOffsetMm (rama puerta) DOCUMENTADO en la función.
- No aplicados con razón: S2 (UpdateOptionGroup 500 vs 409 tipado — seguro hoy por rollback total; follow-up), S8 (Number||0 — riesgo bajo documentado).

Re-verificación local: pendiente gate de navegador con los 7 specs afectados + vitest + tsc. Nuevo HEAD ⇒ re-revisión fresca requerida.

## Ronda de corrección 2 (gate r4 + call logs)

- F1 (bug real): el CTA del EmptyState ignoraba canMutate — con el testid compartido `hardware-new-typed` la prueba de permisos de 3d-catalog lo veía visible. Fix: `onAction={canMutate ? startCreate : undefined}` (sin CTA si no puede mutar).
- F2-F4 (convención del repo): los clicks de ENTRADA del picker en los 7 specs migrados pasan al patrón nativo `evaluate((el) => el.click())` — los clicks sintéticos de Playwright no entran/interceptan en esta app (memoria/convensión ya usada por estos mismos specs para otros steps). La prueba no se debilita: sigue verificando flujo + readback por API.
- Nota: la inestabilidad «not stable» solo se manifestó bajo el gate; el repro manual con navegador real (IAB, demo poblado, muestreo de bbox 30 frames) es estable. El detalle queda anotado para el review, no como bloqueo.
- Verificación: tsc limpio, vitest 215/215, 7 specs parsean OK.
