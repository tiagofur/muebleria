# Herrajes y accesorios 3D — recursos, montaje y conjuntos paramétricos

**Estado:** contrato de implementación propuesto; DOCUMENTACIÓN, no funcionalidad entregada.  
**Fecha:** 2026-09-11, America/Mazatlan.  
**Base inspeccionada:** `96360841187dbcc1ee4964b555eb4e88cd9e8e9d`.  
**Programa:** Granete, dentro de #465/#308; secuencia operativa en `../hardware-3d-execution-plan.md`.

## 1. Resultado y límites

Un administrador asigna una representación 3D a un herraje del catálogo. La misma selección llega a la biblioteca, al mueble, a SketchUp y a las superficies Web compatibles, con montaje, identidad, revisión y diagnóstico coherentes. Un sistema de cajón reposiciona sus costados rígidos al cambiar el ancho; no deforma el producto comprado. Las piezas fabricadas y el consumo comercial se resuelven por separado, sin duplicaciones.

«Completo» significa que el recorrido y su matriz de aceptación están implementados y ensayados. No significa un lector universal de cualquier archivo CAD, un catálogo de todos los fabricantes, fotorrealismo ni certificación de máquinas. El primer caso real es una jaladera; el segundo, una configuración exacta de MERIVOBOX. El mecanismo debe ser genérico y reutilizable para bisagras, correderas, patas, perfiles y accesorios, sin ramas por marca en Ruby o React.

Este documento extiende, no sustituye, `3d-asset-library.md`, `parametric-furniture-library.md`, `sketchup-backend-web-integration-excellence.md`, ADR-0002/0003/0004 y el modelo existente de `Agregado`. Abrir/cerrar sigue perteneciendo a #529. Proyectar→Design working copy/publicación sigue perteneciendo a #643. PTX/CNC, pricing general, ERP y red de ventas no forman parte de esta implementación.

## 2. Evidencia actual frente al objetivo

La inspección es estática sobre la base indicada, no una ejecución de SketchUp:

| Área | Evidencia actual | Brecha que cubre el programa |
|---|---|---|
| `packages/ui/src/catalogs/hardware/HardwareFormModal.tsx` | Foto, `previewShape`, acabado/color y maquinado; no selector SKP | Asociación y administración de recursos reales |
| `apps/sketchup-extension/src/granete_for_sketchup/assets/asset_resolver.rb` | Busca `<asset_id>.skp` en bundle/cache locales | Resolución remota autorizada y caché versionada |
| `assets/asset_loader.rb` | Carga definición local y aplica traslación; devuelve `nil` ante fallo | Frame completo, fallos tipados y carga verificable |
| `model/furniture_builder.rb` | Intenta asset y luego caja de respaldo | Proxy identificado; no confundir ausente con incompatible |
| `library/layout_contract.rb` | Hardware tiene posición/AABB; no miembros rígidos independientes | Transformaciones autoritativas de hardware y miembros |
| `packages/domain/src/agregados.ts` | Agregado ya expande componentes/herrajes y trata cantidades | Reutilizarlo; no crear otro modelo de cajón o compras |
| #630 | Issue cerrada sobre revisión de catálogo e identidades repetidas | Conservar su solución y probar miembros repetidos sin colisión |
| #372/#350/#415 | Documentación y foundations existentes | Su cierre no certifica carga de recursos reales desde Web |

Antes de implementar se revalidan código, PRs, comentarios y SHA. Un cambio en `main` no se resuelve revirtiendo al snapshot de este documento.

## 3. Autoridad y reutilización

- **Go/dominio:** catálogo, versiones, permisos, reglas de montaje, selección de variante, expansión del Agregado, piezas, BOM, maquinado, preflight, snapshots y clasificación del cambio.
- **React:** administración del recurso y del conjunto, formularios y revisión de diferencias; visualización de la proyección resuelta. No fórmulas industriales paralelas.
- **SketchUp:** preparación visual asistida, carga/representación, selección e interacción. Reutiliza #498 para mutaciones autoritativas y rollback; no otro coordinador, transporte ni store.
- **Almacenamiento existente:** bytes y autorización de recursos; no montar un segundo servicio cloud obligatorio.
- **Contratos:** ampliar OpenAPI/JSON Schema/clientes generados de #496. Toda regla duplicada legítimamente entre TS y Go requiere fixture compartido.

