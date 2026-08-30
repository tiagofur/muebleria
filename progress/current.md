# Feature en curso: F195 — Contrato versionado de resolve de autoría rica para mutaciones semánticas SketchUp (#477)

- Inicio: 2026-08-30 10:03 America/Mexico_City
- PR: #481 (`codex/477-rich-authoring-resolve`)

## Plan

- Corregir los blockers ejecutables de la re-revisión r2 en el contrato Go/TS/Ruby.
- Publicar un schema canónico machine-readable y cerrar validación fail-closed cross-runtime.
- Regenerar fixture compartido y ejecutar pruebas enfocadas, `./init.sh` con el runtime correcto y TestUp si cambia el boundary host.
- Obtener re-revisión independiente, cerrar ledger sólo si aprueba, hacer push/readback y esperar CI remoto.
