package domain

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"strings"
)

// GLB container structural validation (#669).
//
// The upload/publication frontier must prove that a GLB revision is a
// self-contained glTF 2.0 container before the immutable revision exists:
// container layout, embedded buffer (no external URIs anywhere), embedded
// images only, no required extensions, triangle-only primitives with POSITION
// attributes and structural limits. The TS domain reader
// (packages/domain/src/glbRepresentation.ts) enforces the same rules on the
// consumption side; contracts/fixtures/glb-validation-cases.json drives both
// suites with the same mutations so the two validators cannot drift.

const (
	glbMagic         = 0x46546c67
	glbChunkTypeJSON = 0x4e4f534a
	glbChunkTypeBIN  = 0x004e4942
	glbComponentFloat = 5126
	glbModeTriangles = 4
)

// GlbValidationLimits bounds inspection cost and resource budgets. They are
// configurable proposals (spec §6); the defaults are generous enough for
// furniture hardware and tight enough to stop pathological files.
type GlbValidationLimits struct {
	MaxJSONBytes  int64
	MaxBufferByes int64
	MaxTriangles  int64
	MaxMeshes     int64
	MaxNodes      int64
	MaxMaterials  int64
}

func DefaultGlbValidationLimits() GlbValidationLimits {
	return GlbValidationLimits{
		MaxJSONBytes:  8 << 20,  // 8 MiB of glTF JSON is far beyond any furniture asset
		MaxBufferByes: 512 << 20, // BIN chunk cap; the upload size cap stays stricter
		MaxTriangles:  2_000_000,
		MaxMeshes:     512,
		MaxNodes:      4_096,
		MaxMaterials:  256,
	}
}

// GlbDocumentSummary records what the validator observed; finalize stores it
// in diagnostics/evidence so "validated" is a checkable fact, not a flag.
type GlbDocumentSummary struct {
	Generator   string `json:"generator"`
	Scenes      int    `json:"scenes"`
	Nodes       int    `json:"nodes"`
	Meshes      int    `json:"meshes"`
	Materials   int    `json:"materials"`
	Accessors   int    `json:"accessors"`
	Triangles   int64  `json:"triangles"`
	Vertices    int64  `json:"vertices"`
	BufferBytes int64  `json:"bufferBytes"`
}

type glbJSONDocument struct {
	Asset struct {
		Version   *string `json:"version"`
		Generator *string `json:"generator"`
	} `json:"asset"`
	Scenes             []json.RawMessage   `json:"scenes"`
	Nodes              []json.RawMessage   `json:"nodes"`
	Meshes             []glbJSONMesh       `json:"meshes"`
	Materials          []json.RawMessage   `json:"materials"`
	Accessors          []glbJSONAccessor   `json:"accessors"`
	BufferViews        []glbJSONBufferView `json:"bufferViews"`
	Buffers            []glbJSONBuffer     `json:"buffers"`
	Images             []glbJSONImage      `json:"images"`
	ExtensionsRequired []string            `json:"extensionsRequired"`
	ExtensionsUsed     []string            `json:"extensionsUsed"`
	Skins              []json.RawMessage   `json:"skins"`
	Animations         []json.RawMessage   `json:"animations"`
}

type glbJSONMesh struct {
	Primitives []glbJSONPrimitive `json:"primitives"`
	Weights    []float64          `json:"weights"`
}

type glbJSONPrimitive struct {
	Attributes struct {
		Position *int `json:"POSITION"`
	} `json:"attributes"`
	Indices *int              `json:"indices"`
	Mode    *int              `json:"mode"`
	Targets []json.RawMessage `json:"targets"`
}

type glbJSONAccessor struct {
	BufferView    *int       `json:"bufferView"`
	ByteOffset    *int64     `json:"byteOffset"`
	ComponentType *int       `json:"componentType"`
	Count         *int64     `json:"count"`
	Type          *string    `json:"type"`
	Min           *[]float64 `json:"min"`
	Max           *[]float64 `json:"max"`
}

