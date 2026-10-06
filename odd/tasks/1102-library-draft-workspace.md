# ODD — #1102 Slice A: Workspace de borrador (LIB-AUTH)

**Browser gates de C y D (rama feat/1102-library-dev-mode, PR stacked sobre D.2):**
los dos gates que los prompts de C y D exigían y quedaron NO_RUN:

- `tests/organization/library-publish-gate.spec.ts` (gate C): editar
  borrador (alta de material por la API de Catálogos) → DIFF lo muestra como
  agregado con label → publicar → el release nuevo queda PUBLICADO y es el
  current; publicar dos veces es 409 con el current intacto; sin perfiles
  activos el publish es 422 fail-closed con el vigente intacto, y recuperado
  el perfil el MISMO draft publica.
- `tests/organization/library-consumer-cycle-gate.spec.ts` (gate D, ciclo
  COMPLETO): consumidor A fijado a R1 resuelve la geometría congelada; editar
  el mueble (777mm) es visible sin pin pero INVISIBLE con el pin en R1;
  publicar R2 → B (pin R2) ve 777, A sigue en 600 hasta mover su pin;
  pinned reads de perfiles respetan el release. Sin pin el path vivo exige
  la revisión real (no hay implícito).
- **Contrato completado:** `furniture.libraryReleaseId` (introducido en el
  Slice D) ahora está en el yaml + regeneración — faltaba y los specs lo
  necesitaban tipado.
