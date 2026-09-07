# Implementación #591 — Engineering machine output selection

- Rama: `feat/591-machine-output-selection` (base main b9e062ad, post-#588).
- Contrato compartido: `contracts/machineOutputCatalog.contract.json` (máquinas/perfiles/adapters con revisiones+digests+`serializerImplemented`), paridad probada en Go (`TestMachineOutputCatalogParity`).
- Migración `000123_machine_output_selections` (tenant-owned, RLS + inventario + grants desde el primer migration; PK org+operación; version BIGINT).
- API generada: `GET /machine-output-selections` (read model: selección exacta + labels + blockers estructurales + catálogo) y `PUT /machine-output-selections/{operation}` (validación server del tuple: existencia/revisiones/digest exactos, familia, cobertura de operación; conflicto tipado VERSION_CONFLICT; permiso `RoleCanAccessSettings`).
- Resolver TS (`packages/excel/src/machines/outputSelectionResolver.ts`): `NO_OUTPUT_CONFIGURED | CONFIGURED{readiness}` — sin fallback a ptx-generic, sin bulk; `generateSelectedCuttingOutput` produce exactamente UN artefacto (golden sha preservado) y lanza con razones tipadas si está bloqueado; `machineOutputBlockerMessageEs` en dominio.
- UI: `MachineOutputSelectionSection` (packages/ui) dentro de Ajustes → Ingeniería y Producción: selects máquina/perfil por operación, estado `No probado`, readiness `Bloqueado` con razón accionable, drawer técnico con IDs/revisiones/digests, guardar con manejo de conflicto. Wiring AppContent→ShellView→SettingsScreen vía repositorio generado.
- Export normal (`useExportHandlers.handleExportCutPlanPtx`): con selección configurada genera SOLO el tuple seleccionado (éxito → 1 archivo; bloqueado → 0 archivos + mensaje exacto); sin configuración → flujo legacy intacto.
- Tests: Go dominio (paridad+validación+blockers), Go API (roundtrip, tuple inválido, conflicto stale, permiso vendedor, SERIALIZER_NOT_IMPLEMENTED surfaced), excel resolver (7: no-configured, ready exacto, cadmatic-4 bloqueado sin fallback, MPR pendiente, refs stale, un-target, generación 1-output golden). Storage/UI/web typecheck limpios.
- PENDIENTE para DoD de #591: test storage Go contra PostgreSQL real (RLS cross-org + versión), E2E browser real (escenario del mandato + negativos), corrida completa `pnpm test`+`init.sh` y CI del head exacto.

## Ronda de revisión (CHANGES REQUIRED) — corregida

- GET ahora exige el mismo gate factory (`RoleCanAccessSettings`): el catálogo interno de máquinas/adapters no reacha usuarios Store/ventas (403).
- Mismatch path-vs-body del PUT se compara ANTES de sobrescribir el valor decodificado (el bug destruía la detección); test construye body con operación distinta del path y cubre el caso.
- GET fallido ya no oculta la sección: `machineOutputLoadError` + banner con botón Reintentar (`machine-output-load-error` / `machine-output-retry`).
- Tras guardar, refetch del read model server-authoritative (nunca metadata fabricada localmente).
- Mapper del read model corregido: los records llegan PLANOS (bug destapado por el E2E; tests de regresión en `apiMappers.test.ts`).
- Storage PG real: conflicto de versión (insert→update→stale 409) y RLS cross-org (org B ve 0 filas; insert cross-org rechazado por WITH CHECK) — ambos PASS.
- E2E browser real 4/4 PASS: selección exacta persiste tras reload con resolver de un solo target; CADmatic 4 bloqueado con blockers visibles y SIN fallback a generic; stale → 409 VERSION_CONFLICT tipado; org B no lee la config de A.
