# ODD — #1460 Pestaña Herrajes del agregado: kit tarjeta única + posición/dimensiones paramétricas

- **Issue:** https://github.com/tiagofur/muebleria/issues/1460 (`status:approved`)
- **Aprobación:** owner 2026-11-02 en sesión («no quiero poder editar subitems de un herraje kit» + decisiones de shape: tarjeta única de kit, posición + dimensiones con fórmulas; «vamos»).
- **Lane:** Delegated Direct — este artefacto único.
- **Escritor:** ZCode (agente). Reviewer: independiente, pendiente.
- **Base:** `main` @ `2eed419b` · Rama: `feat/1460-herrajes-agregado-kit-card-dims`.

## Alcance autorizado

Tres fases, una rama, commits revisables por fase:

1. **Fase 0 (suelo):** `axisPlacementDraftRule` acepta `offsetFormula`/campos vivos de `AssemblyAxisPlacement`; `hardwarePlacementRule` acepta `xRef/yRef/hwAnchor/optionRole`; round-trip de borrador con fórmulas sobrevive F5. Selector de kit filtra `unit === 'set'` + unificado con feedback. `HardwarePlacementsEditor.add()` sin default encubierto. «Kit con par izq/der» con estado pendiente menos agresivo.
2. **Fase 1 (tarjeta única de kit):** pestaña Herrajes renderiza UNA tarjeta resumen solo-lectura del kit (nombre/código/N herrajes/cotiza una vez/chips + CTA Catálogos); subitems del kit dejan de renderizar editables; Receta muestra miembros derivados solo-lectura con badge «incluido en el juego»; estado para kit colgante. Modelo/BOM sin cambios.
3. **Fase 2 (posición + dimensiones):** X/Y/Z desde+desplazamiento mm|fórmula siempre visibles en tarjeta propia + presets en línea; override Ancho×Alto×Fondo por eje mm|fórmula con merge sobre catálogo en resolve TS y gemelo Go; alimenta HW/HH/HD, anclaje centrado y drilling F131; fixture paridad TS↔Go; error visible por fórmula inválida.

## Exclusiones (no autorizado)

Sin excepciones posicionales por-agregado para miembros de kit; «Por cantidad» sin cambios; sin cambios Ruby/host; sin cambios de pricing/BOM roles; sin rediseño de otras pestañas.

## Tareas

- [x] F0: draft validators + tests round-trip
- [x] F0: selector kit `unit==='set'` + feedback + unificación
- [x] F0: placements add() sin default + par preset menos agresivo
- [x] F1: tarjeta única kit (Herrajes) + badge Receta + estado kit colgante
- [x] F2: modelo override dims TS+Go + paridad
- [x] F2: tarjeta posición visible + presets + dims UI
- [x] F2: drilling — NOTA: los miembros rígidos NO perforan hoy (F131 perfura placements de componentes, no rigidMembers); el override alimenta el entorno de fórmulas del miembro y `resolvedDimensions` (consumidor 3D/host/futuro drilling). El drilling de placements ya consume dims de catálogo desde #1453 F1.
- [x] Verificación V0/V1/V2 proporcional + handoff

## Evidencia (se registra al congelar cada fase)

