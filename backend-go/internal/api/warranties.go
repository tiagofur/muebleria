package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// generateTicketNumber creates a readable ticket code like GAR-20260815-A1B2
func generateTicketNumber() string {
	b := make([]byte, 2)
	_, _ = rand.Read(b)
	return fmt.Sprintf("GAR-%s-%s", time.Now().Format("20060102"), strings.ToUpper(hex.EncodeToString(b)))
}

// HandleWarrantyTickets handles GET /api/warranties and POST /api/warranties
func (s *Server) HandleWarrantyTickets(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		projectID := r.URL.Query().Get("project_id")
		customerID := r.URL.Query().Get("customer_id")
		status := r.URL.Query().Get("status")

		tickets, err := s.Store.ListWarrantyTickets(r.Context(), projectID, customerID, status)
		if err != nil {
			respondWithInternalError(w, err, "list warranty tickets")
			return
		}
		respondWithJSON(w, http.StatusOK, tickets)

	case http.MethodPost:
		var req struct {
			ID                   string                              `json:"id,omitempty"`
			TicketNumber         string                              `json:"ticket_number,omitempty"`
			ProjectID            string                              `json:"project_id"`
			CustomerID           *string                             `json:"customer_id,omitempty"`
			Title                string                              `json:"title"`
			Description          string                              `json:"description"`
			Category             domain.WarrantyCategory             `json:"category"`
			Priority             domain.WarrantyPriority             `json:"priority"`
			Status               domain.WarrantyStatus               `json:"status,omitempty"`
			AssignedTechnicianID *string                             `json:"assigned_technician_id,omitempty"`
			ScheduledDate        *string                             `json:"scheduled_date,omitempty"`
			RefabricationPieces  []domain.WarrantyRefabricationPiece `json:"refabrication_pieces,omitempty"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondWithError(w, http.StatusBadRequest, "cuerpo json inválido")
			return
		}

		if strings.TrimSpace(req.ProjectID) == "" {
			respondWithError(w, http.StatusBadRequest, "project_id es requerido")
			return
		}
		if strings.TrimSpace(req.Title) == "" {
			respondWithError(w, http.StatusBadRequest, "el título del ticket es requerido")
			return
		}

		ticketID := strings.TrimSpace(req.ID)
		if ticketID == "" {
			b := make([]byte, 16)
			_, _ = rand.Read(b)
			ticketID = fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
		}

		ticketNum := strings.TrimSpace(req.TicketNumber)
		if ticketNum == "" {
			ticketNum = generateTicketNumber()
		}

		cat := req.Category
		if cat == "" {
			cat = domain.WarrantyCategoryOther
		}
		prio := req.Priority
		if prio == "" {
			prio = domain.WarrantyPriorityNormal
		}
		stat := req.Status
		if stat == "" {
			stat = domain.WarrantyStatusOpen
		}

		ticket := domain.WarrantyTicket{
			ID:                   ticketID,
			TicketNumber:         ticketNum,
			ProjectID:            req.ProjectID,
			CustomerID:           req.CustomerID,
			Title:                req.Title,
			Description:          req.Description,
			Category:             cat,
			Priority:             prio,
			Status:               stat,
			AssignedTechnicianID: req.AssignedTechnicianID,
			ScheduledDate:        req.ScheduledDate,
			RefabricationPieces:  req.RefabricationPieces,
		}
		if ticket.RefabricationPieces == nil {
			ticket.RefabricationPieces = []domain.WarrantyRefabricationPiece{}
		}

		if err := s.Store.CreateWarrantyTicket(r.Context(), &ticket); err != nil {
			respondWithInternalError(w, err, "create warranty ticket")
			return
		}

		respondWithJSON(w, http.StatusCreated, ticket)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
	}
}

// HandleWarrantyTicketByID handles GET, PATCH, and DELETE for /api/warranties/{id}
func (s *Server) HandleWarrantyTicketByID(w http.ResponseWriter, r *http.Request) {
	ticketID := r.PathValue("id")
	if ticketID == "" {
		respondWithError(w, http.StatusBadRequest, "falta el id del ticket")
		return
	}

	ticket, err := s.Store.GetWarrantyTicketByID(r.Context(), ticketID)
	if err != nil {
		respondWithInternalError(w, err, "get warranty ticket")
		return
	}
	if ticket == nil {
		respondWithError(w, http.StatusNotFound, "ticket de garantía no encontrado")
		return
	}

	switch r.Method {
	case http.MethodGet:
		respondWithJSON(w, http.StatusOK, ticket)

	case http.MethodPatch:
		var req struct {
			Title                *string                             `json:"title,omitempty"`
			Description          *string                             `json:"description,omitempty"`
			Category             *domain.WarrantyCategory            `json:"category,omitempty"`
			Priority             *domain.WarrantyPriority            `json:"priority,omitempty"`
			Status               *domain.WarrantyStatus              `json:"status,omitempty"`
			AssignedTechnicianID *string                             `json:"assigned_technician_id,omitempty"`
			ScheduledDate        *string                             `json:"scheduled_date,omitempty"`
			ResolvedAt           *string                             `json:"resolved_at,omitempty"`
			ResolutionNotes      *string                             `json:"resolution_notes,omitempty"`
			RefabricationPieces  *[]domain.WarrantyRefabricationPiece `json:"refabrication_pieces,omitempty"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondWithError(w, http.StatusBadRequest, "cuerpo json inválido")
			return
		}

		if req.Title != nil {
			ticket.Title = *req.Title
		}
		if req.Description != nil {
			ticket.Description = *req.Description
		}
		if req.Category != nil {
			ticket.Category = *req.Category
		}
		if req.Priority != nil {
			ticket.Priority = *req.Priority
		}
		if req.Status != nil {
			ticket.Status = *req.Status
			if *req.Status == domain.WarrantyStatusResolved && ticket.ResolvedAt == nil {
				now := time.Now().UTC()
				ticket.ResolvedAt = &now
			}
		}
		if req.AssignedTechnicianID != nil {
			ticket.AssignedTechnicianID = req.AssignedTechnicianID
		}
		if req.ScheduledDate != nil {
			ticket.ScheduledDate = req.ScheduledDate
		}
		if req.ResolvedAt != nil {
			if *req.ResolvedAt == "" {
				ticket.ResolvedAt = nil
			} else if t, err := time.Parse(time.RFC3339, *req.ResolvedAt); err == nil {
				ticket.ResolvedAt = &t
			}
		}
		if req.ResolutionNotes != nil {
			ticket.ResolutionNotes = *req.ResolutionNotes
		}
		if req.RefabricationPieces != nil {
			ticket.RefabricationPieces = *req.RefabricationPieces
		}

		if err := s.Store.UpdateWarrantyTicket(r.Context(), ticket); err != nil {
			respondWithInternalError(w, err, "update warranty ticket")
			return
		}

		respondWithJSON(w, http.StatusOK, ticket)

	case http.MethodDelete:
		if err := s.Store.DeleteWarrantyTicket(r.Context(), ticketID); err != nil {
			respondWithInternalError(w, err, "delete warranty ticket")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"status": "deleted"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
	}
}