No reemplazar identidades de negocio por SHA, GUID de SketchUp, índice de malla, nombre de componente o ruta. Un hash identifica contenido, no una unidad física.

## 4. Modelo conceptual y persistencia

Los nombres siguientes describen responsabilidades, no autorizan tablas o DTOs duplicados. El primer incremento debe mapearlos a las entidades existentes.

| Concepto | Responsabilidad mínima |
|---|---|
| `Asset` / revisión | Identidad, organización, revisión inmutable, formatos, metadatos de importación, procedencia y licencia |
| Representación | Archivo SKP o GLB, bytes, SHA-256, MIME/tipo inspeccionado, versión de formato/exportador, capacidades y validaciones |
| Binding visual del herraje | Referencia exacta a recurso/revisión, anclaje visual, política rígida y acabado; separado de precio y maquinado |
| Receta versionada de `Agregado` | Miembros/roles, selecciones de catálogo, reglas de montaje/variante, componentes fabricados y consumo comercial |
| Miembro resuelto | Identidad estable, parent/host, recurso exacto, frame local numérico, pertenencia y grupo de presentación |
| Snapshot visual | Pins de recursos y receta en el Design/revisión existente; no un segundo historial |

Los recursos son `tenant-owned` por defecto. Compartir mediante publicaciones y relationships requiere sus gates vigentes; no se vuelve público un archivo porque tenga un hash conocido. Cada nueva tabla se clasifica, tiene RLS e índices, pruebas fresh/upgrade y direct-SQL bajo runtime app role. No sembrar productos de demo dentro de migraciones.

## 5. Ingesta, revisión y distribución

Flujo objetivo:

```text
Seleccionar/subir recurso
→ carga temporal autorizada
→ inspección de bytes y manifiesto
→ validación para los clientes declarados
→ publicar revisión inmutable
→ asociar al herraje
→ resolver mueble
→ descargar representación exacta
→ renderizar y conservar diagnóstico
```

El primer alcance acepta SKP, GLB y miniatura PNG/JPEG/WebP; no archivos ZIP arbitrarios ni scripts de conversión aportados por el usuario. GLB autocontenido es el intercambio web inicial. Recursos externos embebidos por referencia se rechazan o se ingieren por un mecanismo explícito con allowlist; nunca fetching arbitrario desde el navegador, backend o plugin.

La publicación valida tamaño, digest, coherencia del manifiesto y referencias. La extensión del archivo no es validación suficiente. SKP binario se valida mediante el host compatible o una herramienta soportada cuya disponibilidad se pruebe; no se inventa un parser en Go/Node. El estado `uploaded` no significa `validated`. Publicación puede habilitar sólo SketchUp si Web aún no dispone de GLB, mostrando esa capacidad parcial de forma visible.

Preparar GLB desde SketchUp es una operación explícita de administración sobre un componente aislado/documento de preparación. No abrir/exportar silenciosamente el proyecto activo ni enviar ambientes, clientes o geometría ajena. En hosts sin exportador compatible, permitir subir un GLB preparado externamente; no contratar otro servicio ni instalar software de pago como requisito.

La conversión genera una revisión derivada con `sourceAssetRevision`, versión del exportador, opciones, unidades, ejes y checksums. El GLB no hereda automáticamente una validación por tener el mismo nombre que el SKP. Se comprueban referencias de montaje, dimensiones de referencia y mapeo de miembros; la apariencia PBR puede diferir entre motores y no se promete igualdad de píxeles.

## 6. Seguridad y lifecycle de archivos

Reutilizar #460/#461 y la autorización de media existente. Exigir capacidad y ownership antes de emitir descarga; URL firmada corta y específica de recurso o fetch autenticado, nunca JWT de sesión web dentro de URLs ni credenciales web en SketchUp.

