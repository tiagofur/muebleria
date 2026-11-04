# ODD — #1493 Selección automática de altura N/M/K/E MERIVOBOX (slice 1: kit por variante)

- **Issue:** https://github.com/tiagofur/muebleria/issues/1493 (`status:approved`)
- **Aprobación:** owner 2026-11-04 — fileado con plan; 3 decisiones de diseño confirmadas vía AskUserQuestion: (1) E = kit por variante con galería como kit-part (NO miembros condicionales), (2) cotización por altura incluida en la issue (slice 3), (3) datos reales vía UI en la librería del owner. Plan de 3 PRs + fase final aprobado en plan mode.
- **Lane:** Delegated Direct — este artefacto único. Slice 1 de 3 PRs encadenados.
- **Escritor:** ZCode (agente). Reviewer: independiente (judgment-day dual), pendiente.
- **Base:** `main` @ `92ac6249` (post #1492) · Rama: `feat/1493-s1-kit-por-variante`.

## Alcance de este slice (PR 1 del plan aprobado)

El motor de variantes ya existía (max_fitting por dimensión height, paridad Go↔TS); lo que faltaba era el DATO y el kit por altura:

- **F1 Motor Go:** `ProductVariant.CommercialKitHardwareID` opcional; BOM del resolve usa el kit de la variante seleccionada con fallback al kit del agregado (`EffectiveKitHardwareID`: variante declarada gana, ambigüedad de 2 kits declarados falla cerrado, `included_in_kit` sin kit efectivo rechazado en resolve). Validación de definición relajada: `included_in_kit` válido cuando alguna variante declara kit.
- **F2 Sync por bahía:** el layout ya no sincroniza partes del kit por instancia — selecciona variantes POR UNIDAD (bahía de cajón) y sincroniza con el kit efectivo de esa unidad; la galería del kit-E sólo emerge en la bahía que resolvió E. `agregadoBoardsPlaceKitHardware` recibe el kit del llamador.
- **F3 Espejo TS:** `selectAgregadoVariants` + `effectiveKitHardwareId` (mismas semánticas), BOM y validación idénticos; `ensureAgregadoKitParts` sync ADITIVO para autoría (el espejo destructivo histórico queda intacto para kits a nivel agregado); stores y `designByKit` reconocen kits declarados por variante.
- **F4 Autoría:** picker «Juego» opcional por variante en la receta del ensamble + display del juego declarado + draft rule; mappers pasan `variant_sets` crudo (campo fluye sin cambios).
- **F5 Fixture canónico:** sección aditiva `heights` en `contracts/fixtures/merivobox-pilot-canonical.json` — autoridad numérica única (KH mín N 85.5 / M 108 / K 146 / E 209, clearance 0, trasera = KH−25 → 60.5/83/121/184, boundaries, cajonera 3 cajones ½+¼+¼). Números R12 de profundidad intactos (la evidencia de host congelada no se rompe).

## Exclusiones (scope de la issue, no de este slice)

Guard anti-skip silencioso + rechazos explícitos + selectedVariants en LayoutAssembly (slice 2 / PR 2). Cotización por altura TS↔Go (slice 3 / PR 3). Datos reales del owner + verificación en vivo (fase final). TIP-ON/SERVO-DRIVE, interiores M/K/E, vidrio BOXCOVER, matriz 32 mm de costados (#17) — fuera de la issue.

## Tareas

- [x] F1: dominio Go (campo, validación de set y definición, BOM efectivo, fail-closed)
- [x] F2: layout Go — selección+sync por unidad, gate con kit efectivo
- [x] F3: espejo TS + sync aditivo + tests de paridad (variantKit.test.ts)
- [x] F4: autoría UI (panel picker, display, draft rule, stores, CSS)
- [x] F5: fixture `heights` + boundary Go/TS desde el JSON + guard Ruby
- [x] Suites locales completas (ver evidencia)
- [ ] Review independiente (judgment-day dual) + CI del PR + handoff

## Evidencia (2026-11-04)

- **V0 preflight:** `PREFLIGHT_OK_NOT_VERIFIED` (main `92ac6249`, tools completos, dirty = 2 untracked del owner: PDF catálogo + dossier).
- **Regresión legacy byte-idéntica:** los 92 tests del pilot/assembly TS y la suite Go engine completa pasan SIN cambios de números — recetas sin kits de variante producen el mismo BOM/kit/miembros (test dedicado de fallback + `ResolvedAssembly.CommercialKitHardwareID` idéntico).
- **Go:** `go test ./...` PASS completo. Nuevos: `variant_kit_test.go` (kit por variante en BOM para N/M/K/E con traseras 60.5/83/121/184, max_fitting 200mm→K, fail-closed 85mm, fallback legacy, ambigüedad, validación), `merivobox_heights_test.go` (boundaries DESDE el JSON; cajonera 3 cajones 560mm: bahía E abajo con galería del kit-E como miembro, 2 bahías M arriba con parte del kit-M y SIN galería — sync por bahía demostrado end-to-end vía `ResolveFurnitureLayout`).
- **TS:** domain vitest 2114/2114 (nuevos `variantKit.test.ts` 12 + `merivoboxHeights.test.ts` 3, ambos leyendo el fixture compartido); typecheck domain/ui/web 0 errores.
- **UI/web vitest:** packages/ui (agregados+catálogos) 317/317; apps/web 610/610.
- **Plugin:** rake unit 1492/1492 (parser de layout intacto con el fixture extendido; guard nuevo `test_1493_heights_contract_guard`); rubocop archivo tocado 0 ofensas (vía `$(gem env gemdir)/bin/rubocop` — trampa Ruby 4/bundler conocida).
- **Contratos:** `check_openapi_drift.py` PASS (OpenAPI no describe ProductVariant; PR 2 documentará los campos nuevos del layout).
- **Verificación proporcional:** TypeScript + backend-go + sketchup-extension corrieron locales; proyectar-visual y gates foundation-postgres/browser corren en CI del PR sobre este HEAD (fixture estrictamente aditivo; el spec WebGL consume secciones intactas).
- **Alcance del diff:** 17 archivos, 4 commits de unidad (engine Go / domain TS / ui / plugin guard). Sin migraciones, sin SQL, sin API surface de runtime (campo opcional en payloads existentes).
