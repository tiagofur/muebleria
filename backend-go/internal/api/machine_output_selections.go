package api

import (
	"errors"
	"fmt"
	"net/http"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Machine output selection (#591 / WEB-MFG-2): the exact machine/profile/
// adapter tuple a factory selects for normal manufacturing generation.
// Validation packs evaluating several candidates never read this selection.

func (s *Server) buildMachineOutputSelectionsReadModel(records []domain.MachineOutputSelectionRecord) (openapi.MachineOutputSelectionsReadModel, error) {
	catalog, err := domain.ParseMachineOutputCatalog()
	if err != nil {
		return openapi.MachineOutputSelectionsReadModel{}, err
	}
	resolved := make([]openapi.MachineOutputSelectionResolved, 0, len(records))
	for _, rec := range records {
		entry := openapi.MachineOutputSelectionResolved{
			Selection:     machineOutputSelectionRecordToAPI(rec),
			Blockers:      []openapi.MachineOutputBlocker{},
			MachineLabel:  rec.MachineProfileID + "@" + rec.MachineProfileRevisionID,
			ProfileLabel:  rec.OutputProfileID + "@" + rec.OutputProfileRevisionID,
			AdapterLabel:  rec.AdapterID + " · " + rec.AdapterVersion,
			SupportStatus: "NOT_TESTED",
		}
		for _, machine := range catalog.Machines {
			if machine.MachineProfileID == rec.MachineProfileID &&
				machine.MachineProfileRevisionID == rec.MachineProfileRevisionID {
				entry.MachineLabel = machine.ManufacturerFamily + " " + machine.Model
			}
		}
		for _, profile := range catalog.OutputProfiles {
			if profile.OutputCompatibilityProfileID == rec.OutputProfileID &&
				profile.RevisionID == rec.OutputProfileRevisionID && rec.OutputProfileDigest != nil &&
				profile.Digest == *rec.OutputProfileDigest {
				entry.ProfileLabel = profile.OutputCompatibilityProfileID + "@" + profile.RevisionID
				entry.SupportStatus = profile.SupportStatus
			}
		}
		for _, adapter := range catalog.Adapters {
			if adapter.PostprocessorAdapterID == rec.AdapterID &&
				adapter.AdapterVersion == rec.AdapterVersion &&
				adapter.ImplementationDigest == rec.AdapterImplementationDigest {
				entry.AdapterLabel = adapter.PostprocessorAdapterID + " · " + adapter.AdapterVersion
			}
		}
		for _, blocker := range domain.ResolveMachineOutputBlockers(catalog, rec.MachineOutputSelection) {
			entry.Blockers = append(entry.Blockers, openapi.MachineOutputBlocker{
				Code: blocker.Code, Detail: blocker.Detail,
			})
		}
		resolved = append(resolved, entry)
	}
	return openapi.MachineOutputSelectionsReadModel{
		Selections: resolved,
		Catalog:    machineOutputCatalogToAPI(catalog),
	}, nil
}

func machineOutputSelectionRecordToAPI(rec domain.MachineOutputSelectionRecord) openapi.MachineOutputSelectionRecord {
	return openapi.MachineOutputSelectionRecord{
		Operation:                   string(rec.Operation),
		MachineProfileId:            rec.MachineProfileID,
		MachineProfileRevisionId:    rec.MachineProfileRevisionID,
		OutputProfileId:             rec.OutputProfileID,
		OutputProfileRevisionId:     rec.OutputProfileRevisionID,
		OutputProfileDigest:         rec.OutputProfileDigest,
		AdapterId:                   rec.AdapterID,
		AdapterVersion:              rec.AdapterVersion,
		AdapterImplementationDigest: rec.AdapterImplementationDigest,
		Version:                     rec.Version,
		UpdatedAt:                   rec.UpdatedAt,
		UpdatedBy:                   rec.UpdatedBy,
	}
}

func machineOutputCatalogToAPI(catalog domain.MachineOutputCatalog) openapi.MachineOutputCatalog {
	api := openapi.MachineOutputCatalog{SchemaId: catalog.SchemaID, FormatFamilyOperations: map[string][]string{}}
	for family, operations := range catalog.FormatFamilyOp {
		apiOps := make([]string, 0, len(operations))
		for _, op := range operations {
			apiOps = append(apiOps, string(op))
		}
		api.FormatFamilyOperations[family] = apiOps
	}
	for _, machine := range catalog.Machines {
		ops := make([]string, 0, len(machine.Operations))
		for _, op := range machine.Operations {
			ops = append(ops, string(op))
		}
		api.Machines = append(api.Machines, openapi.MachineOutputCatalogMachine{
			MachineProfileId:         machine.MachineProfileID,
			MachineProfileRevisionId: machine.MachineProfileRevisionID,
			ManufacturerFamily:       machine.ManufacturerFamily,
			Model:                    machine.Model,
			Role:                     machine.Role,
			Operations:               ops,
			SupportStatus:            machine.SupportStatus,
			Provenance:               machine.Provenance,
		})
	}
	for _, profile := range catalog.OutputProfiles {
		api.OutputProfiles = append(api.OutputProfiles, openapi.MachineOutputCatalogProfile{
			OutputCompatibilityProfileId: profile.OutputCompatibilityProfileID,
			RevisionId:                   profile.RevisionID,
			FormatFamily:                 profile.FormatFamily,
			SupportStatus:                profile.SupportStatus,
			Digest:                       profile.Digest,
		})
	}
	for _, adapter := range catalog.Adapters {
		api.Adapters = append(api.Adapters, openapi.MachineOutputCatalogAdapter{
			PostprocessorAdapterId: adapter.PostprocessorAdapterID,
			AdapterVersion:         adapter.AdapterVersion,
			ImplementationDigest:   adapter.ImplementationDigest,
			ProducedFormatFamily:   adapter.ProducedFormatFamily,
			SerializerImplemented:  adapter.SerializerImplemented,
		})
	}
	return api
}

// HandleListMachineOutputSelections: GET /api/machine-output-selections.
// Same settings gate as the PUT (#591 scope is factory-only): the internal
// machine/adapter catalog must not reach store/partner users — RLS protects
// the selections, but the catalog itself is factory engineering data.
func (s *Server) HandleListMachineOutputSelections(w http.ResponseWriter, r *http.Request) {
	if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanAccessSettings),
		"no tenés permiso para ver la configuración de salida de máquina") {
		return
	}
	records, err := s.Store.ListMachineOutputSelections(r.Context())
	if err != nil {
		respondWithInternalError(w, err, "handler")
		return
	}
	readModel, err := s.buildMachineOutputSelectionsReadModel(records)
	if err != nil {
		respondWithInternalError(w, err, "handler")
		return
	}
	respondWithJSON(w, http.StatusOK, readModel)
}

