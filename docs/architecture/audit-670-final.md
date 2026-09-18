# Auditoría de Aceptación — Programa #670: Herrajes y Conjuntos Paramétricos 3D

**Fecha:** 2026-09-18  
**Programa:** Granete, Programa #670 (#670-A a #670-E)  
**Alcance evaluado:** Contrato de arquitectura `docs/architecture/hardware-3d-assets-and-assemblies.md`, dossiers técnicos #670-A/B/C/D y piloto comercial MERIVOBOX #670-E (`docs/architecture/merivobox-pilot.md`), incluyendo la ronda de revisión R9–R14 (configuración canónica, paridad cross-renderer y evidencia host real).  
**Estado:** AUDITORÍA TÉCNICA FORMAL.

---

## 1. Resumen Ejecutivo — Incremento #670-E (PASS) y Criterios Diferidos

Los incrementos #670-A…#670-E entregados implementan la gestión, resolución, proyección web y materialización en SketchUp de herrajes 3D y conjuntos paramétricos (`Agregados`), validados end-to-end con el piloto comercial MERIVOBOX (Altura M). Este dossier audita la entrega del **incremento #670-E** y **no declara cerrado el #670 original**: sus criterios restantes quedan explícitamente diferidos en §1.2 y ninguno se marca PASS.

### 1.1 Incremento #670-E — PASS

Dentro del alcance del incremento, con evidencia ejecutable en §3:

