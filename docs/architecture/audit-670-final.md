# Auditoría de Aceptación — Programa #670: Herrajes y Conjuntos Paramétricos 3D

**Fecha:** 2026-09-17  
**Programa:** Granete, Programa #670 (#670-A a #670-E)  
**Alcance evaluado:** Contrato de arquitectura `docs/architecture/hardware-3d-assets-and-assemblies.md`, dossiers técnicos #670-A/B/C/D y piloto comercial MERIVOBOX #670-E (`docs/architecture/merivobox-pilot.md`).  
**Estado:** AUDITORÍA TÉCNICA FORMAL.

---

## 1. Resumen Ejecutivo y Matriz de Aceptación

El Programa #670 implementa la arquitectura completa para la gestión, resolución, proyección web y materialización en SketchUp de herrajes 3D y conjuntos paramétricos (`Agregados`), validado end-to-end con el piloto comercial MERIVOBOX (Altura M).

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

---

## 3. Matriz de Evidencia Ejecutable

| Componente / Suite | Archivo de Prueba | Cobertura / Casos | Resultado |
|---|---|---|---|
| **Go Engine** | `backend-go/internal/domain/engine/assembly_resolver_test.go` | E1–E20, R3 ($W$ vs $LW$), R6 (límites estrictos), R7 (independencia visual) | **PASS** (0.28s) |
| **Go Storage** | `backend-go/internal/storage/agregado_revisions_test.go` | R5 (persistencia real en PostgreSQL, inmutabilidad S1 frente a R2) | **PASS** (0.03s) |
| **TS Domain** | `packages/domain/src/agregadoAssembly.test.ts` | E1–E20, paridad de fórmulas, BOM kit policy, snapshots E14/E15 | **PASS** (1508/1508) |
| **Proyectar WebGL** | `tests/visual/proyectar-webgl.spec.ts` | Escenario 8: mutación W600/A -> W800/A -> W800/B en Three.js / WebGL | **PASS** |
| **SketchUp Extension (Unit)** | `apps/sketchup-extension/test/unit/merivobox_pilot_test.rb` | LayoutContract, deltas continuos, rigidez, no-scaling, rechazo de mirror | **PASS** (879 runs, 0 err) |
| **SketchUp Extension (Smoke)** | `apps/sketchup-extension/test/testup/TC_MerivoboxPilotSmoke.rb` | Real-host smoke: E1/E2, E3/E20, E5/E6, E9/E10, E11 (reopen), E12 (undo), E13 (fail) | **PASS** |
| **Evidencia Host Guardada** | `progress/host_smoke_670_e_merivobox_pilot_evidence.json` | Métricas exactas: RBZ sha256, deltas, transforms, errores de punto (<1e-3 mm) | **VERIFICADO** |

---

## 4. Conclusión de la Auditoría

El Incremento **#670-E** cumple satisfactoriamente todos los criterios de aceptación y las reglas arquitectónicas del Programa #670. No existen brechas funcionales en los componentes comprometidos. Las áreas diferidas (CAD propietario en repo, exportación de perforaciones a CNC y animación interactiva) están correctamente clasificadas como `OUT-OF-SCOPE` con sus caminos de integración documentados.

La entrega está lista para revisión independiente y handoff.
