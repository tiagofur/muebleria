# SUPER AUDITORÍA 360° — GRANETE / MUEBLERÍA

Repository:

```text
tiagofur/muebleria
```

Branch principal:

```text
main
```

---

# /goal

Realizar una **auditoría integral, exhaustiva, crítica y accionable de TODO el producto Granete/Mueblería**, incluyendo como mínimo:

- Web App
- Backend
- Plugin de SketchUp
- integración Web ↔ Backend ↔ SketchUp
- documentación técnica
- documentación funcional
- arquitectura
- modelo de dominio
- base de datos
- APIs
- autenticación
- autorización
- multitenancy
- roles y permisos
- UI
- UX
- navegación
- flujos operativos
- flujos de usuario
- código
- seguridad
- rendimiento
- mantenibilidad
- deuda técnica
- pruebas
- CI/CD
- observabilidad
- errores
- validaciones
- estados
- contratos
- sincronización
- funcionalidades completas
- funcionalidades incompletas
- funcionalidades duplicadas
- funcionalidades inconsistentes
- funcionalidades documentadas pero no implementadas
- funcionalidades implementadas pero no documentadas
- issues
- PRs
- decisiones arquitectónicas
- preparación para producción
- preparación para una demostración comercial

El resultado NO debe ser solamente una auditoría técnica.

Debe convertirse en una **fuente de verdad completa del producto** que permita entender:

1. qué es Granete;
2. qué problema resuelve;
3. para quién está diseñado;
4. cómo está construido;
5. cómo funciona;
6. cómo se utiliza;
7. qué funciona actualmente;
8. qué funciona parcialmente;
9. qué todavía no funciona;
10. qué está mal diseñado;
11. qué está bien diseñado;
12. qué debe simplificarse;
13. qué debería eliminarse;
14. qué debería agregarse;
15. qué debe mejorarse;
16. qué riesgos existen;
17. qué deuda técnica existe;
18. qué problemas de UX existen;
19. qué problemas de arquitectura existen;
20. qué problemas de negocio existen;
21. qué necesitamos obligatoriamente para el MVP;
22. qué NO necesitamos todavía para el MVP;
23. qué necesitamos específicamente para las próximas demos;
24. cuál debe ser el orden óptimo de implementación;
25. qué funcionalidades pueden generar el mayor impacto comercial.

El resultado principal debe ser una **documentación web interactiva profesional construida con HTML + CSS + JavaScript**, navegable localmente, que funcione además como:

- documentación;
- auditoría;
- manual de usuario;
- manual técnico;
- mapa del producto;
- mapa arquitectónico;
- inventario funcional;
- inventario de pantallas;
- catálogo de API;
- mapa de integración;
- matriz de permisos;
- backlog de mejoras;
- análisis UX/UI;
- análisis técnico;
- checklist del MVP;
- checklist de demo;
- registro de riesgos;
- roadmap recomendado;
- centro de decisiones del producto.

---

# OBJETIVO COMERCIAL PRIORITARIO

Existe una prioridad superior a todas las demás:

> Conseguir que Granete esté suficientemente sólido, completo y convincente para realizar una excelente demostración a dos posibles clientes reales.

Por lo tanto, NO debes tratar todas las mejoras como si tuvieran la misma prioridad.

Cada hallazgo debe ser evaluado también desde esta pregunta:

> ¿Esto aumenta o disminuye nuestra probabilidad de realizar una demo exitosa y convertir esos prospectos en clientes?

La auditoría debe separar claramente:

```text
DEMO BLOCKER
MVP BLOCKER
CRITICAL
HIGH
MEDIUM
LOW
FUTURE
```

No convertir el proyecto inmediatamente en una plataforma perfecta.

Primero debemos conseguir:

```text
un flujo principal excepcionalmente sólido
>
muchísimas funcionalidades parcialmente terminadas
```

---

# PRINCIPIO DEL MVP

Para esta fase priorizar:

```text
Happy Path > Edge Cases
```

Queremos que aproximadamente el **99 % del uso normal esperado durante la demo** tenga un flujo coherente, profesional y funcional.

Los casos extremadamente específicos, excepcionales o poco probables pueden documentarse para una fase posterior siempre que no pongan en riesgo:

- integridad de datos;
- seguridad;
- funcionamiento principal;
- experiencia de demostración;
- confianza del cliente.

---

# META DE LA DEMO

El producto debe demostrar convincentemente que puede cubrir el ciclo de trabajo de una pequeña o mediana fábrica de muebles.

La auditoría debe prestar especial atención al flujo:

```text
cliente / oportunidad
        ↓
cotización
        ↓
diseño
        ↓
muebles
        ↓
versionamiento
        ↓
liberación
        ↓
SketchUp
        ↓
herrajes / accesorios
        ↓
perforaciones
        ↓
piezas
        ↓
optimización / corte
        ↓
CNC
        ↓
producción
        ↓
armado
        ↓
instalación
```

No asumas que esta secuencia representa exactamente la implementación actual.

Descúbrela en código, documentación, UI, APIs y modelo de dominio.