La política del primer incremento debe fijar límites configurables para carga, recursos, triángulos, texturas, memoria y tiempo de inspección. Los límites son propuestas hasta medirse/aprobarse; no inventar benchmarks. Validar MIME y contenido, path traversal, referencias cruzadas de tenant, URLs/redirects externos, archivos corruptos y cargas parciales. Nombres locales se derivan de identificadores validados, nunca de paths del usuario. No ejecutar Ruby, macros ni scripts contenidos o acompañando un recurso.

Finalizar/publicar/asociar son comandos con concurrencia e idempotencia explícitas y auditoría durable. Reintentar no duplica revisiones ni asociaciones. Cancelar una carga conserva la asociación previa. La recolección de cargas temporales no borra recursos referenciados.

Un recurso publicado se retira de nuevas selecciones, no se sobrescribe ni elimina de revisiones históricas. La política de backup/restauración incluye blobs y metadatos. Revocación de acceso no puede recuperar bytes ya descargados o incluidos en un SKP guardado: documentar este límite, limpiar caché administrada al cambiar scope según policy y no prometer borrado remoto. Cualquier retiro legal/seguridad de bytes históricos muestra recurso no disponible; jamás lo sustituye por `latest`.

## 7. Coordenadas, unidades y anclajes

Conservar el frame canónico vigente de Granete; no renombrar globalmente ejes ni confundir ejes locales de tablero con frame de mueble. Los valores industriales usan mm. glTF usa metros y su convención de ejes; SketchUp Ruby utiliza longitudes internas en pulgadas. La conversión de formato es una normalización explícita y única, no un escalado comercial.

Composición conceptual, para un punto del archivo:

```text
worldPoint = furnitureWorld
           * memberResolvedLocal
           * assetNormalization
           * assetPoint
```

`assetNormalization` registra unidades, ejes y desplazamiento hasta el anclaje visual. `memberResolvedLocal` es la pose aceptada del miembro en mm, con base ortonormal diestra y traslación. Reutilizar el contrato existente de transformaciones. Números no finitos, matrices singulares, shear y escala no uniforme de un herraje rígido se rechazan. Ningún renderer deduce rotación por nombre, rol, AABB o tamaño mayor.

Para una jaladera se registra el plano/punto de montaje y su orientación. Las perforaciones son anclajes técnicos explícitos, no vértices deducidos de la malla. Cambiar el pivote visual no desplaza automáticamente perforaciones. Si cambian los anclajes técnicos o el SKU, el motor clasifica y recalcula consecuencias.

No ajustar automáticamente una malla rígida al bounding box recibido. Las diferencias de medidas se reportan para corregir la preparación o selección del recurso. Para el primer alcance, las manos izquierda y derecha pueden usar archivos distintos; mirroring sólo si la receta/recurso lo permite y su normalización queda validada. No introducir transformaciones negativas en managed productive geometry para adivinar una mano.

## 8. Representación en SketchUp

Completar `AssetResolver`, `AssetLoader` y `FurnitureBuilder`, no sustituir la jerarquía nativa. Caché fuera del paquete instalado, escribible y scope-aware, por organización/recurso/revisión/digest. Descargar a temporal, comprobar bytes y hash, renombrar atómicamente y deduplicar peticiones en curso. Reintento limitado, cancelación y diagnóstico tipado; una respuesta tardía no cambia otro modelo, selección, sesión o revisión.

Descargar/preparar recursos antes de la operación nativa de mutación. Aplicar geometría y metadata como una operación coherente en el hilo del host. Un error conserva la jerarquía válida previa. Si se acepta una degradación visual, debe ser un resultado explícito del comando y no quedar una mezcla parcial de modelos y metadata nueva.

Definiciones visuales compartidas sólo cuando son inmutables y content-addressed. Aislar cambios de acabado/receta por instancia; modificar FI-A no cambia FI-B. Limpieza scoped de definiciones huérfanas, nunca `purge_unused` global. Los wrappers de hardware conservan `hardwarePlacementId`; sus miembros visuales no se convierten en nuevos placements comerciales por el mero hecho de existir.

