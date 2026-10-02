# Perfiles de herrajes (Hardware Profiles)

> Estado: **contrato canónico** definido por #912, consolidado en #920.
> Este documento es el mapa de entrada para cualquier agente que toque
> Hardware, perfiles, asignaciones por lado, relationships, recetas, BOM o
> machining. Complementa
> [Factory construction and joinery](factory-construction-and-joinery.md) y
> [Manufacturing Library Platform](manufacturing-library-platform.md); no crea
> otro catálogo, motor ni ledger. El compañero operativo (flujo, secuencia y
> handoff) es [hardware-profile-flow.md](hardware-profile-flow.md).

## 1. Glosario

| Concepto | Definición | Dónde vive |
|---|---|---|
| **Hardware** | Lo que se compra: código/SKU, unidad, costo, categoría, roles compatibles. | Catálogo canónico (`domain.Hardware`, tabla `hardwares`, API `/api/catalog/hardware`). |
| **Hardware Profile** | La solución técnica/comercial que se aplica en un contacto: una o más referencias a Hardware con cantidades y rol de aplicación, más la referencia a la receta que la mecaniza. | `domain.HardwareProfile` (`backend-go/internal/domain/hardware_profile.go:52`), tabla `hardware_profiles` (migración `000143`), en releases como kind `hardware_profile` (#913/#918). |
| **Hardware Profile Item** | Referencia `{hardwareId, quantity, applicationRole?}` dentro de un perfil. Cantidad por aplicación (por contacto). Nunca lleva código, precio ni unidad. | `hardware_profile.go:70` (dentro del perfil, columna `items` JSONB). |
| **Profile Recipe Body** | Cuerpo de la receta que hoy viaja **embebido** en el perfil (`recipe` JSONB): variantes por cara destino, cada una con sus reglas por participante. | `domain.ProfileRecipeBody` (`hardware_profile.go:92`), columna `recipe` (migración `000145`). |
| **Component Side Assignment** | Declaración de qué perfil aplica a un lado de una definición de componente. El lado es una de las **seis caras canónicas de tablero** (`front/back/left/right/top/bottom`). | Tabla `component_side_assignments` (migración `000144`), API `/api/catalog/components/{id}/side-assignments`. |
| **Relationship / Contact** | Qué piezas concretas están relacionadas y cómo se tocan (motor de uniones #874). | Snapshot de autoría / resolve. |
| **ContactOperationRecipe** | Receta técnica versionada: reglas por participante (cara de entrada, eje, offsets, Ø, profundidad). **Autoridad de machining** — un solo motor. | `engine.ContactOperationRecipe` (`backend-go/internal/domain/engine/authoring_contact_operation_contract.go:10`); el servidor la sintetiza desde el perfil pineado (`authoring_side_recipes.go:31`). |
| **Machining Operation** | Resultado manufacturable derivado, con provenance (`TechnicalProfileID/Revision`, `RecipeRevision`). | Salida del resolve (`engine/authoring_fixed_shelf.go:281-338`). |
| **Hardware Profile Demand** | Consumo comercial por `hardwareId`: cantidad × contactos verificados, con `sources` (perfil/revisión/relación/contactos). Fuera del fingerprint de manufactura. | `engine.HardwareProfileDemandLine` (`engine/authoring_machining.go:205`), derivado en `api/authoring_side_recipes.go:96`. |
| **Library Release (pinned)** | Release publicado e inmutable del que se leen los perfiles exactos: manifiesto + blobs direccionados por contenido. | `application.HardwareProfilesForRelease` (`standard_release_service.go:174`), publicado por `PublishReleaseWithManifest`. |
| **BOM** | Consumo comercial derivado: líneas de herraje resueltas por `hardwareId` contra el catálogo. | `HardwareLines` → `ResolvedHardwareLine` (#917 extiende a perfiles). |

## 2. Boundary

```text
Hardware  (catálogo: código, unidad, costo)          ← lo que se compra
   ↓ referenciado por ID, jamás copiado
Hardware Profile  (qué solución: items × cantidades + RecipeRef + recipe body)
   ↓ compilado al release (kind hardware_profile, definición inmutable)
Library Release publicado  (manifiesto + blobs por hash + refs materializadas)
   ↓ lectura pineada: HardwareProfilesForRelease(releaseId)
Component Side Assignment  (dónde aplica: cara canónica del componente)
   ↓
Relationship / Contact  (motor #874: contacto verificado)
   ↓
Technical Recipe  (ContactOperationRecipe versionada: cómo se mecaniza)
   ↓
Machining Operations  (por participante, con provenance)
   ↓
Hardware Profile Demand + BOM  (consumo por hardwareId; DXF/CNC adapters)
```

**Identidad**: `ContactOperationRecipe.TechnicalProfileID` **es** el ID de un
HardwareProfile. Los slots de provenance del wire
(`TechnicalProfileID/TechnicalProfileRevision/RecipeRevision`) se llenan desde
el perfil pineado del release vigente (#916); una unión sin perfil — o con un
perfil sin cuerpo de receta, que es lo que produce la UI de fábrica al no
editar recetas — sigue quedando en el terminal honesto
`TECHNICAL_PROFILE_REQUIRED`.

**Quién lee qué**: React y SketchUp capturan intención (perfil, lado,
relación). El backend resuelve la receta, valida la geometría de cada
operación y deriva el consumo. Ningún cliente calcula perforaciones ni
cantidades de compra.

## 3. Decisiones de contrato

1. **Referencia, nunca copia.** Un perfil nunca lleva código, precio ni unidad
   del herraje: solo `hardwareId` + cantidad + rol de aplicación. El precio y
   la unidad provienen del catálogo en el momento del consumo. El BOM nunca se
   deriva de la geometría de agujeros.
2. **Un perfil puede contener varios herrajes con cantidades independientes**
   (SPAX ×2; minifix + taquete 1+1). `hardwareId` único dentro del perfil:
   cantidades partidas en dos líneas son ambiguas y fallan.
3. **Lado semántico ≠ cara de montaje ≠ cara de entrada.** El lado del
   componente usa las seis caras canónicas de tablero (sin alias L1/W1);
   la cara física de montaje la verifica el contacto (A0a); la cara de
   entrada de herramienta la declara la receta (`entryFace` de cada regla).
4. **La receta es la autoridad de machining** — un solo motor
   (`deriveAuthoringMachining` + reconciliador de contactos). El perfil no
   calcula perforaciones; referencia la receta y aporta identidad/provenance.
5. **Precedencia** (de menor a mayor especificidad; wiring en #915/#916):
   1. Default técnico de biblioteca (Standard).
   2. Política/overlay de fábrica para la familia de unión (#775, namespace
      `hardware.`).
   3. Asignación de lado del componente (definición, revisión o instancia
      según el modelo vigente — nunca instance-override por defecto).
   4. Override explícito de relationship/contacto (lo que hoy viaja en
      `AuthoringRelationship.Recipes`).
   Empate conflictivo a igual especificidad produce error; nunca gana el
   último del array.
6. **Fail-closed** (`PROFILE_INVALID` / `ASSIGNMENT_INVALID`): identidad o
   revisión en blanco, cero items, cantidad ≤ 0, `hardwareId` duplicado,
   `recipeRef` a medias, lado desconocido, perfil inexistente o inactivo.
   Perfil faltante ⇒ no fabricable por esa unión; nunca fallback.
7. **Toda publicación materializa sus refs.** Un manifiesto sin fila en
   `library_release_resource_refs` es un recurso que ningún tenant puede leer:
   la política `library_resource_blobs_read` llega al blob por
   `definition_hash → refs → release → library`, así que la publicación
   inserta/actualiza la ref de cada recurso dentro de la misma transacción
   (`storage/manufacturing_library_publish.go`, paso 4). Un ref existente
   conserva su `resource_revision` pineada y solo refresca el
   `definition_hash`.
8. **Estándar se publica, no se muta.** `library_releases` es una transición
   de un sentido (`UPDATE … WHERE status='draft'`); manifiesto y blobs tienen
   trigger de inmutabilidad. Publicar Standard es superficie de staff Granete:
   la API exige `platform_admin` y la política RLS lo acepta sólo bajo el
   marcador transaccional `app.platform_admin` (migración `000146`). Un
   release ya publicado de verdad nunca se recompila.
9. **El consumo comercial viene de la resolución del perfil, no del
   drilling.** `deriveHardwareProfileDemand` suma `item.quantity × contactos
   verificados` (#917): un herraje que produce cinco operaciones sigue siendo
   una línea de compra. Vive fuera del fingerprint de manufactura a propósito.

## 4. Ejemplos

```text
SPAX simple                         Compuesto (minifix + taquete)
───────────────────────────         ───────────────────────────────
PERF-SPAX-50 (rev-1)                PERF-MINIFIX-DOWEL (rev-2)
  SPAX-4X50 × 2 (screw)               HER-MIN-15 × 1 (cam)
  recipeRef:                          HER-TAQ-8X30 × 1 (dowel)
    test:synthetic-fixed-shelf        recipeRef: (misma receta)
    @ test-1
       │                                    │
Componente.L1 → PERF-SPAX-50         Componente.W1 → PERF-MINIFIX-DOWEL
       │                                    │
Relationship → Contact → Recipe      Relationship → Contact → Recipe
(piloto + contrapeso por contacto)   (alojamiento cam + taquete)
       │                                    │
BOM: SPAX-4X50 × 2 (precio catálogo) BOM: minifix ×1 + taquete ×1
```

Un compuesto SPAX + taquete (tornillo + tarugo en la misma cara) sigue la
misma forma: dos items con roles de aplicación distintos y una receta con
reglas por participante.

Ver `contracts/hardwareProfile.contract.json` (fixture compartido Go/TS) para
las formas válidas y cada caso fail-closed.

### 4.1 Un componente con perfiles distintos por lado

Un mismo componente admite un perfil por cara; el servidor resuelve una receta
por cara y sólo una relationship `fixed-shelf-side` **sin recetas declaradas**
recibe esas recetas (si declara las suyas, la declaración gana y la
asignación no se inyecta):

```text
Componente DP-LAT  (18 mm)
   front → PERF-DEMO-MINIFIX-TAQUETE   (recipe demo:minifix-tarugo-fijo@demo-1)
   back  → (sin asignación: la unión queda TECHNICAL_PROFILE_REQUIRED)
Componente DP-LATD (18 mm)
   back  → PERF-DEMO-MINIFIX-TAQUETE   (mismo perfil, variante "back")
```

Un `fixed-shelf-side` que une `DP-LAT.front` con `DP-LATD.back` produce, con
2 contactos verificados, 4 operaciones (2 reglas × 2 contactos) y demanda
`minifix ×2`, `tarugo ×2`.

### 4.2 Cuerpo de receta real (el perfil demo de #955)

Las reglas se declaran por participante (`A`/`B`), con cara de entrada, eje
unitario, offset en el marco del contacto, Ø y profundidad. Este es el cuerpo
que el seed demo publica en el release Standard:

```json
{
  "recipeId": "demo:minifix-tarugo-fijo",
  "recipeRevision": "demo-1",
  "variants": [
    {
      "targetFace": "front",
      "rules": [
        { "ruleId": "cam-housing", "ruleRevision": "demo-1", "participantRole": "A",
          "operationRole": "housing", "entryFace": "bottom",
          "offsetMm": [0, 0, 0], "axis": [0, -1, 0], "diameterMm": 15, "depthMm": 13 },
        { "ruleId": "dowel-bore", "ruleRevision": "demo-1", "participantRole": "B",
          "operationRole": "dowel", "entryFace": "back",
          "offsetMm": [0, 18, 0], "axis": [0, -1, 0], "diameterMm": 8, "depthMm": 17 }
      ]
    },
    { "targetFace": "back", "rules": [ "…espejo: entryFace top / front…" ] }
  ]
}
```

La geometría se valida agujero por agujero antes de emitir la operación
(`engine/authoring_contact_operations.go:136-168`): el punto de entrada cae
exactamente en el plano de la cara declarada, el eje es la normal de esa cara
(cero en los otros dos ejes), `valor + profundidad` queda dentro de
`[0, dimensión]` y el radio respeta el borde. Una sola regla inválida deja el
contacto entero en `OPERATION_GEOMETRY_INVALID` — no se descarta el agujero y
se sigue.

## 5. Prohibiciones

- No segundo catálogo: los perfiles no duplican herrajes ni precios.
- No segundo motor de machining: el perfil no deriva agujeros.
- No BOM desde agujeros: el consumo deriva de items del perfil.
- No reglas de fabricante en React/SketchUp: cliente captura intención;
  el backend resuelve.
- No `latest` para históricos: `RecipeRevision` y `Revision` siempre
  explícitos; los releases pinean contenido exacto.
- No heurística por nombre/cercanía para elegir perfiles.
- No confundir lado semántico con cara de montaje ni con cara de entrada.
- No mezclar overlay manufacturero (`LibraryOverlay`, #775) con el overlay
  comercial (`StoreCatalogOverlay`).
- No publicar un manifiesto sin materializar `library_release_resource_refs`:
  el blob publicado sería invisible para toda tenant y la lectura pineada
  fallaría cerrada con "blob not found" (#955).
- No publicar Standard desde una identidad sin `platform_admin`: la política
  RLS y el endpoint de publicación rechazan cualquier otra compañía.
- No re-seed que invente estructura de catálogo. El conjunto demo de zoclo
  (roles `ZOCLO`/`ZOCLO_PERFIL`, herrajes `HER-ZOC-*`, componente `COM-ZOC-01` y
  los dos módulos que lo usan) existe sólo junto a la estructura compuesta
  `EST-COMP-600`. Si esa composición no está en la organización, el seed omite
  el conjunto **completo** y lo registra en el log: escribir una `structure_id`
  inexistente abortaba todo `POST /api/seed` con FK 23503 (#955), y sembrar la
  mitad dejaría roles huérfanos atando materiales del taller a una convenience
  de la demo.

## 6. Integraciones

| Owner | Relación con perfiles |
|---|---|
| #874 (uniones/recetas) | La receta consumida por el motor gana provenance del perfil; un perfil por lado no fuerza recetas a relaciones incompatibles. |
| #911 (receta fixed-shelf) | `TechnicalProfileID` declarado en el wire = ID del perfil; el terminal sin perfil sigue honesto. |
| #772/#773 (biblioteca) | Los perfiles entran a releases como kind `hardware_profile` con `Revision` + `DefinitionHash`; Free/Standard comparten recursos canónicos. |
| #775 (overlay) | El cliente parametriza SU fábrica (cantidades, selección de perfil) en el overlay, namespace `hardware.`; Standard no se muta. |
| #443 (persistencia) | Tabla/API generadas del perfil: #913. |
| #784 (defaults de Design) | Selecciona capacidades autorizadas; no sustituye la política de fábrica ni crea perfiles. |
| #917 (BOM) | Los items del perfil alimentan líneas de consumo resueltas contra el catálogo. |
| #916 (resolve) | El resolve consume el perfil pineado del release efectivo; producción pasa de `nil` a perfiles reales. |
| #918 (pinning) | `HardwareProfilesForRelease` + `GET /api/manufacturing-libraries/standard/releases/{releaseId}/hardware-profiles`: lectura por release exacto, sin `latest`. |
| #955 (publicación) | `CompileLibraryRelease` (puro) → `PublishReleaseWithManifest` (atómico, materializa refs) y `POST /api/manufacturing-libraries/standard/releases/{releaseId}/publish` (sólo `platform_admin`). El seed demo (`POST /api/seed`) crea el primer perfil con receta y publica el draft Standard real. |

## 7. Versionado

- Cada perfil lleva `Revision` no vacía desde el día uno; cambiar la técnica
  (Ø, profundidad, cantidades) exige nueva revisión.
- Cada regla lleva su propio `RuleRevision` y la receta su `RecipeRevision`;
  el par `recipeId@recipeRevision` es identidad, no etiqueta.
- El recurso de hardware en el manifiesto se revisiona con su `updated_at`
  (un cambio de precio re-revisiona el herraje) mientras los blobs de perfil
  ya pineados quedan intactos: la separación comercial/técnica que #918 pide.
- Los releases de biblioteca referencian `{kind: "hardware_profile", id,
  revision, definitionHash, packageKind}` — contenido inmutable publicado.
- `design_revisions.effective_library_release_id` congela el release efectivo;
  las preferencias posteriores nunca reescriben lo liberado.
- La escritura de perfiles es optimista: `version` + ETag `v<N>` con
  `If-Match` en PUT/DELETE.
- La parametrización de fábrica vive en el overlay con su propia base/rebase;
  un rebase con conflicto semántico (nuevo espesor vs profundidad de receta
  vieja) no activa el candidato.

## 8. Estado real del código (2026-10-01)

Implementado y verificado:

- Contrato de dominio Go + espejo TypeScript + fixture compartido
  (`contracts/hardwareProfile.contract.json`, paridad en ambos runtimes).
- Persistencia y API de perfiles (CRUD con `If-Match`), assignments por cara
  (`GET`/`PUT`/`DELETE .../side-assignments`) y panel React de asignación.
- Publicación Standard (compile + publish + refs), lectura pineada y resolve
  consumiendo el perfil del release vigente, con demanda por `hardwareId`.
- Seed demo con perfil + receta publicados de verdad y prueba de browser
  (`tests/organization/hardware-profile-demo.spec.ts`).

Pendiente (no asumir que existe):

- **Autoría del cuerpo de receta por API**: el OpenAPI declara `recipe` en
  `HardwareProfileWrite`, pero el cuerpo de escritura Go no lo acepta
  (validación estricta de campos desconocidos). Hoy el `recipe` se escribe
  por el seed; falta el endpoint/superficie para capturar recetas.
- **Superficie SketchUp**: SketchUp consume el resolve; no autoría perfiles ni
  asignaciones.
- **Cliente OpenAPI generado**: las rutas de side-assignments se construyen
  con un `{side}` sin sustituir; usar el cliente crudo hasta regenerarlo.
- **Perfiles técnicos de producción**: las cotas del perfil demo son
  demo-grade; entran con specs de proveedor verificadas y bump de revisión.
- PTX/CNC nativo (#879), kinds nuevos de unión y el golden vertical (#919).

## 9. Fuera de alcance de este contrato

PTX/CNC (#879), kinds nuevos de unión (techo, manguete, respaldo, cajones) y
perfiles técnicos de producción reales (entrada externa: especificaciones de
fabricante verificadas).