Cuando el sistema implemente algo diferente, documenta:

```text
EXPECTED
ACTUAL
GAP
RECOMMENDATION
```

---

# FLUJOS ESPECIALMENTE IMPORTANTES PARA LA DEMO

Investiga con máximo detalle los siguientes escenarios.

## Flujo A — Mueble → SketchUp

```text
Crear mueble
→ configurar piezas
→ configurar materiales
→ configurar herrajes
→ versionar
→ liberar
→ disponibilizar en SketchUp
→ insertar/utilizar
```

Un mueble incompleto o en desarrollo NO debería comportarse como un mueble liberado.

Auditar especialmente:

- estados;
- versionamiento;
- publicación;
- contratos;
- sincronización;
- caché;
- identificación;
- actualización;
- compatibilidad.

---

## Flujo B — Cotización → Diseño

Analizar cómo una cotización se transforma o conecta con un diseño.

Determinar:

- modelo actual;
- entidades involucradas;
- relaciones;
- estados;
- sincronización;
- conservación de datos;
- conflictos;
- UX.

---

## Flujo C — Diseño → Cotización

La integración debe poder funcionar también en sentido contrario cuando tenga sentido.

Auditar la verdadera bidireccionalidad:

```text
WEB ↔ BACKEND ↔ SKETCHUP
```

No aceptar como “bidireccional” una integración que realmente dependa de copiar o reconstruir manualmente información.

---

## Flujo D — Herrajes

Necesitamos poder demostrar muebles utilizando herrajes reales, especialmente ejemplos como:

- cajón Blum;
- bisagras Blum;
- correderas;
- conectores;
- tornillos;
- taquetes;
- accesorios.

Auditar:

- catálogo;
- modelo;
- geometría;
- archivos `.skp`;
- representación;
- propiedades;
- parámetros;
- montaje;
- relación con piezas;
- reglas;
- diseño;
- visualización;
- sincronización.

---

## Flujo E — Perforaciones

Área CRÍTICA.

Analizar profundamente cómo deberían definirse perforaciones generadas por:

- herrajes;
- tornillos;
- taquetes;
- accesorios;
- reglas de contacto.

Necesitamos entender:

```text
qué componente perfora
qué pieza recibe la perforación
en qué cara
en qué posición
con qué profundidad
con qué diámetro
con qué orientación
bajo qué condiciones
```

Investigar si el modelo actual puede representar correctamente este comportamiento.

Revisar especialmente la idea de:

```text
hardware contact → machining operation
```

o el concepto equivalente existente.

Determinar cómo visualizarlo tanto en:

```text
Web 3D
```

como en:

```text
SketchUp
```

La auditoría debe proponer una experiencia donde podamos seleccionar un herraje y entender visualmente:

- dónde está ubicado;
- qué piezas toca;
- qué perforaciones genera;
- qué lado perfora;
- profundidad;
- diámetro;
- orientación;
- conflictos.

---

# CNC

Para el MVP/demo queremos como mínimo evaluar:

```text
DXF de perforaciones
```

y, si la arquitectura lo permite razonablemente:

```text
exportación / script CNC
```

Investigar arquitectura para máquinas como SCM/Morbidelli u otras, sin acoplar innecesariamente el dominio a un fabricante.

Proponer abstracción apropiada si fuera necesaria:

```text
MachiningOperation
↓
MachinePostProcessor
↓
MachineSpecificOutput
```

o una arquitectura mejor si encuentras una alternativa.

---

# SKETCHUP

Realizar una auditoría profunda del plugin.

No analizarlo como proyecto independiente.

Considerarlo una parte integral de Granete.

Auditar:

- arquitectura Ruby;
- organización interna;
- servicios;
- UI;
- comunicación;
- autenticación;
- sincronización;
- actualización;
- versionamiento;
- cache;
- errores;
- estados;
- logging;
- offline;
- resiliencia;
- contratos;
- modelos;
- geometría;
- transformaciones;
- unidades;
- materiales;
- componentes;
- piezas;
- herrajes;
- metadata;
- atributos;
- persistencia;
- compatibilidad;
- integración backend;
- integración web;
- actualización de muebles;
- librerías;
- selección;
- inserción;
- edición;
- recuperación de información.

Responder especialmente:

> ¿Web, Backend y SketchUp comparten realmente el mismo modelo conceptual?

Si no:

documentar divergencias.

---

# WEB APP

Debes encontrar TODAS las rutas/páginas/pantallas existentes.

Crear un inventario exhaustivo.

Para CADA pantalla documentar:

```text
Nombre
Ruta
Objetivo
Usuario objetivo
Roles permitidos
Datos utilizados
APIs utilizadas
Estados
Acciones principales
Acciones secundarias
Navegación de entrada
Navegación de salida
Componentes relevantes
Loading state
Empty state
Error state
Success state
Validaciones
Responsive behavior
Permisos
Problemas
Deuda
Mejoras
Prioridad
Importancia para demo
```

No limitar la auditoría a páginas principales.

Buscar también:

