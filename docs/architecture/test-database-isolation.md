# Test Database Isolation — PostgreSQL y E2E

> Estado: **contrato canónico**.
> El runner Go y el CLI administrativo ya tienen guardas; el preparador browser
> valida ambos destinos antes de lanzar procesos escribibles. La aceptación
> completa de #823 depende de la revisión y las pruebas del candidato exacto.

## 1. Objetivo

Granete usa PostgreSQL real para probar migraciones, RLS, concurrencia, idempotencia, Digital Thread, Q/R/P y recorridos browser. Esa cobertura se conserva, pero los tests automatizados **nunca** pueden escribir en una base persistente de desarrollo o producción.

```text
automated test
    ↓
ephemeral container OR throwaway test database
    ↓
real migrations / real PostgreSQL / real API
    ↓
discard whole environment

NEVER
automated test → persistent dev database "muebles"
```

La limpieza por row no es una frontera de aislamiento. Es sólo una defensa secundaria dentro de un entorno que ya es descartable.

## 2. Incidente y evidencia

El diagnóstico de 2026-09-22 encontró tests de integración que todavía aceptan como fallback:

```text
postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable
```

y luego confían en `t.Cleanup`, DELETE o restauración manual de valores. Ese patrón puede dejar rows si el proceso se cancela, el test falla antes de registrar todo el teardown, aparece una FK/tabla nueva, un cleanup queda desactualizado o un agente termina la ejecución.

Archivos confirmados durante el diagnóstico incluyen, sin declarar la lista exhaustiva:

- `backend-go/internal/storage/ambient_test.go`
- `backend-go/internal/storage/catalog_f116_test.go`
- `backend-go/internal/storage/hardware_machining_test.go`
- `backend-go/internal/storage/hardware_part_finishes_test.go`
- `backend-go/internal/storage/hardware_preview_test.go`
- `backend-go/internal/storage/idempotency_postgres_test.go`
- `backend-go/internal/storage/machine_output_selections_test.go`
- `backend-go/internal/storage/material_tile_persist_test.go`
- `backend-go/internal/storage/structures_108_test.go`
- `backend-go/internal/storage/tenant_transaction_consistency_test.go`

#823 debe hacer un inventario completo; esta lista sólo fija evidencia ya observada.

## 3. Lo que ya está bien aislado

No reiniciar infraestructura que ya cumple.

### Organization browser gate

`scripts/organization-browser-gate.sh` crea PostgreSQL temporal con datos en
`tmpfs` y bind sólo a `127.0.0.1`. Antes de arrancar el backend (que ejecuta
migraciones) o `cmd/admin`, pasa ambas URL explícitas por
`cmd/testdb-preflight`: reutiliza los validadores de test y comprueba markers,
base, puerto e instancia compartidos, y roles distintos. El backend recibe
`granete_app` (sin superusuario ni `BYPASSRLS`) para runtime y `postgres` para
migraciones; `cmd/admin` recibe `MIGRATION_DATABASE_URL` explícita. Cada hijo,
incluido Playwright, recibe un entorno limitado con `env -i`, no los `PG*` ni
las URL heredadas del operador. El runner relee los dos usuarios y las dos
organizaciones sintéticas en la base descartable y destruye backend, contenedor
y directorio temporal mediante `trap`. Compila el backend antes de lanzarlo y
ejecuta directamente el binario: así el PID controlado por el `trap` es el del
servidor, no el padre de un proceso `go run` que podría dejarlo vivo.

### Pilot Readiness y suites throwaway

`backend-go/tests/pilotreadiness/`, `multiOrgFreshDB` y otros fixtures ya crean bases separadas y las eliminan. Deben converger al helper común cuando #823 lo implemente, sin perder pruebas de concurrencia/RLS.

## 4. Reglas duras

### Prohibido

Un test automatizado no puede:

