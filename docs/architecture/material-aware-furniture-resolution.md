# Resolución de muebles consciente del material

> **Estado:** CANÓNICO
> **Fecha:** 2026-08-26
> **Ámbito:** Engineering, Design / Proyectar 3D, backend Go y Granete for SketchUp
> **Programa:** [#401](https://github.com/tiagofur/muebleria/issues/401)
> **Entrega documental:** [#409](https://github.com/tiagofur/muebleria/issues/409)
> **Slices:** [#402](https://github.com/tiagofur/muebleria/issues/402) · [#403](https://github.com/tiagofur/muebleria/issues/403) · [#404](https://github.com/tiagofur/muebleria/issues/404) · [#405](https://github.com/tiagofur/muebleria/issues/405)

## Decisión

Para toda pieza de tablero con un `MaterialBoard` seleccionado, el espesor efectivo
`T` es `MaterialBoard.thicknessMm`. Esa decisión ocurre **antes** de cualquier fórmula
de tamaño o posición. El espesor nominal del componente sólo puede usarse cuando no
existe un binding de material aplicable; nunca puede ganar sobre una elección válida.

```text
OptionChoices efectivos
  -> material-binding role del componente
  -> MaterialBoard activo seleccionado
  -> effective T
  -> fórmulas geométricas
  -> fórmulas espaciales y pose
  -> anchors y AABB
  -> DTO resuelto
  -> render/adaptador
```

Cambiar un acabado no significa repintar una caja existente. Significa cambiar la
intención del rol, volver a resolver el mueble completo y reconstruir atómicamente
todos y sólo los componentes que dependen de ese rol.

## Invariantes no negociables

1. Granete resuelve la verdad geométrica y de manufactura; Ruby, React y otros
   clientes sólo capturan intención o renderizan DTOs resueltos.
2. Una elección válida de `MaterialBoard` determina `T`, la dimensión local de
   espesor y toda fórmula que consuma `T` o `H` como espesor de pieza.
3. El mismo `T` alimenta geometría, pose por defecto, fórmulas espaciales, anchors de
   herrajes, AABB y el DTO final. No se permite corregir sólo `ThicknessMm` al final.
4. La dimensión exterior solicitada del mueble permanece estable salvo una fórmula
   explícita; cambian las cotas internas y dependientes.
5. La dependencia de acabado se expresa por un material-binding role, no por nombre
   de componente, placement, color, textura, fabricante ni material actualmente
   pintado.
6. Estructura, componentes propios del módulo y componentes dentro de agregados usan
   exactamente el mismo contrato.
7. Un error de resolución ocurre antes de mutar un modelo cliente. Un error durante
   el rebuild aborta la única operación y restaura el estado anterior.
8. Toda regla duplicada entre TypeScript y Go necesita fixture de contrato; la
   inspección manual no demuestra paridad.

## Binding semántico de material

### Placement no es material-binding role

`placement` responde **qué pieza es y dónde se ubica**. El material-binding role
responde **qué elección de tablero sigue**.

```text
left_side, right_side, base, top, shelf  -> BODY
normal_door, drawer_front                -> FRONT
back_panel                               -> BACK
plinth_board                             -> PLINTH o ZOCLO legado
```

Los códigos recomendados (`BODY`, `FRONT`, `BACK`, `PLINTH`) son convenciones, no un
enum cerrado. Cada taller puede definir roles adicionales mediante `OptionGroup`; la
etiqueta visible proviene de `OptionGroup.name`.

### Contrato transitorio de `optionRoles`

La persistencia actual conserva `Component.optionRoles` como array, pero los motores
TypeScript y Go sólo consumen `optionRoles[0]`, mientras la UI y varias validaciones
recorren todos sus elementos. Para no fingir una semántica que hoy no existe:

- `optionRoles[0]` es el **único material-binding role primario** del componente;
- un componente de tablero nuevo debe declarar como máximo un role de grupo
  `kind="board"`, ubicado en `[0]`;
- un segundo role de tablero es una configuración ambigua: el editor debe impedir
  crearla y la validación debe alertarla o hacer fallar el flujo autoritativo;
- catálogos legados con múltiples roles se diagnostican de forma explícita; no se
  migran ni se reinterpretan automáticamente;
- los roles adicionales no se consideran bindings de material hasta que una evolución
  de dominio defina precedencia, composición y compatibilidad multi-role.

Esta restricción no cambia el formato persistido en este programa. [#403](https://github.com/tiagofur/muebleria/issues/403)
debe alinear authoring, validación, proyección y motores con esta semántica.

### Lookup directo y aliases

El lookup canónico aplica esta precedencia:

1. elección directa para el role persistido;
2. si no existe, un alias legado permitido;
3. si tampoco existe, no hay elección aplicable.

| Role persistido | Fallback de elección | Regla |
|---|---|---|
| `ZOCLO` | `FRENTE` | sólo cuando no existe elección directa de `ZOCLO` |
| `PUERTA` | `FRENTE` | sólo cuando no existe elección directa de `PUERTA` |
| `PUERTA_*` | `FRENTE` | aplica a cualquier código con ese prefijo |
| `FRENTE_CAJON` | `FRENTE` | sólo cuando no existe elección directa |
| cualquier otro | ninguno | el código custom se conserva sin inferencias |

El alias resuelve una elección; no reescribe el role persistido ni une componentes por
apariencia. TypeScript ya implementa estas reglas en `resolveBoardOptionChoiceId`; Go
hace lookup directo y está en drift. [#403](https://github.com/tiagofur/muebleria/issues/403)
debe centralizar o replicar el contrato con pruebas de paridad.

## Resolución paso a paso

### 1. Configuración efectiva

Combinar defaults de proyecto y overrides del mueble mediante
`effectiveOptionChoices()`. Un override explícito gana; eliminar la clave vuelve a
heredar. Mientras el binding Project/Design no sea durable, un default de “toda la
obra” en SketchUp es sólo intención de sesión, no verdad persistida.

### 2. Role y material

Leer exclusivamente el material-binding role primario. Resolver elección directa y,
si corresponde, alias. La elección debe apuntar a un `MaterialBoard` existente, activo
y con `thicknessMm > 0`.

### 3. Espesor efectivo

```text
selected active MaterialBoard.thicknessMm
  > nominal component thickness, sólo sin binding aplicable
  > fallback legado explícito, sólo para preview no autoritativo
```

Si existe un binding de tablero pero falta una elección requerida, el flujo
autoritativo falla; no degrada silenciosamente al espesor nominal. Una elección
presente pero desconocida, inactiva o dimensionalmente inválida también falla.

### 4. Geometría y espacio

Con `T` resuelto, evaluar en este orden:

1. fórmulas de largo/ancho con dimensiones padre y `T`;
2. dimensiones locales de la pieza;
3. fórmulas espaciales y pose por defecto con ese mismo `T`;
4. rotación;
5. anchors de herrajes sobre la geometría final;
6. AABB y `translationMm`;
7. `LayoutComponent`/BOM/DTO.

`ThicknessMm` del DTO y el eje de espesor en `DimensionsMm` deben representar el mismo
valor que participó en las fórmulas. Resolver el material después de AABB es demasiado
tarde.

## Propagación de cambios de acabado

Una elección se propaga por dependencia semántica, no por búsqueda visual:

```text
change OptionChoices[FRONT]
  -> recompute effective choices
  -> resolve the full furniture definition
  -> every normal/agregado component whose binding depends on FRONT
  -> new T, geometry, pose, anchors, AABB and material metadata
  -> atomic rebuild
```

La elección directa conserva precedencia sobre el alias. Por ejemplo, un componente
`PUERTA` con elección directa propia no depende de `FRENTE`; sin elección directa,
`PUERTA` sí depende del fallback `FRENTE`.

El resolver puede recalcular el mueble completo —es la opción segura actual— aunque el
conjunto semánticamente afectado sea menor. No se admite un parche “paint-only” ni
actualizar sólo la primera pieza encontrada.

## Rebuild atómico en SketchUp

El cliente solicita y valida un layout completo **antes** de tocar entidades. En una
actualización exitosa:

1. conserva `instanceRef` y el transform exterior del grupo del mueble;
2. inicia una sola operación de SketchUp;
3. reemplaza los hijos administrados con `components[]` y `hardware[]` del DTO;
4. escribe metadata de intención únicamente para el estado reconstruido;
5. confirma la operación.

Si la resolución remota falla, el builder no se ejecuta. Si el render o la escritura de
metadata falla después de iniciar la operación, se aborta y debe restaurarse la
geometría/metadata anterior. Los IDs locales de hijos pueden cambiar; la identidad del
mueble y su posición exterior no.

El flujo actual ya resuelve antes de llamar al builder y usa una operación para
`clear! + rebuild`, pero [#404](https://github.com/tiagofur/muebleria/issues/404) debe
demostrar rollback real, propagación uno-a-muchos, anchors e identidad mediante tests.

## Fallbacks, offline y errores

| Situación | Resultado autoritativo | Preview/fallback permitido |
|---|---|---|
| binding y material activo seleccionado | usar `MaterialBoard.thicknessMm` | mismo resultado |
| sin binding de tablero aplicable | usar espesor nominal documentado | permitido |
| binding requerido sin elección efectiva | error accionable | sólo representación marcada no autoritativa |
| material seleccionado desconocido | error; no DTO parcial | ninguno silencioso |
| material seleccionado inactivo | error; no DTO parcial | ninguno silencioso |
| `thicknessMm <= 0` | error de catálogo | ninguno silencioso |
| múltiples board roles | error/diagnóstico de authoring | no elegir uno silenciosamente |
| catálogo remoto no disponible | no hay manufacturing truth nueva | geometría genérica/local explícitamente no autoritativa |

Un layout offline o genérico sirve para continuidad de autoría, no para BOM, cotización,
release, CNC ni prueba de paridad. Debe conservar su provenance y nunca reemplazar en
silencio un error del catálogo remoto.

## Estado actual y deuda conocida

| Capa | Estado actual | Brecha contra este contrato | Issue |
|---|---|---|---|
| TypeScript BOM (`packages/domain/src/engine/bom.ts`) | resuelve material elegido y `T` antes de fórmulas/pose; usa `optionRoles[0]`; soporta aliases | falta formalizar la unicidad del binding y mantener paridad ejecutable | [#403](https://github.com/tiagofur/muebleria/issues/403), [#405](https://github.com/tiagofur/muebleria/issues/405) |
| Go BOM (`backend-go/internal/domain/engine/resolve.go`) | expande con `Component.ThicknessMm`; usa `[0]` | el defecto también existe aquí, no sólo en layout | [#402](https://github.com/tiagofur/muebleria/issues/402) |
| Go layout (`backend-go/internal/domain/engine/layout.go`) | calcula fórmulas, pose y AABB con espesor nominal; adjunta material después; lookup directo | debe resolver material/aliases antes de geometría y usar un solo `T` | [#402](https://github.com/tiagofur/muebleria/issues/402), [#403](https://github.com/tiagofur/muebleria/issues/403) |
| Ruby SketchUp | consume `dimensionsMm`, recorre todos los componentes y hace `clear! + rebuild` dentro de una operación | debe probar rollback, preservación de identidad y propagación completa; nunca calcular `T` localmente | [#404](https://github.com/tiagofur/muebleria/issues/404) |

Por lo tanto, “Go refleja la semántica TS” es una meta contractual, no una afirmación
válida sobre los bytes actuales hasta cerrar las regresiones.

## Matriz de verificación

El fixture de [#405](https://github.com/tiagofur/muebleria/issues/405) debe usar espesores
nominales deliberadamente distintos de los materiales seleccionados e incluir estructura,
módulo, agregado y herraje anclado.

| Invariante | TypeScript | Go BOM | Go layout/API | Ruby/SketchUp |
|---|---|---|---|---|
| material 16 gana a nominal 15/18 | unit/contract | unit | unit + endpoint | consume 16 sin reescribir |
| `PW - 2*T` usa `T=16` | fórmula | fórmula | fórmula | compara DTO construido |
| pose `PW - T` y AABB usan el mismo `T` | spatial fixture | semántica equivalente | pose + AABB | transform/dimensiones |
| `BODY=16`, `FRONT=18`, `BACK=6` quedan aislados | role fixture | role fixture | role fixture | grupos/materiales |
| puerta y frentes de cajón agregado siguen `FRONT` | alias/binding | binding | binding | rebuild de todos |
| unknown/inactive falla cerrado | error | error | HTTP/engine error | modelo previo intacto |
| cambio 18→16 conserva identidad/transform exterior | n/a | n/a | DTO completo | update + undo/rollback |
| aliases directos y fallback coinciden | resolver | parity | parity | elección reenviada |
| múltiples board roles no pasan silenciosos | validation | validation | validation | bloqueo mostrado |

La prueba debe fallar contra el comportamiento Go previo donde
`Component.ThicknessMm` gana. Usar materiales y componentes todos a 18 mm no demuestra
este contrato.

## Fuera de alcance

- implementar el cambio completo de motor en este documento;
- calcular espesor, fórmulas, anchors o BOM en Ruby/React;
- agregar un campo `materialRole` paralelo sin demostrar una incompatibilidad real;
- migrar automáticamente roles históricos ambiguos;
- inferir bindings por placement, nombre, color o textura;
- implementar persistencia “toda la obra” antes del Digital Thread de [#384](https://github.com/tiagofur/muebleria/issues/384);
- optimizar con parches diferenciales de geometría antes de probar el rebuild completo;
- ampliar aliases fuera de la tabla sin decisión y fixture explícitos.

## Plan y dependencias

```text
Contrato documental (#409, tracks #401)
  -> #402 effective T en Go BOM + layout
  -> #403 binding único, aliases y validación
#402 + #403
  -> #404 re-resolve y rebuild atómico en SketchUp
#402 + #403 + #404
  -> #405 fixture/regresión TS <-> Go <-> SketchUp
```

Documentos relacionados:

- [Smart Furniture Engine](smart-furniture-engine.md)
- [Modelo de Interacción SketchUp](sketchup-interaction-model.md)
- [Selector de Opciones de Catálogo](catalog-option-selector.md)
- [Biblioteca Paramétrica Universal](parametric-furniture-library.md)
- [Modelo de Dominio](domain-model.md)
- [SketchUp Manufacturing Contract](../sketchup-manufacturing-contract.md)