El inspector explica recurso, versión, representación y fallo con acción apropiada. Copiar, deshacer, rehacer, guardar, reabrir, sustituir herraje y reconstruir conservan identidades/poses y pins. Geometry edits arbitrarios del usuario no se aceptan como una modificación técnica del producto.

## 9. Representación Web y consumidores

Reutilizar `FurnitureScene3D`, `HardwareMesh` y la proyección de escena actual. Una proyección compartida debe transportar pertenencias, identidades, frames, referencias de recursos, materiales y diagnósticos; no otro resolver ni visor de muebles paralelo.

Inventariar y cubrir editor/vista del herraje, preview de Agregado, preview de mueble/estructura, Proyectar y visualización histórica compatible. Las piezas generadas por Granete permanecen generadas; sólo las representaciones declaradas consumen GLB. No parsear SKP en navegador ni inferir semántica industrial del GLB.

Seleccionar la malla resuelve su miembro/placement/Agregado mediante metadata explícita. Un índice interno de glTF puede localizar un nodo sólo dentro del archivo exacto fijado por digest; no es identidad entre revisiones. Si hay remapeo tras reexportación, requiere validación explícita.

Materiales/acabados se ligan por slots estables. Color decorativo y SKU/acabado comercial son cambios distintos. El renderer no inventa textura/acabado histórico desde el catálogo actual. LOD y miniaturas pertenecen a la misma revisión y respetan los anclajes; simplificar no altera geometría técnica.

Esta entrega puede renderizar/administrar recursos antes de #643. No certifica publicación autoritativa desde Proyectar mientras su convergencia siga pendiente, ni agrega un dual-write a ProjectKitchenLayout.

## 10. Estados separados y respaldo honesto

Los enums definitivos se acuerdan en el contrato generado. Semánticas mínimas:

- Recurso: borrador, validando, publicado, retirado o rechazado.
- Representación: exacta disponible, descargando, procedural genérica, proxy por ausencia, formato no soportado, corrupta o temporalmente inaccesible.
- Visibilidad: visible, oculto por usuario o suprimido por receta; nunca confundir con ausencia de recurso.
- Técnica: no requerida, configurada, faltante o no soportada, proyectada desde preflight; cargar un SKP no cambia este estado.

Orden de respaldo: representación exacta compatible → representación procedural explícitamente soportada → proxy identificado. No añadir un catálogo procedural enorme para posponer SKP. No desaparición silenciosa ni cubo presentado como jaladera exacta. Todas las rutas deben llevar el diagnóstico hasta la UI; un resumen por proyecto agrupa fallos y permite navegar al miembro afectado sin treinta popups.

Una ausencia puramente visual no bloquea automáticamente cotizar o fabricar cuando el contrato técnico sí está completo. Sí impide declarar demo visual completa para ese artículo. Una regla técnica requerida ausente bloquea fabricación, aunque el dibujo sea perfecto. Fallos de lectura no se muestran como colección vacía.

## 11. Conjuntos paramétricos sobre Agregado

El Agregado es la unidad semántica existente; una receta versionada describe cómo combinar piezas, herrajes y representaciones. El producto vendido puede ser un juego; el conjunto visual puede tener muchos miembros. No crear `DrawerSystem` con otro lifecycle si sólo duplica Agregado.

Políticas por miembro:

| Política | Ejemplo | Comportamiento |
|---|---|---|
| `rigid` | jaladera, bisagra, costado metálico | Sólo posición/orientación; geometría preservada |
| `catalogVariant` | longitud/altura/mano de herraje | Selección de SKU válido; nunca estirar uno comprado |
| `manufacturedParametric` | fondo/trasera de tablero | Regenerar pieza mediante reglas industriales existentes |
| `cutToLength` | perfil autorizado recortable | Regla técnica explícita, preservando sección; no escala arbitraria |
| composición | conjunto de los anteriores | Montajes y pertenencias resueltos por el motor |

