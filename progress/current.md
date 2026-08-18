# Sesión activa

- **Feature en curso:** F096 — FabricScreen v2 — board por obra
- **Inicio:** 2026-08-18 10:03 America/Bahia_Banderas
- **Plan:**
  1. Diseñar y documentar el board por obra conforme a la spec v2 y los tokens existentes.
  2. Extraer DTO/selector fuera de React para métricas de Corte y Encintado, picking y claims.
  3. Cablear datos/callbacks de claim, finish y batch desde el shell; conservar avances individuales.
  4. Implementar las cards y estados accesibles/responsive, con pruebas de selector y pantalla.
  5. Ejecutar pruebas focalizadas, typecheck y gate antes de revisión.

---

# Sesión — F089 Escaneo QR en Piso de Fábrica

- **Fecha:** 2026-08-15 (tarde-noche)
- **Feature:** F089 — `produccion_escaneo_qr_piso`
- **Estado:** Implementada y verificada. init.sh + typecheck + pnpm test verde.

## Qué se hizo antes (preservación)

Al arrancar había 24 archivos sin commitear de la tanda "Judgment Day
Producción" + fixes afines. Verificados (test/typecheck/go verde) y
commiteados en 4 commits atómicos: `13fc893` (RBAC reopen #257 en Go),
`966e291` (persistir base_mode), `f266ecd` (ambiente 3D en modal/presentación),
`08d3c7a` (fixes Judgment Day producción). Todo pusheado.

## F089 — implementación

**Dominio (`pieceLabelQr.ts`):** `parsePieceLabelScan` — parsea payload v2,
legacy v1 (sin `v` o `v:1`) y códigos planos (código de fábrica
`GAB-01-L2`, nombre). JSON roto cae a plainCode (el lector pudo leer
caracteres sueltos); null solo para blanco o JSON válido sin `module`.
Coerción segura de L/W/qty. Exportado desde `index.ts`.

**UI (`packages/ui/src/production/`):**
- `useHidScanner.ts`: listener global keydown que captura ráfagas de
  escopeta USB/BT (gap < 80ms, Enter final). Ignora teclas con modificadores
  y eventos apuntados a campos editables (el form manual sigue su curso);
  Escape/reset por inactividad. `enabled` para desactivarlo con el modal
  de cámara abierto.
- `ScanCameraModal.tsx`: `BarcodeDetector` nativo (QR + Code128) con
  selector de cámara (enumerateDevices, >1), lectura continua cada 250ms
  sobre canvas, debounce de lecturas repetidas. Sin soporte nativo →
  mensaje honesto + entrada manual (siempre disponible abajo). Sin lib
  nueva (cero dependencias).
- `ProductionOrderPaperlessPanel.tsx`: `matchModuleFromScan` ahora usa el
  parser del dominio; HID + cámara + form manual confluyen en
  `handleScanText`. **Auto-avance** al escanear (toggle "Auto-avanzar al
  escanear", default on) con debounce por ítem (1500ms — doble Enter de la
  pistola no doble-transiciona; verificado en test). Feedback: chip verde
  animado "✓ → Cortado" en el resultado + beeps WebAudio
  (`scanFeedback.ts`: hit/advance/miss, no-op sin AudioContext).
  Botón "Cámara" junto al scan. Botón manual "Marcar:" intacto.
- `production.css`: bloques `.prod-paperless__camera/auto/advance-chip` y
  `.prod-scan-camera__*` — solo tokens; animación con
  prefers-reduced-motion.

**Decisiones:**
- Sin `jsQR`/zxing: BarcodeDetector cubre tablet del taller (Chromium);
  donde no existe, fallback manual honesto. Cero deps nuevas.
- Estados reales del pipeline (`pending → cut → edged → assembled →
  installed`); la descripción de F089 en el backlog nombraba estados
  viejos (cutting/banded) — el código (`productionFloor.ts`) manda.
- "Registro de operario" del description: fuera del acceptance list; el
  floorStatus ya persiste vía `setItemFloorStatus` del shell. No se
  inventó logging nuevo.

## Verificación

- domain 526 (+7 parser), ui 835 (+21: useHidScanner 6, ScanCameraModal 3,
  PaperlessPanel 12), resto intacto (web 242, storage 84, excel 63,
  desktop 14). `pnpm test` + `pnpm typecheck` + `./init.sh` verde.
- Limitación: la decodificación real por cámara no es testeable en jsdom
  (sin getUserMedia/BarcodeDetector); cubierto por feature detection,
  fallback manual testeado y código defensivo en el loop (videoWidth 0,
  detect transitorio).

## Notas

- Hay 10 stashes viejos en el repo (higiene de `git stash list`, ver
  docs/git-workflow.md §5) — limpieza pendiente de acordar con el usuario.
- Siguientes: F090 (métricas/analytics), F077 (prep venta).



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




## F089 addendum — escaneo por cámara en smartphones (2026-08-15)

Pregunta del usuario: ¿funciona apuntar la cámara del celular al QR?

Respuesta técnica: `BarcodeDetector` nativo NO existe en iOS (ningún
navegador, todos WebKit), ni Firefox, y en Chromium desktop es
platform-gated (ChromeOS/macOS). Solo Android/Chrome lo tiene por defecto.

**Fix (commit siguiente):** fallback a `jsqr` (decoder QR puro JS, ~14KB,
cero deps transitivas) en `ScanCameraModal` cuando no hay detector nativo:
- `buildFrameDetector()`: BarcodeDetector (QR+Code128) si existe → si no,
  jsQR sobre ImageData del canvas (QR only).
- Estado `nocamera` separado de `permission`: si falta
  `mediaDevices.getUserMedia` (típico: página servida por HTTP, no HTTPS)
  → mensaje honesto que menciona el requisito de HTTPS.
- `video.play()` envuelto en `Promise.resolve` (jsdom devuelve undefined).
- Test nuevo: con getUserMedia mockeado y sin BarcodeDetector, el video
  monta y NO aparece el aviso "no soportado" (camino jsQR).

**Condiciones para que funcione en el celular del taller:**
1. Servir la app por **HTTPS** (o localhost) — getUserMedia exige secure
   context. HTTP en IP de LAN bloquea la cámara.
2. iOS: ahora sí funciona vía jsQR (QR de las etiquetas; Code128 solo con
   detector nativo).
3. El escaneo debe hacerse DENTRO de la app (modal Piso): el payload es
   JSON offline-friendly, no una URL — la app de cámara del sistema no
   abre la app al escanear (decisión de diseño #141).

**React Native (planes del usuario):** `parsePieceLabelScan` vive en
`@muebles/domain` (TS puro, cero deps) → importable directamente desde una
app RN; el payload JSON es agnóstico del cliente. Para deep-link desde la
cámara del sistema habrá que agregar variante URL del payload →
**documentado (2026-08-15): F091 en el backlog + decisión D7 en
docs/production-module.md §8 + nota en pieceLabelQr.ts.**

Verificación: ui 836 (+1), init.sh verde, typecheck verde.

## Higiene de stashes (2026-08-15, noche) — lista vaciada

Protocolo docs/git-workflow.md §5 ejecutado con backup físico previo en
`/tmp/muebles-stash-backup-20260815/` (10 patches + árbol untracked del
stash de agregados + hash de main antes de operar).

**Preservado en ramas wip/ pusheadas (trabajo real):**
- `wip/stash-agregados-20260808` — WIP temprano de agregados (22 archivos
  +501 y untracked AgregadosScreen/AgregadoEditorModal/agregadoDraft);
  probablemente supersede por F082-F085. Branch en su base original (81af3ed).
- `wip/stash-modules-fase3a2-20260720` — ModulesScreen +291 L "fase3a2 en
  rama equivocada" (base 4e6d206, julio). Probablemente obsoleto.

**Dropeados sin rama (verificados como ruido, todos con .patch en backup):**
- 6 × "atl": solo fingerprint/fecha de `.atl/skill-registry` (caché de tooling).
- "temp skill+helpers": test de `buildPresentationShareUrl` YA presente en
  main (verificado) + caché .atl.
- "WIP stash before batch improvements": caché .atl + BD binaria .freebuff
  (gitignored).

**Estado final:** `git stash list` vacío; working tree limpio; main intacto
(aa20d64 == origin/main); ambas ramas wip/ en origin.

## F080 — Capas de acabado por componente de herraje (2026-08-15, noche)

Descongelada por decisión del usuario (el disparador era "demanda de
catálogo complejo" — el usuario decide). Implementación completa:

**Dominio:** `HardwarePartRole` (body/base/grip) en types.ts +
`Hardware.partFinishes` (rol → preset id, opcional). En
hardwareFinishes.ts: `hardwarePartRolesForShape` (mapea cada forma 3D a
sus partes reales: bar-pull→grip+base, knob/hinge/slide/leg→body+base,
cup-pull/rail→body), `resolveHardwarePartFinish` (parte→preset, undefined
= global), `normalizeHardwarePartFinishes` (validación para mappers).
Sin partFinishes → comportamiento F069 exacto (test de fallback).

**3D (HardwareMesh):** primitivos refactorizados a materiales por rol
(`hardwarePartMaterials`, puro testeado): bar-pull tubo=grip +
soportes=base; bisagra cazoleta+brazo=body + placa=base; pata asta=body
+ pie=base; knob cabeza=body + poste=base; slide riel=body +
riel interno=base. Selección tiñe todo (igual que antes).

**Catálogo:** draft + toDraft + selects "Acabado · {Cuerpo|Base|Empuñadura}"
solo para formas multi-parte (mono-parte duplicaría el acabado global),
opción vacía "Igual al acabado general". catalogStore valida con
normalizeHardwarePartFinishes y updateHardware dropea partFinishes viejo
antes del spread (clear funciona).

**Persistencia:** apiMappers part_finishes round-trip con validación;
Go `Hardware.PartFinishes` (map json part_finishes) + helpers
scanHardwarePartFinishes/hardwarePartFinishesArg + SELECT/INSERT/UPDATE +
migración aditiva **000046** (JSONB, NULL = legacy).

**Verificación:** domain 536 (+10), ui 842 (+8), storage 87 (+3), web
242 ✓; go build + go test ✓ (storage integration test contra Postgres
local: create con NULL, update con overrides, clear a NULL — pasó con
migración aplicada). Typecheck de workspaces tocados ✓.

**OJO — sesión concurrente:** mientras implementaba apareció
`apps/mobile/` (untracked, React Native + Expo: Login/Scanner/Survey/
WarrantyTickets/ProjectChat/ProjectPhotos) + docs mobile (roadmap_RN,
mobile-architecture, mobile-code-sharing, mobile-ui-ux) + AGENTS.md/
architecture.md actualizados por ESA sesión. Su ScannerScreen usa el
parser de F089 y tiene errores de narrowing (pnpm typecheck monorepo
ROJO por apps/mobile — no es de F080). Su sesión también agregó el
fixture partFinishes a catalogStore.test.ts (correcto; endurecí
catalogStore con guards `?.`). Este commit EXCLUYE todo lo de mobile.

## F090 — Métricas y Analytics del Taller (2026-08-16)

Implementada y verificada. Nota de modelo: ProjectStatus NO tiene
'rejected' (draft→quoted→accepted→produced; reopen→draft) — la "tasa de
aceptación" honesta es **cotizado→ganado** (drafts fuera del denominador).
design.md §5.2 menciona badge rejected: legacy, ignorar.

**Dominio** (`packages/domain/src/metrics/workshopMetrics.ts`, export
`./metrics/workshopMetrics`):
- `computeCommercialFunnel(projects, {now, period, stalledAfterDays=14})`:
  counts por estado, pipeline abierto (count + $ de snapshots),
  quoteToWonRate, avgDaysToClose (createdAt→capturedAt), avgTicket,
  estancadas (updatedAt > 14d) + más vieja.
- `computeWarrantyAnalytics(tickets, projects, {now, period})`: totales
  open/resolved, por categoría, piezas refabricadas + m² (Σ L×W×qty),
  topPieces (hasta 5, por ocurrencias entre tickets), obras afectadas,
  **margenEnRiesgo** = Σ(salePrice−directCost) de obras con reclamo
  (distintas, sin duplicar por ticket; null sin snapshots).
- `computeWorkshopAnalytics` compone ambas; `ANALYTICS_PERIODS`
  30d/90d/12m/Todo; períodos bucket por createdAt del proyecto/ticket.
- Honestidad de fechas documentada: avgDaysToClose usa
  priceSnapshot.capturedAt (se reescribe en cada transición ≈ fecha de
  aceptación).

**UI** (`packages/ui/src/dashboard/WorkshopAnalyticsPanel.tsx`):
- Props-driven (shell computa, UI renderea — regla del Dashboard).
- Cards de conversión + barras de embudo por estado; cards de garantía +
  barras por categoría (labels de WARRANTY_CATEGORY_METADATA) + top piezas.
- Gráficos = barras CSS (cero libs); chips de período; estados
  loading/empty. CSS `.analytics__*` en dashboard.css (solo tokens).

**Shell** (App.tsx): fetch de tickets vía `getRepository().getWarrantyTickets()`
(CRM Phase 3) con cancelación + fallback []; memo de analytics SOLO para
`canViewPortfolioDashboard` (gerente/admin/guest); período en estado local.

**Verificación:** domain 548 (+12), ui 847 (+5 panel), web 242, mobile 24
(sesión paralela, intacta), typecheck monorepo 0 errores (incluye mobile —
ellos arreglaron su narrowing), init.sh verde.

**Sesión paralela RN:** sigue activa (apps/mobile + docs). Este commit
excluye sus archivos.

## RN Takeover — paridad piso + ventas calle (2026-08-16, F091 núcleo)

El usuario tomó ownership total de apps/mobile (la sesión paralela dejó de
trabajar). Objetivo: app útil para piso de fábrica y vendedor en calle.

**Hallazgo crítico corregido:** Go NO persistía `floor_status` (ni columna
ni INSERT/SELECT) — los estados de piso se perdían en cada save/recarga
TAMBIÉN en web con backend. Migración **000047** (columna aditiva) +
persistencia en loadProjectItems/replaceProjectItemsTx/AddProjectItem.

**Backend:** `POST /api/projects/:id/floor-scan` (api/floorScan.go):
resuelve ítem por módulo/código de fábrica (sufijos -L2/-L3 como la web),
avanza ATÓMICAMENTE (UPDATE de 1 fila — sin reescribir el proyecto,
escaneos del teléfono no pisan ediciones web), RBAC = markProduced ∨
exportProduction (igual que el panel paperless web). Helpers Go
`NormalizeItemFloorStatus`/`NextItemFloorStatus` (paridad TS). 7 tests
handler + helpers.

**RN piso:** floorScannerStore reescrito — processScan resuelve contra el
endpoint (payload con projectId), auto-avance (toggle, default on),
errores visibles (404 módulo, 403, red), **cola offline** en memoria con
avance optimista + syncPending al reconectar; ScannerScreen muestra obra +
estado servidor + botón "Marcar: X". PieceScanCard display-only.
8 tests (mock apiClient + haptics).

**RN ventas:** catalogStore.loadFromApi() (catálogo REAL del taller vía
catalogFromApi de @muebles/storage — exportado del index; seed queda como
fallback offline); App carga catálogo + sincroniza piso pendiente al
autenticar. quoterStore.saveAsQuote(): cliente find-or-create por nombre +
POST /projects draft con items (module/preset/qty) → la oficina lo ve en
Cotizaciones; botón "Guardar cotización (borrador)" en ExpressQuoter.

**RN producción:** ProductionQueueScreen — GET /projects filtrado
accepted/produced, pull-to-refresh, "Escanear esta obra" fija obra activa
(códigos planos resuelven contra ella) y salta al escáner. HomeScreen:
card "Cola de Producción".

**Coordinación:** la sesión paralela (aún activa en backend) commiteó mi
trabajo en vuelo en `a08ff50` (incluye TODO lo anterior) y refactorizó
encima (decodeJSONBody, uuid validation — suyo, sin commitear, NO tocado).
Mi remanente: wiring final HomeScreen/App (commit aparte). Todo verde:
domain 548, storage 87, excel 63, ui 847, mobile 33, web 242, desktop 14;
Go ok; init.sh OK.

**F091 pendiente:** variante URL payload (deep link, D7) y cola offline
persistente (hoy memoria).

## F091 ítem 1 — Variante URL del payload QR (deep links) (2026-08-16)

**Dominio** (`pieceLabelQr.ts`): `pieceLabelQrPayloadUrl(fields, {host})` —
envuelve el MISMO JSON v2 en `muebles://scan#<encodeURIComponent(json)>`
(scheme default) o `https://<host>/scan#…` (universal/app links; host
sanitizado). `unwrapPieceLabelQrUrl` extrae el fragment (regex
https?/muebles, decode defensivo). `parsePieceLabelScan` acepta las tres
formas (JSON puro, scheme, https) — compatibilidad garantizada por tests:
payload pre-F091 parsea idéntico, garbage fragment → plainCode sin crash.
`PIECE_LABEL_QR_SCHEME = 'muebles'` exportado.

**Etiquetas (3 generadores):** settings persistidos del usuario ganan
`qrFormat: 'json'|'url'` + `qrHost` (default json — nada cambia para
etiquetas existentes; el JSON es QR más chico). Tab Etiquetas →
Impresora térmica → select "QR: JSON (offline, recomendado) | Deep link
(abre la app móvil)" + campo dominio cuando url. Aplica a preview fiel,
ZPL (`pieceBatchToZpl`) y PDF (`pieceLabelsExport`) — los tres aceptan
`qrFormat`/`qrHost` en sus options.

**RN deep link:** el scheme `muebles` ya estaba registrado en app.json (lo
preparó la sesión paralela). App.tsx: `Linking.getInitialURL()` +
addEventListener('url') → `unwrapPieceLabelQrUrl` → si hay payload:
navega a scanner + `processScan(payload)` — la cámara del SO escanea la
etiqueta URL-form, el SO abre la app, y el escaneo ya está procesado.
(iOS nota: la app de cámara ofrece abrir links https; el scheme custom lo
abren apps de QR. Universal links completos requieren apple-app-site-
association en el dominio — configuración de deploy, documentado en D7.)

**Tests:** domain 554 (+6: round-trip scheme/https, paridad de parseo
entre formas, compat pre-F091, garbage fragment, URL sin fragment, no-URL).
Panel: 2 expectativas de settings actualizadas por los campos nuevos (9 ✓).

**Verificación:** domain 554, ui 847, excel 63, mobile 33, web 242;
typecheck monorepo 0 errores; init.sh OK.

**Nota de coordinación:** la sesión paralela sigue activa — commiteó una
rada de hardening (fb47f09..ccfd4b5) ANTES de este trabajo; el árbol
estaba limpio al arrancar. Este commit toca solo archivos F091.

## F091 ítem 2 — Cola offline persistente (2026-08-16, tarde)

Contexto: la sesión paralela entregó meanwhile etiquetas de MÓDULO/bulto
con checklist de producción y carga (Fases 1-5: dual QR contracts,
pipeline extendido a 7 estados con packaged/loaded, target_status en
floor-scan, panel de despacho y release gate de entrega). Este ítem se
construyó SOBRE ese estado (el store ya maneja modulePayload + debounce).

**Nuevo** (`apps/mobile/src/services/offlineQueueStorage.ts`): AsyncStorage
versionado (muebles_floor_{queue,statuses,active_project}_v1) con
setOfflineQueueStorage inyectable (App inyecta AsyncStorage real con
require-guard; tests inyectan mock; web/no-native → null = comportamiento
anterior en memoria).

**Store:** `hydrateFromStorage()` restaura cola + estados optimistas + obra
activa (App la llama al autenticar, ANTES de syncPending — el efecto ya
existía, ahora hidrata primero). Enqueue offline: dedupe por rawText (sin
importar cuántas veces se escaneó el mismo QR sin señal) + persistencia
inmediata de cola y estados. syncPending: persiste lo que quede sin drenar
+ envía target_status cuando el scan encolado lo traía (módulo labels).

**Ciclo verificado por test:** scan sin señal → "reiniciar app" (estado
fresco + hydrate) → cola restaurada → vuelve señal → sync drena →
persistencia queda vacía. Tests: 13 en el store (10 previos + 3 nuevos:
survive-restart, dedupe con force=true para saltear el debounce de 800ms,
hydrate sin storage = no-op).

**Verificación:** mobile 36, typecheck monorepo 0 errores, init.sh OK.
**F091 marcada done** (ambos ítems completos; universal links iOS quedan
como configuración de deploy documentada en D7).

---

## Judgment Day + Critique — Producción por sectores/roles (2026-08-17)

Sesión de evaluación (impeccable critique + protocolo JD), sin cambios de
código. Pedido del usuario: separar ingeniería de producción vs planta/piso,
tracking de procesos por sector/rol (almacén, corte, CNC, encintado, armado,
embarque) y visibilidad del avance para TODOS (incluye ventas).

**Método:** 2 exploradores independientes (mapeo exhaustivo del módulo +
roles/RBAC/visibilidad), detector limpio (0 hallazgos), recorrido autenticado
en vivo (usuario admin de prueba creado con `cmd/admin create` y borrado al
cerrar; cola + hub + Piso + Control de Carga sobre "Cocina Nellly" accepted).
Snapshot: `.impeccable/critique/2026-08-17T14-28-26Z__packages-ui-src-production.md`
(score 24/40, 3×P1; tendencia 28 → 24 — lente distinta, no regresión).

**JD findings (vs la visión):**
- C1: no existe concepto sector/estación; gate de piso binario
  (markProduced ∨ export) → cualquier rol de planta avanza cualquier estado.
- C2: avance invisible fuera del hub: vendedor sin nav production, detalle de
  proyecto sin floorStatus, dashboard sin métricas de piso; loading-status sin
  UI fuera del hub.
- C3: sin bitácora de transiciones (quién/cuándo/cómo) — floor_status es
  columna sobreescrita.
- W: tres mecanismos de avance inconsistentes (Piso lineal / Módulos select
  arbitrario / Despacho con saltos — verificado: "Cargado ✓" sobre Pendiente);
  hub monolítico 10 tabs oficina+piso; estado por línea no por unidad; sin
  paso CNC; mobile sin filtro por rol; technical-workflow gate sin gate de rol.

**Propuesta (pendiente de decisión del usuario):** dominio `ProductionSector`
+ `FloorStatusEvent` (tabla aditiva), roles de estación en inglés
(cutter/edge_bander/cnc_operator/assembler/warehouse/shipping),
`roleCanAdvanceStation`, colas por estación ("Mi estación" en nav), tablero
"Estado de Planta" para todos, franja de progreso en proyectos, split IA
hub Ingeniería (8 tabs) vs workspace Planta. Fases 0-4 detalladas en el
reporte de la conversación.

**Decisión del usuario:** empezar por **Fase 0+1** (fundamentos + visibilidad).

## F092 — Sectores + bitácora de piso (Fase 0 del plan, 2026-08-17)

**Dominio** (`packages/domain/src/`):
- `productionSectors.ts`: `ProductionSector` (warehouse|cutting|cnc|
  edge_banding|assembly|packaging|shipping|installation) con labels ES,
  `sectorForFloorStatus`/`floorStatusForSector` (cnc→null hasta `machined`,
  Fase 3), `itemsWaitingForSector` (cola de estación; warehouse=pending),
  `buildProjectFloorSummary` (done=alcanzó-o-pasó, waiting, activeSector=
  primer sector incompleto = cuello de botella, % = media de avance por ítem).
- `productionFloorEvents.ts`: `FloorStatusEvent` (id/projectId/itemId/from/to/
  at/byUserId/byName/source scan|manual|dispatch|api/note), `advanceFloorStatus`
  (transición UNIFICADA: target|advance, rechaza saltos salvo `allowJump`, el
  salto queda anotado "salto X → Y"), `appendFloorEvent` (inmutable, dedupe
  por id), `floorTimelineForItem`, `latestFloorEvent`. `Project.floorEvents`
  en types.ts.
- Tests: `productionSectors.test.ts` 17 casos (mapeo, colas, summary,
  transiciones, saltos, log).

**Storage TS:** puerto `listFloorEvents` + `event` en respuestas de
floorScan/setProjectItemFloorStatus. localStorage repo usa advanceFloorStatus
(allowJump preserva contrato vigente) + appendFloorEvent. apiMappers:
`floor_events` en projectToApi/fromApi. projectStore.setItemFloorStatus
(web local) idem — eventos viajan en el PUT.

**Go:** migración aditiva **000048** `project_item_floor_events` (UUID PK,
FK cascade, índice project+at) — aplicada y verificada en Postgres local.
`InsertFloorEvent`/`ListFloorEvents`/`upsertFloorEventsTx` (ON CONFLICT
DO NOTHING). floor-scan y PATCH floor-status escriben evento con usuario
del JWT (nombre real vía GetUserByID, fallback email) y lo devuelven en la
respuesta; PATCH ahora carga estado actual antes de escribir (from→to
correcto). `GET /api/projects/:id/floor-events` (auth, sin gate de rol —
visibilidad para todos). GetProjectByID embebe floor_events. UUID v4 con
crypto/rand (cero deps nuevas). 6 tests handler nuevos.

## F093 — Visibilidad para todos (Fase 1 del plan, 2026-08-17)

**UI** (`packages/ui/src/production/`):
- `ProjectFloorProgressStrip`: franja 6 sectores + %, role=img con aria-label
  ("Proceso actual: Corte. Avance 0%..."), estados done(✓ verde)/active(brand).
- `ProjectFloorStageChip`: cuello de botella + % para tarjetas de cola.
- `PlantBoardScreen`: matriz obras × sectores (done/total, "n en cola",
  columna activa resaltada, Avance %), EmptyState docente, botón obra→orden
  (si rol puede) o →cotización (vendedor). CSS `.floor-strip/.floor-chip/
  .plant-board` solo tokens (design.md §6.7b).

**Wiring:** nav `plantBoard` **Estado de Planta** (TRABAJO, icono
KanbanSquare, TODOS los roles + guest — rbac.ts navIdsForRole) + ruta
`/planta` (sin conflicto con deep link de orden). Franja en
ProjectDetailView (accepted|produced, cualquier rol con acceso). Chip en
ProductionQueue cards (ahora `<p>` de señales siempre presente). appShell
test actualizado (contrato TRABAJO ×6); rbac.test F093; routes.test /planta.

**Verificación en vivo** (browser, admin de prueba borrado al cerrar):
- `/planta`: fila "Cocina Nellly" 0/3 por sector, "3 en cola" en Corte, "0% en Corte" ✓
- Detalle cotización: franja "Proceso actual: Corte. Avance 0%..." ✓
- Cola: chip "Corte 0%" en la card ✓

**Suites:** domain 594, storage 89, excel 70, ui 863, mobile 36, desktop 17,
web 248 — todo verde. `pnpm typecheck` monorepo 0 errores. Go build + go
test ./internal/... verde (api incl.). init.sh verde.

**Nota:** el server Go en 8080 corre código previo — los endpoints de eventos
activan al reiniciar (la migración ya está aplicada).

**Pendiente (Fases 2-4 del plan):** roles de estación + RBAC por sector +
"Mi estación" (Fase 2), split IA Ingeniería vs Planta + almacén staging +
estado `machined` CNC (Fase 3), métricas de sector desde eventos (Fase 4).

---

## Fase 3 — Compras / Almacén (workspace de picking, 2026-08-17)

Implementación del workspace dedicado para `almacen` (lectura para
`gerente_produccion` y `admin`) — listas de picking por proyecto activo,
sin gestión de stock (MVP, roadmap-screens/04 + 05 §Phase 3).

**Dominio (`packages/domain`):**
- `purchasing.ts` nuevo: `PickingMaterial` (herrajes/tableros/cintillas),
  `PickingStatus` (pendiente/despachado), `ProjectPickingState` (contrato de
  persistencia futura: markedAt/markedBy), `pickingKey(projectId, material)`,
  labels ES. Exportado desde index.ts (+ `computeProductionTotals` ahora
  también exportado, no solo el alias `summarizeProductionTotals`).
- `rbac.ts`: `roleCanAccessPurchasingNav` (admin | gerente_produccion |
  almacen) + `'purchasing'` en `navIdsForRole`. Tests en rbac.test.ts y
  purchasing.test.ts.

**UI (`packages/ui/src/purchasing/`):**
- `PurchasingScreen.tsx`: 4 tabs (Herrajes/Tableros/Cintillas/Compras
  placeholder "Próximamente"). Datos derivados del dominio
  (`generateHardwareList`, `computeProductionTotals(cutRows)`); Tableros
  muestra piezas/m² + "planchas estimadas" (`estimateBoardSheets`, prop
  opcional `sheetEstimates`). Picking local `useState<Record<string,
  PickingStatus>>` (key `projectId:tab`), botón "Marcar despachado" toggle +
  "Desmarcar". RBAC display: `gerente_produccion` read-only (sin botones);
  `admin`/`almacen`/guest marcan. `assignedSectors` filtra tabs de material
  (almacen sector-scoped, coherente con FabricScreen); tab Compras siempre
  visible. Stat cards + badges de pendientes por tab. `purchasing.css`
  (prefijo `.purch-`, solo tokens).
- `AppShell.tsx`: `AppNavId += 'purchasing'`, sección `almacen`
  "COMPRAS / ALMACÉN" (icono Warehouse) entre INGENIERÍA y LIBRERÍA,
  `NavSectionDef.id += 'almacen'`, roleLabel con almacen/gerente_produccion.
  appShell.test.ts + index.test.ts actualizados (7 secciones).

**Web shell (`apps/web`):**
- `routes.ts`: `purchasing: '/compras'` (NAV_PATHS) + exclusión de
  EntitySection.
- `App.tsx`: memo `purchasingProjects` (proyectos accepted|produced →
  hardware + cutRows + sheetEstimates, con try/catch por proyecto) y caso
  `navId === 'purchasing'` → `<PurchasingScreen role assignedSectors />`.

**Verificación:** domain 613 (rbac + purchasing), ui PurchasingScreen 8 +
appShell 15 + index 15 ✓, web 255 ✓, `pnpm typecheck` monorepo 0 errores.
Solo quedan 5 tests rojos PRE-EXISTENTES en ProductionOrderHub.test.tsx
(commit 2211e2c recortó HUB_TABS a 6 tabs moviendo modulos/despiece/
optimizacion a Ingeniería pero no actualizó su test) — ajenos a esta tanda.

## Addendum — ProductionOrderHub.test.tsx actualizado al Hub trim

Los 5 tests rojos pre-existentes de `ProductionOrderHub.test.tsx` (commit
2211e2c recortó HUB_TABS a 6 tabs moviendo modulos/despiece/optimizacion a
Ingeniería sin tocar su test) quedaron verdes:

- Hub: click de tab en el test de resumen pasa a `documentos` (tab real);
  test "documentos buttons" reducido a labels-zpl "Configurar" →
  onTab('etiquetas') (el doc despiece ya no vive en el hub).
- Tests de paneles movidos se portaron a su dueño actual (la cobertura no se
  pierde): `ProductionOrderModulesPanel.test.tsx` (inventario PROD-0.4) y
  `ProductionOrderOptimizationPanel.test.tsx` (capas L0/L1/L2 PROD-2.3)
  nuevos; despiece ya tenía `ProductionOrderDespiecePanel.test.tsx`.
- `EngineeringWorkspace.documents.test.tsx` nuevo: doc despiece "Ver tab"
  navega a la tab Despiece, ZPL "Ir a Etiquetas" navega, gate por
  materialsResolved (disabled + razón visible) e imprimir A4.

Suites: @muebles/ui 906 ✓ (98 files, 0 failures), typecheck monorepo 0 errores.

## Addendum — Persistencia del picking (Fase 3)

Se implementó la persistencia del estado de despacho de Compras/Almacén (antes solo local en `PurchasingScreen`).

**Backend Go (`backend-go`)**
- Migración `000054_project_picking` (tabla `project_picking`: project_id × material PK, status, marked_at, marked_by).
- `domain/types.go`: struct `ProjectPicking`; `domain/rbac.go`: `RoleCanAccessPurchasingNav` (admin/gerente_produccion/almacen) y `RoleCanMarkPicking` (admin/almacen — gerente_produccion es read-only).
- `storage/projectPicking.go`: `ListAllPicking` (join users para marked_by_name) + `UpsertProjectPicking` (ON CONFLICT upsert). En `Store` interface.
- `api/projectPicking.go`: `GET /api/picking` (lista) y `PUT /api/picking` (upsert; el server estampa who/when desde el JWT solo en despachado; pendiente limpia la estampa). Validación de material/status + 404 si la obra no existe. Rutas registradas.
- Tests: `projectPicking_test.go` (lista por rol, deny a no-purchasing, stamps, pendiente limpia, gerente read-only, almacen permite, inputs inválidos 400, obra 404, paridad RBAC). Se actualizaron 2 tests obsoletos de `productionScope_test.go` (almacen fuera de gates de piso F094: el finish warehouse-sector lo ejerce produccion; almacen 403 en floor-status y finish) — estaban rojos en HEAD (verificado con worktree).

**Storage TS (`packages/storage`)**
- Puerto: `listPickingStates?()` y `setProjectPickingState?(state)` en `WorkspaceRepository`.
- API: GET/PUT `/picking` con `pickingStateFromApi` (snake_case → dominio, marked_by_name → markedBy). LocalStorage: key `muebles_guest_picking`, upsert por `pickingKey`, estampa markedAt en guest.
- Tests: `localStoragePicking.test.ts` (nuevo) + 2 tests API.

**UI (`packages/ui`)**
- `PurchasingScreen`: props `initialPicking` (hidrata despachos persistidos; efecto re-hidrata al cambiar identidad) y `onTogglePick` (reporta el nuevo estado tras el update optimista).
- Tests: hidratación, callback, rehidratación tardía.

**Web shell (`apps/web`)**
- `App.tsx`: estado `pickingStates` cargado una vez por sesión de workspace (guest o rol purchasing), `handleTogglePick` persiste vía repo con reconciliación (reload de server truth si falla). `domain/index.ts`: exporta `roleCanAccessPurchasingNav` + `roleCanMarkPicking` (faltaban).

**Verificación**: Go api/domain/storage ✓ · UI 909 ✓ · Storage 98 ✓ · Domain 614 ✓ · Web 255 ✓ · `pnpm typecheck` monorepo 0 errores.

## Diseño — Fase 3b: Stock real por material

Diseño documentado en `docs/roadmap-screens/06-stock-almacen.md` (nuevo; referenciado desde `00-overview.md` y `04-compras-almacen.md`). Sin implementación.

Decisiones clave: ledger inmutable + saldo vivo (patrón floor events, migraciones 000055/000056); despacho auto-descuenta solo materiales con fila de stock (backward compatible); salida negativa bloqueada con `ajuste` como corrección; mínimos por material con estado derivado ok/bajo/agotado; unidades del dominio (pieza/juego/metro, planchas, ml); tab Compras = panel de stock (recepción/salida/ajuste/mínimos); `roleCanManageStock` = admin|almacen, gerente read-only. Fuera de MVP: PO/proveedores, QR, rollos, multi-depósito, costos.

## Backend stock (Fase 3b) — implementado

Backend completo de inventario según `06-stock-almacen.md` (sin UI).

- Migraciones `000055_material_stock` (saldo + min_stock por kind×material_id, CHECK kind) y `000056_stock_movements` (ledger inmutable: type CHECK, delta, balance_after, project_id, reverts_id, by_user_id/name, at).
- `domain/stock.go`: `MaterialStock`, `StockMovement`, sentinels `ErrStockNotTracked` / `ErrStockInsufficient`, `ValidStockMaterialKind/Type`, `StockDeltaForType` (entrada/salida/despacho positivas con signo del tipo; ajuste firmado), `StockStatusOf` (ok/bajo/agotado). `rbac.go`: `RoleCanManageStock` = admin | almacen.
- `storage/stock.go`: `ListStock`, `UpsertStockMin` (upsert, crea fila), `RecordStockMovement` en **transacción** (lock FOR UPDATE → balance_after → insert ledger; solo entrada crea fila; saldo negativo → ErrStockInsufficient con faltante), `GetStockMovementByID`, `ListStockMovements` (filtros kind/material_id, limit).
- `api/stock.go`: `GET /api/stock` (+ status derivado), `PUT /api/stock` (min_stock), `POST /api/stock/movements` (201; valida kind/type/quantity/proyecto/reverts; estampa who/when del JWT; 404 sin fila de stock, 400 con faltante), `GET /api/stock/movements`. Rutas registradas; interface Store ampliada; stubs en handlers_test.go.
- Tests: `stock_test.go` (api, 14 tests: RBAC, entradas, débitos, insuficiente con faltante, ajuste firmado, gerente deny, inputs 400, proyecto/reversión 404, filtros) + `stock_test.go` (domain helpers).
- Verificación: `go build` + `go vet` ✓; api/domain/storage ✓. Único fallo de `go test ./...`: `internal/config` con `PORT=0` en el env del shell — pre-existente y ambiental (falla igual en HEAD).

## Stock Fase 3b — implementación completa

Backend (turno anterior) + puerto TS + StockPanel + despacho que descuenta stock. Todo verde.

**Backend extra**: reversión de despacho — `POST /api/stock/movements` con `type:"despacho"` + `reverts_id` ahora **acredita** de vuelta (delta +qty, enlazado al movimiento original; valida que el original sea un despacho del mismo material). Tests: crédito → saldo original, rechazos (no-despacho, material distinto).

**Domain TS** (`packages/domain/src/stock.ts`): `MaterialStock`, `StockMovement`, kinds/types/status, `stockStatus` (ok/bajo/agotado), `stockUnitLabel/Plural`, `stockMovementDelta`, `applyStockMovement` + `roleCanManageStock`. Exportado desde `index.ts`.

**Storage TS**: puerto `getStock`/`upsertStockMin`/`recordStockMovement`/`listStockMovements`; adapter API (4 endpoints snake_case, mappers `stockFromApi`/`stockMovementFromApi`); adapter localStorage (claves `muebles_guest_stock` + `_movements`, misma lógica transaccional: entrada crea fila, saldo negativo → error con faltante, reversión acredita). Tests API + localStorage.

**UI**: `StockPanel` (tab Compras: banner de alertas, filtros/búsqueda, tabla con estados y último movimiento, edición inline del mínimo, acciones Recibir/Salida/Ajustar, empty state con "Recibir stock") + `StockMovementModal` (un formulario guiado por tipo; ajuste exige nota; muestra errores del server). `PurchasingScreen`: chips de stock por fila en los 3 tabs (herrajes por hardwareId, tableros por materialId de planchas, cintillas por edgeId resuelto) + tab Compras → panel. CSS `.purch-stock-*`.

**Web shell**: carga stock + ledger con el picking; `stockCatalog` (labels, opciones del modal, códigos→ids); `handleRecordStockMovement`/`handleUpsertStockMin` (persisten + refresh); `handleTogglePick` extendido — despacho **descuenta por línea** solo materiales con fila de stock (si falla, acredita los ya debitados, recarga picking+stock y tostea el faltante); desmarcar **revierte** los despachos activos del ledger (sobrevive a recargas).

**Verificación**: typecheck monorepo 0 errores · Domain 620 · Storage 109 · UI 918 · Web 255 · Go api/domain/storage ✓ (config sigue rojo solo por PORT=0 ambiental en HEAD).

## Órdenes de compra + proveedores (Fase 3c)

Implementado el modelo PO con estados (borrador → emitida → recibida, cancelada) y
el directorio de proveedores, conectando la recepción a stock.

**Backend Go**
- Migración `000057_purchase_orders` (agrupada): `suppliers`, `purchase_orders`
  (estado CHECK, created_by, received_at) + `purchase_order_items`
  (received_quantity avanza por recepción).
- Dominio `purchaseOrder.go`: `Supplier`, `PurchaseOrder`, sentinels y helpers
  `PurchaseOrderCanEmit/Cancel/Receive`, `PurchaseOrderFullyReceived`; rbac →
  `RoleCanManagePurchasing` (admin | almacen).
- Storage: CRUD de suppliers (soft delete por active=false) + POs; recepción en
  **una transacción** (lock FOR UPDATE de la PO → received_quantity += qty →
  entradas de stock con nota = número de OC → recibida si completo). Refactor:
  helper `recordStockMovementTx` extraído de stock.go.
- API: `GET/POST /api/suppliers`, `PUT/DELETE /api/suppliers/{id}`,
  `GET/POST /api/purchase-orders`, `GET/PUT /api/purchase-orders/{id}`,
  `POST .../{id}/emit|cancel|receive`. 17 tests nuevos (RBAC, validaciones 400,
  404, estampa de quién recibe, ciclo de vida completo).

**TS**
- Domain `purchasingOrders.ts`: tipos + helpers puros (`poRemaining`,
  `poFullyReceived`, gates de estado) + `roleCanManagePurchasing`. Tests.
- Storage: puerto (11 métodos), mappers `supplierFromApi/ToApi`,
  `purchaseOrderFromApi`, `poItemToApi`; adapters API (7 endpoints) y
  localStorage (`muebles_guest_suppliers`, `muebles_guest_purchase_orders` —
  recepción replica las entradas de stock y el avance). Tests.

**UI**
- `PurchaseOrdersPanel`: sub-tabs Órdenes/Proveedores con búsqueda; cards de PO
  con badge de estado, progreso por línea ("30/50 recibido · quedan 20") y
  acciones por estado (Emitir/Editar, Recibir, Cancelar); modal de PO
  (proveedor + líneas dinámicas), modal de recepción (cantidades por línea,
  default = restante) y modal de proveedor. Read-only para gerente_produccion.
- `PurchasingScreen`: el tab Compras gana sub-tabs Stock / Órdenes y proveedores.
- CSS `.purch-po-*`, `.purch-compras*`.

**Web shell**: carga suppliers + POs junto a picking/stock; handlers
(create/update/emit/cancel/receive) con refresh; la recepción refresca stock +
POs (las entradas se ven en el panel).

**Verificación**: Go api/domain/storage ✓ · Domain 627 ✓ · Storage 114 ✓ ·
UI 925 ✓ · Web 255 ✓ · `pnpm typecheck` 0 errores. (El único test rojo de
`go test ./...` sigue siendo `internal/config` por `PORT=0` ambiental.)

## Costo / valor de inventario en el panel de stock (Fase 3c)

- Domain `stock.ts`: helper puro `stockValue(quantity, pricePerUnit)` (null sin
  precio) + tests.
- `StockPanel`: columnas **Costo** (precio unitario del catálogo) y **Valor**
  (cantidad × precio) por fila, más la línea **"Valor total del inventario"**
  con la suma, formateada con `formatMoneyDisplay` (moneda configurable).
  Visible solo con `showCosts` (COST-01/02 — default false).
- Fuente del precio: `Hardware.costPerUnit` (herrajes) · `MaterialBoard.boardPrice`
  (planchas) · `EdgeBand.costPerMl` (ml) — `stockCatalog.prices` resuelto en
  App.tsx desde el catálogo; `showStockCosts` reusa el `showCosts` del shell.
- Materiales sin precio en catálogo → '—' (no cuentan en el total).

**Verificación**: pnpm typecheck 0 errores · UI 927 ✓ · Web 255 ✓ · Domain 629 ✓.

## Revisión de fases 1→3b + preservación (2026-08-17, noche)

Revisión pedida por el usuario tras "fase 3": verificación por encima de que
todas las fases del roadmap-screens estén OK hasta 3b.

**Estado verificado (todo verde):**
- Fase 1 (Fábrica), 2a (Ingeniería), 2b (Dashboard Ventas) — ya commiteadas
  (`7f11e7a` + fixes `2211e2c`). Artefactos y nav presentes.
- Fase 3 (picking + persistencia), 3b (stock real), 3c (POs/proveedores/
  costo) — en working tree, sin commitear.
- Evidencia fresca: `pnpm test` exit 0 (web 255, desktop 17, resto ✓) ·
  `pnpm typecheck` 0 errores · `go build` + `go test ./internal/...` ok.

**Preservación (3 commits atómicos + push):**
1. Tests portados al Hub trim (ProductionOrderHub.test + paneles movidos +
   EngineeringWorkspace.documents).
2. Épico Fase 3/3b/3c completo (backend migraciones 54-57 + TS + UI + docs).
3. chore: `.gitignore` + `backend-go/server`.

**Siguiente:** Fase 4 (dashboards refinados) del `05-implementation-phases.md`.

## Fase 4 — Dashboards refinados (2026-08-17, noche)

Implementada y verificada (estado por fase en `05-implementation-phases.md`).

**4.1 — Toggle [Cola]/[Métricas] en Fábrica:**
- `FabricScreen` gana prop opcional `metrics?: DashboardMetrics | null` y un
  toggle segmentado en el header (solo cuando hay métricas). Vista Métricas =
  tabla por sector (cola, operarios, hechos hoy, tiempo prom.) + fila Total
  (promedio ponderado por completados de hoy, `summarizeFabricMetrics`
  exportado y testeado; sin completados → '—').
- Tipos `DashboardMetrics`/`SectorDashboard` exportados de
  `ProductionManagerDashboard` (vía barrel production + index de UI).
- `App.tsx`: fetch de `getProductionDashboard` SOLO al abrir /fabric sin
  sector-scoping (admin/gerente); null mientras carga o si falla → vista cola.

**4.4 — roleCanAccessFabricNav (domain/rbac.ts):** admin y gerente_produccion
ganan el nav Fábrica (tabs completas: assignedSectors null). Operadores
sector-scoped sin cambios. Tests rbac actualizados (la expectativa vieja
afirmaba que admin NO tenía fabric — ahora la quiere 03-fabrica.md §1).

**4.2 — Actividad por mes en SalesDashboard:** helper puro `monthlyActivity`
(últimos 6 meses; creadas por `createdAt`, ganadas por
`priceSnapshot.capturedAt` — misma honestidad que F090). `MonthlyActivityChart`:
barras CSS agrupadas por mes con contador, leyenda, `role="img"` con
descripción accesible; sigue el filtro de vendedor; se oculta sin actividad.
CSS `.sales-monthly-chart__*` (tokens, colores de pipeline: violeta/verde).

**4.3 — Ingeniería:** fallback de proyecto desconocido usa `EmptyState`
compartido (icono FileQuestion) en vez del div pelado.

**4.5 — Hub NO se elimina** (documentado en 05): conserva
piso/despacho/etiquetas/herrajes/documentos y es el workspace por obra de 5
roles. No está "fully replaced".

**Verificación:** domain 630 ✓ · ui FabricScreen 15 / SalesDashboard 15 ✓ ·
typecheck monorepo 0 errores · pnpm test full verde (ver registro).

## Fase 5 — Polish y optimización (2026-08-17, noche)

Implementada y verificada; roadmap-screens COMPLETO (fases 1-5 done,
estado por fase en `05-implementation-phases.md`).

**5.2 Teclado:** `packages/ui/src/common/rovingTabList.ts` — hook compartido
`useRovingTabList` (flechas/Home/End con wrap-around + roving tabindex, el
patrón que los 5 editores duplican). Aplicado a FabricScreen (tabs de sector),
EngineeringWorkspace (8 tabs) y PurchasingScreen (tabs principales + sub-tabs
Stock/Órdenes). Test de teclado en FabricScreen (ArrowRight selecciona+enfoca,
wrap con ArrowLeft, Home).

**5.4 Error boundaries:** `ScreenBoundary` (packages/ui/common) — preset del
`ErrorBoundary` existente: fallback compacto "No pudimos mostrar {pantalla}"
con Reintentar + Ir al inicio, DENTRO del shell. App.tsx envuelve Fábrica,
Ingeniería (landing y workspace), Compras, Ventas y Estado de Planta. 2 tests.

**5.1 Responsive:** fabric ≤720px (header apila; tabla métricas scrollea,
min-width 480), sales chart ≤600px (scrollea, columna fija 3.5rem), eng cards
≤640px (wrap de meta/fecha). Purchasing ya cubierto (auto-fit + wrappers).

**5.5 Perf (hallazgo honesto):** se intentó lazy de `FurnitureScene3D` en
`ProductionOrderViewsPanel` — el build de Vite avisó que NO separa el chunk:
`@muebles/ui` re-exporta el barrel preview3d y ~8 modals/pantallas importan
estático (Structure3DModal, Project3DModal, Module3DModal, Agregado3DModal,
Furniture3DViewer, ComponentsScreen/editor...). Revertido el lazy (cero
beneficio = complejidad muerta). QUEDÓ: `canUseWebGL` extraída a
`preview3d/webglSupport.ts` (re-exportada desde ModuleScene3D, sin romper
importadores) + el panel importa FurnitureScene3D directo (sin barrel).
**Follow-up documentado:** split real de three.js exige sacar los componentes
3D del barrel raíz + lazy por modal. Sin React.memo (callbacks inline).

**5.3 Loading:** sin cambios — gate full-page del workspace + primitivas
(PageLoading/ListSkeleton) ya cubren; nada muestra datos faltantes post-mount.

**Fix latent Fase 4:** el typecheck de esta tanda reveló 2 errores de tipos
que el commit 08ae62f arrastró enmascarados (caché incremental de tsc):
`readonly DashboardMetrics['sectors']` inválido (→ `readonly SectorDashboard[]`)
y mutación de buckets readonly en `monthlyActivity` (→ array mutable interno).
Corregidos; typecheck 0 errores.

**Verificación:** typecheck 0 errores · ui 938 ✓ (+3) · pnpm test full verde ·
`pnpm build` verde (bundle íntegro; el split de three.js quedó como follow-up
documentado arriba).

## Reorg de menú + pantalla Embarques (2026-08-18)

Pedido del usuario: falta pantalla de embarques; limpiar grupo TRABAJO
moviendo cada item a su grupo; renombrar Fábrica→Producción (el hub viejo
"Producción" se renombró Órdenes porque se eliminará). Plan aprobado con
3 decisiones del usuario (Despacho/Instalación SOLO en Embarques; hub →
"Órdenes"; Estado de Planta queda en TRABAJO).

**Dominio:** `roleCanAccessShippingNav` (admin|gerente_produccion|produccion
— almacen fuera, no avanza piso F094) + `'embarques'` en navIdsForRole.

**AppShell:** sección nueva **PRODUCCIÓN** (fabric→"Producción",
embarques→"Embarques" Truck, production→"Órdenes" ListChecks,
productionDashboard). TRABAJO queda Inicio + Estado de Planta. 8 secciones.
Rutas intactas (/fabrica, /produccion) + nueva `/embarques`.

**FabricScreen (ahora "Producción"):** solo 4 estaciones (corte/encintado/
armado/embalaje); special-casing de shipping/installation eliminado;
operador con sectores solo-logísticos → EmptyState "Tus sectores viven en
Embarques".

**EmbarquesScreen (nueva):** board por obra — PARA CARGAR (packaged→
"Marcar Cargado") y EN CAMINO (loaded→"Marcar Instalado"), stats en header,
link "Ver control de carga" al tab despacho del hub (mientras vive, M2),
avance por `handleFloorAdvance` compartido con Producción (extraído del
inline de fabric; server aplica station scoping + evento F094). CSS
`.embarques__*` solo tokens + responsive ≤720px.

**Docs:** design.md §4.1 (tabla canónica actualizada — estaba pre-roadmap)
+ vocabulario (Producción=fabric, Embarques, Órdenes=production TEMPORAL);
00-overview.md §2b menú canónico + §M2 plan de eliminación del hub.

**Verificación:** typecheck monorepo 0 errores · domain 631 · storage 114 ·
excel 70 · ui 943 · mobile 36 · desktop 17 · web 256 — todo verde.

## Instalaciones como pantalla propia + orden de menú por proceso (2026-08-18)

Pedido del usuario tras ver la reorg: ¿dónde quedaron las instalaciones?
Debe ser OTRA pantalla después de Embarques; y ordenar los grupos con regla:
dashboards primero → general → específico en orden lógico de proceso.

**InstalacionesScreen (nueva, `/instalaciones`):** board por obra con
"En camino" (cargado → "Marcar Instalado"), stats "n para instalar" +
"m instalados" (header + chip por card), avance por handleFloorAdvance
compartido. Mismo RBAC que Embarques (roleCanAccessShippingNav: admin/
gerente_produccion/produccion).

**Embarques adelgazada:** solo PARA CARGAR (embalado → cargado); lo cargado
pasa a Instalaciones (subtítulo lo explica). Helper embarquesProjects
solo empaqueta packaged.

**CSS compartido:** bloque renombrado `.embarques__*` → `.ship-board__*`
(layout de board logístico usado por ambas pantallas) + `.ship-board__card-done`.

**Orden de menú (regla documentada en design.md §4.1):** dashboards
primero, luego general→específico por proceso. PRODUCCIÓN queda: Dashboard
Producción · Órdenes · Producción · Embarques · Instalaciones (icono
Hammer). VENTAS/TRABAJO ya cumplían (Dashboard/Inicio primero).

**FabricScreen:** EmptyState del operador solo-logístico ahora nombra
Embarques O Instalaciones.

**Verificación:** ver registro del commit (typecheck 0 + suites full).

## Judgment Day + Critique — menú PRODUCCIÓN, flujo del operador (2026-08-18)

Sesión de evaluación (impeccable critique, register product), sin cambios de
código. Pedido del usuario: rever el menú PRODUCCIÓN completo (Dashboard →
Instalaciones) con foco en que cada estación muestre lo que importa al
operador (tableros por acabado en corte, metros/piezas/lados de cintilla en
encintado), siempre dentro del contexto de la obra, y activar el "operador
marca en progreso su proceso en el proyecto".

**Método:** lectura completa de pantallas + dominio + backend (FabricScreen,
Embarques/Instalaciones, PlantBoard, ManagerDashboard, Queue, productionTotals,
productionActivity); detector (1 warning: transition:width en dashboard css);
recorrido autenticado en vivo (admin de prueba creado con `cmd/admin create` y
BORRADO al cerrar — DELETE de 1 fila verificada) sobre Vite 5173 + backend 8080
con snapshots DOM de /fabrica, /embarques, /planta, /produccion/dashboard;
investigación de competencia (Mozaik/Cabinet Vision cut lists por material +
banding reports; MES: digital job packet + verificación de material en punto
de uso — valida el board por obra).

**Score 22/40 (Acceptable), tendencia 28 → 24 → 22 (lentes distintas).**
Snapshot: `.impeccable/critique/2026-08-18T14-35-54Z__packages-ui-src-production.md`.

**P1 findings (verificados en vivo):**
1. Producción (estaciones) aplanada por ítem: 3 filas idénticas "Cocina
   Nellly · 1 mueble · Pendiente" — sin agrupar por obra ni métricas de
   proceso. La data existe: `computeProductionTotals` (materiales piezas/m² +
   cintillas ML) + `estimateBoardSheets`; Compras ya renderiza esa agregación.
2. Claim "en progreso" DORMIDO: backend + storage client tienen
   claim/pause/resume/finish/damage (ProductionActivity), pero NINGUNA pantalla
   del operador lo llama — el dashboard lee "operarios activos 0" para siempre.
3. Dashboard Producción se contradice: stat "PROYECTOS EN PLANTA 0" con 4
   obras listadas; obras 0 ítems = "En Completado"/"completo"; emojis como
   iconos (viola design.md §3.7).

**P2:** surtido de almacén no visible en estaciones (picking ya persiste por
obra×material); /fabrica como guest = main vacío sin mensaje; Instalaciones
sin dirección/contacto del cliente; avance duplicado en 4 superficies;
ProductionEdgeTotal sin piezas/lados; EdgeBand sin color; design.md §6.7 stale
(10 tabs vs 6).

**Decisión del usuario (plan aprobado):**
- Rediseño COMPLETO de FabricScreen como board por obra con bloque de
  métricas por estación (Corte: tableros por acabado m²/piezas/planchas +
  surtido; Encintado: cintillas ML/piezas/lados; Armado: muebles; Embalaje:
  módulos) + avance batch por obra.
- Claim por OBRA × ESTACIÓN (extensión aditiva del backend; hoy claim es por
  ítem): botón "Empezar [estación]" en la card → alimenta dashboard con
  operarios/tiempos reales.
- Extras de la tanda: dashboard honesto (métrica + 0-ítems + labels + Lucide),
  surtido de almacén visible en corte/encintado, dirección/contacto en
  Instalaciones, dominio: pieces/sides en ProductionEdgeTotal + previewColor
  en EdgeBand.

**Siguiente:** kick-off de implementación por fases (1. dominio aditivo +
claim obra×estación Go · 2. board FabricScreen con métricas · 3. extras
dashboard/surtido/instalaciones), una feature a la vez según AGENTS.md.

## F095 — Fase 1 del plan M3: dominio encintado + claim obra×estación (2026-08-18, mañana)

- **Feature:** F095 — `produccion_fase5_board_por_obra_fase1_dominio_claim`
- **Inicio:** ~09:10. init.sh verde (web 257, suites full OK).
- **Plan:**
  1. Dominio TS: `ProductionEdgeTotal` += `pieces`/`sides`; `EdgeBand.previewColor`.
  2. Persistencia previewColor: migración Go 000058 + storage + apiMappers.
  3. Claim obra×estación: `item_id` nullable (NULL = claim de obra), handler
     sin item_id (dedupe por operador, no por obra — varios operarios pueden
     trabajar la misma obra), finish de claim de obra NO avanza ítems (el
     avance sigue por estación/batch), client TS itemId opcional.
  4. Tests en cada capa + `./init.sh` + `go test ./internal/...`.

## F095 — implementación lista para revisión (2026-08-18 ~09:55)

- Implementado dominio piezas/lados de encintado, `previewColor` de cantos y claim obra×estación sin exclusividad global.
- Evidencia y alcance detallado: `progress/implement_f095.md`.
- Verificación: `pnpm test`, `pnpm typecheck`, Go API/domain/storage, build y vet verdes.
- Estado: `done`, revisión APPROVED en `progress/review_f095.md`.

## F095 — cierre aprobado (2026-08-18)

- Revisión: **APPROVED** — `progress/review_f095.md`.
- Estado actualizado a `done` en `feature_list.json`.
- Commit y push se registran en `progress/implement_f095.md`.
- Entregado en `4e0281e` y push a `origin/codex/f095-production-claims` confirmado.

## F096 — cierre aprobado (2026-08-18)

- Revisión: **APPROVED** — `progress/review_f096.md`.
- `FabricScreen` v2 entregado como board por obra; F096 actualizado a `done`.
- Evidencia, correcciones y verificaciones: `progress/implement_f096.md`.

## F097 — Dashboard honesto y surtido visible (2026-08-18)

- **Feature en curso:** F097 — `produccion_dashboard_honesto_surtido_visible`.
- **Plan:** alinear el KPI con la lista visible, mostrar un estado específico en
  obras sin módulos, reemplazar iconos emoji por Lucide y exponer sólo los
  estados de picking persistidos que tengan la relación obra×categoría válida.
- **Estado:** implementación y verificaciones en curso; permanece `in_progress`
  hasta revisión.

## F097 — implementación lista para revisión

- Dashboard alineado con el conjunto listado; cero módulos con estado propio;
  iconografía de sectores migrada a Lucide.
- Picking visible sólo para relaciones persistidas obra×categoría y documentado
  su límite de granularidad en `progress/implement_f097.md`.
- Verificación: focal 25 tests, `pnpm test`, `pnpm typecheck`, `./init.sh` y
  `git diff --check` verdes.
- F097 sigue `in_progress` hasta recibir revisión.

## F097 — cierre aprobado (2026-08-18)

- Revisión: **APPROVED** — `progress/review_f097.md`.
- F097 marcada `done`; commit y push se registran en
  `progress/implement_f097.md`.
- Entrega: `5cdba26` pusheado a `origin/codex/f095-production-claims`.
