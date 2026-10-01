# ODD — #873: Project Furniture save & reopen lifecycle hardening

- Issue: #873 (`[P0][SU-PF] Project Furniture save & reopen hardening`).
- Autorización: prompt del owner ("vamos de 873").
- Lane: ODD. Estado: READY_FOR_REVIEW.
- Base: `origin/main` @ `15d35784ca626522981d3817bf2877195c7093ca`.
- Branch: `fix/873-pf-save-reopen-lifecycle`.
- Documento normativo: `docs/verification/project-furniture-save-reopen.md`.
- Modo de entrega: `Refs #873` + `Delivery: partial` (mejora diagnóstica y endurecimiento de harness; la causa original permanece abierta sin exoneración).

---

## 1. Contexto y Objetivos

La issue #873 reportó intermitencias históricas en el ciclo de vida de `Project Furniture` tras `save/close/reopen` (identidad nil o duplicada en el locator, conteos anómalos de raíces y pérdida del rol INTERIOR). El análisis riguroso plasmado en `docs/verification/project-furniture-save-reopen.md` estableció:
1. **Causa original indeterminada:** las rachas verdes no exoneran el producto ni demuestran por sí solas que el fallo fuera meramente de infraestructura.
2. **Brecha en el smoke de base:** `test_placed_identity_survives_save_close_and_reopen` en `TC_ProjectFurnitureSmoke.rb` no comprobaba el retorno de `place_existing_furniture` antes de guardar, ni validaba raíces pre-save, ni comparaba atributos/parámetros/materialChoices/transforms exactos tras la reapertura, ni ejercitaba el ciclo secundario `select -> save -> reopen`.
3. **No usar GUID como prueba única de cambio de documento:** `Model#guid` muta legítimamente al modificar y guardar el modelo en disco; un cambio de GUID no debe diagnosticarse como cambio externo de documento.
4. **Matriz discriminante PF01–PF07:** suite controlada para probar las aserciones diagnósticas por fases y el witness seguro.

---

## 2. Tareas Técnicas

- [x] **T1. Endurecimiento de `test_placed_identity_survives_save_close_and_reopen` (§ H4):**
  - Comprobación estricta del resultado de `builder.place_existing_furniture` (`assert result['success']`).
  - Verificación pre-save: entidad válida en `model`, identidad exacta y exactamente una raíz (`top_level_furniture`).
  - Guardado en archivo temporal comprobando `model.save(path)`.
  - Re-apertura limpia en nueva fase comprobando `Sketchup.open_file(path)`.
  - Verificación post-reopen: entidad localizada, 1 raíz, parámetros intactos, `materialChoices` intactos, transform intacto (`transformation.to_a`).
  - Ciclo secundario: seleccionar raíz, re-guardar y re-abrir comprobando la conservación de invariantes y transforms.
- [x] **T2. Implementación de pruebas discriminantes PF01–PF07 (§ H6):**
  - **PF01:** Modificar y guardar el mismo modelo (`model.save(path)`) demuestra que el cambio de GUID no dispara un falso diagnóstico de documento externo.
  - **PF02:** Omitir reset o iniciar fixture contaminada de forma controlada falla en el guard previo a la colocación y registra witness con `MODEL_RESET_PRECONDITION_FAILED`.
  - **PF03:** Cambio controlado de documento activo tras el setup es detectado en su fase exacta con `ACTIVE_MODEL_CHANGED_UNEXPECTEDLY`.
  - **PF04:** Identidad ausente/duplicada sin cambio de documento emite error de identidad (`EXPECTED_FURNITURE_IDENTITY_MISSING` / `DUPLICATE_FURNITURE_IDENTITY`), no inferencia obligatoria de carrera externa.
  - **PF05:** Ciclo completo `place/save/reopen/select/save/reopen` conserva raíces, IDs, parámetros, `materialChoices` y transform exactos.
  - **PF06:** Fallo en la escritura del witness preserva la excepción original y desmonta el soporte (probado en `smoke_witness_test.rb`).
  - **PF07:** Regresión #870/#871: restaurar y colocar manualmente permanecen explícitos, sin minting espurio ni auto-restore.
- [x] **T3. Soporte de witness mínimo y sanitizado (§ H5):**
  - Registro acotado en memoria de fases (`reset`, `place`, `save`, `open`, `locate`) con referencia esperada/activa, conteos e IDs (`SmokeWitness`).
  - Etiquetas neutrales de invariantes: `MODEL_RESET_PRECONDITION_FAILED`, `ACTIVE_MODEL_CHANGED_UNEXPECTEDLY`, `EXPECTED_FURNITURE_IDENTITY_MISSING`.
  - Escritura a disco únicamente en caso de fallo, con límites de tamaño (64 KB) y sanitización de rutas.
- [x] **T4. Verificación y host smoke:**
  - `bundle exec rake verify`:
    - RuboCop: 0 offenses en 285 archivos.
    - Unit tests: 1308 runs, 9565 assertions, 0 failures, 0 errors, 0 skips.
    - Boundary tests: 6 runs, 3855 assertions, 0 failures, 0 errors, 0 skips.
    - Deterministic RBZ verified: `dist/granete_for_sketchup.rbz` (sha256 `b77f51515d1b9baded2c42dd6e40ffb4a9ee2c32490585e317f9b29de657b944`).
  - Host real SketchUp 2026 (`apps/sketchup-extension/testup-ci-873.yml`):
    - Artifact: `progress/host_smoke_873_testup_ci.json`.
    - Total: 13 runs, 86 assertions, 0 failures, 0 errors, 0 skips, 13 passes (Seed: 55297, time: 7.15s).
- [ ] **T5. Publicación:**
  - Preparar commit convencional y PR parcial (`Refs #873` + `Delivery: partial`).

---

## 3. Criterios de Aceptación

1. [x] El smoke host previene falsos positivos al verificar el estado pre-save antes de atribuir fallos a reopen.
2. [x] PF01 a PF07 implementados y verificados.
3. [x] El witness no interfiere ni traga excepciones reales.
4. [x] La causa original permanece formalmente abierta (sin reclamos de "producto exonerado").

