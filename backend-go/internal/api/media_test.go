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

func TestMediaFilenameFromURL(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"empty", "", ""},
		{"canonical", "/api/media/abc.png", "abc.png"},
		{"with token query", "/api/media/abc.png?token=secret", "abc.png"},
		{"absolute host", "http://localhost:8080/api/media/abc.webp", "abc.webp"},
		{"external url", "https://cdn.example.com/img.png", ""},
		{"data uri", "data:image/png;base64,xx", ""},
		{"path escape", "/api/media/../etc/passwd", ""},
		{"path separator slash", "/api/media/sub/abc.png", ""},
		{"backslash", "/api/media/abc.png\\x", ""},
		{"only prefix", "/api/media/", ""},
		{"whitespace trimmed", "  /api/media/abc.jpg  ", "abc.jpg"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := mediaFilenameFromURL(c.in)
			if got != c.want {
				t.Errorf("mediaFilenameFromURL(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

func TestDeleteMediaFileByURL(t *testing.T) {
	dir := t.TempDir()

	// Create a real file to delete.
	existing := filepath.Join(dir, "real.jpg")
	if err := os.WriteFile(existing, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}

	t.Run("removes existing file", func(t *testing.T) {
		got := deleteMediaFileByURL(dir, "/api/media/real.jpg")
		if !got {
			t.Fatal("expected deleteMediaFileByURL to return true")
		}
		if _, err := os.Stat(existing); !os.IsNotExist(err) {
			t.Errorf("file should be gone, stat err=%v", err)
		}
	})

	t.Run("missing file is no-op", func(t *testing.T) {
		got := deleteMediaFileByURL(dir, "/api/media/never-existed.png")
		if got {
			t.Error("expected false for missing file")
		}
	})

	t.Run("empty url is no-op", func(t *testing.T) {
		got := deleteMediaFileByURL(dir, "")
		if got {
			t.Error("expected false for empty url")
		}
	})

	t.Run("external url is no-op", func(t *testing.T) {
		got := deleteMediaFileByURL(dir, "https://cdn.example.com/x.png")
		if got {
			t.Error("expected false for external url")
		}
	})

	t.Run("path escape is refused", func(t *testing.T) {
		// Plant a file outside the dir to prove we don't delete it.
		parent := filepath.Dir(dir)
		target := filepath.Join(parent, "escape-target.txt")
		_ = os.WriteFile(target, []byte("secret"), 0o600)
		t.Cleanup(func() { _ = os.Remove(target) })

		got := deleteMediaFileByURL(dir, "/api/media/../"+filepath.Base(target))
		if got {
			t.Error("expected false for path escape")
		}
		if _, err := os.Stat(target); err != nil {
			t.Errorf("escape target should still exist, err=%v", err)
		}
	})

	t.Run("empty media dir is no-op", func(t *testing.T) {
		got := deleteMediaFileByURL("", "/api/media/real.jpg")
		if got {
			t.Error("expected false when mediaDir is empty")
		}
	})
}
