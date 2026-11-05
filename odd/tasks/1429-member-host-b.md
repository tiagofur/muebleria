# odd/tasks/1429-member-host-b.md

- Issue: #1429 slice B (restante declarado en el PR del slice A, mergeado d5527cfa)
- Estado: IMPLEMENTED_PENDING_REVIEW · Escritor único: sesión ZCode 2026-11-05
- Base: origin/main `6ec6ecc8` · Rama: `feat/1429-member-host-b` · Worktree: `muebles-worktrees/1429-member-host-b`

## Alcance del slice B (el "Restante" del slice A)

1. **Dedupe**: placement manual equivalente NO duplica ni falso-colisiona con
   el taladro del miembro (acceptance de la issue). Decisión: **la autoría
   explícita manda** (misma doctrina que el dedupe bulk del kit): la operación
   `assemblyMemberHost` cuyo agujero coincide (misma pieza + cara + centro
   ±0.1mm + Ø + profundidad) con un placement manual del mismo host se
   SUPRIME; no-equivalentes conviven y el gate DRILLING_CONFLICT sigue
   fail-closed (otra profundidad en el mismo punto = contradicción física).
   Tolerancia = la de `deduplicateHoles` TS (0.1mm).
2. **Puerto TS del preview**: `resolveProjectDrilling` proyecta los taladros
   member-host (antes la regla vivía sólo en Go). Módulo nuevo
   `memberHostDrilling.ts` — espejo línea a línea de
   `deriveMemberHostMachining` (datum por rol, cara por normal al interior,
   marco tablero-local euler+group+swap vía spatialAnchor, bounds fail-closed)
   + issues fail-closed MEMBER_HOST_* como `DRILLING_MEMBER_HOST_UNRESOLVED`
   (once por template). Fixture de paridad compartido
   `contracts/memberHostDrilling.contract.json` (forma MERIVOBOX del slice A;
   Go autor golden, TS consume — drift 0 verificado).
3. **UI de autoría**: campo «Pieza anfitriona (fuera del agregado)» por
   miembro en AgregadoRecipeAuthoringPanel — sólo miembros `fixed`
   (la validación de dominio rechaza variant-sourced), vocabulario cerrado
   `AGREGADO_MEMBER_HOST_PLACEMENTS` (ahora constante compartida en domain;
   antes literals inline), hint con el efecto y el fail-closed.

Fuera de alcance (nombrado en slice A): multi-cajón apilado (v1 asume un
cajón por rol de frente); readback KDT del programa congelado (owner).

## Decisiones de diseño

- Los issues TS del puerto reusan los MISMOOS códigos MEMBER_HOST_* que el
  wire Go dentro de `ProjectDrillingResolutionIssue` (nuevo code
  `DRILLING_MEMBER_HOST_UNRESOLVED`, stage `member-host` — código TS-interno
  del pipeline de drilling, fuera del contrato cerrado del authoring resolve).
- El dedupe Go corre entre `deriveMemberHostMachining` y
  `detectHoleCollisions`; el TS filtra los agujeros member-host contra los
  holes ya resueltos de la pieza (misma tolerancia, misma dirección).
- ResolvedRigidMember TS gana `hostPlacement` propagado desde la definición
  (el Go ya lo llevaba desde el slice A).
- Los avisos F129 default (cajas minifix de plantilla sobre una carrocería sin
  tapas) son ruido ajeno al fixture — la aserción de issues del test TS queda
  scoped a member-host.

## Verificación (candidato congelado)

- **V0**: gofmt limpio en archivos tocados; tsc limpio (domain/ui/storage/web).
- **V1 (PASS)**:
  - Go: `go test ./internal/domain/... ./internal/api/...` ok — incluye
    TestDedupeMemberHostManualEquivalents (3 subtests),
    TestMemberHostManualPlacementDedupeEndToEnd (2 pasadas por
    ResolveAuthoringLayout: hole leído del resolve → manual placement autorado
    → 5 holes sobreviven + 1 manual + 0 DRILLING_CONFLICT),
    TestMemberHostDrillingSharedContract_1429 (golden fijado),
    regresión slice A intacta.
  - TS: vitest domain 2145 ✓ (incl. memberHostDrilling.contract.test.ts 5/5:
    los 4 miembros taladran sus piezas con los agujeros golden EXACTOS),
    storage 280 ✓, ui 2439 ✓ (incl. 2 tests nuevos del select hostPlacement),
    web 612 ✓; tsc 0 errores.
- **V2: NOT_RUN** — readback KDT/MPR del programa congelado + prueba en vivo
  del owner (el dedupe se observará cuando autoré un placement equivalente).

## Entrega

- PR a main: `Refs #1429` / `Delivery: partial` (multi-cajón apilado + evidence
  pack en vivo quedan explícitos) / label `type:feature`.
- Riesgo: none conocido — el dedupe sólo SUPRIME el duplicado exacto; cualquier
  diferencia falla visible como antes.
