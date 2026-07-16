package engine

import (
	"fmt"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Canonical edge sides (PRD board edges). Unknown sides are rejected.
var requiredEdgeSides = []string{"L1", "L2", "W1", "W2"}

var validEdgeSide = map[string]struct{}{
	"L1": {},
	"L2": {},
	"W1": {},
	"W2": {},
}

// ValidateBoardPart enforces VAL-01 / VAL-04 structure (mirrors packages/domain validateBoardPart).
func ValidateBoardPart(part domain.BoardPart, moduleCode string) error {
	if part.LengthMm <= 0 || part.WidthMm <= 0 {
		return fmt.Errorf(
			"board part dimensions must be > 0 (lengthMm=%d, widthMm=%d)",
			part.LengthMm, part.WidthMm,
		)
	}
	if part.Quantity <= 0 {
		return fmt.Errorf("board part quantity must be > 0 (got %d)", part.Quantity)
	}
	if len(part.Edges) != 4 {
		return fmt.Errorf(
			"board part must define exactly 4 edge assignments (got %d)",
			len(part.Edges),
		)
	}

	sides := make(map[string]struct{}, 4)
	for _, e := range part.Edges {
		if _, ok := validEdgeSide[e.Side]; !ok {
			return fmt.Errorf("board part has unknown edge side %q", e.Side)
		}
		if _, dup := sides[e.Side]; dup {
			return fmt.Errorf("board part has duplicate edge side %s", e.Side)
		}
		sides[e.Side] = struct{}{}
	}
	for _, side := range requiredEdgeSides {
		if _, ok := sides[side]; !ok {
			return fmt.Errorf("board part missing edge side %s", side)
		}
	}
	return nil
}

// ValidateHardwareLine enforces VAL-03 (mirrors packages/domain validateHardwareLine).
func ValidateHardwareLine(line domain.HardwareLine, moduleCode string) error {
	if line.Quantity <= 0 {
		return fmt.Errorf("hardware line quantity must be > 0 (got %d)", line.Quantity)
	}
	return nil
}

// ValidateModule enforces VAL-07 + part/line structure (mirrors packages/domain validateModule).
func ValidateModule(module domain.Module) error {
	if strings.TrimSpace(module.Code) == "" {
		return fmt.Errorf("module code must not be empty")
	}
	if strings.TrimSpace(module.Name) == "" {
		return fmt.Errorf("module name must not be empty")
	}

	for _, part := range module.BoardParts {
		if err := ValidateBoardPart(part, module.Code); err != nil {
			return err
		}
		if strings.TrimSpace(part.Description) == "" {
			return fmt.Errorf("board part description must not be empty")
		}
		if strings.TrimSpace(part.OptionRole) == "" {
			return fmt.Errorf("board part optionRole must not be empty")
		}
	}

	for _, line := range module.HardwareLines {
		if err := ValidateHardwareLine(line, module.Code); err != nil {
			return err
		}
		if strings.TrimSpace(line.OptionRole) == "" && strings.TrimSpace(line.HardwareID) == "" {
			return fmt.Errorf("hardware line needs optionRole or fixed hardwareId")
		}
	}
	return nil
}
