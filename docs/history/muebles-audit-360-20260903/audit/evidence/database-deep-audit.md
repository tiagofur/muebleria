# Base de datos — esquema final y semántica crítica



Main `316df57c7c3c9d5470b5a3f22b39fffeacfd7676`. Lectura exclusiva SELECT de metadatos en servidor dedicado; `default_transaction_read_only=on`. No consultas de datos de negocio, mutaciones, tests ni pruebas de seguridad.



## Medición

{"tablesObserved": 75, "applicationAndControlTables": 74, "historicalCreateTableNames": 76, "columns": 842, "constraints": 435, "indexes": 279, "enabledAndForcedRls": 71, "triggers": 27, "latestMigration": 116}



76 tablas históricas no son el esquema actual: 75 observadas, 74 sin el ledger de migración. 71 tienen RLS ENABLE + FORCE. Estas cifras no constituyen porcentaje de readiness.



## Inventario histórico reconciliado con esquema final

76 nombres CREATE históricos no equivalen a 76 tablas actuales. Final observado75 incluyendo schema_migrations;74 tablas de aplicación/control. Se retiraron structure_board_parts y user_sectors. Migración 116 aplicada.



Evidencia: `backend-go/db/migration/000018_drop_structure_board_parts.up.sql:2`, `backend-go/db/migration/000097_membership_sectors.up.sql:62`, `evidence/database-schema-controls.json`



## Ownership y aislamiento declarados

71 de 75 tablas tienen ENABLE+FORCE RLS. Excepciones users/organizations/rls_policy_inventory/schema_migrations son explícitas; ausencia no implica vulnerabilidad. Metadatos granete_app sin superuser ni BYPASSRLS. Policies y 27 triggers completos adjuntos. Tenant direct y explicitly-shared siguen inventario de políticas.

Esta lectura como postgres inspecciona configuración, no prueba denegación bajo runtime. Usar proofs GateA del informe raíz para ese claim.

Evidencia: `backend-go/db/migration/000094_tenant_rls.up.sql:284-327`, `evidence/database-schema-metadata.json`, `evidence/database-index-metadata.json`



## Project operativo legacy no equivale a Digital Thread normalizado

projects tiene 39 columnas y múltiples JSONB: revisions/approvals/release/part_instances/module_units/installation/quality/costing. Sus objetos internos no tienen FK por identificador JSON. project_items y snapshot_prices sí son tablas; quote_snapshots tiene UNIQUE(project_id):una foto de precio, no historial multirrevisión.

No llamar a projects.design_revisions JSON la misma autoridad que design_revisions tabla. Relaciona OP-01/OP-02 existentes; no duplica hallazgos.

Evidencia: `backend-go/internal/storage/projects.go:756`, `backend-go/internal/storage/projects.go:1157-1214`, `evidence/database-schema-metadata.json`



## Identidad física y enlace comercial normalizados

UUID estable por unidad con provenance opcional SET NULL al borrar catálogo. Link protege pertenencia con FK compuesta(project_id), índice único parcial para instancia current y trigger de ownership. Lifecycle check active/removed/cancelled no reemplaza comandos de transición.

Configuración/modelo no demuestra que UI guest produzca materialización normalizada.

Evidencia: `backend-go/db/migration/000111_project_furniture_instances.up.sql:19-77`, `backend-go/db/migration/000112_quote_line_furniture_instances.up.sql:23-142`



## Design mutable separado de revisión publicada

Working item pertenece al mismo project que design e instancia mediante FK compuesta. Unique(design_id,furniture_instance_id) evita repetición de unidad en draft. Revision number único por design y parent ligado al mismo design. JSONB parameters/material_choices/transform preserva contrato flexible, validación semántica sigue dominio.



Evidencia: `backend-go/db/migration/000113_design_and_design_revisions.up.sql:19-30`, `backend-go/db/migration/000113_design_and_design_revisions.up.sql:300-350`, `evidence/database-schema-metadata.json`



