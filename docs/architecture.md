# Arquitectura — Contrato de calidad

> Los agentes revisores evalúan código contra este archivo.
> Si un criterio no está aquí, no es un requisito de arquitectura.
>
> **Actualizado 2026-08-21:** este contrato conserva la arquitectura original de
> paquetes y añade ownership por bounded context para el producto operativo actual.

---

## 1. Principios

1. **Dominio primero.** Los cálculos (BOM, costos, validaciones, routing, estados
   derivados) viven en `packages/domain` o en el backend autoritativo cuando el
   dato requiere seguridad/concurrencia.
2. **UI no calcula dominio.** React presenta, compone y dispara acciones.
3. **Adapters serializan; no inventan reglas.** Excel/DXF/PDF/QR convierten DTOs ya
   resueltos.
4. **Storage es un puerto.** Shells y UI consumen repositories/adapters, no detalles
   físicos de persistencia.
5. **Apps son shells delgados.** Web/Desktop/Mobile cablean plataforma y navegación.
6. **Una autoridad por concepto.** Evitar duplicar máquinas de estado o reglas sin
   contrato de paridad.
7. **Eventos para hechos.** Hitos operativos se registran de forma auditable; los
   dashboards derivan, no fabrican verdad.
8. **Revisión explícita.** Producción siempre debe poder responder qué revisión/BOM
   está ejecutando.

---

## 2. Estructura de paquetes

```text
packages/
  domain/     → tipos, motor de resolución, cálculos, validaciones
  ui/         → componentes React compartidos
  excel/      → Excel/PDF/DXF/labels y otros outputs
  storage/    → puertos/repositorios/mappers
apps/
  web/        → shell React + Vite
  desktop/    → shell Electron
  mobile/     → shell React Native + Expo
backend-go/   → API, auth, persistencia relacional, reglas servidor-autoritativas
```

Los nombres de paquete no tienen que coincidir 1:1 con los bounded contexts; el
ownership conceptual sí debe ser explícito.

---

## 3. Bounded contexts del producto

### Sales

Propietario de:

- customer/prospect;
- opportunity/quote;
- commercial status;
- pricing/snapshot;
- ownership comercial.

No es propietario de execution física.

### Projects

Propietario transversal de:

- Project/Job;
- lifecycle events;
- versions/revisions;
- approvals;
- change orders;
- archivos/timeline;
- stage derivado.

### Survey

Propietario de:

- levantamientos;
- espacios/medidas de campo;
- evidencias/fotos;
- verificación de medidas.

### Engineering

Propietario de:

- estructuras/componentes/agregados;
- BOM;
- production revision/release;
- machining/perforaciones;
- documentación técnica;
- cut-plan inputs.

### Procurement

Propietario de:

- suppliers;
- material requirements;
- purchase orders;
- receipts;
- need-by dates.

### Inventory

Propietario de:

- stock ledger;
- on-hand;
- reservations;
- available/incoming;
- allocations/movements.

### Production

Propietario de:

- work queues;
- piece execution antes de Armado;
- module/unit execution desde Armado;
- station events;
- QC/rework;
- work centers/actividad/tiempos cuando aplique.

### Logistics

Propietario de:

- packages;
- staging;
- loads;
- shipments.

### Installation

Propietario de:

- installation jobs/visits;
- crews;
- field issues;
- punch list;
- sign-off.

### Costing

Propietario de:

- cost baseline;
- actual material/labor/other costs;
- variance;
- job profitability.

### After Sales

Propietario de:

- warranty tickets;
- service visits;
- warranty refabrication linkage.

---

## 4. Flujo de datos principal

```text
Sales / Quote
      ↓
Project + Design Revision
      ↓
Resolved BOM
      ↓
Approval + Production Release
      ↓
 ┌───────────────┬─────────────────┐
 ↓               ↓                 ↓
Requirements     Production Docs   Cost Baseline
 ↓               ↓
Reservations     Part Execution
 ↓               ↓
PO/Receipts      Unit Execution
 ↓               ↓
Materials Ready  Logistics
                 ↓
              Installation
                 ↓
               Closeout
                 ↓
               Warranty
```

---

## 5. Regla física de producción

Fuente detallada: `docs/production-flow-v2.md`.

### Antes de Armado

Corte, CNC y Enchape trabajan **piezas físicas**.

### Desde Armado

Armado, QC, Empaque, Carga e Instalación trabajan **muebles/unidades/bultos**.

No implementar una feature nueva que profundice CNC/enchape usando únicamente
`ProjectItem.floorStatus` como verdad física sin considerar esta migración.

---

## 6. Reglas de boundary

| Paquete | Puede importar | No puede importar |
|---|---|---|
| `domain` | stdlib TS y módulos internos domain | react, electron, fs, xlsx |
| `ui` | domain, react | electron, fs, xlsx; fórmulas de negocio |
| `excel` | libs de serialización + DTOs/domain types | react, electron; lógica de workflow |
| `storage` | IO permitido + domain types | react, electron, xlsx; decisiones UI |
| `apps/*` | paquetes anteriores | lógica de dominio nueva inline |
| backend | domain/server modules propios | decisiones de presentación |

