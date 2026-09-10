# Granete · PTX / CADmatic 4
## Investigación técnica y contrato de implementación propuesto

**Fecha:** 10 de septiembre de 2026.
**Repositorio inspeccionado:** `tiagofur/muebleria`, `main@b3efd4191526010e440aafe20e80378f21615161`.
**Objetivo vigente:** implementar una salida PTX fiel al plan de corte para la ruta CADLink/CADmatic 4; alcance técnico de [#650](https://github.com/tiagofur/muebleria/issues/650).
**Estado:** investigación y diseño, publicados mediante preparación documental; no se ha implementado el producto, ejecutado CADLink, importado en CADmatic ni cortado material.

> Adaptación del artefacto de conversación: generar las cinco cocinas y verificar con el cliente quedan fuera de esta issue y de su cierre. El propietario realizará esas actividades. El procedimiento de campo de §10 se conserva únicamente como contexto; no es trabajo asignado al implementador.

## 1. Resultado y alcance de la evidencia

La ruta documentada es **PTX → CADLink → SAW para CADmatic**. CADLink dispone de destinos CAD3/CAD3R/CAD4/CAD5; CAD4 figura como predeterminado en la documentación consultada. Esto permite posponer **nuestro** serializador SAW, no eliminar el SAW que produce el conversor externo. [S04]

HOMAG documenta PTX y SAW como salidas distintas y separa sus configuraciones. Las instrucciones de UTF-8 para CADmatic 4/5 que aparecen bajo el apartado SAW no deben convertirse automáticamente en requisitos del PTX de entrada. [S01]

La referencia detallada de interoperabilidad está en la **Interface Guide de Magi-Cut**, capítulo 3, especificación PTX V1.17; la guía también describe CADLink. Magi-Cut identifica su relación de desarrollo/distribución de Cut-Rite con HOMAG. Esta es documentación del desarrollador, no un foro. [S03][S09]

**Ya existe evidencia pública suficiente para desarrollar el serializador y sus pruebas offline.** No es necesario esperar una validación de máquina para empezar a programar. La validación del receptor sigue siendo necesaria para declarar compatible una combinación concreta y habilitar fabricación.

### Clasificación que usaremos

| Clasificación | Uso en este proyecto |
|---|---|
| `PUBLIC_SPEC_VERIFIED` | Un requisito de interfaz tiene fuente primaria y localizador concreto. No certifica la máquina. |
| `REPO_OBSERVED` | Comportamiento leído en el commit indicado. No sustituye una ejecución de la aplicación. |
| `PROPOSED` | Decisión de diseño de este informe, pendiente de implementación/revisión. |
| `OFFLINE_CHECKED` | Comprobación local acotada; el paquete especifica exactamente cuál. |
| `FIELD_REQUIRED` | Hace falta observar CADLink/CADmatic/configuración del taller. |

Son categorías propuestas para los documentos, no nuevos estados de negocio que haya que crear automáticamente en la base de datos.

## 2. Fuentes y prioridad

| ID | Fuente primaria | Aplicación concreta |
|---|---|---|
| S01 | [HOMAG · Export options and settings](https://docs.homag.cloud/docs/en/intellidivide-in-a-nutshell-saw-export-format) | Diferencia SAW/PTX; configuración por versión de CADmatic en el apartado SAW. |
| S02 | [HOMAG · Configuration of the Cutting SAW and PTX export files](https://docs.homag.cloud/docs/en/configuration-of-the-cutting-saw-and-ptx-export-files) | Mapeo de información de piezas, vista previa y prueba de archivos. |
| S03 | [Magi-Cut · V11 Interface Guide](https://www.magi-cut.co.uk/files/V11%20Interface%20Guide.pdf) | Capítulo 3, pp. 114–179: interfaz PTX; §5.10, pp. 232–242: CADLink. |
| S04 | [Magi-Cut · CADlink, ayuda V12](https://www.magi-cut.co.uk/files/html/V12webhelp/Cadlink.htm) | Conversión, destinos, configuración, resultados y diagnóstico. |
| S05 | [Magi-Cut · Pattern exchange file — Example](https://www.magi-cut.co.uk/files/html/V12webhelp/mct1502.htm) | Muestra oficial parcial con registros CSV, referencias y niveles de corte. |
| S06 | [Magi-Cut · Pattern exchange formats](https://www.magi-cut.co.uk/files/html/V12webhelp/mct1404.htm) | CSV, comillas, parámetros, ausencia frente a cero y orientación. |
| S07 | [Magi-Cut · Pattern exchange — Import settings](https://www.magi-cut.co.uk/files/html/V12webhelp/ptx01.htm) | Distinguir importación de piezas de importación de patrones. |
| S08 | [Magi-Cut · Transfer via Pattern exchange files](https://www.magi-cut.co.uk/files/html/V12webhelp/mct1272.htm) | Transferencia, cantidades, duplicados y datos de apilado. |
| S09 | [Magi-Cut · Cut-Rite](https://www.magi-cut.co.uk/cut-rite) | Relación del desarrollador con la distribución de HOMAG. |
| S10 | [Promob · Gerenciador de corte CADmatic/Homag](https://suporte.promob.com/hc/pt-br/articles/31123206960017-Cut-Pro-Gerenciador-de-corte-CADmatic-Homag) | Corroboración independiente: CADLink, kerf, límites de fases, etiquetas. No es la autoridad del formato. |
| S11 | [Magi-Cut · Saw Interface](https://www.magi-cut.co.uk/saw-interface) | Enlaza archivo oficial de ejemplos, incluidos PTX y HOMAG. Se localizó el enlace; no se inspeccionó el ZIP binario. |
| S12 | [Magi-Cut · Import template patterns](https://www.magi-cut.co.uk/files/html/V12webhelp/mct1501.htm) | Veta continua por plantillas; distinguirla de la simple dirección de veta. |
| S13 | [HOMAG · SAWTEQ S-160](https://indiashop.homag.com/products/sawteq-s-160) | Confirma CADLink como programa de conversión en el ecosistema HOMAG. No demuestra equipamiento de la HPP 250 del cliente. |

No se ha usado como especificación la documentación de NVIDIA PTX, de CADmatic naval, de CADLink de impresión o de CADLink para ERP: son productos diferentes. No se reproducen manuales completos ni ejemplos del fabricante dentro del paquete.

### Localizadores imprescindibles en S03

| Tema | Páginas impresas |
|---|---|
| Estructura, CSV, índices | 114–117 |
| HEADER y JOBS | 118–121 |
| PARTS_REQ, PARTS_INF y PARTS_UDI | 122–127 |
| BOARDS y MATERIALS | 132–136 |
| OFFCUTS y PATTERNS | 137–140 |
| CUTS, cantidades, secuencia | 142–145 |
| VECTORS | 146–147 |
| Ejemplos con varias fases | 148–163 |
| Diccionario de campos y límites | 164–179 |
| CADLink | 232–242 |

## 3. Decisiones propuestas para Granete

### 3.1 No construir tres gramáticas por el nombre del controlador

Implementar un núcleo PTX y perfiles de recepción que restrinjan sus capacidades. El destino de CADLink también forma parte del expediente. Que existan destinos /CAD3, /CAD4 y /CAD5 sobre PTX es una base para reutilizar el núcleo; no certifica todos los controladores. [S04]

La identidad de validación debería fijar:

```text
máquina y revisión de capacidades
+ versión/build de CADmatic
+ versión/build de CADLink u otro receptor
+ opciones efectivas del conversor
+ revisión de perfil PTX
+ versión/digest del serializador
+ revisión/fingerprint del programa de corte
```

No renombrar los IDs actuales por gusto. Reutilizar `MachineProfile`, `OutputCompatibilityProfile`, `PostprocessorAdapter` y los manifiestos existentes, ampliando únicamente los datos que hagan falta.

### 3.2 Separar serialización y compatibilidad

Un perfil respaldado por documentación pública puede producir un **candidato de validación** aunque todavía no tenga evidencia de taller. La generación productiva requiere gates adicionales. Propuesta:

```text
canSerialize: sintaxis implementada + plan representable + datos completos
fieldValidation: no probado / parcial / validado / rechazado para el receptor exacto
productionAllowed: política existente + liberación exacta + capacidades verificadas
```

No marcar `VALIDATED` al completar los parámetros del perfil. Tampoco obligar a permanecer eternamente sin archivos porque todavía no se ha probado un archivo.

### 3.3 Contrato de fidelidad

El plan que se muestra debe ser el que se serializa. La igualdad debe comprobarse con estructura y magnitudes, no con una imagen parecida:

```text
piezas esperadas = piezas obtenidas al reproducir el árbol
programa compilado = programa reconstruido al leer los bytes PTX
operaciones visualizadas = operaciones del programa compilado
```

La equivalencia con el receptor se verifica después, separadamente. Si este reordena operaciones, no se presentará una simulación interna como cronología observada de la máquina.

## 4. Contrato funcional de los registros

Los siguientes esquemas expresan posiciones de interfaz para implementar interoperabilidad; no son archivos ejecutables. El literal inicial identifica la familia. Se omiten deliberadamente campos opcionales no necesarios para el primer perfil. La gramática completa y los límites pertenecen a S03; el ejemplo S05 corrobora la estructura CSV.

### HEADER

```text
HEADER,VERSION,TITLE,UNITS,ORIGIN,TRIM_TYPE
```

**Regla de implementación:** no utilizar `VERSION=4` por estar apuntando a CADmatic 4. Conservar por separado la versión documental de PTX, el valor de cabecera realmente adoptado y la versión de controlador. Incorporar la cabecera a los fixtures y al perfil, no dejarla fija dentro de una función.

`UNITS`: 0 métrico / 1 pulgadas decimales. `ORIGIN` afecta a VECTORS; CUTS asume origen superior izquierdo. `TRIM_TYPE`: 0 desperdicio primero / 1 refilado fijo primero. [S03, p.118]

La propuesta de primer candidato usa mm, política de origen explícita, nombres de laboratorio ASCII y CRLF. ASCII/CRLF es una **elección conservadora del candidato**, no una afirmación de que todo CADmatic 4 rechace otra codificación.

### JOBS

```text
JOBS,JOB_INDEX,NAME,DESC,ORD_DATE,CUT_DATE,CUSTOMER,STATUS,OPT_PARAM,SAW_PARAM,CUT_TIME,WASTE_PCNT
```

**Regla de implementación:** conservar el trabajo exacto del plan. No confundir nombre humano con identificador durable ni copiar rutas privadas. Las fechas opcionales no deben desplazar columnas; no inventar tiempos de ciclo. El estado de optimización de JOBS no equivale a nuestro estado de aprobación o validación.

### PARTS_REQ

```text
PARTS_REQ,JOB_INDEX,PART_INDEX,CODE,MAT_INDEX,LENGTH,WIDTH,QTY_REQ,QTY_OVER,QTY_UNDER,GRAIN,QTY_PROD
```

**Regla de implementación:** registrar demanda y resultado de corte con IDs resolubles. Usar las medidas de corte resueltas; nunca volver a deducir canto en el serializador. Agregar por tipo sólo cuando sobreviva la identidad necesaria para etiquetas y producción. Primera entrega: evitar sobreproducción y subproducción silenciosa.

`GRAIN`: 0 libre; 1 sin giro de pieza respecto a longitud; 2 orientación transversal requerida. Es distinto del giro inicial del tablero. [S03, pp.122–123; S06]

### BOARDS

```text
BOARDS,JOB_INDEX,BRD_INDEX,CODE,MAT_INDEX,LENGTH,WIDTH,QTY_STOCK,QTY_USED,COST,STK_FLAG,INFORMATION,MAT_PARAM,GRAIN,TYPE,BIN,SUPPLIER
```

**Regla de implementación:** no agrupar sólo por material. Dos formatos de tablero del mismo acabado y espesor necesitan identidades de stock distintas. El enlace desde PATTERNS debe seleccionar el formato correcto. Si faltan medidas o espesor, bloquear; no sustituir por los valores de otro tablero.

### MATERIALS

```text
MATERIALS,JOB_INDEX,MAT_INDEX,CODE,DESC,THICK,BOOK,KERF_RIP,KERF_XCT,TRIM_FRIP,TRIM_VRIP,TRIM_FXCT,TRIM_VXCT,TRIM_HEAD,TRIM_FRCT,TRIM_VRCT,RULE1,RULE2,RULE3,RULE4,MAT_PARAM,GRAIN,PICTURE,DENSITY
```

**Regla de implementación:** construir un objeto tipado antes de serializar. No escribir un array largo de literales sin nombres ni tests de posiciones. No exportar precio, densidad ni parámetros inexistentes por rellenar columnas.

`BOOK` cuenta tableros, no milímetros. `KERF_RIP/XCT` distinguen operaciones. Los trims MATERIALS incluyen kerf. RULE1 limita profundidad; RULE2 habilita cabeceados; RULE3 giro del tablero; RULE4 separación de duplicados. [S03, pp.134–135]

Vacío y cero tienen semánticas distintas: un parámetro vacío no impone override; cero sí es un valor explícito. Nunca usar `value || 0` como estrategia de completado. [S06]

### PATTERNS

```text
PATTERNS,JOB_INDEX,PTN_INDEX,BRD_INDEX,TYPE,QTY_RUN,QTY_CYCLES,MAX_BOOK,PICTURE,CYCLE_TIME,TOTAL_TIME
```

`TYPE`: 0 rip longitudinal; 1 giro inicial; 2/3 cabeceado transversal/longitudinal; 4 sólo troceado. [S03, p.139]

**Regla de implementación:** comenzar con un tablero por ciclo y sin compresión de patrones, salvo que un test requiera deliberadamente cantidades mayores. Es preferible un candidato fácil de auditar a una compresión prematura. Los valores 5–8 están relacionados con plantillas de emparejamiento de veta y quedan fuera del primer perfil; orientación de veta no es continuidad visual entre frentes. [S12]

### CUTS: contrato de columna

```text
CUTS,JOB_INDEX,PTN_INDEX,CUT_INDEX,SEQUENCE,FUNCTION,DIMENSION,QTY_RPT,PART_INDEX,QTY_PARTS,COMMENT
```

| Posición después de CUTS | Campo | Mapeo propuesto en Granete |
|---:|---|---|
| 1 | JOB_INDEX | Índice local generado desde `jobId`; guardar tabla inversa. |
| 2 | PTN_INDEX | Índice local de patrón; enlazar al tablero exacto. |
| 3 | CUT_INDEX | Índice del nodo serializado; enlazar con `cutId`. |
| 4 | SEQUENCE | Orden ejecutable planificado, no contador de inserción de piezas. |
| 5 | FUNCTION | Código emitido por adaptador desde rol/depth del nodo. |
| 6 | DIMENSION | Medida relativa del subpanel; no copiar `xMm + lengthMm`. |
| 7 | QTY_RPT | Repeticiones; expandirlas antes de comparar operaciones visuales. |
| 8 | PART_INDEX | Enlace a pieza o retazo, no nombre de mueble. |
| 9 | QTY_PARTS | Producción total atribuida al registro. |
| 10 | COMMENT | Descripción auxiliar; no usarla como autoridad de mecanizado. |

**Diccionario de códigos de interfaz:**

```json
{
  "cutFunction": {
    "0": "head",
    "1": "rip",
    "2": "cross",
    "3": "recut_phase_3",
    "4": "recut_phase_4",
    "5..9": "deeper_recut_phase",
    "90..99": "trim_or_waste_for_corresponding_phase"
  },
  "partReference": {
    "0": "no_part",
    "positive_integer": "PARTS_REQ_index",
    "Xn": "OFFCUTS_index_n"
  }
}
```

Fuente de interoperabilidad: S03 pp.142–145 y tabla p.178; S05 contiene fases y trims concretos. **Soportar un número en el esquema no significa que la HPP 250 pueda ejecutar cualquier profundidad.** El perfil de máquina limita el subconjunto permitido.

`RIP` o `MAIN` al final de una línea son comentarios, no sustitutos de FUNCTION. `X3` no significa eje X ni giro: enlaza un retazo. CUT_INDEX conserva anidación; SEQUENCE expresa orden. Reordenar físicamente las filas por SEQUENCE puede destruir el árbol. [S03, pp.142–145]

**Regla propuesta para el parser:** mantener dos proyecciones: árbol estructural y lista de eventos. No rechazar todos los registros con repetición cero: algunas salidas de interfaz representan piezas sin una pasada adicional. No animar una nueva pasada para una fila de etiqueta o un resto exacto. Esos casos requieren fixtures explícitos antes de habilitar agregación.

### VECTORS

```text
VECTORS,JOB_INDEX,PTN_INDEX,CUT_INDEX,X_START,Y_START,X_END,Y_END
```

**Regla de implementación:** la geometría dibujada también debe proceder del nodo, con referencia de borde/kerf explícita. No obtener vectores trazando automáticamente todos los bordes de las piezas. No convertir VECTORS en un segundo optimizador ni asumir que el controlador lo utiliza como sustituto de CUTS.

CUTS usa medidas relativas; VECTORS usa posiciones absolutas incluyendo kerf según la convención documentada. [S03, pp.146–147]

### Información y remanentes

| Registro | Decisión de integración propuesta |
|---|---|
| PARTS_INF | Conservar descripción y medidas finales como información; auditar el orden de campos antes de añadir todos los opcionales. |
| PARTS_UDI | Mapear IDs de pieza/mueble/revisión y datos de etiqueta en un perfil explícito. No ubicar coordenadas de corte en campos libres como sustitución de CUTS. |
| PARTS_DST | No implementar apilado automático en esta entrega; cualquier promesa de apilado necesita capacidades y configuración reales. |
| OFFCUTS | Crear sólo desde hojas terminales rectangulares del árbol; enlazar con la salida que realmente libera ese retazo. |
| PTN_UDI | Reservar para emparejamiento por franja cuando el caso de negocio lo necesite. |
| NOTES | Información de ensayo sin datos personales ni rutas internas. |

HOMAG permite mapear información adicional y previsualizar el archivo antes de probarlo. Esto respalda incluir una inspección de identidad/etiquetas en el flujo; no prueba por sí solo las trayectorias. [S02] La redistribución de cantidades entre duplicados y los datos de apilado tienen tratamiento propio en la documentación de transferencia. [S08]

## 5. Ejemplo propio: por qué una coordenada no es una medida de corte

En `examples/01_recorte_tres_fases.ptx.txt` hay un **fragmento**, no un PTX completo ni un candidato para cargar en una máquina. Se diseñó para explicar cuatro operaciones; no contiene cabecera, materiales, refilados exteriores ni todas las hojas de desperdicio.

Supuestos deliberados del ejercicio: tablero 1200 × 700 mm, kerf 4 mm, origen superior izquierdo, sin refilados exteriores; dos piezas, A de 450 × 320 y B de 280 × 210. No son recomendaciones de configuración del taller.

```text
CUTS,1,1,1,1,1,320.0,1,0,0,CUT_A
CUTS,1,1,2,2,2,450.0,1,1,1,CUT_B
CUTS,1,1,3,3,2,280.0,1,0,0,CUT_C
CUTS,1,1,4,4,3,210.0,1,2,1,CUT_D
```

Interpretación del ejercicio:

1. Separar una franja de 320 mm del tablero. Queda un resto de 376 mm en el otro lado después del kerf.
2. De la franja, separar 450 mm: sale A. Quedan 746 mm longitudinales.
3. Del resto, separar 280 mm: se obtiene un bloque de 280 × 320. Su borde global está en X=734, pero su medida de corte es **280**, no 734.
4. Reprocesar ese bloque para obtener 210 mm: sale B y un sobrante de 106 mm después del kerf.

La franja longitudinal restante es de 462 × 320. La conservación de superficie del ejercicio se comprueba en el script adjunto: piezas + sobrantes + bandas de sierra = tablero. Esa comprobación **no certifica la sintaxis completa ni la interpretación del receptor**.

### Qué debe enseñar la vista

En el paso 3 se resalta únicamente el resto de franja; en el paso 4 se resalta sólo el bloque de 280 × 320. La línea del cuarto corte no debe cruzar el tablero entero ni atravesar la pieza A, que ya está separada. Se muestra la banda de material consumida por el disco, la pieza resultante y la referencia del nodo.

Para UI, el texto humano sería “Recortar el bloque B a 210 mm”. Para inspección técnica se mostraría `cutId=CUT_D`, fase 3, referencia de pieza 2 y fila PTX asociada. Es la misma operación, no dos reconstrucciones independientes.

## 6. Giros, coordenadas y referencias: tres problemas diferentes

### Giro permitido de una pieza

Nuestra propuesta debe conservar la orientación de la pieza respecto al material y los cantos. Si se intercambian largo/ancho, hay que transformar también orientación y lados, no sólo el rectángulo. Añadir fixtures asimétricos: una pieza cuadrada puede ocultar un error de giro.

### Giro inicial del tablero

El adaptador resuelve el tipo de patrón junto con la orientación inicial; la vista no debe “adivinar” ese giro contando filas y columnas. Mantener ambas dimensiones originales del stock y una transformación, en lugar de modificar silenciosamente la identidad del tablero.

### Manipulación física de subpaneles

Una visualización puede necesitar indicar girar, retirar o reposicionar una franja. No toda manipulación es un registro CUTS autónomo. Definir `handlingEvents` sólo cuando el perfil y el procedimiento los respalden. No emitir supuestos comandos G/M ni letras de giro inventadas.

Para diagnóstico, distinguir en pantalla “Secuencia planificada” de “Secuencia verificada en receptor”. Un movimiento ilustrativo no es una instrucción certificada de manejo de máquina.

### Transformaciones explícitas

Si un rectángulo usa origen inferior izquierdo y se necesita dibujar en superior izquierdo:

```text
yTop = boardHeight - yBottom - rectangleHeight
```

Para un punto:

```text
yTop = boardHeight - yBottom
```

No son la misma fórmula. Transformar los extremos de la banda de kerf y las etiquetas conjuntamente. Mantener el marco de referencia en el contrato; no repartir inversiones de Y entre componente React, exportador y helper de SVG.

## 7. Kerf, trims y precisión: decisiones que deben cerrarse con pruebas

Propuesta de modelo: separar **medida de pieza**, **medida relativa del corte**, **coordenada del borde conservado**, **banda consumida**, **desperdicio físico** y **refilado total**. No llamar `positionMm` a todo.

Ejercicio de control: refilado total de 12 mm y kerf de 4 mm dejan 8 mm de desperdicio sólido. El fixture debe distinguir esos tres números y comprobar que no se añade el kerf dos veces. No aplicar ciegamente esa misma resta a todas las clases de trim: revisar representación del registro y caso exacto.

Promob también indica que el kerf configurado debe coincidir con CADmatic, y distingue límites de fases, longitud y apilado. Sirve como comprobación adicional del expediente que debemos recoger, no como fuente para fijar un valor universal de la HPP 250. [S10]

Antes de serializar, la propuesta exige cuantización controlada: escoger una resolución, aplicarla coherentemente, revalidar la geometría y registrar tolerancias. No redondear cada extremo por separado para que “quepa” el CSV. Una tolerancia para agrupar líneas visuales no es una tolerancia de fabricación.

## 8. Qué encontré en el repositorio

Se inspeccionó el commit indicado. No se ejecutó el navegador ni la suite del repo en esta investigación.

| Archivo | Observación de código | Consecuencia propuesta |
|---|---|---|
| `packages/domain/src/optimizer/guillotine.ts` | Los rectángulos libres se subdividen, pero no se conserva el árbol de esas subdivisiones. `generateCuttingInstructions` vuelve a agrupar por Y. | Conservar la procedencia de cada división durante el empaquetado. |
| `packages/domain/src/optimizer/types.ts` | `CutInstruction` tiene fase 1/2/3 para trim/rip/cross; no contiene parent, profundidad real, hijos ni ID estable de corte. | Ampliación versionada del contrato; NO copiar esas fases como códigos PTX. |
| `packages/ui/src/production/board/productionBoardLayout.ts` | Agrupa por X/Y con tolerancia de 2 mm y elige dirección por densidad; el primer corte puede escogerse mediante un retazo grande. | Mantener presentación, sustituir la inferencia por proyección del programa. |
| `packages/ui/src/production/board/ProductionBoardSvg.tsx` | Dibuja tiras de borde a borde del tablero a partir de ese layout. | Dibujar operaciones limitadas al subpanel padre real. |
| `packages/excel/src/ptxCutPlanExport.ts` | Genera bloques `[CUTS]` y reconstruye por Y; escribe posiciones absolutas con nombres propios de tipos. | Sustituir gramática y consumir el mismo programa neutral. |
| `packages/excel/src/machines/ptxAdapter.ts` | Comprueba presencia de dimensiones del perfil, pero no las pasa como configuración efectiva al generador. | Aplicación efectiva de perfil y tests de diferencias. |
| `packages/ui/src/production/ProductionOrderOptimizationPanel.tsx` | Ya reutiliza `ProductionBoardView` y dispone del flujo de exportación. | Extenderlo sin construir una pantalla paralela. |

Permalinks de referencia:

- [Optimizador](https://github.com/tiagofur/muebleria/blob/b3efd4191526010e440aafe20e80378f21615161/packages/domain/src/optimizer/guillotine.ts)
- [Contrato actual](https://github.com/tiagofur/muebleria/blob/b3efd4191526010e440aafe20e80378f21615161/packages/domain/src/optimizer/types.ts)
- [Reconstrucción visual](https://github.com/tiagofur/muebleria/blob/b3efd4191526010e440aafe20e80378f21615161/packages/ui/src/production/board/productionBoardLayout.ts)
- [Serialización actual](https://github.com/tiagofur/muebleria/blob/b3efd4191526010e440aafe20e80378f21615161/packages/excel/src/ptxCutPlanExport.ts)

### Contraejemplo acotado

El paquete incluye `validation/counterexample.json`: una disposición guillotinable vertical. Al aplicar las reglas reducidas leídas, la vista elige X=400 como primer corte y el exportador reconstruye inicialmente una separación horizontal Y=600. No es el mismo árbol. El comprobador reproduce **esas reglas concretas**, no ejecuta las funciones importadas del repo ni demuestra que un proyecto del cliente haya producido ese resultado.

Esto basta para descartar como arquitectura la reconstrucción independiente por coordenadas. No obliga a rehacer el diseño visual que ya se mejoró.

## 9. Ambigüedades documentales que NO voy a convertir en certezas

Registrar las siguientes discrepancias para revisión con una muestra de referencia y el receptor:

- La guía titula el capítulo PTX V1.17, la descripción de VERSION menciona 1.08 y ejemplos usan 1. No inferir la cabecera compatible por el título.
- El apartado de tensión de CADLink menciona FUNCTION 81, pero su ejemplo muestra función 1 con comentario `TENSION TRIM`; sus cifras no son coherentes con el total anunciado. Mantener tensión fuera del subconjunto inicial. [S04]
- Hay diferencias de inventario de campos entre encabezados abreviados, ejemplos y tablas del manual; por ejemplo opcionales de OFFCUTS/PARTS_INF. No copiar un ejemplo truncado como diccionario completo.
- La documentación HOMAG de propiedades 14–99 no es una licencia para cambiar las posiciones fijas de CUTS. [S01][S02]

Estas diferencias no bloquean un núcleo de cortes rectangulares. Bloquean prometer soporte de funciones o variantes ambiguas sin prueba.

## 10. Contexto de validación externa — fuera de #650

El propietario realizará esta actividad; no es un entregable ni un requisito de cierre de la implementación.

Preparar directorios de laboratorio, fuera de las carpetas vigiladas de producción. Preservar archivos y resultados, usar nombres/revisiones nuevos y revisar opciones efectivas. CADLink puede ignorar opciones de consola si encuentra `cadlink.ini`, y la existencia de resultados puede evitar reprocesamientos. [S04]

Ejemplo **documental**, no ejecutado; requiere instalación autorizada y revisión local. La ruta siguiente es ficticia de laboratorio, no una ruta de cliente:

```bat
cadlink.exe "C:\GraneteLab\in\C4D001.ptx" "C:\GraneteLab\out" /CAD4 /RESULT
```

No usar `/DELETE`, `/HIDE` ni `/BACKGROUND` en la primera corrida. No apuntar a una carpeta real de cola de sierra. Comprobar la sintaxis de la versión instalada antes de ejecutar.

Registrar retorno y `.rlt` cuando corresponda; recoger el número de error, campo y línea. Un resultado correcto de conversión no reemplaza la comparación del plan en el controlador. [S04]

Mínimo expediente: build de CADmatic, build del conversor, configuración efectiva, límites y kerf, muestra aceptada, error anterior, PTX generado con hash, resultado convertido con hash, capturas/readback y revisión del operador. No publicar nombre del cliente, licencias, IP, rutas privadas o configuraciones completas con secretos.

Importar sólo PARTS_REQ/MATERIALS puede probar una lista, no los patrones. El modo de importación debe ser el de patrones o la conversión directa correspondiente. [S07]

## 11. Qué sigue

Aplicar A → B del [plan activo](02_plan_de_implementacion.md). Los ejemplos de este paquete son instrumentos de explicación y verificación local. Generar las cinco cocinas y probarlas externamente corresponde al propietario, fuera de #650. No se exige esa etapa para cerrar la implementación, ni se promueve por ello compatibilidad de campo.

**Límite de la investigación:** no se pudo inspeccionar el ZIP oficial de ejemplos enlazado en S11; tampoco hubo acceso a una instalación licenciada de CADLink/CADmatic. La investigación pública sí identifica la interfaz, la ruta de conversión y las decisiones necesarias para implementar; la confirmación de la combinación del cliente sigue pendiente de campo.
