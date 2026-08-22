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
