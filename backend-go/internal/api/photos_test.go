package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

type photosTestStore struct {
	stubStore
	photos         map[string][]domain.ProjectPhoto
	singlePhoto    *domain.ProjectPhoto
	createdPhoto   *domain.ProjectPhoto
	updatedPhoto   *domain.ProjectPhoto
	deletedPhotoID string
}

func (m *photosTestStore) ListProjectPhotos(_ context.Context, projectID string) ([]domain.ProjectPhoto, error) {
	return m.photos[projectID], nil
}

func (m *photosTestStore) ListShowcasePhotos(_ context.Context, onlyShowcase bool) ([]domain.ShowcasePhotoItem, error) {
	return []domain.ShowcasePhotoItem{
		{
			ID:          "p-1",
			ProjectID:   "proj-1",
			ProjectName: "Cocina Moderna",
			Stage:       domain.ProjectPhotoStageInstalled,
			URL:         "/api/media/showcase.webp",
			IsShowcase:  true,
		},
	}, nil
}


func (m *photosTestStore) GetProjectPhotoByID(_ context.Context, photoID string) (*domain.ProjectPhoto, error) {
	if m.singlePhoto != nil && m.singlePhoto.ID == photoID {
		return m.singlePhoto, nil
	}
	return nil, errors.New("not found")
}

func (m *photosTestStore) CreateProjectPhoto(_ context.Context, photo *domain.ProjectPhoto) error {
	photo.ID = "photo-123"
	photo.CreatedAt = time.Now()
	photo.UpdatedAt = time.Now()
	m.createdPhoto = photo
	return nil
}

func (m *photosTestStore) UpdateProjectPhoto(_ context.Context, photoID string, caption string, isShowcase bool, stage domain.ProjectPhotoStage) (*domain.ProjectPhoto, error) {
	p := domain.ProjectPhoto{
		ID:         photoID,
		ProjectID:  "proj-1",
		Stage:      stage,
		URL:        "/api/media/test.jpg",
		Caption:    caption,
		IsShowcase: isShowcase,
		UpdatedAt:  time.Now(),
	}
	m.updatedPhoto = &p
	return &p, nil
}

func (m *photosTestStore) DeleteProjectPhoto(_ context.Context, photoID string) error {
	m.deletedPhotoID = photoID
	return nil
}

