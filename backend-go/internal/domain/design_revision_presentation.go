package domain

import (
	"encoding/json"
	"fmt"
)

type DesignRevisionDescriptorState string

const (
	DesignRevisionDescriptorAvailable         DesignRevisionDescriptorState = "available"
	DesignRevisionDescriptorUnavailableLegacy DesignRevisionDescriptorState = "unavailable_legacy"
)

type DesignMaterialProvenance string

const (
	DesignMaterialProvenanceAuthored         DesignMaterialProvenance = "authored"
	DesignMaterialProvenanceQuoted           DesignMaterialProvenance = "quoted"
	DesignMaterialProvenanceInheritedDefault DesignMaterialProvenance = "inherited_default"
	DesignMaterialProvenanceUnresolved       DesignMaterialProvenance = "unresolved"
)

type DesignRevisionPresentationSnapshot struct {
	SchemaVersion int                          `json:"schema_version"`
	Unit          DesignRevisionUnitDescriptor `json:"unit"`
	Definition    DesignRevisionDefinition     `json:"definition"`
	Parameters    []DesignRevisionParameter    `json:"parameters"`
	Materials     []DesignRevisionMaterial     `json:"materials"`
	Room          DesignRevisionRoomDescriptor `json:"room"`
}

type DesignRevisionUnitDescriptor struct {
	Label string `json:"label"`
	Index int    `json:"index,omitempty"`
	Total int    `json:"total,omitempty"`
}

type DesignRevisionDefinition struct {
	Code string `json:"code,omitempty"`
	Name string `json:"name,omitempty"`
}

type DesignRevisionParameter struct {
	Key   string `json:"key"`
	Label string `json:"label,omitempty"`
	Type  string `json:"type,omitempty"`
	Value any    `json:"value"`
	Unit  string `json:"unit,omitempty"`
	State string `json:"state"`
}

type DesignRevisionMaterial struct {
	Role                 string                   `json:"role"`
	RoleLabel            string                   `json:"role_label,omitempty"`
	MaterialID           string                   `json:"material_id,omitempty"`
	Code                 string                   `json:"code,omitempty"`
	Name                 string                   `json:"name,omitempty"`
	EffectiveThicknessMM *float64                 `json:"effective_thickness_mm,omitempty"`
	Provenance           DesignMaterialProvenance `json:"provenance"`
}

type DesignRevisionRoomDescriptor struct {
	Label string `json:"label,omitempty"`
	State string `json:"state"`
}

func DecodeDesignRevisionPresentationSnapshot(raw []byte) (*DesignRevisionPresentationSnapshot, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var snapshot DesignRevisionPresentationSnapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		return nil, fmt.Errorf("%w: presentation snapshot: %v", ErrSerializationFailed, err)
	}
	if snapshot.SchemaVersion != 1 || snapshot.Unit.Label == "" {
		return nil, fmt.Errorf("%w: unsupported presentation snapshot", ErrSerializationFailed)
	}
	return &snapshot, nil
}

func DesignRevisionDescriptorStateFor(snapshot *DesignRevisionPresentationSnapshot) DesignRevisionDescriptorState {
	if snapshot == nil {
		return DesignRevisionDescriptorUnavailableLegacy
	}
	return DesignRevisionDescriptorAvailable
}
