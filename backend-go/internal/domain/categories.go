package domain

import (
	"fmt"
)

// MaxCategoryDepth is root=1 … leaf=3.
const MaxCategoryDepth = 3

func categoryByID(categories []ModuleCategory) map[string]ModuleCategory {
	m := make(map[string]ModuleCategory, len(categories))
	for _, c := range categories {
		m[c.ID] = c
	}
	return m
}

// CategoryDepth returns 1 for roots; 0 if not found.
func CategoryDepth(categoryID string, categories []ModuleCategory) int {
	if categoryID == "" {
		return 0
	}
	mapByID := categoryByID(categories)
	depth := 0
	seen := make(map[string]bool)
	current := categoryID
	for current != "" {
		if seen[current] {
			return -1 // cycle
		}
		seen[current] = true
		node, ok := mapByID[current]
		if !ok {
			return 0
		}
		depth++
		if depth > MaxCategoryDepth+1 {
			return depth
		}
		current = node.ParentID
	}
	return depth
}

// CollectDescendantIDs returns all descendant ids (not including rootID).
func CollectDescendantIDs(rootID string, categories []ModuleCategory) []string {
	var result []string
	queue := []string{rootID}
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		for _, c := range categories {
			if c.ParentID == id {
				result = append(result, c.ID)
				queue = append(queue, c.ID)
			}
		}
	}
	return result
}

// SubtreeHeight is 1 for a leaf.
func SubtreeHeight(categoryID string, categories []ModuleCategory) int {
	maxChild := 0
	hasChild := false
	for _, c := range categories {
		if c.ParentID == categoryID {
			hasChild = true
			h := SubtreeHeight(c.ID, categories)
			if h > maxChild {
				maxChild = h
			}
		}
	}
	if !hasChild {
		return 1
	}
	return 1 + maxChild
}

// ValidateCategoryPlacement ensures create/move stays within MaxCategoryDepth.
// movingID empty means create; otherwise re-parent movingID under parentID.
func ValidateCategoryPlacement(parentID string, categories []ModuleCategory, movingID string) error {
	if movingID != "" && parentID == movingID {
		return fmt.Errorf("a category cannot be its own parent")
	}
	if movingID != "" && parentID != "" {
		for _, d := range CollectDescendantIDs(movingID, categories) {
			if d == parentID {
				return fmt.Errorf("cannot move a category under its descendant")
			}
		}
	}

	parentDepth := 0
	if parentID != "" {
		parentDepth = CategoryDepth(parentID, categories)
		if parentDepth == 0 {
			return fmt.Errorf("parent category not found")
		}
		if parentDepth < 0 {
			return fmt.Errorf("category hierarchy has a cycle")
		}
	}
	if parentDepth >= MaxCategoryDepth {
		return fmt.Errorf("categories cannot exceed %d levels", MaxCategoryDepth)
	}

	height := 1
	if movingID != "" {
		height = SubtreeHeight(movingID, categories)
	}
	if parentDepth+height > MaxCategoryDepth {
		return fmt.Errorf("categories cannot exceed %d levels", MaxCategoryDepth)
	}
	return nil
}
