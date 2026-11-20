package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func TestCommitProjectDeliveryDate_FirstCommitmentAndChange(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	path := "/api/projects/" + commercialTestProjectID + "/delivery-commitment"
	rr := postCommercialCommand(t, srv, srv.HandleCommitProjectDeliveryDate, path, string(domain.RoleVendedor), `{"date":"2026-12-15"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
	}
	if len(store.deliveryCommands) != 1 {
		t.Fatalf("commands = %d", len(store.deliveryCommands))
	}
	cmd := store.deliveryCommands[0]
	if cmd.ActorUserID != "user-1647" || !strings.HasPrefix(cmd.EventID, "evt_") || cmd.ProjectID != commercialTestProjectID {
		t.Fatalf("server-authored identity: %+v", cmd)
	}
	var dto openapi.DeliveryCommitmentResult
	if err := json.Unmarshal(rr.Body.Bytes(), &dto); err != nil {
		t.Fatal(err)
	}
	if dto.CommittedDeliveryDate != "2026-12-15" || dto.PreviousDate != nil || dto.Event.Type != "delivery_date_committed" || dto.Event.ByUserId != "user-1647" {
		t.Fatalf("dto: %+v", dto)
	}

	prev := "2026-12-15"
	store.deliveryCurrent = &prev
	rr = postCommercialCommand(t, srv, srv.HandleCommitProjectDeliveryDate, path, string(domain.RoleGerenteProduccion), `{"date":"2026-12-22","reason":"falta de placa"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("change status %d: %s", rr.Code, rr.Body.String())
	}
	dto = openapi.DeliveryCommitmentResult{}
	_ = json.Unmarshal(rr.Body.Bytes(), &dto)
	if dto.Event.Type != "delivery_date_changed" || dto.PreviousDate == nil || *dto.PreviousDate != prev {
		t.Fatalf("change dto: %+v", dto)
	}
}

func TestCommitProjectDeliveryDate_Rejections(t *testing.T) {
	prev := "2026-12-15"
	cases := []struct {
		name, role, body, field string
		current                 *string
		storeErr                error
		status                  int
	}{
		{"fecha inválida", string(domain.RoleVendedor), `{"date":"15/12/2026"}`, "date", nil, nil, http.StatusBadRequest},
		{"cambio sin motivo", string(domain.RoleVendedor), `{"date":"2026-12-20"}`, "reason", &prev, nil, http.StatusBadRequest},
		{"misma fecha", string(domain.RoleVendedor), `{"date":"2026-12-15","reason":"x"}`, "", &prev, nil, http.StatusConflict},
		{"obra perdida", string(domain.RoleVendedor), `{"date":"2026-12-20"}`, "", nil, domain.ErrDeliveryCommitmentClosedProject, http.StatusConflict},
		{"obra ajena", string(domain.RoleVendedor), `{"date":"2026-12-20"}`, "", nil, storage.ErrProjectCommercialTargetNotFound, http.StatusNotFound},
		{"el cliente no elige el autor", string(domain.RoleVendedor), `{"date":"2026-12-20","byUserId":"otro"}`, "", nil, nil, http.StatusBadRequest},
		{"rol sin permiso", string(domain.RoleProduccion), `{"date":"2026-12-20"}`, "", nil, nil, http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &stubStore{deliveryCurrent: tc.current, deliveryErr: tc.storeErr}
			srv := &Server{Store: store}
			rr := postCommercialCommand(t, srv, srv.HandleCommitProjectDeliveryDate, "/api/projects/"+commercialTestProjectID+"/delivery-commitment", tc.role, tc.body)
			if rr.Code != tc.status {
				t.Fatalf("status %d want %d: %s", rr.Code, tc.status, rr.Body.String())
			}
			if tc.field != "" && !strings.Contains(rr.Body.String(), `"`+tc.field+`"`) {
				t.Fatalf("expected fieldError %s: %s", tc.field, rr.Body.String())
			}
		})
	}
}
