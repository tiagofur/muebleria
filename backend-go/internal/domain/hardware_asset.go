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

// Coordinate Spaces:
//   Asset space (raw coordinates in SKP)
//     -> assetNormalization
//     -> Hardware canonical space (+X: longitudinal/primary, +Y: in-plane, +Z: outward normal)
//     -> Placement transform
//     -> Furniture space
//
// MountFrame in Asset space specifies where the mounting frame sits on the asset:
// - OriginMm is the mount anchor point in asset coordinates (e.g. midpoint between screw holes).
// - Basis.X is the primary longitudinal axis of the hardware (+X).
// - Basis.Y is the secondary in-plane axis (+Y).
// - Basis.Z is the normal axis pointing outward from the host mounting face (+Z).

type HardwareBasis struct {
	X [3]float64 `json:"x"`
	Y [3]float64 `json:"y"`
	Z [3]float64 `json:"z"`
}

type HardwareMountFrame struct {
	OriginMm [3]float64    `json:"originMm"`
	Basis    HardwareBasis `json:"basis"`
}

type HardwareAssetNormalization struct {
	TranslationMm [3]float64    `json:"translationMm"`
	Basis         HardwareBasis `json:"basis"`
}

func (n HardwareAssetNormalization) Apply(p [3]float64) [3]float64 {
	return [3]float64{
		n.TranslationMm[0] + p[0]*n.Basis.X[0] + p[1]*n.Basis.Y[0] + p[2]*n.Basis.Z[0],
		n.TranslationMm[1] + p[0]*n.Basis.X[1] + p[1]*n.Basis.Y[1] + p[2]*n.Basis.Z[1],
		n.TranslationMm[2] + p[0]*n.Basis.X[2] + p[1]*n.Basis.Y[2] + p[2]*n.Basis.Z[2],
	}
}

func (n HardwareAssetNormalization) ApplyVector(v [3]float64) [3]float64 {
	return [3]float64{
		v[0]*n.Basis.X[0] + v[1]*n.Basis.Y[0] + v[2]*n.Basis.Z[0],
		v[0]*n.Basis.X[1] + v[1]*n.Basis.Y[1] + v[2]*n.Basis.Z[1],
		v[0]*n.Basis.X[2] + v[1]*n.Basis.Y[2] + v[2]*n.Basis.Z[2],
	}
}

// DeriveAssetNormalization computes the rigid normalization transform T_norm
// from a given MountFrame in Asset space:
//   R_norm = R_mount^T
//   T_norm = - R_norm * Origin_mount
func DeriveAssetNormalization(mf HardwareMountFrame) (HardwareAssetNormalization, error) {
	if err := ValidateHardwareBasis(mf.Basis, "mountFrame.basis"); err != nil {
		return HardwareAssetNormalization{}, err
	}
	for _, v := range mf.OriginMm {
		if math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > hardwareAssetMMagnitudeCap {
			return HardwareAssetNormalization{}, fmt.Errorf("%w: mountFrame.originMm values must be finite and within ±%g mm", ErrHardwareAssetInvalid, hardwareAssetMMagnitudeCap)
		}
	}

	// Columns of R_norm = rows of R_mount:
	normBasis := HardwareBasis{
		X: [3]float64{mf.Basis.X[0], mf.Basis.Y[0], mf.Basis.Z[0]},
		Y: [3]float64{mf.Basis.X[1], mf.Basis.Y[1], mf.Basis.Z[1]},
		Z: [3]float64{mf.Basis.X[2], mf.Basis.Y[2], mf.Basis.Z[2]},
	}

	o := mf.OriginMm
	trans := [3]float64{
		-(mf.Basis.X[0]*o[0] + mf.Basis.X[1]*o[1] + mf.Basis.X[2]*o[2]),
		-(mf.Basis.Y[0]*o[0] + mf.Basis.Y[1]*o[1] + mf.Basis.Y[2]*o[2]),
		-(mf.Basis.Z[0]*o[0] + mf.Basis.Z[1]*o[1] + mf.Basis.Z[2]*o[2]),
	}

	return HardwareAssetNormalization{
		TranslationMm: trans,
		Basis:         normBasis,
	}, nil
}

