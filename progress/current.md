# Feature en curso: F195 — Contrato versionado de resolve de autoría rica para mutaciones semánticas SketchUp (#477)

- Inicio: 2026-08-30 10:03 America/Mexico_City
- PR: #481 (`codex/477-rich-authoring-resolve`)

## Plan

- Corregir los blockers ejecutables de la re-revisión r2 en el contrato Go/TS/Ruby.
- Publicar un schema canónico machine-readable y cerrar validación fail-closed cross-runtime.
- Regenerar fixture compartido y ejecutar pruebas enfocadas, `./init.sh` con el runtime correcto y TestUp si cambia el boundary host.
- Obtener re-revisión independiente, cerrar ledger sólo si aprueba, hacer push/readback y esperar CI remoto.

## Evidencia r3

- Implementación: `7e9a49bafc2b788784451bf27e019f2c71e35daa`, rebased sobre `origin/main` `d66baf13`.
- `PATH="$HOME/.rbenv/shims:$PATH" GOFLAGS=-p=1 ./init.sh`: verde (TypeScript, Go, Ruby/RBZ).
- TestUp real contra RBZ instalado: 5/5, 50 assertions, SketchUp 26.2.242, Ruby 3.2.2.
- RBZ SHA-256: `7bf9d25195e8c00f0583a074de3b9dbfde55d228de221e88d1563c748195c3f5`.
- Evidencia parseable: `progress/host_smoke_F195_testup_ci.json` y `_stdout.txt`.
