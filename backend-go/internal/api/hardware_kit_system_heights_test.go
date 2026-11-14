package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1625 — «Añadir altura» transaccional. Real throwaway PostgreSQL with the
// auth middleware's envelope (rollback on ≥500, commit otherwise): every
// failure path is proven by SQL readback, including the one where the
// ensamble update already ran when a later insert fails.

func (e *kitSysE2E) runHeight(t *testing.T, agregadoID string, version int64, body string) *httptest.ResponseRecorder {
	t.Helper()
	actor := storage.TenantActor{OrganizationID: e.org, UserID: kitSysActor}
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/hardware-kit-systems/"+agregadoID+"/heights", strings.NewReader(body)), kitSysActor, string(domain.RoleAdmin))
	req.SetPathValue("agregadoId", agregadoID)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("If-Match", fmt.Sprintf(`"v%d"`, version))
	rec := httptest.NewRecorder()
	err := e.store.WithinTenantTx(req.Context(), actor, func(txCtx context.Context) error {
		e.server.HandleHardwareKitSystemHeightAdd(rec, req.WithContext(txCtx))
		if rec.Code >= http.StatusInternalServerError {
			return errTenantHandlerFailure
		}
		return nil
	})
	if err != nil && rec.Code < http.StatusInternalServerError {
		t.Fatalf("tenant tx failed but handler buffered %d: %v", rec.Code, err)
	}
	return rec
}

