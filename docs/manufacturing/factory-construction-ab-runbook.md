# Runbook de soporte — caso A/B de política de construcción (#875)

Objetivo: reproducir, sin ayuda del autor original, el caso de aceptación de
#875 — **dos fábricas definen políticas distintas sobre la misma biblioteca
Standard y ambas obtienen su resultado correcto**.

Pre-requisitos: dos organizaciones de tipo fábrica (A y B), un usuario
admin/ingeniero en cada una, y la biblioteca Standard publicada (el seed
demo la crea: `POST /api/seed` con un usuario de plataforma).

## 1. Fábrica A define su política

1. Entrar como admin de A → **Config → Ingeniería y Producción → Construcción
   y uniones**.
2. En la familia **Entrepaño** elegir sistema `Minifix + Tarugo`,
   fijaciones `4`, márgenes `40`.
3. **Guardar borrador** y luego **Activar política**. El badge pasa a mostrar
   la política activa.

## 2. Fábrica B define la suya

1. Entrar como admin de B → mismo lugar.
2. Entrepaño: `2` fijaciones, márgenes `40`. Guardar borrador → Activar.

Verificar aislamiento: A no ve los valores de B ni viceversa (recargar la
pantalla muestra la política de cada fábrica).

## 3. El mismo mueble, resultados distintos

1. En cada fábrica, abrir un mueble con entrepaño regulable (por ejemplo el
   gabinete demo) y resolver el despiece (Proyectar o el resolve de autoría).
2. En **Borer/inspección de uniones** (panel de estado de uniones del
   diseño), la relación de entrepaño muestra `Estaciones: 4` para A y
   `Estaciones: 2` para B.
3. El fingerprint de manufactura difiere entre fábricas; la biblioteca
   Standard (releases) queda byte-idéntica.

## 4. Excepción por componente

1. En A, editar el componente entrepaño → pestaña **Construcción**.
2. Fijar `3` estaciones y **Guardar excepción**. El badge pasa a
   `Componente (Excepción)`.
3. Resolver de nuevo: esa pieza perfora 3; el resto del mueble sigue 4.
4. **Restaurar herencia** borra la excepción (no copia el valor como override
   oculto) y la pieza vuelve a 4.

## 5. Borrador y historial

1. Guardar un **borrador inválido** (fijaciones `1`): el borrador se
   conserva; «Activar política» lo rechaza con el motivo y **nada cambia**.
2. Corregir a `5`, guardar y activar: los cálculos nuevos usan 5.
3. Un diseño ya aprobado/release congelado sigue perforando con la política
   con la que fue congelado (verificar en Producción: la pieza no cambia).

## Errores comunes

| Síntoma | Causa | Qué hacer |
| --- | --- | --- |
| «El overlay cambió en otra sesión» | Otro editor guardó primero (412) | Recargar Config, reaplicar los cambios y guardar |
| «Activar» deshabilitado | El borrador tiene valores fuera de rango | Corregir los valores marcados y re-guardar el borrador |
| Vendedor no puede guardar | La matriz de permisos exige admin/ingeniero | Usar una cuenta con el rol adecuado |
