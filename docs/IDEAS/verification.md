# Verificación — Criterios de Aceptación

> **Propósito**: Define cómo demostrar que una feature funciona correctamente
> antes de marcarla como `done`. El revisor (automático o humano) usa esta
> checklist para aprobar o rechazar el trabajo.

---

## 1. Niveles de verificación

### Nivel 1: Gate local (siempre)

Todo cambio debe pasar por este gate antes de cualquier otra verificación.

```bash
./init.sh
```

Este comando ejecuta secuencialmente:
1. `pnpm install` (dependencias actualizadas)
2. `pnpm typecheck` (tipos correctos)
3. `pnpm test` (tests verdes)
4. `pnpm build` (build exitoso)

Si falla → **detener**. El cambio no está listo para revisión.

### Nivel 2: Pruebas unitarias (feature-specific)

| Tipo | Dónde | Qué verifica |
|------|-------|-------------|
| Golden tests | `packages/domain/__tests__/` | Fórmulas contra valores esperados (precisión milimétrica) |
| Comportamiento | `packages/ui/__tests__/` | Estados de UI: loading, empty, error, edge cases |
| Integración | `apps/web/__tests__/` | Flujos completos (Modo 1 → Modo 4) |

**Regla**: Cualquier cambio en fórmulas del dominio **debe** incluir un golden
test con valores de referencia (ej. cálculo de despiece verificado contra
`Plantilla_Muebles.xlsx`).

### Nivel 3: Verificación visual (UI)

| Qué | Cómo |
|-----|------|
| Componentes nuevos | `$impeccable audit` (regression visual) |
| Estados de carga/error | Prueba manual de cada estado |
| Responsive 1024–1920px | Ajustar viewport y revisar layout |
| Consistencia de diseño | Comparar contra `docs/design.md` tokens |

### Nivel 4: Verificación de exportación (Modo 4 / CAM)

| Formato | Criterio |
|---------|---------|
| PDF de corte | Las cotas en el PDF coinciden con el cálculo del dominio |
| DXF para CNC | Capas correctas (Contorno, RANURA, PERFORACION_BISAGRA, PERFORACION_TARUGO) |
| CSV materiales | Columnas y formato compatibles con importadores del mercado |

## 2. Verificación final (antes de declarar `done`)

Checklist que el implementador debe recorrer:

- [ ] `pnpm test` verde
- [ ] `pnpm typecheck` verde (si cambió TS)
- [ ] `go test ./...` verde (si cambió backend-go)
- [ ] Servidor backend arranca con `./dev.sh` (si cambió backend-go)
- [ ] Evidencia documentada en `progress/current.md`
- [ ] Estados edge case cubiertos (loading, empty, error)
- [ ] Sin valores hardcodeados de colores/espaciados (usa tokens de `docs/design.md`)
- [ ] `git push` — HEAD local igual a origin

## 3. Anti-patrones (no hacer)

| Anti-patrón | Por qué |
|-------------|---------|
| "Los tests los escribo después" | Los tests se entregan con la feature, no en PR separado |
| "Solo probé en mi máquina" | Los tests deben correr en CI (o en `./init.sh`) sin intervención manual |
| "El lint no falla, está bien" | Lint no reemplaza tests de comportamiento |
| "Solo cambié una línea, no hace falta test" | Si cambia comportamiento del dominio, necesita test |
| "Corre en producción, está bien" | Verificar contra `docs/design.md` y `docs/conventions.md` |

## 4. Criterios del revisor automático

El revisor (`reviewer` skill) evalúa contra:

| Fuente | Qué revisa |
|--------|-----------|
| `docs/architecture.md` | ¿Respeta la estructura de paquetes y boundaries? |
| `docs/conventions.md` | ¿Sigue naming, tipado, estilo de código? |
| `CHECKPOINTS.md` | ¿Cumple los checkpoints de calidad? |
| `docs/design.md` | ¿Usa los tokens y patrones definidos? |
| Este documento | ¿Pasó los niveles de verificación? |
