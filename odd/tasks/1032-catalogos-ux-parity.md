# ODD — #1032 Paridad UX del grupo CATÁLOGOS (K1→K5)

- **Issue**: tiagofur/muebleria#1032 (`status:approved`; alcance aprobado por
  el owner 2026-10-04 «top 5 completo en orden», re-confirmado 2026-10-16).
- **Lane**: Delegated Direct. Un escritor.
- **Base**: main `7d176aa7` (post #1350). Rama `feat/1032-catalogos-ux-parity`.

## Estado encontrado (2026-10-16, auditoría de código)

K1→K4 estaban MAYORMENTE implementados en main por slices previas (contrato
de guardado en las 3, ConfirmDialog+Duplicar en las 5/6, cápsulas
status-badge, identidad en modals, disclosure de internos). La issue nunca se
actualizó ni cerró. Restantes reales encontrados y cerrados en esta rama:

1. **K5 grupo**: doble CTA de creación en estado vacío en Edges/Materials/
   Herrajes/Acabados (Perfiles ya lo tenía) → header cede al EmptyState con
   `canMutate && !isTrulyEmpty` en los 4.
2. **K3 grupo**: `.btn--sm` (clase muerta, el CSS define `.btn--small`) en
   LibraryPublishConfirmContent, LibraryConsumerViewPanel y
   LibraryDraftWorkspaceBanner (paneles #1102 llegados post-auditoría) →
   migrados; grep de `badge*`/`btn--secondary`/`btn--sm` en catalogs/ verde.
3. **K5**: `window.confirm` nativo en HardwareAssetUploadModal →
   ConfirmDialog del sistema (guard de cierre en vuelo).
4. **A11y transversal**: `catalog-form__error` sin announce → `role="alert"`
   en los 9 formularios del grupo + el indicador del upload.
5. **Hallazgo de la re-corrida**: Desactivar desde el detalle expandido de
   Cantos (EdgesCatalog:350) no pasaba por confirmación → mismo contrato K2
   que la acción de fila.
6. **Voseo**: "Inicia…"/"Selecciona…" en el subsistema 3D → voseo.

## Verificación

- Unit: ui 2264 ✓ (incluye pin nuevo de K5 en Perfiles), web 605 ✓, tsc ui/tests ✓.
- Detector impeccable: **0 findings** en catalogs/ (baseline 2026-10-04 tenía
  cramped-padding/line-length/badges sin cápsula).
- Re-corrida critique dual-agent: **37/40** (desde **19/40**) — snapshot
  `.impeccable/critique/2026-10-16T18-15-32Z__packages-ui-src-catalogs.md`.
- Browser: `catalogs-ux-parity.spec.ts` (nuevo) 5/5 PASS — identidad en los
  4 editores, Desactivar con ConfirmDialog en edges, estado vacío de Perfiles
  con CTA único en vivo.

## Restante conocido (documentado, fuera de este alcance)

"Semilla del workspace" sin explicar en 3 EmptyStates; voz de plataforma en
el subsistema 3D ("recurso"/"organización"); sort de columnas; foco
programático al error; Reactivar en filas de Perfiles. Quedan nombrados en
el snapshot para un slice de polish futuro.
