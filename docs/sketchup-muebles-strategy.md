# SketchUp + Muebles — Estrategia de autoría y fabricación

> **Estado:** CANÓNICO  
> **Fecha:** 2026-08-24  
> **META:** [#290](https://github.com/tiagofur/muebleria/issues/290)  
> **Decisión:** **SketchUp owns authoring/interaction; Muebles owns manufacturing truth.**

Muebles for SketchUp permite diseñar con una herramienta 3D profesional sin convertir
el modelo SketchUp, la geometría visible ni el código Ruby en la fuente de verdad de
fabricación. SketchUp captura intención; Muebles resuelve y valida qué se puede fabricar.

## Ruta rápida de revisión

1. Confirmar el ownership en el
   [ADR-0001](adr/0001-sketchup-authoring-muebles-manufacturing-truth.md).
2. Revisar el [manufacturing contract](sketchup-manufacturing-contract.md).
3. Verificar fases y dependencias en [#290](https://github.com/tiagofur/muebleria/issues/290).
4. Confirmar que los machine packs exigen import/readback y operator sign-off.

## 1. Resultado de producto

El producto mantiene tres rutas de entrada que convergen al mismo `Project/Job`:

| Ruta | Trabajo principal | Usuario típico | Resultado |
|---|---|---|---|
| **Cotizar rápido** | Catálogo + options sin abrir 3D | ventas/taller simple | Quote + BOM preliminar |
| **Proyectar 3D** | Diseño modular nativo, rápido e integrado | ventas/diseño | Authoring intent nativo |
| **Muebles for SketchUp** | Autoría e interacción 3D profesional | diseñador SketchUp | Authoring intent externo |

Las tres rutas llegan al mismo núcleo:

```text
Authoring intent
      ↓
Muebles catalog resolution
      ↓
Resolved BOM + parts + hardware + drilling
      ↓
Manufacturing preflight
      ↓
Approval + ProductionRelease
      ↓
MachineProfile + PostprocessorAdapter
      ↓
Validated manufacturing artifacts
```

Proyectar 3D no se abandona ni se degrada. Sigue siendo la ruta nativa para usuarios que
necesitan velocidad, simplicidad y continuidad sin depender de SketchUp.

## 2. Propuesta de valor

> **SketchUp diseña. Muebles entiende cómo se fabrica.**

No competimos contra SketchUp como editor 3D generalista. Lo usamos cuando ya es la
herramienta de autoría preferida y concentramos el moat en:

- catálogo y parametrización de muebles;
- BOM y piezas reproducibles;
- materiales y costos;
- hardware y machining;
- drilling por pieza/cara;
- revisiones, approvals y `ProductionRelease`;
- cut plans y manufacturing preflight;
- machine profiles/postprocessors;
- labels, documentación, ejecución de planta e instalación;
- trazabilidad y job costing.

## 3. Boundary de ownership

| Concern | SketchUp extension | Muebles | Machine adapter |
|---|---|---|---|
| Selección, drag, transform y viewport | **Owns** | Observa intent | No participa |
| Geometría visual de autoría | **Owns** | Puede validar contexto | No participa |
| Stable IDs y metadata envelope | Captura/preserva | **Owns schema y validación** | Consume manifest |
| Catálogo y parameters permitidos | Presenta referencias | **Owns** | No participa |
| BOM, parts y material requirements | No calcula | **Owns** | Consume DTO resuelto |
| `HardwarePlacement` intent | Edita interacción | **Owns semántica y resolution** | Consume drilling resuelto |
| Drilling/machining | Visualiza resultado | **Owns** | Serializa capacidades soportadas |
| Revision, fingerprint y idempotency | Propaga tokens | **Owns** | Propaga provenance |
| Preflight y release | Presenta errores | **Owns** | Declara capabilities |
| PTX/DXF/machine output | No genera | Orquesta y autoriza | Serializa formato específico |
| Evidencia de compatibilidad | No afirma | Registra soporte | Requiere field evidence |

### Regla de implementación

Ruby puede validar estructura básica para mejorar UX, pero esa validación nunca sustituye
el preflight autoritativo. No se implementan en SketchUp:

- BOM resolution;
- cut-list generation;
- drilling rules;
- kerf, nesting o cut order;
- machine capability inference;
- stale/release decisions;
- postprocessor logic.

## 4. Contrato conceptual

El intercambio usa un envelope versionado descrito en
[`sketchup-manufacturing-contract.md`](sketchup-manufacturing-contract.md).

Principios:

1. identifiers estables, no nombres visibles como primary keys;
2. unidades explícitas en mm y ángulos en grados;
3. coordinate frames declarados;
4. authoring intent separado de resolved manufacturing data;
5. imports idempotentes;
6. errores estructurados y localizables en SketchUp;
7. todo output fabricable vinculado a `designRevisionId` y `bomFingerprint`;
8. capabilities negociadas antes del export;
9. unknown/ambiguous falla de forma segura.

## 5. Roadmap por fases

| Fase | Prioridad | Resultado | Issue |
|---|---|---|---:|
| 0 | P0 | Strategy, ADR y manufacturing contract | [#344](https://github.com/tiagofur/muebleria/issues/344) |
| 1 | P0 | Extension bootstrap | [#345](https://github.com/tiagofur/muebleria/issues/345) |
| 1 | P0 | Semantic metadata + round-trip | [#346](https://github.com/tiagofur/muebleria/issues/346) |
| 2 | P0 | Manufacturing preflight | [#347](https://github.com/tiagofur/muebleria/issues/347) |
| 2 | P0 | PTX import/readback validation | [#348](https://github.com/tiagofur/muebleria/issues/348) |
| 3 | P1 | Parametric library MVP | [#349](https://github.com/tiagofur/muebleria/issues/349) |
| 3 | P1 | Hardware placement/machining sync | [#350](https://github.com/tiagofur/muebleria/issues/350) |
| 4 | P1 | Machine profiles/postprocessors | [#351](https://github.com/tiagofur/muebleria/issues/351) |
| 4 | P1 | Client A machine pack | [#352](https://github.com/tiagofur/muebleria/issues/352) |
| 4 | P1 | Client B machine pack | [#353](https://github.com/tiagofur/muebleria/issues/353) |
| 5 | P1 | Golden/E2E manufacturing tests | [#354](https://github.com/tiagofur/muebleria/issues/354) |
| 6 | P2 | Packaging/licensing/update strategy | [#355](https://github.com/tiagofur/muebleria/issues/355) |

El primer slice implementable después de aprobar documentación es:

```text
contract approved
→ machine dossiers collected
→ extension skeleton
→ semantic round-trip
→ one manufacturable cabinet
```

## 6. Machine dossiers y evidencia

Client A y Client B son aliases opacos. Ningún issue, fixture, log o documento público
debe incluir identidad, contacto, dirección, precios, credentials, hostnames o paths
privados.

Cada dossier registra:

- opaque client key;
- machine, controller, software y versiones confirmadas;
- input formats aceptados;
- units, axes, tools y constraints relevantes;
- sample job sanitizado;
- expected result y `bomFingerprint`;
- import/readback evidence;
- operator checklist/sign-off;
- resultado `validated`, `partial` o `unsupported`;
- known limitations.

### Quality gate

Que un archivo abra no demuestra compatibilidad. La afirmación requiere:

1. export reproducible;
2. import en la versión exacta del software receptor;
3. readback de cantidades, dimensiones, orientación y operaciones relevantes;
4. comparación expected/actual;
5. operator sign-off en entorno seguro/no productivo.

Un pack nunca demuestra soporte para otra máquina, versión o cliente.

## 7. Manufacturing preflight

Muebles debe rechazar antes de fabricar:

- schema/version desconocido;
- stable IDs duplicados o referencias rotas;
- units/coordinate frame ambiguos;
- catalog items ausentes o incompatibles;
- dimensions/material/thickness inválidos;
- hardware placement sin host/face/role válido;
- drilling conflictivo o fuera de la pieza;
- revisión stale o fingerprint inconsistente;
- capability requerida no soportada por `MachineProfile`;
- blockers críticos de lifecycle/release.

El error vuelve con `code`, `message`, `entityId`, `path`, `severity` y `remediation` para
que el usuario lo corrija en el contexto correcto, sin mover la regla a SketchUp.

## 8. Límite comercial

El programa se activa por demanda concreta, pero cada promesa queda acotada:

- no vender “compatible con todas las CNC”;
- no prometer machine code sin versión de hardware/software confirmada;
- no tratar PTX genérico como garantía de corte correcto;
- no mezclar roadmap con contrato comercial específico;
- no distribuir un adapter sin fixture, preflight y evidencia correspondientes.

La venta puede describir la ruta objetivo y el estado de validación. Sólo una combinación
exacta `machine + controller + softwareVersion + profileVersion` validada puede
presentarse como compatible.

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Duplicar reglas en Ruby | Contract tests y review de ownership |
| Nombres/geometry como identidad | Stable IDs + catalog references |
| Drift entre modelo y fabricación | `designRevisionId` + `bomFingerprint` + stale detection |
| Variantes de máquina ocultas | `MachineProfile` versionado y capability negotiation |
| Claim prematuro de compatibilidad | Import/readback + operator sign-off |
| Dos clientes contaminan el core | Machine packs aislados; dominio neutral |
| Scope CAD infinito | SketchUp owns general authoring; Muebles no recrea SketchUp |
| Proyectar queda relegado | Roadmap y quality bar nativos continúan en #308/#309 |
| Update rompe modelos | Schema migration, compatibility matrix y rollback |

## 10. Esta semana

- [ ] Revisar y aprobar #344 mediante un PR sólo de documentación.
- [ ] Recolectar dossiers sanitizados de Client A y Client B.
- [ ] Congelar un fixture PTX y expected readback sin ejecutar producción.
- [ ] Confirmar machine/controller/software/version de cada piloto.
- [ ] Preparar acceptance de #345 y #346.
- [ ] Mantener el trabajo de producción fuera de este slice documental.

## 11. Definition of Done del programa

- contract versionado y aprobado;
- semantic round-trip sin pérdida de identity/units;
- preflight bloquea ambigüedad y stale revisions;
- un gabinete manufacturable recorre el flujo completo;
- PTX/machine compatibility tiene field evidence;
- Client A y Client B permanecen aislados;
- goldens detectan drift;
- packaging, licensing, updates y rollback están definidos;
- Proyectar 3D y SketchUp convergen a la misma manufacturing truth.

## 12. Fuentes canónicas

| Concern | Autoridad |
|---|---|
| Programa y fases | Este documento + [#290](https://github.com/tiagofur/muebleria/issues/290) |
| Decisión de ownership | [ADR-0001](adr/0001-sketchup-authoring-muebles-manufacturing-truth.md) |
| Contrato conceptual | [SketchUp Manufacturing Contract](sketchup-manufacturing-contract.md) |
| Arquitectura general | [Arquitectura](architecture.md) |
| Lifecycle/release/stale | [Project Lifecycle](project-lifecycle.md) |
| Pieza→mueble | [Production Flow v2](production-flow-v2.md) |
| Producto | [PRD v2](prd-v2.md) |
| Prioridad comercial | [Roadmap Comercial v2](roadmap-comercial-v2.md) |
| Proyectar nativo | [Proyectar North Star](proyectar-3d-north-star.md) |
| Verificación | [Verification](verification.md) |
| Implementación histórica | `feature_list.json` + `progress/history.md` |

Los documentos bajo `docs/history/` preservan decisiones anteriores y no se reescriben
para simular que esta estrategia siempre existió.
