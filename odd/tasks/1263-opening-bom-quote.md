# ODD 1263 — BOM de apertura real: exposición + cotización (V1 OPEN-FRONT)

Issue: #1263 (status:approved). Base: origin/main fc73c4b2. Rama: feat/1263-opening-bom-quote.
Writer: agente ZCode (único escritor). Lane: Delegated Direct (este artefacto).

## Alcance aprobado

1. `DesignOpeningResolution` expone las líneas de `ResolveOpeningBOM` (mismo endpoint de diseño).
2. Wiring a cotización: líneas de apertura entran al snapshot comercial desde el resultado resuelto (Q1 design-first y requote), con precio por el canal existente `profileDemandPerItem` (misma validación fail-closed de hardware).
3. Cantidades desde la ficha (spacing/miembros), nada hardcodeado.
4. Histórico fiel: el pin congela además la revisión + miembros BOM (`pin.bom`); sin fallback a catálogo vivo.
5. E2E browser del recorrido seleccionar→guardar→resolver→cotizar→reabrir (DB descartable, perfil 8006 sembrado desde la ficha).
6. PDF de ficha `docs/fichas/perfil_gola_l_ficha_tecnica.pdf` entra al repo como evidencia.

## Decisiones de diseño (registradas)

- **Canal de precios**: matriz `profileDemandPerItem` index-aligned (patrón #986) — las sumas por línea y el validador `Σ lines == breakdown` se mantienen sin canal nuevo.
- **Sección congelada**: `QuoteCommercialSnapshot.OpeningBOM` aditiva y opcional (patrón `ProfileDemand`); expuesta en DTO + openapi (spec E2E la afirma). Revisiones congeladas existentes jamás ganan una.
- **Pin**: `DesignOpeningProfilePin.BOM{profileVersion, members}` se captura en el PUT de toda selección gola válida (miembros pueden ser vacíos = «declarado: ninguno»; `nil` = pin pre-#1263 → razón truthful `OPENING_BOM_PIN_SLICE_MISSING`, nunca fallback a vivo).
- **Ancho interior**: input del cuerpo — v1 lo deriva del espesor de los componentes `lateral` de la estructura del módulo (`interior = width − 2×t`); no derivable ⇒ `OPENING_BOM_BODY_CONTEXT_MISSING` (sin líneas, nunca inventado). El resolver NO lo deriva (contrato #1133).
- **Extremos de corrida**: v1 declara `exposed|exposed` por defecto (sin autoría de extremos aún), visible en el payload (`bomEnds`) — sobre-cuenta tapas antes que inventar cerrado.
- **Fail-closed de cotización**: selección gola que no puede producir su BOM ⇒ la cotización falla con `ErrInvalidRevisionSnapshot` + razón (nunca cotiza sin la gola que el diseño declara).
- **Fingerprint**: `authoring_defaults` entra al hash en los dos gemelos (design_quote_lifecycle + commercial_projection) — cambiar SOLO la apertura cambia el fingerprint.
- **Requote**: resuelve desde `inputs.Design.AuthoringDefaultsSnapshot` (congelado al publicar) por el mismo helper — Q2+ refleja cambios de apertura/ancho y retira líneas al quitarla.
- **Piloto un-módulo**: la resolución y el BOM usan el primer ítem del diseño (limitación documentada; multi-mueble = follow-up).

## Tareas

- [x] CU1 engine/domain: pin BOM slice, `DesignOpeningBOMContext`, resolución con BOM, espesor lateral helper + tests engine + PDF.
- [x] CU2 API: PUT captura pin.bom; GET/PUT devuelven `resolution.bom` + `bomEnds` + tests stub.
- [x] CU3 storage/domain: sección snapshot + validador + builder, derive compartido Q1/requote, fingerprint gemelos, demanda index-aligned + tests RLS fixture.
- [x] CU4 DTO/openapi/TS regen + spec browser E2E + gates.

## Evidencia

- `go test ./internal/domain/ ./internal/domain/engine/ ./internal/api/` verde (incluye TestResolveDesignOpeningBOM, TestHandleDesignOpeningResolvesBOM, pin BOM en PUT).
- `scripts/backend-test.sh -run "OpeningBOM" ./internal/storage` verde: sección congelada exacta (0.764 m/764 mm, 3 soportes, 2 tapas), HardwareTotal 116.4, sensibilidad del fingerprint, fail-closed pin legado.
- Suite completa storage+domain+api + gate browser del spec nuevo: en corrida (resultado abajo).
- Typecheck workspace completo + tests/tsconfig.json del spec: verde.

## Observaciones de implementación

- El BOM entra a precios por `mergeOpeningDemand` (matriz #986, keying por línea en Q1 / por instancia en requote) — las sumas del validador se mantienen sin canal nuevo.
- `toQuoteCommercialSnapshotDTO` + `granete-api.v1.yaml` + regeneración TS/Go: la sección `openingBom` viaja en el snapshot HTTP (aditiva, opcional).
- Gemelos del fingerprint (`design_quote_lifecycle.go` + `commercial_projection.go`) ahora hashean `authoring_defaults` — el token de proyección sigue siendo la fuente canónica del cliente, sin migración.
- Requote resuelve desde `design_revisions.authoring_defaults_snapshot` (legacy NULL ⇒ defaults vacíos ⇒ sin BOM, veraz).

## Límites / entrega

- Paridad TS del resolver BOM intacta (contrato `openingBom.contract.json` sin cambios: la matemática no cambia).
- Web UI de render de la sección: fuera de alcance (exclusions #1263).
- Proyección comercial (estimación) sólo cambia el fingerprint gemelo; no expone BOM en v1.
