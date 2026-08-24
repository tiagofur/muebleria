# SketchUp Manufacturing Contract v1

> **Estado:** conceptual, no ejecutable  
> **Schema:** `muebles.sketchup-authoring.v1`  
> **Tracking:** [#290](https://github.com/tiagofur/muebleria/issues/290),
> [#344](https://github.com/tiagofur/muebleria/issues/344),
> [#346](https://github.com/tiagofur/muebleria/issues/346),
> [#356](https://github.com/tiagofur/muebleria/issues/356)  
> **Invariante:** **SketchUp owns authoring/interaction; Muebles owns manufacturing truth.**

Este documento define el límite conceptual de intercambio. No es un JSON Schema final,
un endpoint aprobado ni una promesa de compatibilidad. La implementación debe validar el
contrato con fixtures y versionarlo sin reinterpretaciones silenciosas.

## 1. Objetivo

Transportar authoring intent desde SketchUp a Muebles y devolver validation/resolved
feedback sin convertir geometría, names, drilling visible o cálculos Ruby en
manufacturing truth.

```text
AuthoringEnvelope
  → schema/identity/catalog validation
  → relationship/joint resolution
  → BOM/parts/hardware/drilling resolution
  → ManufacturingPreflightResult
  → ProductionRelease
  → ManufacturingArtifactManifest
```

## 2. Envelope v1

```ts
type AuthoringEnvelopeV1 = {
  schemaName: 'muebles.sketchup-authoring';
  schemaVersion: '1.0';
  messageId: string;
  idempotencyKey: string;
  sentAt: string;
  projectId: string;
  sourceRevisionId: string;
  source: AuthoringSource;
  units: UnitSystem;
  coordinateSystem: CoordinateSystem;
  assemblies: readonly DesignAssembly[];
};
```

Reglas:

- `messageId` identifica el intento de transporte.
- `idempotencyKey` identifica la mutación lógica y evita duplicados.
- `sourceRevisionId` cambia cuando cambia authoring intent relevante.
- `projectId` no se infiere por file name.
- unknown `schemaVersion` falla de forma segura.

## 3. Stable IDs

Todos los entities sincronizables usan IDs opacos y persistentes:

```ts
type StableEntityId = string;
```

IDs mínimos:

- `projectId`;
- `assemblyId`;
- `componentId`;
- `instanceId`;
- `catalogItemId`;
- `relationshipId`;
- `jointPlacementId` cuando aplique;
- `hardwarePlacementId`;
- `sourceRevisionId`.

Rename, regroup o cambio de display label no cambia identity. Names, SketchUp entity
indexes, array positions y geometry hashes no son primary keys.

## 4. Units y coordinate frames

```ts
type UnitSystem = {
  length: 'mm';
  angle: 'deg';
  precisionMm: number;
};

type CoordinateSystem = {
  handedness: 'right';
  upAxis: 'z';
  projectFrameId: string;
};

type Transform3D = {
  frame: 'project' | 'assembly' | 'component';
  translationMm: readonly [number, number, number];
  rotationQuaternion: readonly [number, number, number, number];
  scale: readonly [number, number, number];
};
```

- SketchUp internal inches se convierten en el boundary.
- Manufacturing dimensions se expresan en mm.
- `precisionMm` es rounding de transporte, no tolerancia de fabricación.
- Negative/non-uniform scale requiere normalización o error explícito.
- Mirror/handedness debe representarse semánticamente.

## 5. Authoring entities

```ts
type DesignAssembly = {
  assemblyId: StableEntityId;
  catalogItemId: string;
  catalogRevision: string;
  displayName?: string;
  transform: Transform3D;
  parameters: Readonly<Record<string, ParameterValue>>;
  components?: readonly DesignComponent[];
  relationships?: readonly PartRelationshipIntent[];
  hardwarePlacements?: readonly HardwarePlacementIntent[];
};

type DesignComponent = {
  componentId: StableEntityId;
  instanceId: StableEntityId;
  catalogComponentId?: string;
  role: string;
  transform: Transform3D;
};

type RelationshipAnchor = {
  componentId: StableEntityId;
  role: string;
  face?: string;
  reference?: string;
};

type PartRelationshipIntent = {
  relationshipId: StableEntityId;
  kind: string;
  source: RelationshipAnchor;
  targets: readonly RelationshipAnchor[];
  joinerySystemId?: string;
  parameters?: Readonly<Record<string, ParameterValue>>;
};

type HardwarePlacementIntent = {
  hardwarePlacementId: StableEntityId;
  catalogHardwareId: string;
  hostComponentId: StableEntityId;
  anchorFace: string;
  offsetMm: readonly [number, number];
  rotationDeg: number;
  handedness?: 'left' | 'right' | 'neutral';
};

type ParameterValue = string | number | boolean;
```

`PartRelationshipIntent` expresa intención constructiva, no perforaciones finales. Un
entrepaño puede relacionarse con dos costados mediante anchors/roles semánticos y un
`joinerySystemId`; Muebles resuelve el machining correspondiente.

Estos entities no contienen como input autoritativo:

- `ResolvedBoardPart`;
- derived hardware placements;
- final drilling;
- cut order o kerf;
- toolpath;
- machine coordinates/code.

Display geometry puede viajar como preview, pero no reemplaza relaciones semánticas ni
manufacturing resolution.

## 6. Relationship/joint resolution

Muebles debe poder producir resultados equivalentes a:

```ts
type DerivedOperationProvenance = {
  relationshipId?: StableEntityId;
  jointPlacementId?: StableEntityId;
  hardwarePlacementId?: StableEntityId;
  catalogRuleId?: string;
};
```

Reglas:

- mover una pieza cambia transform/anchors/intención, no agujeros persistidos;
- agregar una pieza relacionada crea nuevas relationships y sólo sus derived operations;
- eliminarla elimina o invalida sólo sus relationships y machining derivado;
- cambiar `joinerySystemId` recalcula machining desde catálogo/reglas;
- manual y derived hardware placements deben distinguirse;
- cada derived operation conserva provenance suficiente hacia su origen;
- relationships inválidas, huérfanas o geométricamente imposibles no generan output fabricable;
- machining no relacionado permanece estructuralmente equivalente cuando no cambia su source intent.

Caso canónico:

```text
move shelf
→ relationship anchors change
→ Muebles resolves joint again
→ dependent machining changes
→ unrelated machining remains unchanged
→ bomFingerprint changes when manufacturing truth changes
```

Y para hardware manual:

```text
move hinge
→ HardwarePlacement intent changes
→ hinge machining changes
→ shelf machining remains unchanged
```

## 7. Revision, fingerprint e idempotency

```ts
type ManufacturingIdentity = {
  projectId: string;
  designRevisionId: string;
  sourceRevisionId: string;
  bomFingerprint: string;
  resolvedAt: string;
};
```

- `designRevisionId` pertenece a Muebles.
- `bomFingerprint` deriva de manufacturing inputs canonicalized por Muebles.
- Mismo `idempotencyKey` + payload equivalente devuelve el mismo resultado.
- Mismo key + payload distinto devuelve `IDEMPOTENCY_CONFLICT`.
- Cambios de dimensions, relationships, joinery, materials o hardware que afecten fabricación crean nueva revision/fingerprint.
- Después de `ProductionRelease`, una revisión distinta marca artifacts previos stale.
- Nunca se sobrescribe silenciosamente output de una revisión liberada.

## 8. Error model

```ts
type ContractIssue = {
  code: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  entityId?: StableEntityId;
  path?: string;
  remediation?: string;
  details?: Readonly<Record<string, unknown>>;
};
```

Codes conceptuales mínimos:

- `SCHEMA_VERSION_UNSUPPORTED`;
- `STABLE_ID_DUPLICATE`;
- `CATALOG_REFERENCE_MISSING`;
- `CATALOG_REVISION_STALE`;
- `TRANSFORM_INVALID`;
- `PARAMETER_OUT_OF_RANGE`;
- `RELATIONSHIP_INVALID`;
- `RELATIONSHIP_ORPHANED`;
- `JOINERY_SYSTEM_UNSUPPORTED`;
- `HARDWARE_HOST_INVALID`;
- `DRILLING_CONFLICT`;
- `REVISION_STALE`;
- `MACHINE_CAPABILITY_UNSUPPORTED`;
- `IDEMPOTENCY_CONFLICT`.

`path` usa una ruta estable, por ejemplo:

```text
assemblies[assemblyId=asm-01].relationships[relationshipId=rel-shelf-01]
assemblies[assemblyId=asm-01].hardwarePlacements[hardwarePlacementId=hp-03]
```

Ruby/UI presenta el error; no reimplementa la regla.

## 9. Capability negotiation

```ts
type MachineProfileRef = {
  machineProfileId: string;
  profileVersion: string;
};

type MachineCapability = {
  capabilityId: string;
  version: string;
  constraints: Readonly<Record<string, unknown>>;
};

type CapabilityNegotiation = {
  machineProfile: MachineProfileRef;
  required: readonly MachineCapability[];
  supported: readonly MachineCapability[];
  unsupported: readonly ContractIssue[];
};
```

Capabilities no se infieren por brand. Unknown/unsupported bloquea el artifact afectado
salvo override server-authoritative, explícito y auditado.

## 10. Manufacturing preflight

```ts
type ManufacturingPreflightResult = {
  identity: ManufacturingIdentity;
  status: 'ready' | 'blocked' | 'warning';
  issues: readonly ContractIssue[];
  requiredCapabilities: readonly MachineCapability[];
  machineNegotiation?: CapabilityNegotiation;
};
```

Orden conceptual:

1. schema/version;
2. identity/idempotency;
3. units/coordinate frames;
4. catalog references y parameters;
5. relationship/joint resolution;
6. BOM/parts/material resolution;
7. hardware/drilling/machining validation;
8. revision/fingerprint/stale checks;
9. machine capability negotiation;
10. lifecycle/approval/release gates.

Para el primer demo, el subset mínimo autoritativo valida al menos:

- identity/revision/fingerprint;
- catalog references;
- relationships/joints resolubles;
- dimensions/thickness;
- drilling bounds/depth;
- critical collisions conocidas;
- bloqueo seguro ante ambigüedad crítica.

`ready` no equivale a `ProductionRelease`; sólo Muebles crea la release.

## 11. Manufacturing artifact manifest

```ts
type ManufacturingArtifactManifest = {
  artifactSetId: string;
  projectId: string;
  designRevisionId: string;
  bomFingerprint: string;
  machineProfile: MachineProfileRef;
  artifacts: readonly {
    artifactId: string;
    kind: 'ptx' | 'dxf' | 'csv' | 'pdf' | 'label' | 'other';
    schemaVersion: string;
    checksum: string;
  }[];
};
```

El manifest demuestra provenance, no compatibilidad física. PTX/CNC requiere además
import/readback y operator sign-off para la combinación exacta de machine/software.

## 12. Example payload

```json
{
  "schemaName": "muebles.sketchup-authoring",
  "schemaVersion": "1.0",
  "messageId": "msg-01J6A2",
  "idempotencyKey": "project-42:source-rev-8",
  "sentAt": "2026-08-24T05:00:00Z",
  "projectId": "project-42",
  "sourceRevisionId": "source-rev-8",
  "units": { "length": "mm", "angle": "deg", "precisionMm": 0.01 },
  "coordinateSystem": {
    "handedness": "right",
    "upAxis": "z",
    "projectFrameId": "frame-project-42"
  },
  "assemblies": [
    {
      "assemblyId": "assembly-base-01",
      "catalogItemId": "module-base-600",
      "catalogRevision": "12",
      "displayName": "Base cabinet 600",
      "transform": {
        "frame": "project",
        "translationMm": [1200, 0, 0],
        "rotationQuaternion": [0, 0, 0, 1],
        "scale": [1, 1, 1]
      },
      "parameters": {
        "widthMm": 600,
        "heightMm": 720,
        "depthMm": 590
      },
      "components": [
        { "componentId": "side-left", "instanceId": "side-left-01", "role": "left-side" },
        { "componentId": "side-right", "instanceId": "side-right-01", "role": "right-side" },
        { "componentId": "shelf", "instanceId": "shelf-01", "role": "shelf" }
      ],
      "relationships": [
        {
          "relationshipId": "rel-shelf-01",
          "kind": "shelf-support",
          "source": { "componentId": "shelf", "role": "shelf-edge" },
          "targets": [
            { "componentId": "side-left", "role": "inside-face" },
            { "componentId": "side-right", "role": "inside-face" }
          ],
          "joinerySystemId": "minifix-dowel"
        }
      ]
    }
  ]
}
```

El ejemplo es ilustrativo y no congela el schema ejecutable final.

## 13. Invariants y verification

- [ ] SketchUp input representa authoring intent, no final manufacturing data.
- [ ] Stable IDs sobreviven rename y round-trip.
- [ ] Units y frames siempre son explícitos.
- [ ] Relationships usan IDs/roles/anchors semánticos, no final CNC coordinates.
- [ ] Mover/agregar/eliminar un entrepaño recalcula sólo machining dependiente.
- [ ] Mover una bisagra no altera machining no relacionado.
- [ ] Derived operations conservan provenance.
- [ ] Muebles resuelve BOM, parts, hardware y drilling.
- [ ] Idempotency conflict falla; no duplica.
- [ ] Todo artifact incluye revision/fingerprint/profile provenance.
- [ ] Stale revision no produce output silencioso.
- [ ] Unsupported capability bloquea antes del export.
- [ ] Contract fixtures prueban parity cuando una regla exista en TS y Go.
- [ ] Field compatibility requiere import/readback y operator sign-off.

## 14. Non-goals v1

- JSON Schema definitivo;
- endpoint/transport final;
- offline conflict resolution completo;
- free-form geometry manufacturing;
- universal CAM/G-code;
- soportar todas las versions de SketchUp o machines;
- sustituir `ProductionRelease`;
- implementar producción como parte de este documento.

## References

- [SketchUp + Muebles strategy](sketchup-muebles-strategy.md)
- [ADR-0001](adr/0001-sketchup-authoring-muebles-manufacturing-truth.md)
- [Architecture](architecture.md)
- [Project Lifecycle](project-lifecycle.md)
- [Production Flow v2](production-flow-v2.md)
- [Verification](verification.md)
- [#347 manufacturing preflight](https://github.com/tiagofur/muebleria/issues/347)
- [#348 PTX validation](https://github.com/tiagofur/muebleria/issues/348)
- [#351 machine profiles](https://github.com/tiagofur/muebleria/issues/351)
- [#354 golden/E2E tests](https://github.com/tiagofur/muebleria/issues/354)
- [#356 parametric part relationships](https://github.com/tiagofur/muebleria/issues/356)
