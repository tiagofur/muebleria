# Informe de Implementación — Issue #642: Detalle comercial coherente de una revisión exacta (Entrega 1)

> **Estado:** `IMPLEMENTED_PENDING_REVIEW`  
> **Rama:** `feat/642-quote-revision-detail-lines`  
> **Base:** `origin/main@b285cf314d3dae9caadfdc45f479ba8ce8e9da89`  
> **Fecha:** 2026-09-11  
> **Autoridad:** Issue #642, §16A de `docs/architecture/project-design-digital-thread.md` y `implementation_plan.md` aprobado.

---

## 1. Resumen ejecutivo

En esta primera entrega parcial de la issue #642, se resolvió la desconexión visual e histórica que existía en el detalle de **Cotizaciones**: mientras que la cabecera (moneda, estado, cliente, proyecto) y el total ya consumían la `QuoteRevision` exacta autoritativa, la lista de muebles, sus cantidades, medidas y opciones de acabado seguían leyéndose del `project.items` mutable. Esto provocaba que cualquier edición posterior en el proyecto afectara erróneamente la vista de una cotización histórica publicada o aceptada.

Con esta entrega:
1. La vista de detalle de cotización renderiza los muebles, cantidades, medidas y opciones de acabado **estrictamente a partir del `commercialSnapshot` e `items` de la `QuoteRevision` exacta**.
2. Mutaciones posteriores en el proyecto (`project.items`, cambio de acabados, alteración de medidas por defecto) tienen **cero efecto** sobre la revisión histórica.
3. Se desglosan con fidelidad las líneas con `quantity > 1`, mostrando sus unidades físicas individuales con sus identificadores de instancia (`furnitureInstanceId`), medidas y opciones independientes.
4. Dos líneas comerciales distintas con el mismo nombre de módulo permanecen separadas en tarjetas distintas asociadas a su respectivo `quoteLineId`.
5. Los estados de lectura (`loading`, `error`, `legacy`) cuentan con interfaces dedicadas y **jamás** hacen fallback a `project.items`.
6. En revisiones históricas, los controles de edición mutable (agregar mueble, quitar, cambiar cantidad, selectores de opciones de obra, herramientas de cotización) quedan completamente ocultos y deshabilitados (`canEditContent = false`).
7. El flujo inicial de borrador previo a la creación de Q1 (`empty` o sin autoridad comercial) se conserva al 100% con su comportamiento de edición y drag & drop original.

---

## 2. Componentes modificados y creados

### 2.1. Funciones puras de presentación
- **`packages/ui/src/projects/quoteRevisionPresentation.ts` [NUEVO]**:
  - `buildRevisionLines(snapshot, items)`: Mapea las líneas del snapshot congelado (`snapshot.lines`), agrupando sus unidades físicas (`snapshot.units`) estrictamente por `u.quoteLineId === line.quoteLineId` y resolviendo sus parámetros de medidas desde `items` estrictamente por `item.furnitureInstanceId === unit.furnitureInstanceId`. Preserva el `salePrice` de la línea cuando está autorizado (> 0), o lo mapea a `null` si los costos están redactados (evitando mostrar precios engañosos de `$0.00`).
  - `formatRevisionUnitDimensions(parameters)`: Extrae y formatea dimensiones en milímetros (`${w}×${h}×${d} mm`) admitiendo tanto notación `widthMm`/`heightMm`/`depthMm` como `width`/`height`/`depth`, y retornando `null` ante ausencia sin inventar valores por defecto de catálogo.
- **`packages/ui/src/projects/quoteRevisionPresentation.test.ts` [NUEVO]**:
  - 5 pruebas unitarias puras que validan formateo honesto de medidas, ausencia de parámetros, mapeo estricto por IDs, no-fusión de líneas con idéntico nombre y redacción de precios de línea.

### 2.2. Contrato de Contexto y Shell Web
- **`packages/ui/src/projects/components/projectDetailContext.tsx`**:
  - Se extendió la variante `'ready'` de `ProjectDetailQuoteAuthority` para exponer opcionalmente `snapshot?: QuoteCommercialSnapshot` e `items?: ReadonlyArray<QuoteRevisionItem>`.
- **`apps/web/src/ShellView.tsx`**:
  - En la construcción de `quoteAuthorityView`, cuando la autoridad está en estado `'ready'`, se pasan `snapshot: quoteAuthority.snapshot` e `items: quoteAuthority.revision.items`.

