package engine

// Gola profile preview (#1534, ADR-0009 Amendment 1 A2.1/§14.2): the profile
// editor's live sentences — «Mueble de 720: una puerta = 680 · dos frentes
// = 322 y 322 mm» — resolved by the SERVER with the A3 edge contract
// (#1529); React renders them verbatim. The caller (the API handler) passes
// the editor's in-flight fields; no catalog join is needed because the
// discounts ride in the request (nothing is saved yet).
//
// Every line is resolved THROUGH ResolveOpeningEdgeStack with the canonical
// datasheet inputs (reveals 1.5/1.5 and gap 3, the standards the contract
// fixture contracts/openingFrontEdgeStack.contract.json pins) so the editor
// can never drift from what the engine builds. The grip zones swallow the
// reveals there: one front with a top grip = H − D exactly; the two-front
// column without a top grip keeps the reveals ((H − 3 − D)/2 for D=36 →
// 340.5, fixture «sólo gola C entre frentes»). A declared position without
// its discount does NOT block the other line — it reports the missing piece
// (disponible ≠ válido, honest preview), and an over-consuming discount
// fails closed exactly like production resolution.

import (
	"fmt"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// GolaProfilePreviewLine is one resolved sentence for the editor.
type GolaProfilePreviewLine struct {
	// Key names the canonical reference: una_puerta | dos_frentes | falta.
	Key     string `json:"key"`
	Preview string `json:"preview"`
}

const (
	golaProfilePreviewUnaPuerta  = "una_puerta"
	golaProfilePreviewDosFrentes = "dos_frentes"
	golaProfilePreviewFaltaDesc  = "falta"

	// Canonical datasheet standards the contract fixture pins; the editor's
	// preview resolves against the same numbers production does.
	golaPreviewRevealMm = 1.5
	golaPreviewGapMm    = 3.0
)

// GolaProfilePreviewSentences resolves the editor's live preview lines: one
// per declared position, plus the two-front column whenever the between
// position is declared. A declared position without its discount produces
// the honest «falta» line — never an invented height and never a blocked
// whole preview (disponible ≠ válido, A6). An over-consuming discount is
// refused by the same engine rule production uses.
func GolaProfilePreviewSentences(
	heightMm int,
	positions []string,
	topDiscount, betweenDiscount *int,
) ([]GolaProfilePreviewLine, *OpeningResolutionError) {
	if heightMm <= 0 {
		return nil, openingFail(OpeningErrLayoutInvalid,
			"la altura de referencia debe ser un número entero mayor a 0")
	}
	topDeclared := containsStr(positions, domain.GolaPositionTop)
	betweenDeclared := containsStr(positions, domain.GolaPositionBetween)
	if !topDeclared && !betweenDeclared {
		return nil, openingFail(OpeningErrLayoutInvalid,
			"marcá al menos una posición (superior o entre frentes) para la vista previa")
	}

	lines := make([]GolaProfilePreviewLine, 0, 2)
	if topDeclared {
		if topDiscount != nil && *topDiscount > 0 {
			// One front through the resolver: the grip zone swallows the
			// reveals, so the row is H − D exactly (fixture «gola L arriba
			// (40), 1 frente = H − 40»); over-consumption fails closed.
			resolution, resErr := ResolveOpeningEdgeStack(OpeningEdgeStackInput{
				CabinetHeightMm: float64(heightMm),
				TopRevealMm:     golaPreviewRevealMm,
				BottomRevealMm:  golaPreviewRevealMm,
				Rows:            []OpeningEdgeStackRow{{ID: "row-1", Weight: 1}},
				TopDiscountMm:   refFloatIf(topDiscount),
			})
			if resErr != nil {
				return nil, resErr
			}
			lines = append(lines, GolaProfilePreviewLine{
				Key:     golaProfilePreviewUnaPuerta,
				Preview: fmt.Sprintf("Mueble de %d: una puerta = %.5g", heightMm, resolution.Rows[0].HeightMm),
			})
		} else {
			lines = append(lines, GolaProfilePreviewLine{
				Key:     golaProfilePreviewFaltaDesc,
				Preview: "una puerta: falta el descuento superior",
			})
		}
	}
	if betweenDeclared {
		if betweenDiscount != nil && *betweenDiscount > 0 {
			// Canonical 2-front column through the resolver with the fixture
			// inputs: reveals 1.5/1.5 and the between grip consuming its zone
			// (the top discount applies ONLY when the top position is
			// declared with its discount — otherwise the top edge keeps the
			// reveal and the fixture's «sólo gola C» math holds).
			var topForColumn *int
			if topDeclared && topDiscount != nil && *topDiscount > 0 {
				topForColumn = topDiscount
			}
			resolution, resErr := ResolveOpeningEdgeStack(OpeningEdgeStackInput{
				CabinetHeightMm: float64(heightMm),
				TopRevealMm:     golaPreviewRevealMm,
				BottomRevealMm:  golaPreviewRevealMm,
				Rows: []OpeningEdgeStackRow{
					{ID: "row-1", Weight: 1}, {ID: "row-2", Weight: 1},
				},
				GapsMm:        []float64{golaPreviewGapMm},
				TopDiscountMm: refFloatIf(topForColumn),
				BetweenGrips:  []OpeningEdgeBetweenGrip{{UpperRowID: "row-1", DiscountMm: float64(*betweenDiscount)}},
			})
			if resErr != nil {
				return nil, resErr
			}
			lines = append(lines, GolaProfilePreviewLine{
				Key:     golaProfilePreviewDosFrentes,
				Preview: fmt.Sprintf("dos frentes = %.5g y %.5g mm", resolution.Rows[0].HeightMm, resolution.Rows[1].HeightMm),
			})
		} else {
			lines = append(lines, GolaProfilePreviewLine{
				Key:     golaProfilePreviewFaltaDesc,
				Preview: "dos frentes: falta el descuento entre frentes",
			})
		}
	}
	return lines, nil
}

func containsStr(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

func refFloatIf(discount *int) *float64 {
	if discount == nil || *discount <= 0 {
		return nil
	}
	v := float64(*discount)
	return &v
}
