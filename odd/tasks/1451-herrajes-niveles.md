# odd/tasks/1451-herrajes-niveles.md — Delegated Direct

Issue: [#1451](https://github.com/tiagofur/muebleria/issues/1451) (P1, status:approved 2026-11-02 por el owner: «empezamos a planear y codificar»).
Base: main `ebd33c0a`. Rama: `feat/1451-herrajes-niveles`. Un escritor: implementer (este agente).
Nota: el árbol trae cambios en vuelo de OTRA sesión (catalogs/hardware, hardwareKit.ts, layout.go, ShellView, sketchup) — NO se tocan ni se commitean; los commits de esta issue llevan sólo rutas propias.

## Alcance autorizado (de la issue)

1. Pestaña Herrajes reorganizada en tres niveles de anclaje: **Del cajón** (rigidMembers fixed, autoría común) / **Por cantidad** (hardwareLines) / **De las piezas** (hardwarePlacements).
2. Subsume #1443: sección muestra ambos mecanismos, empty-states honestos (solo-herraje / mixto / vacío).
3. `CatalogPicker` en todos los autores de herraje; matar defaults `catalogHardware[0]` (addHardwareLine, addMember, applyPreset, variante, mode-switch).
4. Quick wins: nombres unificados, badge por nivel («N + M pos.»), htmlFor + títulos con pieza contenedora, estados vacíos que enseñan, 3D del borrador (YA EXISTE en `agregado3dPreview.ts:207-229` — verificar + copy del empty-state).
5. E2E browser del flujo «kit del cajón desde Herrajes» (solo-herraje y mixto).

## Descubrimientos que afilan el alcance

- El draft YA lleva `rigidMembers` (#1412) y el preview 3D YA resuelve la receta del borrador en vivo (comentario viejo de #669 en AgregadoEditorPreview3D era stale). No hay cambio de modelo ni de backend.
- `Tabs.count` es `number` → extender a `number | string` para el badge por nivel.
- Members con source `variant` se muestran en Herrajes como fila read-only con puntero a Receta (los sets siguen en Receta).

## Tareas

1. `Tabs.tsx`: count `number | string`.
2. NUEVO `AgregadoCajonHardwareSection.tsx`: kit comercial (select→CatalogPicker con «Sin kit»), acción «Kit con par izq/der» (preset drawer-slides con confirm si hay miembros), tarjetas simples de member fixed: herraje (CatalogPicker, placeholder, sin default), «desde: Borde izq./Centro/Borde der.» + offset X mm, movimiento (fijo al cajón / parte móvil actor), compra (3 bomRoles), details anclaje fino Y/Z + identidad (memberId/role). Variant → read-only.
3. `AgregadoEditorForm.tsx`: «+ Añadir herraje» abre chooser de nivel (Del cajón / De una pieza / Solo cantidad); tres secciones con headers que enseñan; renombres («Herrajes por cantidad (sin posición)»); eliminar warning «no lo sumes también»; empty-states por nivel; badge por nivel; htmlFor en líneas de cantidad; pasar containerLabel al placements editor.
4. `HardwarePlacementsEditor.tsx`: prop opcional `containerLabel` → título «Herraje N · en {containerLabel}».
5. `AgregadoRecipeAuthoringPanel.tsx`: CatalogPicker en kit/miembro/variantes; defaults `''` en addMember/applyPreset/variante/source-switch; inline error de herraje vacío.
6. `AgregadoDetailView.tsx`: sección «Herrajes» con 3 grupos (Del cajón con anclaje humano + membresía + compra; Por cantidad; De las piezas); conteo total incluye miembros.
7. `agregado3dPreview` empty copy: «Agregá piezas o herrajes del cajón.»
8. Tests: actualizar `AgregadoEditorForm.test.tsx` (badge, copy, defaults), `AgregadoRecipeAuthoringPanel.test.tsx` (picker interactions), `AgregadoDetailView.test.tsx` (grupos + miembros), `Tabs.test.tsx` si aplica; nuevos: sección Del cajón (add por chooser, preset par, anclaje humano, membership, compra, kit), badge string, empty solo-herraje.
9. E2E: extender `tests/organization/agregados-componentes-ux.spec.ts` (o spec nuevo) — flujo solo-herraje: chooser → Del cajón → kit par izq/der → picker herraje → ver en 3D del borrador; mixto: piezas + del cajón sin doble conteo.

## Verificación (proporcional)

- V1: `pnpm vitest run` en packages/ui (agregados + tabs + picker) — verde.
- V1: E2E browser gate local del spec tocado.
- V0: preflight + verify_affected --plan; CI completa al abrir PR.
- V2: no aplica (sin backend/host; superficie web only).

## Entrega

Commits convencionales por unidad (Tabs+section / form / recipe+detail / tests / e2e). PR con `Closes #1451` + `Delivery: complete` sólo con aceptación completa; si el E2E queda bloqueado por infra → partial con scope restante. Handoff: HEAD/base + rutas + evidencia al leader (el review es otro actor fresco).

Risk: member con hardwareId '' al añadir — debe fallar el guardado server (422) y verse error inline; verificar que el submit del form no crashee con miembros vacíos (draftRule exige source.fixed.hardwareId string — '' pasa la regla del draft; el validador de dominio en el submit debe rechazarlo; comprobar AgregadosScreen submit path).

## Evidencia observada (final — HEAD 35341b15, base ebd33c0a)

- **V1 unit**: vitest `packages/ui` completo **2396/2396**; re-corrida post-commit del subconjunto agregados/tabs/placements **109/109**; `tsc --noEmit` OK.
- **V2 browser gate** (`scripts/organization-browser-gate.sh`, backend Go + PostgreSQL reales): **2/2 PASS** —
  - solo-herraje: chooser → Del cajón → «Kit con par izq/der» (confirm) → 3D del borrador muestra diagnóstico honesto con herrajes vacíos → guardado fail-closed «Receta inválida» (y el submit redirige a Receta) → pick ×4 → 3D proyecta sin guardar → lectura «Del cajón (4)» «borde izq. +10» «borde der. -10» «0 piezas · 4 herrajes».
  - mixto: por cantidad ×8 + Del cajón (4) → badge «1 + 4 pos.», «0 piezas · 5 herrajes», línea bulk ×8 en lectura. Sin doble conteo.
  - Notas de iteración del gate (7 corridas): el preview 3D vive en las tabs con visor (no en Receta a donde el fail-closed redirige) — el spec navega in-app; el `page.goto` a mitad de sesión re-diseña el SPA y quedó fuera; un 500 `context canceled` en la corrida 4 (create) no reprodujo en 5/6/7/8 — consistente con la familia flake del gate; el POST-con-receta ya está ejercitado en CI por `agregado-recipe-change.spec.ts`.
- **V0**: preflight OK (árbol con trabajo ajeno en vuelo — sin `--require-clean`); `verify_affected --plan` amplio por el trabajo ajeno del árbol; verificación proporcional aplicada (ui + gate del spec). CI valida el candidato congelado al abrir el PR.
- **PR**: #1454 (`Closes #1451 · Delivery: complete`) — rama `feat/1451-herrajes-niveles`, 4 commits de unidad. El diff NO incluye las rutas del trabajo ajeno (catalogs/hardware, hardwareKit, layout.go, ShellView, sketchup).
- Estado: **IMPLEMENTED_PENDING_REVIEW** — review por actor fresco distinto del implementer.
