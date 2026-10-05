# ODD — #1096: #443 slice 3 — familias estructurales con If-Match + browser proof

- Issue: #1096 (child de #443, slice 3 de 3).
- Autorización: owner en sesión 2026-10-05 ("sigamos" tras el merge del slice 2).
- Lane: ODD (Delegated Direct). Estado: IMPLEMENTED_PENDING_REVIEW.
- Base: `origin/main` @ `9c8dfea7` (merge de #1094).
- Branch: `feat/1096-slice3-concurrency`.
- Modo de entrega previsto: `Closes #1096` + `Delivery: complete`.

## Alcance

1. Migración 000155: `version` server-owned en components, structures, agregados.
2. Storage guards (patrón slices 1-2, helper `disambiguateRowNotFound`).
3. Handlers If-Match/412/ETag + interfaz + stubs.
4. Web: loops de components/agregados/structures → `upsertGuarded` + siembra en getCatalog.
5. Browser proof en el gate de organización: dos clientes sin revertirse, stale → 412 explícito, write vigente persiste.
6. Fuera de alcance (decisión en la issue): rediseño de orquestación de stores (fan-out queda como transporte; cada write ya es guardado).

## Notas de diseño

- `UpdateStructure`: guard en el UPDATE final de la tx; rollback descarta el snapshot de revisión en writes stale. `revision` (negocio) ≠ `version` (concurrencia).
- Estructura de tests legacy: insertar headers con cuidado de NO tocar los casos negativos (lección del slice 2).

## Evidencia

- Storage: batería `TestStructuralFamilies_OptimisticConcurrency` (3 familias: write A gana v2, stale B sin mutar, deactivate guardado); tests legacy actualizados (components_construction, structures_108, agregados_test, agregado_revisions, catalog_f116, quote_commercial_snapshot) usando la versión leída por el Get previo.
- Handlers: 428/412/ETag aplicados en Component/Structure/Agregado ByID; conflicto dentro del bloque de error (incl. el caso structures donde el rollback descarta el snapshot de revisión).
- Fixture de paridad `contracts/componentWire.contract.json` + `version` (el wire Go ahora lo emite).
- Web: loops de components/agregados/structures → `upsertGuarded`; siembra desde getCatalog; test `saveCatalog PUTs agregados body` actualizado al learn-first; suite 50/50.
- Browser proof: `tests/organization/catalog-ifmatch-concurrency.spec.ts` — login real en Browser Gate A, dos clientes: A gana (200), B stale → 412 VERSION_CONFLICT sin revertir, B reconcilia → 200.
- Suites completas + CI: backend verde local (api 21s, storage 509s, pilotreadiness, EXIT=0); TS 8/8 + tests ✓; drift ✓.

## Resolución del bloqueo de shards (definitiva)

El rojo de CI se reprodujo localmente y se diagnosticó con instrumentación temporal del servidor (layout.go + freeze): el módulo compartido GATE-A quedaba con **dimensiones 0/0/0** porque `seedDistinctModule` heredaba la forma de `catalog.modules[0]` (dependiente del orden/estado del catálogo) y el re-guardado perdía las medidas. El freeze rechaza correctamente un mueble sin medidas válidas (fail-closed del servidor) — el fallo era datos malformados del fixture, no regresión de slice 3.

**Fix de raíz (29b6befa)**: el módulo compartido se siembra con dimensiones explícitas 600×720×560 — auto-descriptivo, independiente del orden del catálogo y del estado que otros specs dejen. Además, los upserts de los specs del gate (5 archivos) migraron a learn-first + If-Match (requerido por el contrato) y el quote spec hace surface de `details.reason` (mejora permanente de diagnóstico).

**Validación local definitiva**: demo + quote + proof en el mismo stack = 3 passed; set enfocado de 7 specs = 17/17 (un fallo transitorio de red local en la primera corrida del gate completo, no reproducible en re-corrida ni en CI); **CI 22/22 success** con el plan recorrido (3 shards, 39 specs).

Estado: IMPLEMENTED_PENDING_REVIEW. HEAD: 29b6befa.