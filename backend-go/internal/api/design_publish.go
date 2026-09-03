package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #392 / DT-8: staged design publication API (prepare → upload → finalize)
// plus the published-artifact readback and signed-read surface (ADR-0003,
// digital-thread §§17-18, 21, 26, 28, 30-31).
//
// Publication source of truth is the persistent DesignWorkingCopy: prepare
// only VALIDATES the manifest v1 against it and pins the base revision;
// finalize re-validates everything under the design lock and snapshots the
// working copy through the same #387 core. SketchUp never submits arbitrary
// revision items.

// Per-kind upload constraints. The .skp model is the heavy artifact; manifest
// and preview stay small.
var designPublishArtifactLimits = map[domain.DesignPublishArtifactKind]struct {
	maxBytes  int64
	ext       string
	multipart string
}{
	domain.DesignPublishArtifactModel:    {maxBytes: 256 << 20, ext: ".skp", multipart: "file"},
	domain.DesignPublishArtifactManifest: {maxBytes: 1 << 20, ext: ".json", multipart: "file"},
	domain.DesignPublishArtifactPreview:  {maxBytes: 16 << 20, ext: ".png", multipart: "file"},
}

func respondWithDesignPublishError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrDesignNotFound),
		errors.Is(err, domain.ErrDesignRevisionNotFound),
		errors.Is(err, domain.ErrPublishSessionNotFound):
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "La revisión, el diseño o la sesión de publicación no existen", nil)
	case errors.Is(err, domain.ErrPublishSessionNotPrepared):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "La sesión de publicación ya no está activa; prepará la publicación de nuevo", nil)
	case errors.Is(err, domain.ErrDesignRevisionConflict):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, err.Error(), nil)
	case errors.Is(err, domain.ErrPublishManifestInvalid):
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, err.Error(), nil)
	case errors.Is(err, domain.ErrPublishManifestWorkingCopyMismatch):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "El manifest no corresponde al estado actual del borrador de trabajo; sincronizá y volvé a publicar", nil)
	case errors.Is(err, domain.ErrPublishArtifactMissing):
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "Falta subir uno o más artefactos de la publicación (modelo, manifest o preview)", nil)
	case errors.Is(err, domain.ErrPublishArtifactHashMismatch):
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "El hash del artefacto no coincide con el contenido subido", nil)
	default:
		respondWithDesignError(w, err)
	}
}

func designPublishManifestFromDTO(dto openapi.DesignPublishManifest) (*domain.DesignPublishManifest, error) {
	m := domain.DesignPublishManifest{
		SchemaVersion: int(dto.SchemaVersion),
		ProjectID:     strings.TrimSpace(dto.ProjectId),
		DesignID:      strings.TrimSpace(dto.DesignId),
		Source: domain.DesignPublishManifestSource{
			Client:          strings.TrimSpace(dto.Source.Client),
			SketchUpVersion: strings.TrimSpace(dto.Source.SketchupVersion),
			PluginVersion:   strings.TrimSpace(dto.Source.PluginVersion),
		},
	}
	if dto.BaseRevisionId != nil {
		base := strings.TrimSpace(*dto.BaseRevisionId)
		if base != "" {
			m.BaseRevisionID = &base
		}
	}
	for _, item := range dto.Items {
		itemDomain := domain.DesignPublishManifestItem{
			FurnitureInstanceID: strings.TrimSpace(item.FurnitureInstanceId),
		}
		if item.TechnicalClientLocator != nil {
			itemDomain.TechnicalClientLocator = &domain.TechnicalClientLocator{
				Kind:  item.TechnicalClientLocator.Kind,
				Value: item.TechnicalClientLocator.Value,
			}
		}
		m.Items = append(m.Items, itemDomain)
	}
	raw, err := domain.CanonicalDesignPublishManifestJSON(&m)
	if err != nil {
		return nil, err
	}
	return domain.ParseDesignPublishManifest(raw)
}

