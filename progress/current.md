# Sesión — F075 Build y Release Desktop (Instalador .exe/.dmg + Auto-Updater)

- **Fecha:** 2026-08-15
- **Feature:** F075 — `build_release_desktop`
- **Estado:** Implementada y verificada. init.sh + typecheck + build:desktop verde.

## Qué se implementó (F075 núcleo)

1. **Configuración `electron-builder` (`apps/desktop/package.json`):**
   - Targets configurados: Windows NSIS (`.exe` instalador + portable), macOS (`.dmg` + `.zip`), Linux (`AppImage` + `.tar.gz`).
   - Copia de assets de `apps/web/dist` empaquetados autónomamente para ejecución offline y standalone.
   - Scripts de empaquetado: `pnpm build:desktop` (`--dir`), `pnpm release:desktop` (`dist`), `dist:win`, `dist:mac`, `dist:linux`.

2. **Auto-Updater (`apps/desktop/electron/main.mjs`):**
   - Integración con `electron-updater` apuntando al repositorio GitHub (`tiagofur/muebleria`).
   - `checkForUpdatesAndNotify()` automático en segundo plano cuando la app está empaquetada.
   - Carga resiliente de `index.html` compilado en modo empaquetado/producción y dev.

3. **Iconos de aplicación:**
   - Script generador de icono oficial 512x512 RGBA (`apps/desktop/scripts/generate-icons.mjs`) produciendo `apps/desktop/build/icon.png`.

4. **Documentación de Release:**
   - Creado `docs/desktop-release.md` con guías de firma de código Authenticode `.pfx` (Windows) y Apple Developer ID (macOS) sin commitear credenciales, más flujo de publicación de releases en GitHub.
   - Actualizado `README.md` con comandos de build y release.


