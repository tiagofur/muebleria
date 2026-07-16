package domain

import "testing"

func TestRoleSeesAllOwners(t *testing.T) {
	t.Parallel()
	if RoleSeesAllOwners(RoleVendedor) {
		t.Fatal("vendedor must be scoped")
	}
	for _, role := range []UserRole{RoleAdmin, RoleUser, RoleDisenador, RoleCarpintero} {
		if !RoleSeesAllOwners(role) {
			t.Fatalf("%s should see all owners", role)
		}
	}
}

func TestResolveOwnerOnCreate(t *testing.T) {
	t.Parallel()
	if got := ResolveOwnerOnCreate("me", RoleVendedor, "other"); got != "me" {
		t.Fatalf("vendedor forced self: got %q", got)
	}
	if got := ResolveOwnerOnCreate("admin", RoleAdmin, "v1"); got != "v1" {
		t.Fatalf("admin can assign: got %q", got)
	}
	if got := ResolveOwnerOnCreate("admin", RoleAdmin, ""); got != "admin" {
		t.Fatalf("admin defaults to self: got %q", got)
	}
}

func TestResolveOwnerOnUpdate(t *testing.T) {
	t.Parallel()
	if got := ResolveOwnerOnUpdate(RoleVendedor, "me", "other"); got != "me" {
		t.Fatalf("vendedor cannot reassign: got %q", got)
	}
	if got := ResolveOwnerOnUpdate(RoleAdmin, "old", "new"); got != "new" {
		t.Fatalf("admin reassign: got %q", got)
	}
	if got := ResolveOwnerOnUpdate(RoleAdmin, "old", ""); got != "old" {
		t.Fatalf("admin empty keeps existing: got %q", got)
	}
}

func TestCanAccessOwnedResource(t *testing.T) {
	t.Parallel()
	if !CanAccessOwnedResource("a", RoleAdmin, "b") {
		t.Fatal("admin sees all")
	}
	if !CanAccessOwnedResource("a", RoleVendedor, "a") {
		t.Fatal("owner access")
	}
	if CanAccessOwnedResource("a", RoleVendedor, "b") {
		t.Fatal("vendedor isolation")
	}
}
