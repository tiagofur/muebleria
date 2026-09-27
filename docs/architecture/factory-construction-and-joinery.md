# Construcción por fábrica, contactos y recetas de unión

> Decisión de producto: 2026-09-27. Estado: **especificación objetivo para implementación**, no certificación de producto o máquina.
> Seguimiento: [#776](https://github.com/tiagofur/muebleria/issues/776), [#775](https://github.com/tiagofur/muebleria/issues/775), motor [#874](https://github.com/tiagofur/muebleria/issues/874), React [#875](https://github.com/tiagofur/muebleria/issues/875).
> Este documento complementa [Manufacturing Library Platform](manufacturing-library-platform.md) y [Manufacturing Feature Model](manufacturing-feature-model.md); no crea otro catálogo, motor, coordinador ni ledger operativo.

## Cómo retomar sin la conversación

Leer esta especificación y la issue exacta; verificar estado, comentarios, PR/base y reservas actuales. GitHub Issues conserva ejecución/approval; las secciones E1/E2 describen dependencias y pruebas, no estados vivos. Un writer por alcance y revisión independiente según `AGENTS.md`. La autorización de documentar no activa writers de producto ni cambia etiquetas protegidas.

La decisión central es: **el cliente configura su fábrica en React y conserva la biblioteca compartida de Granete; la unión genera los maquinados de todas las piezas participantes**. Otro usuario de la misma fábrica recibe la misma política. Otra fábrica no se ve afectada. El sistema no exige pedir a Granete cada cambio de tornillos o editar cada mueble.

### Base inspeccionada y límites de la evidencia

Referencia de preparación: `main@b5697951021f6484cf3e71161ec396ff6f434194`. La primera inspección DXF utilizó `eafc014f0003dacb776a4cdf61ef5c0ceb04c5da`. Revalidar antes de implementar: un reporte local sin commit no equivale a código integrado.

| Base que se reutiliza | Qué no permite concluir |
|---|---|
| #356 y `sketchupRelationshipMachining.ts`: relaciones, instancias y machining derivado; rama específica `shelf-support` | No demuestran un motor general de todos los contactos |
| `jointDrillingRules.ts`, `partDrillingResolver.ts`, `projectDrilling.ts` | Existen caminos particulares/fallbacks; hay que trazar consumidores, no añadir un tercero |
| `backend-go/internal/domain/engine/authoring_machining.go` | La paridad de un ejemplo no certifica una receta industrial real |
| #772/#773/#775 y ADR-0008 | Arquitectura de releases/overlays; verificar qué está integrado, no declararla completa por existir documentos |
| #676 | Corrección acotada de proyección e integridad DXF; no homologa CNC |

Fuentes de código: [resolvedor TS](../../packages/domain/src/sketchupRelationshipMachining.ts), [reglas](../../packages/domain/src/jointDrillingRules.ts), [assembler](../../packages/domain/src/projectDrilling.ts), [resolvedor Go](../../backend-go/internal/domain/engine/authoring_machining.go). No se reabren #356/#347 ni se reescriben sus pruebas históricas por planificar esta extensión.

## C1. Política industrial de fábrica y una sola persistencia

La política de construcción es un conjunto **tipado y versionado de selecciones/overrides del dominio industrial**, resuelto mediante el manufacturing overlay de #775. No es `StoreCatalogOverlay` de #454, settings personales, un JSON local ni una copia completa del catálogo.

El modelo lógico usa una sección tipada, conceptualmente `constructionPolicy`, dentro del agregado de diferencias de fábrica: reglas por familia de unión, selección de recetas/revisiones y parámetros permitidos. Las recetas pertenecen al dominio canónico de fabricación; el overlay referencia sus identidades exactas. El modelo físico puede normalizar esa sección, pero no introducir un segundo perfil mutable que compita con ella. #775 decide tablas/API y #874 el contrato técnico de recetas; la correspondencia debe quedar documentada antes de código.

Ejemplo de aceptación, **no especificación de resistencia ni dimensiones de herraje**:

| Fábrica | Misma definición Standard | Política |
|---|---|---|
| A | Gabinete de referencia | Taquetes + tornillos; 4 tornillos y 2 taquetes por unión |
| B | La misma ID/revisión | Sólo tornillos; 5 por unión |
| C | La misma ID/revisión | Minifix + taquetes con perfil técnico concreto |

Cambiar A no modifica Standard, B ni C. Global significa predeterminado para todos los muebles **compatibles del contexto/versionado aplicable**, no una orden de taladrar todas las piezas. Los tipos no soportados se explican; no se fuerzan a una receta ajena.

## C2. React: dos lugares obligatorios, no dos autoridades

### Config → Fabricación → Construcción y uniones

Integrar en Config existente. Mostrar fábrica activa, versión efectiva, borrador, origen de valores y errores. Elegir recetas/herrajes compatibles, cantidades por unión/tipo, distribución, márgenes y excepciones admitidas. La UI obtiene opciones y diagnóstico del backend; no calcula compatibilidad o coordenadas alternas.

Permitir guardar un borrador incompleto según el contrato, sin hacerlo efectivo. Una acción principal contextual permite revisar/validar/activar con efectos visibles. El usuario no debe administrar UUIDs, Git ni copiar bibliotecas. Separar semánticamente guardar borrador, activar para nuevos contextos y actualizar un contexto existente aunque la presentación simplifique pasos válidos.

Un administrador/responsable autorizado de la fábrica completa el flujo soportado sin intervención rutinaria de Granete. Esto amplía la primera experiencia interna de #775: **autoservicio acotado es obligatorio; editor universal de biblioteca/scripts sigue excluido**.

### Componentes → Editar → Construcción y uniones

Usar el editor React existente para configurar rol constructivo, zonas/caras/cantos, referencias, familias de conexión, restricciones y receta heredada o específica. Distinguir definición reutilizable, uso del componente en una definición de mueble e instancia concreta del proyecto. Mostrar a qué alcance se aplicará Guardar.

Un cliente que personaliza un componente Standard escribe diferencias en el overlay de SU fábrica; no modifica upstream. Mostrar «Biblioteca», «Fábrica», «Componente» o «Excepción» como origen y una acción de restaurar herencia. Una excepción de instancia no modifica todas las copias de la definición.

#784 configura defaults de un **Design** en el inspector SketchUp y mantiene su contrato propio. Su prohibición de otra pestaña permanente del plugin no prohíbe esta sección industrial en Config de React. #875 no reemplaza el inspector ni modifica Ruby.

## C3. Precedencia, restricciones y edición segura

Para campos declarados editables, resolver de menor a mayor especificidad:

1. Default técnico adaptable de biblioteca.
2. Regla/default industrial de fábrica para la familia de conexión.
3. Override de definición/componente/uso del componente propiedad de esa fábrica, con alcance explícito.
4. Excepción permitida del contexto de trabajo/mueble/unión, fijada por la revisión que la contiene.

No crear cuatro nuevas familias persistentes por esta lista: integrar las autoridades existentes. Defaults de Design sólo seleccionan capacidades autorizadas; no sustituyen la política de fábrica. Dentro de un mismo nivel, seleccionar por criterio semántico explícito; empate conflictivo produce error, nunca gana el último elemento de un array.

Las restricciones técnicas obligatorias se validan aparte: una excepción no las anula. Cambiar una restricción de definición exige una revisión canónica validada, no marcar «override» en una instancia. Standard debe dejar heredables sus elecciones adaptables; fijar todas sus recetas impediría que Config tuviera efecto.

Ausencia de override, valor explícito, `false`, cero permitido y desactivación autorizada son estados distintos. Restaurar herencia elimina la intención de override; igualdad de valores no demuestra herencia. Backend devuelve valor efectivo, procedencia y revisiones para explicación. No ejecutar scripts libres ni mezclar JSON arbitrariamente.

## C4. Seguridad y frontera fábrica–tienda

Separar capacidades de usar, editar borradores, resolver conflictos, validar/activar/publicar y modificar upstream. El permiso de usar una biblioteca no concede edición. El autoservicio de fábrica no concede publicar Standard. Reutilizar roles/capabilities reales, sin inventar nombres de roles nuevos como atajo.

En servidor: membership + capability + ownership y RLS transaccional bajo runtime sin BYPASSRLS. UUID/código/hash no autorizan. Validar también referencias a recetas, herrajes y releases de otra organización. Mutaciones siguen If-Match/versionado, idempotencia y audit/outbox de las autoridades existentes.

Cache, solicitudes y respuestas tardías deben estar ligados a fábrica, sesión/contexto y versiones pertinentes. Una respuesta de A no activa datos después de cambiar a B. Probar API y SQL runtime cross-tenant, no sólo esconder botones. PostgreSQL de pruebas siempre descartable.

## J1. Zonas de conexión e intención constructiva

Cada pieza expone superficies o zonas semánticas con frame local, referencia estable, familias admitidas y restricciones. Son zonas de conexión, **no agujeros pregrabados**. Rol constructivo y rol de acabado/material siguen separados.

| Construcción | Intención habitual de conexión |
|---|---|
| Piso entre costados | Un contacto en cada extremo contra cada costado |
| Techo entre costados | Contactos propios, no deducidos del nombre «techo» |
| Manguete | Extremos con orientación y longitud útil particulares |
| Respaldo interior | Perímetro contra piezas realmente presentes |
| Respaldo sobrepuesto | Conexiones por su montaje posterior; no reutilizar ciegamente las del interior |
| Respaldo ranurado | Relación de alojamiento y ranuras; no «perforar cuatro lados» |
| Entrepaño fijo | Uniones estructurales independientes por extremo |
| Entrepaño regulable | Apoyos/hilera con intención distinta; moverlo no desplaza automáticamente la hilera |

«Emisor» y «receptor» pueden ayudar a editar la biblioteca, pero una misma pieza cambia de participación por unión. No codificar que un costado nunca genera operaciones. La plantilla declara relaciones esperadas para no exigir al diseñador seleccionar cada pareja en cada inserción.

Los anchors de relaciones resueltas apuntan a `componentInstanceId` y superficies verificables. No identificar ocurrencias por nombre, geometría, código humano o índice del array. Reinstanciar/copiar asigna identidades nuevas según el contrato canónico; reordenar entradas no cambia identidades equivalentes.

## J2. Resolver y validar el contacto

Primero resolver materiales, espesores, parámetros y poses efectivos. Después validar la conexión declarada: pertenencia al ensamblaje, orientación de superficies, separación admitida y solapamiento útil. Para contacto plano simple, las normales y la distancia entre planos deben ser compatibles; uniones ranuradas/sobrepuestas usan su geometría específica.

Bounding boxes/proximidad sólo sirven para proponer candidatos o descartar pares, no para autorizar una unión. Un contacto esperado sin contraparte o con dos candidatos indistinguibles bloquea fabricación; no elegir el más cercano/primero. Contactos opcionales ausentes no son equivalentes a relaciones obligatorias incompletas. No unir automáticamente costados de muebles vecinos.

MVP: paneles rectangulares y contactos soportados del gabinete de referencia. Geometrías/transformaciones no soportadas se rechazan explícitamente; no degradarlas silenciosamente a cajas alineadas. Separar tolerancia numérica, holgura de montaje y margen técnico. No usar una tolerancia grande para ocultar una conexión imposible.

## J3. Un frame de unión; operaciones diferentes por participante

Calcular las estaciones de fijación una sola vez en el tramo útil de contacto. Cada receta agrega sus offsets/ejes y transforma las operaciones a los frames locales de las piezas participantes. No distribuir agujeros independientemente en dos piezas de diferente profundidad.

Cara de contacto y cara de entrada de herramienta son distintas: una fijación puede contactar la cara interior del costado y mecanizarse desde la exterior. Las caras intrínsecas no cambian porque el mueble gire en SketchUp. Reutilizar bases locales canónicas; documentar cambios de frame, origen y sentido, nunca inferirlos de longitud/ancho.

Resolver sobre la etapa física correcta: tablero terminado, pieza cruda, antes/después del tapacanto. Un descuento modifica potencialmente dimensiones y origen; no escalar perforaciones ni descontar dos veces. Si falta esa transformación, salida bloqueada con motivo concreto.

Para pares coaxiales verificar ejes de montaje; para herrajes con alojamientos y pasos diferentes verificar los offsets técnicos. Mover un entrepaño puede conservar sus agujeros locales y cambiar solamente los de costados; eso es correcto. El transform global del mueble no cambia la fabricación local.

## J4. Recetas versionadas y patrones compuestos

La receta referencia perfiles técnicos concretos y define participantes, operaciones por cara, requisitos y consumo. Familias iniciales: tornillo, taquete+tornillo y minifix+taquete, sin considerar una marca o nombre comercial una especificación suficiente.

En particular, no copiar el diámetro/profundidad de la excéntrica minifix a su paso de perno o a la contraparte. Cada variante necesita documentación técnica identificada por fabricante/modelo/revisión y límites de espesor/material. Los números de fixtures sintéticas no se activan como recetas industriales. Faltan referencias técnicas de cliente: su obtención es una entrada explícita de #874, no motivo para inventarlas.

Cada tipo de fijación tiene cantidad/distribución propia o pertenencia explícita a un grupo. Cuatro tornillos + dos taquetes por unión significa eso, no cuatro grupos con dos taquetes cada uno. UI y contrato distinguen «por unión», «por lado», «por mueble» y conversiones explícitas.

Modos: cantidad fija, separación máxima y patrón explícito. Con cantidad fija N≥2 y tramo útil `[a,b]`, estaciones uniformes `a+i*(b-a)/(N-1)`; N=1 requiere anclaje declarado y N=0 sólo se acepta si la receta lo permite. Con separación máxima generar y volver a validar el patrón. Retícula/zonas prohibidas son restricciones adicionales, no un redondeo ciego.

Ejemplo exclusivamente matemático: tramo 500, márgenes 50/50; cuatro estaciones 50, 183.333…, 316.666…, 450; cinco 50,150,250,350,450. No son recomendaciones de distancias o resistencia. Validar después de redondear/snapping: conteo, separación, margen, distancia a bordes y envolvente del herraje.

Si cinco fijaciones no caben, bloquear y explicar; no bajar a cuatro, omitir un taquete, desplazar operaciones ajenas ni cambiar de receta automáticamente. Propuestas alternativas requieren aceptación explícita compatible con la revisión.

## J5. Integridad, procedencia y colisiones

Distinguir operación no requerida por receta, relación desactivada con autorización, perfil faltante y resolución fallida. Una pieza sin agujeros puede ser válida; un fallo no se convierte en fallback exitoso. La ausencia de diagnósticos de una etapa no certifica todo el pipeline.

Cada operación derivada conserva exactamente su variante de origen relationship/joint/manual placement y referencias estables al participante, receta/revisión y estación/feature donde el contrato lo admita. IDs no dependen del orden de iteración ni de coordenadas cambiantes. No fabricar provenance ausente en datos legacy.

Agregar/eliminar/mover/duplicar modifica sólo dependencias correctas, sin agujeros huérfanos o bindings entre copias. No contar cada agujero como otro herraje: una fijación puede producir varias operaciones. Las sustituciones de herraje cambian BOM/consumo/clasificación comercial canónicos aunque la perforación coincida.

Validar profundidad, acceso, distancia a borde, materiales, volumen de operaciones y separación del herraje. En la esquina respaldo–piso–costado, verificar operaciones de todas las uniones juntas. Dos centros coincidentes no autorizan fusionar operaciones: conservar conflictos salvo composición explícita que permita una operación física compartida con trazabilidad.

## J6. Un motor y salida neutral

Reconciliar `jointDrillingRules`, relación→machining y los ensambladores existentes. #874 entrega mapa de quién llama a cada camino y punto de convergencia, migración y pruebas; no se añade `newUniversalDrillingEngine` junto a dos autoridades activas. TS/Go comparten contrato y fixtures donde implementan la misma regla. Ruby y React capturan intención/presentan resultados, no poseen fórmulas paralelas.

Flujo: construcción → contactos → receta → operaciones/consumo → validación autoritativa → salida neutral → montaje/capacidades → adapter. Datos parciales pueden servir para diagnóstico, nunca como lote fabricable después de perder sus incidencias. Las limitaciones de datos legacy se muestran, no se completan con heurísticas por nombre como nueva verdad de producción.

## V1. Versiones, actualizaciones e historia

#772 fija la biblioteca efectiva en el boundary Digital Thread correcto; #775 resuelve la revisión exacta de política/overrides y #773 publica el resultado inmutable. El snapshot debe poder reconstruir recetas, materiales, geometría e intención efectiva sin consultar defaults actuales. No agregar un puntero mutable en Project que destruya alternativas de Design o historia de Q/R.

Activar una política establece default para nuevos contextos. Un contexto existente conserva su pin hasta actualización explícita autorizada con diff/impacto, compatibilidad y preservación de overrides. Q enviada/aceptada, R publicada y ProductionRelease nunca se reescriben. Cambios técnicos invalidan cálculos vigentes pertinentes y requieren el proceso canónico; no emitir Q/R por cada edición ni retargetear una liberación anterior.

Rebase utiliza old base + nuevo upstream + intención de fábrica, seguido de validación. Conflictos incluyen dependencias semánticas entre campos diferentes, no sólo igualdad de paths: por ejemplo, nuevo espesor frente a antigua profundidad de receta. Un candidato incompatible no activa ni borra personalización; se mantiene el release anterior. Proyectos legacy sin procedencia exacta se marcan como tal, sin fabricar una versión histórica.

## M1. CNC y DXF: autoridad y evidencia separadas

#351 conserva perfiles/capacidades/adapters; #503 el workspace de evidencia/artefactos; #591 la selección exacta por operación. No duplicarlos en #875. Cada requisito debe tener herramienta, acceso, cara, rango y montaje soportados. Lo no soportado bloquea esa salida o usa otra ruta explícita validada; nunca desaparece.

#676 usa [contrato de proyección e integridad DXF](../manufacturing/dxf-cut-plan-projection.md). Su convención es del formato, no una preferencia de construcción de fábrica ni prueba de giro físico histórico. Círculos de canto y vista posterior por pieza no constituyen programas universales de doble cara.

Distinguir motor numérico, serialización estructural, ejecución host y lectura física. La compatibilidad requiere combinación exacta de máquina/controlador/software/versiones, herramientas, fijación/montaje y evidence pack. Una librería de herrajes válida, archivo que abre o pruebas verdes no homologa una CNC.

## E1. Issues, dependencias y secuencia de entrega

| Owner | Entrega | Dependencia / frontera |
|---|---|---|
| #772 | Identidad/release/pinning exacto | Autoridades existentes; no copiar catálogo |
| #773 | Publisher/manifiesto inmutable | #772 |
| #775 | Política tipada de fábrica en overlay, permisos, rebase y API | #772+#773; no implementar otro editor/motor |
| #874 | Contactos/recetas/resultados por ocurrencia | Base #356; consume #775 para configuración persistida, no para empezar geometría pura |
| #875 | Config de fábrica y componentes React | Contratos efectivos de #775+#874 para capacidad expuesta; reutilizar #443/#496/#497 |
| #774 | Distribución local exacta SketchUp | #773; necesaria para ese tramo final, no para empezar UI web/backend |
| #784 | Defaults de Design/Inspector | Ámbito separado; consume capacidades autorizadas |
| #676 | Proyección DXF e integridad de resolución | Independiente del programa completo de bibliotecas |
| #354 | Evidencia integrada A/B, host, release y salida | Consume entregas aplicables; no bloquea sus tests unitarios por circularidad |
| #351/#503/#591 y #348/#352/#353 | Máquinas, selección y evidencia | Prerrequisitos vigentes, sin asumir soporte por marca |
| #873 | Diagnóstico de save/reopen del host | Carril separado; no bloquea diseño/motor offline ni se da por resuelto |

Primer trabajo paralelo seguro: terminar #676 en su rama reservada; #873 conserva su writer/host. Este documento y sus issues son el handoff de planificación, no un tercer writer sobre esas ramas.

Después de revalidar approvals y bases: #772 → #773 → #775; #874 puede desarrollar primero su núcleo puro con fixtures y revisión de perfiles, sin guardar preferencias ficticias. #875 integra una vertical contra ambos contratos. #774 y la prueba host completan la distribución cuando corresponda; la homologación física sigue independiente. No esperar marketplace/forks/editor universal para estas entregas ni saltar los prerrequisitos persistentes.

#874 puede dividir J1 contactos/una receta, J2 patrones/variantes y J3 integración en PRs coherentes; #875 puede dividir Config y editor conservando una sola autoridad. Tests viajan con comportamiento; no cierre completo con sólo interfaces. Una dependencia ausente deja BLOCKED el tramo afectado, no se transforma en PASS ni habilita un store temporal.

## E2. Matriz de aceptación reproducible

| ID | Caso y aserción | Owner / prueba |
|---|---|---|
| AC01 | A y B comparten IDs Standard; cuatro/cinco fijaciones; datos de B y Standard intactos | #775/#875, API+PostgreSQL+browser |
| AC02 | Otro usuario de A comparte política; acceso indebido A→B negado también por SQL runtime | #775/#875, permisos/RLS |
| AC03 | Override de componente persiste; restaurar elimina override; no cambia otra ocurrencia | #875+#874 |
| AC04 | Piso/costados con profundidades desiguales y retranqueos generan pares alineados en contacto útil | #874, fixture numérica independiente |
| AC05 | Manguete y variantes de respaldo/entrepaño respetan construcción; vecinos sin relación no perforan | #874 |
| AC06 | Dos copias comparten definición pero no IDs; mover/eliminar/duplicar conserva lo no relacionado | #874+#354, dominio y host aparte |
| AC07 | Cantidad imposible, colisión de esquina, perfil faltante o contacto ambiguo bloquean | #874 |
| AC08 | Cambio de receta modifica operaciones/consumo sin duplicar BOM; sin maquinado válido no es fallo | #874 |
| AC09 | Activación v2 no altera Q/R/release v1; actualización editable explícita conserva excepciones | #775/#875+#354 |
| AC10 | Dos editores, retry, respuesta perdida y cambio de fábrica no pierden ni filtran datos | #775/#875 |
| AC11 | Rebase conserva cambios no conflictivos; conflicto semántico no activa candidato | #775 |
| AC12 | Config y editor llegan al mismo resultado efectivo; formulario sin consumo real no pasa | #875, navegador real |
| AC13 | Giro DXF conserva entidades/coordenadas; BOM secundario fallido no permite descarga | #676 |
| AC14 | Reopen conserva estado exacto; detector distingue invariante rota de causa no demostrada | #873+#354 |
| AC15 | Capacidad/adapter no soportado bloquea, evidence pack identifica receptor exacto | #351/#503/#354 |

Cada evidencia registra commit/base, schema/datos/receta, resultado esperado/real y PASS/FAIL/BLOCKED/NOT_RUN. Inyección controlada demuestra el detector, no reproduce automáticamente un fallo natural. Goldens se cambian con explicación semántica y aserciones independientes. Tests JS no son navegador real; stubs Ruby no son TestUp; archivo abierto no es readback físico.

## E3. Handoff y definición de terminado

Antes de empezar, el nuevo agente identifica issue/alcance, base, escritor/reservas, fuentes aplicables y primera aserción fallida. Al terminar entrega HEAD/base, PR/diff, aceptación cubierta y restante, evidencia por capa y revisión independiente. No necesita esta conversación ni reconstruir memorias privadas.

Pendientes que debe resolver con fuentes concretas: perfiles técnicos de herrajes elegidos y límites; estado integrado de releases/API; correspondencia histórica cuando existe; dossier de CNC y montajes. Son entradas pendientes, no valores por adivinar. La definición de tablas/nombres finales sigue el código actual; la propiedad, precedencia y aislamiento aquí fijados no son opcionales.

El resultado funcional se considera completo cuando un cliente autorizado configura A en Config, personaliza/restaura un componente, obtiene maquinados/consumos correctos sin copiar Standard, demuestra B aislada e historia inmutable y entrega evidencia de todas las capas que afirme soportar. La publicación de esta especificación sólo completa la preparación documental.
