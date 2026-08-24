# ADR-0001 — SketchUp authoring, Muebles manufacturing truth

- **Status:** Accepted
- **Date:** 2026-08-24
- **Decision owners:** Product + Engineering
- **Program:** [SketchUp + Muebles](../sketchup-muebles-strategy.md)
- **Tracking:** [#290](https://github.com/tiagofur/muebleria/issues/290),
  [#344](https://github.com/tiagofur/muebleria/issues/344)

## Decision

> **SketchUp owns authoring/interaction; Muebles owns manufacturing truth.**

La extensión SketchUp captura intención de diseño, interacción y contexto visual. Muebles
es la única autoridad para catálogo, BOM, piezas, materiales, hardware, drilling,
machining, revisions, preflight, release y manufacturing outputs.

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
- drilling/machining derivado;
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
| BOM, parts, materials y cost | No calcula | Owns | Consume resolved DTO |
| `HardwarePlacement` intent | Permite interacción | Owns semántica/resolution | Consume drilling |
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

### Muebles-authoritative for manufacturing

- catalog entities y revisions;
- parameter constraints;
- resolved BOM;
- `ResolvedBoardPart` y physical part identity;
- material/thickness/edge requirements;
- `HardwarePlacement` semantics;
- `HardwareMachiningProfile`;
- resolved drilling by part/face;
- cut plan y nesting rules;
- `DesignRevision`, `bomFingerprint` y stale state;
- `ManufacturingPreflightResult`;
- `ProductionRelease`;
- `MachineProfile` y manufacturing artifact manifest.

### Adapter-authoritative only for serialization

Un `PostprocessorAdapter` conoce el formato específico y sus restricciones declaradas.
No redefine BOM, drilling, dimensions, tools requeridas ni release policy.

## Interaction sequence

```text
User edits in SketchUp
        ↓
AuthoringEnvelope
        ↓
Muebles validates schema + identity + catalog references
        ↓
Muebles resolves BOM + parts + hardware + drilling
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

## Consequences

### Positive

- una sola fuente de verdad para fabricación;
- Proyectar 3D y SketchUp convergen al mismo dominio;
- Ruby permanece pequeño y reemplazable;
- machine adapters se prueban sin contaminar el core;
- revision/fingerprint hacen outputs trazables;
- machine packs pueden permanecer aislados por cliente/versión;
- contract fixtures detectan drift.

### Costs

- la extensión necesita conectividad o una política offline limitada;
- errores deben viajar con ubicación semántica para ser corregibles;
- schema/version migration se convierte en responsabilidad explícita;
- el flujo requiere preflight antes de exportar;
- field validation sigue siendo necesaria aunque CI esté verde.

### Risks accepted

- authoring geometry puede diferir temporalmente del resolved model;
- no toda entidad SketchUp será manufacturable;
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

- [ ] Ruby no contiene fórmulas de BOM, drilling, nesting, kerf o postprocessing.
- [ ] El input usa stable IDs, explicit units y versioned schema.
- [ ] Repetir el mismo request con el mismo `idempotencyKey` no duplica entidades.
- [ ] Muebles puede rechazar metadata ambigua antes de producir artifacts.
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

Los documentos bajo `docs/history/` y el `Plan histórico` de #290 se conservan como
evidencia de evolución; este ADR cambia la decisión vigente, no el pasado.
