# B1 — Kit de recolección de evidencia woodWOP/MPR (client-a, machine-a)

> **Objetivo**: una sola visita al client-a captura TODO lo que #879 B2
> (serializer offline) necesita, sin inventar sintaxis. La pieza central es
> **preparar los programas de muestra con el receptor** (contrato B2: «preferir
> programas sintéticos preparados con el receptor y sanitizar»): el técnico
> crea en el woodWOP del cliente los programas que Granete ya sabe describir,
> y esos bytes MPR reales se convierten en el par expected/actual del
> serializer y del readback.
>
> Patrón probado: el kit K4 de KDT (#1005) — fixture congelado
> `fixture-kdt-field-001` + valores esperados + acta del operador.
> Complementa (NO duplica) [`intake-checklist.md`](../client-a/intake-checklist.md)
> y el dossier [`machine-a-bhx050.md`](../client-a/machine-a-bhx050.md).

## Principio rector

**Un programa MPR que el cliente ya produce vale más que cualquier
documentación pública.** woodWOP es el CAM del cliente: los programas que
exporta hoy son, por definición, la gramática que la BHX 050 acepta. Con
2-3 muestras pequeñas y conocidas, el subconjunto de perforación queda
evidenciado; con cero muestras, B2 no arranca (`BHX01`: no límites ni
formatos inventados).

## Qué recolectar (en orden de valor)

### 1. Muestra A — panel con el patrón del fixture KDT (LA más valiosa)

Pedir al operador que cree/abra en su woodWOP un programa para **una pieza
600×400×18 mm con exactamente este mecanizado** (el mismo de
`fixture-kdt-field-001`, cuyos valores esperados ya están calculados y
congelados en [`docs/machines/client-b/k4-field-validation/expected-values.md`](../client-b/k4-field-validation/expected-values.md)):

- Cara A: 2 perforaciones verticales Ø5 prof.10 (50,100) y (350,100) — pines de entrepaño.
- Cara B: 2 perforaciones verticales Ø8 prof.12 (50,500) y (350,500) — tarugos.
- Canto X=600: 1 caja Ø15 prof.12 en Y=200, Z=9 (minifix).
- Canto X=0: 1 perforación horizontal Ø8 prof.15 en Y=200, Z=9 (tarugo).
- Canto Y=400: 1 perforación horizontal Ø5 prof.36 en X=300, Z=9 (excéntrica).
- Canto Y=0: 1 perforación horizontal Ø4 prof.12 en X=200, Z=9 (bisagra).

Exportar/guardar como **MPR** (el formato que su flujo manda a la máquina
hoy — si su flujo usa MPRX/MPRXE, exportar AMBOS y anotar cuál consume la
máquina realmente). Ese archivo responde de un saque: gramática de
perforados vertical/horizontal, encoding, decimales, fin de línea,
unidades, origen, convención de caras, Z1, nombres de archivo y versión.

### 2. Muestra B — pieza sólo-cantos (4 horizontales, sin cara A/B)

Segunda pieza 600×400×18 con 4 horizontales Ø5 prof.36 (2 por canto
lateral, Y=150/Y=450, Z=9). Confirma cómo el formato representa una pieza
sin mecanizado de cara y si la gramática cambia.

### 3. Muestra C (opcional, si el taller la tiene a mano)

Un programa real pequeño de producción del cliente (su trabajo cotidiano),
sanitizado. Da vocabulario extra (macros, comentarios, subprogramas) sin
diseñar nada especial.

### 4. Los ítems fijos del [intake checklist](../client-a/intake-checklist.md) §Máquina A

Versión exacta de woodWOP y del control (captura «Acerca de»), configuración
de herramientas con IDs, caras accesibles y método de carga, pinzas, límites
de pieza/espesor, flujo de transferencia.

## Sanitización (misma disciplina que client-b)

- Renombrar los programas a `sample-woodwop-a/b/c.mpr` (sin nombres de
  clientes, piezas reales ni rutas de red).
- Guardar hash SHA-256 del original en la ubicación autorizada del taller y
  hash de la copia sanitizada en el PR de evidencia.
- **Nunca ejecutar macros ni evaluar expresiones** de los archivos para
  inspeccionarlos: lectura estática solamente (contrato B2).
- Sin fotos con número de serie ni datos de empleados.

## Criterios de aceptación por ítem (qué hace «usable» una muestra)

| Ítem | Aceptación | Qué habilita |
|---|---|---|
| Muestra A | MPR de la pieza del fixture, abre en su woodWOP y su máquina la acepta hoy | Perfil r2 (encoding/decimales/EOL/unidades/origen/caras) + gramática del subconjunto de perforado |
| Muestra B | Ídem, pieza sin mecanizado de cara | Representación de pieza sólo-horizontales |
| Muestra C | Programa real sanitizado | Vocabulario completo observado (macros/comentarios) |
| Versión woodWOP + control | Captura legible | `targetSoftware` con proveniencia de campo; descarta MPRX/MPRXE por novedad |
| Herramientas con IDs | Captura o export | BHX05 (bloqueo por herramienta no soportada) |
| Caras/pinzas/límites | Respuestas del operador | BHX05/BHX06 (montajes y accesibilidad) |

## Después de la visita

1. PR de evidencia en `docs/machines/client-a/` con las muestras
   sanitizadas + hashes + respuestas del operador.
2. Con la Muestra A/B aceptada: **B2 arranca de verdad** — dimensiones del
   perfil `mpr-woodwop@r2` evidenciadas, serializer + lector independiente
   (BHX02) contra las muestras reales, y la frontera de capacidad de
   `generateSelectedMachiningOutput` se abre a woodWOP con la misma
   disciplina fail-closed de KDT.
3. El fixture `fixture-kdt-field-001` se reutiliza como vector esperado:
   **un fixture, dos receptores** — las mismas 12 operaciones verificadas
   contra la BHX y contra la Flexdrill.
4. La validación de instalación (import/readback real, pieza física) sigue
   siendo #352 con su propia evidencia (BHX12) — la entrega técnica B2 no
   homologa la máquina.
