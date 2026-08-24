# ADR-0001 — SketchUp authoring, Muebles manufacturing truth

- **Status:** Accepted
- **Date:** 2026-08-24
- **Decision owners:** Product + Engineering
- **Program:** [SketchUp + Muebles](../sketchup-muebles-strategy.md)
- **Tracking:** [#290](https://github.com/tiagofur/muebleria/issues/290),
  [#344](https://github.com/tiagofur/muebleria/issues/344),
  [#356](https://github.com/tiagofur/muebleria/issues/356)

## Decision

> **SketchUp owns authoring/interaction; Muebles owns manufacturing truth.**

La extensión SketchUp captura intención de diseño, interacción, relaciones constructivas
y contexto visual. Muebles es la única autoridad para catálogo, relaciones/joints
resueltos, BOM, piezas, materiales, hardware, drilling, machining, revisions, preflight,
release y manufacturing outputs.

Una relación entre piezas puede ser authoring intent; sus perforaciones y operaciones
derivadas no lo son. SketchUp puede expresar que un entrepaño está unido a dos costados,
qué anchors/roles participan y qué sistema de unión se solicita. Muebles resuelve los
placements y machining derivados con las reglas y catálogo vigentes.

## Context

Muebles ya posee un núcleo industrial que conecta diseño con BOM, cutting, drilling,
production revision y ejecución física. SketchUp ofrece una superficie de autoría 3D
madura que algunos clientes ya usan.

El plan histórico de [#290](https://github.com/tiagofur/muebleria/issues/290) proponía
inferir piezas mediante una naming convention y enviarlas a una API. Ese enfoque era útil
como idea inicial, pero no protegía:

- stable identity;
- units y coordinate frames;
- catalog revision;
- idempotency;
- BOM reproducible;
- relaciones paramétricas entre piezas;
- drilling/machining derivado y provenance;
- stale detection y `ProductionRelease`;
- machine capability negotiation;
- evidencia de compatibilidad.

El programa necesita aprovechar SketchUp sin crear dos autoridades industriales.

## Boundaries

| Concern | SketchUp extension | Muebles | Machine adapter |
|---|---|---|---|
| Viewport, selection, drag y transform | Owns | Recibe intent | No participa |
| Authoring geometry | Owns | Puede inspeccionar/validar | No participa |
| Contract/schema | Implementa cliente | Owns | Consume manifest |
| Catalog references y parameters | Presenta/edita | Owns y valida | No participa |
| `PartRelationship` / joint intent | Captura/edita relaciones y anchors | Owns semantics/resolution | Consume resolved DTO |
| BOM, parts, materials y cost | No calcula | Owns | Consume resolved DTO |
| `HardwarePlacement` intent | Permite interacción | Owns semántica/resolution | Consume drilling |
| Derived placements | Visualiza feedback | Owns | Consume resolved output |
| Drilling/machining | Visualiza respuesta | Owns | Serializa lo soportado |
| Revision/fingerprint/idempotency | Propaga | Owns | Propaga provenance |
| Preflight/release | Presenta resultado | Owns | Declara capabilities |
| PTX/DXF/machine output | No genera | Orquesta/autoriza | Serializa formato |
| Compatibility claim | No afirma | Registra evidencia | Requiere field validation |

## Data ownership

### SketchUp-authoritative for interaction

- current selection;
- camera y viewport state;
- drag/transform gesture state;
- display geometry y helpers;
- pending local authoring edits antes del sync.

Estos datos pueden mejorar UX, pero no demuestran manufacturabilidad.

### SketchUp may author semantic intent

- assembly/component identity references;
- parameter overrides;
- semantic part roles;
- `PartRelationship`/joint intent;
- relationship anchors y requested joinery system;
- manual `HardwarePlacement` intent.

Estos datos describen qué quiso hacer el usuario. No contienen final drilling ni machine
coordinates como autoridad industrial.

### Muebles-authoritative for manufacturing

- catalog entities y revisions;
- parameter constraints;
- relationship/joint resolution;
- derived hardware placements;
- resolved BOM;
- `ResolvedBoardPart` y physical part identity;
- material/thickness/edge requirements;
- `HardwarePlacement` semantics;
- `HardwareMachiningProfile`;
- resolved drilling by part/face;
- operation provenance hacia relationship/joint/placement de origen;
- cut plan y nesting rules;
- `DesignRevision`, `bomFingerprint` y stale state;
- `ManufacturingPreflightResult`;
- `ProductionRelease`;
- `MachineProfile` y manufacturing artifact manifest.

### Adapter-authoritative only for serialization

Un `PostprocessorAdapter` conoce el formato específico y sus restricciones declaradas.
No redefine BOM, joints, drilling, dimensions, tools requeridas ni release policy.

## Interaction sequence

```text
User edits in SketchUp
        ↓
AuthoringEnvelope
        ↓
Muebles validates schema + identity + catalog references
        ↓
Muebles resolves relationships/joints + BOM + parts + hardware + drilling
        ↓
ManufacturingPreflightResult
        ↓
User corrects authoring intent or requests release
        ↓
ProductionRelease
        ↓
MachineProfile + PostprocessorAdapter
        ↓
ManufacturingArtifactManifest
```

SketchUp puede mostrar resolved data como read-only feedback. Esa representación no se
convierte en una copia editable de la verdad industrial.

## Parametric relationship invariant

Para una relación constructiva entre piezas, por ejemplo un entrepaño y dos costados:

```text
part transform / relationship anchor changes
→ Muebles resolves the relationship again
→ dependent placements/machining change
→ unrelated machining remains unchanged
→ bomFingerprint/revision changes when manufacturing truth changes
```

Agregar o eliminar una pieza relacionada crea/elimina únicamente sus relaciones y
operaciones derivadas. Cambiar el joinery system recalcula machining desde reglas y
catálogo; no reutiliza coordenadas antiguas como verdad.

Un `ProductionRelease` existente nunca se modifica silenciosamente: un cambio relevante
produce stale state y exige nueva liberación.

## Consequences

### Positive

- una sola fuente de verdad para fabricación;
- Proyectar 3D y SketchUp convergen al mismo dominio;
- movimientos paramétricos conservan intención y provenance;
- Ruby permanece pequeño y reemplazable;
- machine adapters se prueban sin contaminar el core;
- revision/fingerprint hacen outputs trazables;
- machine packs pueden permanecer aislados por cliente/versión;
- contract fixtures detectan drift.

### Costs

- la extensión necesita conectividad o una política offline limitada;
- errores deben viajar con ubicación semántica para ser corregibles;
- schema/version migration se convierte en responsabilidad explícita;
- relationships/anchors necesitan IDs y semantics estables;
- el flujo requiere preflight antes de exportar;
- field validation sigue siendo necesaria aunque CI esté verde.

### Risks accepted

- authoring geometry puede diferir temporalmente del resolved model;
- no toda entidad SketchUp será manufacturable;
- una relación puede quedar inválida por cambios geométricos y debe bloquear machining;
- algunos machine profiles soportarán sólo un subset de operations;
- un cambio de catálogo puede volver stale un modelo previamente válido.

Estos casos se muestran explícitamente; no se corrigen con fallback silencioso.

## Rejected alternatives

### Naming convention as industrial contract

Rechazado porque nombres visibles son editables, ambiguos, no versionados y no expresan
identity, revisions, capabilities ni error location. Puede existir como ayuda de import
legacy, nunca como primary key.

### SketchUp exports final parts/cut list

Rechazado porque duplicaría BOM y permitiría fabricar contra reglas distintas de
Muebles.

### Persist CNC coordinates as relationship truth

Rechazado porque una coordenada resuelta pierde la intención constructiva. Mover un
entrepaño o cambiar una unión obligaría a mantener agujeros manualmente y permitiría
drift. Las coordenadas son output derivado de relationships/joints/placements.

### Shared ownership of manufacturing calculations

Rechazado porque contract drift entre Ruby, TypeScript y Go sería difícil de detectar y
costoso de mantener.

### CSG holes as manufacturing truth

Rechazado porque una perforación visual no contiene por sí sola operation kind, entry
face, tool capability, depth semantics, provenance ni revision.

### Direct SketchUp-to-machine export

Rechazado porque omite preflight, release, stale detection, audit y capability
negotiation.

### Replace Proyectar 3D with SketchUp

Rechazado porque Proyectar sigue siendo la ruta nativa para cotización y diseño modular
rápido; ambos authoring clients deben coexistir.

## Conformance tests

Una implementación conforma con este ADR cuando:

- [ ] Ruby no contiene fórmulas de BOM, joint resolution, drilling, nesting, kerf o postprocessing.
- [ ] El input usa stable IDs, explicit units y versioned schema.
- [ ] `PartRelationship`/joint intent usa IDs y anchors semánticos, no CNC coordinates como primary truth.
- [ ] Mover un entrepaño cambia únicamente machining dependiente de sus relaciones.
- [ ] Agregar/eliminar una pieza relacionada agrega/elimina únicamente sus derived operations.
- [ ] Mover una bisagra modifica su machining dependiente sin alterar machining del entrepaño.
- [ ] Derived operations conservan provenance hacia relationship/joint/placement de origen.
- [ ] Repetir el mismo request con el mismo `idempotencyKey` no duplica entidades.
- [ ] Muebles puede rechazar metadata/relationships ambiguos antes de producir artifacts.
- [ ] Resolved manufacturing data incluye `designRevisionId` y `bomFingerprint`.
- [ ] Cambios relevantes después de release producen stale state.
- [ ] Unknown machine capability bloquea; no se infiere por brand.
- [ ] Un adapter nuevo no modifica el neutral manufacturing model.
- [ ] Proyectar y SketchUp pueden usar los mismos contract fixtures de dominio.
- [ ] Un claim de compatibilidad incluye import/readback y operator sign-off.

## References

- [SketchUp + Muebles strategy](../sketchup-muebles-strategy.md)
- [SketchUp Manufacturing Contract](../sketchup-manufacturing-contract.md)
- [Architecture](../architecture.md)
- [Project Lifecycle](../project-lifecycle.md)
- [Production Flow v2](../production-flow-v2.md)
- [Proyectar 3D North Star](../proyectar-3d-north-star.md)
- [Verification](../verification.md)
- [#300 ProductionRelease](https://github.com/tiagofur/muebleria/issues/300)
- [#301 physical production](https://github.com/tiagofur/muebleria/issues/301)
- [#313 design→production contracts](https://github.com/tiagofur/muebleria/issues/313)
- [#356 parametric part relationships](https://github.com/tiagofur/muebleria/issues/356)

Los documentos bajo `docs/history/` y el `Plan histórico` de #290 se conservan como
evidencia de evolución; este ADR cambia la decisión vigente, no el pasado.