- dialogs;
- drawers;
- sidebars;
- modals;
- wizards;
- tabs;
- context menus;
- forms;
- tables;
- cards;
- selectors;
- 3D viewers;
- configuradores;
- acciones ocultas;
- acciones condicionadas por roles.

---

# AUDITORÍA UI/UX PANTALLA POR PANTALLA

Para cada interfaz revisar:

## Jerarquía visual

- título;
- subtítulo;
- acciones;
- CTA;
- información primaria;
- secundaria;
- terciaria.

## Navegación

- claridad;
- consistencia;
- profundidad;
- breadcrumbs;
- volver;
- flujo;
- contexto.

## Formularios

- labels;
- placeholders;
- tipos;
- validaciones;
- mensajes;
- defaults;
- autocompletado;
- keyboard navigation;
- agrupamiento;
- cancelación;
- guardado.

## Feedback

- loading;
- success;
- warning;
- error;
- disabled;
- optimistic update;
- progress.

## Estados

Toda pantalla importante debería analizar:

```text
default
loading
empty
partial
success
error
disabled
unauthorized
offline
```

cuando corresponda.

## UX industrial

No analizar la UI como una aplicación genérica SaaS.

Pensar en usuarios como:

- administrador;
- dueño de fábrica;
- ventas;
- gerente de ventas;
- diseñador;
- producción;
- operador;
- instalador.

Reducir:

- clicks;
- retrabajo;
- duplicación;
- búsqueda innecesaria;
- navegación innecesaria;
- ingreso repetido de información.

---

# DISEÑO

Evaluar:

- layout;
- densidad;
- spacing;
- tipografía;
- colores;
- contraste;
- iconografía;
- tablas;
- cards;
- forms;
- modals;
- navegación;
- consistencia;
- accesibilidad;
- responsive;
- desktop;
- tablet;
- mobile.

No recomendar rediseños simplemente porque “se verían más modernos”.

Cada recomendación UX/UI debe explicar:

```text
problema
impacto
solución
beneficio
prioridad
```

---

# BACKEND

Realizar inventario completo de:

- servicios;
- módulos;
- handlers;
- controllers;
- endpoints;
- middleware;
- repositories;
- domain services;
- workers;
- jobs;
- event handlers;
- validators;
- serializers;
- mappers.

Para CADA endpoint importante documentar:

```text
METHOD
PATH
PURPOSE
AUTH
ROLES
TENANT
INPUT
VALIDATION
OUTPUT
ERRORS
DOMAIN OBJECTS
CALLERS
DEPENDENCIES
SIDE EFFECTS
RELATED WEB SCREEN
RELATED SKETCHUP FUNCTION
TEST COVERAGE
KNOWN PROBLEMS
```

---

# MODELO DE DOMINIO

Reconstruir el modelo REAL existente en el código.

No confiar solamente en documentación.

Identificar entidades como corresponda:

```text
Organization
Factory
Store
User
Role
Customer
Quote
Design
Furniture
FurnitureVersion
Part
Material
Hardware
Accessory
MachiningOperation
ProductionOrder
Installation
```

La lista anterior es orientativa.

No inventar entidades inexistentes.

Crear diagramas de relaciones.

Identificar:

- aggregate roots;
- ownership;
- IDs;
- lifecycle;
- state machines;
- invariants;
- dependencias.

---

# MULTITENANCY

Auditar profundamente tenant isolation.

Comprobar:

```text
organization A ≠ organization B
```

en:

- queries;
- repositories;
- endpoints;
- cache;
- uploads;
- SketchUp;
- IDs;
- búsquedas;
- exports;
- jobs;
- logs.

Clasificar cualquier posibilidad de fuga entre tenants como crítica.

---

# ORGANIZACIONES / FÁBRICAS / TIENDAS

Auditar el modelo pensado para permitir una fábrica disponer Granete para tiendas/distribuidores.

Analizar:

```text
organization
factory
store/distributor
sales team
users
roles
installer
```

Comprobar si dominio, backend y UI representan consistentemente esta estructura.

---

# ROLES Y PERMISOS

Reconstruir la matriz real:

```text
ROLE × RESOURCE × ACTION
```

Por ejemplo:

```text
view
create
update
delete
approve
release
export
assign
install
produce
configure
```

Comparar:

```text
frontend permissions
vs
backend permissions
vs
documented permissions
```

Detectar inconsistencias.

Nunca considerar seguridad suficiente porque un botón esté oculto en React.

---

# SEGURIDAD

Auditar como mínimo:

- authentication;
- authorization;
- tenant isolation;
- IDOR;
- injection;
- XSS;
- CSRF;
- CORS;
- secrets;
- environment variables;
- JWT/session;
- password handling;
- file upload;
- path traversal;
- API exposure;
- SketchUp credentials;
- tokens;
- logs sensibles;
- validation;
- error leakage;
- rate limiting;
- dependency risks.

Clasificar problemas reales por severidad.

Evitar alarmismo.

---

# BASE DE DATOS

Auditar:

