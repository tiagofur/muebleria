package engine

import "testing"

func TestResolveBoardChoiceForPresentationUsesCanonicalAlias(t *testing.T) {
	choices := map[string]string{"FRENTE": "material-front"}
	if id, inherited := ResolveBoardChoiceForPresentation("PUERTA_IZQ", choices); id != "material-front" || !inherited {
		t.Fatalf("alias = %q,%v", id, inherited)
	}
	choices["PUERTA_IZQ"] = "material-door"
	if id, inherited := ResolveBoardChoiceForPresentation("PUERTA_IZQ", choices); id != "material-door" || inherited {
		t.Fatalf("direct = %q,%v", id, inherited)
	}
}
