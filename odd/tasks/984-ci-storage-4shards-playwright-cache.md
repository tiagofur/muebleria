# ODD — #984 optimización de CI: storage 4 shards + timings frescos + cache Playwright

## Contexto

Con #982 mergeado en main, el browser gate cayó de ~11m a ~5m15s (distribuido
en 3 shards independientes). El análisis de duraciones del primer run verde
completo de main (`37094724424`) reveló el nuevo cuello de botella:

1. **Storage shard 3/3 = 7m19s** (los otros dos shards en 5m47s y 5m10s).
   Causa: la suite de storage creció de 509 a **580 tests top-level** (763
   tests en total contando subtests), por lo que 71 tests nuevos no tenían
   timing en el baseline `storage-before-81a7896.timings` y LPT los apilaba
   desbalanceados.
2. Cada job con Playwright (`proyectar-visual` y `organization-browser-shards`)
   gasta ~25-30s descargando Chromium en cada corrida limpia.

## Cambios

1. `backend-go/testdata/storage-2026-10-03.timings`: archivo generado con los
   580 tests top-level medidos en PostgreSQL efímero local (`-v`). Reemplaza
   al archivo obsoleto `storage-before-81a7896.timings`.
2. Storage a **4 shards**: con el nuevo baseline, LPT balancea a ~1m56s
   estimados por shard (134, 138, 140, 168 tests). En CI esto proyecta
   ~3m50s - 4m15s reales por shard (eliminando el pico de 7m19s).
3. `ci.yml`:
   - Matrix de storage expandido a `shard: [1, 2, 3, 4]`.
   - `storage-shard-plan` verifica 4 shards no-vacíos.
   - Cache de Playwright (`actions/cache@v4` en `~/.cache/ms-playwright` keyed
     por lockfile) en `proyectar-visual` y en `organization-browser-shards`.
4. Tests de infraestructura:
   - `scripts/test_ci_storage_sharding.py` y `scripts/test_factory_efficiency.py`
     actualizados para verificar 4 shards y el nuevo baseline.
   - 72/72 pruebas de script pasan limpias.

## Verificación

- `scripts/verify_storage_shard_plan.py`:
  `PASS: storage shard plan AST roots=580 union=complete intersections=empty cardinality=exact shards=4 counts=134/138/140/168`
- `validate-catalog`: 72/72 CI script tests + 19/19 factory efficiency + 13/13 factory workflow contract.
