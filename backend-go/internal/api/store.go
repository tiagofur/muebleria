package api

// Store is the subset of storage operations the HTTP handlers depend on.
//
// It is satisfied by *storage.PostgresStore in production. Defining it as an
// interface lets handler unit tests substitute a stub (see handlers_test.go)
// without standing up a database — mirroring the httptest style of
// middleware_test.go. Methods not used by handlers (RunMigrations, Close,
// AppliedVersions, admin password helpers) intentionally stay on the concrete
// type and are called only from cmd/server.
//
// Contrato: raíz de composición por dominio (Fase B #1017). Cada sub-interface
// vive en su archivo store_<dominio>.go; la partición es compile-only y no
// cambia ninguna firma.
type Store interface {
	AuthStore                 // store_auth.go
	OrgStore                  // store_org.go
	CustomerStore             // store_customer.go
	HardwareAssetStore        // store_hardware_assets.go
	CatalogStore              // store_catalog.go
	ModuleStore               // store_modules.go
	ProjectStore              // store_project.go
	FurnitureStore            // store_furniture.go
	DesignStore               // store_design.go
	QuoteReleaseStore         // store_quote_release.go
	DesignAuthoringStore      // store_design_authoring.go
	ProjectWorkflowStore      // store_workflow.go
	SeedSettingsStore         // store_seed.go
	OperationsStore           // store_operations.go
	ProductionActivityStore   // store_production.go
	ManufacturingLibraryStore // store_library.go
}
