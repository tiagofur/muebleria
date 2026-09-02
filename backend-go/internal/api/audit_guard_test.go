package api

import (
	"os"
	"strings"
	"testing"
)

func TestCriticalFoundationEventsNeverUseBestEffortAudit(t *testing.T) {
	files := []string{"handlers.go", "platform.go", "orgteam.go"}
	criticalEvents := []string{
		"login_success",
		"organization_selected",
		"organization_renamed",
		"organization_license_updated",
		"membership_roles_changed",
		"membership_suspended",
		"membership_reactivated",
		"invitation_created",
		"invitation_resent",
		"invitation_revoked",
	}
	for _, file := range files {
		source, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		for _, event := range criticalEvents {
			if strings.Contains(string(source), `s.audit(r.Context(), "`+event+`"`) {
				t.Errorf("%s uses best-effort audit for critical event %s", file, event)
			}
		}
	}
}
