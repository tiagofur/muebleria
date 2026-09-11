# Informe de Implementación — Issue #642: Detalle comercial coherente de una revisión exacta (Entrega 1)

> **Estado:** `IMPLEMENTED_PENDING_REVIEW`
> **Rama:** `feat/642-quote-revision-detail-lines`
> **Base:** `origin/main@b285cf316ab87bc95003de4dd6b4c00cbb713312` (verificada con `git merge-base`)
> **Fecha:** 2026-09-11
> **PR:** #663
> **Autoridad:** Issue #642, §16A de `docs/architecture/project-design-digital-thread.md` y `implementation_plan.md` aprobado.

---

## 1. Resumen ejecutivo

En esta primera entrega parcial de la issue #642, se resolvió la desconexión visual e histórica que existía en el detalle de **Cotizaciones**: mientras que la cabecera (moneda, estado, cliente, proyecto) y el total ya consumían la `QuoteRevision` exacta autoritativa, la lista de muebles, sus cantidades, medidas y opciones de acabado seguían leyéndose del `project.items` mutable. Esto provocaba que cualquier edición posterior en el proyecto afectara erróneamente la vista de una cotización histórica publicada o aceptada.

Con esta entrega y su ronda de correcciones R1–R5:
1. La vista de detalle de cotización renderiza los muebles, cantidades, medidas y opciones de acabado **estrictamente a partir del `commercialSnapshot` e `items` de la `QuoteRevision` exacta**.
2. Mutaciones posteriores en el proyecto (`project.items`, cambio de acabados, alteración de medidas por defecto) tienen **cero efecto** sobre la revisión histórica.
3. Se desglosan con fidelidad las líneas con `quantity > 1`, mostrando sus unidades físicas individuales con sus identificadores de instancia (`furnitureInstanceId`), medidas y opciones independientes.
4. Dos líneas comerciales distintas con el mismo nombre de módulo permanecen separadas en tarjetas distintas asociadas a su respectivo `quoteLineId`.
5. Los estados de lectura (`loading`, `error`, `legacy`) cuentan con interfaces dedicadas y **jamás** hacen fallback a `project.items`.
6. En revisiones históricas, los controles de edición mutable (agregar mueble, quitar, cambiar cantidad, selectores de opciones de obra, herramientas de cotización) quedan completamente ocultos y deshabilitados (`canEditContent = false`).
7. El flujo inicial de borrador previo a la creación de Q1 (`empty` o sin autoridad comercial) se conserva al 100% con su comportamiento de edición y drag & drop original.

---

## 2. Resoluciones de Revisión (R1–R5)

### R1 — Moneda congelada de los importes
- Se eliminó el formateo cableado con `$` fijo y `toLocaleString('es-AR')` en `ProjectItemsSection.tsx`.
- Se reutiliza `formatProjectMoney(line.salePrice, quoteAuthority.currency)` consumiendo la moneda congelada de la `QuoteRevision` exacta.
- Se preserva el código de moneda histórico (probado con `EUR`). Cabe señalar que el formateador compartido `formatMoneyDisplay` todavía antepone `$` a cualquier código de divisa (`$0.00 EUR`); no se modificó el formateador global en esta entrega ni se afirman símbolos dedicados sin `$`.
- No se realiza conversión cambiaria ni recálculo de importes.

### R2 — Cero real frente a importe oculto
- En `buildRevisionLines`, se eliminó la condición `salePrice > 0` como heurística de autorización.
- Se consume el contexto de visibilidad comercial (`amountsVisible: boolean`, gobernado por `showCosts`):
  - Cuando los importes son visibles: un importe positivo se muestra y un importe legítimamente cero (`salePrice: 0`) se conserva como 0 comercial.
  - Cuando los importes están ocultos (`amountsVisible: false`): `salePrice` se mapea a `null` y la UI no muestra un cero comercial engañoso.
- Se corrigió la suite de pruebas para no equiparar importes redactados/ocultos con importes legítimamente en cero.

### R3 — Estados por unidad y metadatos
- Se estandarizó la presentación de `lifecycleStatus` a través de `formatLifecycleStatus`:
  - `active` → `Activa`
  - `removed` → `Retirada`
  - `cancelled` → `Cancelada`
- El encabezado de cada tarjeta de unidad física se presenta de manera limpia como `Unidad {n}`, trasladando el UUID al bloque de metadatos técnicos accesibles (`.project-item-readonly-uuid`, `ID: {furnitureInstanceId}`) sin saturar el encabezado principal.
- Se añadió prueba de regresión para una línea con una única unidad terminal (`cancelled`/`removed`) y cantidad activa cero, verificando que se reconoce como historial retirado sin revivir demanda comercial ni de fabricación.

