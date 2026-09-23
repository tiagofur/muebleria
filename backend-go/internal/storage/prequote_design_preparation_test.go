package storage_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/api"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// The ordinary Design create intent must prepare the current draft's physical
// identities without making a QuoteRevision or modeling anything.
func TestPrequoteDesignPreparation_TwoDraftLines(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	seedQuoteLines(t, fx, fiProjectAOnly, map[string]int{
		qlfiLineQty1:    1,
		qlfiLineDynamic: 1,
	})
	var projectBefore, linesBefore string
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT to_jsonb(p)::text FROM projects p WHERE id=$1`, fiProjectAOnly).Scan(&projectBefore); err != nil {
		t.Fatal(err)
	}
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT COALESCE(jsonb_agg(to_jsonb(pi) ORDER BY pi.id), '[]'::jsonb)::text FROM project_items pi WHERE project_id=$1`,
		fiProjectAOnly).Scan(&linesBefore); err != nil {
		t.Fatal(err)
	}

	var designID string
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		created, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiProjectAOnly,
			Name:        "Prequote Design",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		designID = created.ID
		return nil
	})
	if err != nil {
		t.Fatalf("create Design: %v", err)
	}

	var workspace *domain.FurnitureWorkspace
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		workspace, err = fx.store.GetProjectFurnitureWorkspace(ctx, fiProjectAOnly, storage.FurnitureWorkspaceQuery{DesignID: designID})
		return err
	})
	if err != nil {
		t.Fatalf("read furniture workspace: %v", err)
	}
	if workspace.Summary.ActiveUnits != 2 || workspace.Summary.Pending != 2 || workspace.Summary.Placed != 0 {
		t.Fatalf("workspace summary = %+v, want 2 active, 2 pending, 0 placed", workspace.Summary)
	}

	ids := make(map[string]bool)
	for _, lineID := range []string{qlfiLineQty1, qlfiLineDynamic} {
		links, err := listLinks(t, fx, fiActorA(), fiProjectAOnly, lineID)
		if err != nil || len(links) != 1 {
			t.Fatalf("line %s links = %d, err %v; want one", lineID, len(links), err)
		}
		ids[links[0].FurnitureInstanceID] = true
	}
	if len(ids) != 2 {
		t.Fatalf("draft lines did not receive distinct FI IDs: %v", ids)
	}

	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		wc, err := fx.store.GetDesignWorkingCopy(ctx, designID)
		if err != nil {
			return err
		}
		if len(wc.Items) != 0 || wc.SourceType != domain.DesignRevisionSourceManual {
			t.Fatalf("working copy changed: %+v", wc)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("read working state: %v", err)
	}
	var quotes int
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT count(*) FROM quote_revisions WHERE project_id = $1`, fiProjectAOnly).Scan(&quotes); err != nil {
		t.Fatal(err)
	}
	if quotes != 0 {
		t.Fatalf("QuoteRevisions = %d, want zero", quotes)
	}
	var projectAfter, linesAfter string
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT to_jsonb(p)::text FROM projects p WHERE id=$1`, fiProjectAOnly).Scan(&projectAfter); err != nil {
		t.Fatal(err)
	}
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT COALESCE(jsonb_agg(to_jsonb(pi) ORDER BY pi.id), '[]'::jsonb)::text FROM project_items pi WHERE project_id=$1`,
		fiProjectAOnly).Scan(&linesAfter); err != nil {
		t.Fatal(err)
	}
	if projectAfter != projectBefore || linesAfter != linesBefore {
		t.Fatal("Design preparation modified the project or its commercial draft lines")
	}
}

func TestPrequoteDesignPreparation_PriorUnitsAndConcurrentDesigns(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	seedQuoteLines(t, fx, fiProjectAOnly, map[string]int{
		qlfiLineQty1:    1,
		qlfiLineDynamic: 3,
	})
	prior, err := materialize(t, fx, fiActorA(), fiProjectAOnly, qlfiLineQty1)
	if err != nil || len(prior.Instances) != 1 {
		t.Fatalf("prior materialization: %+v, %v", prior, err)
	}
	priorID := prior.Instances[0].FurnitureInstanceID

	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := fx.store.CreateDesign(storage.WithTenantActorCtx(context.Background(), fiActorA()), storage.CreateDesignCommand{
				ProjectID: fiProjectAOnly, Name: "Concurrent prequote Design", ActorUserID: rlsUserA,
			})
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent create: %v", err)
		}
	}

	first, err := listLinks(t, fx, fiActorA(), fiProjectAOnly, qlfiLineQty1)
	if err != nil || len(first) != 1 || first[0].FurnitureInstanceID != priorID {
		t.Fatalf("prior FI identity changed: %+v, %v", first, err)
	}
	second, err := listLinks(t, fx, fiActorA(), fiProjectAOnly, qlfiLineDynamic)
	if err != nil || len(second) != 3 {
		t.Fatalf("quantity-three links = %d, err %v", len(second), err)
	}
	ids := map[string]bool{priorID: true}
	for _, link := range second {
		ids[link.FurnitureInstanceID] = true
	}
	if len(ids) != 4 {
		t.Fatalf("duplicate or reused FI identity: %v", ids)
	}
}

func TestPrequoteDesignPreparation_AuthenticatedHTTP(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	seedQuoteLines(t, fx, fiProjectAOnly, map[string]int{qlfiLineQty1: 1, qlfiLineDynamic: 1})
	const secret = "prequote-design-http-test-secret"
	token := prequoteHTTPToken(t, fx, rlsOrgA, rlsUserA, secret)
	handler := api.RegisterRoutes(api.NewServer(fx.store, secret, nil, 100, 100))
	request := func(key string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/api/projects/"+fiProjectAOnly+"/designs",
			bytes.NewBufferString(`{"name":"HTTP prequote Design"}`))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", key)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		return response
	}
	first := request("prequote-http-design-create-0001")
	if first.Code != http.StatusCreated {
		t.Fatalf("POST designs status=%d body=%s", first.Code, first.Body.String())
	}
	var design struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &design); err != nil || design.ID == "" {
		t.Fatalf("POST designs response has no Design ID: %v", err)
	}
	retry := request("prequote-http-design-create-0001")
	if retry.Code != http.StatusCreated || retry.Body.String() != first.Body.String() ||
		retry.Header().Get("Idempotency-Replayed") != "true" {
		t.Fatalf("idempotent replay changed response: status=%d replayed=%q",
			retry.Code, retry.Header().Get("Idempotency-Replayed"))
	}
	for _, lineID := range []string{qlfiLineQty1, qlfiLineDynamic} {
		links, err := listLinks(t, fx, fiActorA(), fiProjectAOnly, lineID)
		if err != nil || len(links) != 1 {
			t.Fatalf("HTTP created line %s links=%d err=%v", lineID, len(links), err)
		}
	}
}

func prequoteHTTPToken(t *testing.T, fx *rlsFixture, orgID, userID, secret string) string {
	t.Helper()
	var membershipID string
	var membershipVersion, organizationVersion int64
	if err := fx.admin.QueryRow(context.Background(), `
		SELECT m.id, m.credential_version, o.credential_version
		FROM memberships m JOIN organizations o ON o.id=m.organization_id
		WHERE m.organization_id=$1 AND m.user_id=$2`, orgID, userID).
		Scan(&membershipID, &membershipVersion, &organizationVersion); err != nil {
		t.Fatal(err)
	}
	token, err := auth.GenerateLegacyWebToken(userID, "prequote@example.test", auth.TokenContext{
		Roles: []string{string(domain.RoleAdmin)}, OrgID: orgID, MembershipID: membershipID,
		MembershipCredentialVersion: membershipVersion, OrganizationCredentialVersion: organizationVersion,
	}, secret)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func TestPrequoteDesignPreparation_ExplicitQ1ReusesPreparedIDs(t *testing.T) {
	fx := setupQuoteLifecycleFixture(t)
	_, err := fx.store.CreateDesign(storage.WithTenantActorCtx(context.Background(), fiActorA()), storage.CreateDesignCommand{
		ProjectID: fx.projectID, Name: "Prequote Q1 reuse", ActorUserID: rlsUserA,
	})
	if err != nil {
		t.Fatalf("create Design: %v", err)
	}
	links, err := listLinks(t, fx.rlsFixture, fiActorA(), fx.projectID, qlLineA)
	if err != nil || len(links) != 3 {
		t.Fatalf("prepared links=%d err=%v", len(links), err)
	}
	prepared := map[string]bool{}
	for _, link := range links {
		prepared[link.FurnitureInstanceID] = true
	}
	result := createInitialRevision(t, fx)
	details := listRevisions(t, fx)
	if len(details) != 1 || len(result.CreatedInstanceIDs) != 0 || len(details[0].Items) != 3 {
		t.Fatalf("Q1 recreated units: revisions=%d created=%d", len(details), len(result.CreatedInstanceIDs))
	}
	for _, item := range details[0].Items {
		if !prepared[item.FurnitureInstanceID] {
			t.Fatalf("Q1 introduced unexpected FI %s", item.FurnitureInstanceID)
		}
	}
}

func TestPrequoteDesignPreparation_RollsBackIfLaterLineCannotRetire(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	seedQuoteLines(t, fx, fiProjectAOnly, map[string]int{qlfiLineQty1: 1, qlfiLineDynamic: 1})
	for i := 0; i < 2; i++ {
		var instanceID string
		err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
			instance, err := fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
				ProjectID: fiProjectAOnly, Origin: domain.FurnitureInstanceOriginDesign,
				ActorUserID: rlsUserA,
			})
			if err != nil {
				return err
			}
			instanceID = instance.ID
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := fx.admin.Exec(context.Background(), `
			INSERT INTO quote_line_furniture_instances (organization_id, project_id, quote_line_id, furniture_instance_id)
			VALUES ($1, $2, $3, $4)`, rlsOrgA, fiProjectAOnly, qlfiLineDynamic, instanceID); err != nil {
			t.Fatal(err)
		}
	}

	_, err := fx.store.CreateDesign(storage.WithTenantActorCtx(context.Background(), fiActorA()), storage.CreateDesignCommand{
		ProjectID: fiProjectAOnly, Name: "Must roll back", ActorUserID: rlsUserA,
	})
	if !errors.Is(err, domain.ErrFurnitureInstanceDurableHistory) {
		t.Fatalf("create with unretirable surplus err=%v, want durable-history error", err)
	}
	first, err := listLinks(t, fx, fiActorA(), fiProjectAOnly, qlfiLineQty1)
	if err != nil || len(first) != 0 {
		t.Fatalf("earlier line committed despite later failure: %+v, %v", first, err)
	}
	var designs, quotes int
	if err := fx.admin.QueryRow(context.Background(), `SELECT count(*) FROM designs WHERE project_id=$1`, fiProjectAOnly).Scan(&designs); err != nil {
		t.Fatal(err)
	}
	if err := fx.admin.QueryRow(context.Background(), `SELECT count(*) FROM quote_revisions WHERE project_id=$1`, fiProjectAOnly).Scan(&quotes); err != nil {
		t.Fatal(err)
	}
	if designs != 0 || quotes != 0 {
		t.Fatalf("partial Design/Q write after rollback: designs=%d quotes=%d", designs, quotes)
	}
}

func TestPrequoteDesignPreparation_ForeignActorCannotPrepare(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	seedQuoteLines(t, fx, fiProjectAOnly, map[string]int{qlfiLineQty1: 1})
	readErr := fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		_, err := fx.store.GetProjectFurnitureWorkspace(ctx, fiProjectAOnly, storage.FurnitureWorkspaceQuery{})
		return err
	})
	if !errors.Is(readErr, domain.ErrDesignNotFound) {
		t.Fatalf("foreign workspace read err=%v, want not found", readErr)
	}
	_, err := fx.store.CreateDesign(storage.WithTenantActorCtx(context.Background(), fiActorB()), storage.CreateDesignCommand{
		ProjectID: fiProjectAOnly, Name: "Foreign Design", ActorUserID: rlsUserB,
	})
	if !errors.Is(err, domain.ErrDesignNotFound) {
		t.Fatalf("foreign create err=%v, want not found", err)
	}
	var units int
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT count(*) FROM furniture_instances WHERE project_id=$1`, fiProjectAOnly).Scan(&units); err != nil {
		t.Fatal(err)
	}
	if units != 0 {
		t.Fatalf("foreign create prepared %d units", units)
	}
}

