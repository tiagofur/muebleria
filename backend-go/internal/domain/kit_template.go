package domain

import (
	"fmt"
	"math"
	"regexp"
	"time"
)

// #1422 slice 2 — workshop kit templates: declarative "juego de herraje"
// blueprints (slots + memberships + motion) the hardware-kit wizard arms.
// Validate is the byte-for-byte twin of validateHardwareKitTemplate
// (packages/domain/src/hardwareKit.ts): identical issue codes, messages and
// paths over the shared fixture (contracts/kitTemplateValidation.contract.json).
// Messages are English at the domain edge; the API/UI layers translate.

const (
	kitTemplateIDPattern       = `^[A-Za-z0-9_-]{1,64}$`
	kitTemplateCodePattern     = `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`
	kitTemplateKeyPattern      = `^[a-z0-9_]{1,40}$`
	kitTemplateSuffixPattern   = `^-[A-Za-z0-9._-]{1,15}$`
	kitTemplateActorPattern    = `^actor:[a-z0-9_-]{1,32}$`
	kitTemplateMaxSlots        = 12
	kitTemplateMaxOffsetMm     = 100000.0
	kitTemplateIssueCode       = "KIT_TEMPLATE_INVALID"
	kitTemplateMembershipBody  = "body"
	kitTemplateAnchorMin       = "min"
	kitTemplateAnchorMax       = "max"
	kitTemplateAnchorCenter    = "center"
	kitTemplateMotionTranslate = "translate"
	kitTemplateMotionRotLeft   = "rotate_left"
	kitTemplateMotionRotRight  = "rotate_right"
	kitTemplateMotionNone      = "none"
)

var (
	kitTemplateIDRE     = regexp.MustCompile(kitTemplateIDPattern)
	kitTemplateCodeRE   = regexp.MustCompile(kitTemplateCodePattern)
	kitTemplateKeyRE    = regexp.MustCompile(kitTemplateKeyPattern)
	kitTemplateSuffixRE = regexp.MustCompile(kitTemplateSuffixPattern)
	kitTemplateActorRE  = regexp.MustCompile(kitTemplateActorPattern)
)

// KitTemplateSlot is one design part the wizard derives from the kit code.
type KitTemplateSlot struct {
	Slot            string  `json:"slot"`
	MemberID        string  `json:"memberId"`
	Suffix          string  `json:"suffix"`
	LabelEs         string  `json:"labelEs"`
	Role            string  `json:"role"`
	Membership      string  `json:"membership"`
	AnchorXRef      string  `json:"anchorXRef"`
	OffsetSign      float64 `json:"offsetSign"`
	DefaultOffsetMm float64 `json:"defaultOffsetMm"`
}

// KitTemplate is one workshop kit template row (org-scoped). Embedded
// templates omit Code (their id is the stable selector); persisted workshop
// templates carry it (unique per organization).
type KitTemplate struct {
	ID              string            `json:"id"`
	Code            *string           `json:"code,omitempty"`
	LabelEs         string            `json:"labelEs"`
	Slots           []KitTemplateSlot `json:"slots"`
	Motion          string            `json:"motion"`
	AgregadoLabelEs string            `json:"agregadoLabelEs"`
	Active          bool              `json:"active"`
	Version         int64             `json:"version"`
	CreatedAt       time.Time         `json:"created_at"`
	UpdatedAt       time.Time         `json:"updated_at"`
}

// KitTemplateIssue mirrors the TS HardwareKitTemplateIssue shape.
type KitTemplateIssue struct {
	Code     string `json:"code"`
	Message  string `json:"message"`
	Severity string `json:"severity"`
	EntityID string `json:"entityId"`
	Path     string `json:"path"`
}

// KitTemplateMotionValid reports whether motion belongs to the closed
// kinematics vocabulary the agregado presentationMotion accepts.
func KitTemplateMotionValid(motion string) bool {
	switch motion {
	case kitTemplateMotionTranslate, kitTemplateMotionRotLeft, kitTemplateMotionRotRight, kitTemplateMotionNone:
		return true
	}
	return false
}

func (t KitTemplate) add(issues *[]KitTemplateIssue, message, path string) {
	*issues = append(*issues, KitTemplateIssue{
		Code: kitTemplateIssueCode, Message: message, Severity: "error",
		EntityID: t.ID, Path: path,
	})
}

