# ODD — #784 R5: Batch rollout de defaults del Design con Impact Review

- Issue: #784 (`[P1][SU-UX-4] Design defaults, inheritance and contextual Inspector`), slice R5.
- Autorización: prompt del owner 2026-09-29 ("creamos el ODD").
- Lane: ODD. Estado: COMPLETED.
- Base: `feat/784-definition-aware-composition` (PR #922 @ `41e0b592`).
- Branch: `feat/784-r5-batch-rollout`.

## Objetivo

Permitir que el diseñador propague un acabado por defecto configurado a nivel de Diseño
a los muebles existentes en el modelo de forma explícita ("Aplicar a muebles existentes…"),
con un modal de revisión de impacto que distinga muebles compatibles, pendientes de heredar,
personalizados y no compatibles.
La aplicación reutiliza la infraestructura atómica de lote (#471 `submitBatchUpdate`)
preservando por defecto las personalizaciones individuales (`mode="override"`).

---

## Auditoría y Contrato Técnico

### 1. Read Model autoritativo del backend
El endpoint `GET /api/designs/{designId}/working-copy/material-provenance` ya calcula y devuelve:
- `inheritance_summary`:
  - `role`: identificador del rol (p. ej. `FRONT`, `BODY`).
  - `items`: total de muebles compatibles en el diseño que ofrecen este rol.
  - `design_backed`: muebles enlazados al default del diseño (`mode="design"`).
  - `needs_rollout`: muebles con `mode="design"` cuyo material aplicado difiere del default actual.
  - `design_current`: muebles con `mode="design"` que ya tienen el default actual.
  - `overridden`: muebles con personalización explícita (`mode="override"`).
- `items`: lista detallada por mueble con `furniture_instance_id`, `furniture_definition_id` y su array `inheritance` (`role`, `mode`, `applied_material_id`, `design_default_material_id`, `needs_rollout`).

### 2. Capa Ruby (Contrato y Bridge)
- **`DesignInheritanceContract.parse!`**
  - Parsea `inheritance_summary` validando enteros y roles no vacíos.
  - Parsea `furniture_definition_id` en cada ítem de `items`.
- **`DesignInheritanceBridge.handle_get_design_inheritance`**
  - Serializa `inheritanceSummary` en el payload `onDesignInheritance`.
  - Incluye `furnitureDefinitionId` en cada ítem mapeado.

### 3. Capa JavaScript (`granete-design-inspector.js` y UI)
- **Estado e Indexación:**
  - `onDesignInheritance` guarda `state.inheritanceSummary` indexado por rol.
  - Almacena el mapeo de instancias con su `furnitureDefinitionId` y roles.
- **Acción en el Inspector:**
  - En cada fila de rol en `renderRow`, si `state.inheritanceSummary[role]` existe y `items > 0`:
    Se muestra el botón `[Aplicar a muebles existentes…]` (`#design-inspector-rollout-<role>`).
- **Modal de Impact Review:**
  Presenta el desglose exacto antes de ejecutar:
  - Título: `Aplicar <MaterialName> a <RoleLabel>`
  - Estadísticas:
    - `<items> muebles compatibles`
    - `<needs_rollout> heredarán/cambiarán`
    - `<overridden> tienen personalización`
    - `<unsupported> no admite este rol` (donde `unsupported = totalItems - items`)
  - Opciones de alcance (Radios):
    - `● Conservar personalizados (recomendado)` (afecta a `needs_rollout`)
    - `○ Reemplazar también personalizados` (afecta a `needs_rollout + overridden`)
  - Botones:
    - `[Cancelar]` (cierra sin efecto)
    - `[Aplicar a N]` (despacha mutación por lote)
- **Despacho Batch (#471):**
  - Arma el arreglo de ítems afectados:
    ```javascript
    {
      instanceId: item.furnitureInstanceId,
      definitionId: item.furnitureDefinitionId,
      materialChoices: { [role]: designDefaultMaterialId },
      materialChoiceModes: { [role]: 'design' }
    }
    ```
  - Invoca `window.GraneteMutation.submitBatchUpdate(itemsToApply)`.
  - Al completar la mutación, invoca `refreshInheritance()` para que los badges ("Diseño" / "Personalizado") y contadores se refresquen desde la verdad del backend.

---

## Criterios de Aceptación

- [x] `DesignInheritanceContract` en Ruby valida y parsea `inheritance_summary` y `furniture_definition_id`.
- [x] `DesignInheritanceBridge` emite `inheritanceSummary` a `onDesignInheritance` sin perder correlación de `requestId`.
- [x] En el Inspector de Diseño (sin selección), cada rol con muebles compatibles expone `[Aplicar a muebles existentes…]`.
- [x] El modal de Impact Review computa y muestra los 4 contadores honestos sin inventar valores.
- [x] Por defecto (`Conservar personalizados`), los muebles con `mode="override"` quedan intactos y no se incluyen en el lote.
- [x] Al seleccionar `Reemplazar también personalizados`, los muebles personalizados se incluyen en el lote con `materialChoiceModes: { [role]: 'design' }`.
- [x] La mutación viaja a través de `GraneteMutation.submitBatchUpdate` en un solo Undo de SketchUp.
- [x] Tras el éxito del lote, se re-consulta la proyección de herencia actualizando la UI.
- [x] Pruebas unitarias Ruby (`design_inspector_bridge_test.rb`, `project_furniture_test.rb`) y JS (`granete_design_inspector_test.js`) verifican el contrato y los flujos.

---

## Negative Proofs Requeridas

- Falla si cambiar un default muta silenciosamente los muebles colocados.
- Falla si se deduce herencia por igualdad de IDs de material en vez del `mode` autoritativo.
- Falla si el modal se saltea la opción por defecto de conservar personalizados.
- Falla si un fallo parcial en el lote reporta éxito total.
- Falla si se crea un pipeline de mutación ad-hoc en lugar de usar `GraneteMutation.submitBatchUpdate` (#471).

---

## Plan de Implementación

1. **Paso 1: Contrato Ruby y Bridge**
   - Actualizar `DesignInheritanceContract` para incluir `inheritance_summary` y `furniture_definition_id`.
   - Actualizar `DesignInheritanceBridge` para reenviarlos en `onDesignInheritance`.
   - Pruebas unitarias en Ruby.
2. **Paso 2: UI e Impact Review en `granete-design-inspector.js`**
   - Incorporar `inheritanceSummary` en `onDesignInheritance`.
   - Agregar botón `[Aplicar a muebles existentes…]` en filas con muebles compatibles.
   - Construir modal de Impact Review con radios y contador dinámico `[Aplicar a N]`.
   - Conectar el click de confirmación con `GraneteMutation.submitBatchUpdate`.
   - Escuchar resultado del lote y refrescar herencia.
3. **Paso 3: Pruebas unitarias en JS**
   - Pruebas en `test/js/granete_design_inspector_test.js` para renderizado del botón, cálculo del review, selección de radios y payload exacto a `submitBatchUpdate`.
4. **Paso 4: Verificación Integral**
   - Ejecutar `bundle exec rake verify` y tests JS de la extensión.

---

## Ronda de corrección (review independiente 2026-09-29)

El PR nació sobre el base viejo de #922 (`41e0b592`). La ronda de corrección
de #922 introdujo el tercer modo `definition` (fallback curado de definición)
y el conteo `definition_backed`; este slice se integró a ese contrato:

- **Merge del base corregido** (`bf8619e9`): conflicto único en
  `DesignInheritanceContract::MODES` resuelto hacia la constante canónica;
  `parse_role!` acepta `definition` automáticamente.
- **`definition_backed` de punta a punta:** `SUMMARY_FIELDS` y el struct
  `RoleInheritanceCount` lo exigen (el server siempre lo envía; ausente ⇒
  fail-closed), el bridge lo serializa como `definitionBacked`, y el
  `summaryMap` JS lo conserva.
- **Impact review honesto con el tercer bucket:** nueva línea
  "N usará(n) el default del diseño (fallback de definición)". Los contadores
  y la selección del lote derivan del MISMO escaneo per-item (modos explícitos
  del server; la igualdad sólo decide si un valor difiere, igual que el
  `needsRollout` del server) — el "Aplicar a N" no puede discrepar del lote
  despachado.
- **Scope preserve adopta los `definition`:** no son excepciones de usuario.
  Se incluye sólo al que aún difiere del default (el que ya lo lleva es
  no-op y queda fuera). El radio se re-etiqueta "actualiza muebles en modo
  Diseño y Definición". Replace añade los override.
- **Doble toast eliminado:** el feedback de usuario de TODO batch pertenece
  al lane #471 (`granete-inspector.onBatchUpdateResult`); el listener del
  design-inspector sólo refresca la proyección (`requestInheritance(true)`),
  sin apilar un segundo toast idéntico.
- Cuerpo del PR: sección "Alcance restante" explícita (Delivery: partial).

### Verificación ronda de corrección
- `bundle exec rake unit`: PASS (1272 runs, 9426 assertions, 0 failures).
- `bundle exec rake lint`: PASS (274 archivos, 0 ofensas).
- JS: `granete_design_inspector` 42, `granete_configurator` 36,
  `granete_material_roles` 34, `granete_inspector` 48, `dialog_inspector` 74,
  `dialog_placement_preview` 13 — todos PASS.
- CI remota del HEAD nuevo: ver body del PR (la matriz completa corre tras
  retarget a main cuando #922 mergee; en base feature-branch sólo corre
  Publication metadata).
