# Arquitectura — Contrato de calidad

> Los agentes revisores evalúan código contra este archivo.
> Si un criterio no está aquí, no es un requisito de arquitectura.
>
> **Actualizado 2026-08-24:** este contrato conserva la arquitectura original de
> paquetes y añade ownership por bounded context para el producto operativo actual.

---

## 1. Invariantes

1. **Una sola verdad por concern.** UI deriva; domain/backend decide.
2. **Datos reales antes que proxies.** Si no existe evidencia, se etiqueta o no se muestra.
3. **Estado comercial, operacional y físico no se colapsa en un único enum.**
4. **Pieza y mueble no son la misma unidad física.** Corte/CNC/Enchape trabajan piezas;
   Armado+ trabaja unidades/bultos.
5. **Lifecycle auditable.** Aprobaciones, release, stale y cambios relevantes dejan rastro.
6. **Integraciones no contaminan el dominio neutral.** Adaptadores serializan; no inventan verdad.
7. **UI no duplica cálculo industrial.** React/Ruby presentan intención y feedback.
8. **Revisión explícita.** Producción siempre debe poder responder qué revisión/BOM está ejecutando.
9. **Authoring no es manufacturing truth.** Proyectar y SketchUp capturan intención;
   Muebles resuelve, valida y libera el resultado industrial.
10. **Relationships before coordinates.** Relaciones constructivas/joints usan stable IDs,
    roles y anchors; Muebles resuelve derived placements/drilling. CNC coordinates son output.

---

## 2. Capas y ownership

### UI / authoring clients

Responsabilidades:

- interacción y presentación;
- selección, transforms y edición de parámetros;
- captura de semantic metadata;
- envío de authoring intent;
- presentación de validation/resolved feedback.

No poseen:

- BOM industrial;
- joint/relationship resolution;
- drilling rules;
- nesting/kerf;
- lifecycle/release decisions;
- machine postprocessing.

### Domain / backend

Responsabilidades:

- reglas de negocio;
- catálogo y constraints;
- parametric relationships/joints;
- BOM y parts;
- hardware placements y machining profiles;
- drilling resolution;
- revision/fingerprint/stale;
- preflight;
- production release;
- machine capability negotiation.

### Machine adapters

Responsabilidades:

- declarar formato/capabilities;
- serializar manufacturing data resuelta;
- producir artifacts específicos;
- mantener version/provenance.

Nunca recalculan BOM, joints o drilling.

---

## 3. Authoring clients externos

Para Muebles for SketchUp rige:

> **SketchUp owns authoring/interaction; Muebles owns manufacturing truth.**

La extensión puede capturar interaction state, transforms, parameters, stable IDs,
semantic metadata, `PartRelationship`/joint intent, relationship anchors y manual
`HardwarePlacement` intent.

No implementa BOM, relationship/joint resolution, derived placement rules, drilling,
nesting, kerf, stale/release gates ni postprocessing.

Muebles valida el
[`SketchUp Manufacturing Contract`](sketchup-manufacturing-contract.md) y conserva la
autoridad descrita en el
[`ADR-0001`](adr/0001-sketchup-authoring-muebles-manufacturing-truth.md).

El caso canónico se formaliza en #356:

```text
move shelf
→ relationship changes
→ derived machining changes
→ unrelated machining remains unchanged
→ fingerprint/revision changes when applicable
```

Y:

```text
move hinge
→ HardwarePlacement changes
→ hinge machining changes
→ shelf machining remains unchanged
```

Un machine adapter serializa DTOs resueltos y capabilities declaradas; no inventa reglas
de ingeniería.

---

## 4. Revision y release

Todo output fabricable debe poder vincularse a:

- `projectId`;
- `designRevisionId`;
- `bomFingerprint`;
- machine/profile version cuando aplique.

Cambios posteriores a `ProductionRelease` que alteren manufacturing truth vuelven stale
el output anterior. Nunca se sobrescribe silenciosamente una revisión ya liberada.

---

## 5. Producción física

La unidad física correcta es obligatoria:

```text
Cut → CNC → Edge              = PartInstance / PartExecution
Assembly → QC → Pack → Load   = ModuleUnitExecution / package
```

Armado es el gate de convergencia entre piezas y unidades.

Ver `docs/production-flow-v2.md`.

---

## 6. TS vs Go

Cuando una regla exista en TypeScript y Go:

- debe existir intención explícita de paridad;
- fixtures/goldens deben cubrir el mismo comportamiento;
- cambios no pueden introducir fórmulas silenciosamente divergentes.

Las reglas que sólo pertenecen a un boundary no deben duplicarse por comodidad.

---

## 7. Machine integration

El dominio industrial neutral no contiene conditionals por cliente/marca.

`MachineProfile` declara capabilities y version. `PostprocessorAdapter` consume
manufacturing data resuelta. Unknown capability falla seguro.

Compatibilidad requiere evidence para la combinación exacta de machine/controller/software
version; abrir un archivo no es suficiente.

---

## 8. Data truth

Toda UI operacional debe distinguir:

- actual;
- estimated;
- forecast;
- proxy.

No presentar proxies como hechos.

---

## 9. Fuentes relacionadas

- UX: `docs/design.md` + `docs/operational-ux.md`;
- producto: `docs/prd-v2.md`;
- plan: `docs/operational-core-v1.md`;
- programa SketchUp: `docs/sketchup-muebles-strategy.md`;
- boundary SketchUp/Muebles:
  `docs/adr/0001-sketchup-authoring-muebles-manufacturing-truth.md`;
- contract conceptual: `docs/sketchup-manufacturing-contract.md`;
- relationships/joints: #356;
- lifecycle/release: `docs/project-lifecycle.md`;
- producción física: `docs/production-flow-v2.md`.

---

## 10. Reglas de review para agentes

- no inventar KPIs;
- no ejecutar producción contra una revisión stale sin override explícito;
- no duplicar reglas TS/Go sin fixtures de paridad;
- no mover BOM, relationship/joint resolution, drilling, preflight o postprocessing a Ruby/SketchUp;
- no persistir derived CNC coordinates como truth primaria de una relación;
- no permitir que un adapter reinterprete manufacturing truth;
- no construir un ERP financiero completo ni CAD libre dentro de este core.