// HardwareAssetOrigin records the declared physical normalization and mounting
// preparation of the asset file.
//
// INVARIANT: measuredBoundsMm MUST NOT live in HardwareAssetOrigin;
// measured geometry belongs exclusively to append-only validation evidence.
type HardwareAssetOrigin struct {
	// SourceUnits is the unit the FILE was authored in (mm, cm, m, inch).
	SourceUnits string `json:"sourceUnits"`
	// UpAxis is the file's up-axis convention: "y" (glTF) or "z" (SketchUp).
	UpAxis string `json:"upAxis"`
	// AnchorOffsetMm is the visual anchor offset in millimeters.
	AnchorOffsetMm *HardwareAssetAnchor `json:"anchorOffsetMm,omitempty"`
	// MountFrame specifies the mount point and canonical axes in Asset space.
	MountFrame *HardwareMountFrame `json:"mountFrame,omitempty"`
	// AssetNormalization specifies the rigid normalization into canonical frame.
	AssetNormalization *HardwareAssetNormalization `json:"assetNormalization,omitempty"`
}

type HardwareAssetAnchor struct {
	XMm float64 `json:"xMm"`
	YMm float64 `json:"yMm"`
	ZMm float64 `json:"zMm"`
}

const hardwareAssetMMagnitudeCap = 1e6 // mm; any coordinate beyond this is garbage, not geometry
const basisTolerance = 1e-4

var validSourceUnits = map[string]bool{"mm": true, "cm": true, "m": true, "inch": true}

func ValidateHardwareBasis(b HardwareBasis, label string) error {
	for axisName, v := range map[string][3]float64{"x": b.X, "y": b.Y, "z": b.Z} {
		for _, coord := range v {
			if math.IsNaN(coord) || math.IsInf(coord, 0) || math.Abs(coord) > hardwareAssetMMagnitudeCap {
				return fmt.Errorf("%w: %s.%s must be finite and bounded", ErrHardwareAssetInvalid, label, axisName)
			}
		}
		norm := math.Sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2])
		if math.Abs(norm-1.0) > basisTolerance {
			return fmt.Errorf("%w: %s.%s must be a unit vector (|v|=%g)", ErrHardwareAssetInvalid, label, axisName, norm)
		}
	}

	// Orthogonality:
	dotXY := b.X[0]*b.Y[0] + b.X[1]*b.Y[1] + b.X[2]*b.Y[2]
	dotXZ := b.X[0]*b.Z[0] + b.X[1]*b.Z[1] + b.X[2]*b.Z[2]
	dotYZ := b.Y[0]*b.Z[0] + b.Y[1]*b.Z[1] + b.Y[2]*b.Z[2]
	if math.Abs(dotXY) > basisTolerance || math.Abs(dotXZ) > basisTolerance || math.Abs(dotYZ) > basisTolerance {
		return fmt.Errorf("%w: %s axes must be mutually orthogonal", ErrHardwareAssetInvalid, label)
	}

	// Right-handed determinant: det = X · (Y x Z) == +1
	crossYZ := [3]float64{
		b.Y[1]*b.Z[2] - b.Y[2]*b.Z[1],
		b.Y[2]*b.Z[0] - b.Y[0]*b.Z[2],
		b.Y[0]*b.Z[1] - b.Y[1]*b.Z[0],
	}
	det := b.X[0]*crossYZ[0] + b.X[1]*crossYZ[1] + b.X[2]*crossYZ[2]
	if math.Abs(det-1.0) > basisTolerance {
		return fmt.Errorf("%w: %s must be right-handed with det=+1 (got det=%g); mirror is rejected", ErrHardwareAssetInvalid, label, det)
	}

	return nil
}

