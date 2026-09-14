package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

type updateProjectRequest struct {
	domain.Project
	InlineCustomerName     string  `json:"inline_customer_name,omitempty"`
	InlineCustomerReplaces *string `json:"inline_customer_replaces,omitempty"`
}

type updateProjectResponse struct {
	domain.Project
	InlineCustomer *domain.Customer `json:"inline_customer,omitempty"`
}

// requireProjectInlineUpdateIdempotency leaves legacy PUT requests unchanged
// and wraps only the new inline-customer command in the existing durable
// receipt boundary. The wrapper runs inside AuthMiddleware's tenant
// transaction, so the customer, project and replayable response commit as one
// unit and a lost-response retry cannot mint another customer.
func (s *Server) requireProjectInlineUpdateIdempotency(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxJSONBodyBytes))
		if err != nil {
			respondWithError(w, http.StatusRequestEntityTooLarge, "request body too large")
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		var probe struct {
			InlineCustomerName string `json:"inline_customer_name"`
		}
		if json.Unmarshal(body, &probe) == nil && strings.TrimSpace(probe.InlineCustomerName) != "" {
			s.RequireIdempotency("projects.update-inline-customer", next).ServeHTTP(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}
