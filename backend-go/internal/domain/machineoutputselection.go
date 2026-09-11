package domain

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Machine output selection (#591): the exact tuple a factory selects for
// normal manufacturing generation. One operation -> one exact machine profile
// revision, one exact output compatibility profile revision, one exact
// adapter version/digest. Validation packs evaluating several candidates are
// a different flow and never read this selection.

type ManufacturingOperation string

const (
	OperationCutting   ManufacturingOperation = "cutting"
	OperationMachining ManufacturingOperation = "machining"
)

func (o ManufacturingOperation) Valid() bool {
	return o == OperationCutting || o == OperationMachining
}

// MachineOutputSelection is the persisted authoritative selection.
type MachineOutputSelection struct {
	Operation                   ManufacturingOperation `json:"operation"`
	MachineProfileID            string                 `json:"machineProfileId"`
	MachineProfileRevisionID    string                 `json:"machineProfileRevisionId"`
	OutputProfileID             string                 `json:"outputProfileId"`
	OutputProfileRevisionID     string                 `json:"outputProfileRevisionId"`
	AdapterID                   string                 `json:"adapterId"`
	AdapterVersion              string                 `json:"adapterVersion"`
	AdapterImplementationDigest string                 `json:"adapterImplementationDigest"`
}

// MachineOutputSelectionRecord adds storage metadata to the selection.
type MachineOutputSelectionRecord struct {
	MachineOutputSelection
	Version   int64  `json:"version"`
	UpdatedAt string `json:"updatedAt"`
	UpdatedBy string `json:"updatedBy"`
}

// CatalogEntry models shared with the TS export layer via
// contracts/machineOutputCatalog.contract.json (parity test).
type MachineOutputCatalog struct {
	SchemaID       string                              `json:"schemaId"`
	FormatFamilyOp map[string][]ManufacturingOperation `json:"formatFamilyOperations"`
	Machines       []MachineCatalogEntry               `json:"machines"`
	OutputProfiles []OutputProfileCatalogEntry         `json:"outputProfiles"`
	Adapters       []AdapterCatalogEntry               `json:"adapters"`
}

type MachineCatalogEntry struct {
	MachineProfileID         string                   `json:"machineProfileId"`
	MachineProfileRevisionID string                   `json:"machineProfileRevisionId"`
	ManufacturerFamily       string                   `json:"manufacturerFamily"`
	Model                    string                   `json:"model"`
	Role                     string                   `json:"role"`
	Operations               []ManufacturingOperation `json:"operations"`
	SupportStatus            string                   `json:"supportStatus"`
	Provenance               string                   `json:"provenance"`
}

type OutputProfileCatalogEntry struct {
	OutputCompatibilityProfileID string `json:"outputCompatibilityProfileId"`
	RevisionID                   string `json:"revisionId"`
	FormatFamily                 string `json:"formatFamily"`
	SupportStatus                string `json:"supportStatus"`
	Digest                       string `json:"digest"`
}

type AdapterCatalogEntry struct {
	PostprocessorAdapterID string `json:"postprocessorAdapterId"`
	AdapterVersion         string `json:"adapterVersion"`
	ImplementationDigest   string `json:"implementationDigest"`
	ProducedFormatFamily   string `json:"producedFormatFamily"`
	SerializerImplemented  bool   `json:"serializerImplemented"`
}

// MachineOutputCatalogJSON mirrors contracts/machineOutputCatalog.contract.json.
// Kept in sync by TestMachineOutputCatalogParity reading the fixture file.
const MachineOutputCatalogJSON = `{
  "schemaId": "granete.machine-output-catalog.v1",
  "formatFamilyOperations": {
    "ptx": ["cutting"],
    "saw": ["cutting"],
    "mpr": ["machining"]
  },
  "machines": [
    {
      "machineProfileId": "client-a-machine-b-hpp250",
      "machineProfileRevisionId": "r1",
      "manufacturerFamily": "HOLZMA (HOMAG)",
      "model": "HPP 250",
      "role": "panel-dividing-saw",
      "operations": ["cutting"],
      "supportStatus": "NOT_TESTED",
      "provenance": "OWNER_CONFIRMED"
    },
    {
      "machineProfileId": "client-a-machine-a-bhx050",
      "machineProfileRevisionId": "r1",
      "manufacturerFamily": "WEEKE (HOMAG)",
      "model": "BHX 050",
      "role": "cnc-drilling-machining-center",
      "operations": ["machining"],
      "supportStatus": "NOT_TESTED",
      "provenance": "OWNER_CONFIRMED"
    }
  ],
  "outputProfiles": [
    {"outputCompatibilityProfileId": "ptx-generic", "revisionId": "r1", "formatFamily": "ptx", "supportStatus": "NOT_TESTED", "digest": "d05d279e6c1e40ccb1fc9995d5e5d6c1b54112af5b62e91ba2275912872d4595"},
    {"outputCompatibilityProfileId": "ptx-cadmatic-3", "revisionId": "r1", "formatFamily": "ptx", "supportStatus": "NOT_TESTED", "digest": "c4ef85133a395b051da68a8411917217eba167a47950482270b202b160b9b7d1"},
    {"outputCompatibilityProfileId": "ptx-cadmatic-4", "revisionId": "r3", "formatFamily": "ptx", "supportStatus": "NOT_TESTED", "digest": "4998b6a53e131eda776934e18a24ee7f7e55ce526cbea3b8ba74d3340cbb9537"},
    {"outputCompatibilityProfileId": "ptx-cadmatic-5", "revisionId": "r1", "formatFamily": "ptx", "supportStatus": "NOT_TESTED", "digest": "0679fada5b4d97ee5f2ec173d5c7ddebbf14cd8b226bf1ebe12ff95da9288bc1"},
    {"outputCompatibilityProfileId": "saw-homag", "revisionId": "r1", "formatFamily": "saw", "supportStatus": "NOT_TESTED", "digest": "2cccceea22fbba8ec7c7df948473b8cb713223f0de1c3d07216e5614c7c3e112"},
    {"outputCompatibilityProfileId": "mpr-woodwop", "revisionId": "r1", "formatFamily": "mpr", "supportStatus": "NOT_TESTED", "digest": "28369cb293fcc77db20b11a4dfda795dc9f3346ea2d70e756286ba46de03fdf1"}
  ],
  "adapters": [
    {"postprocessorAdapterId": "granete-ptx", "adapterVersion": "1.2.0", "implementationDigest": "954fd63d08425a241309826d936597a4f20f857ae18b94741643480d679f7236", "producedFormatFamily": "ptx", "serializerImplemented": true},
    {"postprocessorAdapterId": "homag-saw", "adapterVersion": "0.1.0", "implementationDigest": "c6278fffdde1296eb508772d7a240c06695bba8b4bcac2e59b64761b38a74e9e", "producedFormatFamily": "saw", "serializerImplemented": false},
    {"postprocessorAdapterId": "woodwop-mpr", "adapterVersion": "0.1.0", "implementationDigest": "4ae7d19fb29c555c5de0346d06ae88cbc47bfa043b80222b9d427705c5c7e782", "producedFormatFamily": "mpr", "serializerImplemented": false}
  ]
}`

// ParseMachineOutputCatalog decodes the embedded catalog JSON.
func ParseMachineOutputCatalog() (MachineOutputCatalog, error) {
	var catalog MachineOutputCatalog
	if err := json.Unmarshal([]byte(MachineOutputCatalogJSON), &catalog); err != nil {
		return catalog, fmt.Errorf("machine output catalog: %w", err)
	}
	return catalog, nil
}

// ValidateMachineOutputSelection checks the tuple against the shared catalog.
// Exactness rule: every reference (id + revision/version + digest) must match
// the catalog exactly — there is no "latest" resolution server-side.
func ValidateMachineOutputSelection(catalog MachineOutputCatalog, sel MachineOutputSelection) error {
	if !sel.Operation.Valid() {
		return fmt.Errorf("operación desconocida: %q", sel.Operation)
	}
	trim := strings.TrimSpace
	sel.MachineProfileID = trim(sel.MachineProfileID)
	sel.MachineProfileRevisionID = trim(sel.MachineProfileRevisionID)
	sel.OutputProfileID = trim(sel.OutputProfileID)
	sel.OutputProfileRevisionID = trim(sel.OutputProfileRevisionID)
	sel.AdapterID = trim(sel.AdapterID)
	sel.AdapterVersion = trim(sel.AdapterVersion)
	sel.AdapterImplementationDigest = trim(sel.AdapterImplementationDigest)
	if sel.MachineProfileID == "" || sel.MachineProfileRevisionID == "" ||
		sel.OutputProfileID == "" || sel.OutputProfileRevisionID == "" ||
		sel.AdapterID == "" || sel.AdapterVersion == "" || sel.AdapterImplementationDigest == "" {
		return fmt.Errorf("la selección debe fijar máquina, perfil y adapter con revisión y digest exactos")
	}

	var machine *MachineCatalogEntry
	for i := range catalog.Machines {
		if catalog.Machines[i].MachineProfileID == sel.MachineProfileID {
			machine = &catalog.Machines[i]
			break
		}
	}
	if machine == nil {
		return fmt.Errorf("máquina desconocida: %s", sel.MachineProfileID)
	}
	if machine.MachineProfileRevisionID != sel.MachineProfileRevisionID {
		return fmt.Errorf("revisión de máquina exacta requerida: %s@%s no coincide con el catálogo (%s)",
			sel.MachineProfileID, sel.MachineProfileRevisionID, machine.MachineProfileRevisionID)
	}
	machineSupportsOperation := false
	for _, op := range machine.Operations {
		if op == sel.Operation {
			machineSupportsOperation = true
			break
		}
	}
	if !machineSupportsOperation {
		return fmt.Errorf("la máquina %s no cubre la operación %s", machine.Model, sel.Operation)
	}

	var profile *OutputProfileCatalogEntry
	for i := range catalog.OutputProfiles {
		if catalog.OutputProfiles[i].OutputCompatibilityProfileID == sel.OutputProfileID {
			profile = &catalog.OutputProfiles[i]
			break
		}
	}
	if profile == nil {
		return fmt.Errorf("perfil de salida desconocido: %s", sel.OutputProfileID)
	}
	if profile.RevisionID != sel.OutputProfileRevisionID {
		return fmt.Errorf("revisión de perfil exacta requerida: %s@%s no coincide con el catálogo (%s)",
			sel.OutputProfileID, sel.OutputProfileRevisionID, profile.RevisionID)
	}

	var adapter *AdapterCatalogEntry
	for i := range catalog.Adapters {
		if catalog.Adapters[i].PostprocessorAdapterID == sel.AdapterID {
			adapter = &catalog.Adapters[i]
			break
		}
	}
	if adapter == nil {
		return fmt.Errorf("adapter desconocido: %s", sel.AdapterID)
	}
	if adapter.AdapterVersion != sel.AdapterVersion || adapter.ImplementationDigest != sel.AdapterImplementationDigest {
		return fmt.Errorf("versión/digest de adapter exactos requeridos: %s@%s no coincide con el catálogo (%s@%s)",
			sel.AdapterID, sel.AdapterVersion, adapter.PostprocessorAdapterID, adapter.AdapterVersion)
	}
	if adapter.ProducedFormatFamily != profile.FormatFamily {
		return fmt.Errorf("el perfil %s (familia %s) no es compatible con el adapter %s (familia %s)",
			sel.OutputProfileID, profile.FormatFamily, sel.AdapterID, adapter.ProducedFormatFamily)
	}
	ops, ok := catalog.FormatFamilyOp[profile.FormatFamily]
	if !ok {
		return fmt.Errorf("familia de formato sin operación asignada: %s", profile.FormatFamily)
	}
	familyMatchesOperation := false
	for _, op := range ops {
		if op == sel.Operation {
			familyMatchesOperation = true
			break
		}
	}
	if !familyMatchesOperation {
		return fmt.Errorf("el perfil %s no aplica a la operación %s", sel.OutputProfileID, sel.Operation)
	}
	return nil
}

// MachineOutputSelectionBlocker is a structural readiness blocker computed
// server-side from the catalog. Evidence-dimension blockers live in the TS
// export resolver (packages/excel machines), which owns the adapters.
type MachineOutputSelectionBlocker struct {
	Code   string `json:"code"`
	Detail string `json:"detail"`
}

// ResolveMachineOutputBlockers returns structural blockers for a validated
// selection: serializer implementation availability only for now. It never
// fabricates compatibility — an empty list is not a validation claim.
func ResolveMachineOutputBlockers(catalog MachineOutputCatalog, sel MachineOutputSelection) []MachineOutputSelectionBlocker {
	blockers := []MachineOutputSelectionBlocker{}
	for _, adapter := range catalog.Adapters {
		if adapter.PostprocessorAdapterID != sel.AdapterID {
			continue
		}
		if !adapter.SerializerImplemented {
			blockers = append(blockers, MachineOutputSelectionBlocker{
				Code:   "SERIALIZER_NOT_IMPLEMENTED",
				Detail: "El serializador todavía no está implementado; la selección queda registrada pero no puede generar archivos.",
			})
		}
	}
	return blockers
}
