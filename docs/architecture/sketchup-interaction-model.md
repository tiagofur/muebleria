# Modelo de Interacción SketchUp + Granete

> **Estado:** CANÓNICO  
> **Fecha:** 2026-08-26  
> **ADR relacionados:** [ADR-0001](../adr/0001-sketchup-manufacturing-ownership.md), [ADR-0002](../adr/0002-parametric-furniture-library-architecture.md), [ADR-0004](../adr/0004-sketchup-native-component-entity-model.md)  
> **Host representation:** [sketchup-native-entity-model.md](sketchup-native-entity-model.md)  
> **Resolución Material-Aware:** [material-aware-furniture-resolution.md](material-aware-furniture-resolution.md)  
> **Digital Thread:** [project-design-digital-thread.md](project-design-digital-thread.md)  
> **Invariante central:** **SketchUp owns authoring/interaction; Granete owns business/manufacturing truth.**

---

## 1. Propósito

Este documento define el comportamiento de interacción de **Granete for SketchUp**:

- biblioteca/configuración de muebles;
- inserción y placement;
- selección e inspector contextual;
- cambios paramétricos y materiales;
- drill-down a piezas/agregados/herrajes;
- round-trip de authoring intent;
- atomicidad/undo;
- feedback de preflight;
- relación entre el viewport de SketchUp y el modelo industrial de Granete.

No define BOM, drilling/machining, reglas de espesor, identidad empresarial ni lifecycle de DesignRevision/ProductionRelease. Esos contratos pertenecen a sus autoridades específicas.

---

## 2. Modelo mental canónico

```text
Biblioteca de Muebles
        ↓ insertar/configurar
Canvas 3D de SketchUp
        ↓ seleccionar
Inspector Contextual
        ↓ cambiar authoring intent
Granete resolve/validate
        ↓ resolved layout/feedback
Rebuild in-place del mueble gestionado
```

El usuario percibe un único objeto de trabajo —el mueble— pero puede profundizar a componentes cuando la intención lo requiere.

Reglas UX:

- selección principal por mueble;
- drill-down explícito a pieza/agregado/herraje;
- mover/rotar el mueble en SketchUp es interacción de autoría;
- parámetros productivos se cambian mediante intención semántica, no deformando geometría;
- cambios relevantes son undoable como una acción coherente;
- errores no destruyen el último estado válido.

---

## 3. Current vs target host representation

### 3.1 Runtime actual [CURRENT]

Desde #415 el `FurnitureBuilder` materializa la jerarquía nativa:

```text
Furniture Sketchup::ComponentInstance (definición aislada por instancia)
├── Board/Part Sketchup::ComponentInstance (geometría local en origen)
├── Board/Part Sketchup::ComponentInstance
└── Hardware Sketchup::ComponentInstance (asset o fallback)
```

