package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1649: payment ledger, voids, per-project balance and receivables. All
// amounts and balances are computed by the backend from the exact accepted
// QuoteRevision snapshot; the client only displays them.

func newPaymentID() string { return uuid.NewString() }

func projectPaymentFromInput(id, projectID string, kind domain.ProjectPaymentKind, in domain.DepositPayloadInput, receivedAt time.Time, actor string) domain.ProjectPayment {
	return domain.ProjectPayment{
		ID:            id,
		ProjectID:     projectID,
		Kind:          kind,
		Amount:        in.Amount,
		Currency:      in.Currency,
		PaymentMethod: in.PaymentMethod,
		Reference:     in.Reference,
		Note:          in.Note,
		ReceivedAt:    receivedAt,
		RecordedBy:    actor,
	}
}

func respondWithPaymentCommandError(w http.ResponseWriter, err error, op string) {
	switch {
	case errors.Is(err, storage.ErrProjectPaymentTargetNotFound), errors.Is(err, storage.ErrProjectCommercialTargetNotFound):
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "obra no encontrada", nil)
	case errors.Is(err, storage.ErrProjectPaymentNotFound):
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "cobro no encontrado en esta obra", nil)
	case errors.Is(err, storage.ErrProjectPaymentAlreadyVoided):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "el cobro ya estaba anulado", nil)
	default:
		respondWithInternalError(w, err, op)
	}
}

func toProjectPaymentDTO(p domain.ProjectPayment) openapi.ProjectPayment {
	out := openapi.ProjectPayment{
		ID:         p.ID,
		ProjectId:  p.ProjectID,
		Kind:       openapi.ProjectPaymentKind(p.Kind),
		Amount:     p.Amount,
		Currency:   p.Currency,
		ReceivedAt: p.ReceivedAt.UTC().Format(time.RFC3339Nano),
		RecordedAt: p.RecordedAt.UTC().Format(time.RFC3339Nano),
		Origin:     p.Origin,
	}
	if out.Origin == "" {
		out.Origin = "command"
	}
	if p.PaymentMethod != "" {
		m := openapi.ProjectPaymentMethod(p.PaymentMethod)
		out.PaymentMethod = &m
	}
	if p.Reference != "" {
		v := p.Reference
		out.Reference = &v
	}
	if p.Note != "" {
		v := p.Note
		out.Note = &v
	}
	if p.RecordedBy != "" {
		v := p.RecordedBy
		out.RecordedBy = &v
	}
	if p.ProjectEventID != "" {
		v := p.ProjectEventID
		out.ProjectEventId = &v
	}
	if p.Void != nil {
		void := openapi.ProjectPaymentVoid{Reason: p.Void.Reason, VoidedAt: p.Void.VoidedAt.UTC().Format(time.RFC3339Nano)}
		if p.Void.VoidedBy != "" {
			v := p.Void.VoidedBy
			void.VoidedBy = &v
		}
		out.Void = &void
	}
	return out
}

// HandleRecordProjectPayment serves POST /api/projects/{projectId}/payments.
func (s *Server) HandleRecordProjectPayment(w http.ResponseWriter, r *http.Request) {
	projectID, ok := authorizeProjectPaymentWrite(w, r)
	if !ok {
		return
	}
	payload, at, ok := parseProjectPaymentRequest(w, r)
	if !ok {
		return
	}
	claims := claimsFromRequest(r)
	stored, err := s.Store.RecordProjectPayment(r.Context(), storage.RecordProjectPaymentCommand{
		Payment:   projectPaymentFromInput(newPaymentID(), projectID, domain.ProjectPaymentKindPayment, payload, at, claims.UserID),
		IP:        clientIP(r),
		RequestID: RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithPaymentCommandError(w, err, "record project payment")
		return
	}
	respondWithJSON(w, http.StatusCreated, toProjectPaymentDTO(*stored))
}

// HandleVoidProjectPayment serves POST /api/projects/{projectId}/payments/{paymentId}/void.
func (s *Server) HandleVoidProjectPayment(w http.ResponseWriter, r *http.Request) {
	projectID, ok := authorizeProjectPaymentWrite(w, r)
	if !ok {
		return
	}
	paymentID := r.PathValue("paymentId")
	if !isValidUUID(paymentID) {
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "cobro no encontrado en esta obra", nil)
		return
	}
	var req openapi.VoidProjectPaymentRequest
	if !decodeGeneratedJSONBody(w, r, &req) {
		return
	}
	reason, err := domain.ValidatePaymentVoidReason(req.Reason)
	if err != nil {
		var fieldErr *domain.DepositFieldError
		errors.As(err, &fieldErr)
		respondWithFieldError(w, fieldErr.Field, fieldErr.Message)
		return
	}
	claims := claimsFromRequest(r)
	actor := claims.UserID
	now := time.Now().UTC()
	stored, err := s.Store.VoidProjectPayment(r.Context(), storage.VoidProjectPaymentCommand{
		ProjectID: projectID,
		PaymentID: paymentID,
		Reason:    reason,
		VoidedBy:  actor,
		DepositVoidEvent: &domain.ProjectEvent{
			ID:        newProjectEventID(),
			ProjectID: projectID,
			Type:      "deposit_voided",
			At:        now,
			ByUserID:  &actor,
			Source:    commercialEventSource(claims.Transport),
			Note:      reason,
			CreatedAt: now,
		},
		IP:        clientIP(r),
		RequestID: RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithPaymentCommandError(w, err, "void project payment")
		return
	}
	respondWithJSON(w, http.StatusOK, toProjectPaymentDTO(*stored))
}

// authorizeProjectPaymentRead checks the commercial roles and, for sellers
// without all-owners visibility, project ownership.
func (s *Server) authorizeProjectPaymentRead(w http.ResponseWriter, r *http.Request, projectID string) bool {
	claims := claimsFromRequest(r)
	if claims == nil || claims.UserID == "" {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return false
	}
	roles := actorRoles(claims)
	if !requirePermission(w, domain.AnyRole(roles, func(rr domain.UserRole) bool {
		return domain.RoleCanAppendProjectEvent(rr, "deposit_received")
	}), "no tenés permiso para ver los cobros") {
		return false
	}
	if projectID != "" && !domain.RolesSeesAllOwners(roles) {
		project, err := s.Store.GetProjectByID(r.Context(), projectID)
		if err != nil || project == nil || project.OwnerUserID != claims.UserID {
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "obra no encontrada", nil)
			return false
		}
	}
	return true
}

