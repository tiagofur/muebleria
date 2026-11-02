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
- [ ] F1: tarjeta única kit (Herrajes) + badge Receta + estado kit colgante
- [ ] F2: modelo override dims TS+Go + paridad
- [ ] F2: tarjeta posición visible + presets + dims UI
- [ ] F2: drilling consume override (TS+Go)
- [ ] Verificación V0/V1/V2 proporcional + handoff

## Evidencia (se registra al congelar cada fase)

- V0 preflight: `PREFLIGHT_OK_NOT_VERIFIED` (2026-11-02, árbol limpio).
- F0 (2026-11-02): tsc --noEmit OK; vitest packages/ui targeted (agregados+modules+common) 373/373 PASS. Hallazgo en el camino: `hardwarePlacementRule` exigía `hardwareId` presente — los placements por grupo (#1046, sólo `optionRole`) también descartaban el draft; corregido con test. F2 testids de kit (`${testId}-kit`) preservados tras migrar el select nativo a CatalogPicker compartido.

## Forecast y entrega

- Commits Conventional por fase; PR único a `main` con `Closes #1460` + `Delivery: complete` solo con DoD completo; si una fase no cierra, `Refs #1460` + `Delivery: partial` con alcance restante explícito.
- Riesgo principal: paridad TS↔Go del override de dimensiones y su consumo en drilling (F131). Mitigación: fixture de paridad compartido antes de tocar UI.