func toDesignPublishSessionDTO(s domain.DesignPublishSession) openapi.DesignPublishSession {
	dto := openapi.DesignPublishSession{
		ID:                s.ID,
		DesignID:          s.DesignID,
		Status:            openapi.DesignPublishSessionStatus(s.Status),
		ExpiresAt:         s.ExpiresAt.UTC().Format(time.RFC3339Nano),
		RequiredArtifacts: make([]openapi.DesignPublishArtifactKind, 0, len(domain.RequiredDesignPublishArtifacts)),
	}
	if s.BaseRevisionID != nil && *s.BaseRevisionID != "" {
		dto.BaseRevisionID = s.BaseRevisionID
	}
	for _, kind := range domain.RequiredDesignPublishArtifacts {
		dto.RequiredArtifacts = append(dto.RequiredArtifacts, openapi.DesignPublishArtifactKind(kind))
	}
	return dto
}

func toDesignRevisionArtifactDTO(a domain.DesignRevisionArtifact) openapi.DesignRevisionArtifact {
	dto := openapi.DesignRevisionArtifact{
		ID:               a.ID,
		DesignRevisionID: a.DesignRevisionID,
		Kind:             openapi.DesignPublishArtifactKind(a.Kind),
		ContentType:      a.ContentType,
		SizeBytes:        a.SizeBytes,
		Sha256:           a.SHA256,
		CreatedAt:        a.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
	if a.UploadedBy != "" {
		dto.UploadedBy = &a.UploadedBy
	}
	return dto
}

// HandleDesignPublishPrepare: POST /api/designs/{designId}/publish:prepare.
// Validates the manifest v1 against the authoritative working copy and pins
// the base revision. Behind RequireIdempotency at the route level.
func (s *Server) HandleDesignPublishPrepare(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	roles := actorRoles(claims)
	designID := r.PathValue("designId")
	if !isValidUUID(designID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "designId inválido", nil)
		return
	}
	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateProjects), "no tenés permiso para publicar diseños") {
		return
	}

	var body openapi.PrepareDesignPublishRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	manifest, err := designPublishManifestFromDTO(body.Manifest)
	if err != nil {
		respondWithDesignPublishError(w, err)
		return
	}

	result, err := s.Store.PrepareDesignPublish(r.Context(), storage.PrepareDesignPublishCommand{
		DesignID:    designID,
		Manifest:    *manifest,
		ActorUserID: claims.UserID,
		IP:          clientIP(r),
		RequestID:   RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithDesignPublishError(w, err)
		return
	}

	// Best-effort removal of files staged by sessions abandoned in the lazy
	// expiry sweep. Losing the race or an IO error only logs: the rows are
	// already gone, so the files are orphans a future clean-media pass can
	// collect (documented failure-cleanup strategy).
	for _, key := range result.AbandonedKeys {
		s.removeDesignArtifactFile(r.Context(), key)
	}

	respondWithJSON(w, http.StatusCreated, toDesignPublishSessionDTO(*result.Session))
}

// designArtifactStoragePath resolves a design artifact storage key under the
// caller's organization partition. The key must be canonical
// (server-generated shape) — anything else is refused before touching disk.
func (s *Server) designArtifactStoragePath(ctx context.Context, storageKey string) (string, bool) {
	if strings.TrimSpace(s.MediaDir) == "" || auth.DesignArtifactResourceKey(storageKey) == "" {
		return "", false
	}
	path := filepath.Join(s.MediaDir, storage.OrgFromCtx(ctx), filepath.FromSlash(storageKey))
	cleanRoot := filepath.Clean(s.MediaDir)
	if !strings.HasPrefix(filepath.Clean(path), cleanRoot+string(os.PathSeparator)) {
		return "", false
	}
	return path, true
}

// removeDesignArtifactFile deletes one staged/published artifact file
// best-effort (idempotent; IO errors are logged, never propagated).
func (s *Server) removeDesignArtifactFile(ctx context.Context, storageKey string) {
	path, ok := s.designArtifactStoragePath(ctx, storageKey)
	if !ok {
		return
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		slog.Warn("design artifact cleanup: failed to remove file", "path", path, "error", err)
	}
}

