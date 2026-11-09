package engine

// #1534 — the gola profile editor's live preview: the server resolves the
// datasheet fixtures with the A3 contract; React renders verbatim.

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
	// The datasheet fixture: 720 − 40 = 680 exactly (the reveal cancels).
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
	// The datasheet fixture for the Italian: (720 − 36 − 36)/2 = 324 per front.
	if !strings.Contains(lines[1].Preview, "324") {
		t.Fatalf("dos frentes = %q, want 324", lines[1].Preview)
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
	// No top grip: the top edge is the cabinet height → (720 − 36)/2 = 342.
	if !strings.Contains(lines[0].Preview, "342") {
		t.Fatalf("dos frentes = %q, want 342", lines[0].Preview)
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
	if !strings.Contains(lines[1].Preview, "342") {
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
