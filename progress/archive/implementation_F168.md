# Implementation Evidence: F168 (#347 — Manufacturing preflight, Definition of Done completo)

## State

- Feature: **F168** — `sketchup_manufacturing_preflight_full_dod`
- Issue: #347 — [P0] Implementar manufacturing preflight autoritativo en Muebles
- Branch: `main`
- Invariant: **SketchUp owns authoring/interaction; Granete owns manufacturing truth.**
  Cero output fabricable ante ambigüedad crítica o errores (`status: blocked`).

## Qué cierra este trabajo (sobre el milestone F163 ya verificado)

1. **Capability negotiation (contract §10):**
   - `requiredCapabilities` derivadas de verdad de manufactura:
     `granete.drilling` (min/max diameter, max depth desde los agujeros resueltos) y
     `granete.panel-geometry` (max length/width/thickness desde la geometría de catálogo).
     Orden determinístico por capabilityId.
   - `machineNegotiation?: CapabilityNegotiation` presente cuando se pasa un
     machine profile. Bloquea con `MACHINE_CAPABILITY_UNSUPPORTED` cuando la máquina:
     no declara la capability; declara versión distinta; omite un constraint requerido;
     o su límite numérico (`max*` por debajo / `min*` por encima del requerimiento) no
     cubre el modelo resuelto. **Capabilities nunca se infieren.**

2. **Stale check (contract §8):** `policy.release` (fingerprint liberado) distinto al
   fingerprint actual → `REVISION_STALE` error bloqueante con ambos fingerprints,
   releasedAt y designRevisionId en `details`. Mismo fingerprint → sin issue.

3. **Override server-authoritative (contract §10):** `PreflightOverride` explícito y
   auditado (overrideId, reason, approvedBy, approvedAt, scope). Sólo puede degradar
   `MACHINE_CAPABILITY_UNSUPPORTED` o `REVISION_STALE` a warning dejando el registro en
   `issue.details.override`. Un override forjado en runtime con otro code se ignora —
   la ambigüedad crítica (colisiones, huérfanos, schema/catálogo/drilling) siempre
   bloquea. `machineNegotiation.unsupported` refleja los issues post-override.

4. **Error model completo (§9):** todos los errores ahora llevan `code`, `message`,
   `entityId`, `path`, `severity` y `remediation` — también en
   `sketchupAuthoringValidation.ts` y `sketchupRelationshipMachining.ts` (paths
   estables estilo `assemblies[assemblyId=…].components[…]]`, `machineNegotiation[capabilityId=…]`,
   `release[designRevisionId=…]`).

5. **Sin bypass desde SketchUp:** los inputs de política (`release`, `machineProfile`,
   `overrides`) viven en `PreflightPolicyContext` — contexto que inyecta Granete al
   ejecutar el gate; nunca campos del `AuthoringEnvelopeV1`.

## Archivos

- `packages/domain/src/sketchupPreflight.ts` — gate completo (4º parámetro opcional
  `policy`; API del milestone retrocompatible).
- `packages/domain/src/sketchupAuthoringSchema.ts` — tipos §10:
  `MachineProfileRef`, `MachineCapability`, `CapabilityNegotiation`.
- `packages/domain/src/sketchupAuthoringValidation.ts` — issues con ubicación y
  remediation completas.
- `packages/domain/src/sketchupRelationshipMachining.ts` — remediation en todos los
  errores.
- `packages/domain/src/index.ts` — exporta los tipos nuevos.
- `docs/sketchup-manufacturing-contract.md` — §11 "Policy inputs del preflight
  (server-side)".
- `feature_list.json` — F163 registrado retroactivamente (existía la evidencia, faltaba
  el ledger) + F168.

## Verification Evidence

| Verificación | Comando | Resultado |
|---|---|---|
| Preflight suite | `vitest run src/sketchupPreflight.test.ts` | 19/19 tests (6 milestone + 13 DoD) |
| Domain completa | `pnpm --filter @muebles/domain test` | 87 files, 1106 tests pasando |
| Workspace typecheck | `pnpm typecheck` | 7/7 workspaces limpios |
| Backend Go | `go test ./...` | Todos los paquetes ok (backend no tocado) |

### Casos negativos cubiertos por tests nuevos

- capability ausente / versión distinta / constraint omitido / límite insuficiente →
  blocked con cero output;
- override auditable degrada capability/stale a warning y libera output con registro;
- override forjado (`DRILLING_CONFLICT`) NO degrada la colisión — blocked;
- stale fingerprint → `REVISION_STALE` blocked; mismo fingerprint → ready;
- determinismo: mismo fixture → mismo fingerprint/capabilities/issues;
- meta-test: todo error lleva los 6 campos del error model.
