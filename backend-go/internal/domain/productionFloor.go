package domain

/**
 * Shop-floor item pipeline (PROD-3.1 / F089-RN / F092 parity with TS
 * packages/domain/src/productionFloor.ts).
 */

// ItemFloorStatuses is the ordered pipeline: pending → cut → edged →
// assembled → packaged → loaded → installed.
var ItemFloorStatuses = []string{"pending", "cut", "edged", "assembled", "packaged", "loaded", "installed"}

// NormalizeItemFloorStatus coerces unknown/empty values to "pending".
func NormalizeItemFloorStatus(s string) string {
	for _, v := range ItemFloorStatuses {
		if v == s {
			return s
		}
	}
	return "pending"
}

// NextItemFloorStatus returns the next pipeline step, or "" when installed
// (complete).
func NextItemFloorStatus(s string) string {
	cur := NormalizeItemFloorStatus(s)
	for i, v := range ItemFloorStatuses {
		if v == cur && i+1 < len(ItemFloorStatuses) {
			return ItemFloorStatuses[i+1]
		}
	}
	return ""
}

// FloorStatusRank returns the 0-based index of the status in the pipeline.
func FloorStatusRank(status string) int {
	norm := NormalizeItemFloorStatus(status)
	for i, s := range ItemFloorStatuses {
		if s == norm {
			return i
		}
	}
	return 0
}

// LoadingProgress summarizes packaging, loading and delivery readiness for a project.
type LoadingProgress struct {
	TotalPackages        int     `json:"total_packages"`
	PackagedPackages     int     `json:"packaged_packages"`
	LoadedPackages       int     `json:"loaded_packages"`
	InstalledPackages    int     `json:"installed_packages"`
	PackagingPercentage  float64 `json:"packaging_percentage"`
	LoadingPercentage    float64 `json:"loading_percentage"`
	AllPackaged          bool    `json:"all_packaged"`
	AllLoaded            bool    `json:"all_loaded"`
	CanReleaseToDelivery bool    `json:"can_release_to_delivery"`
}

// CalculateLoadingProgress calculates loading and packaging metrics for all project items.
func CalculateLoadingProgress(project *Project) LoadingProgress {
	if project == nil || len(project.Items) == 0 {
		return LoadingProgress{
			TotalPackages:        0,
			PackagedPackages:     0,
			LoadedPackages:       0,
			InstalledPackages:    0,
			PackagingPercentage:  100,
			LoadingPercentage:    100,
			AllPackaged:          true,
			AllLoaded:            true,
			CanReleaseToDelivery: true,
		}
	}

	total := 0
	packaged := 0
	loaded := 0
	installed := 0

	packagedRank := FloorStatusRank("packaged")
	loadedRank := FloorStatusRank("loaded")
	installedRank := FloorStatusRank("installed")

	for _, item := range project.Items {
		qty := int(item.Quantity)
		if qty < 1 {
			qty = 1
		}
		total += qty
		rank := FloorStatusRank(item.FloorStatus)
		if rank >= packagedRank {
			packaged += qty
		}
		if rank >= loadedRank {
			loaded += qty
		}
		if rank >= installedRank {
			installed += qty
		}
	}

	loadingPct := 0.0
	packagingPct := 0.0
	if total > 0 {
		loadingPct = (float64(loaded) / float64(total)) * 100.0
		packagingPct = (float64(packaged) / float64(total)) * 100.0
	}

	allPack := total > 0 && packaged >= total
	allLoad := total > 0 && loaded >= total

	return LoadingProgress{
		TotalPackages:        total,
		PackagedPackages:     packaged,
		LoadedPackages:       loaded,
		InstalledPackages:    installed,
		PackagingPercentage:  packagingPct,
		LoadingPercentage:    loadingPct,
		AllPackaged:          allPack,
		AllLoaded:            allLoad,
		CanReleaseToDelivery: allLoad,
	}
}

// AllModulesPackaged returns true if 100% of physical furniture packages are packaged or beyond.
func AllModulesPackaged(project *Project) bool {
	return CalculateLoadingProgress(project).AllPackaged
}

// AllModulesLoaded returns true if 100% of physical furniture packages are loaded on transport or installed.
func AllModulesLoaded(project *Project) bool {
	return CalculateLoadingProgress(project).AllLoaded
}
