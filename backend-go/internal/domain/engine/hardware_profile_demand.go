package engine

import (
	"sort"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// DeriveHardwareProfileDemand projects the commercial consumption of the
// resolved profiles (#917): for every relationship that reached
// MACHINING_READY through server-resolved profiles, each VERIFIED contact
// consumes one application of the profile's items PER PLANNED STATION
// (#1065) — a spacing-derived joint plans more stations on a bigger span,
// and the purchase lines must scale with what the fitter actually installs,
// not with a fixed per-contact count. Aggregated by catalog hardware id with
// a per-relationship provenance trail. The source is the profile RESOLUTION
// (assignments × pinned items × planned stations) — never the drilling
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
		stationCountByContact := map[string]int{}
		for _, count := range status.Stations.StationCounts {
			stationCountByContact[count.ContactID] = count.StationCount
		}
		verifiedContacts := 0
		plannedStations := 0
		for _, contact := range status.Contacts {
			if contact.Status != "VALID" {
				continue
			}
			verifiedContacts++
			plannedStations += stationCountByContact[contact.ContactID]
		}
		if verifiedContacts == 0 {
			continue
		}
		if plannedStations == 0 {
			// A MACHINING_READY relationship always publishes station plans
			// for its verified contacts; this branch only keeps legacy
			// statuses without plans behaving exactly as before instead of
			// collapsing their demand to zero.
			plannedStations = verifiedContacts
		}
		recipe := recipeByRelationship[status.RelationshipID]
		for _, item := range profile.Items {
			line, ok := byHardware[item.HardwareID]
			if !ok {
				line = &accumulator{}
				byHardware[item.HardwareID] = line
				order = append(order, item.HardwareID)
			}
			line.quantity += item.Quantity * float64(plannedStations)
			line.sources = append(line.sources, HardwareProfileDemandSource{
				TechnicalProfileID:       profile.ID,
				TechnicalProfileRevision: profile.Revision,
				RecipeID:                 recipe[0],
				RecipeRevision:           recipe[1],
				RelationshipID:           status.RelationshipID,
				ContactCount:             verifiedContacts,
				StationCount:             plannedStations,
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
