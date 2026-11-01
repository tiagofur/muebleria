package application

// Contrato: backfill one-time del link kit↔parte (#1437). Los kits creados
// por el asistente ANTES de la migración 00171 tienen sus partes de diseño
// sin kit_hardware_id y la lista de Herrajes los muestra planos. Este
// servicio vincula cada parte por la convención EXACTA de sufijos del
// asistente (packages/domain/src/hardwareKit.ts — HARDWARE_KIT_SLOTS y
// plantillas), reportando lo vinculado y lo ignorado. Dry-run por defecto:
// sin --apply nada se escribe; códigos que no casen exacto no se adivinan.

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// HardwareKitLinkStore is the narrow surface the backfill needs.
type HardwareKitLinkStore interface {
	ListHardwares(ctx context.Context) ([]domain.Hardware, error)
	ApplyHardwareKitLink(ctx context.Context, partID, kitID string) (bool, error)
}

// hardwareKitLinkSuffixes espeja los sufijos que genera el asistente
// (HARDWARE_KIT_SLOTS: -FIJ-I/-FIJ-D/-MOV-I/-MOV-D; plantillas bisagra y
// jaladera: -COPA/-BRAZO/-PIEZA). Cambiar el asistente exige cambiar esto.
var hardwareKitLinkSuffixes = []string{"-FIJ-I", "-FIJ-D", "-MOV-I", "-MOV-D", "-COPA", "-BRAZO", "-PIEZA"}

// HardwareKitLinkChange is one proposed (or applied) part→kit link.
type HardwareKitLinkChange struct {
	KitCode  string `json:"kit_code"`
	KitID    string `json:"kit_id"`
	PartCode string `json:"part_code"`
	PartID   string `json:"part_id"`
	Suffix   string `json:"suffix"`
}

// HardwareKitLinkSkip is a part the report deliberately did NOT touch.
type HardwareKitLinkSkip struct {
	PartCode string `json:"part_code"`
	Reason   string `json:"reason"`
}

// HardwareKitLinkReport is the decision artifact: what would link (or did),
// what was ignored and why.
type HardwareKitLinkReport struct {
	OrganizationID string                  `json:"organization_id"`
	DryRun         bool                    `json:"dry_run"`
	Linked         []HardwareKitLinkChange `json:"linked"`
	Ignored        []HardwareKitLinkSkip   `json:"ignored"`
	KitsWithParts  int                     `json:"kits_with_parts"`
}

func unlinked(h domain.Hardware) bool {
	return h.KitHardwareID == nil || strings.TrimSpace(*h.KitHardwareID) == ""
}

// MigrateHardwareKitLinks links wizard-convention parts to their sets.
// Kit candidates are unit='set' hardwares that are not parts themselves;
// a part links only when `<kit_code><suffix>` matches an existing code
// exactly. Everything else lands in Ignored with the reason.
func MigrateHardwareKitLinks(ctx context.Context, store HardwareKitLinkStore, orgID string, apply bool) (HardwareKitLinkReport, error) {
	report := HardwareKitLinkReport{OrganizationID: orgID, DryRun: !apply}
	hardwares, err := store.ListHardwares(ctx)
	if err != nil {
		return report, fmt.Errorf("list hardware: %w", err)
	}
	byCode := make(map[string]domain.Hardware, len(hardwares))
	for _, h := range hardwares {
		if _, exists := byCode[h.Code]; !exists {
			byCode[h.Code] = h
		}
	}

	kits := make([]domain.Hardware, 0)
	for _, h := range hardwares {
		if h.Unit == "set" && unlinked(h) {
			kits = append(kits, h)
		}
	}
	sort.Slice(kits, func(i, j int) bool { return kits[i].Code < kits[j].Code })

	isSetBase := make(map[string]bool, len(kits))
	for _, kit := range kits {
		isSetBase[kit.Code] = true
	}

	linkedCodes := map[string]bool{}
	kitsWithParts := map[string]bool{}
	for _, kit := range kits {
		for _, suffix := range hardwareKitLinkSuffixes {
			part, ok := byCode[kit.Code+suffix]
			if !ok || part.ID == kit.ID {
				continue
			}
			if !unlinked(part) {
				report.Ignored = append(report.Ignored, HardwareKitLinkSkip{
					PartCode: part.Code,
					Reason:   "ya está vinculada a un juego",
				})
				continue
			}
			kitsWithParts[kit.Code] = true
			if !apply {
				report.Linked = append(report.Linked, HardwareKitLinkChange{
					KitCode: kit.Code, KitID: kit.ID,
					PartCode: part.Code, PartID: part.ID, Suffix: suffix,
				})
				linkedCodes[part.Code] = true
				continue
			}
			applied, err := store.ApplyHardwareKitLink(ctx, part.ID, kit.ID)
			if err != nil {
				return report, fmt.Errorf("vincular %s → %s: %w", part.Code, kit.Code, err)
			}
			if !applied {
				report.Ignored = append(report.Ignored, HardwareKitLinkSkip{
					PartCode: part.Code,
					Reason:   "se vinculó mientras corría el backfill",
				})
				continue
			}
			report.Linked = append(report.Linked, HardwareKitLinkChange{
				KitCode: kit.Code, KitID: kit.ID,
				PartCode: part.Code, PartID: part.ID, Suffix: suffix,
			})
			linkedCodes[part.Code] = true
		}
	}
	report.KitsWithParts = len(kitsWithParts)

	// Near misses: unlinked parts carrying a wizard suffix whose base code is
	// NOT a set in this organization. Surfaced for the human, never guessed.
	for _, h := range hardwares {
		if !unlinked(h) || linkedCodes[h.Code] {
			continue
		}
		for _, suffix := range hardwareKitLinkSuffixes {
			if !strings.HasSuffix(h.Code, suffix) {
				continue
			}
			base := strings.TrimSuffix(h.Code, suffix)
			if base == "" {
				break
			}
			if !isSetBase[base] {
				reason := fmt.Sprintf("sufijo de asistente sin juego «%s»", base)
				if _, exists := byCode[base]; exists {
					reason = fmt.Sprintf("«%s» existe pero no es un juego (unit≠set)", base)
				}
				report.Ignored = append(report.Ignored, HardwareKitLinkSkip{PartCode: h.Code, Reason: reason})
			}
			break
		}
	}
	return report, nil
}
