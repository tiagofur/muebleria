---
target_identity: "file:/Users/tiagofur/dev/carpinteria/muebles/packages-ui-src-catalogs"
timestamp: 2026-10-16T18-15-32Z
slug: packages-ui-src-catalogs
---
# Critique re-corrida — Grupo CATÁLOGOS (#1032, post K1→K5)

metadata:
  total_score: 37
  max_score: 40
  mode: Operate
  run: dual-agent (Assessment A sub-agente aislado + Assessment B detector CLI) · browser proof vía organization gate (5 rutas PASS)

## Design Health Score

| # | Heurística | Score | Justificación (file:line) |
|---|-----------|-------|-------------|
| 1 | Visibilidad del estado del sistema | 4 | Footer con `saving` + "Guardando…" y botones deshabilitados (EdgesCatalog.tsx:432-443); upload con estadios nombrados (HardwareAssetUploadModal.tsx:435-445, 706-714); selector con loading/error/empty diferenciados (HardwareAssetSelectorModal.tsx:160-178). |
| 2 | Match con el mundo real | 4 | "Cintillas y melaminas de canto del taller" (EdgesCatalog.tsx:242), enums traducidos (HardwareCatalog.tsx:76-84), mm/m²/ML/merma (MaterialsCatalog.tsx:455-480). Residual: "recurso 3D"/"organización" en el subsistema 3D (SelectorModal.tsx:176, UploadModal.tsx:508). |
| 3 | Control y libertad | 4 | Desactivar reversible con copy explícito (EdgesCatalog.tsx:544); cierre en-vuelo con ConfirmDialog (UploadModal.tsx:133-147, 718-726); Reintentar con sesión reanudada (UploadModal.tsx:381-385). |
| 4 | Consistencia y estándares | 4 | Paridad de familia completa: mismo esqueleto en los 5, identidad en títulos, UN CTA de creación por estado (header cede al EmptyState en los 5, K5), 0 clases muertas (grep verde). |
| 5 | Prevención de errores | 4 | Unicidad de código con explicación del 409 (catalogHelpers.ts:28-65); guard de guardado doble; 412 con draft intacto (HardwareProfilesCatalog.tsx:203-217). |
| 6 | Reconocimiento antes que recuerdo | 4 | Fila expandible con detalle; swatches inline; foto en tabla; ruta de categoría con `›`; identidad «— CODE · NAME» en los 5 modals. |
| 7 | Flexibilidad y eficiencia | 3 | Deep-links rutables, Duplicar con código sugerido, acciones touch (catalogs.css:89-101). Falta ordenamiento de columnas y bulk edit (fuera de alcance decidido). |
| 8 | Estética y minimalismo | 4 | Internos técnicos tras `<details>` (K4); sentence-case documentado; tokens only. Nit: estilos inline sueltos (HardwareCatalog.tsx:391,394). |
| 9 | Recuperación de errores | 4 | Errores que enseñan; reintentos; 412 con instrucción concreta; `catalog-form__error` con `role="alert"` en los 9 formularios (a11y). Nit: foco programático al error pendiente. |
| 10 | Ayuda y documentación | 3 | Hints de taller real; pero EmptyStates remiten a "la semilla del workspace" sin explicarla (EdgesCatalog.tsx:278, HardwareCatalog.tsx:303, MaterialsCatalog.tsx:619). |
| **Total** | | **37/40** | **Good — desde 19/40 (Poor) en la auditoría 2026-10-04** |

## Veredicto de especificidad de diseño

Muy alta — vocabulario regional real ("cintillas"), datos de manufactura como ciudadanos de primera (espesor, costo/ML, merma, perforaciones CNC), copy de confirmación que enseña la consecuencia física. Voseo es-UY normalizado hasta en el locale de comparación. Única zona despegada: el subsistema 3D de herrajes, donde "recurso"/"organización" filtran voz de plataforma (mejora residual documentada).

## Fortalezas
1. Estados honestos en acciones destructivas: cada confirm explica qué se conserva y cómo revertir.
2. Contrato de guardado uniforme y robusto en los 5 (await + saving + keep-open + 412 específico).
3. Jerarquía de información técnica: SHA/IDs fuera de la cara del tallerista tras disclosure.
4. Upload como máquina de estados real (idempotencia, cancelación de sesión huérfana, reanudación).

## Issues prioritarios restantes (post-re-corrida, no bloquean la aceptación)
1. "Semilla del workspace" sin explicar en 3 EmptyStates — la única ayuda del vacío que no enseña.
2. Voz de plataforma en el subsistema 3D ("recurso", "organización", "Sesión de carga").
3. Sin sort de columnas en tablas densas (10 col. en Materiales) — candidato a slice propio.
4. `catalog-form__error` anuncia pero no mueve foco programático al error.
5. Perfiles sin "Reactivar" en acciones de fila (los otros 4 lo tienen).

## Run Notes
- Assessment A: sub-agente aislado (design review sobre fuentes, sin ver detector).
- Assessment B: `impeccable detect --json packages/ui/src/catalogs` → **0 findings** (exit 0; baseline 2026-10-04 tenía cramped-padding/line-length/badges sin cápsula).
- Browser: organization gate local — `catalogs-ux-parity.spec.ts` 5/5 PASS (identidad en 4 editores, Desactivar con ConfirmDialog en edges, estado vacío de Perfiles con CTA único).
- Comparación vs baseline: 19/40 → 37/40 (+18). Los issues 1-3 del baseline están cerrados con implementación verificada; los 5 issues restantes son nuevos hallazgos de nivel menor, ninguno del scope K1-K5.