---

## 7. Autoridad TS vs Go

El proyecto ya tiene lógica en TypeScript y Go. La duplicación indiscriminada se vuelve
costosa a medida que crece el dominio.

### Server authoritative

Preferentemente Go/backend para:

- auth/permisos efectivos;
- lifecycle mutations compartidas;
- stock/reservations/PO/receipts;
- auditoría;
- concurrencia;
- execution física multiusuario;
- job costing persistente;
- gates que deben ser imposibles de saltar desde otro cliente.

### TypeScript domain authoritative/interactivo

Preferentemente TS para:

- editor y resolución interactiva;
- geometría/layout;
- BOM preview;
- optimización/cut plan;
- machining calculations puras;
- preparación de DTOs/export;
- validaciones puras reutilizables.

### Lógica duplicada

Cuando una regla deba existir en ambos lados:

> usar **contract fixtures** compartidos y fallar CI si TS y Go divergen.

No declarar “paridad” sólo por inspección manual.

---

## 8. Eventos y estados

### Hechos

Persistir eventos append-only para acciones relevantes.

### Estados derivados

`ProjectStage`, KPIs y summaries deben derivarse de fuentes reales cuando sea posible.

### No mezclar

Mantener dimensiones diferentes separadas:

- Commercial status;
- Project stage;
- Part execution;
- Module/unit execution;
- Quality/installation sub-workflows.

No crear un enum “super status” que intente representar todo.

---

## 9. Data Truth Contract

Todo dato agregado debe ser una de:

```text
actual
estimated
forecast
proxy
```

La capa que calcula la métrica debe conservar esa semántica o devolver `null` cuando no
pueda afirmar un valor real.

### Prohibido

- multiplicar módulos por una constante y exponer el resultado como piezas reales;
- usar `createdAt` como fecha de anticipo/almacén sin etiquetarlo;
- ocultar que un consumo es estimado.

---

## 10. Exports

Los adapters de salida sólo serializan una revisión coherente.

Todo output físico relevante debe poder identificar, directa o indirectamente:

- project/job;
- production revision;
- BOM fingerprint o equivalente;
- pieza/unidad cuando corresponda.

Un pack no puede mezclar documentos de revisiones distintas.

---

## 11. Seguridad

### DTOs públicos

Nunca serializar directamente entidades internas con secretos por comodidad. Login,
refresh y endpoints de usuario deben usar DTOs explícitos sin hashes/credenciales.

### Tokens

Evitar tokens de sesión de larga vida en query strings. Media autenticada debe migrar a
URLs firmadas, tokens específicos de media o fetch autenticado cuando sea viable.

### RBAC

Aplicar least privilege. Ingeniería autoriza/libera; Producción registra hechos físicos;
supervisores corrigen mediante override auditado.

---

## 12. Arquitectura Cliente-Servidor implementada

El sistema soporta arquitectura multiusuario Go + Postgres con:

1. `APIWorkspaceRepository` / adapters HTTP;
2. backend Go;
3. Postgres relacional;
4. JWT y CORS allowlist;
5. storage de entidades operativas en evolución.

La frase histórica “Etapa 2 futura” deja de usarse: el backend es parte activa de la
arquitectura actual.

---

## 13. Errores de dominio

Las funciones puras lanzan `DomainError`/subtipos accionables o devuelven resultados
estructurados cuando el flujo necesita manejar múltiples issues.

UI muestra mensaje localizado; nunca stack traces.

Errores operacionales persistentes (QC, shortage, field issue, stale revision) no deben
existir sólo como excepciones/toasts: se convierten en entidades/trabajo cuando aplique.

---

## 14. Fuentes ejecutables

- rutas: `apps/web/src/routes.ts` (`NAV_PATHS`);
- RBAC: `packages/domain/src/rbac.ts` + enforcement backend;
- lógica de dominio: `packages/domain`;
- almacenamiento server: `backend-go`;
- UX: `docs/design.md` + `docs/operational-ux.md`;
- producto: `docs/prd-v2.md`;
- plan: `docs/operational-core-v1.md`.

---

## 15. Qué NO hacer

- no calcular costos/requirements/workflow en React;
- no hardcodear materiales en módulos cuando deben ser roles/opciones;
- no mezclar herrajes en outputs de corte;
- no escribir workspace parcialmente;
- no añadir dependencias a `domain` sin necesidad;
- no crear un nuevo status global para resolver una inconsistencia de ownership;
- no inventar KPIs;
- no ejecutar producción contra una revisión stale sin override explícito;
- no duplicar reglas TS/Go sin fixtures de paridad;
- no construir un ERP financiero completo ni CAD libre dentro de este core.
