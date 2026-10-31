package storage_test

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1422 slice 2 — workshop kit templates round-trip against real PostgreSQL
// (RLS-governed runtime role): create/readback with slots, If-Match guarded
// update, version conflict, and the soft deactivate. Cleanup is a fixture
// DELETE through the migration pool — never the primary frontier (the table
// lives in a disposable test database, contract
// docs/architecture/test-database-isolation.md).

func kitTemplate172(id, code string) domain.KitTemplate {
	return domain.KitTemplate{
		ID:              id,
		Code:            &code,
		LabelEs:         "Bisagra del taller (2 partes)",
		AgregadoLabelEs: "Puerta",
		Motion:          "rotate_left",
		Slots: []domain.KitTemplateSlot{
			{Slot: "cup_fixed", MemberID: "hinge_cup", Suffix: "-COPA", LabelEs: "Copa", Role: "hinge_cup", Membership: "body", AnchorXRef: "min", OffsetSign: 1},
			{Slot: "arm_moving", MemberID: "hinge_arm", Suffix: "-BRAZO", LabelEs: "Brazo", Role: "hinge_arm", Membership: "actor:door", AnchorXRef: "center", OffsetSign: -1, DefaultOffsetMm: 24},
		},
	}
}

func createKitTemplate172(t *testing.T, tpl domain.KitTemplate) {
	t.Helper()
	store, _ := migratedConnectStore(t)
	t.Cleanup(func() {
		cleanupConnectStoreFixture(t, `DELETE FROM hardware_kit_templates WHERE id = $1`, tpl.ID)
	})
	withinConnectStoreTenant(t, store, connectStoreInitialActor, func(txCtx context.Context) error {
		return store.CreateKitTemplate(txCtx, &tpl)
	})
}

func TestKitTemplates172RoundTripAndGuards(t *testing.T) {
	id := "11111111-1111-4111-8111-000000000172"
	tpl := kitTemplate172(id, "PLANT-BIS-172")
	createKitTemplate172(t, tpl)

	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor

	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		// Readback: every field and both slots survive the round-trip.
		got, err := store.GetKitTemplateByID(txCtx, id)
		if err != nil {
			return fmt.Errorf("get by id: %w", err)
		}
		if got.Code == nil || *got.Code != "PLANT-BIS-172" || got.LabelEs != tpl.LabelEs ||
			got.Motion != "rotate_left" || got.AgregadoLabelEs != "Puerta" {
			return fmt.Errorf("readback mismatch: %+v", got)
		}
		if len(got.Slots) != 2 || got.Slots[1].Membership != "actor:door" || got.Slots[1].DefaultOffsetMm != 24 {
			return fmt.Errorf("slots round-trip mismatch: %+v", got.Slots)
		}
		if got.Version != 1 || !got.Active {
			return fmt.Errorf("new row must be active v1, got v%d active=%v", got.Version, got.Active)
		}
		list, err := store.ListKitTemplates(txCtx)
		if err != nil {
			return fmt.Errorf("list: %w", err)
		}
		found := false
		for _, row := range list {
			if row.ID == id {
				found = true
			}
		}
		if !found {
			return errors.New("created template missing from the active list")
		}

		// Stale If-Match: typed version conflict, never a silent write.
		if err := store.UpdateKitTemplate(txCtx, id, 99, &tpl); !errors.Is(err, storage.ErrVersionConflict) {
			return fmt.Errorf("expected ErrVersionConflict on stale version, got %v", err)
		}

		// Guarded update: fields move, version bumps.
		tpl.LabelEs = "Bisagra del taller (renamed)"
		if err := store.UpdateKitTemplate(txCtx, id, 1, &tpl); err != nil {
			return fmt.Errorf("guarded update: %w", err)
		}
		got, err = store.GetKitTemplateByID(txCtx, id)
		if err != nil {
			return err
		}
		if got.LabelEs != "Bisagra del taller (renamed)" || got.Version != 2 {
			return fmt.Errorf("update readback mismatch: label=%q v%d", got.LabelEs, got.Version)
		}

		// Soft deactivate: off the active list, row survives (no physical delete).
		if err := store.DeactivateKitTemplate(txCtx, id, 2); err != nil {
			return fmt.Errorf("deactivate: %w", err)
		}
		list, err = store.ListKitTemplates(txCtx)
		if err != nil {
			return err
		}
		for _, row := range list {
			if row.ID == id {
				return errors.New("deactivated template must leave the active list")
			}
		}
		if _, err := store.GetKitTemplateByID(txCtx, id); err != nil {
			return fmt.Errorf("deactivated row must stay readable: %w", err)
		}

		// Unknown id reads as the typed not-found.
		if _, err := store.GetKitTemplateByID(txCtx, "11111111-1111-4111-8111-00000000ffff"); !errors.Is(err, storage.ErrKitTemplateNotFound) {
			return fmt.Errorf("expected ErrKitTemplateNotFound, got %v", err)
		}
		return nil
	})
}