- schema;
- migraciones;
- relaciones;
- foreign keys;
- indexes;
- unique constraints;
- nullable;
- deletes;
- cascades;
- soft deletes;
- timestamps;
- tenant ownership;
- enums;
- estados;
- naming;
- compatibilidad con dominio.

Buscar particularmente:

- datos huérfanos;
- estados imposibles;
- duplicaciones;
- relaciones débiles;
- consultas N+1;
- índices faltantes.

---

# CONTRATOS FRONTEND ↔ BACKEND

Comparar:

```text
frontend types
backend DTOs
API responses
database model
SketchUp payloads
```

Identificar divergencias.

Crear una sección específica:

# CONTRACT DRIFT

con todos los casos detectados.

---

# AUDITORÍA DE CÓDIGO

Analizar:

- arquitectura;
- separación de responsabilidades;
- acoplamiento;
- cohesión;
- duplicación;
- módulos demasiado grandes;
- funciones demasiado complejas;
- dead code;
- legacy code;
- TODO;
- FIXME;
- hacks;
- magic values;
- hardcoded states;
- strings;
- colors;
- URLs;
- IDs;
- errores silenciosos;
- tipos incorrectos;
- null handling;
- concurrencia;
- async;
- retries;
- transactions;
- race conditions;
- caching;
- logging.

No generar recomendaciones genéricas.

Cada hallazgo debe incluir evidencia concreta del repositorio.

---

# AUDITORÍA DE DOCUMENTACIÓN

Encontrar TODO archivo de documentación.

Incluyendo, cuando existan:

```text
README
AGENTS.md
docs/**
architecture/**
design/**
ADR
CHECKPOINTS
feature lists
roadmaps
issue specifications
API documentation
plugin documentation
deployment documentation
```

Crear matriz:

| Tema | Documentado | Implementado | Coincide | Acción |
|---|---|---|---|---|

Clasificar inconsistencias:

```text
DOC-ONLY
CODE-ONLY
STALE
CONTRADICTORY
CORRECT
INCOMPLETE
```

---

# AGENTS.md

Leer y respetar TODOS los `AGENTS.md` aplicables antes de realizar cualquier modificación.

Si existen instrucciones por subdirectorio, respetar la jerarquía correspondiente.

Documentar también problemas encontrados en instrucciones de agentes cuando puedan provocar implementaciones incorrectas.

---

# ISSUES

Analizar issues:

- abiertos;
- recientemente cerrados;
- relacionados con arquitectura;
- relacionados con MVP;
- SketchUp;
- web;
- backend;
- producción;
- herrajes;
- perforaciones;
- 3D.

Relacionar:

```text
issue ↔ code ↔ documentation ↔ PR
```

Detectar:

- issue implementado pero abierto;
- issue cerrado pero incompleto;
- issue obsoleto;
- issue duplicado;
- issue demasiado grande;
- issue con DoD ambiguo;
- issue que contradice arquitectura actual;
- funcionalidad necesaria sin issue.

---

# PULL REQUESTS

Investigar PRs recientes relevantes.

No asumir que porque un PR fue merged significa que la funcionalidad está completa.

Buscar:

```text
PR scope
issue DoD
actual implementation
tests
integration
remaining gaps
```

---

# TESTS

Auditar:

- unit;
- integration;
- API;
- frontend;
- E2E;
- SketchUp;
- contract;
- security;
- tenant isolation.

Crear matriz de funcionalidades críticas y cobertura.

No perseguir cobertura porcentual artificial.

Priorizar tests que protejan los flujos del MVP.

---

# E2E MVP

Definir los tests E2E mínimos necesarios para la demo.

Ejemplos orientativos:

```text
create customer
create quote
create design
create furniture
release furniture
sync with SketchUp
insert furniture
configure hardware
generate machining
send to production
complete production
install
```

Adapta la lista al flujo real encontrado.

---

# PERFORMANCE

Auditar:

## Frontend

- bundles;
- lazy loading;
- renders;
- heavy tables;
- large datasets;
- 3D;
- network requests;
- cache.

## Backend

- queries;
- N+1;
- indexes;
- serialization;
- large payloads;
- concurrency.

## SketchUp

- model traversal;
- geometry;
- network;
- parsing;
- redraw;
- observers;
- large projects.

---

# 3D WEB

Auditar toda infraestructura existente relacionada con 3D.

Analizar:

- librerías;
- scene graph;
- geometries;
- materials;
- transforms;
- camera;
- selection;
- highlighting;
- interaction;
- performance.

Determinar qué necesitamos realmente para:

```text
hardware preview
machining preview
contact visualization
```

Evitar construir un CAD completo innecesariamente.

---

# BENCHMARKING

Cuando ayude a tomar decisiones, investigar cómo resuelven problemas similares herramientas como:

- Promob;
- SketchUp;
- plugins profesionales para muebles;
- Gánster;
- DonnaBox;
- Cabinet Vision;
- TopSolid Wood;
- Microvellum;
- Mozaik;
- Fusion;
- sistemas CNC/CAM relevantes.

NO copiar funcionalidades ciegamente.

Para cada referencia responder:

