package domain

// ContractIssue is the structured, stable-code error/issue shape of the
// SketchUp authoring contracts (#346/#477): clients branch on `code`, never
// on localized message substrings. Mirrors TS ContractIssue in
// packages/domain/src/sketchupAuthoringSchema.ts.
type ContractIssue struct {
	Code        string         `json:"code"`
	Message     string         `json:"message"`
	Severity    string         `json:"severity"`
	EntityID    string         `json:"entityId,omitempty"`
	Path        string         `json:"path,omitempty"`
	Remediation string         `json:"remediation,omitempty"`
	Details     map[string]any `json:"details,omitempty"`
}

// Issue severities (contract §9).
const (
	IssueSeverityError   = "error"
	IssueSeverityWarning = "warning"
	IssueSeverityInfo    = "info"
)
