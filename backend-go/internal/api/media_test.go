package api

import (
	"bytes"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestMediaUploadAndGet(t *testing.T) {
	dir := t.TempDir()
	srv := &Server{Store: &stubStore{}, MediaDir: dir}

	// 1x1 PNG
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	var pngBuf bytes.Buffer
	if err := png.Encode(&pngBuf, img); err != nil {
		t.Fatal(err)
	}

	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	part, err := w.CreateFormFile("file", "dot.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(part, bytes.NewReader(pngBuf.Bytes())); err != nil {
		t.Fatal(err)
	}
	_ = w.Close()

	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/media", &body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", w.FormDataContentType())
	rr := httptest.NewRecorder()
	srv.HandleMediaUpload(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("upload status %d body %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "/api/media/") {
		t.Fatalf("expected media url in body: %s", rr.Body.String())
	}

	// extract filename from body
	raw := rr.Body.String()
	idx := strings.Index(raw, "/api/media/")
	rest := raw[idx+len("/api/media/"):]
	name := strings.Split(rest, `"`)[0]
	if name == "" {
		t.Fatalf("no filename in %s", raw)
	}
	if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
		t.Fatalf("file not on disk: %v", err)
	}

	// vendedor can GET
	getReq := withClaims(httptest.NewRequest(http.MethodGet, "/api/media/"+name, nil), "v1", string(domain.RoleVendedor))
	getReq.SetPathValue("name", name)
	getRR := httptest.NewRecorder()
	srv.HandleMediaGet(getRR, getReq)
	if getRR.Code != http.StatusOK {
		t.Fatalf("get status %d", getRR.Code)
	}
	if ct := getRR.Header().Get("Content-Type"); !strings.Contains(ct, "image/png") {
		t.Fatalf("content-type %q", ct)
	}
}

func TestMediaUploadDeniedVendedor(t *testing.T) {
	srv := &Server{Store: &stubStore{}, MediaDir: t.TempDir()}
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	part, _ := w.CreateFormFile("file", "x.png")
	_, _ = part.Write([]byte{0x89, 0x50, 0x4e, 0x47})
	_ = w.Close()
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/media", &body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", w.FormDataContentType())
	rr := httptest.NewRecorder()
	srv.HandleMediaUpload(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403", rr.Code)
	}
}