### 2.3. Componentes de UI y Design System
- **`packages/ui/src/projects/components/ProjectItemsSection.tsx`**:
  - Se añadieron ramas explícitas para los estados de la autoridad comercial:
    - `'loading'`: Indicador accesible de carga (`project-items-loading`) sin fallback a `project.items`.
    - `'error'`: Mensaje de error tipado con botón `Reintentar` (`project-items-error`, `project-items-retry`).
    - `'legacy'`: Alerta descriptiva y badge `Q{N} · Legacy` con reintento, impidiendo fallback mutable para cotizaciones legadas sin snapshot.
    - `'ready'`: Renderizado inmutable de tarjetas de línea con badge `Q{N} · Solo lectura` (`quote-revision-badge`). Desglosa líneas simples y líneas compuestas (`quantity > 1`) con sus tarjetas de unidad física (`quote-unit-{furnitureInstanceId}`), medidas formateadas y opciones de acabado congeladas (`{groupLabel}: {choiceLabel}`).
    - Modo borrador (`empty` o ausente): Se preserva intacto el renderizado mutable existente con drag & drop y pickers.
- **`packages/ui/src/projects/components/ProjectDetailView.tsx`**:
  - `canEditContent` ahora valida `(!quoteAuthority || quoteAuthority.kind === 'empty')`, asegurando que no se puedan disparar mutaciones sobre cotizaciones en visualización de revisión.
  - El bloque de herramientas colapsables (`project-detail__tools`) sólo se monta en modo borrador inicial.
- **`packages/ui/src/projects/components/ProjectOptionsSection.tsx` & `ProjectMeasureDefaults.tsx`**:
  - Se ocultan completamente cuando `quoteAuthority && quoteAuthority.kind !== 'empty'`.
- **`packages/ui/src/projects/projects.css`**:
  - Se incorporaron las clases `.project-item-card--readonly`, `.project-item-readonly-value`, `.project-revision-unit-card`, `.project-revision-unit-card__header` y `.project-item-card__price`, utilizando estrictamente tokens canónicos (`--surface-input`, `--surface-muted`, `--border-subtle`, `--text-primary`, `--text-secondary`) y respetando el test del design system (`designSystem.test.ts`).

### 2.4. Documentación arquitectónica
- **`docs/architecture/project-design-digital-thread.md`**:
  - Se actualizó la tabla de consumidores de la sección 16A registrando el detalle de muebles, líneas y medidas congeladas como migrado.

---

## 3. Pruebas y Verificación

### 3.1. Enfoque TDD
1. Se redactaron 3 pruebas de integración de componentes en `packages/ui/src/projects/ProjectsScreen.test.tsx` (líneas 574–823) antes de modificar `ProjectItemsSection.tsx`.
2. Se comprobó fehacientemente su fallo (RED) evidenciando que `project.items` mutable seguía mostrándose en pantalla.
3. Se implementaron los cambios en componentes y presentación hasta lograr que las 49 pruebas de `ProjectsScreen.test.tsx` quedaran en verde (GREEN).

### 3.2. Pruebas ejecutadas y resultados
- **Pruebas unitarias de presentación:**
  ```bash
  pnpm --filter @granete/ui test src/projects/quoteRevisionPresentation.test.ts
  # Output: 5 passed (100%)
  ```
- **Pruebas de componentes de proyectos:**
  ```bash
  pnpm --filter @granete/ui test src/projects/ProjectsScreen.test.tsx
  # Output: 49 passed (100%)
  ```
- **Pruebas del Design System (tokens):**
  ```bash
  pnpm --filter @granete/ui test src/design-system/designSystem.test.ts
  # Output: 9 passed (100%)
  ```
- **Verificación de tipos TypeScript en monorepo:**
  ```bash
  pnpm typecheck
  # Output: 7 of 7 packages passed (0 errors)
  ```
- **Suite completa de pruebas de unidad e integración:**
  ```bash
  pnpm test
  # Output: 35 test files passed, 445 tests passed (100%)
  ```
- **Verificación de drift en OpenAPI:**
  ```bash
  pnpm openapi:check
  # Output: OpenAPI generated files are current; drift negative proofs passed
  ```
- **Verificación de diff:**
  ```bash
  git diff --check
  # Output: Clean (sin trailing whitespace ni marcadores de conflicto)
  ```
- **Extensión del Browser E2E Gate (`tests/organization/project-reconciliation.spec.ts`):**
  - Se añadieron aserciones explícitas de visualización de medidas de Q2 (`650×720×${depthMm} mm`), badge `Q2 · Solo lectura` y ausencia de botones/inputs mutables (`Agregar mueble`, `Quitar`, `Cantidad`, `Medida`) en los viewports 390, 768 y 1280.

---

## 4. Compromisos y Límites de Alcance
- **Sin mutaciones en backend Go ni DB:** La base de datos y los endpoints existentes de QuoteRevision ya proveían `commercialSnapshot` e `items`. No se crearon migraciones ni se tocaron esquemas SQL.
- **Frente PTX / CADmatic (#650/#657):** Cero modificaciones en optimizador, corte o exportadores.
- **Proyectar 3D (#643):** Cero interferencia con el canvas o inspectores 3D.
- **Merge y cierre:** No se realizan cierres de tickets ni merges a `main`. Todo el código reside en la rama `feat/642-quote-revision-detail-lines`.
