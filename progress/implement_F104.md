# Implement F104 — Page Chrome Rollout I: Catálogos y Librería

**Fecha:** 2026-08-19 · **Feature:** `page_chrome_rollout_catalogs_library`

## Qué se hizo

Migración de las 9 pantallas de catálogos/librería al esqueleto único
(`docs/design.md` §4.1a): `PageHeader`/`PageToolbar` de `packages/ui/src/common/`
reemplazan el markup local `catalog-page__header/__toolbar/__filters`.

| Pantalla | Archivo | Chip | Primaria | Notas |
|---|---|---|---|---|
| Materiales | `catalogs/MaterialsCatalog.tsx` | Layers | Nuevo material | toolbar search+chips |
| Cantos | `catalogs/EdgesCatalog.tsx` | Minus | Nuevo canto | idem |
| Herrajes | `catalogs/HardwareCatalog.tsx` | Settings2 | Nuevo herraje | idem |
| Acabados | `catalogs/AmbientMaterialsCatalog.tsx` | Palette | Nuevo acabado | título «Catálogo de Acabados»→«Acabados» (§4.1b label de nav); secundaria «Editar categorías»; toolbar dentro de `module-list-main` |
| Grupos | `optionGroups/OptionGroupsScreen.tsx` | ToggleLeft | Nuevo grupo | toolbar search |
| Muebles | `modules/components/ModuleListView.tsx` | Package | Nuevo mueble | secundaria «Editar categorías»; toolbar en columna principal |
| Estructuras | `structures/components/StructureListView.tsx` | LayoutGrid | Nueva estructura | toolbar search+chips |
| Componentes | `components/editor/ComponentListView.tsx` | Puzzle | Nuevo componente | toolbar con chips + filtro ubicación |
| Agregados | `agregados/editor/AgregadoListView.tsx` | Blocks | Nuevo agregado | copy a sentence case («Nuevo agregado», «Sin agregados», «Crear agregado») |

Extras de contrato aplicados:
- Iconos `strokeWidth={1.5}` + `aria-hidden` en primarias que no lo tenían
  (Estructuras/Componentes/Agregados).
- `ariaLabel` de toolbar siempre distinto del aria-label del search
  («Buscar y filtrar X») — evita colisión en queries RTL y redundancia.
- Una sola `.btn--primary` por header (verificado por test).
- Read-only (`canMutate=false`): header sin primaria (acción oculta, §4.1a.3).

## Alias CSS

`catalog-page__*` sigue vivo para Customers/Settings/Users (F105); no hubo
aliases huérfanos de esta ola. Las definiciones compartidas ya viven en
`common/pageHeader.css`.

## Tests

- Nuevos: `catalogs/pageChromeRollout.test.tsx` (7) y
  `modules/components/libraryPageChrome.test.tsx` (5). Cubren header compartido
  (h2 + icon-chip svg + primaria única), toolbar (search/chips/placement),
  ocultamiento por catálogo vacío y modo read-only.
- Regresión: colisión de `getByText(/Buscar muebles/)` en `ModulesScreen.test`
  resuelta cambiando el ariaLabel de la toolbar (patrón F101).

## Verificación

- `pnpm --filter @muebles/ui test`: **1006/1006** (111 archivos).
- `pnpm typecheck`: verde (domain/ui/web/desktop/mobile).
- `./init.sh`: verde completo.
- Detector Impeccable (`detect.mjs --json packages/ui/src apps/web/src`): 0 hallazgos.
- Smoke visual (IAB + Vite, modo invitado): Materiales/Muebles/Grupos a 1280,
  Materiales/Muebles a 390, Materiales a 768 — icon-chip visible, una primaria,
  toolbar bajo el header, sin overflow horizontal (scrollWidth == clientWidth a
  390; tabla en scrollport documentado). Capturas efímeras en `/tmp/f104-smoke/`.

## Fuera de scope (explícito)

- Customers/Settings/Users/Showcase y dashboards (F105/F106).
- Tabs locales de editor forms (F109), badges/stats locales (F111).
- Calibración del tinte de área (F107) — el chip usa los tokens actuales.
- WIP ajeno `packages/domain/src/processStage.{ts,test.ts}` no tocado.
