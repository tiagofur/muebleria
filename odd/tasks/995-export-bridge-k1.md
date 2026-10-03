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
