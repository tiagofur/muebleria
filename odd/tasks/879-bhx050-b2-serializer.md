# ODD — #879 BHX 050 B2 (serializer offline woodWOP MPR)

- **Issue**: tiagofur/muebleria#879 (`status:approved`). Incremento B2 sobre
  el B1-kit (#1021) y la pesquisa del formato (#1029 — stacked).
- **Lane**: Direct (un escritor, alcance acotado al flip del candidato).
  Rama `feat/879-b2-woodwop-serializer` apilada sobre
  `feat/879-b2-candidate-woodwop-mpr`, worktree `879-b2-woodwop-serializer`.
- **Estado**: IMPLEMENTED_PENDING_REVIEW (B3 + validación de instalación
  #352 quedan).

## Qué se implementó

- **Perfil `mpr-woodwop@r2`** (digest `0f6cd2d5…`): las 8 dimensiones
  requeridas evidenciadas desde el doc oficial HOMAG 9-080-42-7190-D00 +
  decisiones candidato documentadas (ascii/CRLF conservador, DU-direct sin
  mapeo de herramientas, literales sin expresiones). `pendingEvidence`
  nombra los desconocidos del receptor. `supportStatus NOT_TESTED` — sin
  claim de compatibilidad. r1 queda histórica (stale pins bloquean).
- **Adapter `woodwop-mpr@0.2.0`** (digest `78a7948d…`,
  `serializerImplemented: true`): `serializeMprPerPiece` (API real por
  pieza/cara, misma política de transformación de KDT con la tabla
  cuadrante→BM), `serialize()` de la interfaz monoprograma, `JOB_DATA_INVALID`
  para datos fuera de marco, ASCII fail-closed (el perfil declara ascii).
- **Frontera de capacidad**: `generateSelectedMachiningOutput` despacha por
  familia (kdt y mpr generan; saw queda bloqueada); nombres industriales
  `M<hex12>.mpr`; probe de settings filtra `PROGRAM_GRANULARITY_UNSUPPORTED`
  para familias per-piece (la tarjeta BHX lee **Configurada**).
- **Catálogo + espejo Go** con paridad; el ejemplo Go de serializer no
  implementado pasa de woodwop a **homag-saw** (la única familia sin
  serializer hoy).

## Líneas rojas

- Ningún camino de producción emite MPR hacia la máquina sin la autorización
  normal (frozen-only, selección exacta, fail-closed) — igual que KDT.
- `supportStatus` sigue `NOT_TESTED`: la sesión del kit B1 (#1021) con
  muestras reales define si el dialecto candidato es el de la instalación.
- Sin límites de herramienta/espesor inventados (DU-direct, cero capacidades
  declaradas en la máquina).

## Verificación (observada)

- excel 690 passed (adapter B2 reescrito, contract MPR ready-path,
  machiningGeneration genera MPR, clientPack genera test-bhx050) ·
  typecheck 7/7 · Go domain+api ok · workspace JS PASS.
- NOT_RUN local: browser gates (CI). El test E2E del botón para MPR exige
  la liberación con perforaciones (escala engineering-cutting-demand).

## Restante

- Muestras del client-a (kit B1) → diff dialecto-vs-real → correcciones o
  confirmación → recién ahí la validación de instalación (#352, BHX12) y
  cualquier claim.
