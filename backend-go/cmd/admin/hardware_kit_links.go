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

// runMigrateHardwareKitLinks backfills the kit↔part link (#1437) for kits
// created by the wizard BEFORE migration 00171: their design parts carry the
// wizard's exact code suffixes but no kit_hardware_id, so the hardware list
// renders them flat. Dry-run by default — nothing writes without --apply,
// the report is the contract, and codes that don't match the convention
// exactly are reported and never guessed.
//
//	go run ./cmd/admin migrate-hardware-kit-links --org <uuid> [--apply] [--report <archivo>]
func runMigrateHardwareKitLinks(args []string) {
	fs := flag.NewFlagSet("migrate-hardware-kit-links", flag.ExitOnError)
	orgID := fs.String("org", "", "organization id (required)")
	apply := fs.Bool("apply", false, "write the links (default: dry-run report)")
	reportPath := fs.String("report", "", "optional path for the JSON report artifact")
	_ = fs.Parse(args)

	if *orgID == "" {
		fatal(fmt.Errorf("--org is required"))
	}

	store, closeStore, err := openStore()
	if err != nil {
		fatal(err)
	}
	defer closeStore()

	ctx := storage.WithOrgCtx(context.Background(), *orgID)
	report, err := application.MigrateHardwareKitLinks(ctx, store, *orgID, *apply)
	if err != nil {
		fatal(err)
	}

	printHardwareKitLinkReport(report)

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

func printHardwareKitLinkReport(report application.HardwareKitLinkReport) {
	mode := "DRY-RUN"
	if !report.DryRun {
		mode = "APPLY"
	}
	log.Printf("[%s] Backfill de links kit↔parte para org %s", mode, report.OrganizationID)
	log.Printf("Juegos con partes candidatas: %d — propuestas: %d — ignoradas: %d",
		report.KitsWithParts, len(report.Linked), len(report.Ignored))
	for _, change := range report.Linked {
		log.Printf("  %-28s %-10s → juego %s", change.PartCode, change.Suffix, change.KitCode)
	}
	if len(report.Ignored) > 0 {
		log.Printf("Ignoradas (sin adivinar — decisión humana):")
		for _, skip := range report.Ignored {
			log.Printf("  %-28s %s", skip.PartCode, skip.Reason)
		}
	}
}
