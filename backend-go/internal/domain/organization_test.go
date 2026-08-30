package domain

import "testing"

func TestCanTransitionOrganizationStatus(t *testing.T) {
	allowed := map[[2]OrganizationStatus]bool{
		{OrganizationStatusProvisioning, OrganizationStatusActive}:             true,
		{OrganizationStatusProvisioning, OrganizationStatusProvisioningFailed}: true,
		{OrganizationStatusProvisioningFailed, OrganizationStatusProvisioning}: true,
		{OrganizationStatusProvisioningFailed, OrganizationStatusTerminated}:   true,
		{OrganizationStatusActive, OrganizationStatusSuspended}:                true,
		{OrganizationStatusActive, OrganizationStatusOffboarding}:              true,
		{OrganizationStatusSuspended, OrganizationStatusActive}:                true,
		{OrganizationStatusSuspended, OrganizationStatusOffboarding}:           true,
		{OrganizationStatusOffboarding, OrganizationStatusTerminated}:          true,
	}
	statuses := []OrganizationStatus{
		OrganizationStatusProvisioning,
		OrganizationStatusActive,
		OrganizationStatusSuspended,
		OrganizationStatusOffboarding,
		OrganizationStatusTerminated,
		OrganizationStatusProvisioningFailed,
	}
	for _, from := range statuses {
		for _, to := range statuses {
			if got := CanTransitionOrganizationStatus(from, to); got != allowed[[2]OrganizationStatus{from, to}] {
				t.Fatalf("transition %s -> %s = %v", from, to, got)
			}
		}
	}
}

func TestIsValidOrganizationStatus(t *testing.T) {
	for _, status := range []OrganizationStatus{
		OrganizationStatusProvisioning,
		OrganizationStatusActive,
		OrganizationStatusSuspended,
		OrganizationStatusOffboarding,
		OrganizationStatusTerminated,
		OrganizationStatusProvisioningFailed,
	} {
		if !IsValidOrganizationStatus(status) {
			t.Fatalf("expected %q to be valid", status)
		}
	}
	if IsValidOrganizationStatus("unknown") {
		t.Fatal("unknown status must be invalid")
	}
}
