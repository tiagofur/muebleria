# ODD — #1329 Perfil de apertura estándar del taller + fabricante + consecuencias visibles

- **Lane**: Delegated Direct (multi-superficie Go+migración+contratos+web+plugin).
- **Base**: `origin/main` @ 090f5508 · **Rama**: `feat/1329-opening-standard-profile` · **Escritor**: implementer sesión 2026-10-15 (reserva en la issue).
- **Aprobación**: owner en sesión 2026-10-15 («vamos con 2 #1329»); label `status:approved` aplicado.

## Entregables (de la issue)

1. Campo `manufacturer` (texto corto, migración aditiva) visible en picker, ficha y readback. `code` sigue siendo la identidad.
2. Perfil estándar por `grip_type`+sección: dato versionado de la org vía blob de capacidades (#1134), autoridad backend, editable en Web React, plugin consumidor. Fail-closed: estándar desactivado/eliminado → sin estándar.
3. Inspector: preselección del estándar, fabricante + descuento + muesca visibles por perfil, diálogo de aplicación muestra el efecto ANTES de confirmar; no-estándar exige confirmación explícita.

Non-goals: no bloquear no-estándar; no tocar resolve/pin; no procedencia post-aplicación (#1330); no validación stock/compras.

## Diseño

- Migración `000163_opening_profile_manufacturer`: `ALTER TABLE opening_profiles ADD COLUMN manufacturer TEXT;` (nullable, sin seed; tabla existente tenant-owned, RLS intacta).
- Dominio: `Manufacturer string` json `manufacturer,omitempty` en el bloque de identidad; informativo (no en `AuthoringReady`/`AuthoringBlocker`); validación write-time: opcional, trim, ≤120 chars.
- Capacidades: `OpeningGripCapability.StandardProfiles map[section]profileID` (`""` = sin sección). Parser Go+TS fail-closed: sección desconocida o no-gola con sección → error; valor ∉ `Profiles` curados → error. Fixture `contracts/openingCapabilities.contract.json` extendido en lockstep.
- Web: campo Fabricante en `OpeningProfileFormModal` + ficha (`OpeningProfilesCatalog`) + draft/write-body; marca de estándar en `OpeningSettingsSection` (radio por sección, una marca por sistema+sección).
- Plugin: `granote-opening.js` preselecciona el estándar (sólo si ∈ seleccionables), opción del select con fabricante/descuento, panel de consecuencias antes de aplicar («Puertas H−N · Muesca A×B · perfil»), confirmación explícita si ≠ estándar. Bump `EXTENSION_VERSION` → 0.1.75.

## Tareas

- [x] Migración 000163 + dominio + storage (`manufacturer`) + OpenAPI (`OpeningProfile`/`OpeningProfileWrite`) + regen Go/TS. → commit f41210a6
- [x] Tests Go: storage roundtrip, handlers update, validación longitud. → f41210a6 (PG real PASS)
- [x] Web: draft/form/ficha fabricante + tests (draft roundtrip 19/19, E2E catálogo extendido PASS). → f41210a6
- [x] Capacidades `standardProfiles`: parser Go + TS + fixture contrato + tests paridad. → c5a7a3e8 (Go PASS, TS 13/13)
- [x] Web Configuración→Apertura: marcar estándar por sección + tests 9/9 + E2E browser nuevo PASS. → fbb7d4dd
- [x] Plugin: preselección + consecuencias + confirmación + harness JS 21/21 + bridge 18/18 + bump 0.1.75. → 26cbaf8d
- [x] Verificación congelada (HEAD 26cbaf8d): plan verify_affected = 6 familias; ejecutado localmente:
  - V0: typecheck workspace 0; check_openapi_drift PASS; ci_extension_version PASS (0.1.74→0.1.75).
  - V1: pnpm test workspace PASS (web 604 incl.); Go engine contract + storage/api focused PASS; backend `./...` PG real (ver abajo).
  - V2: browser gate org `opening-profiles-catalog` + `opening-standard-profile` 2/2 PASS; rake verify extension PASS (rubocop 308 files/0, unit 1449 runs, boundary 6 runs, RBZ sha256 e72efe280663f383849540a8cb3c5bcfb2987d888a4fa29cee7a1241e1a98d21 @ 26cbaf8d).
  - NOT_RUN local (CI arbitra): visual proyectar-webgl, foundation-gate-a postgres stage dedicado (la suite backend completa ya corre PG real fresco por fixture), shards completos del org gate.

## Estado

- 2026-10-15: inicio. Explorer completó el mapa de superficies (resumen en la sesión, evidencia path:line). Sin PR previo, sin conflicts de migración (max actual 000162).
- 2026-10-15: 4 work units commiteadas; hallazgo del harness: el fail-closed de preselección exigía validar que el id del estándar esté ENTRE los seleccionables (bug cazado por el test «pendiente de ficha»).
