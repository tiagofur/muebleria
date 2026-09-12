package domain

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"
)

// #667 / M1: versioned 3D assets for the hardware catalog — identity,
// immutable revisions, staged uploads, validation evidence and the exact
// hardware binding (spec §§4-7, 10, 15; program #666). Upload/byte handling
// lives in the API layer; this file owns identity, states and metadata
// validation.

// HardwareAssetRepresentation enumerates the accepted visual representations.
// SKP is the native SketchUp host format; GLB is the web interchange;
// thumbnail is a rendered preview image. The set is closed until an
// authorized validator proves otherwise.
type HardwareAssetRepresentation string

const (
	HardwareAssetRepresentationSKP       HardwareAssetRepresentation = "skp"
	HardwareAssetRepresentationGLB       HardwareAssetRepresentation = "glb"
	HardwareAssetRepresentationThumbnail HardwareAssetRepresentation = "thumbnail"
)

func IsValidHardwareAssetRepresentation(r HardwareAssetRepresentation) bool {
	switch r {
	case HardwareAssetRepresentationSKP, HardwareAssetRepresentationGLB, HardwareAssetRepresentationThumbnail:
		return true
	default:
		return false
	}
}

type HardwareAssetStatus string

const (
	HardwareAssetStatusActive  HardwareAssetStatus = "active"
	HardwareAssetStatusRetired HardwareAssetStatus = "retired"
)

// HardwareAssetValidationState separates "bytes received and verified"
// (integrity) from "representation compatibility actually proven in a host"
// (validation). M1 only ever persists 'pending': no client-declared boolean
// is ever accepted as evidence (§10 honest states; producer is #668).
type HardwareAssetValidationState string

const (
	HardwareAssetValidationPending   HardwareAssetValidationState = "pending"
	HardwareAssetValidationValidated HardwareAssetValidationState = "validated"
	HardwareAssetValidationFailed    HardwareAssetValidationState = "failed"
)

// HardwareAssetOrigin records the declared physical normalization of the
// asset file: explicit units, the file's up-axis convention and the visual
// anchor offset in millimeters. Values must be finite and bounded; no
// renderer ever fits a mesh to a received bounding box (§7).
type HardwareAssetOrigin struct {
	// SourceUnits is the unit the FILE was authored in. Industrial values stay
	// mm; this records the declared source so a future conversion is an
	// explicit normalization, never a silent scale.
	SourceUnits string `json:"sourceUnits"`
	// UpAxis is the file's up-axis convention: "y" (glTF) or "z" (SketchUp).
	UpAxis string `json:"upAxis"`
	// AnchorOffsetMm is the visual anchor offset from the placement anchor
	// point, in millimeters, in the furniture frame.
	AnchorOffsetMm *HardwareAssetAnchor `json:"anchorOffsetMm,omitempty"`
}

type HardwareAssetAnchor struct {
	XMm float64 `json:"xMm"`
	YMm float64 `json:"yMm"`
	ZMm float64 `json:"zMm"`
}

const hardwareAssetMMagnitudeCap = 1e6 // mm; any coordinate beyond this is garbage, not geometry

var validSourceUnits = map[string]bool{"mm": true, "cm": true, "m": true, "inch": true}

// ValidateHardwareAssetOrigin enforces structure: finite, bounded values and
// explicit units. It performs NO renderer transformation and NO compatibility
// claim.
func ValidateHardwareAssetOrigin(raw json.RawMessage) (*HardwareAssetOrigin, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var o HardwareAssetOrigin
	if err := json.Unmarshal(raw, &o); err != nil {
		return nil, fmt.Errorf("%w: origin: %v", ErrHardwareAssetInvalid, err)
	}
	if !validSourceUnits[o.SourceUnits] {
		return nil, fmt.Errorf("%w: origin.sourceUnits must be one of mm|cm|m|inch", ErrHardwareAssetInvalid)
	}
	if o.UpAxis != "y" && o.UpAxis != "z" {
		return nil, fmt.Errorf("%w: origin.upAxis must be \"y\" or \"z\"", ErrHardwareAssetInvalid)
	}
	if o.AnchorOffsetMm != nil {
		for name, v := range map[string]float64{
			"anchorOffsetMm.xMm": o.AnchorOffsetMm.XMm,
			"anchorOffsetMm.yMm": o.AnchorOffsetMm.YMm,
			"anchorOffsetMm.zMm": o.AnchorOffsetMm.ZMm,
		} {
			if math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > hardwareAssetMMagnitudeCap {
				return nil, fmt.Errorf("%w: origin.%s must be a finite value within ±%g mm", ErrHardwareAssetInvalid, name, hardwareAssetMMagnitudeCap)
			}
		}
	}
	return &o, nil
}

var (
	ErrHardwareAssetInvalid            = errors.New("hardware asset is invalid")
	ErrHardwareAssetNotFound           = errors.New("hardware asset not found")
	ErrHardwareAssetRevisionNotFound   = errors.New("hardware asset revision not found")
	ErrHardwareAssetSessionNotFound    = errors.New("hardware asset upload session not found")
	ErrHardwareAssetSessionNotPrepared = errors.New("hardware asset upload session is not prepared")
	ErrHardwareAssetRetired            = errors.New("hardware asset is retired")
	ErrHardwareAssetBytesMissing       = errors.New("hardware asset bytes missing")
	// ErrHardwareAssetIntegrityMismatch: the stored bytes no longer match the
	// finalized digest — fail closed, never serve.
	ErrHardwareAssetIntegrityMismatch = errors.New("hardware asset bytes integrity mismatch")
	ErrHardwareAssetBindingInvalid    = errors.New("hardware visual asset binding is invalid")
)

