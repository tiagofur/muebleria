# SketchUp + Muebles — Estrategia de autoría y fabricación

> **Estado:** CANÓNICO  
> **Fecha:** 2026-08-24  
> **META:** [#290](https://github.com/tiagofur/muebleria/issues/290)  
> **Decisión:** **SketchUp owns authoring/interaction; Muebles owns manufacturing truth.**

Muebles for SketchUp permite usar SketchUp como superficie profesional de autoría sin
convertir el modelo, la geometría visible ni Ruby en la fuente de verdad industrial.
SketchUp captura intención; Muebles resuelve y valida qué se fabrica.

## 1. Resultado de producto

Muebles mantiene tres rutas que convergen al mismo `Project/Job`:

| Ruta | Uso principal | Resultado |
|---|---|---|
| **Cotizar rápido** | catálogo + options sin abrir 3D | quote + BOM preliminar |
| **Proyectar 3D** | diseño modular nativo y rápido | authoring intent nativo |
| **Muebles for SketchUp** | autoría 3D profesional | authoring intent externo |

Las tres rutas convergen al mismo núcleo:

```text
Authoring intent
      ↓
Catalog + relationship/joint resolution
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
necesitan velocidad y simplicidad sin depender de SketchUp.

## 2. Propuesta de valor

> **SketchUp diseña. Muebles entiende cómo se fabrica.**

El moat se concentra en:

- catálogo y parametrización;
- relaciones constructivas paramétricas entre piezas;
- BOM y piezas reproducibles;
- materiales, cantos y costos;
- hardware y machining;
- drilling por pieza/cara;
- revisiones, approvals y `ProductionRelease`;
- manufacturing preflight;
- machine profiles/postprocessors;
- producción, instalación, trazabilidad y job costing.

## 3. Ownership

| Concern | SketchUp extension | Muebles | Machine adapter |
|---|---|---|---|
| Selección, drag, transform y viewport | **Owns** | Observa intent | No participa |
| Geometría visual | **Owns** | Valida contexto cuando aplica | No participa |
| Stable IDs / metadata envelope | Captura/preserva | **Owns schema y validación** | Consume manifest |
| Catálogo y parameters | Presenta/edita | **Owns** | No participa |
| `PartRelationship` / joint intent | Captura/edita relaciones y anchors | **Owns semantics/resolution** | Consume resultado |
| BOM, parts, materiales y costos | No calcula | **Owns** | Consume DTO resuelto |
| `HardwarePlacement` intent | Edita interacción | **Owns semantics/resolution** | Consume drilling |
| Derived placements | Visualiza feedback | **Owns** | Consume output |
| Drilling/machining | Visualiza resultado | **Owns** | Serializa lo soportado |
| Revision/fingerprint/idempotency | Propaga | **Owns** | Propaga provenance |
| Preflight/release | Presenta | **Owns** | Declara capabilities |
| PTX/DXF/machine output | No genera | Orquesta/autoriza | Serializa formato |

Ruby puede validar estructura básica para UX, pero no implementa:

- BOM resolution;
- joint/relationship resolution;
- derived hardware rules;
- drilling rules;
- nesting/kerf/cut order;
- machine capability inference;
- stale/release decisions;
- postprocessing.

Una perforación derivada de una unión o herraje no es authoring truth independiente.
SketchUp expresa la intención semántica; Muebles deriva las operaciones y conserva
provenance hacia la relación, joint o placement que las originó.

## 4. Contrato conceptual

El intercambio usa un envelope versionado descrito en
[`sketchup-manufacturing-contract.md`](sketchup-manufacturing-contract.md).

Principios:

1. stable IDs, nunca nombres visibles como primary keys;
2. unidades explícitas en mm y ángulos en grados;
3. coordinate frames declarados;
4. authoring intent separado de resolved manufacturing data;
5. relaciones entre piezas expresadas como IDs, roles y anchors semánticos;
6. drilling/machining derivado nunca se persiste como authoring truth primaria;
7. imports idempotentes;
8. errores estructurados y localizables;
9. todo output fabricable vinculado a `designRevisionId` y `bomFingerprint`;
10. derived operations con provenance a relationship/joint/placement;
11. capabilities negociadas antes del export;
12. unknown/ambiguous falla de forma segura.

## 5. Roadmap por fases

| Fase | Prioridad | Resultado | Issue |
|---|---|---|---:|
| 0 | P0 | Strategy, ADR y manufacturing contract | [#344](https://github.com/tiagofur/muebleria/issues/344) |
| 1 | P0 | Extension bootstrap | [#345](https://github.com/tiagofur/muebleria/issues/345) |
| 1 | P0 | Semantic metadata + round-trip | [#346](https://github.com/tiagofur/muebleria/issues/346) |
| 2 | P0 | Parametric part relationships + joint-driven machining | [#356](https://github.com/tiagofur/muebleria/issues/356) |
| 2 | P0 | Manufacturing preflight | [#347](https://github.com/tiagofur/muebleria/issues/347) |
| 2 | P0 | PTX import/readback validation | [#348](https://github.com/tiagofur/muebleria/issues/348) |
| 3 | P1 | Parametric library MVP | [#349](https://github.com/tiagofur/muebleria/issues/349) |
| 3 | P1 | Hardware placement/machining sync | [#350](https://github.com/tiagofur/muebleria/issues/350) |
| 4 | P1 | Machine profiles/postprocessors | [#351](https://github.com/tiagofur/muebleria/issues/351) |
| 4 | P1 | Client A machine pack | [#352](https://github.com/tiagofur/muebleria/issues/352) |
| 4 | P1 | Client B machine pack | [#353](https://github.com/tiagofur/muebleria/issues/353) |
| 5 | P1 | Golden/E2E manufacturing tests | [#354](https://github.com/tiagofur/muebleria/issues/354) |
| 6 | P2 | Packaging/licensing/update strategy | [#355](https://github.com/tiagofur/muebleria/issues/355) |

## 6. Primer vertical slice demostrable

```text
contract approved
→ machine dossiers collected
→ extension skeleton
→ semantic round-trip
→ parametric part relationships / joints
→ one manufacturable cabinet
→ hardware placement + machining sync
→ minimum authoritative preflight
→ commercial demo
```

El preflight completo sigue siendo P0, pero su implementación total no debe bloquear el
primer vertical slice si existe un subset mínimo autoritativo que impida producir datos
ambiguos o inseguros.

### Primer hito comercial

Un gabinete real en SketchUp puede cambiar dimensiones, mover/agregar/eliminar entrepaños
y mover herrajes; Muebles recalcula correctamente piezas, BOM, cantos y machining sin
intervención manual sobre coordenadas CNC. Cualquier cambio que afecte una revisión ya
liberada vuelve stale el output anterior.

## 7. Invariante de relaciones paramétricas

El caso canónico es:

```text
Shelf S1
  ↔ PartRelationship / Joint J1
  ↔ LeftSide / RightSide
  ↔ JoinerySystem
  ↔ derived placements / machining
```

Si `Shelf S1` se mueve, agrega, elimina o cambia de sistema de unión:

- cambia authoring intent / anchors;
- Muebles vuelve a resolver la relación;
- cambia únicamente machining dependiente;
- machining no relacionado permanece idéntico;
- `bomFingerprint`/revision cambian cuando cambia manufacturing truth;
- un `ProductionRelease` anterior queda stale.

Una bisagra manual sigue otra cadena:

```text
move hinge
→ HardwarePlacement intent changes
→ hinge machining changes
→ shelf machining remains unchanged
```

Esto se define en [#356](https://github.com/tiagofur/muebleria/issues/356) y se prueba en
[#354](https://github.com/tiagofur/muebleria/issues/354).

## 8. Manufacturing preflight

Muebles bloquea antes de fabricar:

- schema/version desconocido;
- IDs duplicados o referencias rotas;
- units/coordinate frame ambiguos;
- catálogo ausente o incompatible;
- relationships/joints inválidos, huérfanos o geométricamente imposibles;
- dimensions/material/thickness inválidos;
- hardware placement sin host/face/role válido;
- drilling fuera de límites, profundidad inválida o colisión crítica;
- revisión stale/fingerprint inconsistente;
- capability requerida no soportada;
- blockers críticos de lifecycle/release.

Los errores vuelven con `code`, `message`, `entityId`, `path`, `severity` y `remediation`.

### Slice mínimo para demo

Debe validar al menos identity/revision/fingerprint, catalog references,
relationships/joints resolubles, dimensiones/espesores, drilling bounds/depth, colisiones
críticas conocidas y bloqueo seguro ante ambigüedad crítica.

## 9. Machine evidence

La compatibilidad sólo puede afirmarse para una combinación exacta de máquina,
controlador, software y profile version que tenga evidencia reproducible.

Abrir un archivo no demuestra compatibilidad. El gate exige:

1. export reproducible;
2. import en el software receptor correcto;
3. readback de cantidades, dimensiones, orientación y operaciones relevantes;
4. expected vs actual;
5. operator sign-off en entorno seguro/no productivo.

Client A y Client B permanecen aislados mediante dossiers, profiles y fixtures propios.

## 10. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Duplicar reglas en Ruby | contract tests + ownership review |
| Nombres/geometry como identidad | stable IDs + catalog references |
| Machining desconectado de intención | relationships/joints + provenance + #356 |
| Drift modelo/fabricación | revision + fingerprint + stale detection |
| Variantes ocultas de máquina | versioned `MachineProfile` + capabilities |
| Claim prematuro | import/readback + operator sign-off |
| Clientes contaminan el core | machine packs aislados; dominio neutral |
| Scope CAD infinito | SketchUp owns general authoring |
| Proyectar relegado | #308/#309 mantienen su quality bar |

## 11. Esta semana

- [ ] Aprobar #344 mediante este PR documental.
- [ ] Recolectar dossiers sanitizados de Client A y Client B.
- [ ] Congelar un fixture PTX y expected readback sin producción real.
- [ ] Confirmar machine/controller/software/version de cada piloto.
- [ ] Preparar acceptance de #345, #346 y #356.
- [ ] Mantener producción fuera de este slice documental.

## 12. Definition of Done del programa

- contract versionado y aprobado;
- semantic round-trip sin pérdida de identity/units;
- relationships/joints generan machining derivado, determinístico y trazable;
- mover/agregar/eliminar una pieza relacionada recalcula sólo lo dependiente;
- preflight bloquea ambigüedad y stale revisions;
- un gabinete manufacturable recorre el flujo completo;
- PTX/machine compatibility tiene field evidence;
- Client A y Client B permanecen aislados;
- goldens detectan drift de shelf/joint/hinge;
- packaging, licensing, updates y rollback están definidos;
- Proyectar 3D y SketchUp convergen a la misma manufacturing truth.

## 13. Fuentes canónicas

| Concern | Autoridad |
|---|---|
| Programa y fases | Este documento + [#290](https://github.com/tiagofur/muebleria/issues/290) |
| Ownership | [ADR-0001](adr/0001-sketchup-authoring-muebles-manufacturing-truth.md) |
| Contrato conceptual | [SketchUp Manufacturing Contract](sketchup-manufacturing-contract.md) |
| Relationships/joints | [#356](https://github.com/tiagofur/muebleria/issues/356) |
| Arquitectura general | [Arquitectura](architecture.md) |
| Lifecycle/release/stale | [Project Lifecycle](project-lifecycle.md) |
| Producción pieza→mueble | [Production Flow v2](production-flow-v2.md) |
| Producto | [PRD v2](prd-v2.md) |
| Prioridad comercial | [Roadmap Comercial v2](roadmap-comercial-v2.md) |
| Proyectar nativo | [Proyectar North Star](proyectar-3d-north-star.md) |
| Verificación | [Verification](verification.md) |

Los documentos bajo `docs/history/` preservan decisiones anteriores; esta estrategia no
reescribe el pasado.