```text
¿Qué problema resuelve?
¿Cómo lo resuelve?
¿Qué podemos aprender?
¿Qué NO necesitamos copiar?
¿Cómo adaptarlo al segmento de Granete?
```

Granete NO pretende ser un Promob barato.

La meta es:

> ser una solución excepcional para pequeñas y medianas fábricas que necesitan un flujo integrado pero no requieren la complejidad completa de un gran CAD/CAM industrial.

---

# INVENTARIO FUNCIONAL

Construir una base estructurada de funcionalidades.

Cada funcionalidad debe tener:

```text
ID
Module
Feature
Description
Users
Status
Frontend
Backend
SketchUp
Tests
Documentation
Demo importance
MVP importance
Problems
Recommendation
Related issues
Related PRs
```

Estados recomendados:

```text
COMPLETE
MOSTLY_COMPLETE
PARTIAL
SCAFFOLD
BROKEN
MISSING
UNKNOWN
```

No marcar como COMPLETE hasta comprobar el flujo completo.

---

# MATRIZ DE INTEGRACIÓN

Construir:

| Feature | Web | Backend | SketchUp | Docs | Tests | Estado |
|---|---|---|---|---|---|---|

Esto es especialmente importante para detectar funcionalidades implementadas solamente en una capa.

---

# MAPA DE FLUJOS

Crear documentación visual de los principales journeys.

Utilizar Mermaid u otra solución que funcione dentro de la documentación HTML.

Ejemplos:

```text
Quote → Design
Design → Quote
Furniture → Release
Release → SketchUp
Hardware → Contact → Machining
Order → Production
Production → Installation
```

---

# USER MANUAL

La documentación también debe funcionar como manual real de uso.

Crear tutoriales por rol.

Ejemplo:

## Administrador

Cómo:

- configurar organización;
- crear usuarios;
- configurar tiendas;
- permisos;
- catálogos.

## Ventas

Cómo:

- crear cliente;
- crear cotización;
- convertir;
- dar seguimiento.

## Diseño

Cómo:

- crear diseño;
- agregar muebles;
- utilizar SketchUp.

## Producción

Cómo:

- recibir trabajo;
- procesar;
- completar.

## Instalador

Cómo:

- consultar instalaciones;
- ejecutar;
- reportar.

No inventar funciones.

Si algo todavía no existe:

indicar claramente:

```text
NOT IMPLEMENTED
```

---

# DEMO MODE

Crear un capítulo especial:

# DEMO PLAYBOOK

Debe describir exactamente cómo presentar Granete a un cliente.

Debe incluir:

```text
demo prerequisites
demo data
demo user
demo organization
demo catalog
demo furniture
demo customer
demo quote
demo design
demo SketchUp scenario
demo hardware
demo production scenario
demo installation
```

Definir:

### Demo Happy Path

paso por paso.

### Qué NO mostrar todavía

porque esté:

- incompleto;
- inestable;
- confuso;
- fuera del MVP.

### Posibles preguntas del cliente

y respuestas basadas en el producto real.

### Riesgos durante la demo

y mitigaciones.

---

# MVP SCORECARD

Crear score de preparación 0–100 para:

```text
Web
Backend
SketchUp
Integration
Furniture
Hardware
Machining
Quotes
Design
Production
Installation
UX
Security
Reliability
Tests
Documentation
Demo readiness
```

IMPORTANTE:

No inventar precisión falsa.

Explicar qué significa cada score y qué evidencia lo sostiene.

---

# MVP GAP ANALYSIS

Crear tres niveles.

## MUST HAVE BEFORE DEMO

Sin esto no deberíamos presentar.

## SHOULD HAVE BEFORE DEMO

Mejora mucho la presentación pero podríamos sobrevivir sin ello.

## AFTER DEMO

Importante para producto, no para la demostración actual.

---

# CRITICAL PATH

Identificar la menor secuencia de trabajo que nos lleva de:

```text
estado actual
```

a:

```text
demo sólida
```

Debe existir una sección:

# FASTEST SAFE PATH TO DEMO

No simplemente “roadmap”.

Quiero saber específicamente cuál es el camino más corto SIN crear deuda peligrosa.

---

# PRIORIZACIÓN

Para cada tarea recomendar:

```text
Demo impact: 1-5
Customer impact: 1-5
Risk reduction: 1-5
Effort: XS/S/M/L/XL
Dependencies
Parallelizable: yes/no
```

Calcular una prioridad razonada.

No usar una fórmula ciegamente.

---

# QUICK WINS

Crear una sección:

# HIGH IMPACT / LOW EFFORT

para mejoras que puedan hacer que Granete se sienta mucho más profesional rápidamente.

Especial atención a:

- textos;
- feedback;
- empty states;
- loading;
- navegación;
- consistencia;
- validaciones;
- presentación;
- datos demo.

---

# DEUDA TÉCNICA

Separarla en:

```text
Dangerous debt
Productivity debt
Maintainability debt
Cosmetic debt
Acceptable MVP debt
```

No todo TODO necesita arreglarse antes de la demo.

---

# RIESGOS

Crear risk register:

