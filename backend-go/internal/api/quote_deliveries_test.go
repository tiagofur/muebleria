package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

const (
	qdProjectID  = "16500000-0000-4000-8000-000000000001"
	qdRevisionID = "16500000-0000-4000-8000-000000000003"
	qdDelivery   = "16500000-0000-4000-8000-000000000009"
)

func qdContext() *storage.QuoteDeliveryContext {
	return &storage.QuoteDeliveryContext{
		ProjectID: qdProjectID, ProjectName: "Cocina Norte", CustomerName: "Ana López",
		CustomerEmail: "ana@cliente.test", CustomerPhone: "+52 55 1234 5678",
		OrganizationName: "Taller Norte", QuoteRevisionID: qdRevisionID, RevisionNumber: 2,
		RevisionStatus: "published", SaleTotal: 125430.5, Currency: "MXN", HasSnapshot: true,
	}
}

func qdRequest(method, suffix, body string, roles ...domain.UserRole) *http.Request {
	r := httptest.NewRequest(method, "/api/projects/"+qdProjectID+"/quote-revisions/"+qdRevisionID+suffix, bytes.NewBufferString(body))
	r.SetPathValue("projectId", qdProjectID)
	r.SetPathValue("quoteRevisionId", qdRevisionID)
	r.SetPathValue("quoteDeliveryId", qdDelivery)
	if len(roles) == 0 {
		roles = []domain.UserRole{domain.RoleVendedor}
	}
	return withTestClaims(r, "user-1", roles)
}

func qdEmailBody(pdf []byte, extra string) string {
	return `{"variant":"detailed","fileName":"Cotizacion-Cocina-Norte-Q2-listado.pdf","pdfBase64":"` +
		base64.StdEncoding.EncodeToString(pdf) + `"` + extra + `}`
}

func TestSendQuoteEmailQueuesExactPDFToStoredCustomer(t *testing.T) {
	pdf := []byte("%PDF-1.7\n" + strings.Repeat("x", 2048))
	store := &stubStore{quoteDeliveryCtx: qdContext()}
	server := &Server{Store: store, EmailDelivery: &EmailDeliveryConfig{PublicAppURL: "https://app.test"}}
	w := httptest.NewRecorder()
	server.HandleSendQuoteEmail(w, qdRequest(http.MethodPost, ":send-email", qdEmailBody(pdf, `,"note":"Cualquier duda, avisame."`)))
	if w.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	sum := sha256.Sum256(pdf)
	var dto openapi.QuoteDelivery
	if err := json.Unmarshal(w.Body.Bytes(), &dto); err != nil {
		t.Fatal(err)
	}
	if dto.Status != "queued" || dto.Recipient != "ana@cliente.test" || dto.PdfSha256 == nil || *dto.PdfSha256 != hex.EncodeToString(sum[:]) || dto.SentAt != nil {
		t.Fatalf("unexpected delivery: %+v", dto)
	}
	cmd := store.createdQuoteDeliveries[0]
	if cmd.Email == nil || cmd.Email.To != "ana@cliente.test" || len(cmd.Email.Attachments) != 1 || !bytes.Equal(cmd.Email.Attachments[0].Data, pdf) {
		t.Fatalf("the email must carry the exact PDF bytes to the stored address: %+v", cmd.Email)
	}
	if cmd.Delivery.RequestedBy != "user-1" || cmd.Delivery.RevisionNumber != 2 || !strings.Contains(cmd.Email.Text, "Cualquier duda") {
		t.Fatalf("delivery: %+v", cmd.Delivery)
	}
}

func TestSendQuoteEmailRefusals(t *testing.T) {
	pdf := []byte("%PDF-1.7\nok")
	configured := &EmailDeliveryConfig{PublicAppURL: "https://app.test"}
	draft := qdContext()
	draft.RevisionStatus = "draft"
	superseded := qdContext()
	superseded.RevisionStatus = "superseded"
	noEmail := qdContext()
	noEmail.CustomerEmail = ""
	for _, tc := range []struct {
		name   string
		ctx    *storage.QuoteDeliveryContext
		email  *EmailDeliveryConfig
		body   string
		roles  []domain.UserRole
		status int
		code   string
	}{
		{"server without email", qdContext(), nil, qdEmailBody(pdf, ""), nil, http.StatusConflict, "QUOTE_DELIVERY_EMAIL_UNAVAILABLE"},
		{"draft revision", draft, configured, qdEmailBody(pdf, ""), nil, http.StatusConflict, "QUOTE_DELIVERY_NOT_SENDABLE"},
		{"superseded revision", superseded, configured, qdEmailBody(pdf, ""), nil, http.StatusConflict, "QUOTE_DELIVERY_NOT_SENDABLE"},
		{"customer without email", noEmail, configured, qdEmailBody(pdf, ""), nil, http.StatusConflict, "QUOTE_DELIVERY_NO_RECIPIENT"},
		{"not a pdf", qdContext(), configured, qdEmailBody([]byte("<html>hola</html>"), ""), nil, http.StatusBadRequest, "QUOTE_DELIVERY_INVALID_PDF"},
		{"path in file name", qdContext(), configured, strings.Replace(qdEmailBody(pdf, ""), "Cotizacion-Cocina-Norte-Q2-listado.pdf", "../x.pdf", 1), nil, http.StatusBadRequest, "QUOTE_DELIVERY_INVALID_PDF"},
		{"recipient cannot be injected", qdContext(), configured, qdEmailBody(pdf, `,"to":"otro@x.test"`), nil, http.StatusBadRequest, "BAD_REQUEST"},
		{"production role cannot send", qdContext(), configured, qdEmailBody(pdf, ""), []domain.UserRole{domain.RoleProduccion}, http.StatusForbidden, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &stubStore{quoteDeliveryCtx: tc.ctx}
			server := &Server{Store: store, EmailDelivery: tc.email}
			w := httptest.NewRecorder()
			server.HandleSendQuoteEmail(w, qdRequest(http.MethodPost, ":send-email", tc.body, tc.roles...))
			if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.code) {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if len(store.createdQuoteDeliveries) != 0 {
				t.Fatal("a refused send must record nothing")
			}
		})
	}
	// Manufacturing-only organization: the store refuses with amounts withheld.
	server := &Server{Store: &stubStore{quoteDeliveryErr: storage.ErrQuoteDeliveryAmountsWithheld}, EmailDelivery: configured}
	w := httptest.NewRecorder()
	server.HandleSendQuoteEmail(w, qdRequest(http.MethodPost, ":send-email", qdEmailBody(pdf, "")))
	if w.Code != http.StatusForbidden {
		t.Fatalf("withheld amounts: status=%d", w.Code)
	}
}

