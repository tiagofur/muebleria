# Plantilla de dossier de máquina (field evidence)

> Propósito: recolectar en una visita al taller todo lo que #348/#351/#352/#353
> necesitan para construir el `MachineProfile` real de ese cliente. Una máquina
> = un dossier. Completar lo que se pueda; **lo que no se puede verificar se
> marca "no verificado"** — nunca se infiere ni se estima.
>
> **Sanitización obligatoria antes de que el dato entre al repo:** sin nombres
> de clientes/personas, sin paths de red locales, sin URLs con credenciales, sin
> números de serie si el taller los considera sensibles (usar código interno).

## 1. Identidad de la máquina

| Campo | Valor | Verificado |
|---|---|---|
| Fabricante / modelo | | ☐ placa ☐ manual ☐ operador |
| Año / estado general | | ☐ |
| Tipo (cantiadora / perforadora / centro de mecanizado / sierra) | | ☐ |
| Cliente-piloto (código interno, no nombre real) | | ☐ |

## 2. Control y software

| Campo | Valor |
|---|---|
| Software de control (nombre) | |
| Versión EXACTA + build | |
| Sistema operativo | |
| Licencia/módulos relevantes | |
| Cómo se cargan los programas (USB / red / nube) | |

## 3. Formatos aceptados

Para cada formato que el software importa: marca, versión del formato y un
ejemplo real si es posible.

| Formato | ¿Importa? | Versión | Ejemplo real (archivo) |
|---|---|---|---|
| PTX | | | |
| DXF | | | |
| Propietario (cuál) | | | |

## 4. Capacidades físicas — perforación

| Campo | Valor | Cómo se verificó |
|---|---|---|
| Diámetro mínimo (mm) | | ☐ catálogo técnico ☐ operador ☐ prueba |
| Diámetro máximo (mm) | | ☐ |
| Profundidad máxima (mm) | | ☐ |
| Nº de husillos / posiciones de herramienta | | ☐ |
| Paso entre husillos / matriz (mm) | | ☐ |
| Caras perforables en un pase | | ☐ |

## 5. Capacidades físicas — corte/tablero

| Campo | Valor | Cómo se verificó |
|---|---|---|
| Dimensiones máximas de tablero (L×A mm) | | ☐ |
| Espesor máximo (mm) | | ☐ |
| Sierra / ranurado disponible | | ☐ |
| Zonas de vacío / amordazado | | ☐ |

## 6. Sample job (el dato más valioso)

- [ ] Un archivo de producción real de esa máquina (programa que ya corrió),
      lo más reciente posible.
- [ ] Si el software exporta/re-importa: **readback** del mismo archivo
      (importar lo exportado y confirmar que la máquina lo acepta igual).
- [ ] Fotos de la máquina y de la pantalla de import (sanitizadas).

## 7. Sign-off del operador (para #348)

| Campo | Valor |
|---|---|
| Nombre/cargo del operador que valida | |
| Fecha de la validación | |
| Qué validó exactamente (import + readback + simulación / corte de prueba) | |

## 8. Notas de taller

Todo lo operativo: errores frecuentes del software, workarounds, qué formato
usan realmente día a día, quién programa la máquina.

---

## Después de la visita

1. Sanitizar (checklist de arriba).
2. Cargar el dossier como evidence pack versionado (revision + checksum).
3. Con esos datos se construye el `MachineProfile` (capability por capability,
   sólo lo verificado) — ver
   `docs/architecture/machine-profiles-and-adapters.md`.
4. El primer vertical: congelar un **fixture PTX** y su expected readback
    (issue #348), sin ejecutar producción.
