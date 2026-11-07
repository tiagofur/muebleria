package engine

// #1533 — the grip style preview: the server resolves «Mueble de 720 →
// puerta de 680» with the A3 contract; React renders the sentence verbatim.

import (
	"strings"
	"testing"
)

func TestGripStylePreviewSentenceGolaTopExact(t *testing.T) {
	forty := 40
	sentence, err := GripStylePreviewSentence(720, "gola", &forty, nil)
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	// The datasheet fixture: 720 − 40 = 680 exactly (the reveal cancels out).
	if sentence != "Mueble de 720 → puerta de 680" {
		t.Fatalf("preview = %q", sentence)
	}
}

func TestGripStylePreviewSentenceBetweenColumnUsesTheEngine(t *testing.T) {
	top, between := 40, 36
	sentence, err := GripStylePreviewSentence(720, "gola", &top, &between)
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	// The datasheet fixture: (720 − 40 − 36)/2 = 322 per front.
	if !strings.Contains(sentence, "322") || !strings.Contains(sentence, "2 cajones") {
		t.Fatalf("between column preview = %q", sentence)
	}
}

func TestGripStylePreviewSentenceHandleAndRebase(t *testing.T) {
	twenty := 20
	handle, err := GripStylePreviewSentence(720, "handle", nil, nil)
	if err != nil {
		t.Fatalf("handle: %v", err)
	}
	if handle != "Mueble de 720 → puerta sin descuento (medida de catálogo)" {
		t.Fatalf("handle preview = %q", handle)
	}
	// A rebase EXTENDS below the body; the preview states the extension
	// against the catalog's top reveal (workshop-owned), never an invented
	// height.
	rebase, err := GripStylePreviewSentence(720, "bottom_overhang", &twenty, nil)
	if err != nil {
		t.Fatalf("rebase: %v", err)
	}
	if rebase != "El frente baja 20 mm por debajo del cuerpo" {
		t.Fatalf("rebase preview = %q", rebase)
	}
}

func TestGripStylePreviewSentenceRejectsInvalidInput(t *testing.T) {
	if _, err := GripStylePreviewSentence(0, "gola", nil, nil); err == nil {
		t.Fatal("height 0 must be rejected")
	}
	zero := 0
	if _, err := GripStylePreviewSentence(720, "gola", &zero, nil); err == nil ||
		!strings.Contains(err.Error(), "descuento") {
		t.Fatalf("a gola without its discount must be rejected, got %v", err)
	}
	if _, err := GripStylePreviewSentence(720, "tirador", nil, nil); err == nil {
		t.Fatal("an unknown mode must be rejected")
	}
}
