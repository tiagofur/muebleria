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
// frozen inserts applied (a new map; the input is never mutated). Only insert
// groups the module MOUNTS at release are touched (a group the catalog
// unlinked after the quote is never written — it would be an unconsumed
// choice):
//
//   - frozen present (snapshot from #1627 on): a mounted group takes its
//     frozen value, except a frozen «none» on a REQUIRED group (not a legal
//     choice there). A mounted OPTIONAL group the quote did not freeze (added
//     to the kit after the quote) releases without insert, unless the item
//     chose one explicitly — never an insert nobody priced.
//   - frozen nil (snapshot frozen before #1627 — owner decision): every
//     mounted OPTIONAL group the item did not choose explicitly is released
//     without insert; explicit choices are kept untouched.
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
	for code := range mountedAccessoryGroupCodes(module, catalog, choices) {
		if value, wasFrozen := frozen[code]; wasFrozen {
			if value == domain.AccessoryChoiceNone && required[code] {
				continue
			}
			out[code] = value
			continue
		}
		if required[code] || strings.TrimSpace(out[code]) != "" {
			continue
		}
		out[code] = domain.AccessoryChoiceNone
	}
	return out
}
