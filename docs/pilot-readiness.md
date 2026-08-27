# Pilot Readiness — gate de coexistencia multi-org

> **Definition of Done:** Taller A y Taller B pueden coexistir en la misma
> instalación y un regression de aislamiento hace fallar el gate antes de
> desplegar.

Fuente canónica de la suite `backend-go/tests/pilotreadiness/` y del comando
`scripts/pilot-gate.sh`. Extiende ADR-0005 (multi-organization tenancy) y
`docs/verification.md`.

---

## 1. Qué demuestra

Contra **PostgreSQL real** (base efímera `muebles_pilot_readiness`, migraciones
completas 000001→actual) y **a través de las APIs HTTP reales** — sin mocks, sin
stubStore — la suite prueba que dos organizaciones independientes (los fixtures
conceptuales `pilot-a` y `pilot-b`, sin datos reales) pueden usar Granete sin
fuga de datos, y que las operaciones reales básicas siguen correctas.

El bootstrap replica el onboarding documentado de pilotos
(`docs/pilot-onboarding.md`): platform admin crea cada org con catálogo base
clonado, entra por sesión de soporte auditada, invita al owner, el owner acepta
y carga datos de taller por las APIs públicas (settings, cliente, tablero,
proyecto, media/foto, evento de ciclo de vida, problema de calidad). El acceso
directo a storage/SQL se limita a bootstrap sin API pública (platform admin,
seed del catálogo base) y assertions justificadas (columnas de ownership,
time-travel de expiración de soporte).

## 2. Cómo correrla

```bash
# Forma obligatoria antes de deploy (skips prohibidos — sin DB falla):
scripts/pilot-gate.sh                      # usa DATABASE_URL o docker compose dev (localhost:5445)
scripts/pilot-gate.sh --dsn postgres://…   # DSN explícito (staging)
scripts/pilot-gate.sh --fresh-container    # postgres 16 efímero vía docker, cero setup local

# Forma developer (dentro del suite normal de backend; salta si no hay DB):
cd backend-go && go test ./tests/pilotreadiness/ -v
```

- La base de test es efímera (DROP/CREATE por corrida): nunca toca datos
  productivos ni la dev `muebles`.
- La pata de backup/restore usa `pg_dump`/`pg_restore`; sin
  `postgresql-client` en PATH se salta **con aviso explícito** (instalalo para
  el gate completo). Un gap de versión cliente/servidor se tolera como warning
  ambiental — las assertions de integridad siguen corriendo.
- CI: el job `backend-go` instala `postgresql-client` y corre `go test -v ./...`
  con `DATABASE_URL` apuntando al service container, así que la suite (gate
  incluido) corre en cada PR a main.
- `./init.sh` **no** fuerza el gate: añadirle docker sería una dependencia nueva
  al harness. La suite igual corre dentro de su `go test ./...` cuando hay DB
  alcanzable; el comando obligatorio pre-deploy es `scripts/pilot-gate.sh`.

## 3. Cobertura (requisito → test)

| Requisito | Test |
|---|---|
| Crear Organization A y B + onboarding completo | `TestPilotReadiness_FixtureSanity` (bootstrap del paquete) |
| Listar recursos nunca muestra la otra org | `TestPilotReadiness_CrossOrgIsolation` (ambas direcciones) |
| GET por ID ajeno falla cerrado | idem (customers, projects, materials, events, photos) |
| UPDATE por ID ajeno falla y no deja rastro | idem (+ verificación de fila intacta) |
| DELETE por ID ajeno falla y la fila sobrevive | idem |
| Media ajena no descargable | idem (`GET /api/media/{name}` → 404) |
| 404 indistinguible entre "ajeno" y "inexistente" | idem (`assertUniform404`, incl. rutas `mfgOnly`) |
| Catálogo ajeno no se mezcla | idem + `TestPilotReadiness_CatalogCloneIndependence` |
| Workshop settings ajenos no aparecen | idem (moneda propia; PUT no contamina) |
| Membresía A no obtiene B (select-org/login) | `TestPilotReadiness_MembershipSingleOrg` |
| Membresías A+B exigen contexto explícito | `TestPilotReadiness_MembershipExplicitContext` |
| Roles efectivos dependen de la membresía activa | idem (admin en A ≠ vendedor en B) |
| Desactivar membresía corta acceso (token vivo) | `TestPilotReadiness_MembershipDeactivationCutsAccess` |
| `roles[]` unión de capabilities | `TestPilotReadiness_MembershipRoleUnion` |
| Role change aplicado/revalidado en vivo | `TestPilotReadiness_RoleChangeRevalidatesTokens` |
| Platform admin administra orgs, sin datos de negocio | `TestPilotReadiness_PlatformAdminNoBusinessAccess` |
| Support session A no alcanza B + auditoría start/end | `TestPilotReadiness_SupportSessionScopedAndAudited` |
| Logout/expiración termina el contexto | idem + `TestPilotReadiness_SupportSessionExpiry` |
| Clonar catálogo para A y B; editar A; B intacto | `TestPilotReadiness_CatalogCloneIndependence` |
| Recursos nuevos reciben org del caller | `TestPilotReadiness_NewResourcesGetCallerOrg` |
| Payload público no elige `organization_id` | idem + `TestPilotReadiness_ProjectOwnershipCannotTargetForeignOrg` |
| Backup/restore conserva ownership e integridad | `TestPilotReadiness_BackupRestore` (pg_dump→pg_restore a base scratch + round-trip tar.gz de media) |

## 4. Regresiones reales que ya encontró (evidencia del valor del gate)

Al construir la suite (F179) detectó y quedaron cerrados con fixes:

1. `SeedCatalog` roto contra el esquema post-000083/000088 (INSERTs sin
   `organization_id`, `ON CONFLICT (code)` inexistente) + `project_templates.id`
   UUID recibiendo un slug de texto — el seed de una instalación fresca fallaba.
2. `jsonbRemapKey` convertía arrays JSONB vacíos en NULL → `CloneCatalog`
   explotaba con cualquier catálogo real (`agregados='[]'`).
3. Las TEMP TABLEs de `CloneCatalog` vivían por sesión → el segundo clone en una
   conexión pooled del servidor caía con "relation already exists".
4. `POST /api/projects/{id}/events` no verificaba la obra en scope → una org
   podía appendear eventos al lifecycle log de una obra ajena.
5. El audit de `support_session_ended` se guardaba sin organización → invisible
   en el visor de audit del taller.
6. `DELETE /api/catalog/materials/{id}` ajeno devolvía 500 en vez de 404.

## 5. Política y mantenimiento

- **404, nunca 403 que confirme existencia** (ADR-0005 §1). Cualquier respuesta
  cross-org debe ser byte-a-byte indistinguishable de "no existe" — usa
  `assertUniform404` como patrón.
- **Sin mocks en el core de aislamiento**: la suite arranca el router real
  (`api.RegisterRoutes` + `httptest`) sobre `storage.PostgresStore` con
  migraciones completas.
- **Skips prohibidos en gate mode** (`PILOT_READINESS_GATE=1`): sin DB el gate
  falla. Un verde falso no puede habilitar un deploy.
- Al agregar una **tabla/consulta con scope de organización**, agregá el caso
  correspondiente a `crossorg_test.go` (list + GET + UPDATE + DELETE + uniforme
  404). El gate existe para que el próximo refactor de scoping no abra una fuga.
- Media restore productiva (volumen docker + chown) vive en `scripts/restore.sh`
  y se ejercita según `docs/deployment.md` §6; la suite valida el invariante que
  importa para pilotos (ningún restore mezcla ni reasigna organizaciones).
