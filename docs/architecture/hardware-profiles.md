# Perfiles de herrajes (Hardware Profiles)

> Estado: **contrato canónico** definido por #912. Este documento es el mapa
> de entrada para cualquier agente que toque Hardware, perfiles, asignaciones
> por lado, relationships, recetas, BOM o machining. Complementa
> [Factory construction and joinery](factory-construction-and-joinery.md) y
> [Manufacturing Library Platform](manufacturing-library-platform.md); no crea
> otro catálogo, motor ni ledger.

## 1. Glosario

| Concepto | Definición | Dónde vive |
|---|---|---|
| **Hardware** | Lo que se compra: código/SKU, unidad, costo, categoría, roles compatibles. | Catálogo canónico (`domain.Hardware`, tabla `hardwares`, API `/api/catalog/hardware`). |
| **Hardware Profile** | La solución técnica/comercial que se aplica en un contacto: una o más referencias a Hardware con cantidades y rol de aplicación, más la referencia a la receta que la mecaniza. | Recurso de catálogo nuevo (`domain.HardwareProfile`); en releases como kind `hardware_profile` (#913/#918). |
| **Hardware Profile Item** | Referencia `{hardwareId, quantity, applicationRole?}` dentro de un perfil. Cantidad por aplicación (por contacto). | Dentro del perfil. |
| **Component Side Assignment** | Declaración de qué perfil aplica a un lado de una definición de componente. El lado es una de las **seis caras canónicas de tablero** (`front/back/left/right/top/bottom`). | Definición del componente en la biblioteca; overridable por overlay de fábrica (#915). |
| **Relationship / Contact** | Qué piezas concretas están relacionadas y cómo se tocan (motor de uniones #874). | Snapshot de autoría / resolve. |
| **ContactOperationRecipe** | Receta técnica versionada: reglas por participante (cara de entrada, eje, offsets, Ø, profundidad). **Autoridad de machining** — un solo motor. | Declarada por relación en el wire hoy; su hogar persistente serán las referencias de perfil (#913/#916). |
| **Machining Operation** | Resultado manufacturable derivado, con provenance (`TechnicalProfileID/Revision`, `RecipeRevision`). | Salida del resolve. |
| **BOM** | Consumo comercial derivado: líneas de herraje resueltas por `hardwareId` contra el catálogo. | `HardwareLines` → `ResolvedHardwareLine` (#917 extiende a perfiles). |

## 2. Boundary

```text
Hardware  (catálogo: código, unidad, costo)          ← lo que se compra
   ↓ referenciado por ID, jamás copiado
Hardware Profile  (qué solución: items × cantidades + RecipeRef)
   ↓
Component Side Assignment  (dónde aplica: cara canónica del componente)
   ↓
Relationship / Contact  (motor #874: contacto verificado)
   ↓
Technical Recipe  (ContactOperationRecipe versionada: cómo se mecaniza)
   ↓
Machining Operations  (por participante, con provenance)
   ↓
BOM + manufacturing outputs  (consumo por hardwareId; DXF/CNC adapts)
```

**Identidad**: `ContactOperationRecipe.TechnicalProfileID` **es** el ID de un
HardwareProfile. Los slots de provenance del wire
(`TechnicalProfileID/TechnicalProfileRevision/RecipeRevision`) se llenan desde
aquí cuando el resolve consuma perfiles (#916); mientras tanto, producción se
queda en el terminal honesto `TECHNICAL_PROFILE_REQUIRED`.

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

Ver `contracts/hardwareProfile.contract.json` (fixture compartido Go/TS) para
las formas válidas y cada caso fail-closed.

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

## 7. Versionado

- Cada perfil lleva `Revision` no vacía desde el día uno; cambiar la técnica
  (Ø, profundidad, cantidades) exige nueva revisión.
- Los releases de biblioteca referencian `{kind: "hardware_profile", id,
  revision, definitionHash, packageKind}` — contenido inmutable publicado.
- `design_revisions.effective_library_release_id` congela el release efectivo;
  las preferencias posteriores nunca reescriben lo liberado.
- La parametrización de fábrica vive en el overlay con su propia base/rebase;
  un rebase con conflicto semántico (nuevo espesor vs profundidad de receta
  vieja) no activa el candidato.

## 8. Fuera de alcance de este contrato

CRUD React (#914), migraciones/API (#913), consumo en resolve (#916), BOM
(#917), pinning ejecutado (#918), PTX/CNC (#879), kinds nuevos de unión
(techo, manguete, respaldo, cajones) y perfiles técnicos de producción reales
(entrada externa: especificaciones de fabricante verificadas).