El renderer Group + AABB pre-#415 es representación legacy: los `.skp` que la
llevan se migran explícitamente (#416) y un update contra un Group legacy
falla cerrado con puntero a #416.

### 3.2 Arquitectura aprobada [TARGET]

La autoridad es [sketchup-native-entity-model.md](sketchup-native-entity-model.md) y ADR-0004:

```text
Furniture Sketchup::ComponentInstance
├── Physical Part Sketchup::ComponentInstance
├── Physical Part Sketchup::ComponentInstance
├── Hardware Sketchup::ComponentInstance
└── optional semantic Aggregate/Subassembly ComponentInstance
    └── managed Part/Hardware ComponentInstances
```

No existe una “jerarquía estricta de tres niveles”. El nesting es **semántico**. Un nivel intermedio sólo existe cuando representa un agregado/subassembly real que necesita identidad, selección, configuración o movimiento propio.

### 3.3 Regla de transición (cerrada con #415)

- el renderer nativo es CURRENT (#415); el renderer Group es legacy y sólo
  vuelve a aparecer vía migración #416 o adopción #397;
- ninguna feature nueva puede elevar Groups/AABB boxes a autoridad de largo plazo;
- #389, #391 y #404 apuntan al modelo nativo; no se crean caminos finales
  paralelos basados en Groups.

---

## 4. Fronteras de responsabilidad

| Responsabilidad | SketchUp / Ruby / WebView | Granete domain/backend |
|---|---|---|
| Viewport/cámara/selección | owns | no |
| Move/rotate del mueble | captura/aplica interacción | persiste/reconcilia cuando corresponda |
| Render host | crea/aplica entidades nativas y materiales visuales | entrega layout resuelto |
| Espesor/material efectivo | no calcula | owns |
| Fórmulas paramétricas | no calcula | owns |
| Placement interno de piezas | aplica transform resuelto | owns resolution |
| Stable business identity | almacena/reproduce metadata | owns creación/validación |
| BOM/cut/edge/CNC | no | owns |
| Hardware/machining derivados | renderiza feedback | owns |
| Preflight industrial | muestra resultado | owns |
| Undo de edición host | owns operación SketchUp | — |

Ruby puede crear local geometry, `ComponentDefinition`/`ComponentInstance`, aplicar transforms/materiales y leer/escribir metadata namespaced.

Ruby no puede inferir manufacturing thickness, re-evaluar fórmulas, inferir board rotation por role/name/AABB, generar drilling desde geometría visible, usar non-uniform scale como parametric resize ni escanear geometría arbitraria como BOM autoritativo.

---

## 5. Identidad y selección

### 5.1 Business identity

El `FurnitureInstance` del Project es la identidad física estable del mueble. SketchUp guarda/reproduce esa identidad en metadata, pero no la inventa a partir de `persistent_id`, `entityID`, ComponentDefinition GUID, nombre, geometría o posición.

### 5.2 Selección primaria

Un top-level managed Furniture ComponentInstance es la unidad normal para mover/rotar, abrir inspector, cambiar dimensiones/materiales/configuración y sincronizar authoring intent.

### 5.3 Drill-down

Nested managed ComponentInstances permiten seleccionar/inspeccionar una entidad concreta: lateral, entrepaño, puerta, frente de cajón, agregado o herraje.

El `SelectionObserver` debe resolver el InstancePath/ownership hasta encontrar el mueble gestionado y la metadata del elemento seleccionado.

Renombrar una entidad en Outliner no cambia su Granete ID.

---

## 6. Inserción de muebles

### 6.1 Catálogo

`RemoteCatalogProvider` consulta el catálogo real del taller mediante `GET /api/furniture/definitions`. La extensión no sustituye silenciosamente el catálogo remoto por muebles genéricos en producción.

### 6.2 Layout resuelto

```text
FurnitureDefinition + parameters + materialChoices
        ↓
GET /api/furniture/definitions/{definitionId}/layout
        ↓
Granete resolves composition
        ↓
resolved components + hardware
        ↓
Ruby materializes SketchUp host representation
```

El DTO publica el contrato #414 completo (local geometry + transform autoritativo + AABB derivado como compatibilidad); desde #415 el renderer nativo lo consume vía `resolved_native_layout`.

### 6.3 Placement exterior

El top-level furniture transform representa el placement exterior del usuario en SketchUp. Los transforms internos de piezas son relativos al mueble/subassembly y se resuelven en Granete.

Cambiar dimensión/material no debe llevar el mueble de regreso al origen ni borrar su rotación global.

---

## 7. Resolución local de pieza y ejes

Para el target nativo:

```text
Granete resolved local board geometry
+
Granete resolved local→furniture transform
        ↓
Ruby creates local ComponentDefinition geometry
+
applies ComponentInstance transform
```

Convención actual del engine:

```text
local X = widthMm
local Y = thicknessMm
local Z = lengthMm
```

Un AABB world-space no sustituye ese frame local. #414 es prerequisite del renderer nativo porque actualmente la rotación existe en el resolver interno pero no viaja en el transform público del layout.

Desde #414 [CURRENT], el layout resuelto publica por pieza el transform local→furniture autoritativo (`localTransform`: base ortonormal diestra + traslación) junto con el marker `transformContract: granete.local-basis.v1`; el AABB legacy se deriva de ese transform y queda como compatibilidad/preview. El parser Ruby (`library/layout_contract.rb`, vía `resolved_native_layout`) valida el contrato y falla seguro ante contratos desconocidos/ausentes o bases inválidas — nunca infiere orientación. Desde #415 [CURRENT] el renderer nativo construye cada pieza como ComponentInstance con `Geom::Transformation.axes(translationMm, basis)` y geometría local en origen; el AABB del wire es sólo preview/compat.

---

## 8. Materiales y acabados

La autoridad completa está en [material-aware-furniture-resolution.md](material-aware-furniture-resolution.md).

### 8.1 Captura de elección

```text
materialChoices = {
  BODY: materialId,
  FRONT: materialId,
  BACK: materialId
}
```

La propagación se decide por material-binding role; nunca por nombre/color/textura actual.

### 8.2 Orden obligatorio

```text
material choice
→ MaterialBoard
→ effective thickness T
→ formulas / dimensions / placement
→ authoritative part transform
→ SketchUp rendering
```

### 8.3 Rebuild

#404 [CURRENT] implementa:

```text
change material role
→ request fresh full layout
→ validate
→ rebuild/rebind native managed hierarchy
→ persist accepted metadata
```

La implementación fusiona la elección cambiada con la intención persistida,
exige un `NativeLayout` válido para cambios materiales, aísla una definición
top-level compartida antes de mutarla y confirma geometry + metadata en una sola
operación. Un fallo conserva el último estado válido. #404 depende de #415 para
no consolidar el Group renderer como target final.

### 8.4 Scope

`this furniture` es un override del mueble. `toda la obra` usa `project defaults + item overrides`; la persistencia durable sigue el Digital Thread y un default temporal de sesión no se presenta como verdad persistida.

---

## 9. Edición paramétrica in-place

Correcto:

```text
change widthMm / shelfCount / model / material
→ update authoring intent
→ Granete resolve
→ rebuild managed children
→ keep FurnitureInstance identity + world transform
```

Incorrecto:

```text
SketchUp non-uniform scale
→ assume new manufacturing dimensions
```

Una herramienta gráfica puede traducir un gesto a un parámetro válido, pero el gesto debe convertirse en authoring intent antes de ser manufacturing truth.

---

## 10. Atomicidad y Undo

### Inserción

```text
start operation
→ create valid managed hierarchy
→ write metadata
→ commit
```

Un error aborta la operación completa.

### Update/rebuild

```text
resolve + validate first
→ prepare definitions/assets
→ start SketchUp operation
→ replace/rebind child managed hierarchy
→ write accepted metadata
→ commit
```

Si falla, `abort` deja el mueble válido anterior intacto. Un cambio de material/parámetro debe aparecer como una sola acción de Undo.

---

## 11. ComponentDefinition lifecycle

La autoridad detallada es ADR-0004.

### Furniture

V1: top-level SketchUp ComponentDefinition única por Granete `FurnitureInstance`. Dos muebles provenientes de la misma `FurnitureDefinition` pueden divergir sin editarse mutuamente.

### Parts

Puede iniciarse con definition única por part instance. Sharing sólo es válido para definitions generadas inmutables con una `resolvedGeometrySignature` determinística.

Una pieza que cambia geometría se rebind/recrea; no se edita una shared definition usada por otra pieza/mueble.

---

## 12. Copy / Paste / Duplicate

Copiar un managed top-level Furniture ComponentInstance puede copiar temporalmente metadata host. Eso no convierte la copia en una segunda unidad válida con el mismo business ID.

#391 debe:

```text
copy detected
→ original keeps furnitureInstanceId
→ server allocates/validates new FurnitureInstance
→ copied host entity receives new ID
→ copied top-level definition is isolated
```

Mientras no se resuelva la duplicación, el objeto copiado no es publicable como estado válido.

---

## 13. Agregados y subassemblies

Un `Agregado` no obliga automáticamente a crear un wrapper SketchUp.

Crear subassembly ComponentInstance cuando tenga valor semántico real: selección/configuración/movimiento propios, stable authoring identity, relationships/anchors al aggregate o un asset compuesto que deba conservarse como unidad.

Si sólo agrupa piezas por implementación interna, no añadir nesting innecesario.

---

## 14. Hardware y assets

`AssetResolver` traduce `assetId` a caché local, bundle autorizado o recurso remoto permitido.

Hardware con asset `.skp` se instancia como ComponentInstance. Fallback visual generado sigue el mismo wrapper semántico del target nativo. Hardware cost-only sin preview válido no se materializa.

Los componentes/grupos internos de un asset no se convierten automáticamente en piezas productivas Granete.

---

## 15. Preflight

### Interactive/lightweight

La UI puede validar min/max/step, required choices, compatibilidad simple de catálogo y datos faltantes.

### Authoritative manufacturing preflight

Granete valida relaciones, machining/drilling, BOM/manufacturing completeness, revision/fingerprint, machine capabilities y stale/release gates. SketchUp muestra el resultado; no lo reemplaza.

---

## 16. Session y licencia

El plugin usa autenticación/licencia del usuario/taller para consumir catálogo/layout. No se incrustan credenciales en RBZ ni se usa un catálogo silencioso de producción cuando servidor/licencia bloquean el acceso.

Detalles de almacenamiento/transporte de sesión son implementación y pueden evolucionar sin cambiar este modelo de interacción.

---

## 17. Legacy Group models

El renderer Group legacy (pre-#415) puede haber generado modelos con metadata Granete válida. #416 migra esa representación al target nativo; hasta entonces, editarlos desde la extensión falla cerrado.

No confundir:

```text
representation migration (#416)
```

con:

```text
business adoption into Project/Design (#397)
```

Cambiar `Group` a `ComponentInstance` no crea por sí mismo un nuevo FurnitureInstance.

---

## 18. Digital Thread

- **#388 model binding:** `.skp` se vincula a Project/Design mediante metadata/contratos, no filename.
- **#389 Place existing Furniture:** crea la representación nativa #415 del FurnitureInstance existente.
- **#390 design-first insertion:** crea/obtiene Project FurnitureInstance antes de materializarlo.
- **#391 duplicate:** gestiona business identity del copy; no usa SU definition como identity.
- **#392 publish:** publica authoring state/manifests de entidades gestionadas; decoración/arquitectura arbitraria no entra al BOM.
- **#397 adopt existing SKP:** distingue native Granete entities, legacy Groups, unmanaged geometry y identity conflicts.

---

## 19. Third-party interoperability

Granete busca ser un buen ciudadano SketchUp: physical boards como solid ComponentInstances, local axes útiles, nombres legibles, materiales visibles y nesting semántico.

Pero:

```text
third-party cut list = convenience/compatibility
Granete BOM          = manufacturing authority
```

#417 documenta OpenCutList con versión y smoke real antes de prometer compatibilidad concreta.

---

## 20. Current implementation debts explícitas

Cerrados con evidencia (no reabrir como deuda):

- #402: Go usa selected `MaterialBoard.thicknessMm` antes de geometry;
- #403: binding/alias semantics alineadas TS/Go;
- #414: authoritative local part transform/orientation en layout;
- #415: Group renderer → native ComponentInstances;
- #404: material update re-resuelve y reconstruye el target nativo atómicamente.

Programas aún abiertos:

- #416: legacy Groups tienen migration path;
- #388/#389/#390/#391: Project-owned identity sustituye legacy local identity donde corresponda.

No documentar estos targets como “implemented” antes de evidencia/tests.

---

## 21. Verification

### Unit/contract

- catalog/layout parsing;
- semantic metadata;
- transform/local axes;
- material choices;
- selection/ownership;
- atomic abort;
- definition isolation.

### Real SketchUp host

Cuando cambia representación/interacción: insertar fixture, seleccionar furniture/part, mover/rotar, editar parámetro/material, Undo, save/reopen y revisar Outliner.

### Cross-runtime

Cuando una regla existe TS + Go: contract fixture/parity required; no declarar paridad por inspección manual.

### Third party

OpenCutList smoke pertenece a #417 y nunca sustituye las pruebas de BOM Granete.

---

## 22. Reglas finales

1. **SketchUp interaction, Granete truth.**
2. **El renderer Group legacy (pre-#415) no es el modelo canónico; el renderer nativo (#415) es el CURRENT.**
3. **Managed furniture + physical parts -> native ComponentInstances.**
4. **Semantic nesting, not fixed three-level wrappers.**
5. **Business IDs != SketchUp GUID/persistent IDs.**
6. **Local geometry + resolved transform; no AABB/role inference in Ruby.**
7. **Material resolution precedes geometry.**
8. **Regenerate/rebind; do not non-uniformly scale productive parts.**
9. **One user edit = coherent atomic/undoable operation.**
10. **Legacy migration, business adoption and third-party interoperability remain separate concerns.**

---

## Canonical references

- Native host representation: `sketchup-native-entity-model.md` + ADR-0004
- Material-aware resolution: `material-aware-furniture-resolution.md`
- Semantic domain: `domain-model.md`
- Parametric library: `parametric-furniture-library.md`
- Catalog selector: `catalog-option-selector.md`
- Manufacturing round-trip: `../sketchup-manufacturing-contract.md`
- Project/Design identity: `project-design-digital-thread.md` + ADR-0003
- Engine umbrella: `smart-furniture-engine.md`
- Verification: `../verification.md`
- Program tracking: #290, #384, #401, #413
