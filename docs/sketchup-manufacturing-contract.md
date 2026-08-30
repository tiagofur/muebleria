# SketchUp Manufacturing Contract v1

> **Estado:** conceptual, no ejecutable  
> **Schema compound identifier:** `granete.sketchup-authoring.v1`  
> **Namespace:** el schema nace como `granete.*` tras el rename de marca
> (#366); el issue #346 y versiones previas de este documento decían
> `muebles.sketchup-authoring.v1`. Nada se publicó bajo ese ID, así que no se
> debe migración. La implementación executable vive en
> `packages/domain/src/sketchupAuthoring*.ts`.  
> **Tracking:** [#290](https://github.com/tiagofur/muebleria/issues/290),
> [#344](https://github.com/tiagofur/muebleria/issues/344),
> [#346](https://github.com/tiagofur/muebleria/issues/346),
> [#356](https://github.com/tiagofur/muebleria/issues/356)  
> **Invariante:** **SketchUp owns authoring/interaction; Granete owns manufacturing truth.**

Este documento define el límite conceptual de intercambio. No es un JSON Schema final,
un endpoint aprobado ni una promesa de compatibilidad. La implementación debe validar el
contrato con fixtures y versionarlo sin reinterpretaciones silenciosas.

## 1. Objetivo

Transportar authoring intent desde SketchUp a Granete y devolver validation/resolved
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
type SchemaIdentityV1 = {
  schemaId: 'granete.sketchup-authoring.v1';
  schemaName: 'granete.sketchup-authoring';
  schemaVersion: '1.0';
};

type AuthoringEnvelopeV1 = {
  schemaId: SchemaIdentityV1['schemaId'];
  schemaName: 'granete.sketchup-authoring';
  schemaVersion: '1.0';
  messageId: string;
  idempotencyKey: string;
  sentAt: string;
  projectId: string;
  baseSourceRevisionId?: string;
  sourceRevisionId: string;
  source: AuthoringSource;
  units: UnitSystem;
  coordinateSystem: CoordinateSystem;
  mutationMode: 'full-snapshot-with-tombstones';
  assemblies: readonly DesignAssembly[];
  tombstones: readonly EntityTombstone[];
};

type AuthoringSource = {
  client: 'granete-for-sketchup';
  clientVersion: string;
  host: 'sketchup';
  hostVersion: string;
};

type EntityTombstone = {
  entityType:
    | 'assembly'
    | 'componentInstance'
    | 'relationship'
    | 'hardwarePlacement';
  entityId: StableEntityId;
  deletedAt: string;
};

type AuthoringRoundTripResponseV1 = {
  schemaId: SchemaIdentityV1['schemaId'];
  schemaName: 'granete.sketchup-authoring';
  schemaVersion: '1.0';
  responseMessageId: string;
  inReplyToMessageId: string;
  idempotencyKey: string;
  projectId: string;
  sourceRevisionId: string;
  status: 'accepted' | 'rejected' | 'conflict';
  migration?: AppliedSchemaMigration;
  mutationReceipt: MutationReceipt;
  authoringSnapshot?: ReadonlyAuthoringSnapshot;
  resolvedFeedback?: ResolvedManufacturingFeedback;
  issues: readonly ContractIssue[];
};

type MutationReceipt = {
  createdEntityIds: readonly StableEntityId[];
  updatedEntityIds: readonly StableEntityId[];
  deletedEntityIds: readonly StableEntityId[];
};

type AppliedSchemaMigration = {
  migrationId: string;
  fromSchemaName: string;
  fromSchemaVersion: string;
  toSchemaId: SchemaIdentityV1['schemaId'];
  toSchemaVersion: '1.0';
};
```

Reglas:

- `schemaId` es el compound identifier canónico de la línea major v1 y debe coincidir
  exactamente con `schemaName: 'granete.sketchup-authoring'` y el major de
  `schemaVersion: '1.0'`; cualquier combinación inconsistente se rechaza.
- `schemaName` + `schemaVersion` conservan la identidad estructurada y la versión exacta
  para negociación y migrations; `schemaId` no las reemplaza.
- `messageId` identifica el intento de transporte.
- `responseMessageId` identifica la respuesta e `inReplyToMessageId` debe ser igual al
  `messageId` del request aceptado, rechazado o en conflicto.
- `idempotencyKey` identifica la mutación lógica y evita duplicados.
- La respuesta repite `idempotencyKey`, `projectId`, `sourceRevisionId` y la identidad de
  schema para que el round-trip no dependa del orden de llegada.
- `baseSourceRevisionId` es una precondición optimista cuando ya existe estado aceptado;
  una base stale produce `conflict` y no aplica mutaciones parciales.
- `sourceRevisionId` cambia cuando cambia authoring intent relevante.
- `projectId` no se infiere por file name.
- `source` identifica client/host versions para compatibilidad y diagnóstico; no cambia ownership industrial.
- unknown `schemaVersion` falla de forma segura.

## 3. Stable IDs

Todos los entities sincronizables usan IDs opacos y persistentes:

```ts
type StableEntityId = string;
```

IDs mínimos:

- `projectId`;
- `assemblyId`;
- `componentDefinitionId`;
- `componentInstanceId`;
- `catalogItemId`;
- `relationshipId`;
- `jointPlacementId` cuando aplique;
- `hardwarePlacementId`;
- `sourceRevisionId`.

Semántica y lifecycle:

- `assemblyId` identifica una instancia concreta del agregado/mueble manufacturable de
  primer nivel dentro de `projectId`; no identifica una definición reutilizable. Un
  agregado anidado que necesite identity propia debe recibir su propio
  `aggregateInstanceId` en una extensión versionada, no reutilizar `assemblyId`.
- `componentDefinitionId` identifica una definición SketchUp reutilizable dentro de
  `projectId`. Varias instancias pueden compartirlo; nunca se usa como relationship
  anchor ni como hardware host.
- `componentInstanceId` identifica una instancia concreta dentro de `projectId` y es la
  única identidad válida para anchors y hosts.
- `assemblyId` y `componentInstanceId` persisten tras rename, regroup, save/reload y
  round-trip mientras la entidad exista. Son únicos en el proyecto y no se reasignan ni
  reutilizan después de un delete; el tombstone conserva esa prohibición.
- `componentDefinitionId` persiste mientras exista la definición. Eliminar una instancia
  no elimina automáticamente la definición compartida ni las demás instancias.

Names, SketchUp entity indexes, array positions y geometry hashes no son primary keys.

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
  frame: 'project' | 'assembly' | 'componentInstance';
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
  componentDefinitionId: StableEntityId;
  componentInstanceId: StableEntityId;
  catalogComponentId?: string;
  role: string;
  transform: Transform3D;
};

type RelationshipAnchor = {
  componentInstanceId: StableEntityId;
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
  hostComponentInstanceId: StableEntityId;
  anchorFace: string;
  offsetMm: readonly [number, number];
  rotationDeg: number;
  handedness?: 'left' | 'right' | 'neutral';
};

type ParameterValue = string | number | boolean;
```

`PartRelationshipIntent` expresa intención constructiva, no perforaciones finales. Un
entrepaño puede relacionarse con dos costados mediante anchors/roles semánticos y un
`joinerySystemId`; Granete resuelve el machining correspondiente. Si `shelf-instance-01`
y `shelf-instance-02` comparten `componentDefinitionId: 'shelf-definition'`, cada uno
conserva relationships y machining propios porque anchors y hardware hosts referencian
sus `componentInstanceId` distintos.

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

Granete debe poder producir resultados equivalentes a:

```ts
type RelationshipProvenance = {
  sourceKind: 'relationship';
  relationshipId: StableEntityId;
  catalogRuleId?: string;
};

type JointProvenance = {
  sourceKind: 'joint';
  relationshipId: StableEntityId;
  jointPlacementId: StableEntityId;
  catalogRuleId?: string;
};

type ManualHardwarePlacementProvenance = {
  sourceKind: 'manualHardwarePlacement';
  hardwarePlacementId: StableEntityId;
  catalogRuleId?: string;
};

type DerivedOperationProvenance =
  | RelationshipProvenance
  | JointProvenance
  | ManualHardwarePlacementProvenance;

type DerivedHardwarePlacement = {
  derivedHardwarePlacementId: StableEntityId;
  hostComponentInstanceId: StableEntityId;
  provenance: RelationshipProvenance | JointProvenance;
};

type DerivedMachiningOperation = {
  operationId: StableEntityId;
  hostComponentInstanceId: StableEntityId;
  provenance: DerivedOperationProvenance;
};
```

Reglas:

- mover una pieza cambia transform/anchors/intención, no agujeros persistidos;
- agregar una pieza relacionada crea nuevas relationships y sólo sus derived operations;
- eliminarla elimina o invalida sólo sus relationships y machining derivado;
- cambiar `joinerySystemId` recalcula machining desde catálogo/reglas;
- manual y derived hardware placements deben distinguirse;
- cada derived operation conserva exactamente una variante válida de provenance; `{}` y
  combinaciones ambiguas de relationship/joint/manual placement son inválidas;
- relationships inválidas, huérfanas o geométricamente imposibles no generan output fabricable;
- machining no relacionado permanece estructuralmente equivalente cuando no cambia su source intent.

Caso canónico:

```text
move shelf
→ relationship anchors change
→ Granete resolves joint again
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

## 7. Round-trip, mutations y migrations

```ts
type ReadonlyAuthoringSnapshot = {
  projectId: StableEntityId;
  sourceRevisionId: StableEntityId;
  assemblies: readonly DesignAssembly[];
};

type ResolvedManufacturingFeedback = {
  identity: ManufacturingIdentity;
  preflightStatus: 'ready' | 'blocked' | 'warning';
  derivedHardwarePlacements: readonly DerivedHardwarePlacement[];
  derivedMachiningOperations: readonly DerivedMachiningOperation[];
  issues: readonly ContractIssue[];
};
```

Política V1:

- el request contiene un snapshot completo de entities vivas y tombstones explícitos;
- un stable ID desconocido crea, uno existente actualiza y un tombstone elimina;
- omitir una entity existente sin tombstone no la elimina y produce conflicto de
  snapshot; deletes accidentales por ausencia están prohibidos;
- create/update/delete se aplican atómicamente contra `baseSourceRevisionId`; una
  referencia huérfana, base stale o mutación parcial rechaza el request completo;
- IDs eliminados nunca se reutilizan, aunque se cree después una entity equivalente;
- `mutationReceipt` devuelve la clasificación create/update/delete decidida por Granete;
- `authoringSnapshot` puede devolver authoring intent normalizado para persistencia en
  SketchUp; no contiene BOM, drilling ni machine output;
- `resolvedFeedback` es read-only y está ligado a `ManufacturingIdentity`. SketchUp puede
  renderizarlo o cachearlo como feedback, pero no puede reenviarlo dentro de
  `DesignAssembly` ni editarlo como authoring truth;
- sólo una migration registrada, determinística y sin pérdida puede transformar una
  versión conocida; la respuesta registra `migrationId`, origen y destino;
- una versión newer/unknown, una migration con pérdida o un mismatch entre
  `schemaId`/`schemaName`/`schemaVersion` falla antes de mutar el modelo;
- nunca se hace downgrade ni reinterpretación silenciosa. El payload original y la
  versión aceptada permanecen auditables.

## 8. Revision, fingerprint e idempotency

```ts
type ManufacturingIdentity = {
  projectId: string;
  designRevisionId: string;
  sourceRevisionId: string;
  bomFingerprint: string;
  resolvedAt: string;
};
```

- `designRevisionId` pertenece a Granete.
- `bomFingerprint` deriva de manufacturing inputs canonicalized por Granete.
- Mismo `idempotencyKey` + payload equivalente devuelve el mismo resultado.
- Mismo key + payload distinto devuelve `IDEMPOTENCY_CONFLICT`.
- Cambios de dimensions, relationships, joinery, materials o hardware que afecten fabricación crean nueva revision/fingerprint.
- Después de `ProductionRelease`, una revisión distinta marca artifacts previos stale.
- Nunca se sobrescribe silenciosamente output de una revisión liberada.

## 9. Error model

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

`Module` no publica hoy un lifecycle `active/inactive`: una definición es
resoluble sólo si está presente en el catálogo pineado; si fue retirada o no
está publicada, el resolve devuelve `CATALOG_REFERENCE_MISSING`. El contrato no
expone un código `CATALOG_DEFINITION_INACTIVE` imposible de producir.

También se requieren codes explícitos para `SOURCE_REVISION_CONFLICT`,
`ENTITY_TOMBSTONE_INVALID`, `STABLE_ID_REUSE`, `SCHEMA_ID_MISMATCH` y
`SCHEMA_MIGRATION_UNSAFE`.

`path` usa una ruta estable, por ejemplo:

```text
assemblies[assemblyId=asm-01].relationships[relationshipId=rel-shelf-01]
assemblies[assemblyId=asm-01].hardwarePlacements[hardwarePlacementId=hp-03]
```

Ruby/UI presenta el error; no reimplementa la regla.

## 10. Capability negotiation

```ts
type MachineProfileRef = {
  machineProfileId: string;
  machineProfileRevisionId: string;
};

type PostprocessorAdapterRef = {
  postprocessorAdapterId: string;
  postprocessorAdapterVersion: string;
  implementationDigest: string;
};

type SanitizedEvidencePackRef = {
  evidencePackId: string;
  evidencePackRevisionId: string;
  sanitizedUri: string;
  checksum: string;
};

type ArtifactCompatibilityEvidence =
  | { status: 'notClaimed' | 'unsupported' }
  | {
      status: 'validated' | 'partial';
      evidencePack: SanitizedEvidencePackRef;
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

## 11. Manufacturing preflight

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

Este subset es el milestone verificable `minimum authoritative preflight` de #347. Se
implementa sobre el fixture de #356 después de cerrar relationships/joints y debe pasar
antes de iniciar implementación dependiente de #349/#350, llamar manufacturable a un
gabinete o ejecutar el demo. Los fixtures posteriores de biblioteca/hardware vuelven a
pasar el mismo gate. No equivale al cierre completo de #347; #348/#351 requieren el
Definition of Done completo del preflight.

`ready` no equivale a `ProductionRelease`; sólo Granete crea la release.

### Policy inputs del preflight (server-side)

Los inputs de política del gate — estado de release para stale check (§8),
machine profile para capability negotiation (§10) y overrides — son contexto
que Granete inyecta al ejecutar el preflight. Nunca viajan dentro del
`AuthoringEnvelopeV1`: SketchUp no puede bypassar stale, capabilities ni
auto-aplicarse un override. Un override server-authoritative es explícito y
auditado: sólo puede degradar `MACHINE_CAPABILITY_UNSUPPORTED` o
`REVISION_STALE` a warning dejando el registro de aprobación (who/when/why) en
`issue.details.override`; la ambigüedad crítica (colisiones, referencias
huérfanas, schema/catálogo/drilling inválidos) siempre bloquea con cero output
fabricable.

## 12. Manufacturing artifact manifest

```ts
type ManufacturingArtifactManifest = {
  artifactSetId: string;
  projectId: string;
  designRevisionId: string;
  bomFingerprint: string;
  machineProfile: MachineProfileRef;
  postprocessorAdapter: PostprocessorAdapterRef;
  compatibilityEvidence: ArtifactCompatibilityEvidence;
  artifacts: readonly {
    artifactId: string;
    kind: 'ptx' | 'dxf' | 'csv' | 'pdf' | 'label' | 'other';
    schemaVersion: string;
    checksum: string;
  }[];
};
```

El manifest fija la revisión exacta del machine profile y la identidad, versión y digest
del postprocessor adapter que produjo los bytes. `compatibilityEvidence` obliga a que un
claim `validated|partial` enlace un pack sanitizado y revisionado; `notClaimed` o
`unsupported` no puede adjuntarlo como apariencia de validación. El evidence pack nunca
contiene un path privado, identidad del cliente ni una URL con credenciales. El manifest
demuestra provenance, no compatibilidad física. PTX/CNC requiere además import/readback
y operator sign-off para la combinación exacta de machine/software.

## 13. Example payload

```json
{
  "schemaId": "granete.sketchup-authoring.v1",
  "schemaName": "granete.sketchup-authoring",
  "schemaVersion": "1.0",
  "messageId": "msg-01J6A2",
  "idempotencyKey": "project-42:source-rev-8",
  "sentAt": "2026-08-24T05:00:00Z",
  "projectId": "project-42",
  "baseSourceRevisionId": "source-rev-7",
  "sourceRevisionId": "source-rev-8",
  "source": {
    "client": "sketchup-extension",
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
  "mutationMode": "full-snapshot-with-tombstones",
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
        {
          "componentDefinitionId": "definition-side-panel",
          "componentInstanceId": "side-left-01",
          "role": "left-side",
          "transform": {
            "frame": "assembly",
            "translationMm": [0, 0, 0],
            "rotationQuaternion": [0, 0, 0, 1],
            "scale": [1, 1, 1]
          }
        },
        {
          "componentDefinitionId": "definition-side-panel",
          "componentInstanceId": "side-right-01",
          "role": "right-side",
          "transform": {
            "frame": "assembly",
            "translationMm": [582, 0, 0],
            "rotationQuaternion": [0, 0, 0, 1],
            "scale": [1, 1, 1]
          }
        },
        {
          "componentDefinitionId": "definition-shelf",
          "componentInstanceId": "shelf-01",
          "role": "shelf",
          "transform": {
            "frame": "assembly",
            "translationMm": [18, 0, 350],
            "rotationQuaternion": [0, 0, 0, 1],
            "scale": [1, 1, 1]
          }
        },
        {
          "componentDefinitionId": "definition-shelf",
          "componentInstanceId": "shelf-02",
          "role": "shelf",
          "transform": {
            "frame": "assembly",
            "translationMm": [18, 0, 520],
            "rotationQuaternion": [0, 0, 0, 1],
            "scale": [1, 1, 1]
          }
        }
      ],
      "relationships": [
        {
          "relationshipId": "rel-shelf-01",
          "kind": "shelf-support",
          "source": {
            "componentInstanceId": "shelf-01",
            "role": "shelf-edge"
          },
          "targets": [
            {
              "componentInstanceId": "side-left-01",
              "role": "inside-face"
            },
            {
              "componentInstanceId": "side-right-01",
              "role": "inside-face"
            }
          ],
          "joinerySystemId": "minifix-dowel"
        },
        {
          "relationshipId": "rel-shelf-02",
          "kind": "shelf-support",
          "source": {
            "componentInstanceId": "shelf-02",
            "role": "shelf-edge"
          },
          "targets": [
            {
              "componentInstanceId": "side-left-01",
              "role": "inside-face"
            },
            {
              "componentInstanceId": "side-right-01",
              "role": "inside-face"
            }
          ],
          "joinerySystemId": "minifix-dowel"
        }
      ]
    }
  ],
  "tombstones": []
}
```

Los dos entrepaños comparten `componentDefinitionId` y conservan identidad, relationships
y machining independientes mediante sus `componentInstanceId`. El ejemplo es
ilustrativo y no congela el schema ejecutable final.

## 14. Invariants y verification

- [ ] SketchUp input representa authoring intent, no final manufacturing data.
- [ ] Stable IDs sobreviven rename y round-trip.
- [ ] `componentDefinitionId` puede compartirse; anchors y hardware hosts usan siempre `componentInstanceId`.
- [ ] `assemblyId`/`componentInstanceId` tienen scope de proyecto, persisten y no se reutilizan tras delete.
- [ ] Units y frames siempre son explícitos.
- [ ] Relationships usan IDs/roles/anchors semánticos, no final CNC coordinates.
- [ ] Mover/agregar/eliminar un entrepaño recalcula sólo machining dependiente.
- [ ] Mover una bisagra no altera machining no relacionado.
- [ ] Derived operations conservan una variante no vacía de provenance.
- [ ] Granete resuelve BOM, parts, hardware y drilling.
- [ ] Request/response se correlacionan y create/update/delete son atómicos e idempotentes.
- [ ] Resolved feedback permanece read-only y separado del authoring snapshot.
- [ ] Unknown/unsafe schema migration falla antes de mutar el modelo.
- [ ] Idempotency conflict falla; no duplica.
- [ ] Todo artifact incluye revision/fingerprint, machine profile revision y adapter identity/version/digest.
- [ ] Claims validated/partial enlazan un evidence pack sanitizado y revisionado.
- [ ] Stale revision no produce output silencioso.
- [ ] Unsupported capability bloquea antes del export.
- [ ] Contract fixtures prueban parity cuando una regla exista en TS y Go.
- [ ] Field compatibility requiere import/readback y operator sign-off.

## 15. Security y privacy

- business payloads no incluyen secrets ni session tokens;
- logs y fixtures usan IDs opacos y redaction;
- machine evidence sanitiza datos privados antes de entrar al repo;
- payload size, entity count y nesting depth tendrán límites explícitos;
- SketchUp/Ruby no se considera security boundary;
- auth/token transport se define fuera de este contract de negocio.

## 16. Non-goals v1

- JSON Schema definitivo;
- endpoint/transport final;
- offline conflict resolution completo;
- free-form geometry manufacturing;
- universal CAM/G-code;
- soportar todas las versions de SketchUp o machines;
- sustituir `ProductionRelease`;
- implementar producción como parte de este documento.

## 16b. Authoring resolve transport v1 (#477)

**Estado:** implementado (endpoint Go + contrato TS + transporte Ruby + fixture
compartido `contracts/sketchupAuthoringResolve.contract.json`).
**Schema:** `granete.sketchup-authoring-resolve.v1`
**Endpoint:** `POST /api/furniture/authoring/resolve`

Boundary stateless de transporte/resolve para intención semántica de autoría
más allá de `widthMm/heightMm/depthMm` + materiales. Reusa la semántica del
envelope #346 (triple de schema, `messageId`/`idempotencyKey`, units/frame,
`PartRelationshipIntent`, `HardwarePlacementIntent`, `ContractIssue`) — no es
un modelo paralelo SketchUp-only. Cuando #384 exista, este mismo contrato
semántico se conecta detrás del comando de working-copy de Design.

### Request

```text
schemaId / schemaName / schemaVersion      (triple exacta, mismatch falla cerrado)
messageId, idempotencyKey, sentAt          (correlación determinista)
source { client, clientVersion, host, hostVersion }
units { length: mm, angle: deg, precisionMm ∈ (0,1] }
coordinateSystem { handedness: right, upAxis: z, projectFrameId }
furniture {
  furnitureDefinitionId                    (definición autoritativa)
  catalogRevision                          OBLIGATORIO (revisionId de GET /api/furniture/definitions;
                                           mismatch → CATALOG_REVISION_STALE; nunca hay latest implícito)
  parameters { name → scalar }             (proyección tipada autoritativa de la definición: number/string/
                                           boolean/enum, defaults/required/min/max/step/options/integer/maxLength;
                                           claves o valores inválidos → códigos PARAMETER_* estables)
  materialChoices { ROLE → materialId }
  components?                              (snapshot completo de ocurrencias; ausente = set default del definition)
  relationships?                           (PartRelationshipIntent, incl. parameters)
  hardwarePlacements?                      (set completo manual; ausente = defaults del definition; [] = ninguno;
                                           SIN rotationDeg/handedness en v1 — un campo que no mueve la
                                           resolución no viaja: #468 los agrega CON semántica de resolución)
}
```

Reproducibilidad: el handler hace UNA sola lectura de catálogo que alimenta
la selección de la definición, el check de revisión Y el resolve (una lectura
separada de definición podría validar catálogo B y resolver definición A). El
pin incluye también las tablas versionadas de joinery/machining que participan
en el resultado; la respuesta echa `catalogRevision` (la revisión pineada usada).
Arrays estrictos: `translationMm` (exactamente 3) y `offsetMm` (exactamente
2) se decodifican como slices y validan longitud exacta — los arrays fijos
de Go truncarían/extenderían en silencio.

Contrato de definición tipada:

- `widthMm`, `heightMm` y `depthMm` son nombres reservados y se proyectan
  únicamente desde las columnas del módulo con binding `dimensionColumn`;
  una definición persistida no puede duplicar ni contradecir esas fuentes;
- `sortOrder` es orden declarativo de presentación; no sustituye el nombre ni
  participa como dispatch imperativo;
- todo parámetro no `metadata` declara un binding versionado con consumidor
  autoritativo. `componentQuantity` modifica el número de ocurrencias y puede
  materializar una relationship template por ocurrencia. El motor despacha por
  `binding.kind`, nunca por un nombre como `shelfCount`;
- `componentCondition` es boolean-only: `true` incluye su único componente
  directo y `false` lo excluye junto con relationships, machining, manual
  placements y hardware dependientes; el resultado es determinista y participa
  en hashes/pins;
- como v1 no conserva la identidad persistida de la entrada de componente en el
  dominio, cualquier target directo o de relationship que coincida con más de
  una entrada se rechaza como ambiguo; nunca se elige el primer match;
- `metadata` representa explícitamente un valor sin efecto físico y no admite
  binding. Cualquier otro parámetro sin consumidor se rechaza;
- catálogo, lectura de storage, publicación, TypeScript y Ruby validan la misma
  forma cerrada y límites de manera fail-closed. JSON corrupto, campos desconocidos,
  duplicados, defaults o enums inválidos, dimensiones reservadas incompatibles y exceso de definiciones
  producen `PARAMETER_DEFINITION_INVALID`; nunca se publica una definición
  parcial;
- los issues de valor incluyen `expectedType`/`receivedType` y, cuando aplica,
  `integer`/`min`/`max`/`step`/`allowedOptions`/`maxLength`. Strings requieren
  `maxLength` entre 1 y 512 y `receivedValue` sólo expone escalares seguros,
  truncados a 128 code points Unicode. Un snapshot de ocurrencias incompatible
  con el binding devuelve `PARAMETER_BINDING_CONFLICT` antes de mutar el host.
- el inspector SketchUp usa controles accesibles reales para boolean y string,
  preservando `false` y `""` como valores explícitos;
- al clonar catálogo, todos los `componentId` dentro de bindings y relationship
  targets se remapean transaccionalmente a los componentes destino; una referencia
  irresoluble aborta el clone completo.

Reglas de ocurrencias:

- cada ocurrencia mapea por `componentDefinitionId` al template de la
  expansión del definition (`st-`/`mod-`/`agr-…`); el server valida
  `catalogComponentId` cuando viene;
- `componentInstanceId` es identidad de ocurrencia client-stable dentro del
  resolve — dos entrepaños comparten `componentDefinitionId` y conservan
  identidad/relationships/machining propios;
- `transform` opcional es intención de autoría: sólo translación en frame
  assembly; ausente = pose default resuelta por el server (la geometría no
  movida siempre se re-resuelve, nunca se re-envía stale);
- agregar/quitar ocurrencias v1 sólo para internos movibles (placement
  `interno`, entrada única del definition); agregar comparte la definición
  reutilizable y exige IDs nuevos; los templates estructurales/agregados
  mantienen el count del definition (`OCCURRENCE_COUNT_UNSUPPORTED`/
  `SNAPSHOT_INCOMPLETE` en caso contrario);
- un template referenciado por MÚLTIPLES entradas del definition (que
  podrían llevar fórmulas/overrides distintos por copia) se rechaza
  siempre: agruparlo honraría sólo la primera entrada en silencio;
- TODOS los anchors de una relationship deben resolver: aceptar porque al
  menos un target existe dejaría caer el resto inválido en silencio
  (`RELATIONSHIP_ORPHANED`);
- el orden del array no decide nada: sin transform se asignan slots default
  por ID ordenado (determinista e insensible al orden).

### Response

```text
status accepted|rejected + correlation (responseMessageId = "resolve-" + messageId)
resolveContract (capability marker: misma schemaId)
normalizedSnapshot  (receipt stateless: estado authoring efectivo completo —
                     parámetros resueltos, ocurrencias con identidad server,
                     relationships, placements; es la única base del próximo request)
resolved {
  layout            (FurnitureLayout #415 completo con transformContract, identidad exacta de ocurrencias
                     y proyección visual de materiales: image/texture/tile/PBR/grain cuando existen)
  machining { operations (provenance + holes), derivedHardwarePlacements, manufacturingFingerprint }
  preflight { status, issues, preflightContract → granete.manufacturing-preflight.v1 (#347) }
}
issues [] ContractIssue (códigos estables; nunca parsear mensajes)
```

- `machining` es el puerto Go del resolver #356 sobre la geometría resuelta
  (server-authoritative): mover un entrepaño mueve sólo el machining
  dependiente; mover una bisagra no toca el machining de entrepaños; el
  pilot de herraje manual sigue el perfil técnico de la definición
  seleccionada (reemplazo cambia diámetro/BOM);
- `manufacturingFingerprint` (`sha256-` + 64 hex sobre UTF-8 del JSON canónico)
  es un change/check fingerprint determinista —no una identidad de release— y cubre la identidad
  manufacturera COMPLETA — tableros (identidad de ocurrencia + dimensiones +
  material seleccionado), placements manuales, placements derivados y
  operaciones — de modo que cambiar una manija, sustituir herrajes con el
  mismo patrón de taladro o cambiar un material mueve el fingerprint. Es el
  ancla de paridad TS↔Go: el test de contract TS lo recomputa desde el wire
  (`authoringResolveFingerprint`) y debe ser igual al generado por Go;
- `preflight` lleva `scope: authoring-resolve-subset` y estados
  `clear|blocked`: es la validación del subset del resolve y NUNCA el
  veredicto de fabricación del modelo #347 — ese modelo sólo se enlaza vía
  `preflightContract` (link para obtener el resultado autoritativo);
- `normalizedSnapshot.hardwarePlacements` es el set semántico/manual completo.
  `layout.hardware` es sólo su proyección visual: un herraje activo sin asset o
  preview válido permanece en snapshot, fingerprint y machining, pero puede
  omitirse correctamente del layout sin invalidar el resolve;
- HTTP: 200 accepted; 400 schema/malformed/query-params/oversized; 405 con
  envelope `METHOD_NOT_ALLOWED`; 415 con `CONTENT_TYPE_UNSUPPORTED`; 422
  rechazo semántico. Rejected nunca incluye `resolved` (sin resultado
  parcial aceptado). Los rechazos 405/415 ocurren antes de leer el body, por
  lo que su correlación queda vacía y el cliente conserva el código tipado.

### Reglas de transporte

- POST explícito: la intención de autoría es un body estructurado. **Cualquier
  query parameter presente falla cerrado** (`QUERY_PARAMETERS_UNSUPPORTED`) —
  la proliferación `?shelf2Z`/`?hinge1Offset` no puede volver a crecer;
- límite explícito de payload (2 MiB), `Content-Type: application/json`,
  `sentAt` RFC3339, límites de strings/colecciones y decodificación estricta
  (campos desconocidos o JSON top-level adicional → `REQUEST_INVALID`), sin
  guessing de schema;
- auth: capability POST explícita para tokens de extensión (#460): allowlist
  que nombra este endpoint; el resto sigue read-only. License y scope org
  como el resto de la familia furniture;
- stateless: retries idénticos → respuestas byte-idénticas; no crea registros
  de negocio ni consume receipts de idempotencia; sin timestamps volátiles en
  la respuesta (los campos revision/fingerprint que el contexto dueño —#384—
  todavía no posee no se inventan);
- logs sin payload de autoría ni credenciales.

### Fixture compartido

`contracts/sketchupAuthoringResolve.schema.json` es el schema JSON canónico y
machine-readable de request, accepted/rejected response, issues y uniones
discriminadas. `contracts/sketchupAuthoringResolve.contract.json` es el golden generado por el
resolver Go (regenerar con `UPDATE_AUTHORING_RESOLVE_GOLDEN=1`) con los
escenarios canónicos 1-8 de #477 + negative proofs (query param, revisión de
catálogo ausente, parámetro ad-hoc en body, ocurrencia duplicada,
translationMm de longitud incorrecta, target huérfano entre válidos) y la
paridad adicional de UTF-8/precisión 0.25, NativeLayout con material
image/texture/tile/PBR/grain y herraje manual semántico sin preview visual. La
sección `joinery` con la geometría resuelta, los sistemas de unión y los
`machiningProfiles` (tabla técnica versionada
`granete.machining-profile.v1` por código de herraje — NUNCA deducida de
campos visuales como PreviewShape/PreviewDiameter). TS, Go y Ruby lo consumen:
las tablas compiladas de cada runtime se afirman iguales al fixture por sus
tests de paridad, así que ningún payload ni regla paralela puede divergir.

El parser Ruby es fail-closed sobre TODO lo que habilita host mutation: triple de schema
exacta (id+name+version), correlación completa (sólo los rechazos
transport-level explícitos que ocurren antes de leer el body admiten
correlación vacía), `catalogRevision`
no-vacía en accepted, códigos de issue del set cerrado, severidades
conocidas, exclusividad real de provenance (una variante y sólo sus claves),
formato exacto del fingerprint (`sha256-[0-9a-f]{64}`), preflight subset exacto,
snapshot normalizado validado en profundidad (identidad, relationships,
transforms de 3 finitos, offsets de 2 finitos, sin duplicados ni campos fuera
del contrato v1) y coherencia snapshot↔layout. El transport pasa el request
esperado al parser, que exige correlación exacta antes de devolver un layout.

El v1 NO acepta parámetros arbitrarios: sólo evalúa los declarados por la
`FurnitureDefinition` persistida y pineada. El servidor aplica defaults y
restricciones, devuelve el set evaluado completo y el hash/revision del
catálogo cambia si cambia una regla o default. Los módulos legacy sin contrato
explícito proyectan width/height/depth con la misma semántica anterior.
Los primeros slices de #467/#468 se expresan mediante occurrences,
relationships y HardwarePlacement y no dependen de ese follow-up.

## References

- [SketchUp + Granete strategy](sketchup-granete-strategy.md)
- [ADR-0001](adr/0001-sketchup-authoring-granete-manufacturing-truth.md)
- [Architecture](architecture.md)
- [Project Lifecycle](project-lifecycle.md)
- [Production Flow v2](production-flow-v2.md)
- [Verification](verification.md)
- [#347 manufacturing preflight](https://github.com/tiagofur/muebleria/issues/347)
- [#348 PTX validation](https://github.com/tiagofur/muebleria/issues/348)
- [#351 machine profiles](https://github.com/tiagofur/muebleria/issues/351)
- [#354 golden/E2E tests](https://github.com/tiagofur/muebleria/issues/354)
- [#356 parametric part relationships](https://github.com/tiagofur/muebleria/issues/356)