| Risk | Probability | Impact | Severity | Evidence | Mitigation |
|---|---:|---:|---|---|---|

Incluir:

- producto;
- arquitectura;
- seguridad;
- integración;
- datos;
- demo;
- mantenimiento.

---

# DECISION LOG

Cuando identifiques decisiones arquitectónicas importantes todavía no resueltas, crear:

```text
Decision
Context
Options
Recommendation
Tradeoffs
MVP decision
Future decision
```

---

# ANTI-ALUCINACIÓN

REGLA CRÍTICA:

Nunca afirmar que algo existe porque parezca lógico.

Clasificar siempre la información como:

```text
CONFIRMED
INFERRED
PROPOSED
UNKNOWN
```

Para afirmaciones técnicas, incluir referencias relevantes a:

```text
file
function
class
route
endpoint
issue
PR
documentation
```

---

# ANTI-SUPERFICIALIDAD

No considerar una funcionalidad auditada únicamente porque encontraste:

- una página;
- un componente;
- un endpoint;
- una tabla;
- un issue.

Seguirla verticalmente:

```text
UI
↓
state
↓
API
↓
backend
↓
domain
↓
database
↓
integration
↓
tests
```

Cuando tenga integración SketchUp:

```text
↓
SketchUp
```

---

# COBERTURA DE AUDITORÍA

Mantener un archivo/matriz interna de cobertura.

Ejemplo:

```text
[ ] docs
[ ] web routes
[ ] components
[ ] services
[ ] backend modules
[ ] API routes
[ ] database
[ ] SketchUp
[ ] tests
[ ] CI
[ ] deployment
[ ] issues
[ ] PRs
[ ] security
[ ] UX
[ ] MVP
```

No finalizar mientras existan áreas relevantes sin revisar.

---

# EVIDENCE LEDGER

Mantener un registro estructurado:

```text
Finding ID
Claim
Evidence
File/Issue/PR
Confidence
Severity
Recommendation
```

Esto permitirá diferenciar conclusiones verificadas de inferencias.

---

# ENTREGABLE PRINCIPAL

Crear dentro del workspace de auditoría una documentación web profesional.

Propuesta:

```text
audit/
│
├── index.html
├── css/
│   ├── main.css
│   └── print.css
│
├── js/
│   ├── app.js
│   ├── search.js
│   └── filters.js
│
├── data/
│   ├── findings.js
│   ├── features.js
│   ├── screens.js
│   ├── endpoints.js
│   ├── risks.js
│   └── roadmap.js
│
└── assets/
```

Puedes proponer una estructura mejor si existe una razón sólida.

No introducir frameworks innecesarios.

Debe poder abrirse fácilmente y navegarse.

---

# REQUISITOS DEL HTML

La documentación debe tener como mínimo:

## Dashboard

Con:

- overall MVP readiness;
- demo readiness;
- cantidad de hallazgos;
- críticos;
- altos;
- medios;
- bajos;
- funcionalidades completas;
- parciales;
- faltantes;
- riesgos;
- cobertura.

---

## Navegación lateral

Secciones como:

```text
Executive Summary
Product
MVP
Demo
Architecture
Web
Backend
SketchUp
Integration
3D
Hardware
Machining
Production
UX/UI
Security
Database
API
Screens
Features
Permissions
Tests
Documentation
Issues
PRs
Risks
Technical Debt
Recommendations
Roadmap
User Manual
Demo Playbook
```

Adapta la estructura final según los hallazgos.

---

# FUNCIONES JAVASCRIPT DE LA DOCUMENTACIÓN

Implementar cuando sean útiles:

- búsqueda;
- filtros;
- severity filters;
- module filters;
- status filters;
- MVP filters;
- collapsible sections;
- tables;
- sorting;
- anchor links;
- persistent navigation;
- dark/light mode opcional;
- copiar rutas/referencias;
- links internos.

No agregar JavaScript decorativo innecesario.

---

# UX DE LA DOCUMENTACIÓN

Debe ser:

```text
profesional
limpia
densa pero legible
rápida
navegable
usable como herramienta diaria
```

Inspiración conceptual:

```text
Linear
GitHub
Stripe Docs
Vercel Docs
modern developer documentation
```

sin copiar estilos.

---

# CADA HALLAZGO

Debe utilizar una estructura consistente:

```text
ID
Title
Area
Severity
Status
Confidence
Evidence
Current behavior
Expected behavior
Problem
Business impact
Demo impact
Technical impact
Recommendation
Effort
Dependencies
Related files
Related issues
Related PRs
```

---

# EXECUTIVE SUMMARY

Debe contestar claramente:

1. ¿En qué estado real está Granete?
2. ¿Qué tan cerca estamos de una demo?
3. ¿Qué funciona realmente?
4. ¿Qué está engañosamente incompleto?
5. ¿Cuáles son los 10 mayores riesgos?
6. ¿Cuáles son los 10 mayores avances?
7. ¿Cuáles son los principales blockers?
8. ¿Qué debemos hacer primero?
9. ¿Qué NO debemos hacer todavía?
10. ¿Cuál es el camino más corto hacia una demo excelente?