// HandleDesignPublishArtifactUpload: POST (multipart) /api/designs/{designId}/publish/{sessionId}/artifacts/{kind}.
// Streams the file to the organization media namespace while computing
// SHA-256, then records the staging metadata. Re-upload of a kind replaces
// the previous staging row and file.
func (s *Server) HandleDesignPublishArtifactUpload(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	roles := actorRoles(claims)
	designID := r.PathValue("designId")
	sessionID := r.PathValue("sessionId")
	kindRaw := r.PathValue("kind")
	kind := domain.DesignPublishArtifactKind(kindRaw)
	limit, known := designPublishArtifactLimits[kind]
	if !isValidUUID(designID) || !isValidUUID(sessionID) || !domain.IsValidDesignPublishArtifactKind(kind) || !known {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "ruta de publicación inválida", nil)
		return
	}
	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateProjects), "no tenés permiso para publicar diseños") {
		return
	}
	if strings.TrimSpace(s.MediaDir) == "" {
		respondWithError(w, http.StatusServiceUnavailable, "almacenamiento de artefactos no configurado")
		return
	}

	// The session gates every upload: prepared, unexpired, this design.
	// An invalid precheck state means NO artifact upload (§2).
	detail, err := s.Store.GetDesignPublishSession(r.Context(), designID, sessionID)
	if err != nil {
		respondWithDesignPublishError(w, err)
		return
	}
	if detail.Session.Status != "prepared" {
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "La sesión de publicación ya no está activa; prepará la publicación de nuevo", nil)
		return
	}
	if !time.Now().Before(detail.Session.ExpiresAt) {
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "La sesión de publicación expiró; prepará la publicación de nuevo", nil)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, limit.maxBytes+1<<20)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		respondWithError(w, http.StatusRequestEntityTooLarge,
			"archivo demasiado grande (máx "+fmt.Sprintf("%d MB", limit.maxBytes>>20)+")")
		return
	}
	file, header, err := r.FormFile(limit.multipart)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "falta el archivo (campo file)")
		return
	}
	defer file.Close()

	// Sniff the content type from the first 512 bytes and validate per kind.
	buf := make([]byte, 512)
	n, _ := io.ReadFull(file, buf)
	sniffed := http.DetectContentType(buf[:n])
	var contentType, ext string
	switch kind {
	case domain.DesignPublishArtifactModel:
		// .skp is an opaque binary container: the server cannot and does not
		// parse it (negative proof: managed items never come from scanning
		// the model). Accept the binary payload with a .skp filename.
		if !strings.HasSuffix(strings.ToLower(header.Filename), ".skp") {
			respondWithError(w, http.StatusBadRequest, "el artefacto del modelo debe ser un archivo .skp")
			return
		}
		contentType, ext = "application/octet-stream", ".skp"
	case domain.DesignPublishArtifactManifest:
		if sniffed != "text/plain; charset=utf-8" && sniffed != "application/json" &&
			!strings.HasPrefix(sniffed, "text/plain") {
			respondWithError(w, http.StatusBadRequest, "el manifest debe ser un archivo JSON")
			return
		}
		contentType, ext = "application/json", ".json"
	case domain.DesignPublishArtifactPreview:
		switch sniffed {
		case "image/png":
			contentType, ext = "image/png", ".png"
		case "image/jpeg":
			contentType, ext = "image/jpeg", ".jpg"
		default:
			respondWithError(w, http.StatusBadRequest, "la preview debe ser una imagen PNG o JPEG")
			return
		}
	}

	// Stream to a temp file in the session namespace while hashing.
	orgDir := filepath.Join(s.MediaDir, storage.OrgFromCtx(r.Context()), "designs", "publish", sessionID)
	if err := os.MkdirAll(orgDir, 0o750); err != nil {
		respondWithInternalError(w, err, "design artifact mkdir")
		return
	}
	tmp, err := os.CreateTemp(orgDir, ".upload-*")
	if err != nil {
		respondWithInternalError(w, err, "design artifact temp")
		return
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	hasher := sha256.New()
	size := int64(0)
	for _, chunk := range [][]byte{buf[:n]} {
		if len(chunk) == 0 {
			continue
		}
		if _, err := tmp.Write(chunk); err != nil {
			tmp.Close()
			respondWithInternalError(w, err, "design artifact write")
			return
		}
		hasher.Write(chunk)
		size += int64(len(chunk))
	}
	written, copyErr := io.Copy(io.MultiWriter(tmp, hasher), file)
	if closeErr := tmp.Close(); closeErr != nil {
		respondWithInternalError(w, closeErr, "design artifact write")
		return
	}
	if copyErr != nil {
		respondWithAPIError(w, http.StatusRequestEntityTooLarge, openapi.ApiErrorCodeBadRequest,
			"archivo demasiado grande (máx "+fmt.Sprintf("%d MB", limit.maxBytes>>20)+")", nil)
		return
	}
	size += written
	if size <= 0 || size > limit.maxBytes {
		respondWithAPIError(w, http.StatusRequestEntityTooLarge, openapi.ApiErrorCodeBadRequest,
			"archivo demasiado grande (máx "+fmt.Sprintf("%d MB", limit.maxBytes>>20)+")", nil)
		return
	}
	sum := hasher.Sum(nil)
	sha := "sha256-" + hex.EncodeToString(sum)
	storageKey := fmt.Sprintf("designs/publish/%s/%s-%s%s", sessionID, kind, hex.EncodeToString(sum[:6]), ext)
	destPath := filepath.Join(s.MediaDir, storage.OrgFromCtx(r.Context()), filepath.FromSlash(storageKey))
	if !strings.HasPrefix(filepath.Clean(destPath), filepath.Clean(s.MediaDir)+string(os.PathSeparator)) {
		respondWithError(w, http.StatusBadRequest, "ruta inválida")
		return
	}
	if err := os.Rename(tmpPath, destPath); err != nil {
		respondWithInternalError(w, err, "design artifact store")
		return
	}

	// The manifest artifact must be the EXACT manifest the session prepared:
	// schema-valid and byte-identical after canonicalization (§5).
	if kind == domain.DesignPublishArtifactManifest {
		uploaded, pErr := os.ReadFile(destPath)
		if pErr != nil {
			respondWithInternalError(w, pErr, "design manifest readback")
			return
		}
		parsed, pErr := domain.ParseDesignPublishManifest(uploaded)
		if pErr != nil {
			s.removeDesignArtifactFile(r.Context(), storageKey)
			respondWithDesignPublishError(w, pErr)
			return
		}
		canonical, pErr := domain.CanonicalDesignPublishManifestJSON(parsed)
		if pErr != nil {
			s.removeDesignArtifactFile(r.Context(), storageKey)
			respondWithDesignPublishError(w, pErr)
			return
		}
		prepared, pErr := domain.CanonicalDesignPublishManifestJSON(detail.Session.Manifest)
		if pErr != nil {
			s.removeDesignArtifactFile(r.Context(), storageKey)
			respondWithDesignPublishError(w, pErr)
			return
		}
		if !bytes.Equal(canonical, prepared) {
			s.removeDesignArtifactFile(r.Context(), storageKey)
			respondWithDesignPublishError(w, domain.ErrPublishManifestWorkingCopyMismatch)
			return
		}
	}

	artifact, replacedKey, err := s.Store.RecordDesignPublishArtifact(r.Context(), storage.RecordDesignPublishArtifactCommand{
		DesignID:    designID,
		SessionID:   sessionID,
		Kind:        kind,
		StorageKey:  storageKey,
		ContentType: contentType,
		SizeBytes:   size,
		SHA256:      sha,
		ActorUserID: claims.UserID,
	})
	if err != nil {
		// Keep the namespace clean: the row is the metadata source of truth.
		s.removeDesignArtifactFile(r.Context(), storageKey)
		respondWithDesignPublishError(w, err)
		return
	}
	if replacedKey != "" && replacedKey != storageKey {
		s.removeDesignArtifactFile(r.Context(), replacedKey)
	}

	respondWithJSON(w, http.StatusCreated, openapi.DesignPublishArtifactUploaded{
		Kind:        openapi.DesignPublishArtifactKind(artifact.Kind),
		Sha256:      artifact.SHA256,
		SizeBytes:   artifact.SizeBytes,
		ContentType: artifact.ContentType,
	})
}