- V0 preflight: `PREFLIGHT_OK_NOT_VERIFIED` (2026-11-02, árbol limpio).
- F0 (2026-11-02): tsc --noEmit OK; vitest packages/ui targeted (agregados+modules+common) 373/373 PASS. Hallazgo en el camino: `hardwarePlacementRule` exigía `hardwareId` presente — los placements por grupo (#1046, sólo `optionRole`) también descartaban el draft; corregido con test. F2 testids de kit (`${testId}-kit`) preservados tras migrar el select nativo a CatalogPicker compartido.
- F1 (2026-11-02): typecheck packages/ui (`typecheck` con `-p tsconfig.json`) + apps/web OK; vitest agregados 132/132. Tarjeta única del kit con chips read-only + CTA «Editar juego en Catálogos» cableado vía `onEditKit` (section→form→screen→ShellView, navega a 'hardware' con `onEntitySelectionChange`). Predicado de derivación: parte del kit por `kitHardwareId` (el rol `included_in_kit` no basta — un miembro manual con kit activo también lo lleva). Kit colgante ⇒ alerta explícita. Receta: filas read-only con badge `catalog-badge--kit` reutilizado.
- F2 (2026-11-02): dominio TS 2086/2086, `go test ./internal/domain/...` TODO ok, paridad TS↔Go sobre `contracts/agregadoMemberDimensionOverride.contract.json` PASS en ambos runtimes (merge, entorno de fórmula, resolvedDimensions sólo-con-override, legacy byte-idéntico). UI: vitest packages/ui 385/385, typecheck ui + apps/web OK. Contrato de fórmula: la fórmula del eje reemplaza al mm; env PW/PH/PD + HW/HH/HD de catálogo; el offsetFormula del placement ve dims EFECTIVAS. Cotas fail-closed [0, 100000] en definición y resolve, ambos lados.

## Verificación final del candidato congelado (2026-11-02, HEAD 02261a73 + specs; FIX ROUND 2026-11-03 → HEAD ca22666e)

- `scripts/verify_affected.py --base origin/main --plan`: selecciona typescript, backend-go, sketchup-extension, proyectar-visual, foundation-postgres, organization-browser (dominio compartido).
- **backend-go (V1):** `scripts/backend-test.sh -timeout=25m ./...` con PostgreSQL efímero (#823): TODO ok en 958s — cmd/*, internal/api 25.9s, internal/domain 0.19s, internal/domain/engine 0.42s, internal/storage 711s, tests/pilotreadiness 202s. Exit 0.
- **organization-browser (V2):** `scripts/organization-browser-gate.sh` con stack efímero desde el worktree (backend Go de esta rama): `tests/organization/agregados-kit-card-dims.spec.ts` PASS (5.5s) — picker sólo juegos + feedback de partes, tarjeta única read-only del kit con chips y CTA, miembro derivado sin tarjeta editable, herraje propio con X/Y/Z visibles sin expandir, «Centrar» ⇒ PW/2, dimensiones mm|fórmula con placeholder del catálogo y efectivo, PUT con dimensionOverrides, readback del servidor conservándolos, re-edición renderizando lo persistido. `tests/organization/agregado-offset-formula.spec.ts` PASS (4.5s) con la semilla ajustada a `unit: 'set'` (el contrato nuevo del selector).
- **typescript (V1):** packages/domain 2086/2086, packages/ui 385/385, typechecks domain/ui/web OK. Workspaces TS restantes (storage/excel): cubiertos por CI del candidato (los cambios son passthrough JSON opaco ahí).
- **NOT_RUN honesto:** sketchup-extension (`rake verify` requiere host SketchUp; la extensión no cambia — consume payloads resueltos, campos nuevos ignorados por el parser Ruby selectivo); proyectar-visual y foundation-gate-a stages restantes: corren en CI sobre este mismo HEAD.

## Judgment-day dual review (2026-11-02/03)

- **Ronda 1** (2 jueces ciegos en paralelo sobre diff 2eed419b..b863afe8 + issue + artefacto, CI 22/22 PASS leído, sin re-run): 0 CRITICAL · 1 MAJOR confirmado por ambos (JD-001: espejo doorAffinity incompleto — 3/5 campos vivos, objectRule cerrada seguía descartando el draft con el payload canónico; latente: ningún flujo lo persiste hoy) · 2 MINOR confirmados por ambos (JD-002: crash de render con herraje colgante vía `find(...)!`; JD-003: asimetría TS/Go con JSON null en un eje) · 3 INFO (cota 100000 sin error en vivo; convención int(math.Round) Go preexistente; texto de drilling de la issue con NOTA honesta en el artefacto). Ambos jueces verificaron independientemente: legacy byte-idéntico, fixture recalculado a mano, índices UI sin off-by-one, specs honestos, sin scope fuera de la issue.
- **Ronda fix** (autorizada por owner): JD-001 espejo completo de DoorAffinity + round-trip test; JD-002 guard sin aserción con degradación al hint + test de regresión; JD-003 null=ausente alineado al gemelo Go branch por branch + test de 3 combinaciones. Evidencia local HEAD ca22666e: domain 2087/2087 · ui agregados 115/115 + modules/common 272/272 · typechecks domain/ui OK · go build/vet/test domain+engine OK.
- **Re-juzgado acotado** (mismos 2 jueces ciegos, sólo ledger congelado + delta b863afe8..ca22666e): ambos devuelven findings [] — 3 ledger IDs resueltos, 0 defectos fix-caused, paridad Go verificada rama por rama.
- **Veredicto terminal: APPROVED** (judgment-day no emite receipt ni autoridad de entrega: el merge sigue siendo humano). INFO restante sin acción (documentado acá y en la issue).
- CI del HEAD de fix (ca22666e): vigilado al cierre — ver comentario de evidencia en el PR.

## Forecast y entrega

- Commits Conventional por fase; PR único a `main` con `Closes #1460` + `Delivery: complete` solo con DoD completo; si una fase no cierra, `Refs #1460` + `Delivery: partial` con alcance restante explícito.
- Riesgo principal: paridad TS↔Go del override de dimensiones y su consumo en drilling (F131). Mitigación: fixture de paridad compartido antes de tocar UI.