- **Tolerancia del diff:** un release publicado SIN manifiesto (estado de
  reparación #955) no es una base diferenciable — el diff lo trata como
  "sin base, todo agregado" en vez de fallar.
- Corridos con el harness de organización (contenedor PG desechable +
  backend + web + usuarios con platform admin): gate C 3 passed, gate D
  4 passed. Plan de shards: 41 specs, partición exacta PASS.

---

# ODD — #1102 Slice A: Workspace de borrador (LIB-AUTH)

**Item 2 del restante de D — plugin dev-mode (rama feat/1102-library-dev-mode, apilada sobre item 1):**
diseño publicado antes de codear (issuecomment-6002996520). Bajo la
arquitectura del issue, "resolver el borrador" desde el plugin YA ES el path
sin pin (tablas canónicas = estado de autoría), así que dev-mode es una
decisión del plugin: dejar de enviar el pin.

- `LibraryStore#dev_mode?/#set_dev_mode!`: marcador persistente en el store
  dir (dev_mode.json).
- `Application`: con dev ON, el `library_pin_provider` devuelve nil (ningún
  resolve lleva `libraryReleaseId` → el servidor resuelve el ESTADO DE
  AUTORÍA) y el sync de boot se salta (el pin no se mueve mientras probás).
  `toggle_library_dev_mode` público.
- Menú "Granete: alternar modo dev de biblioteca (borrador)" con messagebox
  explicativo; RBZ 0.1.40; expectations de menú actualizadas en
  wiring/application tests + 3 tests nuevos del flag.

---

# ODD — #1102 Slice A: Workspace de borrador (LIB-AUTH)

**Item 1 del restante de D — congelar la GEOMETRÍA (rama feat/1102-frozen-catalog-resolve, apilada sobre D):**
diseño publicado antes de codear (issuecomment-6002693223). El compilador
ahora junta TODO el catálogo de autoría desde UN snapshot consistente
(`GetFullCatalog` — incluye despiece y hardware lines de cada módulo) y lo
congela en 9 kinds nuevos (module/structure/component/agregado/material/
edge_band/option_group/module_category/material_category) + los existentes
hardware/hardware_profile. `ValidateModule` por módulo en la juntada:
fail-closed, un mueble roto no entra a un release inmutable; ids no-uuid
también. La degradación honesta de perfiles no cargables se mantiene.

- **Decodificación:** `storage.FrozenCatalogForRelease` reconstruye el
  `domain.Catalog` + categorías de material desde manifiesto + blobs,
  fail-closed (`ErrFrozenCatalogIncomplete`) ante blob faltante/ilegible —
  un resolve pineado JAMÁS cae a filas vivas.
- **Resolve pineado:** con `furniture.libraryReleaseId` el snapshot del
  resolve se arma desde el freeze y la Projection se reconstruye con el
  MISMO `buildWorkshopFurnitureCatalogValidated` (cero fork del sistema de
  parámetros). `CATALOG_REVISION_STALE` no se compara en modo pin: el pin
  reemplaza a la revisión como ancla (catalogRevision advisory). Test
  clave: módulo congelado con 611mm que no existe en el vivo → el resolve
  pineado devuelve 611.
- El batch de "probar borrador" (B) y el diff (C) ahora usan el MISMO
  snapshot de catálogo (una sola lectura consistente).
- **Hallazgos de la suite (arreglados):** `agregados.id` es TEXT PRIMARY KEY
  — ids no-uuid son legítimos del esquema, así que el gate estricto de uuid
  se convirtió en skip-with-WARN (`release_compile_skipped_non_uuid_resource`):
  la entidad no representable en el contrato #772 (refs uuid) no se congela;
  limitación nombrada. Y `GetFullCatalog` con ctx sin org crasheaba
  (`organization_id = ''` contra columna uuid) en fixtures que publicaban
  con el pool de migración — corregido con `WithOrgCtx` explícito en los 5
  sitios (el camino API siempre tiene org por middleware).
- Restante del restante: plugin dev-mode contra borrador (item 2).

---

**Slice D (rama feat/1102-lib-consumer-release desde main con A+B+C mergeados por el owner):**
diseño publicado antes de codear (issuecomment-6001874131). El hallazgo que
redefinió el slice: `ReleaseServerResolveInputs` (#875/#916) YA resuelve los
inputs de manufactura desde el release publicado (implícito "current"); el
trío LibraryStore de #774 estaba DORMIDO (sin adapter de API ni wiring).

- **Backend:** `furniture.libraryReleaseId` opcional en el request de
  authoring resolve. Presente → `ReleaseServerInputsForRelease` arma los
  inputs desde ESE release; no publicado/desconocido → 422
  LIBRARY_RELEASE_UNAVAILABLE (el pin significa exactamente ese release).
  La degradación honesta de blobs no cargables se mantiene (#875). La
  respuesta ya hacía echo del release id — ahora hace eco del pin del
  consumidor.
- **Allowlist extensión** (grant deliberado #1102): GET current / release /
  manifest / blobs — lectura de PUBLICADOS (RLS los limita).
- **Plugin:** `request_raw` en HttpAdapter (manifiesto y blobs viajan como
  bytes exactos — el store verifica sha256); `ReleaseApiClient` (puerto del
  synchronizer); `ConsumerPin#refresh!` (boot best-effort: sync current con
  expected hash + org-change guard; offline → pin viejo persiste);
  `RemoteCatalogProvider.library_pin_provider` inyecta
  `furniture.libraryReleaseId` en cada resolve; RBZ 0.1.39.
- **Web:** Vista consumidor — pin explícito por release, muestra los
  perfiles congelados vía el pinned read existente; "Actualizar a la última"
  mueve el pin; fijar manualmente una versión vieja simula al "otro
  consumidor" que se queda atrás.

**Restante nombrado (no implementado, a filear como issue propia):** congelar
la GEOMETRÍA del catálogo en releases (compilador extenso a
muebles/estructuras/materiales + resolve desde el freeze). Hoy la geometría
sigue leyendo tablas vivas; el pin cubre la capa de manufactura completa.
Plugin dev-mode contra borrador: también restante (probar borrador vive en la
web B).

---

**Slice C (rama apilada feat/1102-lib-draft-publish, base = rama B):**
diseño publicado antes de codear (issuecomment-6001287796). C = UI + wiring
más UN endpoint nuevo de lectura:

- `GET /api/manufacturing-libraries/standard/releases/{releaseId}/diff`
  (platform staff, read-only, simétrico a publish/validate): dry-run de
  compilación + comparación por (kind, id) contra el manifiesto del release
  publicado vigente → agregados / modificados (definitionHash distinto) /
  eliminados / sin-cambio. Labels del lado draft desde los payloads; los
  eliminados se etiquetan desde su blob content-addressed. Sin base
  publicada: todo agregado y base=null. Un draft que no compila responde
  422 estructurado (la respuesta honesta del diff).
- Web: botón "Publicar vN" en el banner → Modal compartido (focus trap, Esc)
  con `LibraryPublishConfirmContent` (loading del diff, listas etiquetadas,
  "sin cambios: N", advertencia de inmutabilidad, Confirmar/Cancelar —
  confirmar deshabilitado sin diff) + `LibraryPublishHistoryPanel`
  (colapsado por defecto, versión/fecha/hash corto/changelog). publishDraft
  refresca el workspace: el draft publicado sale de borradores y entra al
  historial; errores 409/422/red con mensajes distintos y el release
  anterior queda intacto (garantía del backend, mensajes lo comunican).
- Tests: application diff (sin base / clasificación completa con labels
  desde blobs / guards), handler (diff con labels reales 200, 403/404/409),
  hook (diff keyed, publish refresca y limpia el diff, 422 mantiene el
  release), banner (botón publicar), confirm content (loading/diff/error/
  confirm-cancel), history panel (colapsado/expandido).

---

**Slice B (rama apilada feat/1102-lib-draft-validate, base = rama A):**
diseño publicado antes de codear (issuecomment-6000798162). Bajo la
arquitectura de A, "browser con flag" y "plugin modo dev" son piezas de D
(hoy browser y plugin ya leen las tablas canónicas = el borrador; el flag
sólo cobra sentido cuando D corte consumidores a releases). El hueco real de
B era "una acción que diga si el borrador resuelve completo":

- `POST /api/manufacturing-libraries/standard/releases/{releaseId}/validate`
  (platform staff, read-only, simétrico a /publish): dry-run de compilación
  con los EXACTOS inputs del publisher (BuildStandardReleaseInputs →
  CompileLibraryRelease, nada persiste) + batch resolve de TODAS las
  definiciones de muebles del catálogo del caller con el motor del plugin
  (ResolveFurnitureLayout, medidas propias, sin choices). Reporte
  {ok, compile, furniture{total,resolved,failed,failures}, validatedAt}.
  Los módulos no tienen flag Active (borrado físico): el batch cubre todos.
- Web: botón "Probar borrador vN" en el banner + panel de reporte
  (LibraryDraftValidationPanel) con estados distintos válido/inválido,
  errores de compilación y fallas por definición. El reporte queda keyed al
  draft validado (un draft más nuevo nunca muestra un veredicto viejo).
- Tests: application (compile limpio / fail-closed sin perfiles / falla por
  definición / guards 404-409), handler (200 con conteos reales vía
  compilador y motor reales, 403/404/409), hook (validate keyed, no-op sin
  draft), banner (botón sólo con draft), panel (4 estados).

---

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