type glbJSONBufferView struct {
	Buffer     *int   `json:"buffer"`
	ByteOffset *int64 `json:"byteOffset"`
	ByteLength *int64 `json:"byteLength"`
}

type glbJSONBuffer struct {
	ByteLength *int64 `json:"byteLength"`
	URI        *string `json:"uri"`
}

type glbJSONImage struct {
	URI        *string `json:"uri"`
	BufferView *int    `json:"bufferView"`
}

// ValidateGlbContainerStructure parses the container incrementally (only the
// JSON chunk is held in memory, bounded by limits.MaxJSONBytes) and enforces
// the #669 self-containment policy. Returns a summary for provenance.
func ValidateGlbContainerStructure(r io.Reader, limits GlbValidationLimits) (*GlbDocumentSummary, error) {
	if limits.MaxJSONBytes <= 0 || limits.MaxBufferByes <= 0 {
		return nil, fmt.Errorf("%w: GLB validation limits must be positive", ErrHardwareAssetInvalid)
	}

	header := make([]byte, 12)
	if _, err := io.ReadFull(r, header); err != nil {
		return nil, fmt.Errorf("%w: GLB too short for header: %v", ErrHardwareAssetInvalid, err)
	}
	if magic := binary.LittleEndian.Uint32(header[0:4]); magic != glbMagic {
		return nil, fmt.Errorf("%w: invalid GLB magic 0x%x (expected glTF)", ErrHardwareAssetInvalid, magic)
	}
	if version := binary.LittleEndian.Uint32(header[4:8]); version != 2 {
		return nil, fmt.Errorf("%w: unsupported GLB container version %d (expected 2)", ErrHardwareAssetInvalid, version)
	}
	total := int64(binary.LittleEndian.Uint32(header[8:12]))

	var jsonText []byte
	var binLength int64
	consumed := int64(12)
	for {
		chunkHeader := make([]byte, 8)
		if _, err := io.ReadFull(r, chunkHeader); err != nil {
			if err == io.EOF || err == io.ErrUnexpectedEOF {
				break
			}
			return nil, fmt.Errorf("%w: GLB chunk header read failed: %v", ErrHardwareAssetInvalid, err)
		}
		consumed += 8
		chunkLength := int64(binary.LittleEndian.Uint32(chunkHeader[0:4]))
		chunkType := binary.LittleEndian.Uint32(chunkHeader[4:8])
		if chunkLength < 0 || chunkLength%4 != 0 {
			return nil, fmt.Errorf("%w: GLB chunk length must be 4-byte aligned", ErrHardwareAssetInvalid)
		}
		switch chunkType {
		case glbChunkTypeJSON:
			if jsonText != nil {
				return nil, fmt.Errorf("%w: GLB carries more than one JSON chunk", ErrHardwareAssetInvalid)
			}
			if chunkLength > limits.MaxJSONBytes {
				return nil, fmt.Errorf("%w: GLB JSON chunk %d bytes exceeds inspection budget %d", ErrHardwareAssetInvalid, chunkLength, limits.MaxJSONBytes)
			}
			jsonText = make([]byte, chunkLength)
			if _, err := io.ReadFull(r, jsonText); err != nil {
				return nil, fmt.Errorf("%w: GLB JSON chunk truncated: %v", ErrHardwareAssetInvalid, err)
			}
		case glbChunkTypeBIN:
			discarded, err := io.CopyN(io.Discard, r, chunkLength)
			if err != nil && discarded < chunkLength {
				return nil, fmt.Errorf("%w: GLB BIN chunk truncated: %v", ErrHardwareAssetInvalid, err)
			}
			binLength = chunkLength
		default:
			// Unknown chunk types are allowed by the glTF spec; skip them.
			if _, err := io.CopyN(io.Discard, r, chunkLength); err != nil {
				return nil, fmt.Errorf("%w: GLB chunk truncated: %v", ErrHardwareAssetInvalid, err)
			}
		}
		consumed += chunkLength
	}
	if consumed != total {
		return nil, fmt.Errorf("%w: GLB declared length %d does not match byte count %d", ErrHardwareAssetInvalid, total, consumed)
	}
	if jsonText == nil {
		return nil, fmt.Errorf("%w: GLB missing JSON chunk", ErrHardwareAssetInvalid)
	}

	var doc glbJSONDocument
	if err := json.Unmarshal(jsonText, &doc); err != nil {
		return nil, fmt.Errorf("%w: GLB JSON chunk is not valid JSON: %v", ErrHardwareAssetInvalid, err)
	}
	if doc.Asset.Version == nil || (*doc.Asset.Version != "2.0") {
		return nil, fmt.Errorf("%w: glTF asset.version must be \"2.0\"", ErrHardwareAssetInvalid)
	}
	if len(doc.Scenes) == 0 {
		return nil, fmt.Errorf("%w: glTF document must declare at least one scene", ErrHardwareAssetInvalid)
	}
	if len(doc.Nodes) == 0 {
		return nil, fmt.Errorf("%w: glTF document must declare at least one node", ErrHardwareAssetInvalid)
	}
	if len(doc.Meshes) == 0 {
		return nil, fmt.Errorf("%w: glTF document must declare at least one mesh", ErrHardwareAssetInvalid)
	}
	if len(doc.Buffers) != 1 {
		return nil, fmt.Errorf("%w: glTF document must declare exactly one buffer", ErrHardwareAssetInvalid)
	}
	if uri := doc.Buffers[0].URI; uri != nil && *uri != "" {
		return nil, fmt.Errorf("%w: GLB buffer must be embedded (buffer.uri is forbidden)", ErrHardwareAssetInvalid)
	}
	if binLength == 0 {
		return nil, fmt.Errorf("%w: GLB missing BIN chunk for embedded buffer", ErrHardwareAssetInvalid)
	}
	declaredBufferLength := int64(0)
	if doc.Buffers[0].ByteLength != nil {
		declaredBufferLength = *doc.Buffers[0].ByteLength
	}
	if declaredBufferLength <= 0 || declaredBufferLength > binLength {
		return nil, fmt.Errorf("%w: glTF buffer.byteLength %d is invalid against BIN chunk %d", ErrHardwareAssetInvalid, declaredBufferLength, binLength)
	}
	if binLength > limits.MaxBufferByes {
		return nil, fmt.Errorf("%w: GLB BIN chunk %d exceeds budget %d", ErrHardwareAssetInvalid, binLength, limits.MaxBufferByes)
	}

	for index, image := range doc.Images {
		if image.URI != nil && *image.URI != "" {
			return nil, fmt.Errorf("%w: images[%d].uri must be omitted (embedded bufferView only)", ErrHardwareAssetInvalid, index)
		}
		if image.BufferView == nil {
			return nil, fmt.Errorf("%w: images[%d] must reference an embedded bufferView", ErrHardwareAssetInvalid, index)
		}
	}
	if len(doc.ExtensionsRequired) > 0 {
		return nil, fmt.Errorf("%w: glTF required extensions are not supported: %s", ErrHardwareAssetInvalid, strings.Join(doc.ExtensionsRequired, ", "))
	}

	// #669 supported subset: RIGID STATIC hardware only (parity with the TS
	// consumption validator). Skins, animations, morph targets and ANY used
	// extension are rejected fail-closed: the renderer flattens node
	// transforms into baked geometry and cannot preserve dynamic behaviour,
	// so a partially-understood file must never become an "exact" revision.
	if len(doc.Skins) > 0 {
		return nil, fmt.Errorf("%w: glTF skins are not supported (rigid static assets only)", ErrHardwareAssetInvalid)
	}
	if len(doc.Animations) > 0 {
		return nil, fmt.Errorf("%w: glTF animations are not supported (rigid static assets only)", ErrHardwareAssetInvalid)
	}
	if len(doc.ExtensionsUsed) > 0 {
		return nil, fmt.Errorf("%w: glTF extensions are not supported (allowed list is empty for this increment): %s", ErrHardwareAssetInvalid, strings.Join(doc.ExtensionsUsed, ", "))
	}
	for meshIndex := range doc.Meshes {
		if len(doc.Meshes[meshIndex].Weights) > 0 {
			return nil, fmt.Errorf("%w: meshes[%d].weights (morph targets) are not supported", ErrHardwareAssetInvalid, meshIndex)
		}
		for primIndex := range doc.Meshes[meshIndex].Primitives {
			if len(doc.Meshes[meshIndex].Primitives[primIndex].Targets) > 0 {
				return nil, fmt.Errorf("%w: meshes[%d].primitives[%d].targets (morph targets) are not supported", ErrHardwareAssetInvalid, meshIndex, primIndex)
			}
		}
	}

	if int64(len(doc.Meshes)) > limits.MaxMeshes {
		return nil, fmt.Errorf("%w: mesh count %d exceeds limit %d", ErrHardwareAssetInvalid, len(doc.Meshes), limits.MaxMeshes)
	}
	if int64(len(doc.Nodes)) > limits.MaxNodes {
		return nil, fmt.Errorf("%w: node count %d exceeds limit %d", ErrHardwareAssetInvalid, len(doc.Nodes), limits.MaxNodes)
	}
	if int64(len(doc.Materials)) > limits.MaxMaterials {
		return nil, fmt.Errorf("%w: material count %d exceeds limit %d", ErrHardwareAssetInvalid, len(doc.Materials), limits.MaxMaterials)
	}

	summary := &GlbDocumentSummary{
		Scenes:      len(doc.Scenes),
		Nodes:       len(doc.Nodes),
		Meshes:      len(doc.Meshes),
		Materials:   len(doc.Materials),
		Accessors:   len(doc.Accessors),
		BufferBytes: declaredBufferLength,
	}
	if doc.Asset.Generator != nil {
		summary.Generator = *doc.Asset.Generator
	}

	var triangles int64
	var vertices int64
	for meshIndex := range doc.Meshes {
		mesh := &doc.Meshes[meshIndex]
		if len(mesh.Primitives) == 0 {
			return nil, fmt.Errorf("%w: meshes[%d] must declare primitives", ErrHardwareAssetInvalid, meshIndex)
		}
		for primIndex := range mesh.Primitives {
			primitive := &mesh.Primitives[primIndex]
			if primitive.Mode != nil && *primitive.Mode != glbModeTriangles {
				return nil, fmt.Errorf("%w: meshes[%d].primitives[%d].mode %d is not supported (triangles only)", ErrHardwareAssetInvalid, meshIndex, primIndex, *primitive.Mode)
			}
			if primitive.Attributes.Position == nil {
				return nil, fmt.Errorf("%w: meshes[%d].primitives[%d] must declare POSITION", ErrHardwareAssetInvalid, meshIndex, primIndex)
			}
			positionIndex := *primitive.Attributes.Position
			positionAccessor, err := glbAccessorAt(doc.Accessors, positionIndex)
			if err != nil {
				return nil, fmt.Errorf("%w: meshes[%d].primitives[%d]: %v", ErrHardwareAssetInvalid, meshIndex, primIndex, err)
			}
			if positionAccessor.ComponentType == nil || *positionAccessor.ComponentType != glbComponentFloat {
				return nil, fmt.Errorf("%w: accessor %d componentType must be FLOAT (5126)", ErrHardwareAssetInvalid, positionIndex)
			}
			if positionAccessor.Type == nil || *positionAccessor.Type != "VEC3" {
				return nil, fmt.Errorf("%w: accessor %d type must be VEC3", ErrHardwareAssetInvalid, positionIndex)
			}
			if err := glbCheckAccessorBounds(doc, positionIndex, binLength, 12); err != nil {
				return nil, err
			}
			if positionAccessor.Count != nil {
				vertices += *positionAccessor.Count
			}
			if primitive.Indices != nil {
				indexAccessor, err := glbAccessorAt(doc.Accessors, *primitive.Indices)
				if err != nil {
					return nil, fmt.Errorf("%w: meshes[%d].primitives[%d]: %v", ErrHardwareAssetInvalid, meshIndex, primIndex, err)
				}
				indexStride := 4
				if indexAccessor.ComponentType != nil && *indexAccessor.ComponentType == 5123 {
					indexStride = 2
				}
				if err := glbCheckAccessorBounds(doc, *primitive.Indices, binLength, int64(indexStride)); err != nil {
					return nil, err
				}
				if indexAccessor.Count != nil {
					triangles += *indexAccessor.Count / 3
				}
			} else if positionAccessor.Count != nil {
				triangles += *positionAccessor.Count / 3
			}
		}
	}
	if vertices == 0 {
		return nil, fmt.Errorf("%w: GLB document exposes no POSITION vertices", ErrHardwareAssetInvalid)
	}
	if triangles > limits.MaxTriangles {
		return nil, fmt.Errorf("%w: triangle count %d exceeds limit %d", ErrHardwareAssetInvalid, triangles, limits.MaxTriangles)
	}
	summary.Triangles = triangles
	summary.Vertices = vertices
	return summary, nil
}

