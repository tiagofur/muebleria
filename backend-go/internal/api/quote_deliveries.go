package api

// #1650: send the exact QuoteRevision to the customer — email with the exact
// PDF attached (queued in the durable outbox) or a WhatsApp message the user
// completes in their own WhatsApp and then confirms. Recipients always come
// from the stored customer contact, never from the request: the endpoint
// cannot be used to mail arbitrary addresses.

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/mail"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

var quotePDFFileName = regexp.MustCompile(`^[\p{L}\p{N}._ -]{1,196}\.pdf$`)

func (s *Server) requireQuoteSender(w http.ResponseWriter, r *http.Request) (string, bool) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return "", false
	}
	if claims.Support != nil {
		respondWithError(w, http.StatusForbidden, "la sesión de soporte no puede enviar cotizaciones")
		return "", false
	}
	allowed := false
	for _, role := range actorRoles(claims) {
		if domain.RoleCanAppendProjectEvent(role, "quote_sent") {
			allowed = true
			break
		}
	}
	if !allowed {
		respondWithError(w, http.StatusForbidden, "no tenés permiso para enviar cotizaciones")
		return "", false
	}
	return claims.UserID, true
}

func respondWithQuoteDeliveryError(w http.ResponseWriter, err error, op string) {
	switch {
	case errors.Is(err, storage.ErrQuoteDeliveryTargetNotFound):
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "cotización no encontrada", nil)
	case errors.Is(err, storage.ErrQuoteDeliveryAmountsWithheld):
		respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeForbidden, "sólo la organización que vende el proyecto puede enviar la cotización", nil)
	case errors.Is(err, storage.ErrQuoteDeliveryNotConfirmable):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeQuoteDeliveryNotConfirmable, "este envío ya no se puede confirmar", map[string]interface{}{"reason": "not_confirmable"})
	default:
		respondWithInternalError(w, err, "quote delivery "+op)
	}
}

func toQuoteDeliveryDTO(d storage.QuoteDelivery) openapi.QuoteDelivery {
	out := openapi.QuoteDelivery{
		ID: d.ID, ProjectId: d.ProjectID, QuoteRevisionId: d.QuoteRevisionID, RevisionNumber: int64(d.RevisionNumber),
		Channel: d.Channel, Recipient: d.Recipient, Status: d.Status,
		RequestedAt: d.RequestedAt.UTC().Format(time.RFC3339),
	}
	if d.Variant != "" {
		v := d.Variant
		out.Variant = &v
	}
	if d.PDFSHA256 != "" {
		h := d.PDFSHA256
		out.PdfSha256 = &h
		n := int64(d.PDFBytes)
		out.PdfBytes = &n
		f := d.PDFFileName
		out.PdfFileName = &f
	}
	if d.SentAt != nil {
		t := d.SentAt.UTC().Format(time.RFC3339)
		out.SentAt = &t
	}
	if d.FailureReason != "" {
		f := d.FailureReason
		out.FailureReason = &f
	}
	return out
}

// sendableContext loads the exact revision and answers the typed refusals
// shared by both channels.
func (s *Server) sendableContext(w http.ResponseWriter, r *http.Request) (*storage.QuoteDeliveryContext, bool) {
	projectID, revisionID := r.PathValue("projectId"), r.PathValue("quoteRevisionId")
	if !isValidUUID(projectID) || !isValidUUID(revisionID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "projectId o quoteRevisionId inválido", nil)
		return nil, false
	}
	qc, err := s.Store.GetQuoteDeliveryContext(r.Context(), projectID, revisionID)
	if err != nil {
		respondWithQuoteDeliveryError(w, err, "context")
		return nil, false
	}
	if !storage.QuoteDeliverySendable(qc.RevisionStatus) || !qc.HasSnapshot {
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeQuoteDeliveryNotSendable,
			"sólo se envía una revisión publicada o aceptada con su cotización congelada", map[string]interface{}{"status": qc.RevisionStatus})
		return nil, false
	}
	return qc, true
}