**Proyectar:** tarjeta "Zócalo (base del mueble)" en la pestaña props (tipo +
acabado contextual; el perfil/patas salen del catálogo del usuario). Altura
en Posición (chips existentes, ahora alimenta el BOM). 3D: `PlinthMesh` por
modo — melamina con material resuelto, perfil metálico con color del herraje,
patas visibles, none sin mesh (adiós caja gris #2c2f34). `project3dPreview`
propaga el tratamiento a colocados/cola/lineal.

**Creación automática:** el modal de alta escribe `baseMode`
(módulo → tipo). Store local + apiMappers (validación) + Go
(`ProjectItem.BaseMode`, migración aditiva 000042, queries en projects.go).

## Pulido Fase 3 (esta tanda)

1. **Editor de módulos amigable** (`ModuleEditorGeneralPanel`):
   - Label "Zócalo: ¿cómo apoya en el piso?" con 4 opciones en lenguaje de
     taller; primera opción "Automático según tipo de mueble" (recomendado).
   - Hints contextuales por modo, sin jerga de roles: melamina → "la pieza se
     genera sola al cotizar"; perfil → "se factura por ml, el acabado sale de
     tu catálogo de herrajes"; patas → "cantidad sugerida según ancho".
   - Semántica del default: sin baseMode = automático al cotizar. Re-guardar
     un módulo con 'none' explícito lo pasa a automático (deseado).
2. **Seed con acabados de perfil variados** (patrón catalog-driven):
   - `plantillaDemo.ts`: HER-ZOC-ALU (natural #c0c5cb) + HER-ZOC-BRO (bronce
     #8d6e42) + HER-ZOC-NEG (negro #2c2f34) con `previewColor`, en el grupo
     ZOCLO_PERFIL. Fluye al primer arranque vía plantillaCatalogWithModules →
     seedCatalogExpandedLatAm.
   - Go: seed inicial y `ensurePlinthCatalog` (upsert en bases existentes)
     con los 3 perfiles + preview_color (NULLIF para no pisar con '').
3. **Click en el zócalo 3D selecciona el mueble** — ya funciona: los meshes
   del PlinthMesh son hijos del grupo del módulo, cuyo onClick los captura.
   Tocar el zócalo → inspector con la tarjeta Zócalo.

## Drag-paint del zócalo — decisión documentada (NO hecho)

Arrastrar un material de la paleta sobre el zócalo cruza dos catálogos: la
MaterialPalette de Proyectar lista **materiales ambiente** (Acabados), pero el
zócalo de melamina consume un **MaterialBoard** vía choice ZOCLO (el BOM
necesita espesor/canto/costo). Hacerlo bien requiere o (a) una sección de
materiales de tablero en la paleta de Proyectar, o (b) un puente
acabado→tablero declarativo. No se parchea con un cast de ids.

## Verificación

- `pnpm test`: domain 484 (+9), storage 84 (+2), ui 760 (+5), web 232,
  desktop 9 — verde.
- `pnpm typecheck` monorepo verde. Go `go build` + `go test ./internal/...` verde.
- Tests de ModulesScreen (baseMode + B por testid) y engine golden intactos.

## Notas de sesión

- Al iniciar había 16 archivos sin commitear de la sesión anterior (mesada
  pintable 3D, completa y verde). Commiteados aparte en `3103757` y pusheados.
- Bug corregido durante la implementación: `resolveModuleBaseClearanceMm`
  miraba el modo del módulo aunque el ítem pidiera zócalo → ahora el modo
  efectivo (ítem → módulo) decide la altura.

## Pendiente / follow-ups

- Drag-paint del zócalo (ver decisión arriba — requiere definir el puente
  acabado→tablero o paleta de tableros).
- Textura del tablero en el zócalo 3D (hoy color del material).

## Guía de uso (post-F087)

- `docs/guia-de-uso.md`: manual de usuario final de toda la app (roles,
  sesión, catálogo en orden de armado, cotizar, Proyectar, producción,
  vitrina, administración, tips) con **sección dedicada a zócalos** (§8):
  automático al cotizar, tarjeta en el inspector, cómo registrar acabados de
  perfil propios (paso a paso Herrajes + Grupos) y qué pasa detrás
  (síntesis, ml, patas, precedencia de altura). Etiquetas verificadas contra
  la UI real (tabs "Muebles/Materiales/Ambiente", inspector "Mueble/Posición",
  botón "Proyectar").
- Referenciada desde `AGENTS.md` (mapa de docs) y `README.md`.

## Fix post-feedback — preview de costo bloqueado al elegir zócalo (F087)

Reporte del usuario: al poner baseMode "perfil" el preview se bloqueaba
listando ZOCLO_PERFIL; con melamina listaba INTERIOR (grupo que sí tiene).

Causas (3):

1. `moduleHelpers.usedOptionRolesForModule` es un colector de roles duplicado
   que no conocía los roles sintetizados por baseMode → los defaults del
   preview nunca llenaban ZOCLO/ZOCLO_PERFIL/PATAS → el breakdown explotaba.
   Fix: baseMode→rol (constantes de dominio) en el colector; el preview y el
   3D llenan el primer miembro del grupo como default.
2. El catch de `computeModuleCostPreview` devolvía `missingGroups: required`
   (TODOS los requeridos) en vez de los realmente sin elección → señalaba
   grupos sanos (el "INTERIOR" del reporte). Fix: lista honesta = grupos
   usados (requeridos u opcionales) sin default.
3. El error de dominio se descartaba en silencio. Fix: `previewError`
   plumbeado App → ModulesScreen → ModuleEditorForm/DetailView →
   CostPreviewPanel, que ahora muestra el mensaje real.

Tests: defaults de roles de base (moduleHelpers), panel con error honesto
(CostPreviewPanel.test). Suites: ui 763, web 232, resto intacto; typecheck
monorepo verde.

## Fix 2 post-feedback — "Elegí un preset de medida" en el preview

Segundo reporte del usuario: con los defaults de zócalo ya resueltos, el
preview avanzó hasta chocar con el gate de presets comerciales — el proyecto
sintético del preview no llevaba measurePresetId y MOD-GAB-01 define presets
(resolveModuleMeasurePreset exige selección). Antes este error estaba
enmascarado por el gate de grupos.

Fix: el ítem sintético usa `defaultMeasurePresetId(module)` (primer preset),
igual que el flujo de alta de ítems. `computeModuleCostPreview` exportada
para tests.

Tests (apps/web/src/modulePreview.test.ts): preset default desbloquea el
preview; plinth_strip calcula y factura 0.6 m × 18 = 10.8; grupo sin
miembros → blocked con lista honesta (ZOCLO_PERFIL sí, INTERIOR no).
Suites: web 235, init.sh verde.

## F088 — Vueltas laterales automáticas + espesor + textura (nueva sesión)

F087 marcada `done`; F088 `in_progress` → implementada y verificada.

**Dominio (`plinth.ts`):**
- `PlinthSides` { left, right, back }; `plinthSidesForPlacement` — vecinos por
  muro (offsets + anchos, tolerancia 30 mm), extremos de muro cubren,
  free/isla expone left+right+back.
- `plinthReturnDepthMm` (D − recepa 50); `BaseResolutionContext.plinthSides`;
  `baseContextForItem(project, item, catalog?)` resuelve exposición con anchos
  de módulo (preset default → externalDims → estructura).
- `applyBaseTreatment`: melamina sintetiza `ZOCLO-LADO-AUTO` por lado expuesto
  (largo = vuelta 510 con D=560, alto = B, canto L1, material del frente);
  perfil sintetizado con factor ml (W + vueltas)/W; módulos con zócalo propio
  NO reciben vueltas sintetizadas.
- Motores pasan `catalog` al contexto. Compatibilidad: sin baseMode o sin
  placement el BOM no cambia (484 previos intactos).

**3D:** convención verificada — en el grupo, z=depth es el FRENTE (la puerta se
posa en y=PD; el grupo mapea [x, z_altura, y_prof]); el zócalo viejo (masa
sólida) estaba orientado al revés de su comentario. `PlinthMesh` reescrito
como paneles delgados: frontal retraído `recepa` del frente, laterales y
trasera según `plinthSides`, espesor = material (melamina) o 16 mm (perfil,
que además quedó retraído — antes a ras del frente). `PlinthPanelMesh` con
textura del material y veta (U) a lo largo de cada panel.

**Preview/studio:** `ProjectModule3DInstance` += `plinthSides` (por placement)
y `plinthMaterialThicknessMm`; studio los mapea a la escena.

**Tests:** domain 490 (+6: vecinos en corrida, isla, vuelta melamina, ml 1.62
con dos vueltas, compatibilidad sin lados, sin vueltas con pieza propia).
init.sh exit 0; typecheck monorepo verde. Guía §8.4 actualizada con vueltas.

**Pendiente:** drag-paint (puente acabado→tablero); grano por cara si se pide.

---

## Polish UI — Tab General del editor de Agregados (2026-08-15)

Sesión corta de polish (skill impeccable, register product) disparada por pedido
directo del usuario. Sin feature nueva de `feature_list.json`.

**Qué cambié** (`packages/ui/src/agregados/`):
- Nuevo `editor/AgregadoEditorGeneralPanel.tsx`: la tab General pasa de pila
  plana de campos a workspace 2-col (patrón de `ComponentEditorGeneralPanel`).
  Columna principal: Identidad (código/nombre), Dimensiones de referencia con
  hint que explica que W/H/D locales alimentan las fórmulas de piezas/herrajes
  y la Vista 3D, descripción y notas. Aside: Resumen (readout vivo
  `W × H × D mm` con badge de lista, conteos de piezas/herrajes con botones
  que saltan a esas tabs) + guía "Cómo se define" (3 pasos: dims → piezas →
  herrajes).
- `AgregadoEditorForm.tsx`: tab General delega al panel; tabs con `id` para el
  contrato `aria-labelledby`; panel con `role="tabpanel"` (drift a11y vs
  Componentes/Estructuras). Inputs de dims muestran placeholder "Opcional"
  en vez de `0` (antes de Estructuras).
- `agregados.css`: bloque `.agregado-general__*` (grid 1fr → 1.4fr/1fr a
  900px, cards, summary rows, steps numerados) — solo tokens del design
  system.
- Tests (`AgregadoEditorForm.test.tsx`): readout de dims, conteos, omisión
  del readout sin dims, salto a tabs desde el resumen, contrato tabpanel.

**Verificación:** `pnpm --filter @muebles/ui test` (769 ✓), `pnpm test` full
monorepo ✓, `pnpm typecheck` ✓. En la app real (dev server + browser):
layout 2-col a 1440px, readout `600 × 720 × 18 mm`, accesos directos cambian
de tab.

**No cambié (a propósito):** el código sigue editable al editar un agregado
(en Componentes/Estructuras se congela) — decisión de producto pendiente;
hay validación de unicidad al guardar.

---

## SUPER Judgment Day + Critique — Módulo Producción (2026-08-15)

Sesión de evaluación (skill impeccable, critique; sin cambios de código). Pedido
directo del usuario: revisión profunda de todo /produccion con foco especial en
etiquetas (pantalla + diseño de etiqueta).

**Método:** lectura completa de `packages/ui/src/production/` (18 archivos) +
capa dominio/excel vía 2 exploradores (etiquetas PieceLabel/ZPL, pack, PDFs,
Optimizer); recorrido autenticado en vivo con usuario de prueba admin (creado
con `cmd/admin create` y **borrado al cerrar**); 20 screenshots + snapshots DOM;
pruebas de interacción (Esc del modal ZPL, botón Descargar del doc Despiece,
gate ZPL deshabilitado en Demo plantilla); `detect.mjs` sobre el módulo (limpio).

**Resultado:** 24/40 (Acceptable). Snapshot completo en
`.impeccable/critique/2026-08-15T17-17-10Z__localhost-produccion.md`.

**Top findings:**
1. [P1] Etiquetas partidas en 2 casas (PDF en Documentos, ZPL escondido en
   Optimización) con datos degradados en ZPL (sin canto asignado, sin nombre de
   módulo, QR con nombre en vez de id) + "Imprimir ZPL" imprime código fuente.
   Propuesta: sistema de etiquetas unificado v2 (alcance→formato→preview
   fiel→export PDF/ZPL), QR payload v2 con rev/cantos/veta/cantidad, layout con
   medida gigante + banda de color por material + mini-diagrama de cantos.
2. [P1] Botones/silencios: "Descargar" del doc Despiece navega de tab
   (verificado); nesting CSV 0 filas = no-op; annexos del pack omitidos en
   silencio.
3. [P1] Interrupciones: tour overlay reaparece en cada full page-load y bloquea
   /produccion; JWT 15 min sin refresh → expulsión silenciosa al login (2 veces
   durante la revisión).
4. [P2] Optimización mezcla 4 temas; exports "oficiales" deberían vivir en
   Documentos; L1 board puede clipear piezas (sin paginar); merma default fija
   10% engañoso.
5. [P2] Despiece sin espesor/veta/canto-asignado, sin subtotales, sin filtro
   "solo frentes" (prometido en production-module.md §6.3).
Hallazgos menores: `.btn--secondary` inexistente usado 6+ veces; zpl css con
paleta slate hardcodeada; cola sin señales pack/nesting (§6.0 las pide); totales
de fábrica pobres (faltan m² por material y ML de canto); stale banner gris;
Módulos sin ficha read-only (§6.2).

**No toqué código** — el plan de acción queda en el snapshot para decidir con el
usuario el orden (recomendado: shape del sistema de etiquetas → harden de
interrupciones → clarify/harden de botones y silencios → craft despiece-v2).

---

## Producción — fixes del Judgment Day (2026-08-15, tarde)

Implementación post-critique con el orden acordado con el usuario (A→B→C→D).
Sin feature nueva de `feature_list.json` (pedido directo). OJO: hay trabajo CRM
(fotos/garantías/mensajes) de OTRA sesión en el árbol — commiteé solo mis
archivos/hunks (staging quirúrgico en App.tsx y domain/index.ts).

### A — Harden interrupciones
- Tour de bienvenida: persiste "visto" en CUALQUIER cierre (X/Omitir/Terminar/Esc);
  checkbox eliminado (ya no tiene propósito); abre solo en Inicio (navId 'home'),
  nunca sobre /produccion; Esc cierra. Files: `packages/ui/src/onboarding/*`,
  App.tsx effect.
- Sesión expirada: `markSessionExpired()` en workspaceStore (los 3 sitios 401 lo
  usan) → `sessionEndReason: 'expired'` (memoria, no persist) → `LoginScreen`
  muestra banner warning "Tu sesión expiró…". Se limpia al re-login/invitado.
  (Verificado en vivo: el tour aparecía en cada full page-load bloqueando
  /produccion; y la sesión JWT de 15 min expulsaba en silencio 2 veces.)

### B — Etiquetas v2 (la casa única)
- Nueva tab **Etiquetas** en el hub (entre Despiece y Herrajes; ruta
  `/produccion/:id/etiquetas`). Alcance (módulo/material/búsqueda) → modo copias
  (1 por pieza | 1 por unidad ×cant) → preview fiel (QR REAL renderizado con
  `qrcode`) → export. Un solo builder de datos: `generatePieceLabels` del dominio
  (moduleName real + edgeBand code/name; antes el ZPL usaba un mapping degradado).
- **QR v2** (`pieceLabelQrPayload`): + qty, edges ("L1+W2"), edge (canto
  asignado), rev (OP). Mismo payload en PDF y ZPL. En ZPL el projectId ahora es
  el id real (antes: nombre del proyecto).
- PDF (`pieceLabelsPdfExport`): `perUnit` multiplica etiquetas por cantidad;
  header con `OP rev. N` para trazabilidad de regeneraciones.
- ZPL: preset/DPI/borde **persistidos** por usuario
  (`muebles_label_printer_v1`, helpers con fallback seguro); descarga batch
  `etiquetas_{slug}_{preset}[_por_unidad].zpl`; hint honesto de impresión raw
  (el botón "Imprimir ZPL" que imprimía código fuente fue ELIMINADO junto al
  modal `ZplLabelPreviewModal*`).
- **Pack ZIP**: ahora incluye `etiquetas_zpl_{base}.zpl` (preset default
  100×50 @203) y el resultado lista `omissions[]` (elevaciones/preview/armado/zpl
  que fallaron) → toast "(sin: …)".
- Optimización: fuera exports oficiales/ZPL/CSV/perforaciones (migrados a
  Documentos/Etiquetas); intro apunta a Documentos. Documentos: `actionLabel`
  honesto ("Configurar" para ZPL/CSV-config → abre tab/modales; "Ver tab" para
  despiece — antes decía "Descargar" y navegaba). + entradas CSV configurable y
  Perforaciones JSON.

### C — Silencios
- Import nesting CSV con 0 filas válidas → error visible con nombre de archivo
  y columnas esperadas (antes: no-op silencioso).

### D — Despiece v2 + Códigos Limpios + Contornos y Etiquetas 100x150 Ricas (completados)
- **Códigos de Pieza Limpios y Únicos (CNC-ready)**: Eliminados por completo los UUIDs y sufijos internos (`-copy-0`, hashes de 36 caracteres). Ahora las piezas generan códigos secuenciales y legibles `{moduleCode}-P01..PN` o `{moduleCode}-{partCode}` con discriminador de línea para repeticiones (`MOD-01-L2-P01`), garantizando unicidad global por proyecto para archivos de CNC, código de barras/QR y etiquetas ZPL/PDF.
- **Contorno Visual de Enchapado (ZPL, PDF, UI Preview)**: En las etiquetas de 50×25 mm, 100×50 mm y hojas de etiquetas PDF/pantalla, se añadieron barras de contorno de alto contraste en los bordes correspondientes a los lados encintados (`L1` superior, `L2` inferior, `W1` izquierdo, `W2` derecho).
- **Etiqueta 100×150 mm Industrial Enriquecida**: Rediseñada la etiqueta grande de taller para incluir diagrama esquemático de la pieza con cotas (`L1`, `L2`, `W1`, `W2`), indicadores gráficos de canto en cada lado, dirección de veta longitudinal (`grain`), bloque de espesor, y zona inferior con QR grande de escaneo para máquinas CNC / control de piso.
- **Despiece v2**: tabla enriquecida con columna de **Espesor** (`thicknessMm` explícito), renderizado de **Cantos asignados** (código/nombre + espesor en mm de la cintilla junto a los flags `L1/L2/W1/W2`), checkbox de filtro rápido **"Solo frentes"** (puertas, frentes de cajón, tapas), y descripción limpia de pieza con módulo en subtítulo sutil.
- **Cola de producción**: tarjetas de obra muestran fecha de **Aceptación** (`Aceptado DD/MM/YYYY`) derivada de `priceSnapshot.capturedAt`, junto a la fecha de actualización y las señales de Pack/Nesting.
- **Resumen OP**: stat cards principales (`prod-hub__totals`) ampliadas para incluir **m² totales de tablero** y **ml totales de canto** agregados de toda la obra (`summarizeProductionTotals`), manteniendo el desglose por material/canto en el bloque inferior.

### Verificación
- domain 519, excel 63, ui 814, web 242, storage 84, desktop 14 — todo verde en `./init.sh` y `pnpm test`.
- `pnpm typecheck` monorepo verde (0 errores).

### Pendiente / follow-ups
- Escaneo QR en Piso (paperless) usando payload v2 (F089).
- Métricas y Analytics del Taller (F090).




