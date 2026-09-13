package domain

import "time"

const CommercialProjectionSchema = "granete.commercial-projection.v1"

type CommercialProjectionStatus string

const (
	CommercialProjectionCurrent    CommercialProjectionStatus = "current"
	CommercialProjectionIncomplete CommercialProjectionStatus = "incomplete"
)

type CommercialProjectionAmounts struct {
	MaterialsCost  *float64 `json:"materialsCost"`
	EdgeTotal      *float64 `json:"edgeTotal"`
	HardwareTotal  *float64 `json:"hardwareTotal"`
	DirectCost     *float64 `json:"directCost"`
	LaborModular   *float64 `json:"laborModular"`
	LaborFixedCost *float64 `json:"laborFixedCost"`
	MarginFactor   *float64 `json:"marginFactor"`
	SaleTotal      *float64 `json:"saleTotal"`
}

type CommercialProjectionReference struct {
	QuoteRevisionID string   `json:"quoteRevisionId"`
	RevisionNumber  int      `json:"revisionNumber"`
	Status          string   `json:"status"`
	Currency        string   `json:"currency"`
	SaleTotal       *float64 `json:"saleTotal"`
}

type CommercialProjectionComparison struct {
	AbsoluteDelta   float64  `json:"absoluteDelta"`
	PercentageDelta *float64 `json:"percentageDelta"`
}

// CommercialProjection is a non-binding, read-only estimate of the exact
// mutable Design working copy. It never creates or rewrites a QuoteRevision.
type CommercialProjection struct {
	Schema                   string                          `json:"schema"`
	Status                   CommercialProjectionStatus      `json:"status"`
	ProjectID                string                          `json:"projectId"`
	DesignID                 string                          `json:"designId"`
	WorkingVersion           string                          `json:"workingVersion"`
	WorkingFingerprint       string                          `json:"workingFingerprint"`
	CatalogFingerprint       *string                         `json:"catalogFingerprint"`
	ProjectionFingerprint    *string                         `json:"projectionFingerprint"`
	PricingAuthority         string                          `json:"pricingAuthority"`
	CalculatedAt             time.Time                       `json:"calculatedAt"`
	Currency                 string                          `json:"currency"`
	ItemCount                int                             `json:"itemCount"`
	Amounts                  *CommercialProjectionAmounts    `json:"amounts"`
	CostsWithheld            bool                            `json:"costsWithheld"`
	SaleAmountsWithheld      bool                            `json:"saleAmountsWithheld"`
	Reference                *CommercialProjectionReference  `json:"reference"`
	AcceptedReference        *CommercialProjectionReference  `json:"acceptedReference"`
	LatestPublishedReference *CommercialProjectionReference  `json:"latestPublishedReference"`
	Comparison               *CommercialProjectionComparison `json:"comparison"`
	Issues                   []string                        `json:"issues"`
}

func CommercialProjectionAmountsFromBreakdown(b QuoteBreakdown) *CommercialProjectionAmounts {
	return &CommercialProjectionAmounts{
		MaterialsCost: &b.MaterialsCost, EdgeTotal: &b.EdgeTotal, HardwareTotal: &b.HardwareTotal,
		DirectCost: &b.DirectCost, LaborModular: &b.LaborModular, LaborFixedCost: &b.LaborFixedCost,
		MarginFactor: &b.MarginFactor, SaleTotal: &b.SalePrice,
	}
}

func RedactCommercialProjectionCosts(p *CommercialProjection) {
	if p == nil || p.Amounts == nil {
		return
	}
	p.Amounts.MaterialsCost = nil
	p.Amounts.EdgeTotal = nil
	p.Amounts.HardwareTotal = nil
	p.Amounts.DirectCost = nil
	p.Amounts.LaborModular = nil
	p.Amounts.LaborFixedCost = nil
	p.Amounts.MarginFactor = nil
	p.CostsWithheld = true
}
