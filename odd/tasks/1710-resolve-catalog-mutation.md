# G-ODD — #1710: authoring/resolve pierde las piezas de bisagra (mutación del catálogo compartido)

## Contexto
Descubierto en el vivo de #1579: la migración de catálogo quedó verificada por el canal
GET layout (5 bisagras a 2100), pero el plugin de SketchUp veía sus puertas SIN bisagras.
Fileada con el repro exacto del plugin (RBZ 0.1.126).

## Diagnóstico (24-11, sesión principal)
Instrumentación temporal del handler + probe Go contra la DB dev acotaron la corrupción:
- El motor, los inputs y TODAS las lecturas frescas del store eran correctas (2 placements, countRule=1).
- El snapshot del resolve (`loadWorkshopCatalogOnce` → `GetFullCatalog`) salía con la receta
  jaladera-only (1 placement, countRule=0) — exactamente el estado pre-migración
  (4 recetas de puerta × 3 placements = 12 en todo el catálogo).
- El mutador: `expandHingeCountRuleComponentsForUnit` / `dropHingeCountRulePlacements`
  (código de PR2 #1579) hacen `copy(out, agr.Components)` — copia SUPERFICIAL — y luego
  `out[i].Overrides.HardwarePlacements = ...` escribiendo a través del PUNTERO
  `Overrides` compartido con la entrada del catálogo del llamador.
- Gatillo en cada request de resolve: `buildWorkshopFurnitureCatalogValidated` llama
  `ResolveFurnitureLayout(m, composition, nil, nil)` por módulo para los conteos estimados;
  con choices=nil el patrón cae en `dropHingeCountRulePlacements` → borra el placement con
  countRule DEL CATÁLOGO COMPARTIDO. El dry-run + la pasada real del resolve y todo lo
  posterior en el proceso leen la receta ya cercenada → jaladera sola, 0 perforaciones.
- El canal GET layout no lo sufría porque resuelve en UNA pasada sobre catálogo recién
  cargado (la corrupción ocurre después de la emisión de herrajes).
- Pre-#1579 el catálogo no tenía placements con countRule → `countRuleDoorOf` salía temprano
  → regresión latente hasta la migración de hoy.
- TS verificado SIN el bug (spread inmutable en agregados.ts).

## Fix
`cloneOverridesWithPlacements` en hinge_count_rule.go: ambas escrituras ahora clonan el
`ComponentInstanceOverrides` y le colgan el slice nuevo; el catálogo del llamador queda
byte-idéntico y cada resolución re-expande desde la receta pristine.

## Regresión
`hinge_count_rule_catalog_purity_test.go`: resolve con choices=nil (estimación) + resolve
posterior con elecciones → el catálogo conserva el patrón y la segunda resolución compra
5 bisagras. Fallaba con el código viejo.

## Verificación
- go test engine completo + api completo OK (worktree desde origin/main 5d464f23).
- HTTP end-to-end contra :8081 con el árbol fijado: resolve del plugin → 6 herrajes
  (jaladera + 5 bisagras y=90/569.25/1048.5/1527.75/2007) y 6 operaciones de machining.
- La revisión del catálogo cambia (los conteos estimados ya no quedan sesgados por la
  corrupción); el plugin la re-fetcha sola por su reintento CATALOG_REVISION_STALE.

## Hallazgo aparte documentado en la issue
La release 0.3.70 (hoy 02:47) congeló revisiones VIEJAS de las recetas (AGR-PUE-DER v7,
DER-ALA v1) — el pipeline de releases congela lo autorizado, no la revisión vigente.
Para el vivo: tras publicar la release nueva hay que verificar el readback de los blobs
congelados (que traigan las recetas migradas).
