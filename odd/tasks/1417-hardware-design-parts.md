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

1. [x] domain TS: tipos + validateHardwareDesignParts + attach al miembro resuelto
       (attachHardwareDesignParts, misma ruta que pins visuales) + proyección 3D
       pasa designParts + tests (6) + fixture de paridad (1).
2. [x] Go espejo: HardwareDesignPart + validador (mismo vocabulario #1376) +
       AttachHardwareDesignParts en engine + ResolvedRigidMember.DesignParts +
       fixture de paridad contracts/hardwareDesignParts.contract.json (claves
       camel para TS y snake para Go). Tests ambos lados PASS.
3. [x] Contratos: design_parts en Hardware + HardwareWrite del OpenAPI →
       openapi:generate → drift 0 (types TS y Go regenerados).
4. [x] Migration 000170 (hardwares.design_parts JSONB NULL) + storage Go
       (SELECT×2/INSERT×2/UPDATE + scan/arg helpers) + tests de roundtrip
       (2 partes, replace en update, legacy NULL→nil). API POST/PUT validan
       fail-closed → 422 HARDWARE_DESIGN_PARTS_INVALID + tests negativos
       discriminantes.
5. [x] Mapper TS hardwareToApi/FromApi (normalización fail-closed: forma
       inválida se descarta entera) + draft (designParts opcional, forma form)
       + sección «Partes del diseño» en HardwareFormModal (filas CRUD,
       vocabulario #1376) + store convierte filas→dominio con validador
       (throw → error visible del modal, nada persiste) + tests jsdom (3).
6. [x] E2E browser: tests/organization/hardware-design-parts.spec.ts —
       **1 passed** (autora 2 partes → readback exacto design_parts → F5
       persiste → fila duplicada bloquea en cliente SIN PUT).

## Verificación (V0/V1/V2) — evidencia congelada

- V0: typecheck workspace 0 · gofmt limpio en tocados · openapi drift 0 ·
  migración additiva ( columna nueva NULL).
- V1: domain 2039/2039 · ui catalogs 189/189 · storage TS 276/276 · go
  storage TestHardware*/TestMaterial* OK (roundtrip + legacy NULL) · go api
  TestHandleHardware* OK (422 en POST y PUT). Fix SQL incidental: el parche
  inicial por número de línea corrompió los VALUES de material_boards
  ($24/$23) y dejó el INSERT de hardware sin la columna — detectado por el
  gate («expected 23 arguments, got 24»), corregido con reemplazos exactos y
  re-verificado (hardware + materiales OK sobre PG real desechable).
- V2: gate organization browser — hardware-design-parts **1 passed** ·
  regresiones hardware-kit-wizard + agregado-recipe-authoring **4 passed**.
  Host SketchUp: NOT_RUN (consumo Ruby de partes = alcance restante).

## Entrega explícitamente restante (Delivery: partial)

- Runtime host SketchUp (Ruby): separar/repintar sub-componentes por nombre
  con la membresía de la parte + validación de nombres contra el SKP real +
  TestUp. PR propio dentro de la issue.
- Modo «2 herrajes con partes» del asistente #1416 (UX aditiva; el asistente
  sigue creando 4 herrajes de diseño hoy).
- Verificación con SKP real del owner (datos) y separación visible al abrir
  en host (aceptación completa de la issue).
- GLB por parte vs grupos con nombre: se decide cuando exista pipeline GLB
  de partes (open question de la issue intacta).