// HandleDesignPublishFinalize: POST /api/designs/{designId}/publish/{sessionId}:finalize.
// Behind RequireIdempotency at the route level. Re-validates everything and
// publishes the immutable revision atomically; a revision is `published` only
// when every artifact is present and verified.
func (s *Server) HandleDesignPublishFinalize(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	roles := actorRoles(claims)
	designID := r.PathValue("designId")
	sessionID := r.PathValue("sessionId")
	if !isValidUUID(designID) || !isValidUUID(sessionID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "IDs inválidos", nil)
		return
	}
	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateProjects), "no tenés permiso para publicar diseños") {
		return
	}

	// Belt and braces before the transactional finalize: every staged
	// artifact FILE must exist on disk. A lost file fails the publish —
	// never a falsely published revision.
	detail, err := s.Store.GetDesignPublishSession(r.Context(), designID, sessionID)
	if err != nil {
		respondWithDesignPublishError(w, err)
		return
	}
	if detail.Session.Status == "prepared" {
		staged := make(map[domain.DesignPublishArtifactKind]domain.DesignRevisionArtifact, len(detail.Artifacts))
		for _, a := range detail.Artifacts {
			staged[a.Kind] = a
		}
		for _, kind := range domain.RequiredDesignPublishArtifacts {
			a, ok := staged[kind]
			if !ok {
				respondWithDesignPublishError(w, domain.ErrPublishArtifactMissing)
				return
			}
			path, ok := s.designArtifactStoragePath(r.Context(), a.StorageKey)
			if !ok {
				respondWithDesignPublishError(w, domain.ErrPublishArtifactMissing)
				return
			}
			info, statErr := os.Stat(path)
			if statErr != nil || info.IsDir() || info.Size() != a.SizeBytes {
				respondWithDesignPublishError(w, domain.ErrPublishArtifactMissing)
				return
			}
		}
	}

	rev, err := s.Store.FinalizeDesignPublish(r.Context(), storage.FinalizeDesignPublishCommand{
		DesignID:    designID,
		SessionID:   sessionID,
		ActorUserID: claims.UserID,
		IP:          clientIP(r),
		RequestID:   RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithDesignPublishError(w, err)
		return
	}
	respondWithJSON(w, http.StatusCreated, toDesignRevisionDTO(*rev))
}

