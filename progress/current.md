# Sesión

**Feature en curso:** F140 — operational_core_ux (issue #305)
**Inicio:** 2026-08-21
**Rama:** `feat/f140-operational-core-ux`

## Plan

- SiteSurvey estructurado en domain TS (OC-040): spaces/dimensiones/huecos/notas
  plomo-nivel-escuadra/utilities/fotos + autoría captured/verified + revision.
- Medidas por intención (OC-041): preliminar→levantada→aprobada→fabricación con
  gate que bloquea producción/CNC sobre medidas no aprobadas; gate survey_verified
  endurecido cuando existe survey real.
- Persistencia JSONB projects.site_survey + endpoints Go server-authoritative
  (capturar/verificar/aprobar) con RBAC + eventos + contrato de paridad
  contracts/siteSurvey.json.
- Project Workspace transversal (OC-091): navegación por secciones (Overview,
  Ventas, Levantamiento, Diseño/Revisiones, Producción, Instalación, Costos,
  Garantías) con header persistente (stage, revisión liberada, instalación
  comprometida, blockers).
- Dashboard exception-first (OC-090): derivación pura cross-obra (instalación en
  riesgo, faltantes, revisión stale, estancada, WIP, QC/rework, sobrecosto) y home
  dueño/gerente priorizando excepciones accionables.
- NavMode simplified vs departmental en WorkshopSettings (OC-092).

## Notas

- Entorno verificado con ./init.sh al abrir la sesión: typecheck + tests TS (301)
  + go test verdes.
- Exploración previa: survey hoy es sólo stamp surveyCompletedAt + gate débil;
  workspace de obra fragmentado en 5 rutas; home con cards de volumen; sin
  preferencias de navegación.

## Evidencia (verificación final)

- `./init.sh` verde completo tras la implementación (2026-08-21):
  - typecheck TS (domain/ui/storage/web/mobile/desktop/excel) sin errores;
  - tests TS: domain 927+ (siteSurvey 22, opsExceptions 14), ui 1215
    (SiteSurveyPanel 9, ProjectOverviewPanel 3, Dashboard exception-first 3,
    AppShell navMode 3, Settings navMode), storage 153 (round-trip survey 3),
    web 301+;
  - `go test ./...` verde (siteSurveyParity + lifecycle mirror + endpoints
    RBAC/gate).
- Commit: `6577c96` en rama `feat/f140-operational-core-ux`.
- Migraciones aditivas 000075 (projects.site_survey JSONB) y 000076
  (workshop_settings.nav_mode), ambas con down.sql.

## Pendiente

- Reviewer.
- Con aprobación: F140 → done, resumen a progress/history.md, push.