// Validate is the fail-closed structural twin of the TS validator.
func (t KitTemplate) Validate() []KitTemplateIssue {
	issues := []KitTemplateIssue{}
	if t.ID == "" || !kitTemplateIDRE.MatchString(t.ID) {
		t.add(&issues, "kit template id must match "+kitTemplateIDPattern, "id")
	}
	if t.Code != nil && !kitTemplateCodeRE.MatchString(*t.Code) {
		t.add(&issues, "kit template code must match "+kitTemplateCodePattern, "code")
	}
	if t.LabelEs == "" {
		t.add(&issues, "kit template needs a non-blank labelEs", "labelEs")
	}
	if t.AgregadoLabelEs == "" {
		t.add(&issues, "kit template needs a non-blank agregadoLabelEs", "agregadoLabelEs")
	}
	if !KitTemplateMotionValid(t.Motion) {
		t.add(&issues, "kit template motion must be one of translate, rotate_left, rotate_right, none", "motion")
	}
	if len(t.Slots) == 0 {
		t.add(&issues, "kit template needs at least one slot", "slots")
		return issues
	}
	if len(t.Slots) > kitTemplateMaxSlots {
		t.add(&issues, fmt.Sprintf("kit template carries more than %d slots", kitTemplateMaxSlots), "slots")
		return issues
	}

	seenSlots := map[string]bool{}
	seenMembers := map[string]bool{}
	seenSuffixes := map[string]bool{}
	for index, slot := range t.Slots {
		path := fmt.Sprintf("slots[%d]", index)
		if slot.Slot == "" || !kitTemplateKeyRE.MatchString(slot.Slot) {
			t.add(&issues, "kit template slot key must match "+kitTemplateKeyPattern, path+".slot")
		} else if seenSlots[slot.Slot] {
			t.add(&issues, fmt.Sprintf("slot %s appears more than once", slot.Slot), path+".slot")
		}
		seenSlots[slot.Slot] = true
		if slot.MemberID == "" || !kitTemplateKeyRE.MatchString(slot.MemberID) {
			t.add(&issues, "kit template member id must match "+kitTemplateKeyPattern, path+".memberId")
		} else if seenMembers[slot.MemberID] {
			t.add(&issues, fmt.Sprintf("member %s appears more than once: recipe identity would collide", slot.MemberID), path+".memberId")
		}
		seenMembers[slot.MemberID] = true
		if slot.Suffix == "" || !kitTemplateSuffixRE.MatchString(slot.Suffix) {
			t.add(&issues, "kit template slot suffix must match "+kitTemplateSuffixPattern, path+".suffix")
		} else if seenSuffixes[slot.Suffix] {
			t.add(&issues, fmt.Sprintf("suffix %s appears more than once: part codes would collide", slot.Suffix), path+".suffix")
		}
		seenSuffixes[slot.Suffix] = true
		if slot.LabelEs == "" {
			t.add(&issues, "kit template slot needs a non-blank labelEs", path+".labelEs")
		}
		if slot.Role == "" || !kitTemplateKeyRE.MatchString(slot.Role) {
			t.add(&issues, "kit template slot role must match "+kitTemplateKeyPattern, path+".role")
		}
		if slot.Membership != kitTemplateMembershipBody && !kitTemplateActorRE.MatchString(slot.Membership) {
			t.add(&issues, "kit template slot membership must be body or actor:<identifier>", path+".membership")
		}
		if slot.AnchorXRef != kitTemplateAnchorMin && slot.AnchorXRef != kitTemplateAnchorMax && slot.AnchorXRef != kitTemplateAnchorCenter {
			t.add(&issues, "kit template slot anchorXRef must be min, max or center", path+".anchorXRef")
		}
		if slot.OffsetSign != 1 && slot.OffsetSign != -1 {
			t.add(&issues, "kit template slot offsetSign must be 1 or -1", path+".offsetSign")
		}
		if math.IsNaN(slot.DefaultOffsetMm) || math.IsInf(slot.DefaultOffsetMm, 0) || math.Abs(slot.DefaultOffsetMm) > kitTemplateMaxOffsetMm {
			t.add(&issues, fmt.Sprintf("kit template slot offset must be a finite number within ±%d mm", int(kitTemplateMaxOffsetMm)), path+".defaultOffsetMm")
		}
	}
	return issues
}