## Artefactos publish no son evidencia máquina

Esquema distingue staging session y artefacto de revisión, constraints de kind/status/tamaño y claves de identidad; storage copia artefactos al publicar. Metadatos/checksum/versionado no certifican importación por CNC.



Evidencia: `backend-go/internal/storage/design_publish.go:448-453`, `backend-go/internal/storage/design_publish.go:587-618`, `backend-go/db/migration/000114_design_publish_artifacts.up.sql`, `evidence/database-schema-metadata.json`



## QuoteRevision tiene backstop lifecycle real

UNIQUE(project_id,revision_number), FK compuestas para revisión/instancia del mismo project. Trigger 116 impone draft→published → accepted/superseded; accepted→superseded; superseded terminal. Items inmutables y contenido publicado protegido por trigger. No confundir quote_revisions con quote_snapshots legacy.

Comentario de migration sobre same-status no es prueba: cuerpo valida transiciones cuando status cambia; no usar comentario para declarar que toda actualización same-status es rechazada.

Evidencia: `backend-go/db/migration/000115_quote_revisions.up.sql:132-192`, `backend-go/db/migration/000116_quote_revision_lifecycle.up.sql:15-60`



## Stock: ledger y saldo atómicos por comando

Movimiento bloquea saldo FOR UPDATE, rechaza negativo y escribe saldo+ledger en misma transacción. Picking vive en upsert separado. Esquema no tiene FK material_id polimórfico ni CHECK quantity >= 0 en saldo; invariantes dependen también de command. Esto no demuestra saldo negativo real.

Vincular defecto existente picking debit/status; no declarar atomicidad delworkflow porque el comando individual es atómico.

Evidencia: `backend-go/internal/storage/stock.go:98-176`, `backend-go/internal/storage/projectPicking.go:42-52`, `evidence/database-schema-metadata.json`



## Recepción compra reutiliza transacción de stock

Status con CHECK, número único por organización, quantity>0, supplier SET NULL e items CASCADE. Recepción bloquea PO y reutiliza recordStockMovementTx antes del commit. received_quantity y unit_cost no tienen CHECKs propios enmetadata; validez requiere camino de comando.

No ejecutado escenario receipt duplicado/concurrente en esta subtarea; gates previos no extendidos automáticamente.

Evidencia: `backend-go/internal/storage/purchaseOrders.go:278`, `backend-go/internal/storage/purchaseOrders.go:358-377`, `evidence/database-schema-metadata.json`



## Nullable/CASCADE interpretados por semántica

customer→project RESTRICT; proyecto→items/events/etc CASCADE; autor/provenance SET NULL preserva filas. project_items.project_id esnullable; production_activities item_id/operator_id/machine_id texto no FK. Son elecciones o restricciones ausentes observadas, no huérfanos confirmados.

Un DELETE project puede encontrar triggers inmutables aguas abajo pese a CASCADE: no afirmar borrado exitoso sin prueba. No purgar por inferencia.

Evidencia: `evidence/database-schema-metadata.json`



## Índices: inventario no es plan de consulta

279 índices totales. Análisis estructural de prefijo FK registra candidatos sin índice líder; ej. project_items(project_id) no queda cubierto como prefijo por unique(id,project_id). No EXPLAIN/ANALYZE ni volúmenes productivos consultados.

Priorizar consulta por proyecto yjoins con volumen real antes de  añadir índices; índices redundantes encarecen escritura.

Evidencia: `evidence/database-index-metadata.json`, `evidence/database-schema-metadata.json`



## Cobertura y límites

Inventario final de todas las columnas, nulabilidad, defaults, constraints, índices, policies y triggers: `data/database-deep-audit.json` y capturas originales en `evidence/database-*-metadata.json` / `database-schema-controls.json`.

No se afirma ausencia de huérfanos, corrupción, bypass o regresión. La semántica de 11 clusters no sustituye tests de cada entidad. No se añadieron hallazgos duplicados a picking/Project PUT; se enlazan los existentes.