func TestProjectPhotos_List(t *testing.T) {
	mockStore := &photosTestStore{
		photos: map[string][]domain.ProjectPhoto{
			"proj-1": {
				{
					ID:        "p1",
					ProjectID: "proj-1",
					Stage:     domain.ProjectPhotoStageSurvey,
					URL:       "/api/media/survey.jpg",
					Caption:   "Relevamiento tomas de agua",
				},
				{
					ID:         "p2",
					ProjectID:  "proj-1",
					Stage:      domain.ProjectPhotoStageInstalled,
					URL:        "/api/media/final.jpg",
					IsShowcase: true,
				},
			},
		},
	}
	mockStore.projectReturnedByID = &domain.Project{ID: "proj-1", Name: "Cocina Demo"}

	server := &Server{Store: mockStore}
	req := httptest.NewRequest(http.MethodGet, "/api/projects/proj-1/photos", nil)
	req.SetPathValue("id", "proj-1")
	w := httptest.NewRecorder()

	server.HandleProjectPhotos(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	var photos []domain.ProjectPhoto
	if err := json.NewDecoder(w.Body).Decode(&photos); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(photos) != 2 {
		t.Fatalf("expected 2 photos, got %d", len(photos))
	}
	if photos[0].Caption != "Relevamiento tomas de agua" {
		t.Errorf("unexpected caption: %s", photos[0].Caption)
	}
}

func TestProjectPhotos_UploadJSON(t *testing.T) {
	mockStore := &photosTestStore{}
	mockStore.projectReturnedByID = &domain.Project{ID: "proj-1", Name: "Cocina Demo"}

	server := &Server{Store: mockStore}
	body := map[string]any{
		"stage":       "in_workshop",
		"url":         "https://example.com/photo.jpg",
		"caption":     "Ensamble en banco",
		"is_showcase": true,
	}
	raw, _ := json.Marshal(body)

	req := httptest.NewRequest(http.MethodPost, "/api/projects/proj-1/photos", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "proj-1")
	w := httptest.NewRecorder()

	server.HandleProjectPhotos(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
	}
	if mockStore.createdPhoto == nil {
		t.Fatal("expected photo to be created in store")
	}
	if mockStore.createdPhoto.Stage != domain.ProjectPhotoStageInWorkshop {
		t.Errorf("expected stage in_workshop, got %s", mockStore.createdPhoto.Stage)
	}
}

func TestProjectPhotos_UploadMultipart(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "photos_test_*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	mockStore := &photosTestStore{}
	mockStore.projectReturnedByID = &domain.Project{ID: "proj-1", Name: "Cocina Demo"}

	server := &Server{Store: mockStore, MediaDir: tmpDir}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("stage", "installed")
	_ = writer.WriteField("caption", "Cocina instalada")
	_ = writer.WriteField("is_showcase", "true")

	// Dummy JPEG header (SOI marker 0xFF, 0xD8, 0xFF)
	part, _ := writer.CreateFormFile("file", "test.jpg")
	_, _ = part.Write([]byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01})
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/projects/proj-1/photos", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.SetPathValue("id", "proj-1")
	w := httptest.NewRecorder()

	server.HandleProjectPhotos(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
	}
	if mockStore.createdPhoto == nil {
		t.Fatal("expected created photo")
	}
	if mockStore.createdPhoto.Stage != domain.ProjectPhotoStageInstalled {
		t.Errorf("expected installed, got %s", mockStore.createdPhoto.Stage)
	}
	if !mockStore.createdPhoto.IsShowcase {
		t.Errorf("expected isShowcase = true")
	}
}

func TestProjectPhotos_PatchAndDelete(t *testing.T) {
	mockStore := &photosTestStore{
		singlePhoto: &domain.ProjectPhoto{
			ID:        "photo-99",
			ProjectID: "proj-1",
			Stage:     domain.ProjectPhotoStageSurvey,
			URL:       "/api/media/test.jpg",
			Caption:   "Foto vieja",
		},
	}

	server := &Server{Store: mockStore}

	// 1. PATCH
	patchBody := map[string]any{
		"caption":     "Foto actualizada",
		"stage":       "installed",
		"is_showcase": true,
	}
	raw, _ := json.Marshal(patchBody)
	req := httptest.NewRequest(http.MethodPatch, "/api/projects/proj-1/photos/photo-99", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("photoId", "photo-99")
	w := httptest.NewRecorder()

	server.HandleProjectPhotoByID(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}
	if mockStore.updatedPhoto == nil || mockStore.updatedPhoto.Caption != "Foto actualizada" {
		t.Errorf("expected updated caption 'Foto actualizada'")
	}

	// 2. DELETE
	delReq := httptest.NewRequest(http.MethodDelete, "/api/projects/proj-1/photos/photo-99", nil)
	delReq.SetPathValue("photoId", "photo-99")
	delW := httptest.NewRecorder()

	server.HandleProjectPhotoByID(delW, delReq)

	if delW.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for delete, got %d: %s", delW.Code, delW.Body.String())
	}
	if mockStore.deletedPhotoID != "photo-99" {
		t.Errorf("expected deleted ID photo-99, got %s", mockStore.deletedPhotoID)
	}
}

func TestHandleShowcasePhotos(t *testing.T) {
	mockStore := &photosTestStore{}
	server := &Server{Store: mockStore}

	req := httptest.NewRequest(http.MethodGet, "/api/showcase/photos?only_showcase=true", nil)
	w := httptest.NewRecorder()

	server.HandleShowcasePhotos(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	var items []domain.ShowcasePhotoItem
	if err := json.NewDecoder(w.Body).Decode(&items); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(items) != 1 || items[0].ProjectName != "Cocina Moderna" {
		t.Errorf("unexpected items: %+v", items)
	}
}