---

# TOP 10

Generar:

```text
Top 10 strengths
Top 10 weaknesses
Top 10 demo risks
Top 10 technical risks
Top 10 UX problems
Top 10 quick wins
Top 10 MVP tasks
Top 10 future opportunities
```

---

# ROADMAP

Proponer fases.

No asignar fechas arbitrarias.

Usar dependencias.

Ejemplo conceptual:

```text
P0 — Demo blockers
P1 — Demo critical path
P2 — Demo polish
P3 — MVP stabilization
P4 — Post-demo product
P5 — Scale
```

---

# ISSUE PLAN

Después de la auditoría, generar una propuesta de backlog.

Para cada trabajo identificado:

```text
Suggested issue title
Context
Problem
Scope
Out of scope
Technical approach
Acceptance criteria
Definition of Done
Dependencies
Priority
Estimated complexity
```

NO crear automáticamente cientos de issues.

Primero elaborar el mapa recomendado.

Separar:

```text
existing issue
update existing issue
new issue
duplicate
obsolete
```

---

# NO MODIFICAR PRODUCTO DURANTE LA AUDITORÍA

Esta fase es principalmente analítica.

NO realizar grandes refactors o implementar funcionalidades silenciosamente mientras se está descubriendo el sistema.

Sí puedes crear los archivos propios del reporte/auditoría en el workspace.

Las modificaciones del producto deben convertirse primero en recomendaciones claramente justificadas.

---

# NO PERDER TIEMPO EN PERFECCIÓN IRRELEVANTE

Evitar desviar la auditoría hacia:

- micro-optimizaciones;
- naming cosmético;
- cobertura artificial;
- refactors estéticos;
- edge cases improbables;
- arquitecturas “enterprise” innecesarias.

Siempre preguntar implícitamente:

> ¿Esto ayuda a entregar un producto confiable y convincente para nuestros clientes objetivo?

---

# PERSPECTIVAS OBLIGATORIAS

Durante la auditoría debes alternar al menos estas perspectivas:

## Product Owner

¿La función aporta valor?

## Usuario

¿Puedo entenderla y usarla?

## Diseñador UX

¿El flujo es intuitivo?

## Ingeniero frontend

¿Está correctamente implementado?

## Ingeniero backend

¿Los contratos y dominio son correctos?

## Arquitecto

¿Las responsabilidades están bien separadas?

## QA

¿Qué puede fallar?

## Seguridad

¿Puede explotarse o provocar fuga de datos?

## Operaciones

¿Podemos mantenerlo?

## Comercial

¿Esto ayuda a vender Granete?

## Cliente de fábrica

¿Esto resuelve un problema real en mi operación?

---

# DEFINICIÓN DE COMPLETITUD DEL /goal

**NO DECLARES EL `/goal` COMPLETADO** hasta que puedas demostrar que se realizaron, como mínimo, todos estos puntos:

- [ ] inventario de documentación;
- [ ] auditoría de documentación;
- [ ] inventario de módulos;
- [ ] inventario de funcionalidades;
- [ ] inventario de pantallas;
- [ ] auditoría pantalla por pantalla;
- [ ] inventario de endpoints;
- [ ] auditoría backend;
- [ ] auditoría frontend;
- [ ] auditoría SketchUp;
- [ ] auditoría integración Web/Backend/SketchUp;
- [ ] auditoría modelo de dominio;
- [ ] auditoría base de datos;
- [ ] auditoría multitenancy;
- [ ] auditoría roles/permisos;
- [ ] auditoría seguridad;
- [ ] auditoría tests;
- [ ] auditoría CI/CD;
- [ ] auditoría UX/UI;
- [ ] auditoría 3D;
- [ ] auditoría herrajes;
- [ ] auditoría perforaciones;
- [ ] auditoría CNC/exportación;
- [ ] auditoría quotes;
- [ ] auditoría designs;
- [ ] auditoría furniture;
- [ ] auditoría production;
- [ ] auditoría installation;
- [ ] revisión de issues relevantes;
- [ ] revisión de PRs relevantes;
- [ ] contract drift analizado;
- [ ] documentación vs implementación contrastada;
- [ ] feature matrix completa;
- [ ] integration matrix completa;
- [ ] permission matrix completa;
- [ ] risk register;
- [ ] technical debt register;
- [ ] MVP gap analysis;
- [ ] demo gap analysis;
- [ ] demo blockers identificados;
- [ ] fastest safe path to demo;
- [ ] roadmap;
- [ ] issue plan;
- [ ] user manual;
- [ ] demo playbook;
- [ ] scorecard;
- [ ] reporte HTML completo;
- [ ] CSS completo;
- [ ] JavaScript funcional;
- [ ] navegación y búsqueda funcionando;
- [ ] executive summary;
- [ ] lista final de prioridades.

Si alguna sección no puede completarse por falta de evidencia:

NO omitirla.

Marcar:

```text
UNKNOWN / NEEDS VERIFICATION
```

y explicar exactamente qué falta comprobar.

---