El contrato puede reservar `cutToLength`; no anunciarlo operativo hasta tener un perfil con regla, implementación y pruebas. Las entradas fuera del rango o sin variante no se recortan ni aproximan automáticamente. Se muestran alternativas compatibles mediante el selector existente.

La receta usa parámetros tipados y el evaluador seguro existente. Nada de `eval`, código de proveedor o fórmulas ejecutadas sólo en React/Ruby. Validar ciclos, host ausente, referencias ambiguas y límites de expansión antes de modificar el mueble.

## 12. Caso piloto MERIVOBOX

Seleccionar una configuración exacta: mercado, familia, SKU o kit, altura, longitud nominal, mano, acabado, revisión de documentación y archivos con permisos conocidos. No fijar constantes de montaje desde este plan. Obtenerlas de documentación del fabricante y registrarlas con localizadores y evidencia.

Conjunto mínimo: miembros izquierdo y derecho independientes, guías/fijaciones según configuración, frente y piezas fabricadas vinculados sin duplicar lo que el SKP incluya. El archivo importado puede contener tableros sólo ilustrativos: deben excluirse explícitamente de visualización duplicada/BOM o mapearse al componente existente, nunca contarse dos veces.

Para un hueco de ancho libre W, la receta resuelve los anclajes de ambos lados respecto de las caras interiores. El cambio W→W+Δ desplaza los anclajes conforme a la convención elegida. Las distancias entre puntos locales del mismo costado no cambian. La altura y longitud del herraje siguen variantes válidas; los descuentos del fondo/trasera vienen de la receta técnica.

Prueba geométrica sintética: con origen izquierdo fijo, mismo kit y offsets, aumentar W en 200 mm mueve el anclaje derecho 200 mm y no cambia la malla de ningún lado. Estos 200 mm son un fixture, no una dimensión aprobada de MERIVOBOX. La prueba de producto usa tres anchos realmente admitidos por la documentación elegida, un límite y un caso inválido.

Tanto dos SKP separados como un SKP estructurado son admisibles. El primer vertical usa miembros preparados separados para reducir riesgo. La experiencia completa admite mapear un conjunto estructurado mediante IDs persistidos por Granete, anclajes y revisión; un modelo monolítico no se divide por heurística. No deducir roles por nombres ni espejar un miembro asimétrico sin autorización.

## 13. Identidad, compra y maquinado

Reutilizar las identidades persistidas de `ModuleAgregadoInstance`, sus ocurrencias y la solución #630. Preservar identidad de miembros no reemplazados al cambiar medidas; miembros realmente nuevos reciben identidad distinta. Renombrar/reordenar no reasigna hosts. Tres cajones idénticos deben ser tres conjuntos independientes.

Una unidad comercial tipo `set` puede aportar varios miembros visuales. La receta declara qué viene incluido, qué se compra aparte y cómo se consume; no multiplicar costos/cantidades por número de nodos SKP/GLB. Extender las reglas de deduplicación existentes con procedencia explícita, no por nombre. No cambiar el motor general de precios para representar un juego.

Las perforaciones siguen `HardwarePlacement`/relaciones y `ManufacturingFeature` existentes. Cada operación indica host y procedencia exacta; el renderer no calcula taladros. Al variar el ancho, las operaciones dependientes se recalculan; las ajenas conservan su resultado. Si la receta necesita una capacidad no implementada, el caso queda técnico no soportado y no se presenta como fabricable.

Cambiar familia/SKU/receta implica simular → mostrar diferencias de piezas, herrajes y cantidades → confirmar → aplicar atómicamente. Un cambio ordinario de ancho dentro de una receta compatible puede resolver automáticamente con feedback, sin confirmación por costado. No autoaceptar cotizaciones, publicar revisiones ni liberar producción.

## 14. Ajustar dimensiones no es abrir el cajón

#529 conserva ownership de cinemática de presentación. Exigir pertenencia **por miembro y por actor**: las guías fijadas al cuerpo no se desplazan al abrir; el cajón, frente, jaladera y miembros móviles siguen su actor. Miembros telescópicos pueden usar una representación simplificada explícita hasta ampliar su perfil. «Mover todo el Agregado» no autoriza mover fijaciones del cuerpo.