// HandleDesignRevisionArtifacts: GET /api/designs/{designId}/revisions/{revisionId}/artifacts.
func (s *Server) HandleDesignRevisionArtifacts(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	roles := actorRoles(claims)
	designID := r.PathValue("designId")
	revisionID := r.PathValue("revisionId")
	if !isValidUUID(designID) || !isValidUUID(revisionID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "IDs inválidos", nil)
		return
	}
	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tenés permiso para ver la revisión de diseño") {
		return
	}
	artifacts, err := s.Store.ListDesignRevisionArtifacts(r.Context(), designID, revisionID)
	if err != nil {
		respondWithDesignPublishError(w, err)
		return
	}
	dtos := make([]openapi.DesignRevisionArtifact, 0, len(artifacts))
	for _, a := range artifacts {
		dtos = append(dtos, toDesignRevisionArtifactDTO(a))
	}
	respondWithJSON(w, http.StatusOK, dtos)
}

// HandleDesignRevisionArtifactAuthorize: POST /api/designs/{designId}/revisions/{revisionId}/artifacts/{kind}:authorize.
// Mints a short-lived signed read for one published artifact — the same
// media-grant mechanism as catalog media, never a public permanent URL.
func (s *Server) HandleDesignRevisionArtifactAuthorize(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	roles := actorRoles(claims)
	designID := r.PathValue("designId")
	revisionID := r.PathValue("revisionId")
	kind := domain.DesignPublishArtifactKind(r.PathValue("kind"))
	if !isValidUUID(designID) || !isValidUUID(revisionID) || !domain.IsValidDesignPublishArtifactKind(kind) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "IDs inválidos", nil)
		return
	}
	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tenés permiso para ver los artefactos del diseño") {
		return
	}
	if s.MediaTokens == nil {
		respondWithError(w, http.StatusServiceUnavailable, "firma de medios no configurada")
		return
	}

	artifact, err := s.Store.GetDesignRevisionArtifact(r.Context(), designID, revisionID, kind)
	if err != nil {
		respondWithDesignPublishError(w, err)
		return
	}
	resourceKey := auth.DesignArtifactResourceKey(artifact.StorageKey)
	if resourceKey == "" {
		respondWithInternalError(w, fmt.Errorf("non-canonical artifact storage key"), "design artifact grant")
		return
	}
	signed, mc, err := s.MediaTokens.Issue(auth.MediaIssueRequest{
		ResourceKey: resourceKey,
		OrgID:       storage.OrgFromCtx(r.Context()),
		SessionID:   claims.Sid,
		UserID:      claims.UserID,
		AbsoluteCap: mediaGrantAbsoluteCap(claims),
	})
	if err != nil {
		respondWithInternalError(w, err, "design artifact grant issue")
		return
	}
	respondWithJSON(w, http.StatusOK, openapi.DesignArtifactGrant{
		Kind:      openapi.DesignPublishArtifactKind(artifact.Kind),
		URL:       "/api/design-artifacts/" + artifact.StorageKey + "?grant=" + signed,
		ExpiresAt: mc.ExpiresAt.UTC().Format(time.RFC3339Nano),
	})
}

