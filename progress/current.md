# Feature en curso: F195 — Contrato versionado de resolve de autoría rica para mutaciones semánticas SketchUp (#477)

Inicio: 2026-08-30T11:21:44-06:00

Plan:

- Alinear el schema canónico con el NativeLayout completo, incluyendo materiales visuales/PBR.
- Corregir la coherencia Ruby para tratar `layout.hardware` como proyección visual del snapshot semántico.
- Preservar envelopes tipados en Ruby para 405/415 sin correlación disponible antes de leer el body.
- Añadir fixtures Go→Schema→TS→Ruby y TestUp para material rico y hardware sin preview.
- Ejecutar verificación completa, revisión independiente, push y readback del PR #481.
