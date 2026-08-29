package domain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

type teamCapabilityContract struct {
	All                []string                       `json:"all"`
	ByOrganizationType map[string]map[string][]string `json:"byOrganizationType"`
}

func TestTeamCapabilitiesMatchContract(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "roles.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		TeamCapabilities teamCapabilityContract `json:"teamCapabilities"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(teamCapabilityStrings(teamCapabilityOrder), fixture.TeamCapabilities.All) {
		t.Fatalf("team capability vocabulary diverges: got=%v want=%v", teamCapabilityStrings(teamCapabilityOrder), fixture.TeamCapabilities.All)
	}
	for orgType, byRole := range fixture.TeamCapabilities.ByOrganizationType {
		for role, want := range byRole {
			got := teamCapabilityStrings(TeamCapabilitiesForRoles([]UserRole{UserRole(role)}, OrganizationType(orgType)))
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("%s/%s: got=%v want=%v", orgType, role, got, want)
			}
		}
	}
}

func TestTeamCapabilitiesUnionAndFailClosed(t *testing.T) {
	got := TeamCapabilitiesForRoles([]UserRole{RoleGerenteVentas, RoleGerenteProduccion}, OrganizationTypeFactory)
	want := []TeamCapability{TeamCapabilityView, TeamCapabilityInviteSales, TeamCapabilityInviteProduction, TeamCapabilityManageSales, TeamCapabilityManageProduction, TeamCapabilityManageSectors}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("union got=%v want=%v", got, want)
	}
	if got := TeamCapabilitiesForRoles([]UserRole{RoleProduccion}, OrganizationTypeFactory); len(got) != 0 {
		t.Fatalf("unmanaged role must fail closed: %v", got)
	}
	if HasTeamCapability([]UserRole{RoleGerenteProduccion}, OrganizationTypeStore, TeamCapabilityManageSectors) {
		t.Fatal("role forbidden by organization type must not receive team capability")
	}
}

func teamCapabilityStrings(capabilities []TeamCapability) []string {
	out := make([]string, len(capabilities))
	for i, capability := range capabilities {
		out[i] = string(capability)
	}
	return out
}
