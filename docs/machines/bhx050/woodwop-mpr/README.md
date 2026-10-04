# woodWOP MPR — investigación de formato y generador candidato (B2-prep)

> **Estado: `PUBLIC_REFERENCE_ONLY` — material de investigación.** Este pack
> NO valida la instalación del client-a, NO cambia el perfil
> `mpr-woodwop@r1` (cero dimensiones evidenciadas) y NO abre el adapter
> (sigue `SERIALIZER_NOT_IMPLEMENTED`). Es la hipótesis de trabajo citada
> campo por campo, lista para **diferir contra las muestras reales** del
> kit de recolección `b1-woodwop-evidence-kit.md` (PR #1021): lo que la
> muestra confirme se marca `EVIDENCED`; lo que corrija, se corrige aquí
> primero. #879: «un artículo comercial no define gramática» — pero sí
> ordena la investigación.

## Fuente primaria

- **Documento**: HOMAG *PRODUCT INFORMATION — Description woodWOP-file*,
  Subject 4.2.7, doc. **9-080-42-7190-D00, 26 de julio de 2006** (era
  woodWOP 4.x). Copias en este directorio:
  [`woodwop-file-description-1-2.pdf`](./woodwop-file-description-1-2.pdf) (70 págs. 1/2),
  [`woodwop-file-description-2-2.pdf`](./woodwop-file-description-2-2.pdf) (2/2),
  más el análisis anotado de un MPR real
  ([`analisis-pp-homag-mpr.pdf`](./analisis-pp-homag-mpr.pdf), woodWOP 6.0.53).
- **Procedencia pública**: adjuntos del hilo
  [FreeCAD — post processor Homag](https://forum.freecad.org/viewtopic.php?t=83741);
  espejos: [Scribd](https://www.scribd.com/document/787227806/woodwop-FILE-Description1-2),
  [cnc.info.pl](https://www.cnc.info.pl/download/file.php?id=14660).
- **Advertencia de época**: 2006/woodWOP 4.x. La BHX 050 del client-a puede
  correr un woodWOP más nuevo (o exportar MPRX/MPRXE) — la única fuente
  que define la gramática de ESTA instalación es la muestra del kit B1.

## Estructura del archivo (secuencia fija, doc §2)

| Bloque | Descriptor | Contenido |
|---|---|---|
| Data head | `[H` | `VERSION="4.0"` + parámetros de máquina/flags (doc §5) |
| Variable table | `[0` | opcional |
| Sistemas cartesianos | `[K` | opcional |
| Contornos | `]n` + `$Em` | `KP/KL/KA/KR/KF/KSL/KSA`; **valores sin comillas** |
| Procesos | `<n \Nombre\` | filas `CLAVE="valor"` **con comillas** (desde v4.0) |
| Fin | `!` | fin del archivo variante |

- Base obligatoria: `<100 \Werkstck\` (cabecera de pieza). Resto opcional.
- Parser integrado (doc §4): expresiones (`"B/2"`, `"1000-32"`), constantes
  `_BSX/_BSY/_BSZ` (largo/ancho/espesor de la pieza terminada), `_mirror`,
  `IF()/SIN()/...`, `@` = medida relativa. **El generador candidato emite
  sólo literales numéricos** — sin expresiones (exactitud verificable).
- Comentarios: `\` hasta fin de línea.

## Subconjunto de perforado (doc §9, con localizador)

### `<100 \Werkstck\` — pieza (§9.1.1, ID 100)

`LA` (largo terminado, =_BSX) · `BR` (ancho, =_BSY) · `DI` (espesor, =_BSZ) ·
`AX/AY` (sobrante cruda) · `RL/RB` (alternativa a AX/AY) ·
`RNX/RNY/RNZ` y `FNX/FNY` (retrocesos del cero contra el tope de máquina).
Sistema de coordenadas: origen **abajo-izquierda**, X→largo, Y→ancho
(diagrama §9.1.1; `KO=0` «left below» default).

### `<101 \Comment\` — comentarios (§9.1.2, ID 101)

Filas `KM="texto"` — el canal de trazabilidad Granete dentro del MPR.

### `<102 \BohrVert\` — perforado vertical (§9.2.1, ID 102)

`XA`, `YA` (posición) · `TI` (profundidad) · `DU` (diámetro; alternativo
`TNO`) · `BM` (ciclo: `LS`/`SS`/`LSL`/`SSS`/`LSU`/`LSLU` o subprograma NC) ·
`AN` (cantidad; alternativa `LA` = largo de fila) · `AB` (paso de raster) ·
`MI` (0=desde punto inicial, 1=desde centro) · `XR`/`YR` (dirección de fila) ·
`WI` (ángulo de raster, ignorado por el generador NC) · `S_` (rpm lenta/
normal/rápida) · `F_` (avance o `STANDARD`) · `KO` (0=abajo-izq …
3=arriba-izq) · `??` (condición) · `EN` (enable). **Granete emite una sola
perforación por macro: `AN="1"`, `BM="SS"`, sin raster.**

### `<103 \BohrHoriz\` — perforado horizontal (§9.2.2, ID 103)

`XA`, `YA`, **`ZA`** (altura del eje del taladro; el doc muestra `D/2` —
expresión; el candidato emite el literal) · **`BM`: `XP`/`XM`/`YP`/`YM`**
(dirección de avance del taladro: entra desde el canto opuesto) o `C` con
`WI` · `TI` · `DU` | `T_` · `AN` | `LA` · `MI` · `AB` · `F_` · `ANA`
(distancia de arranque adicional) · `KO` · `??` · `EN`.

### No emitidos por Granete (reservados, con localizador)

`<104 \BohrUniv\` (§9.2.3, taladrado universal con ángulos C/WI),
`<131 \UfluBohr\` (§9.2.4, desde abajo), `<109 \grooveen\` (§9.2.5, ranurado),
`<105`-`<108` (fresados de contorno/encimar/kapear — parte 2 del doc). El
adapter debe rechazarlos (`OPERATION_NOT_REPRESENTABLE`) hasta que el modelo
resuelto los transporte.

## Mapeo Granete → MPR candidato

La misma política de transformación de KDT
(`machines/kdt/transform.ts`, front-up `{X=z, Y=w−x, Z=−y}` / back-up
`{X=z, Y=x, Z=+y}`, programas por pieza/cara) mapea al vocabulario MPR:

| Operación neutral (cara arriba) | MPR |
|---|---|
| front (up=front) / back (up=back) | `<102 \BohrVert\` XA=yMm, YA=w−xMm (front-up) / Y1=xMm (back-up), TI=depth, DU=diameter |
| left (up=front) | `<103` BM=`YM` (entra desde Y=w), XA=yMm, YA=w, ZA=t−canto |
| right (up=front) | `<103` BM=`YP` (entra desde Y=0), XA=yMm, YA=0, ZA=t−canto |
| bottom (up=front) | `<103` BM=`XP` (entra desde X=0), XA=0, YA=w−xMm, ZA=t−canto |
| top (up=front) | `<103` BM=`XM` (entra desde X=l), XA=l, YA=w−xMm, ZA=t−canto |
| left/right (up=back) | BM se invierte (`YP`/`YM`), YA=xMm sin espejo; bottom/top mantienen `XP`/`XM` con YA=xMm |
| AlignmentFace (KDT) | sin equivalente documentado en el subconjunto — **pregunta abierta** (el marco lo fija el cero contra el tope + FNX/FNY/RN*) |

Los ejes coinciden con KDT (origen abajo-izquierda, X=largo, Y=ancho) pero
la DIRECCIÓN del taladro es explícita en MPR (`BM`), no un cuadrante — la
tabla anterior es la correspondencia exacta entre ambas representaciones.

## Preguntas abiertas (para la muestra del kit B1)

1. ¿Qué `VERSION` de header emite el woodWOP del client-a y qué campos del
   `[H` son obligatorios en su versión? (el doc documenta 4.0/2006)
2. ¿MPR o MPRX/MPRXE es lo que su flujo manda hoy a la BHX? (el kit pide
   ambos si hay duda)
3. ¿Encoding real de bytes (ASCII/UTF-8) y fin de línea (CRLF/LF)? — el doc
   no lo especifica; sólo los bytes de la muestra lo definen.
4. ¿El control acepta `DU` directo o exige `TNO`/`T_` mapeado a sus
   herramientas? (kit: capturar configuración de herramientas con IDs)
5. ¿Existe equivalente del AlignmentFace KDT (cara de alineación roja) en su
   flujo? ¿Cómo se fija el cero de pieza contra el tope?
6. `BM` de verticales: ¿el control usa `SS` por defecto o un ciclo propio
   (subprogramas NC TVBOHR*)?

## Cómo se usa el generador candidato

`packages/excel/src/machines/woodWopMpr/` — writer + lector + transformación
bajo el mismo fixture `fixture-kdt-field-001` (mismas 12 operaciones, misma
tabla de valores esperados). Tests: round-trip, correspondencia KDT↔MPR
operación por operación y golden de bytes del candidato. Es infraestructura
de investigación/pruebas: **ningún camino de producción lo invoca**.