// designArtifactGetAuth authenticates GET /api/design-artifacts/{key} under
// the same dual-credential policy as media (#460 SEC-3): Authorization
// header → full session policy; otherwise a signed media_read grant for
// EXACTLY this resource key.
func (s *Server) designArtifactGetAuth(next http.Handler) http.Handler {
	sessionAuth := AuthMiddleware(s.tokenAuthority(), s.Store)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			sessionAuth(next).ServeHTTP(w, r)
			return
		}
		if s.MediaTokens == nil {
			respondWithAPIError(w, http.StatusServiceUnavailable, openapi.ApiErrorCodeMediaAccessInvalid,
				"la autorización de medios no está configurada", nil)
			return
		}
		grant := strings.TrimSpace(r.URL.Query().Get("grant"))
		if grant == "" {
			noStore(w)
			respondWithAPIError(w, http.StatusUnauthorized, openapi.ApiErrorCodeUnauthorized,
				"authorization header or media grant required", nil)
			return
		}
		claims, err := s.MediaTokens.Validate(grant)
		if err != nil {
			noStore(w)
			if errors.Is(err, auth.ErrMediaTokenExpired) {
				respondWithAPIError(w, http.StatusUnauthorized, openapi.ApiErrorCodeMediaAccessExpired,
					"el acceso al medio expiró; volvé a autorizarlo", nil)
			} else {
				respondWithAPIError(w, http.StatusUnauthorized, openapi.ApiErrorCodeMediaAccessInvalid,
					"acceso al medio inválido", nil)
			}
			return
		}
		// Exact-resource binding: a valid grant pointed at another artifact is
		// indistinguishable from a missing one.
		if auth.DesignArtifactKeyFromResource(claims.Resource) != r.PathValue("key") {
			noStore(w)
			respondWithError(w, http.StatusNotFound, "not found")
			return
		}
		ctx := storage.WithOrgCtx(r.Context(), claims.OrgID)
		ctx = context.WithValue(ctx, mediaGrantRemainingKey{}, time.Until(claims.ExpiresAt.Time))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// HandleDesignArtifactGet: GET /api/design-artifacts/{key} — streams one
// published artifact from the caller's organization partition.
func (s *Server) HandleDesignArtifactGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	key := r.PathValue("key")
	if auth.DesignArtifactResourceKey(key) == "" {
		respondWithError(w, http.StatusBadRequest, "clave de artefacto inválida")
		return
	}
	if strings.TrimSpace(s.MediaDir) == "" {
		respondWithError(w, http.StatusNotFound, "not found")
		return
	}
	path, ok := s.designArtifactStoragePath(r.Context(), key)
	if !ok {
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

	name := filepath.Base(key)
	switch strings.ToLower(filepath.Ext(name)) {
	case ".skp":
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", `attachment; filename="model.skp"`)
	case ".json":
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", `attachment; filename="manifest.json"`)
	case ".png":
		w.Header().Set("Content-Type", "image/png")
	case ".jpg":
		w.Header().Set("Content-Type", "image/jpeg")
	default:
		w.Header().Set("Content-Type", "application/octet-stream")
	}
	maxAge := 86400
	if remaining, ok := r.Context().Value(mediaGrantRemainingKey{}).(time.Duration); ok {
		capped := int(remaining.Seconds())
		if capped < 0 {
			capped = 0
		}
		if capped < maxAge {
			maxAge = capped
		}
	}
	w.Header().Set("Cache-Control", "private, max-age="+strconv.Itoa(maxAge))
	w.Header().Add("Vary", "Authorization")
	http.ServeContent(w, r, name, stat.ModTime(), f)
}
