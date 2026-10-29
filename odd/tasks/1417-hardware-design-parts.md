# ODD 1417 — Partes internas del diseño de herraje (multi-parte SKP)

Issue: https://github.com/tiagofur/muebleria/issues/1417 (status:approved 2026-10-29,
cadena del owner: fase 1 → 2 → 3 con PRs apilados corriendo CI en paralelo).
Base: feat/1416-hardware-kit-wizard (c7e4715d) — PR #1419 debajo.
Topología: Delegated Direct. Writer: sesión ZCode 2026-10-29 (única).

## Outcome observable

Un herraje de diseño «corredera izq» con partes `fija`/`movil` (por nombre de
componente del SKP pineado) se autoría en la web, valida fail-closed, y la
resolución entrega las partes al miembro rigid (como los pins visuales #668):
membresía por parte para la cinemática y clave de acabado por parte. El host
SketchUp y el renderer web consumen `member.designParts`.

## Decisiones de diseño (fijadas al arrancar)

- Las partes viven en el HERRAJE (verdad de diseño) y FLUYEN al miembro
  resuelto en `resolveAgregadoAssembly`→catálogo (analogía exacta de
  attachVisualPins); el miembro monolítico legacy no cambia.
- `HardwareDesignPart = { componentName, actorMembership, finishKey?, label? }`.
  Membresía de parte usa el MISMO vocabulario #1376 y es obligatoria
  (una parte existe para declarar movimiento; '' no tiene sentido).
- Validación de existencia del nombre dentro del SKP: IMPOSIBLE server-side
  (el backend no parsea SKP — verificado: derive no enumera componentes).
  El contrato valida formato; el HOST valida nombres al sincronizar (fallo
  explícito, parte restante). No se inventa validación de contenido.
- Acabado por parte: `finishKey` referencia las claves de `partFinishes`
  existentes (F080/#1209) — sin sistema nuevo de acabados.
- Migration: `hardwares.design_parts` jsonb NULL (legacy = sin partes,
  byte-idéntico).

## Tareas

1. [ ] domain TS: tipos + validateHardwareDesignParts + resolución al miembro
       (ResolvedRigidMember.designParts) + tests.
2. [ ] Go espejo + fixture de paridad contracts/hardwareDesignParts.contract.json.
3. [ ] Migration 000170 + storage (arg jsonb) + API PUT/POST validan (422
       HARDWARE_DESIGN_PARTS_INVALID) + tests storage/api.
4. [ ] UI: sección «Partes del diseño» en el editor de herrajes + modo
       «2 herrajes con partes» del asistente #1416 (crea IZQ/DER con partes
       en vez de 4 herrajes).
5. [ ] tests UI + typecheck + suites.

## Entrega explícitamente restante (Delivery: partial)

- Runtime host SketchUp (Ruby): separar/repintar sub-componentes por nombre
  con la membresía de la parte + validación de nombres contra el SKP real +
  TestUp. PR propio dentro de la issue.
- Verificación con SKP real del owner (datos) y separación visible al abrir
  en host (aceptación completa de la issue).
- GLB por parte vs grupos con nombre (open question de la issue): web hoy
  renderiza procedural; se decide cuando exista pipeline GLB de partes.

## Verificación planificada

- V0: typecheck ws, gofmt, drift de contratos (OpenAPI sin cambios si el campo
  viaja por el dominio… revisar: hardwares son generated API → revisar drift).
- V1: vitest domain/ui, go storage+api.
- V2: gate browser — autoría de partes en editor + asistente modo 2 herrajes
  con readback; regresiones 1416/1412.
