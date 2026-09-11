# PTX / CADmatic 4 — contrato conservador de refilados para r3

> Decisión de implementación preparada a partir de la especificación Pattern Exchange
> ya inventariada en `01_investigacion_y_contrato.md`, las dos muestras saneadas de
> `field/` y la geometría ejecutada de `granete.cut-program.v1`.
>
> Este documento NO valida CADLink/CADmatic. Congela únicamente el subconjunto que
> Granete puede implementar sin inventar semántica. El estado sigue
> `NOT_TESTED/notClaimed` hasta importación/readback real.

## 1. Resumen de gates G1–G5

| Gate | Estado para r3 | Decisión |
|---|---|---|
| G1 — `DIMENSION` observado | **RESOLVED** | Las diferencias ≈9.8/9.9 mm se explican por el fixed rip trim ≈10 mm; `DIMENSION` sigue siendo relativa al subpanel/raíz útil. |
| G2 — cuatro refilados físicos | **SPEC_POLICY_READY** para `TRIM_TYPE=1`, sin giro inicial | Mapear por eje operativo y lado `leadingBand`, no por nombre visual. Near/fixed → `TRIM_F*`; far/falling minimum → `TRIM_V*`. |
| G3 — HEAD / recut | **PROFILE_POLICY** | No derivar de los cuatro márgenes. r3 deja `TRIM_HEAD/TRIM_FRCT/TRIM_VRCT` sin override mientras no exista evidencia suficiente/configuración explícita. |
| G4 — no double counting | **RESOLVED** | El margen total ya incluye kerf; PTX recibe el total. El árbol PTX empieza en la raíz útil y no vuelve a emitir las divisiones perimetrales. |
| G5 — FUNCTION 92 / offcut | **RESOLVED_SUBSET** | Emitir 92 sólo para un remnant `rest` producido por una división phase-2/cross que cumpla la regla geométrica y de identidad descrita abajo. |

Los demás casos fallan cerrado o conservan la representación r2 cuando no entren en conflicto.

---

## 2. G1 — por qué aparecen 872.4 y 1225.5

La anomalía aparente se reproduce en dos muestras independientes.

### Muestra A / patrón 1

```text
board rip extent = 1220
first rip        = 333.0
kerf             = 4.4
TRIM_FRIP        = 10.0
second rip       = 872.4
```

Comprobación:

```text
333.0 + 4.4 + 872.4 + 10.0 = 1219.8 ≈ 1220
```

La diferencia residual de 0.2 mm pertenece a la granularidad observada del
archivo externo; no es una nueva fase ni una coordenada global.

### Muestra B / patrón 2, `TYPE=1`

El giro inicial hace que el eje de rip corresponda al lado de 2440 mm:

```text
1200.0 + 4.4 + 1225.5 + 10.0 = 2439.9 ≈ 2440
```

### Decisión

`CUTS.DIMENSION` NO cambia de significado en r3.

El compiler debe:

1. ejecutar el `CutProgram` real;
2. separar el prefijo de divisiones `trim=true`;
3. identificar la **raíz útil** resultante;
4. compilar las divisiones productivas relativas a esa raíz útil.

Nunca sumar el offset global del tablero a `DIMENSION`.

---

## 3. G2 — mapping de los cuatro márgenes para el subconjunto r3

### 3.1 Autoridad

Pattern Exchange define, por clase de operación:

```text
TRIM_FRIP  fixed rip trim
TRIM_VRIP  minimum/falling-waste rip trim
TRIM_FXCT  fixed crosscut trim
TRIM_VXCT  minimum/falling-waste crosscut trim
```

Los trims incluyen kerf. Con `TRIM_TYPE=1` se ejecuta primero el **fixed trim**;
el waste/falling trim queda al final.

Granete no debe mapear por las palabras `left/right/top/bottom` de forma ciega.
La autoridad de lado es la propia geometría del CutProgram:

```text
leadingBand=true  → lado near / fixed-first
leadingBand=false → lado far / falling-waste
```

### 3.2 Subconjunto inicial

La primera r3 soporta trim positivo sólo cuando, después de proyectar fuera el
prefijo perimetral, el frame PTX puede normalizarse sin giro inicial y con:

```text
axis y → rip class
axis x → crosscut class
TRIM_TYPE = 1
VECTORS = off
```

Para el frame actual de Granete, sin rotación PTX:

