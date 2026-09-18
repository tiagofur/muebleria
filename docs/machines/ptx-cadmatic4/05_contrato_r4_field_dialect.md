# PTX / CADmatic 4 — contrato r4 del dialecto de campo (#781)

> Decisión de implementación preparada a partir del **primer rechazo real de
> campo** (2026-09-17): un PTX generado por Granete desde el flujo normal del
> producto fue convertido por CADLink /CAD4 y falló con
> `OnlineConvertedFailedMsg` ("No posible convertir run
> '\\192.168.1.70\Producción\CORTE\corte-cocina-prueba-copia.ptx'").
>
> Este documento NO valida CADLink/CADmatic y NO atribuye la causa del rechazo
> a ninguna diferencia concreta. Congela el subconjunto que Granete emite como
> **segundo candidato** (`ptx-cadmatic-4@r4` + `granete-ptx@1.3.0`), corrigiendo
> defectos objetivos y endureciendo sospechosos razonables. El estado sigue
> `NOT_TESTED/notClaimed` hasta el segundo intento real.

## 1. Artefacto inspeccionado y defectos objetivos

El artefacto rechazado (9324 bytes, ASCII puro, sin BOM, CRLF) fue comparado
contra los dos PTX reales funcionales del cliente (versiones saneadas en
`field/`, originales NUNCA en el repo) y contra las muestras del contrato r3.

| Defecto | Observado en el rechazado | Evidencia funcional (cliente) |
|---|---|---|
| `PARTS_REQ.CODE` | 26/48 códigos > 50 chars (máx. 119); refs internos de colocación (`agr-…-copy-N`); 13 repetidos, 9 con **dimensiones distintas** | Códigos cortos legibles (`"PTA/DER. Pos.1"`, `"AJUSTE"`); el receptor también tolera repeticiones |
| `OFFCUTS` | 6 celdas (termina en WIDTH) | 8 celdas con `OFC_QTY=1` (`OFFCUTS,1,1,,2,1718.601,862.601,1`) |
| Orden de secciones | `OFFCUTS` al final → `X1/X2/X3` son forward references | `OFFCUTS` antes de `PATTERNS/CUTS`; cada `Xn` ya declarado |
| Marcadores `Xn` | Filas `FUNCTION=1, SEQUENCE=0, QTY_RPT=0, PART_INDEX=Xn` (convención interna Granete) | `Xn` aparece **exclusivamente** en filas `FUNCTION 92` |
| Filename | `corte-cocina-prueba-copia.ptx` (slug descriptivo largo; la ruta tenía además `\Producción\` no-ASCII) | Nombres cortos (`R2201.PTX`) |

## 2. Código de fabricación — la identidad también era el problema

El `CODE` del rechazado no identificaba una línea física de fabricación: el
mismo string aparecía en filas con medidas incompatibles (533×768, 263×768 y
418×263 compartían código). La causa: el flujo de liberación
(`engineeringCuttingDemand`) rellenaba `partCode` con el `partId` interno
cuando el catálogo no definía código, mientras el flujo BOM ya emitía códigos
limpios vía `resolveCleanPieceCode`.

### Autoridad r4

```text
internal pieceRef (id/uuid)  → joins, persistencia, provenance, mapeo PTX
manufacturing code           → app, labels, PARTS_REQ.CODE
```

- **Una sola autoridad**: `resolveCleanPieceCode` (domain) produce
  `MOD-XXX[-Ln]-Pnn` (sufijo `-L<n>` para códigos de módulo repetidos; el
  `partCode` de catálogo se conserva si ya es limpio). El flujo de liberación
  ahora la usa igual que el flujo BOM.
- **Una fila PARTS_REQ por pieza física, sin consolidación** (decisión del
  owner 2026-09-17): habrá archivos CNC por pieza y cada pieza debe poder
  referenciarse individualmente. Copias 2..N de una fila con cantidad > 1
  reciben el sufijo `-C<n>` en el optimizador (`MOD-CAJ-01-P04-C2`); la copia
  1 queda sin sufijo (es lo que muestra la app para la fila).
- **Asignación canónica compartida (revisión §1)**: las ocurrencias de
  muebles se ordenan por su identidad durable (ítem de proyecto en el flujo
  BOM, instancia de mueble en el flujo release) y las piezas de cada
  ocurrencia por `partId` ANTES de numerar `-L<n>`/`Pnn`
  (`canonicalWorkshopOccurrences`/`canonicalWorkshopParts`): reordenar los
  arrays de entrada jamás cambia los códigos (tests de reorden en ambos
  flujos). Caveat documentado: BOM y release clavan ocurrencias por ids de
  espacios distintos (ítem vs furniture instance), así que dos módulos
  idénticos repetidos pueden intercambiar cuál es "L2" entre la vista de
  proyecto y la liberación, hasta que el contrato de demanda cargue el
  ordinal canónico de unidad (seguimiento posterior a #781).
- **Fail-closed en el compilador r4** (`partCodeAuthority:
  'workshop-labelref'`, `partCodeMaxLength: 50`): `PARTS_REQ.CODE` es el
  labelRef taller; una pieza SIN código (`ptx_compile.part_code_missing`,
  revisión §2 — sin fallback al partCode de plantilla, que es la autoridad
  que #781 reemplaza), un código > 50 (`ptx_compile.part_code_too_long`) o
  duplicado entre piezas físicas (`ptx_compile.part_code_duplicate`) bloquea
  — nunca se trunca ni se fusiona. El optimizador ya no rellena labelRef con
  el id de colocación: si el flujo de origen no asignó código, el hueco
  llega vacío hasta el compilador y falla cerrado. PROHIBIDO derivar 1:1 del
  CODE legado (heredaría las colisiones).

## 3. Cambios de dialecto r4 (gobiernan los bytes)

| Política | Dimensión del perfil | Comportamiento |
|---|---|---|
| Cantidad de retazo | `offcutsWithQuantity: true` | `OFFCUTS.OFC_QTY=1` — cada registro representa un retazo físico individual del patrón (subset demostrado; no es una constante global: si el modelo futuro representa book/repetición, el valor y el contrato se revisan con evidencia) |
| Orden de declaración | `offcutsBeforePatterns: true` | `OFFCUTS` se emite antes del primer bloque `BOARDS/PATTERNS/CUTS`; ninguna referencia `Xn` apunta a un OFFCUTS posterior en el byte stream (invariante verificada por el readback) |
| Marcadores | `offcutCutMarkers: 'function92-only'` | `Xn` sólo en filas `FUNCTION 92` (subset §6.2 del contrato r3). Revisión §3: **sólo se declara el pareado OFFCUTS↔92 demostrado** — un remanente sin 92 no obtiene ni pseudo-operación `QTY_RPT=0/SEQUENCE=0` NI fila `OFFCUTS` (queda sin declarar en el archivo industrial; el inventario interno de Granete lo conserva). Ninguna semántica clasificada UNKNOWN se emite |
| Código de pieza | `partCodeAuthority` + `partCodeMaxLength` | §2 arriba |

r2/r3 quedan inmutables (digests y goldens intactos); las selecciones pineadas
a r3 muestran el blocker stale-revision — nunca un retarget automático a r4.

## 4. Clasificación de las diferencias observadas (§G de #781)

```text
CHANGED IN R4              OFC_QTY · OFFCUTS antes de PATTERNS/CUTS · Xn sólo
                           en FUNCTION 92 con OFFCUTS declarado únicamente
                           para el pareado demostrado (revisión §3: los
                           remanentes no-92 no se emiten) · PARTS_REQ.CODE
                           taller fail-closed (missing/too_long/duplicate) ·
                           filename industrial corto
KEPT INTENTIONALLY         MATERIALS antes de PARTS_REQ (sólo OFFCUTS se
                           reordena — sin razón documental para más) ·
                           PATTERNS sin PICTURE trailing · BOARDS sin
                           COST/STK_FLAG · JOBS con vacíos finales · enteros
                           vs decimales · quoting mínima (los códigos r4 son
                           ASCII sin comas)
UNKNOWN / FIELD TEST NEEDED  ruta ASCII vs UNC con acentos (§6) — único resto;
                             la representación OFFCUTS-sin-marcador dejó de
                             emitirse (decisión conservadora revisión §3)
```

## 5. Filename industrial

El lane CADmatic 4 r4 entrega `G<hex12>.ptx` (revisión §4: 48 bits del hash
sha256 de `cutPlan.id + version`, 16 caracteres ASCII sin espacios/acento) y
`G<hex12>-<n>.ptx` por material (índice 1-based, único por construcción).
Determinista y collision-safe (el cumpleaños de 48 bits es despreciable a
nuestros volúmenes; incluir la versión impide que un plan regenerado conserve
el filename del anterior; no deriva del nombre de proyecto, que puede
repetirse). La provenance descriptiva (nombre de obra, identidad del plan,
release) vive en el manifest — el nombre industrial no reemplaza al
manifiesto.

## 6. Runbook del segundo intento de campo (post-merge)

```text
1. Generar el PTX desde el flujo normal del producto (r4 seleccionado).
2. Guardar PTX + manifest sin tocarlos; verificar el SHA-256 del manifest.
3. Copiar el PTX a una ruta ASCII simple, p.ej. \\192.168.1.70\CORTE\Gxxxxxx.ptx
   (la ruta operativa \Producción\ queda para una segunda corrida que aísle
   el factor Unicode/path).
4. NO renombrar después del manifest (o registrarlo aparte).
5. Ejecutar CADLink /CAD4 sobre el archivo.
6. Capturar popup/log y el .rlt si se genera.
7. NO cortar tablero todavía.
8. Registrar: repo SHA, CutPlan id/version, profile r4 digest, adapter 1.3.0
   digest, PTX SHA-256, ruta/filename exactos, resultado, capturas.
```

## 7. Identidad industrial

```text
profile   ptx-cadmatic-4@r4   digest 94401b8c17cd54b80e548bcc85cd184f80ba25ba97056ef6d46d81d1cb5114fc
adapter   granete-ptx@1.3.0   implementationDigest dce80ccded4d5e4454461de4cf219fc40fa7c95836d065d447c881a998c0a4bd
golden r4 bytes sha256 eadf184f1685f1a4aeae1375f3f571971da0485ea229ff098cf9542500ab5527
```

El golden r4 (`cutPlanPtxGoldenR4.ts`) proviene del pipeline real
(`optimizeCutPlan` → compiler r4), NO escrito a mano; cubre trims positivos,
`FUNCTION 92 + Xn`, recut fase 3 con `CUT_INDEX ≠ SEQUENCE`, dos materiales,
tres hojas, códigos taller con sufijo `-C2` y exactamente UN OFFCUTS (el
pareado con su 92, `OFC_QTY=1`) declarado antes de los bloques de patrones —
los remanentes no-92 de las hojas quedan sin declarar (revisión §3).

## 8. Límites

- El rechazo original sigue SIN causa única demostrada; cada corrección es un
  *candidate compatibility fix*.
- `supportStatus` permanece `NOT_TESTED` y el claim `notClaimed`: el segundo
  intento exitoso de CADLink es condición para promover la madurez.
- La ruta UNC del cliente no se "arregla" desde Granete (§6 del runbook la
  aísla como variable).
