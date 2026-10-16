# ODD — #995 EXPORT-BRIDGE (puente joinery → packs de producción)

- **Issue**: tiagofur/muebleria#995 (`status:approved`, autorización del owner
  2026-10-03 «si puente joirney», citada en comentario).
- **Lane**: Delegated Direct (multi-slice K1→K2, riesgo de taller). Un escritor.
- **Base**: `origin/main` @ `3fe567d4` (post #990). Rama
  `feat/995-export-bridge-k1`, worktree `../muebles-worktrees/995-export-bridge`.
- **Estado**: INVESTIGATED_PENDING_K1 (actualizar).

## Hechos verificados (2026-10-03, main 3fe567d4)

1. **Consumidores legacy vivos**: `apps/web/src/exports/useExportHandlers.ts:468`
   llama `resolveProjectDrilling({project, catalog})` (cadena F128/F130
   client-side, fallback heurístico F074 por nombre). El pack
   `apps/web/src/exportProductionPack.ts` compone `perforaciones_*.json` del
   mismo lado.
2. **La verdad congelada es server-only**: `GetProductionReleaseManufacturingSnapshot`
   (storage) devuelve el `ReleaseRoutingProgram` congelado (Partes →
   Operaciones → Holes {Face, XMm, YMm, DiameterMm, DepthMm, Type} +
   provenance) — pero el readback `ProductionReleaseReadback` {Release,
   Staleness} y su DTO (`toProductionReleaseDTO`) NO lo exponen.
3. **Superficies HTTP existentes**: GET
   `/api/projects/{id}/production-releases` y `/{releaseId}` (detail),
   `/{releaseId}/workshop-occurrences`, `/{releaseId}/cutting-demand`
   (routes.go:686-697). Ninguna sirve el routing program.
4. El export es client-composed (web compone packs desde estado); PTX sin
   coordenadas (flag hasCncMachining — deferido a #348/#793, K3).

## Diseño K1 (a ratificar en implementación)

- **API**: exponer el manufacturing snapshot (routing congelado) vía
  `GET /production-releases/{releaseId}/manufacturing-snapshot` (o añadirlo al
  detail DTO) con autorización de taller (mismo nivel que workshop-occurrences).
  OpenAPI + cliente + fixtures.
- **Consumo**: `exportProductionPack` para releases: agujeros del programa
  congelado (por parte, con provenance); marcador `"source": "frozen-release"`
  + releaseId + fingerprint. Drafts/no-released: cadena legacy actual con
  `"source": "legacy-live"` — NUNCA mezclados en un mismo pack.
- **Fail-closed**: release con joinery MACHINING_READY y snapshot sin routing
  materializado ⇒ error estructurado (no heurístico silencioso).
- **F074**: en el camino congelado NO existe fallback; el mapa de retiro del
  camino legacy se documenta (la retirada total depende de K2/DXF).
- Paridad TS/Go de la composición del pack (fixture compartido) si la regla
  vive en ambos.

## Aceptación K1

- [ ] Golden PG: mueble joinery-governed liberado ⇒ pack con agujeros
      congelados exactos (números a mano, patrón #974) + provenance.
- [ ] No-released ⇒ pack legacy con marcador, byte-idéntico al actual.
- [ ] MACHINING_READY sin routing ⇒ error estructurado.
- [ ] Endpoint con autorización correcta (tenant + taller) y OpenAPI
      regenerado sin drift.
- [ ] Browser proof del export de un release gobernado.

## Fuera de alcance

K2 (DXF, slice siguiente), K3 (PTX → #348/#793), kinds nuevos (#874), J6 si
el ODD lo nombra en vez de ejecutarlo.

## Evidencia (llenar al congelar)

- HEAD/base, paths, V0/V1/V2, delivery.


## K2 (2026-10-03, worktree 995-export-bridge-k2) — capa drilling del DXF congelada

`handleExportCutPlanDxf` (#130, fail-closed por diseño) ahora: autoridad
canónica ⇒ fetch del manufacturing snapshot (mismo frozenDrillingFetcher de
K1) ⇒ composeFrozenDrilling ⇒ la capa drilling del DXF dibuja los agujeros
CONGELADOS. Fallo duro doble: transporte (mejor sin DXF que agujeros no
verificados) y join/cobertura (composer). Sin autoridad canónica ⇒ legacy
byte-idéntico. Tests: 3 casos (congelado reemplaza heurísticos 5→[15,8],
transporte bloquea, sin autoridad legacy intacto) en su propio describe con
reset de mocks (los it top-level NO heredan el beforeEach del describe).
Web 48 archivos / 581 tests PASS; typecheck PASS.

Retiro total de F074/legacy y convergencia J6: siguen NOMBRADOS — el camino
legacy queda vivo para drafts/no-canonical hasta decisión de producto.

## K3-paridad (2026-10-16) — identidad de partes TS alineada al espacio congelado de Go

**Bloqueador que abre este slice (hallazgo en vivo, #1070):**
`composeFrozenDrilling` nunca calza para módulos compuestos: el BOM congelado
Go nombra piezas `st-<componentId>-copy-N` / `mod-<componentId>-copy-N`
(#736, 684b899d — prefijos para desduplicar; layout.go:916 igual) mientras el
BOM TS las nombra sin prefijo (bom.ts:578, llamadas con `idPrefix: ''`).
Los conteos calzan, los nombres no ⇒ «la partida liberada X no tiene routing
congelado» para TODO release compuesto (KDT/pack/DXF congelado muertos en el
browser para esos releases).

**Dirección elegida: TS adopta el espacio de Go.**
- Go es el lado congelado YA publicado (releases existentes + cutting-demand
  + routing + part-executions llevan ids prefijados); cambiar Go rompería el
  readback de cada release vivo.
- El fixture de paridad de autoría #477 (`sketchupAuthoringResolve.contract.json`)
  YA pina ids prefijados (`st-comp-side-copy-0`, `mod-comp-shelf-copy-0`) —
  el espacio prefijado es el contrato de intercambio; bom.ts es el outlier.
- Agregados ya están alineados en ambos (`agr-…`).

**Cambio (un solo unit de dominio + compañeros obligatorios):**
1. `bom.ts` — estructura expande con `st-`, instancias de módulo con `mod-`
   (semántica de copyCounters idéntica a Go; por llamada).
2. `project3dPreview.ts:524-525` — prefixes `''` → `st-`/`mod-` (si no, los
   placements manuales desaparecen del 3D en silencio).
3. `projectDrilling.ts` `manualPlacementsForPart` — strip del prefijo en el
   stem-match (si no, perforaciones manuales mueren en compuestos).
4. `deriveOverridesFromParts.ts` — strip del prefijo en el regex `-copy-`
   (si no, overrides del BoardEditor se persisten bajo clave inexistente).
5. Fixture de paridad compartido (`contracts/`) consumido por test Go y test
   TS: mismo módulo compuesto ⇒ mismos part ids en ambos runtimes.
6. Pines de test actualizados (~48 ids sin prefijo en 9 archivos) y goldens
   Pnn (la renumeración pasa a ser la de Go: `mod-` < `st-` lexicográfico).

**Efectos aceptados:** renumeración Pnn en compuestos (unifica con el
despiece congelado — hoy divergen), `part_definition_id` históricos mezclados
(sin joins: solo round-trip). **No se rompen:** planes de corte persistidos
(no llevan partId), labels de manufactura (demanda congelada), exports
PTX/PDF/DXF (códigos limpios), quotes, workshop occurrences.

**Consecuencia inmediata:** desbloquea el happy path KDT de #1070 (spec
`engineering-kdt-export.spec.ts` gana su segundo test: ZIP con XML congelado
+ readback con `parseKdtPanelBytes` re-exportada) y el join K1/K2 para
compuestos.

## Mapa de migración de F074 (aceptación «retiro o mapa», 2026-10-16)

Estado real del fallback F074 (heurística por nombre de pieza) tras K1+K2+KDT:

1. **Caminos con autoridad canónica — F074 ya no existe**: KDT
   (useExportHandlers), capa drilling del DXF (K2) y pack de producción (K1)
   componen SOLO del snapshot congelado; sin autoridad canónica NO hay
   fallback (fail-closed con mensaje estructurado). El comentario legacy en
   useExportHandlers.ts:602 documenta la frontera.
2. **Camino legacy vivo, marcado y acotado**: proyectos SIN release canónico
   (drafts/quote) siguen resolviendo perforaciones con F128/F130+F074 — es el
   único origen honesto para un pack de estimado; el pack lo declara con
   `"source": "legacy-live"` (nunca mezclado con agujeros congelados).
3. **Disparador de retiro total** (decisión de producto, no de este slice):
   cuando el ciclo de fabricación solo componga packs contra releases
   canónicos (gate de lifecycle producción→pack), el camino legacy se borra
   con su marcador. Hoy retirarlo dejaría a los drafts sin pack de estimado.

Este mapa queda como aceptación del ítem «F074 retirado de los caminos
reemplazados (o mapa de migración aceptado por el owner)»: los caminos
reemplazados (releases canónicos) ya no lo usan; el resto queda documentado
con su disparador de retiro.

## Evidencia K3-parity (2026-10-16, congelado para revisión)

- Rama `fix/995-part-identity-parity` sobre main `adfa6c50`. Verificación:
  domain 1980 ✓ · ui 2263 ✓ · web 605 ✓ · excel 701+5skip ✓ · storage 268 ✓ ·
  Go domain completo ✓ (incluye el fixture nuevo) · typechecks web/excel/tests ✓.
- Paridad: `contracts/bomPartIdentityParity.contract.json` consumido por
  `bomPartIdentityParity.test.ts` (TS) y `bom_part_identity_parity_test.go`
  (Go) — misma secuencia st-/mod-/agr-…instance-… en ambos runtimes.
- Fixture `componentBindings.contract.json` colapsado a un solo
  `piecePrefix: "mod-"` (el dual ts/go era el workaround que documentaba la
  divergencia).
- Browser proof (gate local PASS, 2/2): `engineering-kdt-export.spec.ts` —
  sin salida → toast; KDT configurado → ZIP con XML congelado, cazoleta
  35×13 leída con `parseKdtPanelBytes` + manifest con provenance del release
  (projectId/releaseId/bomFingerprint/digest del perfil). El happy path de
  #1070 queda demostrado; el spec vive en ese issue por trazabilidad.
- Pnn: `modGar01` fixture reordenado (orden canónico = Go). Efectos aceptados
  documentados arriba (this slice): renumeración Pnn compuestos,
  part_definition_id históricos mixtos sin joins.
