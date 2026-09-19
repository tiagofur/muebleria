package domain_test

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// GLB ingestion validation contract (#669).
//
// contracts/fixtures/glb-validation-cases.json drives both this suite and the
// TS domain reader suite with the same mutations against the committed parity
// GLB, so the upload-side Go validator and the consumption-side TS reader
// enforce the same self-containment policy.

type glbValidationCase struct {
	Name     string             `json:"name"`
	Expect   string             `json:"expect"`
	Mutation *glbCaseMutation   `json:"mutation"`
}

type glbCaseMutation struct {
	Type         string          `json:"type"`
	Offset       int             `json:"offset"`
	Hex          string          `json:"hex"`
	BytesFromEnd int             `json:"bytesFromEnd"`
	Path         string          `json:"path"`
	Value        json.RawMessage `json:"value"`
}

type glbValidationContract struct {
	Fixture string             `json:"fixture"`
	Cases   []glbValidationCase `json:"cases"`
}

func applyGlbMutation(t *testing.T, original []byte, mutation *glbCaseMutation) []byte {
	t.Helper()
	if mutation == nil {
		return original
	}
	switch mutation.Type {
	case "bytes":
		patch, err := hex.DecodeString(strings.TrimPrefix(mutation.Hex, "0x"))
		if err != nil {
			t.Fatalf("decode hex patch: %v", err)
		}
		mutated := make([]byte, len(original))
		copy(mutated, original)
		if mutation.Offset+len(patch) > len(mutated) {
			t.Fatalf("patch overruns container")
		}
		copy(mutated[mutation.Offset:], patch)
		return mutated
	case "truncate":
		if mutation.BytesFromEnd <= 0 || mutation.BytesFromEnd >= len(original) {
			t.Fatalf("invalid truncate amount")
		}
		return original[:len(original)-mutation.BytesFromEnd]
	case "json-set":
		jsonChunk, binChunk, offset, length := splitGlbChunks(t, original)
		var doc map[string]any
		if err := json.Unmarshal(jsonChunk, &doc); err != nil {
			t.Fatalf("parse JSON chunk: %v", err)
		}
		var value any
		if err := json.Unmarshal(mutation.Value, &value); err != nil {
			t.Fatalf("parse mutation value: %v", err)
		}
		setJSONPath(t, doc, mutation.Path, value)
		rewritten, err := json.Marshal(doc)
		if err != nil {
			t.Fatalf("re-marshal JSON: %v", err)
		}
		return rebuildGlbContainer(t, rewritten, binChunk, offset, length)
	default:
		t.Fatalf("unknown mutation type %q", mutation.Type)
		return nil
	}
}

func splitGlbChunks(t *testing.T, container []byte) (jsonChunk, binChunk []byte, jsonOffset, jsonLength int) {
	t.Helper()
	jsonLength = int(binary.LittleEndian.Uint32(container[12:16]))
	jsonOffset = 20
	binHeaderOffset := 20 + jsonLength
	binLength := 0
	if binHeaderOffset+8 <= len(container) {
		binLength = int(binary.LittleEndian.Uint32(container[binHeaderOffset : binHeaderOffset+4]))
		binChunk = container[binHeaderOffset+8 : binHeaderOffset+8+binLength]
	}
	return container[jsonOffset : jsonOffset+jsonLength], binChunk, jsonOffset, jsonLength
}

