// Sales vs manufacturing payload separation (#327).
//
// When a project's sales organization differs from its manufacturing
// organization, callers scoped to the sales organization must not see
// manufacturing-internal data: engineering log, cut/CNC plans, physical piece
// and unit execution, production/materials release, floor events and the
// installation job (docs/multi-organization-distribution-model.md). Commercial
// and design fields (layout, items, quotes, approvals, events) stay visible —
// the store sells the project.
package domain

// RedactProjectManufacturing strips manufacturing-internal fields for callers
// outside the manufacturing organization (#327 "no leakage of manufacturing
// data to sales users").
func RedactProjectManufacturing(p *Project) {
	if p == nil {
		return
	}
	p.EngineeringLog = nil
	p.CutPlan = nil
	p.NestingImport = nil
	p.InstallationChecklist = nil
	p.MaterialsRelease = nil
	p.ProductionRelease = nil
	p.PartInstances = nil
	p.ModuleUnits = nil
	p.FloorEvents = nil
	p.Installation = nil
	// Subprocess aggregates loaded by GetProjectByID (F178): MRP planning,
	// quality and job costing are factory-internal per the distribution doc
	// (production planning / manufacturing costs).
	p.MaterialPlanning = nil
	p.Quality = nil
	p.Costing = nil
}

// RestoreProjectManufacturing copies the server-side manufacturing fields from
// stored into p. Callers that never received the manufacturing payload (sales
// organization edits) must not be able to wipe it either: their PUT round-trips
// carry empty values which are restored from the stored row before persisting.
func RestoreProjectManufacturing(p, stored *Project) {
	if p == nil || stored == nil {
		return
	}
	p.EngineeringLog = stored.EngineeringLog
	p.CutPlan = stored.CutPlan
	p.NestingImport = stored.NestingImport
	p.InstallationChecklist = stored.InstallationChecklist
	p.MaterialsRelease = stored.MaterialsRelease
	p.ProductionRelease = stored.ProductionRelease
	p.PartInstances = stored.PartInstances
	p.ModuleUnits = stored.ModuleUnits
	p.FloorEvents = stored.FloorEvents
	p.Installation = stored.Installation
	p.MaterialPlanning = stored.MaterialPlanning
	p.Quality = stored.Quality
	p.Costing = stored.Costing
}
