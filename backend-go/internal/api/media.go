package api

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

const maxMediaBytes = 3 << 20 // 3 MiB

var allowedMediaTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
}

// HandleMediaUpload: POST /api/media (multipart field "file")
// Allowed: roles that can mutate catalog (admin/ingeniero).
func (s *Server) HandleMediaUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	role := actorRole(claimsFromRequest(r))
	if !requirePermission(w, domain.RoleCanMutateCatalog(role), "no tenés permiso para subir imágenes") {
		return
	}
	if strings.TrimSpace(s.MediaDir) == "" {
		respondWithError(w, http.StatusServiceUnavailable, "almacenamiento de medios no configurado")
		return
	}
	if err := os.MkdirAll(s.MediaDir, 0o750); err != nil {
		respondWithInternalError(w, err, "media mkdir")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxMediaBytes+512)
	if err := r.ParseMultipartForm(maxMediaBytes); err != nil {
		respondWithError(w, http.StatusRequestEntityTooLarge, "archivo demasiado grande (máx 3 MB)")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "falta el archivo (campo file)")
		return
	}
	defer file.Close()

	// Sniff content type from first 512 bytes
	buf := make([]byte, 512)
	n, _ := io.ReadFull(file, buf)
	contentType := http.DetectContentType(buf[:n])
	ext, ok := allowedMediaTypes[contentType]
	if !ok {
		// also accept by filename as fallback for some webp sniff failures
		name := strings.ToLower(header.Filename)
		switch {
		case strings.HasSuffix(name, ".jpg"), strings.HasSuffix(name, ".jpeg"):
			ext = ".jpg"
			ok = true
		case strings.HasSuffix(name, ".png"):
			ext = ".png"
			ok = true
		case strings.HasSuffix(name, ".webp"):
			ext = ".webp"
			ok = true
		}
	}
	if !ok {
		respondWithError(w, http.StatusBadRequest, "formato no permitido (jpg, png o webp)")
		return
	}

	id, err := randomHex(16)
	if err != nil {
		respondWithInternalError(w, err, "media id")
		return
	}
	filename := id + ext
	destPath := filepath.Join(s.MediaDir, filename)
	// Prevent path escape
	if !strings.HasPrefix(filepath.Clean(destPath), filepath.Clean(s.MediaDir)+string(os.PathSeparator)) &&
		filepath.Clean(destPath) != filepath.Clean(s.MediaDir) {
		respondWithError(w, http.StatusBadRequest, "ruta inválida")
		return
	}

	out, err := os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o640)
	if err != nil {
		respondWithInternalError(w, err, "media write")
		return
	}
	defer out.Close()

	// write sniffed prefix + rest of stream
	if _, err := out.Write(buf[:n]); err != nil {
		respondWithInternalError(w, err, "media write")
		return
	}
	if _, err := io.Copy(out, file); err != nil {
		respondWithInternalError(w, err, "media write")
		return
	}

	url := "/api/media/" + filename
	respondWithJSON(w, http.StatusCreated, map[string]string{
		"url":      url,
		"filename": filename,
	})
}

// HandleMediaGet: GET /api/media/{name} — any authenticated user.
func (s *Server) HandleMediaGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	name := r.PathValue("name")
	if name == "" || strings.Contains(name, "..") || strings.Contains(name, "/") || strings.Contains(name, "\\") {
		respondWithError(w, http.StatusBadRequest, "nombre inválido")
		return
	}
	if strings.TrimSpace(s.MediaDir) == "" {
		respondWithError(w, http.StatusNotFound, "not found")
		return
	}
	path := filepath.Join(s.MediaDir, name)
	cleanRoot := filepath.Clean(s.MediaDir)
	if !strings.HasPrefix(filepath.Clean(path), cleanRoot+string(os.PathSeparator)) {
		respondWithError(w, http.StatusBadRequest, "ruta inválida")
		return
	}
	f, err := os.Open(path)
	if err != nil {
		respondWithError(w, http.StatusNotFound, "not found")
		return
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil || stat.IsDir() {
		respondWithError(w, http.StatusNotFound, "not found")
		return
	}
	// Content-Type by extension
	switch strings.ToLower(filepath.Ext(name)) {
	case ".jpg", ".jpeg":
		w.Header().Set("Content-Type", "image/jpeg")
	case ".png":
		w.Header().Set("Content-Type", "image/png")
	case ".webp":
		w.Header().Set("Content-Type", "image/webp")
	default:
		w.Header().Set("Content-Type", "application/octet-stream")
	}
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeContent(w, r, name, stat.ModTime(), f)
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("rand: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// mediaURLPrefix is the public path served by HandleMediaGet. URLs returned to
// clients look like "/api/media/<filename>"; this prefix is what we strip to
// recover the on-disk filename for lifecycle cleanup.
const mediaURLPrefix = "/api/media/"

// mediaFilenameFromURL extracts the on-disk filename from a stored media URL.
// It accepts the canonical form ("/api/media/<name>") and tolerates absolute or
// query-suffixed variants. Returns empty string for anything that is not a
// catalog media URL (external URLs, data:, empty, etc.) so callers can no-op.
// It refuses path separators and ".." — same defenses as HandleMediaGet.
func mediaFilenameFromURL(raw string) string {
	if raw == "" {
		return ""
	}
	url := strings.TrimSpace(raw)
	// Find the media prefix anywhere; tolerate absolute hosts.
	idx := strings.Index(url, mediaURLPrefix)
	if idx < 0 {
		return ""
	}
	name := url[idx+len(mediaURLPrefix):]
	// Drop query string ("?token=...") if present.
	if i := strings.Index(name, "?"); i >= 0 {
		name = name[:i]
	}
	name = strings.TrimSpace(name)
	if name == "" || strings.Contains(name, "..") || strings.ContainsAny(name, "/\\") {
		return ""
	}
	return name
}

// deleteMediaFileByURL removes the on-disk file referenced by a media URL.
// It is best-effort: missing files are not an error (idempotent re-runs,
// re-entry after partial cleanup), and any other IO error is logged but does
// not propagate — losing a catalog image is annoying, failing a successful DB
// commit because we could not delete a stale file is worse.
//
// Returns true when a file was actually removed, false otherwise (no URL,
// unknown host/path, not found, or error).
func deleteMediaFileByURL(mediaDir, url string) bool {
	name := mediaFilenameFromURL(url)
	if name == "" || strings.TrimSpace(mediaDir) == "" {
		return false
	}
	path := filepath.Join(mediaDir, name)
	cleanRoot := filepath.Clean(mediaDir)
	if !strings.HasPrefix(filepath.Clean(path), cleanRoot+string(os.PathSeparator)) {
		// Path escape attempt — refuse, do not log the raw value.
		return false
	}
	err := os.Remove(path)
	if err == nil {
		return true
	}
	if !os.IsNotExist(err) {
		log.Printf("media cleanup: failed to remove %s: %v", path, err)
	}
	return false
}