// HardwareAsset is the tenant-owned identity of one versioned 3D resource.
type HardwareAsset struct {
	ID             string                  `json:"id"`
	OrganizationID string                  `json:"-"`
	DisplayName    string                  `json:"display_name"`
	Provenance     string                  `json:"provenance,omitempty"`
	License        string                  `json:"license,omitempty"`
	Status         HardwareAssetStatus     `json:"status"`
	Revisions      []HardwareAssetRevision `json:"revisions"`
	CreatedBy      string                  `json:"-"`
	CreatedAt      time.Time               `json:"created_at"`
	UpdatedAt      time.Time               `json:"updated_at"`
}

// HardwareAssetRevision is one immutable representation revision. Size and
// digest are computed server-side over the received bytes; ValidationState
// starts pending and only an authorized validator (#668) can move it.
type HardwareAssetRevision struct {
	ID                  string                       `json:"id"`
	OrganizationID      string                       `json:"-"`
	AssetID             string                       `json:"asset_id"`
	RevisionNumber      int                          `json:"revision_number"`
	Representation      HardwareAssetRepresentation  `json:"representation"`
	StorageKey          string                       `json:"-"`
	ContentType         string                       `json:"content_type"`
	SizeBytes           int64                        `json:"size_bytes"`
	SHA256              string                       `json:"sha256"`
	Origin              *HardwareAssetOrigin         `json:"origin,omitempty"`
	IntegrityVerifiedAt time.Time                    `json:"integrity_verified_at"`
	ValidationState     HardwareAssetValidationState `json:"validation_state"`
	Validations         []HardwareAssetValidation    `json:"validations,omitempty"`
	CreatedBy           string                       `json:"-"`
	CreatedAt           time.Time                    `json:"created_at"`
}

// HardwareAssetUploadSession is the staging row of one
// start → receive → finalize upload. Finalize is the only writer of asset +
// revision rows; a cancelled or expired session never becomes a resource.
type HardwareAssetUploadSession struct {
	ID             string                      `json:"id"`
	OrganizationID string                      `json:"-"`
	Representation HardwareAssetRepresentation `json:"representation"`
	DisplayName    string                      `json:"display_name"`
	Provenance     string                      `json:"provenance,omitempty"`
	License        string                      `json:"license,omitempty"`
	Origin         *HardwareAssetOrigin        `json:"origin,omitempty"`
	Staged         *HardwareAssetStagedBytes   `json:"staged,omitempty"`
	// TargetAssetID, when set, directs finalize to append the next immutable
	// revision to that existing asset instead of creating a new one.
	TargetAssetID       *string   `json:"target_asset_id,omitempty"`
	Status              string    `json:"status"`
	CreatedBy           string    `json:"-"`
	CreatedAt           time.Time `json:"created_at"`
	ExpiresAt           time.Time `json:"expires_at"`
	FinalizedAssetID    *string   `json:"finalized_asset_id,omitempty"`
	FinalizedRevisionID *string   `json:"finalized_revision_id,omitempty"`
}

// HardwareAssetStagedBytes mirrors the server-computed metadata of the bytes
// currently staged for a session.
type HardwareAssetStagedBytes struct {
	StorageKey  string `json:"-"`
	ContentType string `json:"content_type"`
	SizeBytes   int64  `json:"size_bytes"`
	SHA256      string `json:"sha256"`
}

// HardwareAssetValidation is one append-only evidence record. In M1 only the
// simulated test recorder writes here; the SketchUp host validator producer
// is #668. Result values are neutral facts, never a compatibility claim.
type HardwareAssetValidation struct {
	ID         string          `json:"id"`
	AssetID    string          `json:"asset_id"`
	RevisionID string          `json:"revision_id"`
	SHA256     string          `json:"sha256"`
	Tool       string          `json:"tool"`
	Result     string          `json:"result"`
	Details    json.RawMessage `json:"details,omitempty"`
	CreatedBy  string          `json:"-"`
	CreatedAt  time.Time       `json:"created_at"`
}

// HardwareVisualAssetBinding is the exact visual association of a hardware to
// one asset revision. Client payloads only ever carry the two identifiers;
// representation and digest are resolved server-side from the referenced
// rows (never trusted from the request).
type HardwareVisualAssetBinding struct {
	AssetID         string `json:"assetId"`
	AssetRevisionID string `json:"assetRevisionId"`
	// Resolved server-side:
	Representation HardwareAssetRepresentation `json:"representation,omitempty"`
	SHA256         string                      `json:"sha256,omitempty"`
	// ValidationState of the pinned revision, resolved server-side so every
	// consumer can distinguish "bytes present" from "host-proven".
	ValidationState HardwareAssetValidationState `json:"validationState,omitempty"`
}

// DesignRevisionHardwareAssetPin is one frozen reference written at
// DesignRevision publish time: the exact asset revision (and its digest) the
// hardware used when THIS revision was published. Rows are immutable — R1
// never follows a later catalog rebind (spec §15).
type DesignRevisionHardwareAssetPin struct {
	ID               string                      `json:"id"`
	OrganizationID   string                      `json:"-"`
	ProjectID        string                      `json:"-"`
	DesignRevisionID string                      `json:"-"`
	HardwareID       string                      `json:"hardware_id"`
	AssetID          string                      `json:"asset_id"`
	AssetRevisionID  string                      `json:"asset_revision_id"`
	Representation   HardwareAssetRepresentation `json:"representation"`
	SHA256           string                      `json:"sha256"`
	CreatedAt        time.Time                   `json:"created_at"`
}