- usar `muebles` como DB escribible;
- tener fallback silencioso a `localhost:5445/muebles`;
- considerar una `DATABASE_URL` genérica permiso suficiente para escribir;
- depender de DELETE/`t.Cleanup` como única protección de datos humanos;
- ejecutar migrations escribibles sobre una DB normal sólo porque está accesible;
- ejecutar `tests/organization` contra el backend normal sin marcador de aislamiento;
- limpiar por nombre/prefijo ambiguo y asumir que distingue datos humanos de test.

### Permitido

- PostgreSQL Docker efímero por suite/gate;
- base throwaway con nombre inequívoco de test;
- CI service container efímero;
- transacción con rollback **dentro de una DB ya descartable**;
- `t.Cleanup` / teardown como segunda defensa;
- seed, migrations, RLS, roles y APIs reales dentro del entorno descartable.

## 5. Contrato del runner Go

#823 debe crear o consolidar un runner canónico, nombre sugerido `scripts/backend-test.sh`, que:

1. no reutilice `postgres_data` de `docker-compose.yml`;
2. cree entorno PostgreSQL descartable;
3. cree el runtime role necesario;
4. exporte `DATABASE_URL` y `MIGRATION_DATABASE_URL` del entorno de prueba;
5. exporte una marca explícita, por ejemplo `GRANETE_TEST_DATABASE=1`;
6. ejecute el alcance Go solicitado;
7. destruya el entorno completo al finalizar;
8. no exponga secretos en logs;
9. trate falta de infraestructura como failure/blocked cuando el gate la exige.

`./init.sh` debe invocar este runner cuando ejecute la suite Go histórica; no debe abrir la DB persistente del desarrollador.

### Destino explícito de `cmd/admin`

Cada comando de `backend-go/cmd/admin` requiere una URL PostgreSQL completa en
`MIGRATION_DATABASE_URL` (host y base de datos explícitos). No usa `DATABASE_URL`
ni un destino local implícito cuando falta esa variable. La validación sucede
antes de abrir la conexión y rechaza parámetros de consulta que sustituyan el
host, puerto o nombre de base visible en la URL. Los errores del CLI no muestran
la URL ni la contraseña.

Cuando `GRANETE_TEST_DATABASE=1`, el CLI aplica además
`ValidateTestAdminDatabaseURL`: sólo admite los destinos de prueba autorizados.
Fuera de la preparación automatizada, una operación administrativa humana
puede usar una URL persistente **explícita**; no se le exige un marcador de test.
La preparación browser valida los dos DSN contra el puerto del contenedor
descartable antes del primer proceso que pueda migrar o crear datos.

## 6. Guardia fail-closed en Go

El aislamiento no puede depender sólo del shell. Los helpers de integración deben validar la conexión **antes del primer write**.

Deben rechazar al menos:

- database name `muebles`;
- DB sin naming/marker de test;
- entorno production;
- DSN no reconocido como descartable cuando la prueba va a mutar.

Una forma válida puede combinar `GRANETE_TEST_DATABASE=1` con nombres como `granete_test_*`, `granete_gate`, `muebles_multiorg_test` u otra allowlist explícita.

Los validadores compartidos de conexiones de test escribibles y administrativas
rechazan URLs sin host explícito y parámetros de consulta (`host`, `port`,
`dbname`, `service` y variantes) capaces de sustituir el destino visible. Así,
la URL que pasa la allowlist no puede resolverse silenciosamente hacia otra
base mediante opciones de conexión.

Negative proof obligatorio:

```sh
DATABASE_URL='postgres://.../muebles?sslmode=disable' go test ...
```

debe fallar antes del primer INSERT/migration escribible.

## 7. Estrategia por tipo de test

- **Unit/domain:** sin PostgreSQL.
- **Persistencia simple:** rollback transaccional cuando sea suficiente, pero dentro de DB throwaway.
- **Concurrencia/restart/idempotencia:** DB throwaway real; no forzar una sola transacción.
- **Migraciones/RLS/roles:** PostgreSQL y roles reales, DB descartable; no mocks.
- **Browser organization:** contenedor/DB/backend temporales como `organization-browser-gate.sh`.

