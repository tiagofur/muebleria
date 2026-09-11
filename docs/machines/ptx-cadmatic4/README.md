# PTX / CADmatic 4 — expediente de implementación

Issue base técnica: [#650](https://github.com/tiagofur/muebleria/issues/650).
Follow-up de refilados positivos: [#661](https://github.com/tiagofur/muebleria/issues/661).

Este directorio conserva investigación, evidencia y contratos de implementación. La compatibilidad real con CADLink/CADmatic está separada de la implementación interna.

## Alcance vigente

#650 entregó el candidato técnico r2: programa guillotina real, preview/instrucciones desde el mismo programa, PTX documentado, readback/verifier independiente, perfil efectivo y descarga existente. r2 sólo representa planes con `trim=0`.

#661 es el incremento r3: soportar **refilados positivos dentro de un subconjunto demostrado**, sin modificar r2 ni convertir observaciones de dos muestras en reglas universales.

**Fuera de #650/#661:** generar las cinco cocinas y verificar con el cliente. Implementación no equivale a compatibilidad: `NOT_TESTED/notClaimed` permanece hasta evidencia externa. #348 y los dossiers de cliente conservan la autoridad para import/readback y sign-off.

## Lectura

1. [Investigación y contrato](01_investigacion_y_contrato.md): fuentes primarias, localizadores, registros/códigos PTX, coordenadas y auditoría del código.
2. [Plan de implementación](02_plan_de_implementacion.md): plan histórico A+B de #650.
3. [Ejemplos parciales](examples/README.md): fragmentos propios y traza geométrica.
4. [Comprobación acotada](validation/verification_result.json): resultados del ejercicio y contraejemplo reducido.
5. [Manifiesto original de procedencia](source-artifact-manifest.json): checksums del paquete de conversación original; no usar como manifiesto de fabricación.
6. [Evidencia de campo y base segura para r3](03_evidencia_campo.md): qué muestran las dos muestras reales saneadas en [field/](field/README.md).
7. [Contrato conservador de refilados r3](04_contrato_r3_refilados.md): qué puede implementar #661 sin inventar semántica.

La secuencia de autoridad r3 es:

```text
Pattern Exchange documentado
+ evidencia de field/
+ CutProgram ejecutado de Granete
→ 03_evidencia_campo.md (observación)
→ 04_contrato_r3_refilados.md (decisión implementable)
→ #661 (producto)
```

Si el 03 y el 04 difieren en fuerza de una conclusión, **prevalece el 04 para implementación**.

## Discovery r3 — cerrado para el subconjunto inicial

```text
G1 RESOLVED
  Los ~9.8/9.9 mm observados se explican por el fixed rip trim de 10 mm.
  DIMENSION sigue relativa al subpanel/raíz útil.

G2 SPEC_POLICY_READY
  TRIM_TYPE=1, frame no girado:
  near/leading → fixed trim; far → minimum falling waste.

G3 PROFILE_POLICY
  HEAD/recut no se derivan de los 4 márgenes; quedan blank/no-override
  en la primera r3.

G4 RESOLVED
  El margen total incluye kerf; PTX compila desde raíz útil y no vuelve
  a emitir las divisiones perimetrales como CUTS.

G5 RESOLVED_SUBSET
  FUNCTION 92 + Xn sólo para rest-side remnant de phase 2 bajo el contrato
  geométrico/scheduling del 04.
```

**#661 ya puede comenzar con tests/código cuando haya agente disponible.** Fuera de ese frame, fail closed.

## Núcleo PTX r2 integrado

`packages/excel/src/ptx/` contiene el modelo tipado, validator, serializer determinista, parser independiente y verifier semántico. `compileCutPlan.ts` compila el CutProgram real con tabla inversa de índices y `verifyCutPlanPtxReadback.ts` comprueba los bytes contra el programa re-ejecutado.

Decisiones r2 relevantes:

- staging determina FUNCTION;
- CUT_INDEX conserva estructura y SEQUENCE orden operativo;
- DIMENSION es relativa al subpanel (280, no 734);
- identidad ASCII crítica y magnitudes no representables fallan cerrado;
- `MATERIALS.BOOK=1` es política conservadora;
- trim positivo queda bloqueado por r2.

`ptx-cadmatic-4@r2` + `granete-ptx@1.1.0` conectan el compiler a la descarga existente unified/by-material/ZIP manteniendo `NOT_TESTED/notClaimed`.

## Artefactos no productivos

Los `.ptx.txt` de `examples/` son parciales. Los fixtures de `field/` son evidencia saneada. Ninguno debe enviarse a CADLink como programa de máquina.

## Verificación documental

```sh
python3 docs/machines/ptx-cadmatic4/validation/verify_examples.py
```

Es una comprobación offline acotada; no sustituye TypeScript, CADLink ni CADmatic.

## Relación con autoridades existentes

Reutilizar [machine profiles/adapters](../../architecture/machine-profiles-and-adapters.md), selección #591, preflight #347 y trazabilidad de liberación. No crear otro optimizador ni convertir React en autoridad industrial.

r2 queda inmutable. r3 será otra revisión inmutable y sólo podrá elevar su evidencia después de importación/readback real.