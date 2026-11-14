package engine

// #1627 slice 3 — the frozen insert of a quoted unit. Quote freeze records
// what every mounted insert group resolved to (FrozenAccessoryChoices) and
// the quoted release applies it over the design revision items
// (ApplyFrozenAccessoryChoices), so a frozen quote releases exactly what it
// priced even if the catalog's order or defaults change afterwards.

import (
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// FrozenAccessoryChoices resolves, for every kit-linked insert group the
// module can mount with these choices, the insert the engine would mount
// right now: the explicit or default option id when it is an active member,
// otherwise AccessoryChoiceNone. Nil when the module mounts no insert group.
// Same decision functions as the layout and the quote — no second truth.
func FrozenAccessoryChoices(module domain.Module, catalog domain.Catalog, choices map[string]string) map[string]string {
	codes := mountedAccessoryGroupCodes(module, catalog, choices)
	if len(codes) == 0 {
		return nil
	}
	frozen := make(map[string]string, len(codes))
	for _, og := range catalog.OptionGroups {
		if !codes[og.Code] || og.Kind != "hardware" || og.KitHardwareID == nil {
			continue
		}
		choice := effectiveAccessoryChoice(catalog, og, choices)
		if hw, ok := accessoryMemberForChoice(catalog, og, choice); ok {
			frozen[og.Code] = hw.ID
			continue
		}
		frozen[og.Code] = domain.AccessoryChoiceNone
	}
	if len(frozen) == 0 {
		return nil
	}
	return frozen
}

// ApplyFrozenAccessoryChoices returns the item's choices with the quote's
// frozen inserts applied (a new map; the input is never mutated).
//
//   - frozen present (snapshot from #1627 on): each frozen group takes its
//     frozen value. A frozen «none» on a REQUIRED group is not written (it is
//     not a legal choice there); the group keeps whatever the item says and
//     the release gate/resolve report it as before.
//   - frozen nil (snapshot frozen before #1627 — owner decision): every
//     mounted OPTIONAL insert group the item did not choose explicitly is
//     released without insert; explicit choices are kept untouched.
func ApplyFrozenAccessoryChoices(module domain.Module, catalog domain.Catalog, choices map[string]string, frozen map[string]string) map[string]string {
	out := make(map[string]string, len(choices)+len(frozen))
	for code, id := range choices {
		out[code] = id
	}
	required := map[string]bool{}
	for _, og := range catalog.OptionGroups {
		if og.Kind == "hardware" && og.KitHardwareID != nil && og.Required {
			required[og.Code] = true
		}
	}
	if frozen != nil {
		for code, id := range frozen {
			if id == domain.AccessoryChoiceNone && required[code] {
				continue
			}
			out[code] = id
		}
		return out
	}
	for code := range mountedAccessoryGroupCodes(module, catalog, choices) {
		if required[code] || strings.TrimSpace(out[code]) != "" {
			continue
		}
		out[code] = domain.AccessoryChoiceNone
	}
	return out
}
