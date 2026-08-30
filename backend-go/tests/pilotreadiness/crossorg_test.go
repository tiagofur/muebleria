// Cross-org isolation checks (F179, ADR-0005 §1): with a token of org X,
// nothing from org Y may be listed, read, updated or deleted — and the
// rejection must be indistinguishable from "does not exist" (404, never a
// 403 that confirms existence). Both directions are exercised.

package pilotreadiness

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

type crossDirection struct {
	name   string
	viewer pilotOrg
	target pilotOrg
}

func TestPilotReadiness_CrossOrgIsolation(t *testing.T) {
	for _, d := range []crossDirection{
		{name: "token_A_sees_nothing_of_B", viewer: fx.a, target: fx.b},
		{name: "token_B_sees_nothing_of_A", viewer: fx.b, target: fx.a},
	} {
		t.Run(d.name, func(t *testing.T) { crossOrgDirection(t, d) })
	}
}

func crossOrgDirection(t *testing.T, d crossDirection) {
	t.Helper()
	tok := d.viewer.admin.token

	// --- Listings never show the other org -------------------------------

	assertListScoped(t, "customers", tok, d.viewer, d.target)
	assertListScoped(t, "projects", tok, d.viewer, d.target)

	var boards []struct {
		ID   string `json:"id"`
		Code string `json:"code"`
	}
	fx.decode(t, http.MethodGet, "/api/catalog/materials", tok, nil, http.StatusOK, &boards)
	for _, b := range boards {
		if b.Code == d.target.material.code {
			t.Fatalf("catalog: %s board %q leaked into %s's material list", d.target.name, d.target.material.code, d.viewer.name)
		}
	}
	foundOwn := false
	for _, b := range boards {
		if b.Code == d.viewer.material.code {
			foundOwn = true
		}
	}
	if !foundOwn {
		t.Fatalf("catalog: %s's own board %q missing from its list", d.viewer.name, d.viewer.material.code)
	}

	// Cloned catalog modules: both orgs have a full copy, but the rows are
	// per-org — ids must be disjoint.
	var viewerModules, targetModules []struct {
		ID string `json:"id"`
	}
	fx.decode(t, http.MethodGet, "/api/catalog/modules", tok, nil, http.StatusOK, &viewerModules)
	fx.decode(t, http.MethodGet, "/api/catalog/modules", d.target.admin.token, nil, http.StatusOK, &targetModules)
	if len(viewerModules) == 0 || len(targetModules) == 0 {
		t.Fatalf("catalog: cloned modules empty (%s: %d, %s: %d)", d.viewer.name, len(viewerModules), d.target.name, len(targetModules))
	}
	targetIDs := map[string]struct{}{}
	for _, m := range targetModules {
		targetIDs[m.ID] = struct{}{}
	}
	for _, m := range viewerModules {
		if _, leak := targetIDs[m.ID]; leak {
			t.Fatalf("catalog: module %s is shared between %s and %s — clones must be independent rows", m.ID, d.viewer.name, d.target.name)
		}
	}

	// User directory and team: only members of the caller's org.
	var team struct {
		Items []struct {
			UserID string `json:"user_id"`
		} `json:"items"`
	}
	fx.decode(t, http.MethodGet, "/api/org/memberships", tok, nil, http.StatusOK, &team)
	for _, m := range team.Items {
		if m.UserID == d.target.admin.id {
			t.Fatalf("team: %s's owner appears in %s's /api/org/memberships", d.target.name, d.viewer.name)
		}
	}

	// --- GET by foreign id fails closed -----------------------------------

	for _, path := range []string{
		"/api/customers/" + d.target.customer.id,
		"/api/projects/" + d.target.project.id,
		"/api/catalog/materials/" + d.target.material.id,
		"/api/projects/" + d.target.project.id + "/events",
		"/api/projects/" + d.target.project.id + "/photos",
	} {
		fx.want(t, http.MethodGet, path, tok, nil, http.StatusNotFound)
	}

	// Manufacturing subresources (mfgOnly gate): the sales/foreign org gets
	// the same 404 as for a missing project.
	assertUniform404(t, tok,
		"/api/projects/"+d.target.project.id+"/quality",
		"/api/projects/"+nonexistentUUID+"/quality")
	assertUniform404(t, tok,
		"/api/projects/"+d.target.project.id+"/part-executions",
		"/api/projects/"+nonexistentUUID+"/part-executions")

	// Generic project reads must also be uniform vs a truly missing id.
	assertUniform404(t, tok,
		"/api/projects/"+d.target.project.id,
		"/api/projects/"+nonexistentUUID)

	// --- UPDATE by foreign id fails, row stays intact ----------------------

	var targetCustomer struct {
		Name   string `json:"name"`
		Active bool   `json:"active"`
	}
	updateForeign := map[string]string{
		"name":  "HACKED " + d.target.customer.name,
		"email": "hacked@pilot-readiness.test",
	}
	fx.want(t, http.MethodPut, "/api/customers/"+d.target.customer.id, tok, updateForeign, http.StatusNotFound)
	fx.want(t, http.MethodPut, "/api/projects/"+d.target.project.id, tok, map[string]any{
		"name": "HACKED " + d.target.project.name, "customer_id": d.target.customer.id,
	}, http.StatusNotFound)
	fx.want(t, http.MethodPut, "/api/catalog/materials/"+d.target.material.id, tok, map[string]any{
		"code": "HACKED", "name": "HACKED", "manufacturer": "HACKED",
	}, http.StatusNotFound)
	fx.decode(t, http.MethodGet, "/api/customers/"+d.target.customer.id, d.target.admin.token, nil, http.StatusOK, &targetCustomer)
	if targetCustomer.Name != d.target.customer.name || !targetCustomer.Active {
		t.Fatalf("cross-org PUT left traces: customer of %s is %+v (want name %q active)", d.target.name, targetCustomer, d.target.customer.name)
	}

	// Foreign writes on subresources also fail closed.
	fx.want(t, http.MethodPost, "/api/projects/"+d.target.project.id+"/events", tok, map[string]any{
		"type": "quote_created", "source": "api",
	}, http.StatusNotFound)
	fx.want(t, http.MethodPost, "/api/projects/"+d.target.project.id+"/photos", tok, map[string]any{
		"url": "/api/media/whatever.png",
	}, http.StatusNotFound)

	// --- DELETE by foreign id fails, row survives --------------------------

	fx.want(t, http.MethodDelete, "/api/customers/"+d.target.customer.id, tok, nil, http.StatusNotFound)
	fx.want(t, http.MethodDelete, "/api/projects/"+d.target.project.id, tok, nil, http.StatusNotFound)
	fx.want(t, http.MethodDelete, "/api/catalog/materials/"+d.target.material.id, tok, nil, http.StatusNotFound)
	fx.decode(t, http.MethodGet, "/api/customers/"+d.target.customer.id, d.target.admin.token, nil, http.StatusOK, &targetCustomer)
	if !targetCustomer.Active {
		t.Fatalf("cross-org DELETE deactivated %s's customer — delete must be org-scoped", d.target.name)
	}

	// --- Media of the other org is not downloadable ------------------------

	fx.want(t, http.MethodGet, "/api/media/"+d.target.media.name, tok, nil, http.StatusNotFound)
	fx.want(t, http.MethodGet, "/api/media/"+d.target.media.name, d.target.admin.token, nil, http.StatusOK)

	// --- Workshop settings never mix ---------------------------------------

	var settings struct {
		DefaultCurrency string `json:"default_currency"`
	}
	fx.decode(t, http.MethodGet, "/api/settings", tok, nil, http.StatusOK, &settings)
	if settings.DefaultCurrency != d.viewer.settings.DefaultCurrency {
		t.Fatalf("settings: %s reads currency %q, expected its own %q", d.viewer.name, settings.DefaultCurrency, d.viewer.settings.DefaultCurrency)
	}
	if settings.DefaultCurrency == d.target.settings.DefaultCurrency {
		t.Fatalf("settings: fixture currencies must differ between orgs (both %q)", settings.DefaultCurrency)
	}

	// A settings write in the viewer org must not leak into the target org.
	// Baselines are read live so the check is self-contained per direction
	// (the other direction legitimately flipped its own org's flag already).
	var viewerBefore, targetBefore struct {
		VendedorCanViewCosts bool `json:"vendedor_can_view_costs"`
	}
	fx.decode(t, http.MethodGet, "/api/settings", tok, nil, http.StatusOK, &viewerBefore)
	fx.decode(t, http.MethodGet, "/api/settings", d.target.admin.token, nil, http.StatusOK, &targetBefore)
	fx.want(t, http.MethodPut, "/api/settings", tok, map[string]any{
		"default_currency":         d.viewer.settings.DefaultCurrency,
		"default_margin_factor":    d.viewer.settings.DefaultMarginFactor,
		"default_labor_fixed_cost": d.viewer.settings.DefaultLaborFixedCost,
		"default_cut_strategy":     d.viewer.settings.DefaultCutStrategy,
		"vendedor_can_view_costs":  !viewerBefore.VendedorCanViewCosts,
	}, http.StatusOK)
	var targetAfter struct {
		VendedorCanViewCosts bool `json:"vendedor_can_view_costs"`
	}
	fx.decode(t, http.MethodGet, "/api/settings", d.target.admin.token, nil, http.StatusOK, &targetAfter)
	if targetAfter.VendedorCanViewCosts != targetBefore.VendedorCanViewCosts {
		t.Fatalf("settings: PUT in %s changed the flag of %s — settings are not isolated", d.viewer.name, d.target.name)
	}
}