# ESTRATEGIA DE EJECUCIÓN

Trabaja de forma sistemática.

## Fase 1 — Discovery

Reconstruye estructura del repositorio.

## Fase 2 — Documentation Map

Lee documentación y reconstruye intención del producto.

## Fase 3 — Product Map

Reconstruye módulos, dominio y funcionalidades.

## Fase 4 — Web

Audita rutas, páginas y componentes.

## Fase 5 — Backend

Audita dominio, API, datos y servicios.

## Fase 6 — SketchUp

Audita plugin e integración.

## Fase 7 — Cross-system

Sigue workflows completos verticalmente.

## Fase 8 — UX

Audita pantalla por pantalla y workflow por workflow.

## Fase 9 — Quality

Tests, seguridad, performance, CI/CD.

## Fase 10 — MVP

Determina qué falta para una demo.

## Fase 11 — Recommendations

Convierte hallazgos en acciones.

## Fase 12 — Documentation

Construye el portal HTML/CSS/JS.

## Fase 13 — Verification

Comprueba cobertura.

## Fase 14 — Final synthesis

Genera el diagnóstico ejecutivo y roadmap.

---

# TRABAJO ITERATIVO

La documentación HTML es un documento vivo durante la auditoría.

NO esperes necesariamente hasta el último momento para estructurar todo.

A medida que descubras información:

```text
discover
→ verify
→ classify
→ document
→ cross-reference
```

Esto reduce pérdidas de contexto.

---

# CHECKPOINTS

Después de cada área grande, registra internamente:

```text
AREA
coverage %
files inspected
features found
findings
unknowns
critical gaps
next dependencies
```

Continúa inmediatamente con la siguiente área.

Los checkpoints NO significan que el `/goal` fue alcanzado.

---

# SI EL REPOSITORIO ES MUY GRANDE

No reduzcas el alcance arbitrariamente.

Divide el trabajo.

Ejemplo:

```text
Web
  routes
  pages
  shared components
  services
  domain areas

Backend
  modules
  API
  persistence
  domain

SketchUp
  architecture
  API
  geometry
  sync
```

Mantén una matriz de cobertura y continúa hasta cerrar todas las áreas relevantes.

---

# REGLA DE PROFUNDIDAD

Cuando encuentres algo importante, no te quedes en:

```text
“hay un problema”
```

Determina:

```text
WHY
WHERE
HOW
IMPACT
DEPENDENCIES
FIX
PRIORITY
```

---

# REGLA DE CRÍTICA

No quiero una auditoría complaciente.

Si algo está mal:

dilo claramente.

Si algo está demasiado complejo:

dilo.

Si una funcionalidad no aporta valor:

dilo.

Si estamos construyendo demasiado para el MVP:

dilo.

Si algo está excelentemente resuelto:

también dilo.

Pero toda conclusión debe estar respaldada por evidencia.

---

# REGLA DE PRODUCTO

Granete debe ser evaluado como un PRODUCTO REAL que necesitamos vender, no como un proyecto académico.

La pregunta final no es:

> ¿El código parece razonable?

Es:

> ¿Una pequeña o mediana fábrica de muebles podría confiar en Granete para operar una parte importante de su negocio?

Y, para la fase actual:

> ¿Podemos demostrar suficiente valor, estabilidad y coherencia para convencer a nuestros dos primeros posibles clientes?

---

# RESULTADO FINAL

Cuando hayas completado la auditoría, presentar:

```text
1. Executive Summary
2. Current Product State
3. Demo Readiness
4. MVP Readiness
5. Top Critical Findings
6. Fastest Safe Path to Demo
7. Recommended Immediate Tasks
8. Deferred Work
9. Major Architecture Recommendations
10. Major UX Recommendations
11. Major Integration Recommendations
12. Risk Summary
13. Documentation location
14. Coverage report
15. Remaining UNKNOWN items
```

Y responder explícitamente:

# ¿ESTAMOS LISTOS PARA HACER LA DEMO?

Usar únicamente:

```text
YES
YES, WITH CONDITIONS
NO
```

seguido de la evidencia.

---

# CRITERIO FINAL

El trabajo no está terminado porque:

- se leyó mucha documentación;
- se revisaron muchos archivos;
- se generó un reporte largo;
- se encontraron muchos problemas.

El trabajo está terminado cuando tenemos suficiente información estructurada para responder con confianza:

```text
WHAT WE HAVE
WHAT WORKS
WHAT DOESN'T
WHAT IS MISSING
WHAT MATTERS
WHAT DOESN'T MATTER YET
WHAT TO FIX
WHY TO FIX IT
IN WHAT ORDER
HOW IT AFFECTS THE DEMO
HOW CLOSE WE ARE TO MVP
HOW GRANETE SHOULD EVOLVE
```

La documentación resultante debe ser lo suficientemente buena para que tanto un humano como un agente de programación futuro puedan usarla para comprender Granete, tomar decisiones y ejecutar tareas sin depender de suposiciones.

Ese es el `/goal`.

**No lo marques como cumplido antes de satisfacer su Definition of Done.**