// HandleProjectPaymentSummary serves GET /api/projects/{projectId}/payments.
func (s *Server) HandleProjectPaymentSummary(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("projectId")
	if !isValidUUID(projectID) {
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "obra no encontrada", nil)
		return
	}
	if !s.authorizeProjectPaymentRead(w, r, projectID) {
		return
	}
	summary, err := s.Store.GetProjectPaymentSummary(r.Context(), projectID)
	if err != nil {
		respondWithPaymentCommandError(w, err, "project payment summary")
		return
	}
	out := openapi.ProjectPaymentSummary{
		ProjectId:             summary.ProjectID,
		Currency:              summary.Currency,
		Payments:              make([]openapi.ProjectPayment, 0, len(summary.Payments)),
		PaidTotal:             summary.PaidTotal,
		Balance:               summary.Balance,
		OtherCurrencyPayments: int64(summary.OtherCurrencyPayments),
	}
	if summary.CustomerID != "" {
		v := summary.CustomerID
		out.CustomerId = &v
	}
	for _, p := range summary.Payments {
		out.Payments = append(out.Payments, toProjectPaymentDTO(p))
	}
	if q := summary.AcceptedQuote; q != nil {
		dto := openapi.AcceptedQuoteAmount{
			QuoteRevisionId: q.QuoteRevisionID,
			RevisionNumber:  q.RevisionNumber,
			SaleTotal:       q.SaleTotal,
			Currency:        q.Currency,
		}
		if q.AcceptedAt != nil {
			v := q.AcceptedAt.UTC().Format(time.RFC3339Nano)
			dto.AcceptedAt = &v
		}
		out.AcceptedQuote = &dto
	}
	respondWithJSON(w, http.StatusOK, out)
}

// HandleProjectReceivables serves GET /api/projects/receivables.
func (s *Server) HandleProjectReceivables(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeProjectPaymentRead(w, r, "") {
		return
	}
	claims := claimsFromRequest(r)
	seesAll := domain.RolesSeesAllOwners(actorRoles(claims))
	items, err := s.Store.ListProjectReceivables(r.Context())
	if err != nil {
		respondWithInternalError(w, err, "project receivables")
		return
	}
	out := openapi.ProjectReceivablesResponse{Items: []openapi.ProjectReceivable{}}
	for _, item := range items {
		sm := item.Summary
		if !seesAll && sm.OwnerUserID != claims.UserID {
			continue
		}
		dto := openapi.ProjectReceivable{
			ProjectId:   sm.ProjectID,
			ProjectName: sm.ProjectName,
			Currency:    sm.Currency,
			SaleTotal:   *sm.SaleTotal,
			PaidTotal:   item.PaidTotal,
			Balance:     item.Balance,
		}
		if sm.QuoteRevisionID != nil {
			dto.QuoteRevisionId = *sm.QuoteRevisionID
		}
		if sm.QuoteRevisionNumber != nil {
			dto.QuoteRevisionNumber = *sm.QuoteRevisionNumber
		}
		dto.CustomerId = sm.CustomerID
		dto.CustomerName = sm.CustomerName
		dto.AcceptedAt = sm.CommercialActivityAt
		out.Items = append(out.Items, dto)
	}
	respondWithJSON(w, http.StatusOK, out)
}