// agregadoState reads the ensamble (row + current recipe) under the actor's
// tenant transaction: its version and its height nominals.
func (e *kitSysE2E) agregadoState(t *testing.T, id string) (int64, []float64, int) {
	t.Helper()
	actor := storage.TenantActor{OrganizationID: e.org, UserID: kitSysActor}
	var version int64
	var nominals []float64
	height := 0
	err := e.store.WithinTenantTx(context.Background(), actor, func(ctx context.Context) error {
		a, err := e.store.GetAgregadoByIDWithRecipe(ctx, id)
		if err != nil {
			return err
		}
		version, height = a.Version, a.HeightMm
		for _, vs := range a.VariantSets {
			if vs.Dimension == "height" {
				for _, v := range vs.Variants {
					nominals = append(nominals, v.NominalDimensionMm)
				}
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("agregado readback: %v", err)
	}
	return version, nominals, height
}

// heightSystem creates a system (E 209) through the real create endpoint and
// switches the org to a custom library (adding a height edits the ensamble
// recipe — the same gate as the ensamble PUT). Returns the ensamble id.
func heightSystem(t *testing.T, e *kitSysE2E, code string, seed int) string {
	t.Helper()
	rec := e.run(t, kitSystemPayload(code, seed, ""))
	if rec.Code != http.StatusCreated {
		t.Fatalf("system create = %d %s", rec.Code, rec.Body.String())
	}
	if _, err := e.migrationPool.Exec(context.Background(),
		`UPDATE organizations SET library_type = 'custom' WHERE id = $1`, e.org); err != nil {
		t.Fatalf("enable custom library: %v", err)
	}
	return decodeKitSystemResponse(rec).AgregadoID
}

// heightPayload builds a valid height plan: kit + FIJ design row, and when
// withInserts, one insert row as the only option of a selector linked to the
// new kit. brokenFijID swaps the design row id for an invalid value so the
// insert fails AFTER the ensamble update — the rollback probe.
func heightPayload(kitCode string, seed int, nominal float64, withInserts bool, brokenFijID string) string {
	kitID := kitSystemUUID(seed*10 + 1)
	fijID := orString(brokenFijID, kitSystemUUID(seed*10+2))
	insID := kitSystemUUID(seed*10 + 3)
	grpID := kitSystemUUID(seed*10 + 4)
	rows := []string{
		fmt.Sprintf(`{"id":%q,"code":%q,"name":"Kit %s","unit":"set","cost_per_unit":300,"active":true}`, kitID, kitCode, kitCode),
		fmt.Sprintf(`{"id":%q,"code":"%s-FIJ","name":"Fija %s","unit":"piece","cost_per_unit":0,"active":true,"kit_hardware_id":%q,"pieces":[{"anchor":"left"},{"anchor":"right"}]}`, fijID, kitCode, kitCode, kitID),
	}
	group := "null"
	if withInserts {
		rows = append(rows, fmt.Sprintf(`{"id":%q,"code":"%s-GAL","name":"Galería %s","unit":"piece","cost_per_unit":0,"active":true,"pieces":[{"anchor":"left","offsetMm":{"x":0,"y":0,"z":0}},{"anchor":"right","offsetMm":{"x":0,"y":0,"z":0}}],"design_parts":[{"component_name":"%s-GAL","actor_membership":"actor:drawer"}]}`, insID, kitCode, kitCode, kitCode))
		group = fmt.Sprintf(`{"id":%q,"code":"%s_INSERTOS","name":"Insertos %s","kind":"hardware","required":false,"option_ids":[%q],"kit_hardware_id":%q}`, grpID, kitCode, kitCode, insID, kitID)
	}
	return fmt.Sprintf(`{"hardware":[%s],"variant":{"nominalDimensionMm":%g,"kit_hardware_id":%q},"option_group":%s}`,
		strings.Join(rows, ","), nominal, kitID, group)
}

func TestHardwareKitSystemHeight_AddsHeightAtomically_1625(t *testing.T) {
	e := kitSystemE2EStore(t)
	agrID := heightSystem(t, e, "HSYS-A", 41)
	version, nominals, _ := e.agregadoState(t, agrID)
	if len(nominals) != 1 {
		t.Fatalf("seed system nominals = %v", nominals)
	}

	rec := e.runHeight(t, agrID, version, heightPayload("HSYS-A-M", 42, 108, false, ""))
	if rec.Code != http.StatusCreated {
		t.Fatalf("add height = %d %s", rec.Code, rec.Body.String())
	}
	var added openapi.HardwareKitSystemHeightAdded
	_ = json.Unmarshal(rec.Body.Bytes(), &added)
	if got := e.sqlCount(t, "hardwares", []string{"HSYS-A-M", "HSYS-A-M-FIJ"}); got != 2 {
		t.Fatalf("hardware rows = %d, want 2", got)
	}
	nextVersion, nextNominals, height := e.agregadoState(t, agrID)
	if len(nextNominals) != 2 || nextNominals[1] != 108 {
		t.Fatalf("height variants = %v, want [209 108]", nextNominals)
	}
	if nextVersion != version+1 || added.AgregadoVersion != nextVersion {
		t.Fatalf("version: before %d, after %d, echoed %d", version, nextVersion, added.AgregadoVersion)
	}
	if height != 209 || added.HeightMm != 209 {
		t.Fatalf("external height must stay at the tallest variant (209): row %d, echoed %d", height, added.HeightMm)
	}
	if added.VariantSetID == "" || len(added.CreatedCodes) != 2 {
		t.Fatalf("response = %+v", added)
	}
}

func TestHardwareKitSystemHeight_InsertsAndSelectorInSameTransaction_1625(t *testing.T) {
	e := kitSystemE2EStore(t)
	agrID := heightSystem(t, e, "HSYS-B", 43)
	version, _, _ := e.agregadoState(t, agrID)

	rec := e.runHeight(t, agrID, version, heightPayload("HSYS-B-K", 44, 146, true, ""))
	if rec.Code != http.StatusCreated {
		t.Fatalf("add height with inserts = %d %s", rec.Code, rec.Body.String())
	}
	if got := e.sqlCount(t, "hardwares", []string{"HSYS-B-K", "HSYS-B-K-FIJ", "HSYS-B-K-GAL"}); got != 3 {
		t.Fatalf("hardware rows = %d, want 3", got)
	}
	if got := e.sqlCount(t, "option_groups", []string{"HSYS-B-K_INSERTOS"}); got != 1 {
		t.Fatalf("insert selector rows = %d, want 1", got)
	}
}

func TestHardwareKitSystemHeight_FailuresLeaveNothingBehind_1625(t *testing.T) {
	e := kitSystemE2EStore(t)
	agrID := heightSystem(t, e, "HSYS-C", 45)
	version, _, _ := e.agregadoState(t, agrID)

	cases := []struct {
		name    string
		version int64
		body    string
		status  int
		code    string
		codes   []string
	}{
		{"versión del ensamble que no coincide", version + 5, heightPayload("HSYS-C-M", 46, 108, false, ""), http.StatusPreconditionFailed, "", []string{"HSYS-C-M", "HSYS-C-M-FIJ"}},
		{"altura repetida", version, heightPayload("HSYS-C-E2", 47, 209, false, ""), http.StatusUnprocessableEntity, "HARDWARE_KIT_SYSTEM_HEIGHT_EXISTS", []string{"HSYS-C-E2", "HSYS-C-E2-FIJ"}},
		{"código tomado (el kit del sistema)", version, heightPayload("HSYS-C", 48, 108, false, ""), http.StatusConflict, "HARDWARE_KIT_SYSTEM_CODE_TAKEN", []string{"HSYS-C-FIJ-NUEVO"}},
		{"código del selector tomado (el del sistema)", version, strings.Replace(heightPayload("HSYS-C-K", 52, 146, true, ""), `"code":"HSYS-C-K_INSERTOS"`, `"code":"HSYS-C_LATERAL_E"`, 1), http.StatusConflict, "HARDWARE_KIT_SYSTEM_CODE_TAKEN", []string{"HSYS-C-K", "HSYS-C-K-FIJ", "HSYS-C-K-GAL"}},
		{"fila de inserto sin selector", version, strings.Replace(heightPayload("HSYS-C-N", 49, 85.5, true, ""), `"option_group":{`, `"option_group":null,"_":{`, 1), http.StatusUnprocessableEntity, "HARDWARE_KIT_SYSTEM_PAYLOAD_INVALID", []string{"HSYS-C-N", "HSYS-C-N-FIJ", "HSYS-C-N-GAL"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := e.runHeight(t, agrID, c.version, c.body)
			if rec.Code != c.status {
				t.Fatalf("status = %d, want %d: %s", rec.Code, c.status, rec.Body.String())
			}
			if c.code != "" && !strings.Contains(rec.Body.String(), c.code) {
				t.Fatalf("body must carry %s: %s", c.code, rec.Body.String())
			}
			if got := e.sqlCount(t, "hardwares", c.codes); got != 0 {
				t.Fatalf("leaked %d hardware rows", got)
			}
			after, nominals, _ := e.agregadoState(t, agrID)
			if after != version || len(nominals) != 1 {
				t.Fatalf("ensamble changed: version %d→%d, nominals %v", version, after, nominals)
			}
		})
	}
}

// The insert fails AFTER the ensamble update already ran inside the
// transaction: the 5xx must roll the ensamble back too (SQL readback of its
// version and recipe), never a variant pointing at a kit that was not created.
func TestHardwareKitSystemHeight_MidFailureRollsBackEnsambleUpdate_1625(t *testing.T) {
	e := kitSystemE2EStore(t)
	agrID := heightSystem(t, e, "HSYS-D", 50)
	version, _, _ := e.agregadoState(t, agrID)

	rec := e.runHeight(t, agrID, version, heightPayload("HSYS-D-M", 51, 108, false, "not-a-uuid"))
	if rec.Code < http.StatusInternalServerError {
		t.Fatalf("mid-failure = %d (want ≥500 so the tx rolls back): %s", rec.Code, rec.Body.String())
	}
	if got := e.sqlCount(t, "hardwares", []string{"HSYS-D-M", "HSYS-D-M-FIJ"}); got != 0 {
		t.Fatalf("rollback leaked %d hardware rows", got)
	}
	after, nominals, _ := e.agregadoState(t, agrID)
	if after != version || len(nominals) != 1 {
		t.Fatalf("rollback must restore the ensamble: version %d→%d, nominals %v", version, after, nominals)
	}
}

// Pure plan validation (no DB): the payload's own references fail closed.
func TestKitSystemHeightPlanValidation_1625(t *testing.T) {
	decode := func(body string) *openapi.HardwareKitSystemHeightAddRequest {
		var req openapi.HardwareKitSystemHeightAddRequest
		if err := json.Unmarshal([]byte(body), &req); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return &req
	}
	valid := heightPayload("PLAN-M", 60, 108, true, "")
	if _, err := kitSystemHeightPlanFromRequest(decode(valid)); err != nil {
		t.Fatalf("valid plan rejected: %v", err)
	}
	cases := map[string]string{
		"dos filas kit":         strings.Replace(valid, `"unit":"piece","cost_per_unit":0,"active":true,"kit_hardware_id"`, `"unit":"set","cost_per_unit":0,"active":true,"kit_hardware_id"`, 1),
		"variante con otro kit": strings.Replace(valid, fmt.Sprintf(`"variant":{"nominalDimensionMm":108,"kit_hardware_id":%q}`, kitSystemUUID(601)), `"variant":{"nominalDimensionMm":108,"kit_hardware_id":"otro"}`, 1),
		"altura cero":           strings.Replace(valid, `"nominalDimensionMm":108`, `"nominalDimensionMm":0`, 1),
		"selector a otro kit":   strings.Replace(valid, fmt.Sprintf(`"option_ids":[%q],"kit_hardware_id":%q`, kitSystemUUID(603), kitSystemUUID(601)), fmt.Sprintf(`"option_ids":[%q],"kit_hardware_id":"otro"`, kitSystemUUID(603)), 1),
		"código repetido":       strings.Replace(valid, `"code":"PLAN-M-FIJ"`, `"code":"PLAN-M"`, 1),
	}
	for name, body := range cases {
		if body == valid {
			t.Fatalf("%s: the mutation did not apply", name)
		}
		if _, err := kitSystemHeightPlanFromRequest(decode(body)); err == nil {
			t.Fatalf("%s: plan must be rejected", name)
		}
	}
}
