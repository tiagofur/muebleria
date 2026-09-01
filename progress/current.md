# Feature activa: F202 (#460) — SEC-3 in progress

- Actualizado: 2026-09-01 America/Mexico_City
- F199 (#458) cerrada (`done`); ninguna otra feature `in_progress`.
- F202 y #460 continúan abiertos. SEC-1, SEC-2A y SEC-2B (PR #528) están
  integrados; slice **SEC-3** (resource-scoped media authorization +
  eliminación completa del generic session JWT por query string) implementado
  en rama `feat/460-3-media-authorization`, pendiente de revisión
  independiente y sin merge.
- SEC-4/5/6/7/8/9 no avanzaron en este slice.

## Hechos implementados SEC-3

- `AuthMiddleware` sin fallback `?token=`: un session JWT sólo autentica por
  `Authorization` header. Negative proofs sobre `/api/auth/me`, una business
  route y una media route; header-wins con query token hostil.
- `auth.MediaAuthority` (`internal/auth/media.go`): grants `media_read`
  dedicados — `typ=media_read`, `iss/aud=granete-media`, `ver=1`, resource key
  canónico `media/<filename>` como material firmado (en `resource` y `sub`),
  `org_id`, `op=read`, `exp/nbf/iat/jti` obligatorios, `sid/uid` de
  procedencia, TTL 3 minutos con cap al absolute expiry de la sesión que minta.
- `MEDIA_SIGNING_KEY` obligatoria (≥32 bytes; boot fail-closed), sin primitiva
  compartida con `JWT_SECRET`/`JWT_KEYRING`/`REFRESH_TOKEN_PEPPER`. Env
  examples, docker-compose.prod, dev.sh, smoke/gate scripts actualizados.
- `POST /api/media:authorize` (OpenAPI generado, sin drift, tipos Go/TS
  regenerados): sesión + scope org obligatorio; recursos tipados canónicos
  1..100 (nunca URLs arbitrarias); archivos ajenos/missing omitidos
  (enumeration-safe); respuesta `no-store`. Extension token recibe capability
  POST deliberada para `:authorize` (todo otro POST sigue prohibido).
- `GET /api/media/{name}`: precedencia explícita header-session O `?grant=`;
  grant para otro archivo = 404 indistinguible de missing; errores tipados
  `MEDIA_ACCESS_EXPIRED`/`MEDIA_ACCESS_INVALID`; `Cache-Control: private` +
  `Vary: Authorization`.
- React: `apps/web/src/stores/mediaAuthorization.ts` — cache token-scoped en
  memoria (batch 15ms, dedupe, refresh pre-expiry, invalidación por cambio de
  token/logout, late-response drop, sin persistencia); `mediaSeq` re-renderiza
  consumidores; `resolveMediaUrl` (workspace + catalog) ya no agrega `?token=`.
- SketchUp: `Assets::MediaAuthorizer` intercambia el bearer por URLs firmadas
  per-file; los webviews (`dialog.html`, `material_selector.html`) resuelven
  por mapa de grants y re-mintan vía callbacks `refresh_media_url` /
  `updateMediaUrl`; la sesión del plugin nunca llega al HtmlDialog;
  `logging.rb` redacta `grant=` igual que `token=`.

## Evidencia enfocada ejecutada

- `go test ./internal/auth ./internal/config ./internal/api -count=1`: verde.
- `go test ./tests/pilotreadiness -run '^TestMediaAuthorization' -count=1`:
  verde con PostgreSQL real (E2E completo: upload→authorize→GET sin header,
  exact-resource, cross-tenant, confusión de credenciales, revocación de
  sesión corta minting).
- `pnpm openapi:check`: verde sin drift.
- `pnpm typecheck` y `pnpm test` (web, incl. `mediaAuthorization.test.ts` y
  workspace media tests): verde.
- Suite Ruby de la extensión: verde en archivos tocados
  (`media_authorizer_test.rb` 6/6, `dialog_controller_test.rb` media tests,
  `option_selector_controller_test.rb`, `logging_test.rb`); los failures
  restantes del suite son idénticos al baseline pre-rama (verificados con
  stash) y no tocan media.
- Gates finales (`organization-browser-gate.sh`, `smoke-deploy.sh`, full
  `go test ./...`, `git diff --check`) se ejecutan en la validación final del
  slice.

## Review externa (Review ID 5080000775 — CHANGES REQUIRED) y correcciones

Tres blockers corregidos en el parche post-review:

1. **Chunking ≤100**: `flushQueue` parte la cola en batches de ≤100 (límite
   del servidor); prueba 101 archivos → exactamente 2 requests (100+1).
2. **Carrera en la ventana de batching**: la cola/timer ahora viven en un
   scope por (token + baseUrl); un cambio de token abandona el scope previo
   (timer cancelado, cola descartada) en vez de flusearla con el
   Authorization de otro tenant. Prueba: A encola → switch a B → el único
   request lleva sólo el archivo de B con el token de B.
3. **Cache alineada al TTL del credential**: `GET /media/{name}` vía grant
   responde `Cache-Control: private, max-age=<TTL restante del grant>` (≤180s);
   la lectura con header de sesión conserva `max-age=86400`. Pruebas de ambos
   valores.

Recomendación no bloqueante también aplicada: `pendingMediaRefresh` en los
webviews de SketchUp usa timestamp + ventana de reintento (5s) para que un
mint fallido no deje la imagen marcada para siempre.

## Bonus post-review: deuda previa eliminada (nada queda como "pre-existing")

Diagnóstico real de los fallos que se etiquetaban pre-existing en la suite Ruby:
**requires incompletos en los archivos de TEST** (la arquitectura del plugin es
deliberadamente manifest-based: `main.rb` ordena la carga y el boundary test
`test/boundary/ownership_test.rb` prohíbe `require_relative` entre archivos
runtime — verificado verde). Los tests individuales dependían de la
contaminación de constantes del proceso compartido del rake de CI; standalone
fallaban. Corregido completando los requires de cada archivo de test con su
clausura de dependencias en orden load-safe (catalog_provider antes de
layout_contract; transports/auth/param-contract para RemoteCatalogProvider;
assets/migration/selection para dialog_controller/application). Suite completa
unit+boundary ahora verde archivo por archivo (antes: ~25 fallos/errores
distribuidos en 10 archivos).

También como bonus:
- Flake real de CI corregido en `catalogStore.test.ts` (ventana fija de 10 ms
  → polling con deadline de 2 s para la serialización de saves).
- Readiness de PostgreSQL del browser gate endurecido: ventana 60→120 s y
  dump del log del contenedor al fallar (el flake "did not become ready" era
  no diagnosticable).

## Estado de entrega

SEC-3 queda `SEC-3 implemented pending review`. F202 sigue `in_progress`,
#460 sigue abierto, sin merge. Roadmap restante explícito: SEC-4 Web
credential migration, SEC-5 Mobile credential migration, SEC-6 SketchUp device
credentials, SEC-7 MFA/step-up, SEC-8 trusted proxy/rate limits/account
hardening, SEC-9 gate final + ver4 EOL.