// HandleSendQuoteEmail serves POST …/quote-revisions/{id}:send-email.
func (s *Server) HandleSendQuoteEmail(w http.ResponseWriter, r *http.Request) {
	actorID, ok := s.requireQuoteSender(w, r)
	if !ok {
		return
	}
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "cuerpo inválido", nil)
		return
	}
	var body openapi.SendQuoteEmailRequest
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "cuerpo inválido", nil)
		return
	}
	if body.Variant != "detailed" && body.Variant != "summary" {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "variante inválida", nil)
		return
	}
	note := ""
	if body.Note != nil {
		note = strings.TrimSpace(*body.Note)
		if len([]rune(note)) > 1000 {
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "el mensaje admite hasta 1000 caracteres", nil)
			return
		}
	}
	if !quotePDFFileName.MatchString(body.FileName) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeQuoteDeliveryInvalidPdf, "nombre de archivo PDF inválido", nil)
		return
	}
	pdf, err := base64.StdEncoding.DecodeString(body.PdfBase64)
	if err != nil || len(pdf) < 8 || !bytes.HasPrefix(pdf, []byte("%PDF-")) || len(pdf) > mail.MaxAttachmentBytes {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeQuoteDeliveryInvalidPdf, "el adjunto debe ser el PDF de la cotización (hasta 5 MB)", nil)
		return
	}
	if s.EmailDelivery == nil {
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeQuoteDeliveryEmailUnavailable, "este servidor todavía no envía correos", map[string]interface{}{"reason": "email_unavailable"})
		return
	}
	qc, ok := s.sendableContext(w, r)
	if !ok {
		return
	}
	recipient := strings.TrimSpace(qc.CustomerEmail)
	if !mail.ValidAddress(recipient) {
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeQuoteDeliveryNoRecipient, "el cliente no tiene un email válido", map[string]interface{}{"reason": "no_email"})
		return
	}
	sum := sha256.Sum256(pdf)
	msg := mail.QuoteMessage(recipient, qc.CustomerName, qc.OrganizationName, qc.ProjectName, qc.RevisionNumber, note,
		mail.Attachment{FileName: body.FileName, ContentType: "application/pdf", Data: pdf})
	d, err := s.Store.CreateQuoteDelivery(r.Context(), storage.CreateQuoteDeliveryCommand{
		Delivery: storage.QuoteDelivery{
			ProjectID: qc.ProjectID, QuoteRevisionID: qc.QuoteRevisionID, RevisionNumber: qc.RevisionNumber,
			Channel: "email", Recipient: recipient, Variant: body.Variant,
			PDFSHA256: hex.EncodeToString(sum[:]), PDFBytes: len(pdf), PDFFileName: body.FileName,
			RequestedBy: actorID,
		},
		Email:     &msg,
		IP:        clientIP(r),
		RequestID: RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithQuoteDeliveryError(w, err, "send email")
		return
	}
	respondWithJSON(w, http.StatusCreated, toQuoteDeliveryDTO(*d))
}

// whatsAppDigits normalizes a stored phone to the international digits
// wa.me expects. Only an explicit international number (+ or 00 prefix) is
// accepted: the country code is never guessed.
func whatsAppDigits(phone string) (string, bool) {
	phone = strings.TrimSpace(phone)
	switch {
	case strings.HasPrefix(phone, "+"):
		phone = phone[1:]
	case strings.HasPrefix(phone, "00"):
		phone = phone[2:]
	default:
		return "", false
	}
	var b strings.Builder
	for _, r := range phone {
		switch {
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '(' || r == ')' || r == '.':
		default:
			return "", false
		}
	}
	digits := b.String()
	return digits, len(digits) >= 8 && len(digits) <= 15
}

func formatQuoteAmount(value float64, currency string) string {
	cents := int64(math.Round(value * 100))
	sign := ""
	if cents < 0 {
		sign, cents = "-", -cents
	}
	whole := fmt.Sprintf("%d", cents/100)
	var grouped []string
	for len(whole) > 3 {
		grouped = append([]string{whole[len(whole)-3:]}, grouped...)
		whole = whole[:len(whole)-3]
	}
	grouped = append([]string{whole}, grouped...)
	return fmt.Sprintf("%s$%s,%02d %s", sign, strings.Join(grouped, "."), cents%100, strings.TrimSpace(currency))
}