func TestPrequoteDesignPreparation_ExistingDesignHandoff(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	var designID string
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		design, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID: fiProjectAOnly, Name: "Existing empty Design", ActorUserID: rlsUserA,
		})
		if err == nil {
			designID = design.ID
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	seedQuoteLines(t, fx, fiProjectAOnly, map[string]int{qlfiLineQty1: 1, qlfiLineDynamic: 1})
	for i := 0; i < 2; i++ {
		err := fx.store.PrepareDesignDraftUnits(storage.WithTenantActorCtx(context.Background(), fiActorA()),
			storage.PrepareDesignDraftUnitsCommand{
				ProjectID: fiProjectAOnly, DesignID: designID, ActorUserID: rlsUserA,
			})
		if err != nil {
			t.Fatalf("prepare existing Design attempt %d: %v", i+1, err)
		}
	}
	for _, lineID := range []string{qlfiLineQty1, qlfiLineDynamic} {
		links, err := listLinks(t, fx, fiActorA(), fiProjectAOnly, lineID)
		if err != nil || len(links) != 1 {
			t.Fatalf("line %s links=%d err=%v", lineID, len(links), err)
		}
	}
	var designs, quotes int
	if err := fx.admin.QueryRow(context.Background(), `SELECT count(*) FROM designs WHERE project_id=$1`, fiProjectAOnly).Scan(&designs); err != nil {
		t.Fatal(err)
	}
	if err := fx.admin.QueryRow(context.Background(), `SELECT count(*) FROM quote_revisions WHERE project_id=$1`, fiProjectAOnly).Scan(&quotes); err != nil {
		t.Fatal(err)
	}
	if designs != 1 || quotes != 0 {
		t.Fatalf("existing Design handoff changed Design/Q count: designs=%d quotes=%d", designs, quotes)
	}
}

