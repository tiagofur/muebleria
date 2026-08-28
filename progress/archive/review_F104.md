# Review — feature F104

**Veredicto:** APPROVED

## Checkpoints

- C1: [x] init.sh exit 0 (re-ejecutado por el reviewer tras el último cambio; suites domain/ui/web/desktop/mobile verdes)
- C2: [x] Una sola feature `in_progress` (F104); tests asociados pasan (UI 1006/1006); `current.md` describe la sesión
- C3: [x] Sólo presentación en `packages/ui`; sin lógica de dominio, sin fs, sin colores/px nuevos (todo vía primitivos compartidos que ya usan tokens)
- C4: [x] `pnpm --filter @muebles/domain test` verde dentro de init.sh; no se tocó export ni storage
- C5: [x] Al cierre: history entry, feature `done`, `current.md` en plantilla

## Diseño UI/UX (docs/design.md §8)

- D1: [x] Sin valores hardcoded: la migración reutiliza `PageHeader`/`PageToolbar`/`.btn`/tokens existentes; detector Impeccable 0 hallazgos (`packages/ui/src` + `apps/web/src`)
- D2: [x] Patrón §4.1a/§4.2 intacto por pantalla (tabla-expand catálogos, card-detalle librería); rutas, RBAC (`canMutate`), modales y flujos sin cambios
- D3: [x] Modales no tocados (contrato existente)
- D4: [x] Toasts no tocados
- D5: [x] Iconos Lucide únicamente; `strokeWidth={1.5}` normalizado en las primarias de Estructuras/Componentes/Agregados que no lo tenían; icon-chip decorativo con `aria-hidden` (el título es el nombre accesible)
- D6: [x] Sin animaciones nuevas; `pageHeader.css` mantiene reduced-motion existente
- D7: [x] Gate §8: estados de pantalla intactos, una primaria por nivel **verificada por test** (`.btn--primary` único por header), read-only oculta la primaria (§4.1a.3), responsive smoke 390/768/1280 con overflow comprobado por estilo computado (scrollWidth == clientWidth a 390) y screenshot review con análisis visual (icon-chip, toolbar, sin solapamientos)
- D8: [x] Copy §7: título «Acabados» alineado al label de nav (§4.1b), sentence case en Agregados («Nuevo agregado», «Sin agregados», «Crear agregado»); aria-label de toolbar distinto del del search (colisión RTL corregida)

## Tests

- `catalogs/pageChromeRollout.test.tsx` (7) y `modules/components/libraryPageChrome.test.tsx` (5): header compartido (h2 + chip svg + primaria única), toolbar (search/chips/placement), vacío→sin toolbar, read-only sin primaria.
- Regresión: `ModulesScreen.test` verde tras desambiguar aria-labels.

## Nota de alcance de commits (instrucción para el cierre)

El working tree contiene WIP ajeno del dueño (`packages/domain/src/processStage.{ts,test.ts}`) y artefactos no trackeados de sesiones anteriores (explores/reviews F100–F103). El cierre de F104 **debe** commitear de forma atómica: (1) artefactos de critique + programa F104–F111, (2) código UI de F104, (3) cierre (feature_list/history/current + implement/review). Sin incluir el WIP ajeno.
