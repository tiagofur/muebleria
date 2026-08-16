package domain

import (
	"testing"
)

func TestItemFloorStatuses(t *testing.T) {
	if len(ItemFloorStatuses) != 7 {
		t.Fatalf("expected 7 item floor statuses, got %d", len(ItemFloorStatuses))
	}
	expected := []string{"pending", "cut", "edged", "assembled", "packaged", "loaded", "installed"}
	for i, exp := range expected {
		if ItemFloorStatuses[i] != exp {
			t.Errorf("expected status %d to be %s, got %s", i, exp, ItemFloorStatuses[i])
		}
	}
}

func TestNormalizeItemFloorStatus(t *testing.T) {
	if NormalizeItemFloorStatus("packaged") != "packaged" {
		t.Errorf("expected packaged")
	}
	if NormalizeItemFloorStatus("loaded") != "loaded" {
		t.Errorf("expected loaded")
	}
	if NormalizeItemFloorStatus("unknown") != "pending" {
		t.Errorf("expected fallback to pending")
	}
}

func TestNextItemFloorStatus(t *testing.T) {
	if NextItemFloorStatus("assembled") != "packaged" {
		t.Errorf("assembled should advance to packaged, got %s", NextItemFloorStatus("assembled"))
	}
	if NextItemFloorStatus("packaged") != "loaded" {
		t.Errorf("packaged should advance to loaded, got %s", NextItemFloorStatus("packaged"))
	}
	if NextItemFloorStatus("loaded") != "installed" {
		t.Errorf("loaded should advance to installed, got %s", NextItemFloorStatus("loaded"))
	}
	if NextItemFloorStatus("installed") != "" {
		t.Errorf("installed should not have a next status, got %s", NextItemFloorStatus("installed"))
	}
}

func TestCalculateLoadingProgress(t *testing.T) {
	project := &Project{
		ID:   "p1",
		Name: "Cocina Demo",
		Items: []ProjectItem{
			{ID: "i1", ModuleID: "m1", Quantity: 2, FloorStatus: "assembled"},
			{ID: "i2", ModuleID: "m2", Quantity: 1, FloorStatus: "packaged"},
		},
	}

	progress := CalculateLoadingProgress(project)
	if progress.TotalPackages != 3 {
		t.Errorf("expected 3 packages, got %d", progress.TotalPackages)
	}
	if progress.PackagedPackages != 1 {
		t.Errorf("expected 1 packaged package, got %d", progress.PackagedPackages)
	}
	if progress.LoadedPackages != 0 {
		t.Errorf("expected 0 loaded packages, got %d", progress.LoadedPackages)
	}
	if progress.AllPackaged || progress.AllLoaded || progress.CanReleaseToDelivery {
		t.Errorf("should not be all packaged or loaded yet")
	}

	// Update items to packaged and loaded
	project.Items[0].FloorStatus = "loaded"
	project.Items[1].FloorStatus = "loaded"

	progress2 := CalculateLoadingProgress(project)
	if progress2.LoadedPackages != 3 {
		t.Errorf("expected 3 loaded packages, got %d", progress2.LoadedPackages)
	}
	if !progress2.AllPackaged || !progress2.AllLoaded || !progress2.CanReleaseToDelivery {
		t.Errorf("expected all loaded and ready to release")
	}
	if progress2.LoadingPercentage != 100.0 {
		t.Errorf("expected 100%% loading percentage, got %f", progress2.LoadingPercentage)
	}
}
