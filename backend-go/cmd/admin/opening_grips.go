package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/tiagofur/muebles-backend/internal/application"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// runMigrateOpeningGrips executes the #1136 legacy `jaladera-gola-*` → grip
// model migration for one organization. Dry-run by default: nothing writes
// without --apply, and even then modules are NEVER touched — the report is
// the contract, the mapping file is the decision.
//
//	go run ./cmd/admin migrate-opening-grips --org <uuid> --mapping data/opening-grip-migration.json [--apply]
func runMigrateOpeningGrips(args []string) {
	fs := flag.NewFlagSet("migrate-opening-grips", flag.ExitOnError)
	orgID := fs.String("org", "", "organization id (required)")
	mappingPath := fs.String("mapping", "", "declared conversion mapping JSON file (optional: sin registros de la familia no hay nada que decidir)")
	apply := fs.Bool("apply", false, "write the conversions (default: dry-run report)")
	reportPath := fs.String("report", "", "optional path for the JSON report artifact")
	_ = fs.Parse(args)

	if *orgID == "" {
		fatal(fmt.Errorf("--org is required"))
	}

	var entries []application.OpeningGripMappingEntry
	if *mappingPath != "" {
		loaded, err := loadOpeningGripMapping(*mappingPath)
		if err != nil {
			fatal(err)
		}
		entries = loaded
	}

	store, closeStore, err := openStore()
	if err != nil {
		fatal(err)
	}
	defer closeStore()

	ctx := storage.WithOrgCtx(context.Background(), *orgID)
	report, err := application.MigrateOpeningGrips(ctx, store, *orgID, entries, *apply)
	if err != nil {
		fatal(err)
	}

	printOpeningGripReport(report)

	if *reportPath != "" {
		raw, err := json.MarshalIndent(report, "", "  ")
		if err != nil {
			fatal(err)
		}
		if err := os.WriteFile(*reportPath, raw, 0o644); err != nil {
			fatal(fmt.Errorf("write report: %w", err))
		}
		log.Printf("Reporte escrito en %s", *reportPath)
	}
	if report.DryRun {
		log.Printf("DRY-RUN: nada fue escrito. Revisá el reporte y volvé a correr con --apply.")
	}
}

func loadOpeningGripMapping(path string) ([]application.OpeningGripMappingEntry, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read mapping: %w", err)
	}
	var entries []application.OpeningGripMappingEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, fmt.Errorf("decode mapping %s: %w", path, err)
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("el mapeo %s está vacío: cada conversión es una decisión declarada", path)
	}
	return entries, nil
}

func printOpeningGripReport(report application.OpeningGripMigrationReport) {
	mode := "DRY-RUN"
	if !report.DryRun {
		mode = "APPLY"
	}
	log.Printf("[%s] Migración de jaladera-gola-* para org %s", mode, report.OrgID)
	log.Printf("Categorías: migrated=%d already_canonical=%d unsupported=%d ambiguous=%d",
		report.Categories[application.OpeningGripMigrated],
		report.Categories[application.OpeningGripAlreadyCanonical],
		report.Categories[application.OpeningGripUnsupported],
		report.Categories[application.OpeningGripAmbiguous])
	for _, record := range report.Records {
		line := fmt.Sprintf("  %-24s %s → %s", record.Action, record.LegacyCode, record.ProfileCode)
		if record.Deactivated {
			line += " (desactivado)"
		}
		log.Printf("%s", line)
	}
	if len(report.ManualReview) > 0 {
		log.Printf("Revisión manual (%d overrides de diseño — jamás reescritos):", len(report.ManualReview))
		for _, hit := range report.ManualReview {
			suggestion := ""
			if hit.SuggestedProfileCode != "" {
				suggestion = " → sugerido " + hit.SuggestedProfileCode
			}
			log.Printf("  módulo %s (%s) agregado %s [%s]=%s%s", hit.ModuleCode, hit.ModuleID, hit.AgregadoID, hit.OptionRole, hit.Value, suggestion)
		}
	}
	if len(report.Deactivated) > 0 {
		log.Printf("Desactivados por salir de la oferta: %v", report.Deactivated)
	}
}
