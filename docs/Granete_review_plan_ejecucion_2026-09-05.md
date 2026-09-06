# Granete — Anexo técnico de revisión y ejecución

**Fecha:** 5 de septiembre de 2026.  
**Repositorio:** `tiagofur/muebleria`.  
**Corte de código revisado:** `587961fd379b64cc27288d8de1a1118b50032a23` (merge del PR #564).  
**Naturaleza:** revisión estática dirigida y propuesta de evolución. No se ejecutaron en esta revisión la aplicación, SketchUp, PostgreSQL ni una máquina. Los resultados de pruebas citados en PRs pertenecen a sus autores. La auditoría histórica usa otro snapshot y no equivale a una certificación del main actual.

Este anexo organiza entregas, decisiones y pruebas. No modifica GitHub y no convierte cada fila en una nueva issue. Antes de crear tickets, contrastar el alcance con los existentes y actualizar las metas que hayan quedado desfasadas respecto de sus PRs.

## 1. Decisión de producto

Granete debe permitir convertir una intención de diseño en un mueble configurable, presupuestado, fabricable, trazable e instalable, con una sola definición industrial y experiencias coherentes en web y SketchUp.

La calidad no se medirá por cantidad de pantallas ni cantidad de pruebas verdes. Se medirá por tareas reales completadas sin asistencia, conservación de datos y revisiones, correspondencia entre representación y fabricación, y evidencia de producción para combinaciones concretas de materiales, herrajes, máquinas y software.

No reconstruir las bases de identidad física, publicación inmutable, reconciliación, liberación exacta ni el coordinador de mutaciones del plugin. Ampliar su cobertura y llevarla a las superficies pendientes.

## 2. Registro de hallazgos y límites de evidencia

| ID de revisión | Hallazgo | Evidencia y alcance | Acción |
|---|---|---|---|
| RV-01 | El resolver Go inspeccionado admite relaciones `shelf-support` y sistemas compilados limitados. | `backend-go/internal/domain/engine/authoring_machining.go`, especialmente inicio y `deriveRelationshipOperations`. No significa que todo el dominio histórico carezca de otras reglas. | Migrar reglas de fabricación a datos versionados de catálogo bajo autoridad Go. |
| RV-02 | Maquinados manuales se buscan en una tabla compilada por código. Un perfil ausente devuelve cero operaciones. | `deriveManualPlacementMachining`; tabla de dos códigos en el corte revisado. | Distinguir explícitamente `not_required`, `configured`, `missing` y `unsupported`; impedir que falta de información parezca validación. |
| RV-03 | El perfil TS existente ya admite operaciones de taladro, pero no es equivalente a la tabla del resolver Go inspeccionado. | `packages/domain/src/hardwareMachining.ts`: `blind_hole`, `through_hole`, `counterbore`, `screw_pilot`, entrada `anchor/opposite`. | Inventariar consumidores, compartir contrato y eliminar divergencia productiva; no crear una tercera familia paralela. |
| RV-04 | Preview de agregados devuelve tableros y excluye herrajes en su contrato actual. | `packages/ui/src/agregados/agregado3dPreview.ts`. Existe preview; no declararlo ausente. | Completar una proyección de escena con piezas, herrajes, pertenencias y diagnósticos. |
| RV-05 | El renderizador de herrajes revisado admite siete primitivas y retorna `null` si la forma falta o no es soportada. | `packages/ui/src/preview3d/HardwareMesh.tsx`. No prueba que todas las superficies tengan idéntico comportamiento. | Assets GLB más representación procedural explícita, y aviso cuando no puede dibujarse un artículo. |
| RV-06 | DXF de plan de corte omite perforaciones en piezas rotadas. | `packages/excel/src/dxfCutPlanExport.ts`, condición `drillingByPiece && !p.rotated`. La auditoría reprodujo la omisión en su snapshot y la condición sigue en el corte inspeccionado. | Transformar correctamente o bloquear/etiquetar la salida como incompleta; nunca presentarla como CNC completo. |
| RV-07 | Resolución legacy de perforaciones conserva joins y cachés insuficientes para todos los contextos. | `packages/domain/src/projectDrilling.ts`: clave por módulo/dimensiones, joins por `partId` con primer propietario, y opciones/presets fuera de la clave. | Identidad física y contexto completo; prueba de independencia respecto del orden de líneas. |
| RV-08 | Payload legacy de perforaciones elimina información de fallback y problemas. | `projectDrilling.ts`: proyección `plain` conserva agujeros, pero no `fallbackUsed` ni `issues`. | Transportar procedencia y severidad hasta el consumidor o rechazar una salida que no pueda conservarlas. |
| RV-09 | Picking y descuento de stock no forman una única transacción en la orquestación web inspeccionada. | `apps/web/src/stores/purchasingStore.ts`: descuento antes de persistir picking; compensación local no cubre el fallo posterior de persistencia. No se reprodujo una pérdida real en PostgreSQL durante esta revisión. | Comando backend atómico/idempotente; prueba de fallo entre ambos pasos y reintento. |
| RV-10 | Conversión de proyecto a plantilla conserva solo walls/placements de kitchenLayout. | `packages/domain/src/duplicate.ts`, `projectToTemplate` y `createProjectFromTemplate`; coincide con la reproducción histórica de pérdida de campos. | Contrato explícito de clonación y roundtrip de espacios/configuración, con regeneración de identidades nuevas. |
| RV-11 | Autoría tipada de parámetros en React y superficies web del hilo digital siguen pendientes documentados. | Issues #497 y #396; no equiparar backend disponible con experiencia web terminada. | Entregas verticales #496/#497 y #500/#501/#502/#499. |
| RV-12 | Persistencia de catálogo por entidad con concurrencia está pendiente documentada. | Issue #443 describe pérdida de actualizaciones posible con snapshots completos. | Priorizar conflictos de versión y escrituras por entidad; BroadcastChannel solo ayuda a refrescar. |

**Prueba adicional recomendada:** inyectar fallo en la invalidación de preflight del coordinador Ruby. `invalidate_preflight` rescata excepciones y puede conservar una entrada previa. Esto es un riesgo a comprobar junto con los consumidores, no una afirmación de que el flujo completo publique hoy con un estado falso. La aceptación exige que jamás se muestre como vigente una validación anterior a un cambio productivo.

## 3. Arquitectura objetivo sin reescritura

```text
Definiciones y reglas versionadas
             +
Intención / parámetros / materiales / unidades físicas
             ↓
Resolución industrial autoritativa de Granete
             ↓
Piezas + herrajes + relaciones + operaciones + incidencias
             ├── representación React
             ├── representación SketchUp
             ├── BOM, costos y abastecimiento
             └── preparación y postprocesado de fabricación
```

Go conserva autoridad de negocio y fabricación. Los contratos compartidos y fixtures verifican la paridad donde sigue existiendo dominio TypeScript. Ruby captura intención y aplica resultados aceptados mediante el coordinador existente. React administra definiciones, representa resultados y ejecuta comandos explícitos; no duplica interpretación de reglas para compensar APIs incompletas.

El resultado de una resolución debe conservar la procedencia de cada operación: revisión de regla, ubicación de herraje o relación que la originó, pieza objetivo y revisión de diseño. Una huella criptográfica comprueba identidad del resultado, no validez física de una receta.

## 4. Paquete A — Integridad y trazabilidad de salida

**Resultado:** ninguna exportación o cambio de stock parece correcto cuando está incompleto.

Resolver RV-06 a RV-10 y coordinar RV-12 con #443. Los tests deben incluir pieza asimétrica rotada, perforación de frente/reverso/canto, líneas del mismo módulo con diferentes opciones y medidas, inversión del orden de entrada, error después del descuento y antes del picking, reintento y dos pestañas concurrentes.

No aceptar solo pruebas que verifiquen que el archivo existe, contiene EOF o devuelve HTTP 200. Comparar operaciones esperadas y obtenidas, identidades y saldos. En plantillas, definir qué se copia, qué se referencia y qué se regenera; no clonar identidad física productiva ni referencias a una liberación anterior.

## 5. Paquete B — Herraje como activo industrial administrable

**Resultado:** un administrador registra un artículo real, lo visualiza en web y SketchUp y comprueba sus efectos sobre paneles de prueba.

Aprovechar #496/#497 y el concepto de Asset/HardwareDefinition existente. Una revisión del artículo vincula datos comerciales, geometría SKP/GLB, anclajes normalizados, subpartes, compatibilidad, perfiles técnicos y estado de validación.

Separar tres estados: geometría visual disponible; receta de fabricación definida; receta validada para una combinación industrial concreta. No bloquear todo diseño porque no existe un GLB fotorrealista, pero tampoco mostrar como exacto un proxy genérico. No inferir un agujero desde un cilindro de la malla.

### Preparación de SKP y GLB

La API oficial de SketchUp documenta exportación GLB desde SketchUp 2024. La preparación inicial puede ser asistida sobre un archivo de herraje aislado, sin construir un lector SKP en el navegador. El exportador GLB no documenta opciones; no asumir que acepta exportación solo de selección.

Validar ambos archivos contra un manifiesto: revisión, checksum, dimensiones, unidades, transformación al marco industrial, anclajes y roles de subpartes. glTF usa metros: convertir de manera explícita respecto de las magnitudes industriales en milímetros. Evitar escalados globales que deformen herrajes de tamaño fijo; usar variantes nominales y zonas realmente extensibles cuando el artículo lo permita.

### Banco de prueba

Permitir seleccionar una o dos piezas objetivo, espesores, orientación y parámetros. Mostrar el herraje, las caras seleccionadas, ejes de operaciones, diámetros/profundidades, operaciones resultantes y problemas. Cada advertencia debe navegar a su origen.

## 6. Paquete C — Ensambles configurables y recetas de sistemas

**Resultado:** tres casos completos: tornillo lateral/piso, sustitución de cajón de madera por sistema box y frente con perfil.

### Ensamble lateral–piso

Extender `PartRelationship`, no introducir reglas de contacto paralelas en cada renderer. La relación identifica paneles y caras reales; la receta declara operaciones independientes por destino.

| Política del taller | Panel lateral | Piso |
|---|---|---|
| Tornillo, ambas piezas | Taladro de paso y avellanado si corresponde | Piloto en el canto si corresponde |
| Tornillo, solo lateral | Operaciones configuradas para lateral | Ausencia explícita de maquinado |
| Taquete | Operaciones de la receta en cara objetivo | Operaciones de la receta en canto objetivo |

Los diámetros, profundidades y distancias proceden de datos aprobados del dispositivo y del método constructivo, no de valores ilustrativos del software. La detección de contacto propone relaciones; no perfora automáticamente todo sólido que intersecta.

El editor debe explicar desde qué cara entra la herramienta, a qué pieza pertenece la operación y qué ocurre al cambiar espesor, orientación o dispositivo. Probar herrajes próximos a bordes, uniones repetidas, piezas espejadas, rotaciones del mueble y políticas diferentes por taller.

### Cajones como recetas de Agregado

Mantener `Agregado` como conjunto semántico existente. Definir una receta versionada que pueda generar o retirar piezas y herrajes según sistema, variante, longitud nominal, altura, espesores y frente.

No basta sustituir el mesh de la corredera. La simulación debe explicar piezas de melamina que desaparecen, nuevas piezas compradas, cambios de fondo/trasera, conectores, perforaciones y precio. Conservar la identidad de la unidad física y las identidades de piezas que realmente permanecen; generar identidades para piezas nuevas y retirar las eliminadas.

La sustitución sigue `simular → mostrar diferencias → confirmar → aplicar atómicamente`. Una combinación fuera de rango debe rechazarse sin destruir el estado válido. No ajustar a escondidas dimensiones interiores o frente exterior para forzar compatibilidad.

### Frente con perfil

Separar envolvente exterior del frente, panel neto, perfil, tapas, fijaciones y holguras. El descuento depende de la geometría y solape del perfil, no siempre de su altura total.

Ecuación conceptual: `panelHeight = frontEnvelopeHeight - upperEffectiveDeduction - lowerEffectiveDeduction`. Cada término se define por una receta técnica documentada. La cara visible debe conservar alineación con frentes vecinos. El costo debe contemplar consumo y compra de perfil por longitud/barra, tapas, desperdicio y operaciones.

No confundir perfil montado sobre el frente con perfil gola fijado a la estructura; son conjuntos distintos con dependencias distintas.

## 7. Paquete D — Biblioteca y 3D coherentes

**Resultado:** una misma definición muestra el mismo conjunto en editor de agregado, módulo, proyecto y SketchUp.

Completar la proyección de escena existente en lugar de sumar visores independientes. Debe transportar identidades, pertenencias, piezas, herrajes, assets, transformaciones y diagnósticos. La interfaz distingue: oculto por usuario, representación pendiente, asset no soportado, componente suprimido por regla y artículo que no participa en fabricación.

La biblioteca necesita modos coherentes de editar, probar y publicar. Proporcionar pruebas de medidas mínimas/máximas, espesores y variantes compatibles. Mostrar valores heredados, calculados y sobrescritos, con explicación de su origen. Las ecuaciones deben tener unidades y validación de dependencias; no depender del nombre visible de un componente.

### Movimiento de presentación

Reutilizar #529. Abrir no altera BOM, perforaciones, huella productiva ni revisión. El movimiento se recalcula desde la pose cerrada.

**Mejora propuesta al alcance:** no todos los componentes del mecanismo comparten movimiento. Un carril fijo permanece en el costado mientras el cajón y su parte móvil avanzan. Una base de bisagra permanece en el casco. La definición de movimiento vive en el Agregado, pero puede declarar actores con pertenencias distintas. V1 puede simplificar articulaciones, pero no debe desplazar una fijación del casco con el cajón.

Separar modos de edición, inspección y presentación. La animación de demostración no es una certificación de colisiones mecánicas durante todo el recorrido.

### Rendimiento y calidad visual

Medir antes de optimizar. Proponer presupuestos por escena y hardware de referencia; utilizar detalle progresivo, reutilización de geometría y render bajo demanda donde corresponda. Evitar operaciones booleanas costosas sobre todos los agujeros en cada movimiento.

DOM y tests de fórmulas no verifican que el accesorio sea visible. Integrar #444 con WebGL real, cámaras y escenas deterministas; comprobar carga fallida de assets, selecciones, materiales, caras y apertura, además de comparación semántica con SketchUp.

## 8. Paquete E — Flujo empresarial visible

**Resultado:** el usuario termina el mismo flujo desde cotización o desde diseño, sin conciliación manual oculta.

Coordinar #396, #499, #500, #501 y #502. Una cantidad comercial de tres unidades debe permitir seguir tres unidades físicas. La vista de una revisión antigua no debe mostrar datos del catálogo o diseño más reciente por accidente.

Mostrar diferencias comerciales, productivas y solo espaciales. Recalcular el precio de una propuesta no modifica una cotización ya aceptada. La liberación indica diseño, cotización, biblioteca/reglas y huellas exactas. La aprobación de una revisión no migra a la siguiente.

En almacén, distinguir disponible, reservado, despachado y consumido. En producción, seguimiento de pieza para corte/canto/maquinado, conjunto para armado y unidad física para entrega/instalación. Un retrabajo conserva su relación con la pieza anterior y no revive una liberación obsoleta.

La UI debe presentar trabajo siguiente y bloqueos con responsables, no solo una colección de módulos administrativos. Propuesta de navegación: Proyectos, Biblioteca y Taller, con vistas contextuales de Ventas, Diseño, Ingeniería, Abastecimiento, Producción e Instalación.

## 9. Paquete F — Fabricación cualificada y piloto

**Resultado:** un conjunto concreto de piezas llega a fabricación con evidencia verificable para las máquinas elegidas por los clientes.

Coordinar #348, #351, #352/#353, #503 y #354. Separar:

```text
geometría y operaciones neutrales
→ preparación de caras / sujeción / herramientas
→ perfil exacto de máquina y software
→ postprocesador versionado
→ archivo e informe de cobertura
→ importación/readback
→ validación del operador y prueba física
```

No declarar compatibilidad por marca. No convertir un DXF que contiene círculos en una promesa de programa CNC completo. La capacidad desconocida, cara no accesible o herramienta inexistente debe quedar como bloqueo o trabajo manual explícito, nunca desaparecer.

El paquete de salida conserva release, diseño, perfil, postprocesador, revisiones, checksums y estado de evidencia. La integración de envío puede comenzar con descarga/importación manual; un agente local de transferencia posterior necesita cola, idempotencia, confirmación y recuperación, sin confundir transferencia exitosa con ejecución segura.

El corte de tableros y el corte de perfiles requieren políticas distintas. Mantener trazabilidad de material, espesor, veta, cara decorativa, cantos, kerf, refilos y remanentes según el proceso del taller. El porcentaje de aprovechamiento no es suficiente para declarar un plan industrialmente válido.

## 10. Matriz mínima de aceptación transversal

| Caso | Resultado observable obligatorio |
|---|---|
| Dos unidades iguales | Identidades físicas independientes; editar una no modifica la otra. |
| Mismo módulo con dos presets/opciones | BOM y perforaciones corresponden a cada contexto, independientemente del orden de entrada. |
| Herraje sin asset visual | Aviso explícito o proxy marcado; BOM no desaparece. |
| Herraje con maquinado obligatorio sin perfil | No se presenta fabricación validada. |
| Tornillo solo lateral | Piso sin operación por decisión explícita. |
| Tornillo ambas piezas | Operaciones independientes en las caras correctas. |
| Cambio de corredera a box | Componentes, perforaciones, compras y costo cambian juntos. |
| Cambio a frente con perfil | Envolvente y holguras conservadas; panel/perfil/corte/BOM correctos. |
| Abrir cajón | Se mueve el conjunto móvil; carril fijo no se desplaza; huella industrial no cambia. |
| Rotar/espejar mueble | Coordenadas locales y caras productivas siguen correctas. |
| Girar pieza en corte | No se pierde ni se inventa ninguna operación. |
| Deshacer y reabrir SketchUp | Geometría, metadata e identidades coherentes. |
| Error después de descuento | Saldo/picking atómicos o reconciliados; retry no duplica. |
| Dos editores de catálogo | Conflicto explícito o cambios compatibles preservados. |
| Publicar R2 después de liberar R1 | La liberación anterior permanece inmutable. |
| Máquina sin capacidad | Bloqueo o operación manual explícita, no omisión silenciosa. |
| Fallo de invalidación de preflight | Nunca se reutiliza como vigente un ready previo a la mutación. |

## 11. Reglas de ejecución para agentes

Antes de modificar contratos, dibujar el mapa de consumidores reales y su autoridad. No interpretar comentarios históricos de Gate A como prueba de que la base actual no existe. No marcar una issue completa porque su PR tiene el mismo nombre; revisar sus criterios y la evidencia aplicable.

Cada entrega declara: entidad e identidad, revisión de entrada, efecto en piezas/BOM/operaciones/costo, consumidores, concurrencia, fallo y recuperación, pruebas positivas y negativas, migración, documentación y evidencia pendiente.

Las pruebas de paridad deben usar datos compartidos y casos externos verificados, no únicamente dos implementaciones que repiten la misma suposición incorrecta. Los casos físicos incluyen fichas del proveedor y mediciones del taller.

Limitar trabajo simultáneo en contratos centrales. Separar cambios independientes de UI/fixtures de los que alteran resolver, esquema o publicación. No crear un gran PR con todas las recetas ni un rediseño visual que oculte pérdida de funcionalidades.

## 12. Fuentes de verificación

### Código fijado al corte revisado

Prefijo de referencia: `https://github.com/tiagofur/muebleria/blob/587961fd379b64cc27288d8de1a1118b50032a23/`

- `backend-go/internal/domain/engine/authoring_machining.go`
- `packages/domain/src/hardwareMachining.ts`
- `packages/domain/src/projectDrilling.ts`
- `packages/domain/src/duplicate.ts`
- `packages/ui/src/agregados/agregado3dPreview.ts`
- `packages/ui/src/preview3d/HardwareMesh.tsx`
- `packages/ui/src/preview3d/FurnitureScene3D.tsx`
- `packages/excel/src/dxfCutPlanExport.ts`
- `apps/web/src/stores/purchasingStore.ts`
- `apps/sketchup-extension/src/granete_for_sketchup/host/authoring_mutation_coordinator.rb`
- `docs/architecture/3d-asset-library.md`
- `docs/muebles-audit-360-20260903/audit/data/defect-proofs.json`
- `docs/muebles-audit-360-20260903/audit/data/template-roundtrip-proof.json`

Issues consultadas para este anexo: #351, #396, #443, #465, #497, #529. PRs relevantes de referencia: #554, #555, #562 y #564. El reporte conversacional también contrasta los cambios recientes relacionados con edición, inspección y preflight.

### Documentación técnica oficial

- SketchUp Ruby API, `Sketchup::Model#export`: https://ruby.sketchup.com/Sketchup/Model.html
- SketchUp Exporter Options: https://ruby.sketchup.com/file.exporter_options.html
- Khronos, especificación glTF: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
- React Three Fiber, Scaling performance: https://r3f.docs.pmnd.rs/advanced/scaling-performance
- Blum, Cabinet Configurator: https://www.blum.com/gb/en/services/planning-construction-product-selection/cabinet-configurator/
- Promob, frente con perfil Y: https://suporte.promob.com/hc/pt-br/articles/31122720719761-Promob-Frentes-Portas-Puxador-Perfil-Y

Las propuestas no certifican compatibilidad con modelos concretos de herrajes o máquinas ni incluyen dimensiones de mecanizado listas para fabricar.
