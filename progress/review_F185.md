# Review — feature F185 (#414 / SU-ENT-1)

**Veredicto:** APPROVED

**Rama:** `feat/414-local-transform-contract` (pushed, HEAD == origin, commit a4da490)
**Alcance verificado:** contract/resolver/parsing exclusivamente; sin renderer (#415), sin material rebuild (#404), sin heurísticas Ruby.

## Checkpoints

- C1: [x] Harness base completo (AGENTS.md, init.sh, feature_list.json, progress/current.md, CHECKPOINTS.md, docs y skills). init.sh tiene el guardrail conocido OC-001; en su lugar se ejecutaron los gates reales individuales (ver C4).
- C2: [x] Sólo F185 en la sesión; F185 → `done` con tests asociados pasando; `progress/current.md` describe la sesión y remite a history/review.
- C3: [x] Sin cambios TS. Go: resolución server-side pura en `internal/domain/engine` (boundary §6: SketchUp adapter sólo aplica resultados — el parser Ruby no calcula composición ni manufactura). Errores Go tipados/wrapped; Ruby `ContractError < LayoutResolutionError`. Sin `console.log`. Boundary test de la extensión (ownership) en verde — vocabulario sin términos de manufactura en runtime `.rb`.
- C4: [x] Verificación real: `go test ./...` OK (engine + api, incl. golden); `pnpm test` completo OK (domain 1146, web 312, ui 1441, storage 161, excel 93, mobile 48, desktop 17); `pnpm typecheck` OK (7/7); `bundle exec rake verify` OK (syntax+lint rubocop+unit 139+boundary+RBZ). Golden del contrato existe y se valida contra el resolver (`contracts/sketchupLayoutTransform.contract.json`), consumido textual por los tests Ruby — patrón contract-fixture de §7 (lógica duplicada Go↔Ruby parsing).
- C5: [x] Sin archivos sospechosos sin trackear (dist/ ignorado). `progress/history.md` tiene entrada F183 (archivada) y F185. Ledger refleja `done`.

## Puntos de diseño verificados contra autoridades

1. **ADR-0004 §9 / issue #414:** transform local→furniture autoritativo publicado; Ruby no infiere rotación por slot/role/AABB — NEGATIVE PROOF existe en ambas pilas (Go `TestLayoutLocalTransformNegativeProofSlotAndAABBCannotRecoverOrientation`; Ruby `test_slot_and_aabb_cannot_recover_orientation`, incl. renombrar slot sin efecto).
2. **Convención local X=width/Y=thickness/Z=length conservada** con la decisión de frame explícita y documentada (boardLocalPose + docs §8): render→furniture es espejo; el frame local publicado espeja +X para ser diestro (det=+1) conservando semántica de caras. Base ortonormal exacta (0/±1 en k·90°) sobre Euler/quaternion — cumple "no Euler por comodidad".
3. **Material-aware (#402):** transform derivado del board ya resuelto con T efectivo (test mixto 16/18/6: poses x=PW-T y caja mapeada).
4. **Compatibilidad/versionado:** AABB legacy permanece y pasa a DERIVARSE del transform (imposible divergencia; chequeo runtime pose/min); `transformContract` marker con fail-safe probado (contrato ausente/desconocido/malformado ⇒ error loud, sin fallback).
5. **Agregado + hardware:** children de agregado con el mismo contrato; `hostComponentInstanceId` atado a componente con transform válido.
6. **Conventions:** schema nuevo `granete.local-basis.v1` (prefijo granete.*); comentarios sólo para el porqué no obvio (decisión de frame); golden en `contracts/` siguiendo el patrón materialRoleBinding.

## Observaciones menores (no bloqueantes)

- El word-guard de ownership obligó a vocabulario "board/pieza" en runtime Ruby; el término "part" del issue vive sólo en docs/tests. Consistente con el boundary.
- `mulMatVec3` quedó con un solo uso interno (hardware); se conserva porque es el espejo exacto del TS spatialAnchor — no tocar en este PR.

## Diseño UI/UX

No aplica (sin archivos de UI).