func quoteWhatsAppMessage(qc *storage.QuoteDeliveryContext) string {
	fold := func(v string) string { return strings.Join(strings.Fields(v), " ") }
	greeting := "Hola"
	if c := fold(qc.CustomerName); c != "" {
		greeting = "Hola " + c
	}
	what := fmt.Sprintf("la cotización Q%d", qc.RevisionNumber)
	if p := fold(qc.ProjectName); p != "" {
		what = fmt.Sprintf("la cotización Q%d de «%s»", qc.RevisionNumber, p)
	}
	from := ""
	if o := fold(qc.OrganizationName); o != "" {
		from = " de " + o
	}
	return fmt.Sprintf("%s, te comparto %s%s. Total: %s. Te envío el PDF por este chat.", greeting, what, from, formatQuoteAmount(qc.SaleTotal, qc.Currency))
}

// HandlePrepareQuoteWhatsApp serves POST …/quote-revisions/{id}:prepare-whatsapp.
func (s *Server) HandlePrepareQuoteWhatsApp(w http.ResponseWriter, r *http.Request) {
	actorID, ok := s.requireQuoteSender(w, r)
	if !ok {
		return
	}
	qc, ok := s.sendableContext(w, r)
	if !ok {
		return
	}
	digits, ok := whatsAppDigits(qc.CustomerPhone)
	if !ok {
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeQuoteDeliveryNoRecipient, "el teléfono del cliente debe incluir el código de país (por ejemplo +52 55 1234 5678)", map[string]interface{}{"reason": "no_phone"})
		return
	}
	message := quoteWhatsAppMessage(qc)
	d, err := s.Store.CreateQuoteDelivery(r.Context(), storage.CreateQuoteDeliveryCommand{
		Delivery: storage.QuoteDelivery{
			ProjectID: qc.ProjectID, QuoteRevisionID: qc.QuoteRevisionID, RevisionNumber: qc.RevisionNumber,
			Channel: "whatsapp", Recipient: "+" + digits, RequestedBy: actorID,
		},
		IP:        clientIP(r),
		RequestID: RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithQuoteDeliveryError(w, err, "prepare whatsapp")
		return
	}
	respondWithJSON(w, http.StatusCreated, openapi.PreparedQuoteWhatsApp{
		Delivery:    toQuoteDeliveryDTO(*d),
		WhatsappUrl: "https://wa.me/" + digits + "?text=" + url.QueryEscape(message),
		Message:     message,
	})
}

// HandleConfirmQuoteDelivery serves POST …/quote-deliveries/{id}:confirm.
func (s *Server) HandleConfirmQuoteDelivery(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireQuoteSender(w, r); !ok {
		return
	}
	projectID, deliveryID := r.PathValue("projectId"), r.PathValue("quoteDeliveryId")
	if !isValidUUID(projectID) || !isValidUUID(deliveryID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "projectId o quoteDeliveryId inválido", nil)
		return
	}
	d, err := s.Store.ConfirmQuoteDelivery(r.Context(), projectID, deliveryID)
	if err != nil {
		respondWithQuoteDeliveryError(w, err, "confirm")
		return
	}
	respondWithJSON(w, http.StatusOK, toQuoteDeliveryDTO(*d))
}

// HandleListQuoteDeliveries serves GET /api/projects/{projectId}/quote-deliveries.
func (s *Server) HandleListQuoteDeliveries(w http.ResponseWriter, r *http.Request) {
	if claimsFromRequest(r) == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	projectID := r.PathValue("projectId")
	if !isValidUUID(projectID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "projectId inválido", nil)
		return
	}
	contact, err := s.Store.GetProjectCustomerContact(r.Context(), projectID)
	if err != nil {
		respondWithQuoteDeliveryError(w, err, "contact")
		return
	}
	items, err := s.Store.ListQuoteDeliveries(r.Context(), projectID)
	if err != nil {
		respondWithQuoteDeliveryError(w, err, "list")
		return
	}
	out := openapi.QuoteDeliveryList{
		Items:                  make([]openapi.QuoteDelivery, len(items)),
		EmailDeliveryAvailable: s.EmailDelivery != nil,
		CustomerEmailAvailable: mail.ValidAddress(strings.TrimSpace(contact.Email)),
	}
	_, out.CustomerPhoneAvailable = whatsAppDigits(contact.Phone)
	if contact.Email != "" {
		e := strings.TrimSpace(contact.Email)
		out.CustomerEmail = &e
	}
	if contact.Phone != "" {
		p := strings.TrimSpace(contact.Phone)
		out.CustomerPhone = &p
	}
	for i := range items {
		out.Items[i] = toQuoteDeliveryDTO(items[i])
	}
	respondWithJSON(w, http.StatusOK, out)
}