Abrir/cerrar parte siempre de la pose cerrada aceptada y no cambia dimensiones, maquinado, BOM, fingerprint, working-copy ni release. Guardar/publicar nunca interpreta la pose abierta como autoría. En cambio, modificar ancho o sustituir un SKU sí puede cambiar fabricación y exigir la revisión correspondiente.

La entrega de conjuntos cerrados no depende de completar animaciones especiales. El cierre del programa visual completo requiere al menos los hitos puerta/cajón Web+SketchUp de #529 con miembros fijos/móviles correctos; no cerrar #529 ni certificar todos los elevadores por ese hito parcial.

## 15. Revisiones históricas y clasificación de cambios

Desde la primera asociación persistida, referencias exactas: recurso, revisión, representación/digest, normalización y binding. La publicación de DesignRevision congela esos pins y los de receta/variante; el manifest los valida contra el estado aceptado. Reutilizar #392/#393/#394/#395 y su artifact lifecycle, no un nuevo Design store.

- Nueva miniatura, LOD o corrección exclusivamente visual: nueva revisión visual; no modificar BOM automáticamente. Historial conserva el recurso anterior.
- Cambio de modelo vendido, acabado comercial, anclaje técnico, tamaño o receta: clasificación autoritativa de impacto, resolve/preflight y reconciliación comercial cuando corresponda.
- Simple apertura de presentación: no crea cambio de diseño.

Separar digest visual del fingerprint industrial sin ignorar los campos que sí tienen consecuencias técnicas. La prueba negativa debe demostrar ambas direcciones: cambio visual no altera falsamente fabricación; cambio técnico no se disfraza de visual.

Publicar no debe consultar `latest` para arreglar pins ausentes. Catálogo modificado durante la publicación produce conflicto o utiliza el snapshot exacto permitido. Missing history se informa; no backfill inventado. Migrar asociaciones existentes explícitamente, sin reescribir revisiones aprobadas. Schema desconocido se rechaza antes de mutar; capacidades permiten lectura honesta en clientes antiguos.

## 16. UX de administración y uso diario

En Herrajes, una sección «Modelo 3D y montaje»: genérico, modelo real o conjunto. Reutilizar el selector/catálogo existente con búsqueda, miniatura, formato, revisión y estado por cliente. Mostrar «Subir modelo», «Elegir existente», «Validar en SketchUp», «Preparar vista Web» y «Reemplazar mediante nueva revisión» sólo donde sean acciones posibles/autorizadas; una primary action por contexto.

La configuración avanzada de origen, ejes, tamaño de referencia y anclajes ocurre una vez, con vista de comprobación y campos comprensibles en mm. No pedir quaternions ni repetir preparación por mueble. Accesorios que ya son herrajes/componentes reutilizan el mismo binding; no crear un ABM duplicado por llamarse accesorio.

En Agregados: seleccionar receta/variante, ver miembros y su condición fija/móvil, resolver tres medidas de prueba y revisar diferencias. La asignación de roles a un SKP estructurado necesita un asistente de preparación explícito, no una lista de nombres inferidos.

Conservar borrador si falla carga/guardado, distinguir progreso/pendiente/error y ofrecer retry seguro. Respetar permisos, teclado, foco, copy en español, tokens del design system y estados 390/768/1280. Un usuario normal diseña y cambia medidas; no administra archivos durante cada inserción.

## 17. Calidad, rendimiento y operación

Dos bibliotecas de pruebas: fixtures sintéticos redistribuibles para CI y recursos reales del piloto sólo con autorización/licencia documentadas. No añadir automáticamente modelos de terceros al repositorio público. Preparación y distribución deben funcionar usando almacenamiento y herramientas disponibles, sin dependencia de suscripción nueva.

Instrumentar descargas, cache-hit, carga, reconstrucción, selección, memoria, peso del SKP/GLB, definiciones y limpieza. Reutilizar #472/#312; la aceptación usa presupuestos medidos y aprobados en el host/dispositivo declarado, no promesas universales de FPS. Materiales/texturas y LOD se optimizan sin perder anclajes, partes o diagnóstico.

