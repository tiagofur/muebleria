# ODD — #1327 Gola italiano: tira de melamina como componente del perfil + corte 45°

Issue: https://github.com/tiagofur/muebleria/issues/1327 (status:approved 2026-10-14)
Lane: Delegated Direct — 3 slices, un PR cada una. Este artifact es la memoria de ejecución.

## Decisiones de diseño (owner + arquitectura)

- La tira ES un tablero: material/color de la puerta, va al despiece, renderiza como panel.
- El perfil de apertura la referencia como BOM member tipo componente (`component_id` en vez de
  `hardware_id`); viaja congelada en el pin como cualquier member.
- El material de la tira resuelve por el **rol de la puerta** (option role FRENTE del módulo) —
  color de puerta automático, sin dato nuevo en el member.
- El descuento de puerta del perfil gola italiano usa el campo #1316 (`door_reduction_mm`).
- El corte 45° de la puerta = body modifier nuevo (efecto `bevel`) con consumidor de routing
  (pipeline #1304 reusado).

## Slices

### Slice 1 — Member tipo componente (contrato + editor) — ESTE PR
- `OpeningBOMMember.ComponentID` (jsonb aditivo, sin migración — el map es JSONB).
- Spec OpenAPI `OpeningProfileBOMMember.component_id` + regeneración.
- Editor React: los members dejan de ser read-only — ABM con clave + tipo (herraje|componente) +
  referencia + regla + unidad + spacing/dims opcionales. Round-trip preservado en edición.
- Tests: draft round-trip con member componente; storage JSONB round-trip.
- NO incluye consumo (layout/BOM) — slice 2.

### Slice 2 — La tira como board en el layout + despiece (PR siguiente)
- `OpeningMembersFromFrozenPin` proyecta el member componente → el layout pass agrega una **board
  derivada** en la banda del gola (ancho del mueble, alto/espesor del componente, material FRENTE).
- BOM: la misma board entra al despiece como BoardPart (material + cantos), espejo #1305.
- Plugin: renderiza como panel nativo (es un LayoutComponent — sin cambio de plugin esperado).

### Slice 3 — Corte 45° de la puerta (PR siguiente)
- Efecto `bevel` declarado por el perfil (análogo a la muesca #1287): resolver + fail-closed.
- Consumidor: op de routing sobre la puerta (pipeline #1304), estructura primero, CNC después.

## No-goals (por issue)

8006 metálico intacto; §13.4 con fabricante abierto; mecanizado de la tira misma.

## Estado

- Slice 1: **MERGEADO** (PR #1333).
- Slice 2: **MERGEADO** (PR #1334, main b494072f): board en la banda del gola (ancho completo ×
  profundidad × alto, rol FRENTE) + espejo BOM como BoardPart + fail-closed por componente
  ausente/inactivo. Proyección: OpeningMembers.ComponentMembers desde el pin. NOTA de proceso:
  había trabajo SIN commitear de otro agente en el checkout compartido (authoring_fixed_shelf.go,
  joinery_system_contract_test.go) — se dejó intacto, commit solo con rutas explícitas.
- Slice 3 (bevel 45°): **EN PR #1335** (rama `feat/1327-door-bevel`, HEAD 58896945, base main b494072f,
  `Refs #1327 + Delivery: partial` — restante: perfil de fábrica + aceptación E2E del owner).
  - Declaración: `bevel_angle_deg`/`bevel_size_mm`/`bevel_at` en `OpeningBodyModifier` (JSONB
    aditivo) + contrato camelCase + esquema OpenAPI (`OpeningProfileBodyModifier`,
    `ManufacturingRoutingBevel` nuevo) + regeneración + editor React (sección «Bisel 45° en la
    puerta», ángulo 45 constante) con round-trip que PRESERVA un bisel declarado por API.
  - Resolver: efecto `bevel` — ángulo+tamaño+posición completos, SÓLO 45° (v1), top_front/bottom_front
    coherente con la frontera; rechaza mezclas depth+bevel y notch+bevel (hueco cerrado: un modifier
    con campos de saque Y de bisel sin `effect` entraba al caso notch y tragaba el bisel en silencio).
  - Fixture compartido: casos I/J (resolución top/bottom) + 5 inválidos; Go y TS en verde (una autoridad).
  - Layout: `LayoutBevel` (prisma bounding + ángulo + edge) materializado en las puertas por
    `applyOpeningBevelsToBoards` (rol `door` único consumidor, fail-closed en rol/between/no-cabe;
    el ancho del wedge es estricto — la puerta de 18 mm no admite patas de 18).
  - Mecanizado: op `<board>:bevel-<n>` con payload `bevel` (nunca caja rectangular) y provenance
    openingProfile; mueve el fingerprint y es determinista.
  - Release routing: intent neutral `bevel` congelado + validación fail-closed (wedge presente,
    sin holes/routing, 45°, edge conocido, extents positivos, provenance openingProfile).
  - Consumidor externo honesto: `composeFrozenDrilling` (pack web) RECHAZA explícito
    (`OPERATION_NOT_REPRESENTABLE`) una op bevel — nunca la dropea en silencio; CNC real queda para
    el adaptador que evidencie corte angular («estructura primero, CNC después»).
  - Verificación: engine+domain Go verdes; storage round-trip JSONB del bisel en suite completa
    (backend-test.sh, contenedor efímero); vitest domain 1977 + ui 2248 + web export-pack 16;
    typecheck workspace; check_openapi_drift OK; rake verify plugin verde (extensión sin cambios).
- Slice 3: **MERGEADO** (PR #1335, main 4d6c24dc, CI 22/22).

## Restante — perfil de fábrica + aceptación (2026-10-14, misma sesión)

Datos del owner (verbales, 2026-10-14): descuento **35** («como el metal, puede variar por
fábrica»), tira **70 mm de alto × espesor del frente (no fijo; 15 hoy)**, bisel 45° =
**espesor − 2** (13 en puerta 15). Creado en dev vía API: componente **TIRA-GOLA-ITA**
(b0000004-…-13270001, placement superior, rol FRENTE) y perfil **profile.gola-italiano.tira** v3
(verificado; par 33+2 documentado — ver brecha #1337).

Dos paredes encontradas en el E2E y arregladas en **PR #1336** (MERGEADO, main cc6b414d, CI 22/22):
1. `OPENING_BOM_INVALID` bloqueaba la cotización: el member componente (tira) no es demanda de
   herraje — la resolución del BOM de apertura ahora saltea members con component_id (clave
   desconocida SIN component_id sigue siendo corrupción fail-closed).
2. La tira quedaba sin material con el catálogo real (grupo frontal legacy FRENTES, anterior a
   #403): FRENTE canónico ahora hereda la choice FRENTES y la familia frontal cascada
   FRENTE → FRENTES (fixture compartido actualizado).

Tercera pared del mismo E2E, arreglada en **PR #1338** (MERGEADO, main 898b566a, CI 22/22): el DTO
wire del snapshot (#1304) no mapeaba el payload `bevel` — el release congelaba el wedge y la API
lo servía sin él. Test de DTO pinnea el wedge completo en el wire.

Nota de fixture dev: el módulo SMK-PUERTA del smoke pasó a rol FRENTES (v2) — fiel a los módulos
reales del taller, cuya elección de frente vive en FRENTES; sin una parte frontal el filtro de
choices del working-copy descarta FRENTES y el release no puede materializar la tira.

**E2E LIMPIO FINAL (post-#1336+#1338, backend main)**: diseño desechable con choices SOLO
FRENTES → apertura resolved con bomReason LIMPIO + bevel resuelto (45/13) → cotización → release
cfef2001 → snapshot sirve la op `…130504-copy-0:bevel-0` CON wedge (45°, top_front,
[396,13,13], provenance profile.gola-italiano.tira). Despiece congelado: `opening-strip-tira`
400×15 con material ARA-MOS-15 (color de puerta vía alias FRENTES); puerta 681×396 (720 − 35 − 4
holgura). Regresión 8006: fila v8/30 byte a byte intacta (muesca + depth_reduction + herrajes).

Brecha menor fileada: **#1337** (pin exige el par legacy; door_reduction-only no puede pinearse).

Corrección tras la primera prueba visual del owner (2026-10-14, «astilla fina» en el 3D): el
módulo real trae MANGUETE superior frontal (COM-MAN-BAJO-FRO: PW-2T×150 en y=PD-W, rol horizontal)
que tapaba/z-fighteaba la tira — el perfil italiano no declaraba `depth_reduction` (el metal lo
tiene desde #1317). Fix de DATOS, sin código: **perfil v4** agrega
`{"role":"horizontal","effect":"depth_reduction"}` (derivado = 15); el pass de #1317 recorta el
panel horizontal de fondo completo y corre el manguete Y, dejando la tira como única superficie
frontal de la revela. Probe engine: techo 300→285, strip [400,15,70] intacto en y 285-300. El
fixture smoke ganó su manguete (SMK-MAN-SUP-FRO) para que el E2E ejerza el camino completo
(sin él, el pass falla cerrado — correcto). El owner debe QUITAR y RE-APLICAR la apertura
(pinea v4) + re-sync. Swatch de bisagra en blanco = opción sin imagen de preview (cosmético,
pre-existente).

Feedback visual del owner #2 (2026-10-14): la tira blanca sobre la puerta =
el manguete con la v3 pineada (fix v4 ya dado) + dos brechas reales:
1. **Muesca lateral 70×15**: se declara como dato (**perfil v5** agrega
   `{"role":"lateral","effect":"notch",70×15,top_front}`) — la convención del
   8006 (su sección). Release v5: route ops 70×15 en ambos laterales + bevel
   45/13 en la puerta + despiece. Sin muesca, el costado cierra la banda.
2. **Render del bisel**: el wedge viajaba al plugin pero el Ruby lo ignoraba.
   **PR #1339** (MERGEADO, main bf3303f0, CI 22/22): parse fail-closed de
   `bevels` + el builder materializa la banda como **prisma pentagonal con la
   hipotenusa a 45°** (sin booleanas, mismo canal que la muesca). v1: through-
   edge 45° con patas iguales; muesca+bisel, otro ángulo o interior fallan
   loud. `rake verify` verde (0 ofensas, 1446 runs; 7 tests nuevos).
   RBZ **0.1.72** (sha256 39f05bdb…) construido del merge bf3303f0.

El owner debe: instalar el RBZ 0.1.72 (Extensiones → Instalar, quit+reopen
SketchUp), QUITAR y RE-APLICAR la apertura (**pinea v5**: bevel 13 +
depth_reduction 15 + notch 70×15) + re-sync. Esperado: tira Moscato completa
en la revela, laterales con el paso 70×15, puerta con descuento 35 y el corte
45° visible arriba; despiece con tira + puerta 681.

Feedback visual del owner #3 (2026-10-14, captura 3: «geometría blanca empalmada
en la puerta + no hace el 45 en la parte superior»):dos causas SEPARADAS:
1. El plugin instalado en SketchUp es la **0.1.71** (grep en Plugins:
   identity.rb = 0.1.71, 0 ocurrencias de «bevel» en furniture_builder.rb) —
   el owner NUNCA instaló el RBZ 0.1.72. El backend sí sirve bevels (op
   congelada verificada) pero el host sin el código de #1339 dibuja la caja
   lisa: la puerta sale rectangular y el 45° «no se hace». Requiere instalar
   el RBZ correcto + quit completo + reopen (el footer debe decir v0.1.72).
2. El manguete «empalmado» sale de la tira fuera de su banda: el diseño del
   owner tiene profundidad **590** (Princeton KDT low-poly K4R low; y=PD−W =
   440 para un manguete de 150). El **recede Y −15 del pass #1317** mueve ese
   manguete a y=425 con su medida intacta — la superposición visible nace de
   que el boceto del dueño venía del INSERT discreto (la línea marrón detrás
   es su borde anterior no re-generado), no de la aritmética del pass
   (verificada: techo/manguete 590−15=575, strip [400,15,70] en y 575-590).
   Re-aplicar limpia la geometría host stale: el pin v5 gobierna el resolve.

Pendiente (aceptación owner): aplicar la apertura con «Gola italiano (tira de melamina)» en un
mueble de prueba en SketchUp — tira con color de puerta en 3D y en despiece, puerta con descuento
35 y el corte 45°; el 8006 sigue intacto.