// HandleUpsertMachineOutputSelection: PUT /api/machine-output-selections/{operation}.
func (s *Server) HandleUpsertMachineOutputSelection(w http.ResponseWriter, r *http.Request) {
	if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanAccessSettings),
		"no tenés permiso para configurar la salida de máquina") {
		return
	}
	operation := r.PathValue("operation")
	var body struct {
		Selection       domain.MachineOutputSelection `json:"selection"`
		ExpectedVersion int64                         `json:"expectedVersion"`
	}
	if !decodeJSONBody(w, r, &body) {
		return
	}
	// Compare BEFORE touching the decoded value: overwriting first would
	// destroy the mismatch we are checking for.
	if !domain.ManufacturingOperation(operation).Valid() ||
		body.Selection.Operation != domain.ManufacturingOperation(operation) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest,
			fmt.Sprintf("la operación del body (%q) no coincide con la del path (%q)",
				body.Selection.Operation, operation), nil)
		return
	}
	catalog, err := domain.ParseMachineOutputCatalog()
	if err != nil {
		respondWithInternalError(w, err, "handler")
		return
	}
	if err := domain.ValidateMachineOutputSelection(catalog, body.Selection); err != nil {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, err.Error(), nil)
		return
	}
	claims := claimsFromRequest(r)
	updatedBy := ""
	if claims != nil {
		updatedBy = claims.Email
	}
	saved, err := s.Store.UpsertMachineOutputSelection(r.Context(), body.Selection, body.ExpectedVersion, updatedBy)
	switch {
	case err == nil:
		respondWithJSON(w, http.StatusOK, machineOutputSelectionRecordToAPI(saved))
	case errors.Is(err, storage.ErrVersionConflict):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeVersionConflict,
			"la configuración cambió en otra sesión; recargá y volvé a intentar", nil)
	default:
		respondWithInternalError(w, err, "handler")
	}
}
