# Granete · Plan de implementación PTX / CADmatic 4

Issue: [#650](https://github.com/tiagofur/muebleria/issues/650). Fecha: 2026-09-10.
Base de investigación: `main@b3efd4191526010e440aafe20e80378f21615161`; revalidar HEAD y trabajos concurrentes antes de implementar. Este documento es preparación, no código entregado.

> **Alcance actualizado por el propietario:** solamente A+B. Generar las cinco cocinas y verificar con el cliente quedan fuera; el propietario lo hará y traerá el resultado. Los fixtures pequeños para tests sí pertenecen a la implementación. Ninguna aceptación de esta issue depende de ejecutar CADLink/CADmatic o de operator sign-off.

## Resultado verificable

Un mismo programa de corte produce vista previa, instrucciones y bytes PTX. Una lectura independiente de esos bytes reconstruye un resultado equivalente. El candidato apunta a la ruta CADLink/CAD4, conserva `NOT_TESTED/notClaimed` y no omite los gates productivos existentes. SAW propio, MPR y CAM de perforación quedan fuera.

## Entrega A · Conservar el árbol real y conectar la vista existente

### Objetivo

Eliminar las tres reconstrucciones independientes de cortes, sin rehacer el optimizador ni la interfaz. El empaquetador que ya resuelve piezas debe devolver también las divisiones que realmente realizó.

### Cambios propuestos

1. Extender el resultado de las heurísticas existentes. Cada `FreeRect` debe tener procedencia: nodo padre y división que lo creó. Registrar el árbol en el momento del split, no deducirlo después con grupos X/Y.
2. Para la heurística de franjas, registrar la separación de franja, los troceados y los recortes necesarios cuando una pieza sea más estrecha que su franja.
3. Mantener el árbol de la heurística ganadora, junto con el layout que esa misma candidata produjo. No combinar piezas de una candidata con instrucciones de otra.
4. Obtener del árbol instrucciones humanas, trazas geométricas y secuencia de eventos. La secuencia de colocación de piezas no es una secuencia de pasadas de sierra.
5. Hacer que `ProductionBoardView` y `ProductionBoardSvg` consuman esa proyección. Mantener las interacciones y mejoras existentes; no crear otra pantalla de optimización.
6. Tratar planes guardados sin árbol como visualización anterior no apta para este export; ofrecer regeneración explícita con los datos exactos permitidos. No inventar un árbol a partir de un plan viejo y marcarlo válido.

### Contrato conceptual, no implementación final

Reutilizar identidades, frames, magnitudes y tipos existentes cuando los haya. Este esquema es una propuesta, no una nueva autoridad industrial paralela.

```ts
type CutAxis = 'x' | 'y';
type CutRole = 'head' | 'rip' | 'cross' | 'recut' | 'trim';

interface CutNode {
  readonly cutId: string;
  readonly parentRegionId: string;
  readonly axis: CutAxis; // eje de avance/separación, no de la línea
  readonly role: CutRole;
  readonly phaseDepth: number;
  readonly keptExtentMm: number;
  readonly kerfMm: number;
  readonly resultingRegionIds: readonly string[];
}

interface CutExecutionEvent {
  readonly eventId: string;
  readonly kind: 'saw_pass' | 'handling' | 'part_available' | 'offcut_available';
  readonly cutId?: string;
  readonly dependsOn: readonly string[];
  readonly regionId: string;
  readonly provenance: 'planned' | 'receiver_verified';
}

interface CutProgram {
  readonly schemaVersion: string;
  readonly sourceCutPlanId: string;
  readonly sourceCutPlanVersion: number;
  readonly coordinateFrame: string;
  readonly nodes: readonly CutNode[];
  readonly events: readonly CutExecutionEvent[];
  readonly fingerprint: string;
}
```

El contrato concreto también necesita regiones antes/después, hojas de piezas/desperdicio/retazos y vínculos productivos existentes. Las transformaciones de manipulación no se suponen por marca. La UI distingue orientación planificada de movimiento físico confirmado; esta issue no obtiene evidencia física ni añade automáticamente estados de negocio por este ejemplo.

### Invariantes del árbol

Toda división actúa sobre un rectángulo que existe y está disponible. Sus hijos y la banda de kerf cubren el padre sin solapes ni superficie inventada. Ningún corte actúa sobre una pieza ya retirada. Todas las hojas de piezas corresponden a demanda real; se satisface la cantidad esperada sin omisiones. Los retazos útiles son hojas finales obtenibles físicamente, no rectángulos visuales aproximados.

No basta con `placed <= board`: las operaciones deben producir las piezas en el orden elegido y con la profundidad admitida. Un optimizador que devuelve sólo las piezas que cupieron no puede declarar completa una demanda parcialmente omitida.

### Experiencia mínima de vista previa

- Vista general: piezas, veta, cantos, retazos y programa/revisión de origen.
- Paso a paso: anterior/siguiente, región activa, pieza liberada y banda de kerf.
- Inspección técnica plegable: `cutId`, fila PTX cuando exista, fase, medida relativa, posición de dibujo y evidencia.

No se necesita una animación 3D. Separar siguiente pasada de siguiente pieza, pues no son uno-a-uno. La interfaz proyecta el programa del dominio y conserva tokens/diseño existentes.

### Pruebas de cierre A

Horizontal, vertical, franja desigual con tercera fase, cuarta fase cuando esté permitida, trims asimétricos, kerf positivo, rotación/veta y retazos. `validation/counterexample.json` se convierte en test real: instrucciones y SVG no pueden mostrar un primer corte distinto del programa.

Browser: seleccionar cada evento y comprobar datos estructurados de región, segmento y banda dibujados. Capturas visuales como complemento, no prueba única. Los tests deben ejecutar los helpers/componentes reales, no limitarse a buscar texto en archivos.

## Entrega B · Serializador PTX y comprobación inversa

### Objetivo

Reemplazar los bloques inventados por la gramática documentada y asegurar que el perfil influye en los bytes. Consumir el programa de A: no reoptimizar ni inferir tiras nuevamente.

### Componentes reutilizados

`packages/excel/src/ptxCutPlanExport.ts`, `packages/excel/src/machines/ptxAdapter.ts`, `profiles.ts`, `machineArtifacts.ts`, `outputSelectionResolver.ts`, catálogo compartido Go/TS y APIs generadas existentes. Mantener selección persistida, empaquetado unificado/por material y UX entregada por #591/#600.

### Diseño del compilador

```text
CutProgram exacto
→ validación de capacidades y completitud
→ asignación de índices locales
→ registros PTX tipados
→ validación de relaciones y magnitudes
→ bytes deterministas
→ lectura independiente de bytes
→ equivalencia con CutProgram
→ manifest + trace + salida
```

La tabla inversa enlaza IDs durables con `JOB_INDEX/PTN_INDEX/CUT_INDEX/PART_INDEX` locales. Para repeticiones o filas sin pasada puede ser uno-a-varios o varios-a-uno; no forzar una fila = una pasada = una pieza.

### Reglas críticas

- Campos industriales obligatorios ausentes producen errores específicos, no espesores/kerfs/medidas por defecto silenciosos.
- Bloquear `cnc-nesting` en esta ruta: dibujar rectángulos no demuestra guillotinabilidad.
- Distinguir milímetros, cantidad de tableros y altura física de paquete. No inferir capacidades de la HPP 250 por el nombre.
- Respetar límites de fases y cabeceados del perfil. El esquema admite más códigos que el subconjunto inicialmente soportado.
- Preservar campos vacíos intermedios, comillas CSV y diferencias entre cero y ausencia.
- Usar medidas de corte resueltas; nunca deducir cantos dos veces.
- Verificar origen/rotación con piezas asimétricas y cantos diferentes por lado. Cuantizar coherentemente y revalidar la geometría.
- Cada opción de perfil soportada modifica la salida o demuestra que no aplica; una no implementada no se anuncia operativa.
- Mantener jerarquía de registros y ejecución por separado. No ordenar filas por `SEQUENCE` destruyendo el árbol.
- No comprimir patrones/repeticiones sin fixtures específicos de cantidades e identidades. Una política inicial conservadora de un tablero por ciclo es aceptable si está explícita.
- No fijar `.prm/.spm/.mpm` por suposición ni copiar rutas privadas.
- Tensión/81, plantillas de veta continua 5–8 y funciones ambiguas quedan fuera del primer candidato.
- Mantener el invariante `canSerialize.ready ⇒ serialize ejecutable` y distinguir serializador ausente de datos/evidencia insuficientes.

### Modelo de perfil propuesto

Separar versión de controlador, versión del receptor, modo de recepción, cabecera PTX, encoding, fin de línea, resolución, tipos de patrón, fases, trim, secuencia e identidad/etiquetas. Reutilizar el mecanismo versionado existente; no añadir columnas por cada nombre conceptual.

La especificación pública puede fundamentar parámetros de interfaz para un candidato no productivo. La evidencia de campo decide si corresponden a la instalación real. Ni completar el perfil ni pasar los tests promueve `VALIDATED/PARTIAL` ni llena capacidades de máquina desconocidas.

CADmatic 4 es obligatorio. CADmatic 3/5 sólo se amplían si hay diferencias documentadas pequeñas y pruebas independientes sobre el mismo núcleo; no son condición de cierre ni justifican variantes especulativas. No implementar SAW propio.

### Comprobación inversa independiente

El lector no utiliza los constructores del escritor para confirmarse. Consume bytes, resuelve referencias, expande cantidades y reconstruye árbol/eventos del subconjunto.

Comparar material/formato/espesor, cantidades, medidas efectivas, veta, zonas de kerf, piezas disponibles por evento, retazos, anidación y secuencia declarada. Comparar geometría normalizada, no orden casual de arrays ni nombres humanos.

Mutaciones deliberadas: borrar un corte, modificar dimensión, cruzar `PART_INDEX`, omitir tercera fase, añadir kerf extra, cambiar `TYPE`/unidad, convertir vacío a cero y ordenar por `SEQUENCE`. Cada una falla por causa concreta. El fixture didáctico ayuda a diseñar estos tests, pero no es un parser ni un programa completo.

### Integración acotada y origen exacto

La descarga existente debe poder entregar el candidato con estado no productivo explícito y trazabilidad. Conservar selección única y errores previos a descarga, unificado/ZIP y aislamiento por material; no perder archivos por fallar al generar alguno.

No absorber #503/#577: si la generación productiva autoritativa desde una liberación requiere trabajo adicional, declararlo y conservar los bloqueos. No emplear proyecto mutable para aparentar pins exactos, ni convertir React/Ruby en una autoridad industrial nueva. Actualizar contratos/paridad sólo si el cambio los afecta.

### Definition of Done B

Candidato PTX documentado y determinista para CADLink/CAD4, serializador operativo, perfil realmente aplicado y equivalencia interna demostrada. Publicar nueva revisión de perfil y versión/digest de adapter; no editar revisiones históricas en sitio. La evidencia de campo queda pendiente y no es requisito de esta issue.

## 3. Trabajo externo del propietario — excluido

La antigua entrega C (cinco cocinas y validación de recepción) **no pertenece al alcance activo**. El propietario generará las cocinas y probará el receptor, y traerá resultados. No añadir seed, generador de cinco proyectos, campaña de pruebas, requisito de CADLink instalado, sign-off ni corte físico como condiciones para cerrar A+B.

El procedimiento informativo se conserva en §10 de la investigación. #348 y #352/#353 gobiernan evidencia separada. Su exclusión del ticket técnico no habilita fabricación sin gates ni permite declarar compatibilidad.

## 4. Matriz de verificación de implementación

| Prueba | Nivel | Demostración |
|---|---|---|
| Balance de área/dimensiones | Dominio | Sin solapes, omisiones ni kerf doble. |
| Árbol guillotina | Dominio | Regiones disponibles antes de cortar y hojas completas. |
| Pieza menor que franja | Dominio/export | Recorte adicional explícito. |
| Origen/rotación/cantos | Dominio/UI/export | Transformación consistente. |
| CSV, columnas e índices | Export | Relaciones inequívocas y números válidos. |
| Lectura inversa/mutaciones | Lector independiente | Detecta alteraciones semánticas aunque el CSV sea válido. |
| Repetición/hojas exactas | Export | Sin cantidades falsas ni pasadas ficticias. |
| Vista paso a paso | Browser | Mismos cutId, región y evento que el programa. |
| Perfil/digest/sin fallback | Export/API si afectada | Destino exacto y bloqueo accionable. |
| Pins y aislamiento | Integración existente afectada | Sin retargeting de históricos ni fuga entre organizaciones. |

CADLink real, CADmatic real y corte físico **no son pruebas requeridas por #650**. Registrar siempre su ausencia como no ejecutados; tampoco llamarlos PASS.

## 5. Orden y publicación

Un único ticket de implementación, #650; preparación documental no cerrante, luego A y B en PRs acotados. A sola no cierra la issue; A+B y toda evidencia técnica aplicable sí permiten proponer su cierre, sin esperar campo. No crear una segunda cola ni fragmentar por líneas sin coherencia funcional.

El PR documental no modifica `feature_list.json`, no declara una feature en progreso y no cambia código de producto ni CI. Merge humano y revisión/CI exact-HEAD se conservan. Los labels de aprobación no se autoasignan para satisfacer una comprobación de publicación.

## 6. Prompt único para iniciar A

```md
# Granete #650: programa guillotina único para preview y futura salida PTX

Implementa sólo A de docs/machines/ptx-cadmatic4/02_plan_de_implementacion.md.
La issue completa requiere A+B: este PR parcial no la cierra.

Antes de cambiar código, lee reglas actuales, issue/comentarios, HEAD y trabajo
concurrente. Revalida los archivos citados: el dossier es un snapshot de b3efd419.
Reutiliza el optimizador y los contratos; no crees otra autoridad industrial.

Conserva parent/children/region/cut identity cuando se divide un FreeRect y el
árbol de la candidata ganadora. Representa trims, rips, crosscuts y recuts
necesarios; deriva instrucciones/eventos, no del orden de colocación ni de X/Y.

Conserva ProductionBoardView/Svg y conecta líneas, región activa, primer corte y
paso a paso al mismo programa. No inventes giros físicos de máquina. Documenta
frame y kerf; rechaza programas ambiguos/incompletos y no hagas pasar nesting
por guillotina. Planes sin árbol requieren regeneración explícita permitida.

Tests reales: horizontal, vertical, tercera fase, trims asimétricos, kerf,
rotación/veta, retazos y cantidades/superficies. Incorpora counterexample.json
como regresión ejecutada contra los helpers del producto. Browser comprueba
cutId/región/banda/segmento; no sólo imagen ni búsqueda de texto en archivos.

Fuera: cinco cocinas, validación del cliente, CADLink/CADmatic/corte físico,
SAW/MPR/CNC, segundo optimizador, cambios de BOM para ocultar errores y merge
automático. Conserva gates de revisión/liberación/tenant. Si otra frontera es
necesaria, declárala; no uses datos mutables como sustituto.

Entrega código acotado y evidencia exact-HEAD de tests aplicables. Distingue
portable/browser y campo no ejecutado. Estado de campo sigue NOT_TESTED.
```
