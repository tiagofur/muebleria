---
title: "Título descriptivo del registro histórico"
record_type: "audit" # Valores permitidos: audit | investigation | baseline | snapshot | postmortem
date: "YYYY-MM-DD"
status: "verified" # Valores permitidos: unverified | verified | superseded | partially_implemented | resolved
target_commit: "" # SHA de commit auditado o snapshot estático (ej. 316df57c) si aplica
related_issues: [] # Ej. [1286]
related_prs: [] # Ej. [1288]
related_commits: [] # SHAs de commits vinculados
supersedes: [] # Rutas relativas a documentos que este registro reemplaza
superseded_by: [] # Rutas relativas a documentos vigentes que reemplazan este registro
---

# Título descriptivo del registro histórico

> **Aviso de autoridad:** Este documento es un registro histórico de punto en el tiempo
> (snapshot). No constituye una especificación operativa vigente ni autoriza por sí
> mismo cambios en el producto. Para la especificación vigente, consultar las fuentes
> canónicas enlazadas en la sección §5.

---

## 1. Contexto y motivación

Explicar brevemente qué motivó este registro (incidente, auditoría periódica,
investigación de arquitectura, cierre de fase o análisis de deuda técnica).

- **Problema abordado:** Descripción concisa del problema o necesidad.
- **Participantes / Agente:** Quién o qué rol realizó el análisis.

## 2. Alcance temporal y entorno auditado

Delimitar con precisión el entorno exacto en el que se obtuvieron los datos:

- **Commit SHA base:** `commit-hash` (inmutable).
- **Entorno de ejecución:** Local / CI / Docker / Base de datos de prueba descartable.
- **Componentes o módulos inspeccionados:** Rutas o subsistemas exactos.

## 3. Hallazgos y evidencias

Registrar hechos observables y diferenciarlos rigurosamente de hipótesis o sospechas:

### 3.1 Hechos verificados
- Comportamientos reproducidos mediante comandos exactos o pruebas automatizadas.
- Métricas, trazas o salidas de consola registradas.

### 3.2 Hipótesis y aspectos no verificados (UNKNOWN)
- Puntos donde falta evidencia empírica. Declarar explícitamente `NO VERIFICADO` o
  `EVIDENCIA NO LOCALIZADA` en lugar de asumir estados.

## 4. Decisiones tomadas o recomendaciones

- **Recomendaciones inmediatas:** Acciones sugeridas para resolver los hallazgos.
- **Decisiones arquitectónicas derivadas:** Si dio lugar a un ADR, enlazarlo en `docs/adr/`.
- **Issues propuestos:** Enlaces a issues abiertos en GitHub para dar seguimiento.

## 5. Vigencia y fuentes canónicas sucesoras

Si este registro ha sido superado o complementado por documentación posterior,
indicarlo explícitamente:

- **Documento canónico actual:** Enlace relativo a la fuente de verdad viva (ej. `docs/prd-v2.md`, `docs/architecture/organization-foundation-v2.md`).
- **Estado de las recomendaciones:** Indicar qué recomendaciones fueron implementadas y cuáles permanecen abiertas o fueron descartadas con justificación técnica.
