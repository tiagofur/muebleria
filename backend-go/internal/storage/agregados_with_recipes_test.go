package storage_test

import (
	"context"
	"errors"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1369/#1393 — lecturas combinadas fila + receta vigente en UNA transacción.
// Antes el GET list pagaba un runInTenantTx POR agregado (N+1 de
// transacciones) y el detalle leía fila y revisión por separado (un PUT
// concurrente podía servir versión vieja con receta nueva). Semántica #1399
// preservada: agregado sin revisión sale sin receta, tal cual; un error real
// de lectura propaga (el mapping a 500 vive en el handler, cubierto por stub).

func TestAgregadosWithRecipes_ListAndByIDCarryCurrentRecipe(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store
	actor := fixture.actorA

	// Dos agregados CON receta (vía CreateAgregado + UpdateAgregadoWithRevision,
	// el mismo camino de escritura del PUT con revisión) y uno SIN revisión.
	newAgregadoWithRecipe := func(idSuffix, codeSuffix, name, memberID, variantSetID, hardwareID string, widthMm int) domain.Agregado {
		in := &domain.Agregado{
			ID:      idSuffix,
			Code:    codeSuffix,
			Name:    name,
			Active:  true,
			WidthMm: widthMm, HeightMm: 200, DepthMm: 550,
		}
		if err := isolationRuntimeError(fixture, actor, func(txCtx context.Context) error {
			return store.CreateAgregado(txCtx, in)
		}); err != nil {
			t.Fatalf("create agregado %s: %v", name, err)
		}
		withRecipe := *in
		withRecipe.RigidMembers = []domain.AgregadoRigidMember{{
			MemberID: memberID,
			Role:     "guide_left",
			Source:   domain.RigidMemberSource{Kind: domain.RigidMemberSourceFixed, Fixed: &domain.FixedHardwareSource{HardwareID: hardwareID}},
			Placement: domain.AssemblyAnchorRule{
				X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
			},
			BOMRole: domain.BOMRoleIncludedInKit,
		}}
		withRecipe.VariantSets = []domain.AgregadoVariantSet{{
			ID:        variantSetID,
			Dimension: "depth",
			Variants:  []domain.ProductVariant{{NominalDimensionMm: 500, HardwareID: hardwareID}},
		}}
		userID := actor.UserID
		if err := isolationRuntimeError(fixture, actor, func(txCtx context.Context) error {
			return store.UpdateAgregadoWithRevision(txCtx, in.ID, in.Version, &withRecipe, &userID)
		}); err != nil {
			t.Fatalf("update with revision %s: %v", name, err)
		}
		return withRecipe
	}

	agrA := newAgregadoWithRecipe("agr-wr-a", "AGR-WR-A", "Cajón A", "runner-a", "vs-a", "hw-runner-a", 600)
	agrB := newAgregadoWithRecipe("agr-wr-b", "AGR-WR-B", "Cajón B", "runner-b", "vs-b", "hw-runner-b", 450)
	agrC := &domain.Agregado{ID: "agr-wr-c", Code: "AGR-WR-C", Name: "Sin revisión", Active: true}
	if err := isolationRuntimeError(fixture, actor, func(txCtx context.Context) error {
		return store.CreateAgregado(txCtx, agrC)
	}); err != nil {
		t.Fatalf("create agregado sin revisión: %v", err)
	}

	find := func(list []domain.Agregado, id string) *domain.Agregado {
		for i := range list {
			if list[i].ID == id {
				return &list[i]
			}
		}
		return nil
	}

	t.Run("la lista combinada trae la receta de CADA agregado, no una mezclada", func(t *testing.T) {
		list := isolationRuntimeValue(t, fixture, actor, func(txCtx context.Context) ([]domain.Agregado, error) {
			return store.ListAgregadosWithRecipes(txCtx)
		})
		gotA := find(list, agrA.ID)
		gotB := find(list, agrB.ID)
		gotC := find(list, agrC.ID)
		if gotA == nil || gotB == nil || gotC == nil {
			t.Fatalf("la lista debe traer los tres agregados: %+v", list)
		}
		if len(gotA.RigidMembers) != 1 || gotA.RigidMembers[0].MemberID != "runner-a" || len(gotA.VariantSets) != 1 || gotA.VariantSets[0].ID != "vs-a" {
			t.Fatalf("receta de A mal hidratada: %+v", gotA)
		}
		if len(gotB.RigidMembers) != 1 || gotB.RigidMembers[0].MemberID != "runner-b" || len(gotB.VariantSets) != 1 || gotB.VariantSets[0].ID != "vs-b" {
			t.Fatalf("receta de B mal hidratada (¿cruzada con otra revisión?): %+v", gotB)
		}
		// Identidad/versión/estado de la fila, nunca de la receta.
		if gotA.Code != agrA.Code || gotA.Version != agrA.Version || !gotA.Active || gotA.CurrentRevisionID == nil {
			t.Fatalf("la fila de A debe conservar versión/estado/puntero: %+v", gotA)
		}
		if gotA.WidthMm != 600 || gotA.HeightMm != 200 || gotA.DepthMm != 550 {
			t.Fatalf("dims efectivas de la receta: %+v", gotA)
		}
	})

	t.Run("by-id combinado trae la receta; sin revisión sale tal cual; missing es not-found tipado", func(t *testing.T) {
		gotA := isolationRuntimeValue(t, fixture, actor, func(txCtx context.Context) (*domain.Agregado, error) {
			return store.GetAgregadoByIDWithRecipe(txCtx, agrA.ID)
		})
		if len(gotA.RigidMembers) != 1 || gotA.RigidMembers[0].MemberID != "runner-a" || gotA.WidthMm != 600 {
			t.Fatalf("by-id sin receta de la revisión: %+v", gotA)
		}
		if gotA.Version != agrA.Version || gotA.CurrentRevisionID == nil {
			t.Fatalf("by-id debe conservar versión/puntero de la fila: %+v", gotA)
		}

		gotC := isolationRuntimeValue(t, fixture, actor, func(txCtx context.Context) (*domain.Agregado, error) {
			return store.GetAgregadoByIDWithRecipe(txCtx, agrC.ID)
		})
		if len(gotC.RigidMembers) != 0 || len(gotC.VariantSets) != 0 || gotC.CurrentRevisionID != nil {
			t.Fatalf("sin revisión el agregado sale tal cual (sin receta): %+v", gotC)
		}

		err := isolationRuntimeError(fixture, actor, func(txCtx context.Context) error {
			_, err := store.GetAgregadoByIDWithRecipe(txCtx, "agr-wr-missing")
			return err
		})
		if !errors.Is(err, storage.ErrAgregadoNotFound) {
			t.Fatalf("GetAgregadoByIDWithRecipe(missing) = %v, want ErrAgregadoNotFound", err)
		}
	})

	t.Run("la lectura combinada respeta el scope del tenant", func(t *testing.T) {
		listB := isolationRuntimeValue(t, fixture, fixture.actorB, func(txCtx context.Context) ([]domain.Agregado, error) {
			return store.ListAgregadosWithRecipes(txCtx)
		})
		if find(listB, agrA.ID) != nil || len(listB) != 0 {
			t.Fatalf("org B no debe ver agregados de org A: %+v", listB)
		}
		// Sin organization scope la llamada falla cerrada (nunca lista vacía
		// que simule «no hay agregados»).
		if _, err := store.ListAgregadosWithRecipes(context.Background()); err == nil {
			t.Fatal("lectura combinada sin organization scope debe fallar")
		}
	})
}
