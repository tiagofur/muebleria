package domain

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// TestUserPasswordHashNeverSerialized is a non-regression test for issue #4.
// PasswordHash has json:"-" and must NEVER appear in any JSON response, so the
// login (and any other endpoint returning a user) cannot leak the hash.
func TestUserPasswordHashNeverSerialized(t *testing.T) {
	u := User{
		ID:           "u-1",
		Email:        "admin@test.com",
		PasswordHash: "SUPER-SECRET-HASH-MUST-NOT-LEAK",
		Name:         "Admin",
		Role:         RoleAdmin,
		Active:       true,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	out, err := json.Marshal(u)
	if err != nil {
		t.Fatalf("marshal user: %v", err)
	}
	body := string(out)

	if strings.Contains(body, "SUPER-SECRET-HASH-MUST-NOT-LEAK") {
		t.Errorf("password hash leaked into JSON: %s", body)
	}
	if strings.Contains(strings.ToLower(body), "password") {
		t.Errorf("any 'password' field appeared in JSON: %s", body)
	}

	// Sanity: the fields that SHOULD be present are still there.
	if !strings.Contains(body, `"email":"admin@test.com"`) {
		t.Errorf("expected email in JSON, got: %s", body)
	}
	if !strings.Contains(body, `"role":"admin"`) {
		t.Errorf("expected role in JSON, got: %s", body)
	}

	// Also verify the field round-trips through the struct internally (it's
	// only hidden from JSON, not from Go code that legitimately uses it).
	if u.PasswordHash == "" {
		t.Errorf("PasswordHash should be readable in Go, got empty")
	}
}
