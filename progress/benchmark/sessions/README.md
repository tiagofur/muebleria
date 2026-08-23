# Sesiones del benchmark de usabilidad (#314 / P3D-8)

Acá caen los JSON exportados del panel del facilitador, uno por participante.

**Convención de nombres:** `<aaaa-mm-dd>-P<n>.json` (p.ej. `2026-08-30-P1.json`).
La encuesta post-sesión y las notas del facilitador van en un `.md` hermano con
el mismo nombre (`2026-08-30-P1.md`) o agregadas al JSON como campos
`survey`/`notes`.

## Checklist del día de sesiones

Protocolo completo: `docs/proyectar-3d-usability-benchmark.md` §4–§6. Resumen
operativo:

1. **Preparar** (una vez):
   - app corriendo en modo invitado sobre el seed "Demo plantilla"
     (`pnpm --filter @muebles/web dev` → acceder como invitado);
   - `localStorage.setItem('muebles_usability_benchmark','1')` en la consola
     del navegador y recargar → aparece el panel del facilitador;
   - `pnpm smoke:usability` verde en el build que se va a probar.
2. **Por participante** (≈30 min): consentimiento verbal (anónimo P#, sin datos
   de clientes reales) → workspace fresco → **Iniciar sesión** en el panel
   ANTES de entregar el mouse → leer la consigna textual de cada tarea, sin
   coaching (ni señalar, ni demostrar) → marcar Iniciar/Completada/Abandonada
   → **+ Ayuda** cada vez que el facilitador responde → **+ Error** por acción
   no deseada → encuesta post-sesión (confianza 1–5, facilidad 1–5, dónde
   buscó los controles, qué fue más difícil) → **Terminar sesión** →
   **Exportar** → guardar acá.
3. **Entre participantes**: **Nueva sesión** en el panel (limpia la anterior)
   y workspace fresco.

## Análisis (cuando haya ≥3 sesiones)

`summarizeUsabilitySessions` (`@muebles/ui`, testeado) agrega mediana por
tarea, ayudas/errores/retrocesos/clicks y cumplimiento de targets. Con ≥3
JSONs acá, abrir una sesión de análisis que: genere el reporte (tabla por
tarea vs targets + hallazgos cualitativos), recalibre targets con evidencia y
reordene #309–#313 / #277–#297 según lo dictado por los datos. No presentar
tiempos `proxy` como evidencia de usuario.
