package api

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// HandleProjectPhotos handles GET (list) and POST (upload photo) for /api/projects/{id}/photos
func (s *Server) HandleProjectPhotos(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	if projectID == "" {
		respondWithError(w, http.StatusBadRequest, "falta el id del proyecto")
		return
	}

	// Verify project exists
	project, err := s.Store.GetProjectByID(r.Context(), projectID)
	if err != nil {
		respondWithError(w, http.StatusNotFound, "proyecto no encontrado")
		return
	}

	switch r.Method {
	case http.MethodGet:
		photos, err := s.Store.ListProjectPhotos(r.Context(), projectID)
		if err != nil {
			respondWithInternalError(w, err, "list project photos")
			return
		}
		respondWithJSON(w, http.StatusOK, photos)

	case http.MethodPost:
		claims := claimsFromRequest(r)
		var userID string
		if claims != nil {
			userID = claims.Subject
		}

		contentType := r.Header.Get("Content-Type")

		// Case 1: JSON payload with pre-existing or direct URL
		if strings.HasPrefix(contentType, "application/json") {
			var req struct {
				Stage        domain.ProjectPhotoStage `json:"stage"`
				URL          string                   `json:"url"`
				ThumbnailURL string                   `json:"thumbnail_url,omitempty"`
				Caption      string                   `json:"caption,omitempty"`
				IsShowcase   bool                     `json:"is_showcase"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				respondWithError(w, http.StatusBadRequest, "cuerpo json inválido")
				return
			}
			if strings.TrimSpace(req.URL) == "" {
				respondWithError(w, http.StatusBadRequest, "la url es requerida")
				return
			}
			if req.Stage == "" {
				req.Stage = domain.ProjectPhotoStageInstalled
			}

			photo := domain.ProjectPhoto{
				ProjectID:    project.ID,
				Stage:        req.Stage,
				URL:          req.URL,
				ThumbnailURL: req.ThumbnailURL,
				Caption:      req.Caption,
				IsShowcase:   req.IsShowcase,
				CreatedBy:    userID,
			}
			if err := s.Store.CreateProjectPhoto(r.Context(), &photo); err != nil {
				respondWithInternalError(w, err, "create project photo")
				return
			}
			respondWithJSON(w, http.StatusCreated, photo)
			return
		}

		// Case 2: Multipart form file upload
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

		buf := make([]byte, 512)
		n, _ := io.ReadFull(file, buf)
		fileContentType := http.DetectContentType(buf[:n])
		ext, ok := allowedMediaTypes[fileContentType]
		if !ok {
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

		if _, err := out.Write(buf[:n]); err != nil {
			respondWithInternalError(w, err, "media write")
			return
		}
		if _, err := io.Copy(out, file); err != nil {
			respondWithInternalError(w, err, "media write")
			return
		}

		stageStr := r.FormValue("stage")
		if stageStr == "" {
			stageStr = string(domain.ProjectPhotoStageInstalled)
		}
		caption := r.FormValue("caption")
		isShowcase := r.FormValue("is_showcase") == "true" || r.FormValue("is_showcase") == "1"

		photo := domain.ProjectPhoto{
			ProjectID:  project.ID,
			Stage:      domain.ProjectPhotoStage(stageStr),
			URL:        "/api/media/" + filename,
			Caption:    caption,
			IsShowcase: isShowcase,
			CreatedBy:  userID,
		}
		if err := s.Store.CreateProjectPhoto(r.Context(), &photo); err != nil {
			respondWithInternalError(w, err, "create project photo")
			return
		}

		respondWithJSON(w, http.StatusCreated, photo)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// HandleProjectPhotoByID handles PATCH (update metadata) and DELETE for /api/projects/{id}/photos/{photoId}
func (s *Server) HandleProjectPhotoByID(w http.ResponseWriter, r *http.Request) {
	photoID := r.PathValue("photoId")
	if photoID == "" {
		respondWithError(w, http.StatusBadRequest, "falta el id de la foto")
		return
	}

	existing, err := s.Store.GetProjectPhotoByID(r.Context(), photoID)
	if err != nil {
		respondWithError(w, http.StatusNotFound, "foto no encontrada")
		return
	}

	switch r.Method {
	case http.MethodPatch:
		var req struct {
			Stage      *domain.ProjectPhotoStage `json:"stage,omitempty"`
			Caption    *string                   `json:"caption,omitempty"`
			IsShowcase *bool                     `json:"is_showcase,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondWithError(w, http.StatusBadRequest, "cuerpo json inválido")
			return
		}

		stage := existing.Stage
		if req.Stage != nil && *req.Stage != "" {
			stage = *req.Stage
		}
		caption := existing.Caption
		if req.Caption != nil {
			caption = *req.Caption
		}
		isShowcase := existing.IsShowcase
		if req.IsShowcase != nil {
			isShowcase = *req.IsShowcase
		}

		updated, err := s.Store.UpdateProjectPhoto(r.Context(), photoID, caption, isShowcase, stage)
		if err != nil {
			respondWithInternalError(w, err, "update project photo")
			return
		}
		respondWithJSON(w, http.StatusOK, updated)

	case http.MethodDelete:
		if err := s.Store.DeleteProjectPhoto(r.Context(), photoID); err != nil {
			respondWithError(w, http.StatusNotFound, "foto no encontrada")
			return
		}

		// Clean up physical file if it was uploaded locally to /api/media/{filename}
		if strings.HasPrefix(existing.URL, "/api/media/") && strings.TrimSpace(s.MediaDir) != "" {
			filename := strings.TrimPrefix(existing.URL, "/api/media/")
			if !strings.Contains(filename, "/") && !strings.Contains(filename, "\\") && !strings.Contains(filename, "..") {
				path := filepath.Join(s.MediaDir, filename)
				_ = os.Remove(path)
			}
		}

		respondWithJSON(w, http.StatusOK, map[string]string{"status": "deleted"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
