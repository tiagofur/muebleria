# Feature en curso: F195 — Contrato versionado de resolve de autoría rica para mutaciones semánticas SketchUp (#477)

Inicio: 2026-08-30T11:21:44-06:00

Plan:

- Alinear el schema canónico con el NativeLayout completo, incluyendo materiales visuales/PBR.
- Corregir la coherencia Ruby para tratar `layout.hardware` como proyección visual del snapshot semántico.
- Preservar envelopes tipados en Ruby para 405/415 sin correlación disponible antes de leer el body.
- Añadir fixtures Go→Schema→TS→Ruby y TestUp para material rico y hardware sin preview.
- Ejecutar verificación completa, revisión independiente, push y readback del PR #481.

Evidencia de implementación publicada:

- `8433cbdfad2649f606273ef8e9147d29b625aa81` corrige los tres gaps de la re-review.
- TestUp CI real en SketchUp 26.2.242 / Ruby 3.2.2: 6/6 tests, 58 assertions, 0 fallos,
  contra el RBZ instalado `7c82a347863c46607c4712b6552f864f0c70b4cc69fb169307bac24c04d0ebd0`.
- Pendiente: revisión independiente del nuevo head y cierre del ledger sólo si aprueba.
