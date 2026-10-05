# ODD — #1102 Slice A: Workspace de borrador (LIB-AUTH)

- **Base:** origin/main `a3a8a250f1cf93d57f036bdb91c3dc0c3f6fb985`
- **Lane:** Delegated Direct (1 Explorer read-only para la superficie web; 1 writer)
- **Diseño:** decisión publicada ANTES de codear en
  https://github.com/tiagofur/muebleria/issues/1102#issuecomment-5999653865

## Decisión de diseño (resumen)

Opción elegida: **las tablas canónicas son el estado de autoría (el borrador);
los releases publicados son la única superficie de consumo** — el pipeline
literal de #773. Descartada la store sombra de cambios (opción 1): #772 prohíbe
una segunda store mutable de catálogo, pierde invariantes tipadas hasta el
promote, obligaría a cada hot path de resolve a fusionar overlay, y quedaría
stranded tras el slice D.

## Tareas ejecutadas

1. Migración 000156: `library_releases_read` ampliada con el marcador
   `app.platform_admin` (#955) para drafts de librerías owner-NULL. Tenants
   conservan la superficie published-only exacta. Inventario RLS actualizado,
   up/down simétricos.
2. `PostgresStore.GetDraftReleases` (drafts newest-first).
3. `GET /api/manufacturing-libraries/standard/releases/drafts` — gate
   platform-admin idéntico a create/publish (#955); ruta literal que gana sobre
   `{releaseId}` en ServeMux.
4. Fix en el borde del workspace: `POST .../releases` con versión duplicada
   ahora responde 409 estructurado (era 500) — el "Abrir borrador" sugiere la
   siguiente versión y dos aperturas concurrentes pueden competirla.
5. Contratos: path + regeneración (`generate_openapi.py`); drift check PASS.
6. Web: hook `useStandardLibraryWorkspace` (publicado + drafts, sólo
   `platform_admin`; `openDraft` con versión sugerida patch+1; 403/409 con
   estados de error distintos) + `LibraryDraftWorkspaceBanner` (packages/ui,
   estados loading/error/draft/sin-draft, data-testids, copy español honesto:
   NO promete aislamiento de consumidores hasta que D lo materialice) montado
   en ShellView sobre las 10 superficies de autoría (Catálogos + Librería).

## Trampas encontradas

- `pnpm openapi:generate` corre contra el cwd: ejecutarlo DENTRO del worktree,
  no del checkout main (regenera el yaml de main).
- Test de hook React: guardar el resultado del hook en variable EXTERNA
  reasignada por el componente (leer el retorno de un helper devuelve el
  snapshot stale del primer render). Patrón: useFactoryConstructionPolicy.test.ts.
- El generador TS exige que toda respuesta sea `$ref` o array de `$ref` —
  reusar `LibraryReleaseSummary`.
- **Hallazgo (preexistente, no introducido):** la política write de #955
  (000146) es `FOR ALL` con `USING (app_platform_admin() OR owner-org)` —
  PostgreSQL compone políticas permisivas con OR, así que el marcador
  platform_admin YA daba a staff SELECT de TODOS los drafts de librería
  cross-org. 000156 no cambia esa autoridad (sólo añade la rama owner-NULL a
  la política de lectura); el test nuevo la fija (`pinned here so any future
  narrowing is explicit`) para que un estrechamiento futuro sea explícito.
  Para el ciclo LIB-AUTH esto es coherente: el compilador Standard ya lee
  `AnyOrg` por diseño.
- El draft inicial sembrado por 000139 (UUID fijo, '0.1.0-draft') aparece en
  `GetDraftReleases` — el workspace lo ignora (usa el más reciente) y el test
  documenta ambas filas.
- `scripts/backend-test.sh` sin `-timeout=30m` usa el default de go (10m) y el
  package storage completo lo pasa: SIEMPRE pasar `-timeout=30m` (CI así lo
  hace).
- `scripts/backend-test.sh ... | tail` trunca el log y borra el nombre del
  test que falló: redirigir a archivo y grepear después.

## Verificación (V0/V1/V2)

- V0: `pnpm typecheck` PASS (7/7 paquetes); `go build ./...` + `go vet` PASS;
  gofmt limpio en archivos tocados; drift check PASS.
- V1: `pnpm test` PASS (ui 2130 + web 585 + otros 16); `rake verify` extensión
  PASS (6 runs, 3951 assertions); scripts unittest contract (72+13) PASS;
  `scripts/backend-test.sh` (runner aislado #823, PG real):
  - API handler tests nuevos: drafts 200/403/405, 409 duplicado — PASS.
  - Storage RLS nuevo `TestManufacturingLibrary_RLSStandardDraftReads`:
    tenant sin marcador NO ve el draft (0 rows) y conserva el published;
    platform admin lee los drafts Standard vía store (incluye el sembrado de
    000139, newest-first); overlay de otra org visible para staff (autoridad
    #955 preexistente, fijada en test) y para su owner org — PASS.
  - Suite completa `./...` con `-timeout=30m`: ver PR para el run exacto.
- V2: browser gate NO_RUN en este slice — la demo end-to-end
  (editar→validar→publicar→consumidor) exige slices B/C/D; el gate de la issue
  se ejecuta al cierre. Smoke de UI pendiente de host real del owner.

## Entrega

`Refs #1102` + `Delivery: partial`. Restante para completar la issue:
- Slice B: consumidor de prueba del borrador (resolver sin tocar el vivo).
- Slice C: pantalla de publicación con diff + historial.
- Slice D: consumo por release fijado (`effectiveLibraryReleaseId`) en plugin
  y ventas; extender el compilador a los kinds que consuman.
