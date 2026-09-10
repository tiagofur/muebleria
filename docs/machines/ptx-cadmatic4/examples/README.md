# Fragmentos originales para entender el contrato

**No productivos. No son archivos PTX completos. No importar en máquina.**

`01_recorte_tres_fases.ptx.txt` describe una franja de 320 mm, un troceado de 450 mm que produce A, otro de 280 mm que produce un bloque y un recorte de 210 mm que produce B. `01_expected_trace.json` fija el ejercicio geométrico; el origen de este ejercicio es superior izquierdo.

`02_prefijo_identidad.ptx.txt` muestra un prefijo de registros del mismo ejercicio: cabecera, trabajo, piezas, tablero, material y patrón. El valor HEADER=1 sigue la forma de ejemplos públicos; no es una elección validada para el receptor. No concatenar prefijo y cortes y asumir que ya existe un programa aprobado: faltan decisiones y verificación integral de hojas/retazos, trims, cabecera y recepción.

`03_jerarquia_y_secuencia.ptx.txt` muestra dos niveles de orden: las filas conservan el anidamiento mientras la segunda franja tiene SEQUENCE=2 aunque su CUT_INDEX sea posterior a los registros hijos de la primera. Es un ejemplo independiente y parcial, no una modificación para ejecutar el primero.

`04_retazo_sin_pasada.ptx.txt` ilustra un retazo de 462 × 320 surgido de un corte previo. La referencia X1 apunta al registro de OFFCUTS. La fila con repetición cero no debe convertirse en una pasada nueva. El contexto proviene del ejercicio 01; no es un archivo autónomo.

`05_vector_auxiliar.ptx.txt` contiene únicamente un vector candidato del primer corte, dibujado en el extremo alejado de la banda de kerf del ejercicio. No reemplaza CUTS ni certifica que el receptor utilice VECTORS. No describe todos los cortes.

## Geometría del ejercicio 01

Tablero: 1200 × 700; kerf: 4; sin refilados exteriores **sólo para el ejercicio**.

| Evento | Región antes | Resultado útil | Resto después |
|---|---|---|---|
| A | 1200 × 700 | Franja 1200 × 320 | 1200 × 376 |
| B | Franja 1200 × 320 | Pieza A 450 × 320 | Franja 746 × 320 |
| C | Franja 746 × 320 | Bloque 280 × 320 | 462 × 320 |
| D | Bloque 280 × 320 | Pieza B 280 × 210 | 280 × 106 |

En C el borde conservado global está en X=734; la dimensión del registro es 280. Es el error que queremos evitar al copiar coordenadas finales a DIMENSION.

La suma de superficies se comprueba sólo como geometría de este ejercicio. Un test matemático no demuestra cumplimiento del esquema completo, capacidad de sujeción de la máquina ni aceptación del software.