### R4 — Cobertura y navegador real
- Se añadieron 4 pruebas exhaustivas de integración en `packages/ui/src/projects/ProjectsScreen.test.tsx`:
  1. Q2 aceptada preserva nombres, materiales y dimensiones tras modificar deliberadamente el catálogo y el proyecto mutable.
  2. Cambio de proyecto y autoridad sin mezcla visual: el test valida que al alternar entre proyectos y autoridades se renderizan limpiamente la cabecera y filas correspondientes sin contaminación cruzada; no demuestra una respuesta HTTP tardía real en red.
  3. Flujo borrador pre-Q1: el test demuestra que bajo autoridad vacía los controles existentes de borrador (botón de agregar mueble, selectores de medidas y cantidad) continúan montados y disponibles, y que se puede continuar hacia "Crear nueva revisión" (no ejecuta el pipeline completo de mutaciones).
  4. Moneda histórica preservada (EUR), cero visible legítimo, importe oculto y unidades terminales.
- En `tests/organization/project-reconciliation.spec.ts`, las aserciones de badge `Q2 · Solo lectura`, medidas congeladas `650×720×{depthMm} mm` y ausencia de botones/inputs mutables se movieron **dentro del bucle de viewports (390 compact, 768 medium, 1280 expanded)**, verificándose en cada resolución.
- Se ejecutó el gate de navegador real (`scripts/organization-browser-gate.sh`) con Chromium, backend Go y PostgreSQL en Docker aislado: 4/4 pasaron en 28.1s. Capturas reales guardadas como artefactos.

### R5 — Metadatos de publicación y documentación
- Primera línea no vacía del PR #663: `Refs #642`.
- Exactamente una etiqueta de tipo: `type:feature`.
- SHA base del reporte corregido mediante readback exacto: `b285cf316ab87bc95003de4dd6b4c00cbb713312`.
- Desglose por paquete de pruebas documentado en detalle.
- Limitaciones y pendientes de #642 explícitamente delimitados.

---

## 3. Pruebas y Verificación

### 3.1. Desglose de pruebas por paquete
- **`@granete/ui`**: 161 archivos / 1719 tests pasados
  - `quoteRevisionPresentation.test.ts`: 6/6 tests pasados (incluye cero real, importes ocultos, estados de ciclo de vida).
  - `ProjectsScreen.test.tsx`: 53/53 tests pasados (incluye los 4 casos de regresión e integración de R4).
  - `designSystem.test.ts`: 9/9 tests pasados (tokens y diseño conformes).
- **`@granete/domain`**: 105 archivos / 1407 tests pasados.
- **`@granete/storage`**: 12 archivos / 191 tests pasados.
- **`@granete/excel`**: 37 archivos / 299 tests pasados (+3 skipped dependientes de hardware físico).
- **`apps/web`**: 35 archivos / 445 tests pasados.
- **`apps/desktop`**: 3 archivos / 17 tests pasados.
- **`apps/mobile`**: 10 archivos / 73 tests pasados.
- **Backend Go**: `go test ./...` exitoso en todos los paquetes (`api`, `application`, `auth`, `config`, `domain`, `storage`, `pilotreadiness`).
- **Verificación de tipos (TypeScript)**: `pnpm typecheck` exitoso en 7 de 7 paquetes de espacio de trabajo (0 errores).
- **Verificación de drift OpenAPI**: `pnpm openapi:check` exitoso (0 drift).
- **Control de diff**: `git diff --check` limpio (0 trailing whitespace, 0 marcadores).

### 3.2. Browser E2E Gate (`tests/organization/project-reconciliation.spec.ts`)
- Ejecutado vía `./scripts/organization-browser-gate.sh tests/organization/project-reconciliation.spec.ts`:
  - 4 pruebas ejecutadas y aprobadas (28.1s).
  - Aserciones de Q2 (badge de solo lectura, medidas `650×720×{depth} mm`, ausencia de controles de edición) evaluadas en cada iteración del bucle de viewports:
    - Compact: 390 × 844
    - Medium: 768 × 900
    - Expanded: 1280 × 800
  - Capturas visuales registradas en los 3 viewports:
    - `cotizaciones-compact-390.png` y `cotizaciones-compact-390-totals.png`
    - `cotizaciones-medium-768.png` y `cotizaciones-medium-768-totals.png`
    - `cotizaciones-expanded-1280.png` y `cotizaciones-expanded-1280-totals.png`

---

## 4. Compromisos y Límites de Alcance (#642)

- **Entrega acotada:** Esta es únicamente la Entrega 1 de la issue #642 (coherencia de líneas y detalle comercial en la cotización exacta).
- **Sin backend/migraciones:** La base de datos y los endpoints de QuoteRevision ya proveían `commercialSnapshot` e `items`. No se alteró el backend ni se aplicaron migraciones SQL.
- **Sin merge ni cierre:** La issue #642 permanece abierta. No se realiza merge de la rama `feat/642-quote-revision-detail-lines` a `main`.
- **Pendientes para entregas posteriores de #642:**
  - Entrega 2: Consumidores secundarios e inventario de listas/operaciones (Slice 2b).
  - Entrega 3: Generadores y exportadores documentales (PDF/XLSX/export handlers) vinculados a la revisión exacta.
- **Fuera de alcance:** PTX/optimizador (#650), Proyectar 3D, SketchUp plugin, ProductionRelease y retiro transversal del golden legacy.