func TestPrequoteDesignPreparation_ExistingDesignHTTP(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	var designID string
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		design, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID: fiProjectAOnly, Name: "Existing HTTP Design", ActorUserID: rlsUserA,
		})
		if err == nil {
			designID = design.ID
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	seedQuoteLines(t, fx, fiProjectAOnly, map[string]int{qlfiLineQty1: 1})
	const secret = "prequote-existing-http-test-secret"
	tokenA := prequoteHTTPToken(t, fx, rlsOrgA, rlsUserA, secret)
	tokenB := prequoteHTTPToken(t, fx, rlsOrgB, rlsUserB, secret)
	handler := api.RegisterRoutes(api.NewServer(fx.store, secret, nil, 100, 100))
	request := func(token, key string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost,
			"/api/projects/"+fiProjectAOnly+"/designs/"+designID+"/draft-units:prepare", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Idempotency-Key", key)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		return response
	}
	foreign := request(tokenB, "prequote-existing-foreign-0001")
	if foreign.Code != http.StatusNotFound {
		t.Fatalf("foreign preparation status=%d, want 404", foreign.Code)
	}
	first := request(tokenA, "prequote-existing-owner-0001")
	if first.Code != http.StatusOK {
		t.Fatalf("existing Design preparation status=%d body=%s", first.Code, first.Body.String())
	}
	var prepared struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &prepared); err != nil || prepared.ID != designID {
		t.Fatalf("prepared Design response id=%q err=%v", prepared.ID, err)
	}
	retry := request(tokenA, "prequote-existing-owner-0001")
	if retry.Code != http.StatusOK || retry.Header().Get("Idempotency-Replayed") != "true" {
		t.Fatalf("existing Design retry status=%d replayed=%q", retry.Code,
			retry.Header().Get("Idempotency-Replayed"))
	}
	links, err := listLinks(t, fx, fiActorA(), fiProjectAOnly, qlfiLineQty1)
	if err != nil || len(links) != 1 {
		t.Fatalf("prepared existing Design links=%d err=%v", len(links), err)
	}
}