func rebuildGlbContainer(t *testing.T, jsonChunk, binChunk []byte, originalJSONOffset, originalJSONLength int) []byte {
	t.Helper()
	_ = originalJSONOffset
	_ = originalJSONLength
	pad := func(data []byte, fill byte) []byte {
		padding := (4 - len(data)%4) % 4
		return append(data, bytes.Repeat([]byte{fill}, padding)...)
	}
	jsonPadded := pad(jsonChunk, 0x20)
	binPadded := pad(binChunk, 0x00)
	total := 12 + 8 + len(jsonPadded) + 8 + len(binPadded)
	out := make([]byte, 0, total)
	header := make([]byte, 12)
	binary.LittleEndian.PutUint32(header[0:4], 0x46546c67)
	binary.LittleEndian.PutUint32(header[4:8], 2)
	binary.LittleEndian.PutUint32(header[8:12], uint32(total))
	out = append(out, header...)
	chunkHeader := make([]byte, 8)
	binary.LittleEndian.PutUint32(chunkHeader[0:4], uint32(len(jsonPadded)))
	binary.LittleEndian.PutUint32(chunkHeader[4:8], 0x4e4f534a)
	out = append(out, chunkHeader...)
	out = append(out, jsonPadded...)
	binary.LittleEndian.PutUint32(chunkHeader[0:4], uint32(len(binPadded)))
	binary.LittleEndian.PutUint32(chunkHeader[4:8], 0x004e4942)
	out = append(out, chunkHeader...)
	out = append(out, binPadded...)
	return out
}

func setJSONPath(t *testing.T, doc map[string]any, path string, value any) {
	t.Helper()
	segments := strings.Split(path, ".")
	var current any = doc
	for i := 0; i < len(segments)-1; i++ {
		key := segments[i]
		object, ok := current.(map[string]any)
		if !ok {
			t.Fatalf("path %q: segment %q is not an object", path, key)
		}
		next, ok := object[key]
		if !ok {
			t.Fatalf("path %q missing segment %q", path, key)
		}
		if i+1 < len(segments) && jsonSegmentIsIndex(segments[i+1]) {
			array, ok := next.([]any)
			if !ok {
				t.Fatalf("path %q: segment %q is not an array", path, key)
			}
			index := int(parseJSONIndex(t, segments[i+1]))
			if index < 0 || index >= len(array) {
				t.Fatalf("path %q: index %d out of range", path, index)
			}
			current = array[index]
			i++ // the index segment is consumed here
			continue
		}
		current = next
	}
	last, ok := current.(map[string]any)
	if !ok {
		t.Fatalf("path %q: final container is not an object", path)
	}
	last[segments[len(segments)-1]] = value
}

func jsonSegmentIsIndex(segment string) bool {
	return segment != "" && strings.TrimLeft(segment, "0123456789") == ""
}

func parseJSONIndex(t *testing.T, segment string) int64 {
	t.Helper()
	var index int64
	if _, err := fmt.Sscanf(segment, "%d", &index); err != nil {
		t.Fatalf("invalid array index %q", segment)
	}
	return index
}

func TestGlbContainerValidationContract(t *testing.T) {
	contractRaw, err := os.ReadFile("../../../contracts/fixtures/glb-validation-cases.json")
	if err != nil {
		t.Fatalf("read validation contract: %v", err)
	}
	var contract glbValidationContract
	if err := json.Unmarshal(contractRaw, &contract); err != nil {
		t.Fatalf("parse validation contract: %v", err)
	}
	original, err := os.ReadFile(filepath.Join("../../../contracts/fixtures", contract.Fixture))
	if err != nil {
		t.Fatalf("read GLB fixture: %v", err)
	}

	for _, testCase := range contract.Cases {
		t.Run(testCase.Name, func(t *testing.T) {
			mutated := applyGlbMutation(t, original, testCase.Mutation)
			summary, err := domain.ValidateGlbContainerStructure(bytes.NewReader(mutated), domain.DefaultGlbValidationLimits())
			if testCase.Expect == "valid" {
				if err != nil {
					t.Fatalf("expected valid, got error: %v", err)
				}
				if summary.Triangles <= 0 || summary.Vertices <= 0 {
					t.Fatalf("summary must observe geometry: %+v", summary)
				}
			} else {
				if err == nil {
					t.Fatalf("expected rejection, got summary %+v", summary)
				}
				if !strings.Contains(err.Error(), "recurso de herraje inválido") && !strings.Contains(err.Error(), "hardware asset") {
					// typed sentinel check: every rejection must carry the
					// hardware asset error sentinel.
					t.Fatalf("rejection must use the typed sentinel, got: %v", err)
				}
			}
		})
	}
}
