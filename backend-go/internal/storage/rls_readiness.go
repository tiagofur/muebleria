package storage

import (
	"context"
	"fmt"
)

// VerifyRLSReadiness fails startup/gates when runtime credentials can bypass
// RLS or the database schema drifted beyond the versioned policy inventory.
func (s *PostgresStore) VerifyRLSReadiness(ctx context.Context) error {
	var currentUser, sessionUser string
	var superuser, bypassRLS, createRole, createDB bool
	if err := s.Pool.QueryRow(ctx, `
		SELECT current_user, session_user, r.rolsuper, r.rolbypassrls,
		       r.rolcreaterole, r.rolcreatedb
		FROM pg_roles r
		WHERE r.rolname = current_user
	`).Scan(&currentUser, &sessionUser, &superuser, &bypassRLS, &createRole, &createDB); err != nil {
		return fmt.Errorf("read runtime role attributes: %w", err)
	}
	if currentUser != sessionUser {
		return fmt.Errorf("runtime role must connect directly, got session_user=%s current_user=%s", sessionUser, currentUser)
	}
	if superuser || bypassRLS || createRole || createDB {
		return fmt.Errorf("runtime role %s has unsafe attributes", currentUser)
	}

	var ownedProtected int
	if err := s.Pool.QueryRow(ctx, `
		SELECT count(*)
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		JOIN rls_policy_inventory i ON i.table_name = c.relname
		WHERE n.nspname = 'public'
		  AND c.relkind = 'r'
		  AND i.classification <> 'platform-global'
		  AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
	`).Scan(&ownedProtected); err != nil {
		return fmt.Errorf("check protected table ownership: %w", err)
	}
	if ownedProtected != 0 {
		return fmt.Errorf("runtime role owns %d protected tables", ownedProtected)
	}

	var missingInventory int
	if err := s.Pool.QueryRow(ctx, `
		SELECT count(*)
		FROM information_schema.tables t
		LEFT JOIN rls_policy_inventory i ON i.table_name = t.table_name
		WHERE t.table_schema = 'public'
		  AND t.table_type = 'BASE TABLE'
		  AND i.table_name IS NULL
	`).Scan(&missingInventory); err != nil {
		return fmt.Errorf("check policy inventory coverage: %w", err)
	}
	if missingInventory != 0 {
		return fmt.Errorf("RLS inventory missing %d public tables", missingInventory)
	}

	var unsafePolicies []string
	if err := s.Pool.QueryRow(ctx, `
		SELECT COALESCE(array_agg(i.table_name ORDER BY i.table_name), ARRAY[]::text[])
		FROM rls_policy_inventory i
		JOIN pg_class c ON c.relname = i.table_name
		JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
		WHERE i.classification <> 'platform-global'
		  AND (
		      NOT c.relrowsecurity
		      OR NOT c.relforcerowsecurity
		      OR NOT EXISTS (
		          SELECT 1 FROM pg_policies p
		          WHERE p.schemaname = 'public' AND p.tablename = i.table_name
		      )
		  )
	`).Scan(&unsafePolicies); err != nil {
		return fmt.Errorf("check RLS policies: %w", err)
	}
	if len(unsafePolicies) != 0 {
		return fmt.Errorf("protected tables lack FORCE RLS or policies: %v", unsafePolicies)
	}

	var missingOrganizationIndexes []string
	if err := s.Pool.QueryRow(ctx, `
		SELECT COALESCE(array_agg(i.table_name ORDER BY i.table_name), ARRAY[]::text[])
		FROM rls_policy_inventory i
		JOIN information_schema.columns col
		  ON col.table_schema = 'public'
		 AND col.table_name = i.table_name
		 AND col.column_name = 'organization_id'
		WHERE i.classification <> 'platform-global'
		  AND NOT EXISTS (
		      SELECT 1
		      FROM pg_index x
		      JOIN pg_class c ON c.oid = x.indrelid
		      JOIN pg_namespace n ON n.oid = c.relnamespace
		      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = x.indkey[0]
		      WHERE n.nspname = 'public'
		        AND c.relname = i.table_name
		        AND x.indisvalid
		        AND a.attname = 'organization_id'
		  )
	`).Scan(&missingOrganizationIndexes); err != nil {
		return fmt.Errorf("check organization indexes: %w", err)
	}
	if len(missingOrganizationIndexes) != 0 {
		return fmt.Errorf("protected tables lack organization-first indexes: %v", missingOrganizationIndexes)
	}
	return nil
}