- **Parametric rigid assembly** — engine genérico Go/TS (E1–E20); miembros rígidos, bindings y hosts como datos.
- **Variants** — selección estricta por holgura REAL_VERIFIED 3.0 mm, rechazo sin nearest-fallback (R6).
- **BOM kit semantics** — juego comercial `set` con `IncludedInKit`; fondo/trasera a lista de corte (R4).
- **W → LW** — outer W + costados reales de carcasa derivan LW; el resolver sólo recibe LW (R3/R10/R11).
- **MaterialBoard authority** — espesor fabricado desde el tablero vinculado; nominal en conflicto deliberado para demostrarlo (R9).
- **Exact visual pins** — `assetRevisionId`/`sha256` exactos por miembro; sin fallback a `latest` (#668/#630).
- **MountFrame** — normalización no-identidad aplicada exactamente una vez; error de punto mundial 0.0 mm (E9/E10).
- **WebGL** — Proyectar Scenario 8 sobre Chromium real, consumiendo la configuración canónica.
- **SketchUp** — smoke host real TestUp CI `Success` 8/8 (108 aserciones) sobre SketchUp 2026.2.242.
- **Historical snapshots** — inmutabilidad del snapshot publicado frente a mutación de catálogo, en PostgreSQL real (R5).
- **Cross-renderer parity** — misma configuración canónica y mismas dimensiones fabricadas en los cuatro runtimes, verificada por tests que leen la evidencia host (R12).
- **No scaling / no mirror** — escala [1,1,1] y determinante +1.0 exacto en todas las mutaciones (E3/E20/E14).
- **MERIVOBOX pilot** — procedencia Blum KA-160/24-ES (pp. 240–245) documentada en `merivobox-pilot.md` (R1).

### 1.2 Criterios originales de #670 — diferidos / seguimiento (NO PASS)

Estos criterios del #670 original **no** están satisfechos por esta entrega y no se declaran PASS:

1. **Drilling host + provenance exacta** — estado: **DEFERRED**. Owner: el trabajo existente de provenance de manufactura/herrajes (issues de exportación a máquina y provenance). Regla vigente preservada: ninguna perforación se infiere desde el SKP; los miembros visuales nunca son autoridad de perforaciones.
2. **UX de administración Agregado/variante: simular → diff → confirmar → aplicar atómico** — estado: **GAP / FOLLOW-UP**. Búsqueda de issues abiertas (2026-09-18): no existe issue propietaria dedicada más allá del #670 padre. Se propone issue acotada: flujo simulate→diff→confirm→apply para cambio de familia/SKU/receta sobre el runtime ya entregado (reuso de #498/comandos existentes), incluyendo rechazo/red/retry/conflicto sin pérdida de estado y confirmación atómica; sin tocar el engine.
3. **Membresía de actores fijos/móviles para #529** — estado: **DEFERRED**. Owner: #529. Preservado el invariante: ninguna operación de apertura cambia la geometría canónica.

### 1.3 Matriz de cobertura por incremento entregado

La matriz siguiente evalúa los incrementos ya entregados del programa; no equivale a la clausura del #670 original (ver §1.2).

| Requisito / Criterio Original (#670) | Incremento | Estado | Justificación y Evidencia Verificada |
|---|---|---|---|
| **1. Modelo de Assets 3D y Revisiones**<br>Recursos inmutables, content-addressed por SHA-256, multi-tenant con RLS, soporte SKP/GLB. | #670-A | **PASS** | Entidades `assets`, `asset_revisions`, contratos OpenAPI/JSON Schema #496, DTOs generados y aislamiento RLS por tenant. |
| **2. Administración de Catálogo y Visual Bindings**<br>Separación estricta entre binding visual, precio y maquinado. UI Web administrativa. | #670-A | **PASS** | UI en `packages/ui` con `HardwareFormModal`, visual binding para hardware y agregados; inmutabilidad en publicaciones. |
| **3. Motor de Resolución de Assemblies (`Agregado`)**<br>Resolución de miembros rígidos vs piezas fabricadas; cálculo paramétrico continuo sin escalado de herrajes. | #670-B | **PASS** | Motor Go (`AssemblyResolver`) y TS (`resolveAgregadoAssembly`). Pruebas E1–E4 (+200 mm delta sin escalado ni mirroring, det=+1.0, escala=[1,1,1]). |
| **4. Selección Estricta de Variantes**<br>Selección por reglas dimensionales exactas; rechazo estricto fuera de rango sin fallback a la variante más cercana. | #670-B | **PASS** | Validación de holgura nominal (3.0 mm según Blum KA-160/24-ES). Rechazo en 449.9, 502.9, 530.1 mm probado en Go y TS. |
| **5. Política de BOM Comercial y Kits**<br>Unidad 'set' comercial para kits, miembros marcados `included_in_kit`, piezas de madera en lista de corte. | #670-B | **PASS** | `BomAllocationPolicy: IncludedInKit`; herrajes del kit no duplican líneas comerciales; fondo y trasera en lista de despiece. |
| **6. Normalización de MountFrame**<br>Soporte de orígenes arbitrarios de assets CAD con sustracción de offset en composición de coordenadas. | #670-B | **PASS** | Pruebas E9/E10 en Go, TS y SketchUp. Composición de matriz diestra ortonormal sin distorsión. |
| **7. Persistencia Histórica en PostgreSQL**<br>Aislamiento de snapshots publicados frente a mutaciones del catálogo activo. | #670-B | **PASS** | Prueba real en PostgreSQL `TestMerivoboxPilotHistoricalPersistence_R5`: mutación del catálogo no afecta snapshots S1 congelados. |
| **8. Visualización WebGL / Proyectar 3D**<br>Proyección de escena, renderizado de assemblies rígidos y mutación de scene graph sin bifurcaciones por marca. | #670-C | **PASS** | Suite Playwright WebGL real (`tests/visual/proyectar-webgl.spec.ts` Escenario 8): mutación W600 -> W800 y cambio NL 450 -> NL 500 sin errores. |
| **9. Runtime de Host SketchUp**<br>Carga de assets, colocación jerárquica, definiciones compartidas, rollback atómico, save/reopen y undo/redo. | #670-D | **PASS** | `TC_MerivoboxPilotSmoke.rb` y suite unitaria `merivobox_pilot_test.rb` (879 runs, 0 failures, 0 errors). RBZ determinista verificado. |
| **10. Piloto Real MERIVOBOX**<br>Validación con catálogo Blum KA-160/24-ES (pp. 240–245); procedencia `REAL_VERIFIED`; $W$ vs $LW$ en Go/TS/Ruby. | #670-E | **PASS** | Dossier `merivobox-pilot.md`; pruebas E1–E20 en los 3 runtimes; evidencia en `progress/host_smoke_670_e_merivobox_pilot_evidence.json`. |
| **11. Independencia de Binding Visual (R7)**<br>Evaluación con o sin pins visuales genera idénticas variantes, transforms y BOM. | #670-E | **PASS** | Verificado en Go (`TestMerivoboxPilotEndToEndGates_E1_E20`), TS (`agregadoAssembly.test.ts`) y Ruby (`merivobox_pilot_test.rb`). |
| **12. Cero Bifurcaciones por Marca en Core**<br>Prohibido `if blum`, `if merivobox`, `MerivoboxResolver` o renderer específico. | Core | **PASS** | Verificado estáticamente: 0 referencias condicionales en Go engine, TS domain, WebGL y extensión SketchUp. |
| **13. CAD Propietario en Git**<br>Archivos .skp de catálogo oficial Blum en repositorio. | N/A | **OUT-OF-SCOPE** | Por política legal y de licenciamiento, CI utiliza fixtures geométricos sintéticos válidos. CAD propietario se carga por tenant vía UI. |
| **14. Generación CNC / PTX de Mecanizado**<br>Exportación de perforaciones para correderas y fijaciones frontales. | Downstream | **OUT-OF-SCOPE** | Mapeo de tolerancias y puntos de perforación documentado en `merivobox-pilot.md`; implementación corresponde a issues de exportación a máquina. |
| **15. Animación Dinámica de Apertura/Cierre**<br>Apertura interactiva del cajón en Web y SketchUp. | Downstream | **OUT-OF-SCOPE** | Pertenece a issue #529. |
| **16. Publicación Autoritativa desde Proyectar**<br>Creación de revisiones de diseño directamente desde el visor web. | Downstream | **OUT-OF-SCOPE** | Pertenece a issue #643. |

---

## 2. Puntos de Auditoría y Verificación Detallada

### 2.1. Arquitectura "Datos + Recipe + Variants + Assets" (Regla Invariante)
- **Cumplimiento:** 100%.
- El sistema no contiene ningún `MerivoboxResolver`, `BlumPlacementCalculator`, ni ramas condicionales `if blum` o `if merivobox`.
- Toda la lógica específica de MERIVOBOX se modela mediante:
  1. `VariantSet`: Rangos de profundidad con clearance nominal = 3.0 mm (`REAL_VERIFIED`, Blum KA-160/24-ES p. 242).
  2. `AssemblyRecipe`: Miembros rígidos (`side-left`, `side-right`, `runner-left`, `runner-right`) con reglas de offset paramétricas; componentes fabricados (`comp-bottom`, `comp-back`) con fórmulas basadas en $LW$.
  3. `CompatibilityRules`: Restricciones de espesor de tablero y límites dimensionales.
  4. `VisualBinding`: Referencias a revisiones de assets 3D con matrices de `MountFrame`.

### 2.2. Distinción Matemática: Ancho Total ($W$) vs Ancho Libre Interior ($LW$)
- **Cumplimiento:** 100%.
- La autoridad del mueble calcula $LW = W - (\text{leftThickness} + \text{rightThickness})$.
- La receta de MERIVOBOX opera sobre $LW$:
  - Fondo: ancho $LW - 58\text{ mm}$, largo $NL - 16\text{ mm}$, espesor 16 mm.
  - Trasera: ancho $LW - 58\text{ mm}$, alto 69 mm (Altura M), espesor 16 mm.
  - Corredera derecha: $X = LW - 15\text{ mm}$.
  - Costado derecho: $X = LW - 15\text{ mm}$.
- Soportados espesores de lateral de mueble de 15, 18 y 19 mm con readback exacto.

### 2.3. Invariante de Rigidez y Geometría
- **Cumplimiento:** 100%.
- Ningún herraje rígido se deforma, escala o refleja.
- En todas las mutaciones paramétricas (W600 -> W800, NL 450 -> NL 500):
  - Escala del herraje: $[1.0, 1.0, 1.0]$.
  - Determinante de la base: $+1.0$ exacto (sin inversión de mano ni matrices singulares).
  - Reutilización de `ComponentDefinition` verificada en SketchUp para los costados al cambiar el ancho.
  - Reemplazo limpio de `ComponentDefinition` al cambiar la longitud nominal sin escalado longitudinal.

### 2.4. Persistencia Histórica y Snapshot Authority
- **Cumplimiento:** 100%.
- El snapshot publicado `PublishedAssemblySnapshot` almacena de forma inmutable:
  - Definición completa del assembly resuelto (miembros rígidos, componentes fabricados, transforms).
  - Pins exactos de versiones de herrajes y assets (`hardwareId`, `assetRevisionId`).
  - Despiece de fabricación y BOM comercial.
- Prueba R5 en PostgreSQL demuestra que mutar el catálogo o la receta posterior a la publicación no altera el snapshot histórico recuperado.

### 2.5. Configuración Canónica Piloto y Paridad Cross-Renderer (R9–R12)
- **Autoridad numérica única (R12):** `contracts/fixtures/merivobox-pilot-canonical.json` define la configuración canónica (outer W 600 mm, costados 15/15 mm → LW 570 mm, NL 500; fondo 512 × 484 × 16 mm, trasera 512 × 69 × 16 mm; W 800 → 712 mm; delta miembros derechos +200 mm). Los CUATRO runtimes la consumen y comparan numéricamente:
  - Go: `TestMerivoboxCanonicalPilotParity_R12` + `TestMerivoboxCanonicalPilotHostEvidenceParity_R12` (`backend-go/internal/domain/engine/merivobox_canonical_test.go`).
  - TS: `packages/domain/src/merivoboxPilotCanonical.test.ts` (resolución canónica, autoridad de material y comparación contra la evidencia host).
  - Proyectar WebGL: `tests/visual/proyectar-webgl.spec.ts` Scenario 8 lee el mismo JSON para todas sus aserciones dimensionales.
  - SketchUp: `test_r12_canonical_configuration_parity` en la suite unit (`rake verify`, CI) y en el smoke host real (`TC_MerivoboxPilotSmoke`).
- **Autoridad de Espesor (R9):** el espesor fabricado de fondo y trasera proviene de la `MaterialBoard` vinculada (rol `MERIVOBOX_BOARD` → `mat-merivobox-board-16`, 16 mm), no del renderer ni de la geometría nominal. El contrato canónico fija deliberadamente la geometría nominal en 15 mm — en conflicto con el material — de modo que sólo la MaterialBoard puede producir el 16 mm observado; el test TS `R9: fabricated thickness authority is the bound MaterialBoard...` y el Scenario 8 de WebGL lo demuestran, y `AssemblyMesh`/`BoardMesh` no contienen ningún espesor hardcodeado (fallan cerrado si falta la autoridad).
- **Unificación semántica $W$ vs $LW$ (R10, R11):** la entidad Mueble/Layout calcula $LW = W - (\text{leftThickness} + \text{rightThickness})$ con los espesores REALES de la carcasa del seed (Costado Lateral → INTERIOR → `mat-arauco-blanco` 15 mm efectivo; el nominal de 18 mm pierde ante el material). El motor `ResolveAgregadoAssembly` recibe exclusivamente $LW$ (570 mm para W600; 770 mm para W800) y no infiere carcase. En Scenario 8 la cadena se verifica con readback del grafo de escena vivo: `assemblyResolvedWidth = posX(side-right) − posX(side-left) = 570 = 600 − 15 − 15` y `bottom.width = assemblyResolvedWidth − 58`. Los tests genéricos de Go y TS documentan explícitamente que sus `WidthMm`/`widthMm` son dimensiones del assembly (no W exterior de mueble).
- **Corrección de auditoría (importante):** la evidencia host anterior estaba editada a mano y el smoke nunca había corrido verde de verdad en el host (referenciaba una clase del suite unit que TestUp no carga, escribía literales en vez de valores medidos, y sus assets de bytes falsos caían silenciosamente al camino fallback sin MountFrame). Esta ronda lo corrige: smoke autocontenido, assets SKP reales generados por el host (con desvinculación del modelo activo), E9 con expectativa compuesta de constantes del layout, E12 con capturas exactas undo/redo, y evidencia con valores MEDIDOS desde el modelo. La paridad declarada abajo sólo es válida a partir de esta corrección.
- **Matriz de Paridad Cross-Renderer y Cross-Runtime (verificada contra la configuración canónica y la evidencia host real):**

| Propiedad Dimensional / Lógica | Go Domain / Engine | TS Domain | Proyectar WebGL | SketchUp Host (evidencia medida) | Paridad |
|---|---|---|---|---|---|
| **Assembly Inner Width ($LW$)** | 570.0 mm | 570.0 mm | 570.0 mm (readback de escena) | 570.0 mm (`side_right.before_translation_mm`) | **PARIDAD EXACTA** |
| **Fondo: Ancho (W600/NL500)** | 512.0 mm | 512.0 mm | 512.0 mm | 511.99999999999994 mm (≈512, ruido float) | **PARIDAD EXACTA** |
| **Fondo: Largo (NL 500)** | 484.0 mm | 484.0 mm | 484.0 mm | 483.99999999999994 mm (≈484) | **PARIDAD EXACTA** |
| **Fondo: Espesor** | 16.0 mm (MaterialBoard) | 16.0 mm (MaterialBoard, nominal 15 ignorado) | 16.0 mm (MaterialBoard) | 15.999999999999998 mm (≈16) | **PARIDAD EXACTA** |
| **Trasera: Ancho (W600)** | 512.0 mm | 512.0 mm | 512.0 mm | 511.99999999999994 mm (≈512) | **PARIDAD EXACTA** |
| **Trasera: Alto (Altura M)** | 69.0 mm | 69.0 mm | 69.0 mm | 69.0 mm | **PARIDAD EXACTA** |
| **Trasera: Espesor** | 16.0 mm | 16.0 mm | 16.0 mm | 15.999999999999998 mm (≈16) | **PARIDAD EXACTA** |
| **Fondo/Trasera: Ancho (W800)** | 712.0 mm | 712.0 mm | 712.0 mm | 712.0 mm | **PARIDAD EXACTA** |
| **Delta Miembros Derechos (W800)** | +200.0 mm | +200.0 mm | +200.0 mm | 199.9999999999999 mm (≈200) | **PARIDAD EXACTA** |
| **Invariante de Escala Rígida** | [1.0, 1.0, 1.0] | [1.0, 1.0, 1.0] | [1.0, 1.0, 1.0] | det 1.0 before/after | **PARIDAD EXACTA** |
| **Selección de Variante (NL 450 vs 500)** | Exacta por holgura 3.0 mm | Exacta por holgura 3.0 mm | Exacta (`hw-merivobox-450/500`) | Definiciones distintas por NL | **PARIDAD EXACTA** |
| **BOM Comercial de Kit** | `kit-merivobox-m` (qty 1) | `kit-merivobox-m` (qty 1) | N/A (proyección 3D) | `kit-merivobox-m` (metadata) | **PARIDAD EXACTA** |

La comparación numérica no es prosa: los tests de paridad Go y TS leen la evidencia host comprometida y fallan si cualquier runtime se desvía del canónico (tolerancia 1e-6 mm por el ruido inches→mm del readback).

---

## 3. Matriz de Evidencia Ejecutable

| Componente / Suite | Archivo de Prueba | Cobertura / Casos | Resultado |
|---|---|---|---|
| **Go Engine** | `backend-go/internal/domain/engine/assembly_resolver_test.go` | E1–E20, R3 ($W$ vs $LW$), R6 (límites estrictos), R7 (independencia visual) | **PASS** |
| **Go Canonical Parity** | `backend-go/internal/domain/engine/merivobox_canonical_test.go` | R12: resolución canónica + comparación numérica contra la evidencia host | **PASS** |
| **Go Storage** | `backend-go/internal/storage/agregado_revisions_test.go` | R5 (persistencia real en PostgreSQL, inmutabilidad S1 frente a R2) | **PASS** (contenedor desechable) |
| **TS Domain** | `packages/domain/src/agregadoAssembly.test.ts` | E1–E20, paridad de fórmulas, BOM kit policy, snapshots E14/E15 | **PASS** (1531/1531 en el paquete) |
| **TS Canonical Parity** | `packages/domain/src/merivoboxPilotCanonical.test.ts` | R9 (material > geometría nominal), R10 (cadena W→LW), R12 (canónico + evidencia host) | **PASS** (6/6) |
| **UI / BoardMesh–AssemblyMesh** | `packages/ui` (suite completa) | Exposición de `materialId`/`size` en userData; sin espesores en renderer | **PASS** (1945/1945) |
| **Proyectar WebGL** | `tests/visual/proyectar-webgl.spec.ts` | Escenario 8 (piloto canónico: W600/A → W800/A → W800/B, cadena W→LW con readback) + suite completa | **PASS** (8/8, Chromium real) |
| **SketchUp Extension (Verify)** | `bundle exec rake verify` | RuboCop 0 ofensas, unit 880 runs / 5951 aserciones (incl. paridad canónica R12), boundary 6/3179 | **PASS** |
| **SketchUp Extension (Smoke host real)** | `apps/sketchup-extension/test/testup/TC_MerivoboxPilotSmoke.rb` | Host real SketchUp 2026: E1/E2, E3/E20, E5/E6, E9/E10 (MountFrame, error 0.0 mm), E11 (reopen), E12 (undo/redo), E13 (fail-before-mutate), R12 (paridad canónica) | **PASS** (8/8, 108 aserciones, TestUp CI `Success`) |
| **Config de ejecución host** | `apps/sketchup-extension/testup-ci-670e.yml` | Reproduce el smoke host: `SketchUp -RubyStartupArg 'TestUp:CI:Config: …/testup-ci-670e.yml'` | **VERIFICADO** |
| **Evidencia Host Guardada** | `progress/host_smoke_670_e_merivobox_pilot_evidence.json` + `progress/host_smoke_670_e_testup_ci.json` | Valores MEDIDOS del modelo (no literales); head = HEAD de código exacto `159fa7e9`; RBZ sha256 `f9f0f02cc8a4ab87ac3e40796e5a29efda771a35f0ec0209b8fdba816564e524` | **VERIFICADO** |

**Nota de frescura de evidencia (R13):** la evidencia host se regeneró ejecutando el smoke real contra el HEAD de código final (`159fa7e9`) con el RBZ reinstalado desde `dist/` (sha `f9f0f02c…`, verificado por `rake verify`). El commit final del PR añade únicamente esta evidencia, este dossier y el reporte de progreso (cero líneas de código).

---

## 4. Conclusión de la Auditoría

#670-E is complete and ready to merge.
The parent #670 remains open until the remaining original criteria are
explicitly delivered or formally reassigned to their owning issues.

(Ver §1.1 para el alcance PASS del incremento, §1.2 para los criterios diferidos — drilling host/provenance, UX simulate→diff→confirm→apply y membresía de actores #529 — y §2.5/§3 para la evidencia canónica, host y de CI que se conserva sin cambios.)