// assertListScoped checks that the customers/projects listing of the viewer
// org contains its own fixture row and never the target's.
func assertListScoped(t *testing.T, resource, tok string, viewer, target pilotOrg) {
	t.Helper()
	var list []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	fx.decode(t, http.MethodGet, "/api/"+resource, tok, nil, http.StatusOK, &list)
	var ownFound, leaked bool
	for _, item := range list {
		if item.ID == viewer.project.id && resource == "projects" ||
			item.ID == viewer.customer.id && resource == "customers" {
			ownFound = true
		}
		if item.ID == target.customer.id || item.ID == target.project.id || item.Name == target.customer.name || item.Name == target.project.name {
			leaked = true
		}
	}
	if leaked {
		t.Fatalf("%s: listing leaked rows of %s", resource, target.name)
	}
	if !ownFound {
		t.Fatalf("%s: own fixture row of %s missing from its listing", resource, viewer.name)
	}
}

// assertUniform404 demands that accessing a foreign-org resource and a truly
// missing one produce identical responses — cross-org access must never
// confirm existence (ADR-0005: 404, not 403).
func assertUniform404(t *testing.T, tok, foreignPath, missingPath string) {
	t.Helper()
	s1, b1 := fx.do(t, http.MethodGet, foreignPath, tok, nil)
	s2, b2 := fx.do(t, http.MethodGet, missingPath, tok, nil)
	if s1 != http.StatusNotFound || s2 != http.StatusNotFound {
		t.Fatalf("uniform 404: foreign=%d missing=%d (both must be 404)", s1, s2)
	}
	var e1, e2 struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(b1, &e1); err != nil {
		t.Fatalf("uniform 404: decode foreign body: %v body=%s", err, truncate(b1))
	}
	if err := json.Unmarshal(b2, &e2); err != nil {
		t.Fatalf("uniform 404: decode missing body: %v body=%s", err, truncate(b2))
	}
	if e1.Error != e2.Error {
		t.Fatalf("uniform 404: cross-org response is distinguishable: foreign=%q missing=%q", e1.Error, e2.Error)
	}
}

// Sanity guard for the fixture itself: identical payloads must not collide.
func TestPilotReadiness_FixtureSanity(t *testing.T) {
	if fx.a.id == fx.b.id || fx.a.slug == fx.b.slug {
		t.Fatalf("fixture: orgs A and B are not independent (%+v / %+v)", fx.a.id, fx.b.id)
	}
	if fx.a.admin.id == fx.b.admin.id {
		t.Fatal("fixture: orgs share the owner user")
	}
	if org := fx.customerOrgID(t, fx.a.customer.id); org != fx.a.id {
		t.Fatalf("fixture: customer of A landed in org %s (want %s)", org, fx.a.id)
	}
	if org := fx.customerOrgID(t, fx.b.customer.id); org != fx.b.id {
		t.Fatalf("fixture: customer of B landed in org %s (want %s)", org, fx.b.id)
	}
	fmt.Printf("fixture: pilot-a=%s pilot-b=%s initial=%s\n", fx.a.id, fx.b.id, "00000000-0000-0000-0000-000000000001")
}
