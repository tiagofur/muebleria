package engine

// #1534 — the gola profile editor's live preview: the server resolves the
// datasheet fixtures with the A3 contract; React renders verbatim. Every
// number here mirrors contracts/openingFrontEdgeStack.contract.json.

import (
	"strings"
	"testing"
)

func TestGolaProfilePreviewLTopExact(t *testing.T) {
	forty := 40
	lines, resErr := GolaProfilePreviewSentences(720, []string{"top"}, &forty, nil)
	if resErr != nil {
		t.Fatalf("preview: %s (%s)", resErr.Code, resErr.Message)
	}
	if len(lines) != 1 || lines[0].Key != "una_puerta" {
		t.Fatalf("lines drifted: %+v", lines)
	}
	// The datasheet fixture: 720 − 40 = 680 exactly (the grip zone swallows
	// the reveals — fixture «gola L arriba (40), 1 frente = H − 40»).
	if lines[0].Preview != "Mueble de 720: una puerta = 680" {
		t.Fatalf("preview = %q", lines[0].Preview)
	}
}

func TestGolaProfilePreviewItalianTopPlusBetween(t *testing.T) {
	thirtySix := 36
	lines, resErr := GolaProfilePreviewSentences(720, []string{"top", "between"}, &thirtySix, &thirtySix)
	if resErr != nil {
		t.Fatalf("preview: %s", resErr.Message)
	}
	if len(lines) != 2 || lines[0].Key != "una_puerta" || lines[1].Key != "dos_frentes" {
		t.Fatalf("lines drifted: %+v", lines)
	}
	if lines[0].Preview != "Mueble de 720: una puerta = 684" {
		t.Fatalf("una puerta = %q, want 684 (720 − 36)", lines[0].Preview)
	}
	// The datasheet fixture for the Italian: (720 − 36 − 36)/2 = 324 per
	// front — fixture «italiana: arriba 36 + entre 36, 2 frentes».
	if !strings.Contains(lines[1].Preview, "324") {
		t.Fatalf("dos frentes = %q, want 324", lines[1].Preview)
	}
	// The sentence names no cross-section: the same line serves L, C and the
	// italiana (the request carries no material — neutral copy, A-MIN-3).
	if strings.Contains(lines[1].Preview, "C") {
		t.Fatalf("dos frentes must not name a cross-section: %q", lines[1].Preview)
	}
}

func TestGolaProfilePreviewCBetweenOnly(t *testing.T) {
	thirtySix := 36
	lines, resErr := GolaProfilePreviewSentences(720, []string{"between"}, nil, &thirtySix)
	if resErr != nil {
		t.Fatalf("preview: %s", resErr.Message)
	}
	if len(lines) != 1 || lines[0].Key != "dos_frentes" {
		t.Fatalf("lines drifted: %+v", lines)
	}
	// No top grip: the top edge keeps its reveal — fixture «sólo gola C
	// entre frentes (36), 2 frentes = (H − 39)/2» → 340.5 (NOT 342).
	if !strings.Contains(lines[0].Preview, "340.5") {
		t.Fatalf("dos frentes = %q, want 340.5", lines[0].Preview)
	}
}

func TestGolaProfilePreviewLTopPlusCBetween(t *testing.T) {
	forty := 40
	thirtySix := 36
	lines, resErr := GolaProfilePreviewSentences(720, []string{"top", "between"}, &forty, &thirtySix)
	if resErr != nil {
		t.Fatalf("preview: %s", resErr.Message)
	}
	// Fixture «gola L arriba + C entre frentes, 2 frentes = (H − 76)/2».
	if !strings.Contains(lines[1].Preview, "322") {
		t.Fatalf("dos frentes = %q, want 322", lines[1].Preview)
	}
}

func TestGolaProfilePreviewMissingDiscountIsAHonestLine(t *testing.T) {
	// Top declared without its discount: that line reports the missing
	// piece; the other declared position still resolves.
	between := 36
	lines, resErr := GolaProfilePreviewSentences(720, []string{"top", "between"}, nil, &between)
	if resErr != nil {
		t.Fatalf("preview: %s", resErr.Message)
	}
	if lines[0].Key != "falta" || !strings.Contains(lines[0].Preview, "falta el descuento superior") {
		t.Fatalf("missing top line drifted: %+v", lines[0])
	}
	if !strings.Contains(lines[1].Preview, "340.5") {
		t.Fatalf("the between line must resolve without the top discount: %+v", lines[1])
	}

	// No discounts at all, both positions: two honest lines, nothing invented.
	lines, resErr = GolaProfilePreviewSentences(720, []string{"top", "between"}, nil, nil)
	if resErr != nil {
		t.Fatalf("preview: %s", resErr.Message)
	}
	if lines[0].Key != "falta" || lines[1].Key != "falta" {
		t.Fatalf("missing-discount lines drifted: %+v", lines)
	}
}

func TestGolaProfilePreviewRejectsInvalidInput(t *testing.T) {
	if _, resErr := GolaProfilePreviewSentences(0, []string{"top"}, nil, nil); resErr == nil {
		t.Fatal("height 0 must be rejected")
	}
	if _, resErr := GolaProfilePreviewSentences(720, nil, nil, nil); resErr == nil ||
		resErr.Code != OpeningErrLayoutInvalid {
		t.Fatal("no declared position must be rejected")
	}
	// A ZERO discount is treated as missing — the honest line, never a
	// resolved H − 0 that pretends a grip exists.
	zero := 0
	lines, resErr := GolaProfilePreviewSentences(720, []string{"top"}, &zero, nil)
	if resErr != nil {
		t.Fatalf("zero discount must not error: %s", resErr.Message)
	}
	if lines[0].Key != "falta" || !strings.Contains(lines[0].Preview, "falta el descuento superior") {
		t.Fatalf("a zero discount must produce the honest missing line: %+v", lines[0])
	}
}

func TestGolaProfilePreviewOverConsumptionFailsClosed(t *testing.T) {
	// A discount that eats the whole cabinet goes through the same resolver
	// rule production uses — the honest error, never a negative door
	// (A/B-MIN: one line invented «-80» while the other failed closed).
	eightHundred := 800
	if _, resErr := GolaProfilePreviewSentences(720, []string{"top"}, &eightHundred, nil); resErr == nil {
		t.Fatal("a discount larger than the height must fail closed")
	}
	if _, resErr := GolaProfilePreviewSentences(720, []string{"between"}, nil, &eightHundred); resErr == nil {
		t.Fatal("an over-consuming between discount must fail closed")
	}
}
