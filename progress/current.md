# Sesión cerrada: Issue #303 — Operational Core O4: Instalación profesional (OC-070..OC-074)

**Fecha:** 2026-08-21
**Feature:** F137 — `operational_core_o4` — **done**
**Rama:** `feat/f137-installation-closeout` (pusheada, PR abierto)

## Objetivo

La instalación deja de ser un botón `loaded → installed` y pasa a ser un subproceso:
InstallationJob con múltiples visitas, FieldIssues trazables, PunchItems que bloquean
cierre y closeout/conformidad auditado (OC-070..OC-074).

## Plan (ejecutado)

- [x] F137 registrada en `feature_list.json` (in_progress)
- [x] Dominio puro `packages/domain/src/installation.ts` + tests (26)
- [x] Contract fixture `contracts/installationStatuses.json` + espejo Go + parity tests
- [x] Backend: migración 000070 (`projects.installation` JSONB),
      `MutateProjectInstallation` (SELECT FOR UPDATE), handlers
      GET/PUT `/api/projects/{id}/installation` +
      POST `.../installation/closeout` (complete_installation | sign_off | close)
- [x] Storage TS: mappers snake_case + `getInstallation`/`saveInstallation`/
      `installationCloseout` (+ `CloseoutGateError` con checks)
- [x] Web UI: `InstallationJobPanel` (visitas, incidencias, punch, cierre con gates
      que explican cómo resolverse) incrustado en `InstalacionesScreen` + wiring
      AppContent/ShellView/store
- [x] Verificación completa
- [x] Reviewer: CHANGES_REQUESTED con 3 defects menores de copy/formato (+2
      recomendaciones) — todos aplicados y suites re-verificadas en verde
      (ver `progress/review_F137.md` y `progress/history.md`)

## Qué se implementó

1. **Dominio (OC-070/071):** `InstallationJob` por obra con múltiples
   `InstallationVisit` (fecha, crew, arrival/start/end, notas, fotos, unidades
   trabajadas, resultado finished|partial|blocked). Transiciones validadas
   (scheduled→in_progress→completed/cancelled). `installation_started` se audita
   una sola vez (primera visita con trabajo real). Status del job **derivado**,
   nunca almacenado.
2. **FieldIssue (OC-072):** estados open→action_required/blocked→resolved→verified
   con reapertura por verificación fallida; fotos y vínculo a mueble (`projectItemId`)
   y pieza (`partInstanceId`). Entidad trazable, no nota.
3. **PunchItem (OC-073):** owner, dueDate, severidad (minor/major/critical), flag
   `isBlocker`, cierre **con evidencia obligatoria** (notas o fotos);
   `punch_opened`/`punch_closed` auditados por ítem. `deriveProjectStage` ahora
   usa el balance abierto/cerrado (múltiples punch coexisten sin hacks).
4. **Cierre (OC-074):** gates evaluables (unidades instaladas — físicas o legacy —,
   field issues resueltos, punch bloqueantes cerrados, visitas cerradas) +
   conformidad. `installed` en todas las unidades NO cierra el proyecto: el
   sign-off y el cierre corren por endpoint server-authoritative que evalúa los
   gates contra el estado lockeado. Guard también sobre eventos crudos
   `client_signed_off`/`project_closed` (POST events y dual-write del agregado).
   `complete_installation` es hito de planta auditable (KPI installationHours).
5. **Paridad:** `contracts/installationStatuses.json` (vocabularios + transiciones
   + códigos de gates) verificado desde TS (domain test) y Go (parity test);
   lógica de gates/transiciones espejada con tests equivalentes.
6. **Backend:** columna JSONB `installation` (migración 000070), sólo escribible
   por los endpoints dedicados (el PUT agregado del proyecto la ignora —
   anti-smuggling); `MutateProjectInstallation` transaccional (SELECT FOR UPDATE)
   + eventos de auditoría en la misma tx; RBAC por acción vía la matriz de
   eventos (`installation_*` incluye produccion; punch/closeout, gerentes).
7. **Web:** `InstalacionesScreen` en modo job — panel por obra con visitas
   (programar/iniciar/completar/cancelar), incidencias (reportar + transiciones
   legales), punch (abrir con severidad/bloqueante, resolver con evidencia) y
   cierre (checklist de gates con detalles accionables, completar instalación,
   conformidad, cerrar). Preserva "En camino → Marcar Instalado" (avance físico
   por unidad de F136). Store: `setInstallationJob` (espejo server) /
   `applyInstallationProject` (modo local con eventos); AppContent: acción pura
   client-side + persistencia por endpoint (API) o canal local (guest).

## Verificación (evidencia)

- `pnpm --filter @muebles/domain test`: **836 tests** OK (+installation 26;
  projectLifecycle 43 OK con balance punch).
- `pnpm --filter @muebles/storage test`: **143 tests** OK (+2 roundtrip
  instalación: evidencia de punch y hechos de closeout sobreviven).
- `pnpm --filter @muebles/ui test`: **1169 tests** OK (+InstallationJobPanel 11).
- `pnpm test` monorepo completo OK (mobile 45 · desktop 17 · web 301 · excel 89).
- `go test ./...`: OK — parity fixture, validación de transiciones del job,
  gates OC-074 (punch bloqueante bloquea sign-off), RBAC por acción, smuggling
  de closeout por PUT rechazado, hito complete_installation.
- `pnpm typecheck` monorepo: OK.

## Notas de diseño

- `installation` viaja en el agregado GET (lectura lossless) pero el PUT agregado
  preserva la copia del servidor: el job es server-authoritative.
- Los eventos de lifecycle los appendea el server (ids propios); el espejo local
  aplica sólo el job. En modo local/offline la acción pura appendea eventos.
- UI: una primaria por contexto (Iniciar/Completar visita, Registrar conformidad);
  gates deshabilitados explican cómo resolverse (UX operacional §2.4).