// ValidateHardwareAssetOrigin enforces structure: finite, bounded values, explicit units,
// and orthonormal right-handed bases for MountFrame and AssetNormalization when present.
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
	if o.MountFrame != nil {
		for i, v := range o.MountFrame.OriginMm {
			if math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > hardwareAssetMMagnitudeCap {
				return nil, fmt.Errorf("%w: origin.mountFrame.originMm[%d] must be finite and within ±%g mm", ErrHardwareAssetInvalid, i, hardwareAssetMMagnitudeCap)
			}
		}
		if err := ValidateHardwareBasis(o.MountFrame.Basis, "origin.mountFrame.basis"); err != nil {
			return nil, err
		}
	}
	if o.AssetNormalization != nil {
		for i, v := range o.AssetNormalization.TranslationMm {
			if math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > hardwareAssetMMagnitudeCap {
				return nil, fmt.Errorf("%w: origin.assetNormalization.translationMm[%d] must be finite and within ±%g mm", ErrHardwareAssetInvalid, i, hardwareAssetMMagnitudeCap)
			}
		}
		if err := ValidateHardwareBasis(o.AssetNormalization.Basis, "origin.assetNormalization.basis"); err != nil {
			return nil, err
		}
	}
	return &o, nil
}

type HardwareAssetPreparationState string

const (
	HardwareAssetPreparationUnprepared HardwareAssetPreparationState = "unprepared"
	HardwareAssetPreparationPrepared   HardwareAssetPreparationState = "prepared"
)

func (r *HardwareAssetRevision) PreparationState() HardwareAssetPreparationState {
	if r.Origin != nil && r.Origin.MountFrame != nil && r.Origin.AssetNormalization != nil {
		return HardwareAssetPreparationPrepared
	}
	return HardwareAssetPreparationUnprepared
}

// ValidateHoleSpacing verifies whether two explicit mounting points match an
// expected hole spacing within a configurable tolerance.
func ValidateHoleSpacing(pointA, pointB [3]float64, expectedSpacingMm float64, toleranceMm float64) (float64, bool) {
	dx := pointB[0] - pointA[0]
	dy := pointB[1] - pointA[1]
	dz := pointB[2] - pointA[2]
	actualDist := math.Sqrt(dx*dx + dy*dy + dz*dz)
	if math.Abs(actualDist-expectedSpacingMm) <= toleranceMm {
		return actualDist, true
	}
	return actualDist, false
}

type DimensionDiscrepancy struct {
	Dimension  string  `json:"dimension"`
	NominalMm  float64 `json:"nominalMm"`
	MeasuredMm float64 `json:"measuredMm"`
	DeltaMm    float64 `json:"deltaMm"`
}

// CompareNominalVsMeasured compares a catalog nominal dimension with a host measured
// dimension using an explicitly provided tolerance. Returns nil if within tolerance.
func CompareNominalVsMeasured(nominal float64, measured float64, toleranceMm float64, dimensionName string) *DimensionDiscrepancy {
	delta := math.Abs(nominal - measured)
	if delta > toleranceMm {
		return &DimensionDiscrepancy{
			Dimension:  dimensionName,
			NominalMm:  nominal,
			MeasuredMm: measured,
			DeltaMm:    delta,
		}
	}
	return nil
}

var (
	ErrHardwareAssetInvalid            = errors.New("hardware asset is invalid")
	ErrHardwareAssetNotFound           = errors.New("hardware asset not found")
	ErrHardwareAssetRevisionNotFound   = errors.New("hardware asset revision not found")
	ErrHardwareAssetSessionNotFound    = errors.New("hardware asset upload session not found")
	ErrHardwareAssetSessionNotPrepared = errors.New("hardware asset upload session is not prepared")
	ErrHardwareAssetRetired            = errors.New("hardware asset is retired")
	// ErrCompositionUnresolvable: a published item's composition references
	// an entity that cannot be resolved (#667 R4). The publish fails closed —
	// references never disappear silently.
	ErrCompositionUnresolvable = errors.New("module composition cannot be resolved for publication")
	// ErrHardwareAssetRevisionConflict: two finalizes raced to append the
	// next revision of the same asset. Typed conflict with a safe retry.
	ErrHardwareAssetRevisionConflict = errors.New("hardware asset revision number conflict; retry the finalize")
	ErrHardwareAssetBytesMissing     = errors.New("hardware asset bytes missing")
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
	SizeBytes      int64                       `json:"sizeBytes,omitempty"`
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