| Margen Granete | Semántica estructural | PTX |
|---|---|---|
| `bottomMm` | eje y + `leadingBand`, fixed-first | `TRIM_FRIP` |
| `topMm` | eje y + far/falling side | `TRIM_VRIP` |
| `leftMm` | eje x + `leadingBand`, fixed-first | `TRIM_FXCT` |
| `rightMm` | eje x + far/falling side | `TRIM_VXCT` |

La tabla es una **política de frame r3** respaldada por el estándar y por la
clasificación explícita `leadingBand`; no es una afirmación sobre nombres físicos
bajo cualquier orientación.

Los `TRIM_V*` son mínimos de falling waste. La geometría de la raíz útil sigue
siendo la autoridad de cuánto queda realmente en el lado far; por eso un margen
far explícito se refleja en la extensión útil y además como mínimo de seguridad,
sin inventar una pasada adicional.

### 3.3 Casos no soportados inicialmente

Fail closed cuando, con trim > 0:

- el patrón necesita `PATTERNS.TYPE=1` u otra rotación no implementada;
- no puede determinarse inequívocamente rip/cross en el frame útil;
- las divisiones de trim no forman el prefijo estructural esperado;
- una transformación exigiría reinterpretar lados sin una regla demostrada.

No cambiar silenciosamente de lado ni poner todos los valores en fixed.

---

## 4. G3 — `TRIM_HEAD`, `TRIM_FRCT`, `TRIM_VRCT`

Las muestras contienen:

```text
TRIM_HEAD = 20
TRIM_FRCT = 20
TRIM_VRCT = 0
```

pero no permiten distinguir qué regla produjo los dos valores de 20.

Dos igualdades muestran que un trim interno de 20 participa en la geometría de
offcut/crosscut:

```text
697.0 + 4.4 + 1718.6 + 20 = 2440.0
350.0 + 4.4 + 845.6  + 20 = 1220.0
```

Como `TRIM_HEAD` y `TRIM_FRCT` valen 20 simultáneamente, esas sumas NO permiten
identificar cuál gobierna cada caso ni crear una fórmula general.

### Política r3

Los cuatro márgenes perimetrales de Granete NO alimentan HEAD/recut.

Para la primera r3:

```text
TRIM_HEAD = blank
TRIM_FRCT = blank
TRIM_VRCT = blank
```

Vacío significa **sin override**, distinto de cero. Así evitamos hardcodear
`20` como supuesto universal y permitimos que el entorno del cliente conserve
sus parámetros locales hasta que la prueba de importación diga si necesitamos
una revisión posterior machine/material específica.

La presencia de phase 3 no obliga por sí sola a inventar estos campos: r2 ya
representa phase 3 con esos overrides vacíos.

---

## 5. G4 — proyección PTX sin contar el refilo dos veces

Granete ya representa un margen total. Ejemplo:

```text
margin = 10
kerf   = 4
```

El CutProgram contiene conceptualmente:

```text
solid waste = 6
kerf band   = 4
trim total  = 10
```

Como `TRIM_*` PTX incluye kerf:

```text
PTX trim = 10
```

Nunca `6` y nunca `14`.

### Proyección requerida

El compiler r3 NO modifica el CutProgram original.

Debe crear una proyección PTX:

```text
raw board CutProgram
  ├─ trim:left/right/bottom/top     → MATERIALS.TRIM_*
  └─ usable-root subtree            → PATTERNS/CUTS
```

Reglas:

1. ejecutar/validar primero el CutProgram completo;
2. exigir que los trims perimetrales formen una cadena coherente hasta una única
   raíz útil;
3. calcular cada margen desde la geometría ejecutada (`parentExtent-keptExtent`),
   nunca desde UI;
4. no emitir las divisiones `trim=true` como CUTS productivos;
5. reiniciar staging PTX en la raíz útil (`generation=1`);
6. conservar BOARDS con dimensiones brutas;
7. compilar DIMENSION productiva relativa a regiones dentro de la raíz útil;
8. comprobar en verifier que no exista trim/kerf duplicado.

Casos obligatorios: 10/4, `trim==kerf`, `trim<kerf`, asimétricos y trim cero.

---

## 6. G5 — contrato soportado para `FUNCTION 92 + Xn`

### 6.1 Patrón repetido en las muestras

Muestra A:

```text
parent phase-2: FUNCTION 2, DIMENSION 697.0, SEQUENCE 5
release row:    FUNCTION 92, DIMENSION 1718.6, PART_INDEX X1, QTY_RPT 1, SEQUENCE 6
child phase-3:  FUNCTION 3, DIMENSION 333.0, SEQUENCE 7
```

