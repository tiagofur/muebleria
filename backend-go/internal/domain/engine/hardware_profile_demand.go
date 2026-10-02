package engine

import (
	"sort"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// DeriveHardwareProfileDemand projects the commercial consumption of the
// resolved profiles (#917): for every relationship that reached
// MACHINING_READY through server-resolved profiles, each VERIFIED contact
// consumes one application of the profile's items. Aggregated by catalog
// hardware id with a per-relationship provenance trail. The source is the
// profile RESOLUTION (assignments × pinned items) — never the drilling
// output: a hardware producing five operations is still one purchase line,
// and the machining geometry stays out of the commercial path.
//
// Engine-level authority so the authoring resolve (#477) and the release
// freeze (#577/#875) share ONE demand derivation; the api layer keeps no
// parallel copy.
func DeriveHardwareProfileDemand(
	machining *AuthoringMachining,
	profilesByID map[string]domain.HardwareProfile,
) []HardwareProfileDemandLine {
	if machining == nil || len(profilesByID) == 0 || len(machining.JoineryStatuses) == 0 {
		return nil
	}
	profileByRelationship := map[string]domain.HardwareProfile{}
	recipeByRelationship := map[string][2]string{}
	for _, operation := range machining.Operations {
		provenance := operation.Provenance
		if provenance.TechnicalProfileID == "" || provenance.RelationshipID == "" {
			continue
		}
		profile, ok := profilesByID[provenance.TechnicalProfileID]
		if !ok || len(profile.Items) == 0 {
			continue
		}
		profileByRelationship[provenance.RelationshipID] = profile
		recipeByRelationship[provenance.RelationshipID] = [2]string{provenance.CatalogRuleID, provenance.RecipeRevision}
	}
	if len(profileByRelationship) == 0 {
		return nil
	}

	type accumulator struct {
		quantity float64
		sources  []HardwareProfileDemandSource
	}
	byHardware := map[string]*accumulator{}
	order := []string{}
	for _, status := range machining.JoineryStatuses {
		profile, ok := profileByRelationship[status.RelationshipID]
		if !ok || status.Stage != JoineryMachiningReady {
			continue
		}
		verifiedContacts := 0
		for _, contact := range status.Contacts {
			if contact.Status == "VALID" {
				verifiedContacts++
			}
		}
		if verifiedContacts == 0 {
			continue
		}
		recipe := recipeByRelationship[status.RelationshipID]
		for _, item := range profile.Items {
			line, ok := byHardware[item.HardwareID]
			if !ok {
				line = &accumulator{}
				byHardware[item.HardwareID] = line
				order = append(order, item.HardwareID)
			}
			line.quantity += item.Quantity * float64(verifiedContacts)
			line.sources = append(line.sources, HardwareProfileDemandSource{
				TechnicalProfileID:       profile.ID,
				TechnicalProfileRevision: profile.Revision,
				RecipeID:                 recipe[0],
				RecipeRevision:           recipe[1],
				RelationshipID:           status.RelationshipID,
				ContactCount:             verifiedContacts,
			})
		}
	}
	if len(order) == 0 {
		return nil
	}
	sort.Strings(order)
	lines := make([]HardwareProfileDemandLine, 0, len(order))
	for _, hardwareID := range order {
		acc := byHardware[hardwareID]
		lines = append(lines, HardwareProfileDemandLine{
			HardwareID: hardwareID,
			Quantity:   acc.quantity,
			Sources:    acc.sources,
		})
	}
	return lines
}
