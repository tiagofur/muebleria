# SketchUp Manufacturing Contract v1

> **Estado:** conceptual, no ejecutable  
> **Schema:** `muebles.sketchup-authoring.v1`  
> **Tracking:** [#290](https://github.com/tiagofur/muebleria/issues/290),
> [#344](https://github.com/tiagofur/muebleria/issues/344),
> [#346](https://github.com/tiagofur/muebleria/issues/346)  
> **Invariante:** **SketchUp owns authoring/interaction; Muebles owns manufacturing truth.**

Este documento define el límite conceptual de intercambio. No es un JSON Schema final,
un endpoint aprobado ni una promesa de compatibilidad. La implementación debe validar el
contrato con fixtures y versionarlo sin reinterpretaciones silenciosas.

## 1. Objetivo

Transportar authoring intent desde SketchUp a Muebles y devolver validation/resolved
feedback sin convertir geometría, names o Ruby calculations en manufacturing truth.

```text
AuthoringEnvelope
  → schema/identity/catalog validation
  → Muebles domain resolution
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
- `projectId` debe existir o crearse mediante un flujo explícito; no se infiere por file name.
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
- `hardwarePlacementId`;
- `sourceRevisionId`.

Un rename, regroup o cambio de display label no cambia identity. Names, SketchUp entity
indexes, array positions y geometry hashes no son primary keys. Un duplicate intencional
crea un nuevo `instanceId` y conserva `sourceInstanceId` sólo como provenance opcional.

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

- SketchUp internal inches se convierten en el boundary; nunca viajan implícitas.
- Manufacturing dimensions se expresan en mm.
- `precisionMm` declara rounding de transporte, no tolerancia de fabricación.
- Negative/non-uniform scale requiere normalización o error explícito.
- Mirror/handedness debe representarse semánticamente; no se deduce sólo del mesh.
- Muebles valida transform y parámetros antes de resolver parts.

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
  hardwarePlacements?: readonly HardwarePlacementIntent[];
};

type DesignComponent = {
  componentId: StableEntityId;
  instanceId: StableEntityId;
  catalogComponentId?: string;
  role: string;
  transform: Transform3D;
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

Estos entities expresan intent. No contienen `ResolvedBoardPart`, final drilling, cut
order, kerf, toolpath ni machine code como input autoritativo.

Display geometry puede viajar en un canal opcional de preview, pero Muebles la ignora
para BOM y release salvo una regla futura explícita y versionada.

## 6. Revision, fingerprint e idempotency

Muebles responde con identity industrial:

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
- Repetir el mismo `idempotencyKey` con payload equivalente devuelve el mismo resultado.
- Reutilizarlo con payload distinto devuelve `IDEMPOTENCY_CONFLICT`.
- Cambios que afectan manufacturing crean nueva revision/fingerprint.
- Después de `ProductionRelease`, una revision distinta marca artifacts previos stale.
- Un artifact nunca mezcla parts/documents de fingerprints distintos.

## 7. Error model

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

Ejemplos de `code`:

- `SCHEMA_VERSION_UNSUPPORTED`;
- `STABLE_ID_DUPLICATE`;
- `CATALOG_REFERENCE_MISSING`;
- `CATALOG_REVISION_STALE`;
- `UNIT_SYSTEM_UNSUPPORTED`;
- `TRANSFORM_INVALID`;
- `PARAMETER_OUT_OF_RANGE`;
- `HARDWARE_HOST_INVALID`;
- `DRILLING_CONFLICT`;
- `REVISION_STALE`;
- `MACHINE_CAPABILITY_UNSUPPORTED`;
- `IDEMPOTENCY_CONFLICT`.

`path` usa una ruta estable, por ejemplo
`assemblies[assemblyId=asm-01].hardwarePlacements[hardwarePlacementId=hp-03]`.
Ruby/UI presenta el error; no reimplementa su regla.

## 8. Capability negotiation

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

El profile corresponde a una combinación confirmada de machine, controller, software y
version. No se infieren capabilities por brand. Unknown/unsupported bloquea el artifact
afectado salvo override server-authoritative, explícito y auditado.

## 9. Manufacturing preflight

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
5. BOM/parts/material resolution;
6. hardware/drilling/machining validation;
7. revision/fingerprint/stale checks;
8. machine capability negotiation;
9. lifecycle/approval/release gates.

`ready` no equivale a `ProductionRelease`; indica que los checks configurados no
bloquean el siguiente gate. Sólo Muebles crea la release.

## 10. Artifact manifest

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
import/readback y operator sign-off para la combinación exacta de máquina/software.

## 11. Example payload

```json
{
  "schemaName": "muebles.sketchup-authoring",
  "schemaVersion": "1.0",
  "messageId": "msg-01J6A2",
  "idempotencyKey": "project-42:source-rev-7",
  "sentAt": "2026-08-24T05:00:00Z",
  "projectId": "project-42",
  "sourceRevisionId": "source-rev-7",
  "source": {
    "client": "muebles-for-sketchup",
    "clientVersion": "0.1.0",
    "host": "sketchup",
    "hostVersion": "2026"
  },
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
      "hardwarePlacements": [
        {
          "hardwarePlacementId": "hp-hinge-left-01",
          "catalogHardwareId": "hinge-35-overlay",
          "hostComponentId": "component-door-left-01",
          "anchorFace": "front",
          "offsetMm": [100, 22],
          "rotationDeg": 0,
          "handedness": "left"
        }
      ]
    }
  ]
}
```

El ejemplo es ilustrativo. No autoriza estos field values como API final ni confirma
compatibilidad con una machine.

## 12. Invariants y verification

- [ ] SketchUp input representa authoring intent, no final manufacturing data.
- [ ] Muebles resuelve y valida BOM, parts, hardware y drilling.
- [ ] Stable IDs sobreviven rename y round-trip.
- [ ] Units y frames siempre son explícitos.
- [ ] Idempotency conflict falla; no duplica.
- [ ] Todo artifact incluye revision/fingerprint/profile provenance.
- [ ] Stale revision no produce output silencioso.
- [ ] Unsupported capability bloquea antes del export.
- [ ] Contract fixtures prueban parity cuando una regla exista en TS y Go.
- [ ] Field compatibility requiere import/readback y operator sign-off.

## 13. Security y privacy

- no incluir credentials, tokens, absolute paths, hostnames ni client identity;
- tokens viajan fuera del business payload y usan secure storage;
- logs usan opaque IDs y redaction;
- machine packs usan `client-a`/`client-b` y fixtures sanitizados;
- payload size, entity count y nesting depth tendrán límites explícitos;
- no confiar en Ruby/SketchUp como security boundary.

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