Muestra B:

```text
parent phase-2: FUNCTION 2, DIMENSION 350.0, SEQUENCE 14
release row:    FUNCTION 92, DIMENSION 845.6, PART_INDEX X1, QTY_RPT 1, SEQUENCE 15
child phase-3:  FUNCTION 3, DIMENSION 1200.0, SEQUENCE 16
```

El manual define 92 como trim/waste de phase 2 y `Xn` como referencia a OFFCUTS.

### 6.2 Regla r3

Una release r2 se convierte a una pasada física 92 únicamente si:

1. el terminal es `kind=remnant` y tiene OFFCUT `Xn` asignable;
2. es el **rest-side terminal** de una división productora phase 2 cuya función
   normal es `2`;
3. el remnant es rectangular y su extent sobre el eje productor es conocido;
4. existe un kept subtree/pieza productiva al otro lado;
5. no existe otra release física del mismo `Xn`;
6. la proyección puede ordenar el evento 92 después del producer y antes de
   cualquier recut dependiente sin violar dependencias.

La fila:

```text
FUNCTION   = 92
DIMENSION  = remnant extent sobre el eje de la división productora
QTY_RPT    = 1
PART_INDEX = Xn
QTY_PARTS  = blank salvo evidencia distinta
SEQUENCE   = positivo; después del producer y antes del recut dependiente
```

### 6.3 Scheduler PTX

Añadir 92 crea un evento físico que r2 no tenía. r3 NO reutiliza ciegamente
`division.order` como SEQUENCE final.

Construir un event schedule determinista que:

- preserve el orden relativo de divisiones reales;
- inserte la release 92 tras su producer phase 2;
- sitúe recuts dependientes después de esa release;
- mantenga CUT_INDEX como preorder estructural independiente.

Los gaps numéricos de las muestras externas no son un golden: el estándar
requiere orden, no copiar la numeración de otro optimizador. El verifier compara
relaciones de orden y unicidad/positividad, no los mismos enteros del fixture.

### 6.4 Fail-closed

No convertir automáticamente a 92:

- remnant producido por phase 1 o phase 3;
- remnant del kept side;
- waste no reutilizable;
- pieza rest-side;
- release con productor/eje ambiguo;
- caso que duplicaría `Xn`.

Si la antigua release r2 no puede coexistir con el perfil r3 sin ambigüedad, el
caso bloquea con razón específica.

---

## 7. Blockers nuevos recomendados

```text
ptx_compile.trim_frame_unsupported
ptx_compile.trim_structure_invalid
ptx_compile.trim_mapping_ambiguous
ptx_compile.trim_geometry_mismatch
ptx_compile.offcut_release_92_unsupported
ptx_compile.offcut_release_duplicate
```

No volver a `trim_unsupported` genérico para todos los trims positivos.

---

## 8. Orden de implementación cuando vuelva el agente

Un solo PR de #661, con commits/slices internos:

1. **RED / planner**
   - fixtures 10/4, asimétrico, ==kerf, <kerf;
   - proyección de raíz útil;
   - mapping FRIP/VRIP/FXCT/VXCT;
   - negativos frame/estructura.
2. **Compiler + verifier**
   - MATERIALS.TRIM_*;
   - no trim CUTS duplicados;
   - FUNCTION 92 subset;
   - scheduler;
   - mutation tests independientes.
3. **Profile/adapter/download**
   - `ptx-cadmatic-4@r3`;
   - adapter version/digest;
   - Go/TS parity + historical pins;
   - unified/by-material/ZIP;
   - UI `Candidato — no validado en máquina`.

No implementar TYPE=1, BOOK stacking, PARTS_INF/UDI/NOTES ni otros formatos en
este PR salvo dependencia demostrada por un test de trims.

---

## 9. Criterio de cierre de #661

#661 queda técnicamente cumplida cuando un plan representable con trims positivos
recorre:

```text
CutPlan/CutProgram completo
→ proyección trim r3
→ MATERIALS.TRIM_* + raíz útil
→ CUTS productivos + 92/Xn sólo donde aplica
→ serialize bytes
→ parse bytes
→ verifier independiente = []
→ adapter/profile r3
→ descarga existente
```

manteniendo `NOT_TESTED/notClaimed`. La aceptación real por CADLink/CADmatic no
se sustituye por esta prueba interna.