Diagnóstico correlacionado y sanitizado con #504: categorías de fallo y resource IDs donde se permita, sin tokens, rutas privadas, clientes o geometría adjunta por defecto. Runbook para recurso corrupto, enlace expirado, retirada, rollback de revisión, restauración y caché desactualizada.

## 18. Matriz obligatoria de aceptación

| ID | Escenario | Evidencia requerida |
|---|---|---|
| V01 | Subir, validar, publicar, asociar y releer recurso | Browser + Go + PostgreSQL/storage reales; permisos/idempotencia |
| V02 | Jaladera en SketchUp limpio, sin copiar SKP manualmente | Host real; cache cold/warm, escala/anclajes correctos |
| V03 | Host/mueble rotado y jaladera horizontal/vertical | Aserciones de frame y capturas; no AABB fitting |
| V04 | Faltante, corrupto, formato/host incompatible, timeout | Diagnóstico y proxy honesto; no pérdida ni falso éxito |
| V05 | Misma pieza en SKP/GLB y todos los consumidores Web | WebGL real + SketchUp; unidades/anclajes/materiales |
| V06 | Tres cajones, tres anchos válidos, límite e inválido | Miembros rígidos invariantes; IDs independientes/reorder-stable |
| V07 | Juego comercial y piezas fabricadas | BOM/cantidades sin duplicación; fixtures TS/Go |
| V08 | Montaje y perforaciones | Hosts/provenance exactos; no operación ajena alterada |
| V09 | Abrir/cerrar tras cambiar ancho | #529: fijo/móvil, sin drift ni cambio industrial |
| V10 | FI-A/FI-B, duplicar, undo/redo, guardar/reabrir | Host real, identidad y aislamiento de definiciones |
| V11 | Publicar R1, cambiar recurso/receta, publicar R2 | Pins/historial/approval/release exactos; R1 intacta |
| V12 | Tenant/session switch, revocación, URL expirada | No filtración ni respuesta tardía aplicada a otro scope |
| V13 | Catálogo grande y reconstrucciones repetidas | Métricas contextualizadas y limpieza; presupuesto aprobado |
| V14 | Administrador prepara y diseñador utiliza sin ayuda oculta | Usabilidad real y runbook, no consola para happy path |

Capas separadas: contrato, TS, Go/PostgreSQL, Ruby portátil, navegador WebGL, SketchUp real, revisión de producto. PASS en una no convierte SKIPPED/NOT_RUN en PASS en otra. El programa no requiere ejecutar una máquina ni confiere compatibilidad CNC/PTX.

## 19. Fuentes externas verificadas para decisiones de formato

Consultadas 2026-09-11. Son referencias de capacidades, no evidencia de Granete ejecutado:

- SketchUp Ruby API, `Sketchup::Model#export`: documenta exportador GLB desde SketchUp 2024; validar host/licencia/exportador realmente usado: https://ruby.sketchup.com/Sketchup/Model.html#export-instance_method
- SketchUp Help, trabajo con GLTF/GLB: https://help.sketchup.com/en/sketchup/working-gltf-files
- Khronos glTF 2.0, sistema de coordenadas, metros y transformaciones: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
- Blum México, servicio CAD/CAM: disponibilidad de productos individuales, conjuntos y documentación de producción; no constituye permiso automático de redistribución ni regla de montaje universal: https://www.blum.com/mx/es/services/industrial-production/cad-cam-dataservice/

## 20. Condiciones antes de ejecutar

Revalidar el writer/PR activo y #573; este documento no activa otra feature ni otorga `status:approved`. No tocar `progress/current.md` ni el ledger para simular inicio. Cada issue debe proponer alcance acotado, exclusiones, pruebas y presupuesto antes de implementar. PRs parciales usan `Refs`, no cierre del parent. Sin merge, cierre o ejecución física automáticos.

El plan de ejecución es el mapa de issues e hitos. Esta especificación contiene invariantes y aceptación; no mantener dos descripciones contradictorias del mismo programa.
