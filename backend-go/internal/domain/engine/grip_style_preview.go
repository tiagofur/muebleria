package engine

// Grip style preview (#1533, ADR-0009 Amendment 1 §14.7): the workshop's
// «Mueble de 720 → puerta de 680» — the SERVER resolves the formula with the
// A3 edge contract (#1529); React only renders the sentence. The caller (the
// API handler) joins the editor's profile IDs against the catalog and passes
// the resolved discounts here: the canonical reference cabinets mirror the
// datasheet fixtures — one front for the top grip (the reveal shifts the
// position, never the height: H − D exactly) and a 2-front column for the
// between grip ((H − D_top − D_between)/2 each). A rebase EXTENDS the front
// below the body by X mm against the catalog's top reveal, which the
// workshop owns — the preview states the extension, never an invented
// height. Handle consumes nothing.

import (
	"fmt"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// GripStylePreviewSentence resolves ONE furniture type's preview sentence
// from its mode and the discounts resolved against the caller's catalog:
// topDiscount applies at the top edge, betweenDiscount at every between
// edge of the canonical 2-front column. A nil discount with a grip mode
// fails closed — never an invented number.
func GripStylePreviewSentence(heightMm int, mode string, topDiscount, betweenDiscount *int) (string, error) {
	if heightMm <= 0 {
		return "", &domain.GripSnapshotValidationError{
			Code:    "GRIP_SNAPSHOT_INVALID",
			Message: "la altura de referencia debe ser un número entero mayor a 0"}
	}
	switch mode {
	case domain.GripModeHandle:
		return fmt.Sprintf("Mueble de %d → puerta sin descuento (medida de catálogo)", heightMm), nil
	case domain.GripModeBottomOverhang:
		if topDiscount == nil || *topDiscount <= 0 {
			return "", &domain.GripSnapshotValidationError{
				Code:    "GRIP_SNAPSHOT_INVALID",
				Message: "el rebase necesita milímetros mayores a 0 para la vista previa"}
		}
		return fmt.Sprintf("El frente baja %d mm por debajo del cuerpo", *topDiscount), nil
	case domain.GripModeGola:
		if topDiscount == nil || *topDiscount <= 0 {
			return "", &domain.GripSnapshotValidationError{
				Code:    "GRIP_SNAPSHOT_INVALID",
				Message: "el perfil superior no tiene descuento declarado para la vista previa"}
		}
		sentence := fmt.Sprintf("Mueble de %d → puerta de %d", heightMm, heightMm-*topDiscount)
		if betweenDiscount != nil && *betweenDiscount > 0 {
			// Canonical 2-front column (the datasheet fixture): both fronts
			// share the remaining height by ratio 1:1, through the A3
			// contract so the arithmetic never drifts from the resolve.
			resolution, resErr := ResolveOpeningEdgeStack(OpeningEdgeStackInput{
				CabinetHeightMm: float64(heightMm),
				Rows: []OpeningEdgeStackRow{
					{ID: "row-1", Weight: 1}, {ID: "row-2", Weight: 1},
				},
				TopDiscountMm: refFloat(float64(*topDiscount)),
				GapsMm:        []float64{float64(*betweenDiscount)},
				BetweenGrips:  []OpeningEdgeBetweenGrip{{UpperRowID: "row-1", DiscountMm: float64(*betweenDiscount)}},
			})
			if resErr != nil {
				return "", &domain.GripSnapshotValidationError{
					Code:    "GRIP_SNAPSHOT_INVALID",
					Message: "la vista previa no puede resolverse: " + resErr.Message}
			}
			sentence += fmt.Sprintf(" · 2 cajones: %.5g y %.5g mm",
				resolution.Rows[0].HeightMm, resolution.Rows[1].HeightMm)
		}
		return sentence, nil
	default:
		return "", &domain.GripSnapshotValidationError{
			Code:    "GRIP_SNAPSHOT_INVALID",
			Message: "el modo de agarre " + mode + " no existe"}
	}
}

func refFloat(v float64) *float64 { return &v }