func TestPrepareQuoteWhatsAppBuildsPrefilledLinkWithoutMarkingSent(t *testing.T) {
	store := &stubStore{quoteDeliveryCtx: qdContext()}
	server := &Server{Store: store}
	w := httptest.NewRecorder()
	server.HandlePrepareQuoteWhatsApp(w, qdRequest(http.MethodPost, ":prepare-whatsapp", ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var out openapi.PreparedQuoteWhatsApp
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Delivery.Status != "prepared" || out.Delivery.SentAt != nil || out.Delivery.Recipient != "+525512345678" {
		t.Fatalf("a prepared WhatsApp delivery is not sent: %+v", out.Delivery)
	}
	u, err := url.Parse(out.WhatsappUrl)
	if err != nil || u.Host != "wa.me" || u.Path != "/525512345678" || u.Query().Get("text") != out.Message {
		t.Fatalf("whatsapp url %q", out.WhatsappUrl)
	}
	if !strings.Contains(out.Message, "Q2") || !strings.Contains(out.Message, "$125,430.50 MXN") || !strings.Contains(out.Message, "Cocina Norte") {
		t.Fatalf("message %q", out.Message)
	}

	local := qdContext()
	local.CustomerPhone = "55 1234 5678" // no country code: never guessed
	server = &Server{Store: &stubStore{quoteDeliveryCtx: local}}
	w = httptest.NewRecorder()
	server.HandlePrepareQuoteWhatsApp(w, qdRequest(http.MethodPost, ":prepare-whatsapp", ""))
	if w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), "QUOTE_DELIVERY_NO_RECIPIENT") {
		t.Fatalf("local phone: status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestConfirmQuoteDelivery(t *testing.T) {
	server := &Server{Store: &stubStore{}}
	w := httptest.NewRecorder()
	server.HandleConfirmQuoteDelivery(w, qdRequest(http.MethodPost, "", ""))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"status":"confirmed"`) || !strings.Contains(w.Body.String(), `"sentAt"`) {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	server = &Server{Store: &stubStore{quoteDeliveryErr: storage.ErrQuoteDeliveryNotConfirmable}}
	w = httptest.NewRecorder()
	server.HandleConfirmQuoteDelivery(w, qdRequest(http.MethodPost, "", ""))
	if w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), "QUOTE_DELIVERY_NOT_CONFIRMABLE") {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestListQuoteDeliveriesReportsAvailability(t *testing.T) {
	noPhone := qdContext()
	noPhone.CustomerPhone = "55 1234"
	for _, tc := range []struct {
		ctx              *storage.QuoteDeliveryContext
		email            *EmailDeliveryConfig
		wantEmail, wantP bool
		wantServer       bool
	}{
		{qdContext(), &EmailDeliveryConfig{}, true, true, true},
		{noPhone, nil, true, false, false},
	} {
		server := &Server{Store: &stubStore{quoteDeliveryCtx: tc.ctx}, EmailDelivery: tc.email}
		w := httptest.NewRecorder()
		server.HandleListQuoteDeliveries(w, qdRequest(http.MethodGet, "", ""))
		var out openapi.QuoteDeliveryList
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || w.Code != http.StatusOK {
			t.Fatalf("status=%d err=%v", w.Code, err)
		}
		if out.CustomerEmailAvailable != tc.wantEmail || out.CustomerPhoneAvailable != tc.wantP || out.EmailDeliveryAvailable != tc.wantServer || out.Items == nil {
			t.Fatalf("availability: %+v", out)
		}
	}
}

func TestQuoteDeliveryRoutesRegistered(t *testing.T) {
	router := RegisterRoutes(&Server{Store: &stubStore{}, Tokens: mustAuthority("quote-delivery-router-secret-0123456789abcdef")})
	for _, path := range []string{
		"/api/projects/" + qdProjectID + "/quote-revisions/" + qdRevisionID + ":send-email",
		"/api/projects/" + qdProjectID + "/quote-revisions/" + qdRevisionID + ":prepare-whatsapp",
		"/api/projects/" + qdProjectID + "/quote-deliveries/" + qdDelivery + ":confirm",
	} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(http.MethodPost, path, nil))
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("%s: status %d, want 401 from the auth middleware", path, w.Code)
		}
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/projects/"+qdProjectID+"/quote-deliveries", nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("list: status %d", w.Code)
	}
	if limit := idempotencyBodyLimits["quote.send-email"]; limit < int64(base64.StdEncoding.EncodedLen(5<<20))+4096 {
		t.Fatalf("send-email body limit %d cannot carry a 5 MiB PDF", limit)
	}
	_ = time.Now
}