## 8. Browser E2E fail-closed

El runner browser ya crea infraestructura efímera. #823 debe impedir ejecución accidental contra el backend normal.

Contrato exigido por el preparador:

```text
ORGANIZATION_TEST_ISOLATED=1
ORGANIZATION_TEST_DATABASE_URL=<test-only DSN>
GRANETE_TEST_DATABASE=1
DATABASE_URL=<runtime role en la misma DB descartable>
MIGRATION_DATABASE_URL=<migration role en la misma DB descartable>
```

`tests/organization/support/globalSetup.ts` y la config usan el mismo guard
de URL de fixture antes de `prepareAuthoritativeOrganizations()`: exige destino
loopback, puerto/credenciales explícitos, nombre de test permitido y rechaza
opciones de consulta que sustituyan host, puerto o base. Su regresión DB-free
se ejecuta con `pnpm test`. El preparador además
fija la URL de fixture igual a la administrativa validada, y entrega las URL y
markers explícitamente a backend, CLI administrativo y Playwright.

Sin esa evidencia, Playwright debe abortar **antes** de crear invitaciones, clientes, proyectos, diseños, FurnitureInstances o QuoteRevisions.

## 9. CI anti-regresión

La regla debe tener un gate ejecutable. Como mínimo debe detectar:

- nuevo literal `localhost:5445/muebles` en `*_test.go`;
- nuevos helpers de integración que abran `DATABASE_URL` escribible fuera de la abstracción permitida;
- cambios que permitan organization E2E sin guardia aislada.

`scripts/test_ci_organization_browser_preparation.py` ejecuta el launcher real
con dobles sin conexión: verifica que un preflight rechazado no lanza backend,
CLI ni Playwright y que todos los hijos reciben los destinos y markers
preparados sin heredar `PG*`. El check no sustituye las pruebas Go del
validador ni una ejecución operativa contra PostgreSQL descartable.

## 10. Seed y arranque normal

El backend normal ejecuta migraciones al arrancar, pero no debe sembrar business data. `backend-go/internal/storage/migrations_no_seed_test.go` fija que una migración fresca no cree materiales, componentes, módulos, clientes, proyectos, cotizaciones ni otros rows de negocio.

El seed demo es explícito (`cmd/admin seed`) y su cleanup conocido es `cmd/admin clean-demo-data`. No confundir ese seed con test data arbitraria.

## 11. Basura existente

Prevenir nuevas fugas y limpiar datos existentes son operaciones separadas. `clean-demo-data` sólo conoce el seed oficial y no debe expandirse a DELETE agresivos de E2E por nombres ambiguos.

Para rows test ya acumulados:

1. inventariar candidatos;
2. mostrar dry-run;
3. comprobar relaciones;
4. borrar hijos/proyectos inequívocos primero;
5. borrar clientes/catálogos test sólo sin datos humanos dependientes;
6. resetear toda la DB local sólo como operación separada y explícita del propietario.

## 12. Relación con regresiones de producto

Este contrato evita contaminación de entorno; no absorbe bugs funcionales no relacionados. La regresión de materiales/texturas React → Go → SketchUp se corrige y prueba por su propia autoridad. Su regression test puede usar esta infraestructura aislada, pero no se mezcla su implementación con #823 salvo causa técnica compartida demostrada.

## 13. Definition of Done de #823

- ningún test Go escribible apunta a `muebles`;
- runner Go efímero usado por `init.sh`;
- guardia fail-closed dentro de tests;
- organization browser exige marca/DSN aislados;
- CI impide reintroducir patrones prohibidos;
- PostgreSQL/RLS/concurrencia siguen siendo pruebas reales;
- fallo/cancelación no deja business rows en DB persistente;
- documentación y comandos reales coinciden.

Hasta que #823 esté integrado, este documento es el contrato objetivo y los fallbacks legacy señalados arriba son **deuda conocida**, no comportamiento aceptado.