func glbAccessorAt(accessors []glbJSONAccessor, index int) (*glbJSONAccessor, error) {
	if index < 0 || index >= len(accessors) {
		return nil, fmt.Errorf("accessor %d not found", index)
	}
	return &accessors[index], nil
}

// glbCheckAccessorBounds validates that the accessor's byte range stays inside
// its bufferView and the embedded buffer, without reading the BIN payload.
func glbCheckAccessorBounds(doc glbJSONDocument, accessorIndex int, binLength int64, elementSize int64) error {
	accessor, err := glbAccessorAt(doc.Accessors, accessorIndex)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrHardwareAssetInvalid, err)
	}
	if accessor.BufferView == nil {
		return fmt.Errorf("%w: accessor %d must reference a bufferView", ErrHardwareAssetInvalid, accessorIndex)
	}
	viewIndex := *accessor.BufferView
	if viewIndex < 0 || viewIndex >= len(doc.BufferViews) {
		return fmt.Errorf("%w: accessor %d references unknown bufferView %d", ErrHardwareAssetInvalid, accessorIndex, viewIndex)
	}
	view := doc.BufferViews[viewIndex]
	if view.Buffer != nil && *view.Buffer != 0 {
		return fmt.Errorf("%w: accessors must reference the embedded buffer 0", ErrHardwareAssetInvalid)
	}
	viewOffset := int64(0)
	if view.ByteOffset != nil {
		viewOffset = *view.ByteOffset
	}
	viewLength := int64(0)
	if view.ByteLength != nil {
		viewLength = *view.ByteLength
	}
	byteOffset := int64(0)
	if accessor.ByteOffset != nil {
		byteOffset = *accessor.ByteOffset
	}
	count := int64(0)
	if accessor.Count != nil {
		count = *accessor.Count
	}
	if count <= 0 {
		return fmt.Errorf("%w: accessor %d count must be a positive integer", ErrHardwareAssetInvalid, accessorIndex)
	}
	byteEnd := viewOffset + byteOffset + count*elementSize
	if byteEnd > viewOffset+viewLength || byteEnd > binLength {
		return fmt.Errorf("%w: accessor %d range exceeds its bufferView", ErrHardwareAssetInvalid, accessorIndex)
	}
	if accessor.Min != nil {
		for _, v := range *accessor.Min {
			if math.IsNaN(v) || math.IsInf(v, 0) {
				return fmt.Errorf("%w: accessor %d min is not finite", ErrHardwareAssetInvalid, accessorIndex)
			}
		}
	}
	if accessor.Max != nil {
		for _, v := range *accessor.Max {
			if math.IsNaN(v) || math.IsInf(v, 0) {
				return fmt.Errorf("%w: accessor %d max is not finite", ErrHardwareAssetInvalid, accessorIndex)
			}
		}
	}
	return nil
}
