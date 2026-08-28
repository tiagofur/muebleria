# Review — feature F147

**Veredicto:** APPROVED

**Feature:** proyectar_performance_budget (#312 P3D-6, meta #308)
**Rama:** `feat/f147-perf-budget` · **SDD:** comentario en #312

## Checkpoints

- C1: [x] `pnpm test` 2.990 OK (domain 1.035 · ui 1.348 con gates nuevos) ·
  `pnpm typecheck` 0 errores · `pnpm smoke` 5/5 (4 existentes + perf nuevo
  con gates y baseline).
- C2: [x] Una feature (F147); sin trabajo ajeno mezclado.
- C3: [x] Boundaries: fixture puro en domain (sin deps nuevas); cache y
  telemetría en ui/preview3d sin lógica de dominio en React (contadores y
  marks); flag de seed local-only en storage (tests/seed normales intactos);
  identificadores en inglés, copy UI en español.
- C4: [x] Verificación real: cacheGate determinista (layout-change ⇒ 0
  re-resoluciones; ítem ⇒ 1) + conteo del fixture en CI; smoke WebGL real
  con gates sobre la escena de referencia + baseline JSON + screenshot.
- C5: [x] Ledger + progress + docs canónicos actualizados.

## Contratos del issue #312 (DoD)

- Fixture reproducible versionado ✓ (generador puro determinista, test de
  conteo que impide adelgazarlo).
- Baseline documentado ✓ (`docs/proyectar-3d-performance.md` §5, con lectura
  y gap explícito).
- Script/checklist de profiling ✓ (`pnpm smoke:perf` + §6 obligatorio para
  hot path).
- Drag feedback <100–150ms objetivo ✓ medido (p95 146ms, gate duro 250).
- Regresiones detectables/repetibles ✓ (gates hardware-independientes
  estrictos: órbita 0 commits, BOM 0 re-resoluciones CI+runtime, techos de
  draw calls; gates de ms calibrados al baseline dev).
- Docs de arquitectura/verificación actualizadas ✓ (roadmap P3D-6 ENTREGADO,
  verification.md, AGENTS.md).

## Hallazgos encontrados y CORREGIDOS durante la implementación

1. **Hooks violation**: los useMemo nuevos quedaron después del early return
   `if (!open)` del studio → "Rendered more hooks…". Movidos antes del return
   (regla implícita del componente: todos los hooks arriba). Detectado por el
   smoke (error boundary), no por typecheck.
2. **Cache por identidad no alcanzaba**: la primera versión (WeakMap por
   identidad de catálogo) fallaba 2.175 veces por drag — los selectores
   reconstruyen arrays de catálogo en cada render. Resuelto con firma de
   CONTENIDO por elemento (ids WeakMap): inmune a clonación de contenedores,
   sensible a cambios reales. `missReasons` quedó como telemetría permanente.
3. **Órbita con botón izquierdo agarraba muebles** (la esquina "vacía" no lo
   era tras el fit): el gate usa botón derecho (el studio sólo arrastra
   muebles con el primario — limpieza por construcción).
4. Test del fixture usaba `bom.error` inexistente (ResolvedBom no lo expone);
   `defaultOptionChoicesForModule` vive en ui, no domain — simplificado.

## Notas de alcance (deuda explícita, no bloqueantes)

- **P3D-6b — costo de render**: long tasks por frame en drag/órbita (p95
  222ms dev build; 538 draw calls, physical materials + shadows; triángulos
  NO son el problema con 21k). Gates de ms calibrados a la realidad medida
  con objetivo documentado; el gap queda medible y registrado como follow-up.
- Re-baseline pendiente en hardware piloto + build de producción (el actual
  es Apple Silicon en vite dev).
- Micro-churn conocido no tocado (raycast vectors, grain por medida): §7 del
  doc de performance.
