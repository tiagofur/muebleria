# Sesión actual

- **Feature en curso:** ninguna
- **Último cierre:** F027 — material_default_edge_band (`done`, tests verdes TS+Go)
- **Nota ops:** aplicar migración `backend-go/db/migration/000004_material_default_edge.up.sql` en Postgres

## Stack vivo

- Postgres Docker `muebles-postgres` :5445
- API Go :8080
- Auth → `APIWorkspaceRepository`; guest → localStorage
