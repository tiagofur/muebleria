# Proyectar 3D — Slices en Desarrollo

> **Estado general:** En progreso (2 de 8 slices completados)
> **Meta Issue:** [#308](https://github.com/tiagofur/muebleria/issues/308) · Plan maestro: [Plan de ejecución aprobado en #308](https://github.com/tiagofur/muebleria/issues/308#issuecomment-5380804425)
> **Documentos de referencia:** `docs/proyectar-3d-roadmap-vnext.md` · `docs/proyectar-3d-north-star.md` · `AGENTS.md`
>
> Este archivo es el **punto de arranque para ejecutar cada slice (S) en un chat
> nuevo**. Cada sección S es autocontenida: qué existe, qué hay que construir,
> con qué fuentes y cómo verificar. El detalle vivo vive en las fuentes
> canónicas (issues, roadmap, `feature_list.json`, `progress/`); si algo acá
> contradice al código o al roadmap, gana el código/roadmap y se corrige acá.

---

## 0. Cómo arrancar un chat nuevo (aplica a cada S)

1. `./init.sh` (ojo: tiene un guardrail roto conocido — revisá la salida real
   de install/tests, no confíes sólo en exit 0).
2. Leé `AGENTS.md`, `progress/current.md` y la sección del slice acá abajo.
3. Leé el issue del slice y, si existe, el comentario SDD.
4. Workflow por slice (ya establecido en S1/S2):
   - rama `feat/f14x-...` (desde `main` una vez mergeado el stack anterior);
   - **SDD primero**: comentario de plan en el issue antes de codear;
   - registrar la feature como `in_progress` en `feature_list.json` + sesión en
     `progress/current.md`;
   - implementar + tests → verificación completa (`pnpm test` +
     `pnpm typecheck` + `go test ./...` si toca backend + smoke WebGL
     `pnpm smoke` + screenshot review si toca UI);
   - **reviewer** (rol `.agents/skills/reviewer/`) → aplicar hallazgos →
     APPROVED;
   - `done` con evidencia en `feature_list.json` + entrada en
     `progress/history.md` + commit único coherente + **push**;
   - PR + comentario de cierre en el issue.
5. Regla de stack: **un solo stack abierto a la vez**. Ahora: PR #329 (S1) ←
   PR #330 (S2, base #329). Merge en ese orden; S3 arranca desde `main`
   actualizado (no necesita código de S1/S2, sólo los patrones).

### Estado del stack y PRs

| Slice | Rama | PR | Estado |
| :--- | :--- | :--- | :--- |
| S1 | `feat/f141-proyectar-library` | #329 | Listo para merge (5 iteraciones craft + reviewer) |
| S2 | `feat/f142-materials-dock` | #330 | Listo para merge (stacked sobre #329; 3 iteraciones + reviewer APPROVED) |

### Decisiones de producto ya tomadas (no re-litigar)

- **Drag & drop es el único gesto de aplicación de materiales** (ambientales y
  tableros). No hay aplicación por clic (North Star §7.3). Insertar muebles
  desde la biblioteca SÍ conserva click/teclado como alternativa al drag.
- **"Mi taller" eliminado para siempre** (F141v4), también de documentación.
  La biblioteca tiene Favoritos + Recientes (localStorage v1; sync por usuario
  = deuda v2).
- **Materiales separados por naturaleza**: sub-tabs **Ambiente |
  Tableros**. AmbientMaterial = presentación; MaterialBoard = cotizable con
  **fabricante obligatorio** (texto libre; legacy '(sin definir)') + subgrupos
  (árbol `material_categories`).
- **Scopes del drop de tablero**: Frentes del mueble (default) / Interior /
  Todo el mueble / Frentes de toda la obra (`projectLevelChoices`).
- **Anti-leak por tipo**: MaterialBoard jamás en `floorMaterialId`/etc;
  AmbientMaterial jamás en `optionChoices`. El resolver del drop usa sólo el
  hit más cercano; mesada bloqueada (`boardPaintBlocked`).
- Propiedades del ambiente en el **inspector derecho** cuando no hay selección
  (North Star §8); sidebar izquierdo = sólo fuentes de inserción.

### Patrones base que S3+ debe reutilizar

- Cascada de chips por nivel compartida: `packages/ui/src/common/cascadeLevels.ts`.
- Sub-tabs compactos con `WorkspaceTabs` (§4.0a design.md).
- Smoke WebGL Playwright: `tests/smoke/proyectar-studio.spec.ts` (`pnpm smoke`)
  — extenderlo es parte del DoD de cada slice que toca el studio.
- Inserción atómica catálogo→plano: `pruneKitchenLayout(layout, items,
  extraItemIds)` (patrón F141).
- MIME de drag: `application/x-muebles-library` / `-board-paint` / `-unplaced`
  (`packages/ui/src/preview3d/paintMaterial.ts`).

---

## 1. Matriz de Slices

| Slice | Issue | Feature | Título / Objetivo | Estado |
| :--- | :--- | :--- | :--- | :--- |
| **S1** | #309 | F141 | Biblioteca lateral de muebles | ✅ Completado (PR #329) |
| **S2** | #309 | F142 | Dock de materiales Ambiente\|Tableros + scopes | ✅ Completado (PR #330) |
| **S3** | #310 | F143 | Selección multi/jerárquica + productividad | ⏳ Pendiente (**siguiente**) |
| **S4** | #310 | F144 | Precisión + dimensiones libres + undo | ⏳ Pendiente |
| **S5** | #313 | F145 | Contract fixtures diseño→BOM→precio→producción | ⏳ Pendiente (priorizado antes de S6) |
| **S6** | #311 | F146 | Environment authoring + multi-space 5★ | ⏳ Pendiente |
| **S7** | #312 | F147 | Performance budget + escena de referencia | ⏳ Pendiente |
| **S8** | #314 | — | Benchmark de validación con usuarios | ⏳ Pendiente (pasadas informales tras S2 y S4; formal tras S7) |

Orden de ejecución: S3 → S4 → S5 → S6 → S7 → S8 (S5 se adelanta a S6 para
congelar la red de seguridad antes de más superficie UX).

---

## 2. Detalle de Slices

### S1: Biblioteca lateral de muebles (F141 · #309) — ✅ Completado

Lo implementado (útil como referencia de patrones):

- Biblioteca persistente en el sidebar del studio: sub-tabs **Biblioteca**
  (catálogo) | **De la obra** (ítems del proyecto).
- Búsqueda tolerante (nombre/código/tipo), categorías jerárquicas con
  breadcrumbs, estado preservado; Favoritos ⭐ + Recientes (localStorage
  `muebles.proyectar.library.v1`); navegación persistente.
- Thumbnails `Module.imageUrl` con fallback a silueta paramétrica.
- Insert por drag (inserción atómica del `ProjectItem` al drop) y por
  click/teclado.
- Iteraciones de craft v2–v5: cascada por nivel separado, tabs compactos,
  chip activo unificado, ambiente → inspector derecho.
- Estableció el smoke WebGL Playwright como baseline transversal.
- **"Mi taller" eliminado** (decisión permanente del dueño del producto).

SDD: [comentario en #309](https://github.com/tiagofur/muebleria/issues/309#issuecomment-5380832816)

---

### S2: Dock de materiales (F142 · #309) — ✅ Completado

Lo implementado (importante para S3+):

- Tab Materiales con sub-tabs **Ambiente | Tableros** por naturaleza.
- Tableros: chips de **fabricante** (campo obligatorio nuevo) + cascada de
  **subgrupos** (`material_categories`, espejo F086) + búsqueda tolerante;
  navegación estándar con la Biblioteca (cascadeLevels compartido).
- Aplicación **sólo por drag & drop** (regla transversal): scope elegido antes
  de soltar ("Al soltar, aplicar a"), drop sobre mueble con highlight; drop
  fuera de mueble/mesada rechazado con mensaje que enseña.
- Backend: migración aditiva `000077` (manufacturer + backfill '(sin
  definir)' + material_categories) + CRUD con RBAC; PUT sin fabricante hereda
  el existente (syncs legacy no rompen).
- Form Materiales del catálogo: fabricante requerido + subgrupo.
- North Star §7.2/7.3 actualizados a separación por naturaleza + drag-only.

SDD: [comentario en #309](https://github.com/tiagofur/muebleria/issues/309#issuecomment-5381687420)

---

### S3: Selección multi/jerárquica + productividad (F143 · #310) — ⏳ Pendiente (siguiente)

> **Prompt sugerido para el chat nuevo:** "Ejecutá el slice S3 (F143,
> selección multi/jerárquica + clipboard/align) del meta #308: leé
> `docs/en-desarrollo.md` §S3, el issue #310 y `AGENTS.md`; empezá por el SDD."

- **Selección:**
  - Multi-selección (Shift/Ctrl) sincronizada bidireccional: Canvas ↔ Lista ↔
    Inspector.
  - Drill-down jerárquico como modo detalle: Mueble → Agregado → Pieza /
    Herraje (selección principal por mueble, según North Star §8).
  - Selección estable durante orbit/pan.
- **Productividad:**
  - Copy/Paste, Duplicate; Align/Distribute/Centrar; pegar a izq/der/esquina;
    guías temporales (smart guides) como ayuda visual.
  - Todo comando relevante undoable (prepara terreno a S4).
- **Base de código:** `ProjectSpatialStudio.tsx` (selección simple actual:
  `selectedKey`), `FurnitureScene3D.tsx` (selección por módulo). Extraer un
  selection controller testeable antes de crecer más el monolito.
- **Verificación:** comandos como intenciones puras (tests unit) + interacción
  jsdom + smoke extendido (multi-select/drag).

---

### S4: Precisión + dimensiones libres + undo por intención (F144 · #310) — ⏳ Pendiente

- Nudge de teclado, snap configurable, fit selection, offsets mm.
- **Dimensiones libres W/H/D por ítem** (gap del North Star): inputs validados
  con constraints por módulo; presets quedan como shortcut.
- **Undo/redo por intención**: un gesto = una entrada; cubre layout + opciones
  de ítem + materiales + agregados. *Decisión SDD:* cablear `CommandManager`
  F061 vs extender stacks actuales (paridad de comportamiento durante la
  migración).
- **Verificación:** smoke WebGL + interacciones reales de drag; profiling si
  toca hot path.

---

### S5: Contract fixtures diseño → BOM → precio → producción (F145 · #313) — ⏳ Pendiente (priorizado antes de S6)

> Congela la red de seguridad de datos antes de aumentar la superficie UX.

- Fixture encadenado con valores esperados (TS + Go, patrón
  `contracts/*.json` + `*Parity_test.go`):
  1. Material change → resolved BOM → breakdown → requirements;
  2. edición post-release → stale → change order → re-release (nunca
     overwrite silencioso);
  3. agregado → piezas/herrajes/drilling → BOM → cut/CNC;
  4. anti-leak ambiental;
  5. UI no duplica fórmulas de negocio.
- Todas las funciones existen; falta el fixture encadenado como gate.

---

### S6: Environment + multi-space 5★ (F146 · #311) — ⏳ Pendiente

- Muros editables en lenguaje dimensional (mm); openings donde el dominio
  lo soporte.
- Quick views (planta/frontal/fit room), cámaras por ambiente, visibilidad de
  muros / clipping.
- Ownership inequívoco por espacio (multi-ambiente ya existe; hardenar).

---

### S7: Performance budget (F147 · #312) — ⏳ Pendiente

- Fixture versionado de escena de referencia (20–30 muebles, cientos de
  piezas) + harness de métricas (React commits, draw calls, tris, raycast,
  rebuilds, long tasks) + baseline con hardware objetivo documentado.
- Gate para hot path del canvas.

---

### S8: Benchmark de validación (#314) — ⏳ Pendiente

- Script canónico de 11 pasos con usuarios reales; pasadas informales tras S2
  (hecha la base) y S4; formal tras S7.
- Targets: <60s primer módulo, <15s aplicar material, <30s agregado, <30s
  duplicar/alinear 3.
- **DoD de la meta #308:** usuario real completa el benchmark sin coaching y
  las consecuencias de diseño llegan a precio/BOM/revisión/producción
  (probado por S5).
