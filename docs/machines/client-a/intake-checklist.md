# Checklist de evidencia de campo — `client-a`

> Para enviar al operador del taller. Objetivo: reunir la **mínima evidencia
> útil** para los dossiers [`machine-a-bhx050.md`](./machine-a-bhx050.md) (BHX
> 050) y [`machine-b-hpp250.md`](./machine-b-hpp250.md) sin exponer datos
> sensibles. Con lo que traiga este checklist se cierran los campos
> `FIELD_VERIFICATION_REQUIRED`; sin él, esos campos permanecen abiertos y
> **ninguna capacidad se da por existente**.

## Reglas de privacidad (antes de enviar anything)

- NO incluir: nombres de clientes o proyectos reales, precios, datos
  comerciales, credenciales, nombres de usuario, contraseñas, tokens.
- NO incluir: nombres de host, direcciones IP, rutas de red privadas ni
  capturas de exploradores de archivos que muestren rutas internas.
- Fotos y capturas: revisar que no salgan pantallas con datos comerciales
  abiertos detrás; recortar si hace falta.
- Archivos de ejemplo: renombrar a `sample-job-001` (y `sample-job-002` si
  hace falta) antes de enviarlos.
- Si es posible, usar un **trabajo de prueba simple/desechable**, no un
  trabajo de producción real.

## Máquina A — WEEKE BHX 050

1. Foto de la placa de identificación de la máquina (fabricante/modelo/año) si
   está accesible.
2. Foto o captura de la pantalla de inicio del controlador/software.
3. Foto o captura de la pantalla “Acerca de / Versión” (versión **exacta** +
   build si aparece).
4. **Un programa pequeño que la máquina acepte hoy** (archivo de ejemplo;
   renombrado `sample-job-001`).
5. Un ejemplo del flujo actual de producción: cómo llega un trabajo desde su
   software hasta la máquina (una foto/captura o 3–4 líneas de descripción;
   sin rutas privadas).
6. Foto o captura de la configuración de herramientas/brocas si es accesible
   (qué brocas están montadas y sus códigos/IDs).

Preguntas rápidas para el operador (responder en pocas líneas):

- ¿Cómo entran los programas a la máquina (USB / red / otro)?
- ¿Qué caras puede perforar la máquina en una pieza y cómo se le indica?
- ¿La máquina ranura (groove)? ¿Fresa (routing)? ¿Hasta qué profundidad?
- ¿Cómo identifica cada pieza/trabajo la máquina (¿código de barras, nombre de
  programa, etiqueta)?
- Dimensiones mínima/máxima de pieza y espesor máximo que trabaja en la
  práctica.

## Máquina B — HOLZMA HPP 250

1. Foto de la placa de identificación de la máquina (fabricante/modelo/año) si
   está accesible.
2. Captura o foto donde se vea la versión del controlador CADmatic.
3. Captura o foto donde se vea el software de optimización que usan y su
   versión exacta.
4. **Un trabajo de corte pequeño que la sierra acepte hoy** (archivo de
   ejemplo; renombrado `sample-job-001`).
5. Una etiqueta real producida para una pieza (física fotografiada o el
   formato de la etiqueta).
6. Descripción corta o captura del flujo actual de import/transferencia: cómo
   llega el trabajo de corte a la sierra (sin rutas privadas).

Preguntas rápidas para el operador (responder en pocas líneas):

- ¿Qué software genera el plan de corte hoy: la propia sierra/CADmatic, un
  software aparte, o llega ya armado desde afuera?
- ¿Qué pasa con la veta (grain): cómo se indica y cuándo se respeta?
- ¿Qué información lleva la etiqueta de cada pieza (¿código de barras? ¿qué
  codifica?)?
- ¿Cómo llega la pieza cortada a la siguiente máquina (¿misma identificación?)
  y qué se lee de vuelta de la sierra (¿reportes, secuencia de corte)?
- Kerf/recortes (trim): ¿quién los define y con qué valores?

## Devolución

- Enviar evidencia por el canal acordado con el owner de Granete; el
  repositorio recibe **sólo la versión sanitizada**.
- El owner carga la evidencia en los dossiers (sección correspondiente) y
  actualiza los campos `FIELD_VERIFICATION_REQUIRED` → valor con
  `CLIENT_CONFIRMED` + evidencia.
- Firma del operador para validación posterior (no ahora): rol, fecha y qué
  validó exactamente — ver sección “Sign-off” de cada dossier.