// HandleWarrantyTicketPhotos handles GET (list) and POST (upload photo) for /api/warranties/{id}/photos
func (s *Server) HandleWarrantyTicketPhotos(w http.ResponseWriter, r *http.Request) {
	ticketID := r.PathValue("id")
	if ticketID == "" {
		respondWithError(w, http.StatusBadRequest, "falta el id del ticket")
		return
	}

	ticket, err := s.Store.GetWarrantyTicketByID(r.Context(), ticketID)
	if err != nil {
		respondWithInternalError(w, err, "get warranty ticket")
		return
	}
	if ticket == nil {
		respondWithError(w, http.StatusNotFound, "ticket de garantía no encontrado")
		return
	}

	switch r.Method {
	case http.MethodGet:
		photos, err := s.Store.ListWarrantyTicketPhotos(r.Context(), ticketID)
		if err != nil {
			respondWithInternalError(w, err, "list warranty ticket photos")
			return
		}
		respondWithJSON(w, http.StatusOK, photos)

	case http.MethodPost:
		contentType := r.Header.Get("Content-Type")

		// Case 1: JSON body
		if strings.HasPrefix(contentType, "application/json") {
			var req struct {
				Kind         domain.WarrantyPhotoKind `json:"kind"`
				URL          string                   `json:"url"`
				ThumbnailURL string                   `json:"thumbnail_url,omitempty"`
				Caption      string                   `json:"caption,omitempty"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				respondWithError(w, http.StatusBadRequest, "cuerpo json inválido")
				return
			}
			if strings.TrimSpace(req.URL) == "" {
				respondWithError(w, http.StatusBadRequest, "la url es requerida")
				return
			}
			kind := req.Kind
			if kind == "" {
				kind = domain.WarrantyPhotoIssueReport
			}
			thumb := req.ThumbnailURL
			if thumb == "" {
				thumb = req.URL
			}

			b := make([]byte, 16)
			_, _ = rand.Read(b)
			photoID := fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])

			photo := domain.WarrantyTicketPhoto{
				ID:           photoID,
				TicketID:     ticket.ID,
				Kind:         kind,
				URL:          req.URL,
				ThumbnailURL: thumb,
				Caption:      req.Caption,
			}

			if err := s.Store.AddWarrantyTicketPhoto(r.Context(), &photo); err != nil {
				respondWithInternalError(w, err, "save warranty photo")
				return
			}
			respondWithJSON(w, http.StatusCreated, photo)
			return
		}

		// Case 2: Multipart form upload
		if strings.HasPrefix(contentType, "multipart/form-data") {
			if err := r.ParseMultipartForm(10 << 20); err != nil { // 10 MB limit
				respondWithError(w, http.StatusBadRequest, "error al procesar multipart form")
				return
			}

			file, header, err := r.FormFile("file")
			if err != nil {
				respondWithError(w, http.StatusBadRequest, "falta el archivo de imagen ('file')")
				return
			}
			defer file.Close()

			kindStr := r.FormValue("kind")
			kind := domain.WarrantyPhotoIssueReport
			if kindStr == string(domain.WarrantyPhotoResolutionProof) {
				kind = domain.WarrantyPhotoResolutionProof
			}
			caption := r.FormValue("caption")

			uploadDir := filepath.Join("data", "uploads", "warranties", ticketID)
			if err := os.MkdirAll(uploadDir, 0755); err != nil {
				respondWithInternalError(w, err, "create upload dir")
				return
			}

			b := make([]byte, 8)
			_, _ = rand.Read(b)
			randSuffix := hex.EncodeToString(b)
			ext := filepath.Ext(header.Filename)
			if ext == "" {
				ext = ".jpg"
			}
			filename := fmt.Sprintf("%d_%s%s", time.Now().Unix(), randSuffix, ext)
			destPath := filepath.Join(uploadDir, filename)

			destFile, err := os.Create(destPath)
			if err != nil {
				respondWithInternalError(w, err, "save uploaded file")
				return
			}
			defer destFile.Close()

			if _, err := io.Copy(destFile, file); err != nil {
				respondWithInternalError(w, err, "copy file content")
				return
			}

			bUUID := make([]byte, 16)
			_, _ = rand.Read(bUUID)
			photoID := fmt.Sprintf("%x-%x-%x-%x-%x", bUUID[0:4], bUUID[4:6], bUUID[6:8], bUUID[8:10], bUUID[10:16])

			fileURL := fmt.Sprintf("/uploads/warranties/%s/%s", ticketID, filename)

			photo := domain.WarrantyTicketPhoto{
				ID:           photoID,
				TicketID:     ticket.ID,
				Kind:         kind,
				URL:          fileURL,
				ThumbnailURL: fileURL,
				Caption:      caption,
			}

			if err := s.Store.AddWarrantyTicketPhoto(r.Context(), &photo); err != nil {
				respondWithInternalError(w, err, "save warranty photo")
				return
			}

			respondWithJSON(w, http.StatusCreated, photo)
			return
		}

		respondWithError(w, http.StatusBadRequest, "Content-Type debe ser application/json o multipart/form-data")

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
	}
}

// HandleWarrantyTicketPhotoDelete handles DELETE /api/warranties/{id}/photos/{photoId}
func (s *Server) HandleWarrantyTicketPhotoDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}

	ticketID := r.PathValue("id")
	photoID := r.PathValue("photoId")

	if ticketID == "" || photoID == "" {
		respondWithError(w, http.StatusBadRequest, "faltan parámetros de ruta")
		return
	}

	if err := s.Store.DeleteWarrantyTicketPhoto(r.Context(), ticketID, photoID); err != nil {
		respondWithInternalError(w, err, "delete warranty photo")
		return
	}

	respondWithJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