// A draft edit that already owns the project lock must commit before Design
// preparation reads quantity. A later edit is a new intent and converges on
// the explicit existing-Design handoff, never by mutating GET.
func TestPrequoteDesignPreparation_ConcurrentDraftEdit(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	seedQuoteLines(t, fx, fiProjectAOnly, map[string]int{qlfiLineQty1: 1})
	ctx := context.Background()
	edit, err := fx.admin.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer edit.Rollback(ctx)
	if _, err := edit.Exec(ctx, `UPDATE projects SET updated_at = NOW() WHERE id = $1`, fiProjectAOnly); err != nil {
		t.Fatal(err)
	}
	if _, err := edit.Exec(ctx, `UPDATE project_items SET quantity = 2 WHERE id = $1`, qlfiLineQty1); err != nil {
		t.Fatal(err)
	}
	result := make(chan struct {
		id  string
		err error
	}, 1)
	go func() {
		design, err := fx.store.CreateDesign(storage.WithTenantActorCtx(ctx, fiActorA()),
			storage.CreateDesignCommand{ProjectID: fiProjectAOnly, Name: "Racing draft edit", ActorUserID: rlsUserA})
		id := ""
		if design != nil {
			id = design.ID
		}
		result <- struct {
			id  string
			err error
		}{id, err}
	}()
	select {
	case early := <-result:
		t.Fatalf("Design crossed the uncommitted draft edit: %+v", early)
	case <-time.After(150 * time.Millisecond):
	}
	if err := edit.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var created struct {
		id  string
		err error
	}
	select {
	case created = <-result:
	case <-time.After(5 * time.Second):
		t.Fatal("Design did not resume after draft edit committed")
	}
	if created.err != nil || created.id == "" {
		t.Fatalf("Design after edit: %+v", created)
	}
	links, err := listLinks(t, fx, fiActorA(), fiProjectAOnly, qlfiLineQty1)
	if err != nil || len(links) != 2 || links[0].FurnitureInstanceID == links[1].FurnitureInstanceID {
		t.Fatalf("edited quantity was not prepared exactly: links=%+v err=%v", links, err)
	}
	if _, err := fx.admin.Exec(ctx, `UPDATE project_items SET quantity = 3 WHERE id = $1`, qlfiLineQty1); err != nil {
		t.Fatal(err)
	}
	if err := fx.store.PrepareDesignDraftUnits(storage.WithTenantActorCtx(ctx, fiActorA()),
		storage.PrepareDesignDraftUnitsCommand{ProjectID: fiProjectAOnly, DesignID: created.id, ActorUserID: rlsUserA}); err != nil {
		t.Fatal(err)
	}
	after, err := listLinks(t, fx, fiActorA(), fiProjectAOnly, qlfiLineQty1)
	if err != nil || len(after) != 3 || after[0].FurnitureInstanceID != links[0].FurnitureInstanceID ||
		after[1].FurnitureInstanceID != links[1].FurnitureInstanceID {
		t.Fatalf("later edit did not converge without ID churn: links=%+v err=%v", after, err)
	}
}
