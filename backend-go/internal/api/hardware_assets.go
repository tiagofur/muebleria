package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #667 / M1: versioned 3D assets for the hardware catalog — staged upload
// (start → receive → finalize → consult → cancel), authorized reads and the
// exact hardware visual binding. Byte handling mirrors the #392 design
// publish pipeline: server-side streaming SHA-256, canonical storage keys,
// organization-partitioned MediaDir, grants with integrity pins (#460).
// SKP is accepted as an opaque binary container (no parser is invented);
// GLB requires its own format magic; thumbnails are sniffed images. Host
// compatibility stays 'pending' until #668's authorized validator records
// evidence.

// Per-representation upload constraints. Configurable via
// HARDWARE_ASSET_MAX_*_BYTES (config → SetHardwareAssetLimits); these are
// operational caps, not validated format guarantees.
var defaultHardwareAssetLimits = map[domain.HardwareAssetRepresentation]int64{
	domain.HardwareAssetRepresentationSKP:       256 << 20,
	domain.HardwareAssetRepresentationGLB:       128 << 20,
	domain.HardwareAssetRepresentationThumbnail: 16 << 20,
}

// SetHardwareAssetLimits overrides the per-representation byte caps from
// configuration. Unknown representations are ignored; non-positive values
// fall back to the default.
func (s *Server) SetHardwareAssetLimits(limits map[domain.HardwareAssetRepresentation]int64) {
	if s.hardwareAssetLimits == nil {
		s.hardwareAssetLimits = map[domain.HardwareAssetRepresentation]int64{}
	}
	for rep, maxBytes := range limits {
		if maxBytes > 0 {
			s.hardwareAssetLimits[rep] = maxBytes
		}
	}
}

func (s *Server) hardwareAssetLimit(rep domain.HardwareAssetRepresentation) int64 {
	if max, ok := s.hardwareAssetLimits[rep]; ok && max > 0 {
		return max
	}
	return defaultHardwareAssetLimits[rep]
}

func respondWithHardwareAssetError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrHardwareAssetNotFound),
		errors.Is(err, domain.ErrHardwareAssetRevisionNotFound),
		errors.Is(err, domain.ErrHardwareAssetSessionNotFound):
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound,
			"El recurso, la revisión o la sesión de carga no existen", nil)
	case errors.Is(err, domain.ErrHardwareAssetSessionNotPrepared):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict,
			"La sesión de carga ya no está activa; iniciá una carga nueva", nil)
	case errors.Is(err, domain.ErrHardwareAssetBytesMissing):
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest,
			"Falta subir los bytes del recurso antes de finalizar", nil)
	case errors.Is(err, domain.ErrHardwareAssetIntegrityMismatch):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeArtifactIntegrityMismatch,
			"Los bytes almacenados no coinciden con la carga registrada; subí el archivo de nuevo", nil)
	case errors.Is(err, domain.ErrHardwareAssetRetired):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict,
			"El recurso está retirado y no puede asociarse a nuevas selecciones", nil)
	case errors.Is(err, domain.ErrHardwareAssetBindingInvalid),
		errors.Is(err, domain.ErrHardwareAssetInvalid):
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, err.Error(), nil)
	default:
		respondWithInternalError(w, err, "hardware asset")
	}
}

func toHardwareAssetOriginDTO(o *domain.HardwareAssetOrigin) *openapi.HardwareAssetOrigin {
	if o == nil {
		return nil
	}
	dto := &openapi.HardwareAssetOrigin{
		SourceUnits: o.SourceUnits,
		UpAxis:      o.UpAxis,
	}
	if o.AnchorOffsetMm != nil {
		dto.AnchorOffsetMm = &openapi.HardwareAssetAnchor{
			XMm: o.AnchorOffsetMm.XMm,
			YMm: o.AnchorOffsetMm.YMm,
			ZMm: o.AnchorOffsetMm.ZMm,
		}
	}
	return dto
}

func originDomainFromDTO(dto *openapi.HardwareAssetOrigin) (json.RawMessage, error) {
	if dto == nil {
		return nil, nil
	}
	o := domain.HardwareAssetOrigin{SourceUnits: dto.SourceUnits, UpAxis: dto.UpAxis}
	if dto.AnchorOffsetMm != nil {
		o.AnchorOffsetMm = &domain.HardwareAssetAnchor{
			XMm: dto.AnchorOffsetMm.XMm,
			YMm: dto.AnchorOffsetMm.YMm,
			ZMm: dto.AnchorOffsetMm.ZMm,
		}
	}
	raw, err := json.Marshal(o)
	if err != nil {
		return nil, fmt.Errorf("%w: origin: %v", domain.ErrHardwareAssetInvalid, err)
	}
	// Domain validation owns the finite/bounded/explicit-units rules.
	if _, err := domain.ValidateHardwareAssetOrigin(raw); err != nil {
		return nil, err
	}
	return raw, nil
}

func toHardwareAssetRevisionDTO(r domain.HardwareAssetRevision) openapi.HardwareAssetRevision {
	dto := openapi.HardwareAssetRevision{
		ID:                  r.ID,
		AssetID:             r.AssetID,
		RevisionNumber:      int64(r.RevisionNumber),
		Representation:      openapi.HardwareAssetRepresentation(r.Representation),
		ContentType:         r.ContentType,
		SizeBytes:           r.SizeBytes,
		Sha256:              r.SHA256,
		IntegrityVerifiedAt: r.IntegrityVerifiedAt.UTC().Format(time.RFC3339Nano),
		ValidationState:     openapi.HardwareAssetValidationState(r.ValidationState),
		CreatedAt:           r.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
	if r.Origin != nil {
		dto.Origin = toHardwareAssetOriginDTO(r.Origin)
	}
	return dto
}

func toHardwareAssetDTO(a domain.HardwareAsset) openapi.HardwareAsset {
	dto := openapi.HardwareAsset{
		ID:          a.ID,
		DisplayName: a.DisplayName,
		Status:      openapi.HardwareAssetStatus(a.Status),
		Revisions:   make([]openapi.HardwareAssetRevision, 0, len(a.Revisions)),
		CreatedAt:   a.CreatedAt.UTC().Format(time.RFC3339Nano),
		UpdatedAt:   a.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
	if a.Provenance != "" {
		dto.Provenance = &a.Provenance
	}
	if a.License != "" {
		dto.License = &a.License
	}
	for _, r := range a.Revisions {
		dto.Revisions = append(dto.Revisions, toHardwareAssetRevisionDTO(r))
	}
	return dto
}

func toHardwareAssetSessionDTO(sess domain.HardwareAssetUploadSession) openapi.HardwareAssetUploadSession {
	dto := openapi.HardwareAssetUploadSession{
		ID:             sess.ID,
		Representation: openapi.HardwareAssetRepresentation(sess.Representation),
		DisplayName:    sess.DisplayName,
		Status:         sess.Status,
		CreatedAt:      sess.CreatedAt.UTC().Format(time.RFC3339Nano),
		ExpiresAt:      sess.ExpiresAt.UTC().Format(time.RFC3339Nano),
	}
	if sess.Provenance != "" {
		dto.Provenance = &sess.Provenance
	}
	if sess.License != "" {
		dto.License = &sess.License
	}
	if sess.Origin != nil {
		dto.Origin = toHardwareAssetOriginDTO(sess.Origin)
	}
	if sess.Staged != nil {
		dto.Staged = &openapi.HardwareAssetUploadStaged{
			ContentType: sess.Staged.ContentType,
			SizeBytes:   sess.Staged.SizeBytes,
			Sha256:      sess.Staged.SHA256,
		}
	}
	if sess.TargetAssetID != nil {
		dto.TargetAssetID = sess.TargetAssetID
	}
	if sess.FinalizedAssetID != nil {
		dto.FinalizedAssetID = sess.FinalizedAssetID
	}
	if sess.FinalizedRevisionID != nil {
		dto.FinalizedRevisionID = sess.FinalizedRevisionID
	}
	return dto
}

// HandleHardwareAssetUploadStart: POST /api/hardware-assets/uploads.
func (s *Server) HandleHardwareAssetUploadStart(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanMutateCatalog), "no tenés permiso para administrar recursos del catálogo") {
		return
	}
	var body openapi.StartHardwareAssetUploadRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	representation := domain.HardwareAssetRepresentation(body.Representation)
	originRaw, err := originDomainFromDTO(body.Origin)
	if err != nil {
		respondWithHardwareAssetError(w, err)
		return
	}
	var provenance, license string
	if body.Provenance != nil {
		provenance = *body.Provenance
	}
	if body.License != nil {
		license = *body.License
	}
	var targetAssetID string
	if body.AssetID != nil {
		targetAssetID = *body.AssetID
	}
	result, err := s.Store.CreateHardwareAssetUploadSession(r.Context(), storage.CreateHardwareAssetUploadSessionCommand{
		Representation: representation,
		DisplayName:    body.DisplayName,
		Provenance:     provenance,
		License:        license,
		Origin:         originRaw,
		TargetAssetID:  targetAssetID,
		ActorUserID:    claims.UserID,
	})
	if err != nil {
		respondWithHardwareAssetError(w, err)
		return
	}
	// Best-effort removal of files staged by sessions abandoned in the lazy
	// expiry sweep (documented orphan-collection strategy).
	for _, key := range result.AbandonedStagedKeys {
		s.removeHardwareAssetFile(r.Context(), key)
	}
	respondWithJSON(w, http.StatusCreated, toHardwareAssetSessionDTO(*result.Session))
}

// HandleHardwareAssetUploadGet: GET /api/hardware-assets/uploads/{sessionId}.
func (s *Server) HandleHardwareAssetUploadGet(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	sess, err := s.Store.GetHardwareAssetUploadSession(r.Context(), r.PathValue("sessionId"))
	if err != nil {
		respondWithHardwareAssetError(w, err)
		return
	}
	respondWithJSON(w, http.StatusOK, toHardwareAssetSessionDTO(*sess))
}

// hardwareAssetStoragePath resolves a hardware asset storage key under its
// owning organization partition. The key must be canonical
// (server-generated shape) — anything else is refused before touching disk.
func (s *Server) hardwareAssetStoragePath(ownerOrgID, storageKey string) (string, bool) {
	if strings.TrimSpace(s.MediaDir) == "" || strings.TrimSpace(ownerOrgID) == "" || auth.HardwareAssetResourceKey(storageKey) == "" {
		return "", false
	}
	path := filepath.Join(s.MediaDir, ownerOrgID, filepath.FromSlash(storageKey))
	cleanRoot := filepath.Clean(s.MediaDir)
	if !strings.HasPrefix(filepath.Clean(path), cleanRoot+string(os.PathSeparator)) {
		return "", false
	}
	return path, true
}

// removeHardwareAssetFile deletes one staged asset file best-effort
// (idempotent; IO errors are logged, never propagated).
func (s *Server) removeHardwareAssetFile(ctx context.Context, storageKey string) {
	path, ok := s.hardwareAssetStoragePath(storage.OrgFromCtx(ctx), storageKey)
	if !ok {
		return
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		slog.Warn("hardware asset cleanup: failed to remove file", "path", path, "error", err)
	}
}

// HandleHardwareAssetUploadBytes: PUT (multipart) /api/hardware-assets/uploads/{sessionId}/bytes.
// Streams the file into the organization media namespace while computing
// SHA-256 and size server-side; re-upload replaces the staged bytes. The
// endpoint stays outside the generated OpenAPI surface, same as design
// publish artifacts and catalog media.
func (s *Server) HandleHardwareAssetUploadBytes(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanMutateCatalog), "no tenés permiso para administrar recursos del catálogo") {
		return
	}
	if strings.TrimSpace(s.MediaDir) == "" {
		respondWithError(w, http.StatusServiceUnavailable, "almacenamiento de recursos no configurado")
		return
	}
	sessionID := r.PathValue("sessionId")
	representation := domain.HardwareAssetRepresentation(r.PathValue("representation"))
	if !isValidUUID(sessionID) || !domain.IsValidHardwareAssetRepresentation(representation) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "ruta de carga inválida", nil)
		return
	}

	// The session gates every upload: prepared, unexpired, this organization.
	sess, err := s.Store.GetHardwareAssetUploadSession(r.Context(), sessionID)
	if err != nil {
		respondWithHardwareAssetError(w, err)
		return
	}
	if sess.Status != "prepared" {
		respondWithHardwareAssetError(w, domain.ErrHardwareAssetSessionNotPrepared)
		return
	}
	if !time.Now().Before(sess.ExpiresAt) {
		respondWithHardwareAssetError(w, domain.ErrHardwareAssetSessionNotPrepared)
		return
	}

	maxBytes := s.hardwareAssetLimit(representation)
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes+1<<20)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		respondWithError(w, http.StatusRequestEntityTooLarge,
			"archivo demasiado grande (máx "+fmt.Sprintf("%d MB", maxBytes>>20)+")")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "falta el archivo (campo file)")
		return
	}
	defer file.Close()

	// Inspect the content: sniffed type + format-specific demonstrable checks.
	// A declared MIME/extension alone is never validation (spec §5).
	buf := make([]byte, 512)
	n, _ := io.ReadFull(file, buf)
	sniffed := http.DetectContentType(buf[:n])
	var contentType, ext string
	switch representation {
	case domain.HardwareAssetRepresentationSKP:
		// .skp is an opaque binary container: the server cannot and does not
		// parse it. Host compatibility validation is #668 and stays pending.
		if !strings.HasSuffix(strings.ToLower(header.Filename), ".skp") {
			respondWithError(w, http.StatusBadRequest, "el recurso SKP debe ser un archivo .skp")
			return
		}
		contentType, ext = "application/octet-stream", ".skp"
	case domain.HardwareAssetRepresentationGLB:
		// Binary glTF carries its own 4-byte magic; anything else is refused
		// before any GLB semantics are claimed (full validation is #669).
		if n < 4 || string(buf[:4]) != "glTF" {
			respondWithError(w, http.StatusBadRequest, "el recurso GLB debe ser un binario glTF (firma glTF)")
			return
		}
		if !strings.HasSuffix(strings.ToLower(header.Filename), ".glb") {
			respondWithError(w, http.StatusBadRequest, "el recurso GLB debe ser un archivo .glb")
			return
		}
		contentType, ext = "model/gltf-binary", ".glb"
	case domain.HardwareAssetRepresentationThumbnail:
		switch sniffed {
		case "image/png":
			contentType, ext = "image/png", ".png"
		case "image/jpeg":
			contentType, ext = "image/jpeg", ".jpg"
		case "image/webp":
			contentType, ext = "image/webp", ".webp"
		default:
			respondWithError(w, http.StatusBadRequest, "la miniatura debe ser una imagen PNG, JPEG o WebP")
			return
		}
	}

	// Stream to a temp file in the session namespace while hashing.
	orgDir := filepath.Join(s.MediaDir, storage.OrgFromCtx(r.Context()), "hardware-assets", sessionID)
	if err := os.MkdirAll(orgDir, 0o750); err != nil {
		respondWithInternalError(w, err, "hardware asset mkdir")
		return
	}
	tmp, err := os.CreateTemp(orgDir, ".upload-*")
	if err != nil {
		respondWithInternalError(w, err, "hardware asset temp")
		return
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	hasher := sha256.New()
	size := int64(0)
	if n > 0 {
		if _, err := tmp.Write(buf[:n]); err != nil {
			tmp.Close()
			respondWithInternalError(w, err, "hardware asset write")
			return
		}
		hasher.Write(buf[:n])
		size += int64(n)
	}
	written, copyErr := io.Copy(io.MultiWriter(tmp, hasher), file)
	if closeErr := tmp.Close(); closeErr != nil {
		respondWithInternalError(w, closeErr, "hardware asset write")
		return
	}
	if copyErr != nil {
		respondWithAPIError(w, http.StatusRequestEntityTooLarge, openapi.ApiErrorCodeBadRequest,
			"archivo demasiado grande (máx "+fmt.Sprintf("%d MB", maxBytes>>20)+")", nil)
		return
	}
	size += written
	if size <= 0 || size > maxBytes {
		respondWithAPIError(w, http.StatusRequestEntityTooLarge, openapi.ApiErrorCodeBadRequest,
			"archivo demasiado grande (máx "+fmt.Sprintf("%d MB", maxBytes>>20)+")", nil)
		return
	}
	sum := hasher.Sum(nil)
	sha := "sha256-" + hex.EncodeToString(sum)
	storageKey := fmt.Sprintf("hardware-assets/%s/%s-%s%s", sessionID, representation, hex.EncodeToString(sum[:6]), ext)
	destPath, ok := s.hardwareAssetStoragePath(storage.OrgFromCtx(r.Context()), storageKey)
	if !ok {
		respondWithError(w, http.StatusBadRequest, "ruta inválida")
		return
	}
	if err := os.Rename(tmpPath, destPath); err != nil {
		respondWithInternalError(w, err, "hardware asset store")
		return
	}

	replacedKey := ""
	if sess.Staged != nil && sess.Staged.StorageKey != storageKey {
		replacedKey = sess.Staged.StorageKey
	}
	if err := s.Store.RecordHardwareAssetSessionBytes(r.Context(), storage.RecordHardwareAssetSessionBytesCommand{
		SessionID:   sessionID,
		StorageKey:  storageKey,
		ContentType: contentType,
		SizeBytes:   size,
		SHA256:      sha,
	}); err != nil {
		// Keep the namespace clean: the staging row is the metadata truth.
		s.removeHardwareAssetFile(r.Context(), storageKey)
		respondWithHardwareAssetError(w, err)
		return
	}
	if replacedKey != "" {
		s.removeHardwareAssetFile(r.Context(), replacedKey)
	}

	respondWithJSON(w, http.StatusOK, openapi.HardwareAssetUploadStaged{
		ContentType: contentType,
		SizeBytes:   size,
		Sha256:      sha,
	})
}

// HandleHardwareAssetUploadFinalize: POST /api/hardware-assets/uploads/{sessionId}:finalize.
// Behind RequireIdempotency at the route level. Belt and braces: the staged
// FILE is re-hashed streaming and compared with the staged metadata before
// the transactional finalize creates the immutable revision — a partial or
// tampered upload can never read as a finished asset.
func (s *Server) HandleHardwareAssetUploadFinalize(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanMutateCatalog), "no tenés permiso para administrar recursos del catálogo") {
		return
	}
	sessionID := r.PathValue("sessionId")
	sess, err := s.Store.GetHardwareAssetUploadSession(r.Context(), sessionID)
	if err != nil {
		respondWithHardwareAssetError(w, err)
		return
	}
	if sess.Status == "prepared" && sess.Staged != nil {
		path, ok := s.hardwareAssetStoragePath(sess.OrganizationID, sess.Staged.StorageKey)
		if !ok {
			respondWithHardwareAssetError(w, domain.ErrHardwareAssetBytesMissing)
			return
		}
		if err := verifyHardwareAssetFile(path, sess.Staged.SizeBytes, sess.Staged.SHA256); err != nil {
			respondWithHardwareAssetError(w, err)
			return
		}
	}
	asset, err := s.Store.FinalizeHardwareAssetUpload(r.Context(), storage.FinalizeHardwareAssetUploadCommand{
		SessionID:   sessionID,
		ActorUserID: claims.UserID,
		IP:          clientIP(r),
		RequestID:   RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithHardwareAssetError(w, err)
		return
	}
	respondWithJSON(w, http.StatusCreated, toHardwareAssetDTO(*asset))
}

// verifyHardwareAssetFile re-computes size + SHA-256 streaming and compares
// them with the staged metadata (server-side evidence, never client claim).
func verifyHardwareAssetFile(path string, expectedSize int64, expectedSHA string) error {
	f, err := os.Open(path)
	if err != nil {
		return domain.ErrHardwareAssetBytesMissing
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil || stat.IsDir() || stat.Size() != expectedSize {
		return domain.ErrHardwareAssetBytesMissing
	}
	hasher := sha256.New()
	readSize, err := io.Copy(hasher, f)
	if err != nil || readSize != expectedSize {
		return domain.ErrHardwareAssetBytesMissing
	}
	if actual := "sha256-" + hex.EncodeToString(hasher.Sum(nil)); actual != expectedSHA {
		return domain.ErrHardwareAssetIntegrityMismatch
	}
	return nil
}

// HandleHardwareAssetUploadCancel: POST /api/hardware-assets/uploads/{sessionId}:cancel.
func (s *Server) HandleHardwareAssetUploadCancel(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanMutateCatalog), "no tenés permiso para administrar recursos del catálogo") {
		return
	}
	sessionID := r.PathValue("sessionId")
	sess, err := s.Store.GetHardwareAssetUploadSession(r.Context(), sessionID)
	if err != nil {
		respondWithHardwareAssetError(w, err)
		return
	}
	if err := s.Store.CancelHardwareAssetUploadSession(r.Context(), storage.CancelHardwareAssetUploadSessionCommand{
		SessionID:   sessionID,
		ActorUserID: claims.UserID,
	}); err != nil {
		respondWithHardwareAssetError(w, err)
		return
	}
	if sess.Staged != nil {
		s.removeHardwareAssetFile(r.Context(), sess.Staged.StorageKey)
	}
	updated, err := s.Store.GetHardwareAssetUploadSession(r.Context(), sessionID)
	if err != nil {
		respondWithHardwareAssetError(w, err)
		return
	}
	respondWithJSON(w, http.StatusOK, toHardwareAssetSessionDTO(*updated))
}

// HandleHardwareAssets: GET /api/hardware-assets.
func (s *Server) HandleHardwareAssets(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	assets, err := s.Store.ListHardwareAssets(r.Context())
	if err != nil {
		respondWithHardwareAssetError(w, err)
		return
	}
	dtos := make([]openapi.HardwareAsset, 0, len(assets))
	for _, a := range assets {
		dtos = append(dtos, toHardwareAssetDTO(a))
	}
	respondWithJSON(w, http.StatusOK, dtos)
}

// HandleHardwareAssetByID: GET /api/hardware-assets/{assetId}.
func (s *Server) HandleHardwareAssetByID(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	asset, err := s.Store.GetHardwareAsset(r.Context(), r.PathValue("assetId"))
	if err != nil {
		respondWithHardwareAssetError(w, err)
		return
	}
	respondWithJSON(w, http.StatusOK, toHardwareAssetDTO(*asset))
}

// HandleHardwareAssetRetire: POST /api/hardware-assets/{assetId}:retire.
// Behind RequireIdempotency at the route level.
func (s *Server) HandleHardwareAssetRetire(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanMutateCatalog), "no tenés permiso para administrar recursos del catálogo") {
		return
	}
	assetID := r.PathValue("assetId")
	if err := s.Store.RetireHardwareAsset(r.Context(), storage.RetireHardwareAssetCommand{
		AssetID:     assetID,
		ActorUserID: claims.UserID,
		IP:          clientIP(r),
		RequestID:   RequestIDFromContext(r.Context()),
	}); err != nil {
		respondWithHardwareAssetError(w, err)
		return
	}
	asset, err := s.Store.GetHardwareAsset(r.Context(), assetID)
	if err != nil {
		respondWithHardwareAssetError(w, err)
		return
	}
	respondWithJSON(w, http.StatusOK, toHardwareAssetDTO(*asset))
}

// HandleHardwareAssetRevisionAuthorize: POST /api/hardware-assets/{assetId}/revisions/{revisionId}:authorize.
// Mints a short-lived signed read for exactly one revision — minted ONLY
// after the bytes are observed to exist and match the persisted metadata
// (#640 fail-closed authorization pattern). No session credential rides the
// URL; the plugin consumes the same grant mechanism (never web JWTs).
func (s *Server) HandleHardwareAssetRevisionAuthorize(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if s.MediaTokens == nil {
		respondWithError(w, http.StatusServiceUnavailable, "firma de medios no configurada")
		return
	}
	revision, err := s.Store.GetHardwareAssetRevision(r.Context(), r.PathValue("assetId"), r.PathValue("revisionId"))
	if err != nil {
		respondWithHardwareAssetError(w, err)
		return
	}
	path, ok := s.hardwareAssetStoragePath(revision.OrganizationID, revision.StorageKey)
	if !ok {
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeArtifactMissing,
			"El recurso publicado ya no está disponible en el almacenamiento", nil)
		return
	}
	// Fail-closed authorization (#640 pattern): the grant is minted only after
	// the backing bytes are observed to exist and match the persisted digest.
	if err := verifyHardwareAssetFile(path, revision.SizeBytes, revision.SHA256); err != nil {
		switch {
		case errors.Is(err, domain.ErrHardwareAssetIntegrityMismatch):
			respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeArtifactIntegrityMismatch,
				"Los bytes almacenados no coinciden con la revisión publicada", nil)
		default:
			respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeArtifactMissing,
				"El recurso publicado ya no está disponible en el almacenamiento", nil)
		}
		return
	}
	resourceKey := auth.HardwareAssetResourceKey(revision.StorageKey)
	if resourceKey == "" {
		respondWithInternalError(w, fmt.Errorf("non-canonical asset storage key"), "hardware asset grant")
		return
	}
	expectedSize := revision.SizeBytes
	signed, mc, err := s.MediaTokens.Issue(auth.MediaIssueRequest{
		ResourceKey:       resourceKey,
		OrgID:             revision.OrganizationID,
		SessionID:         claims.Sid,
		UserID:            claims.UserID,
		AbsoluteCap:       mediaGrantAbsoluteCap(claims),
		ExpectedSizeBytes: &expectedSize,
		ExpectedSHA256:    revision.SHA256,
	})
	if err != nil {
		respondWithInternalError(w, err, "hardware asset grant issue")
		return
	}
	respondWithJSON(w, http.StatusOK, openapi.HardwareAssetRevisionGrant{
		Representation: openapi.HardwareAssetRepresentation(revision.Representation),
		Sha256:         revision.SHA256,
		SizeBytes:      revision.SizeBytes,
		URL:            "/api/hardware-assets/files/" + revision.StorageKey + "?grant=" + signed,
		ExpiresAt:      mc.ExpiresAt.UTC().Format(time.RFC3339Nano),
	})
}

type hardwareAssetReadPins struct {
	ownerOrgID        string
	expectedSizeBytes int64
	expectedSHA256    string
}

type hardwareAssetReadPinsKey struct{}

// hardwareAssetFileGetAuth accepts only a short-lived grant minted after the
// tenant-authorized revision lookup. A bearer token alone cannot bind this
// storage key to exact immutable metadata and therefore fails closed.
func (s *Server) hardwareAssetFileGetAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			noStore(w)
			respondWithAPIError(w, http.StatusUnauthorized, openapi.ApiErrorCodeUnauthorized,
				"signed asset grant required", nil)
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
				"media grant required", nil)
			return
		}
		claims, err := s.MediaTokens.Validate(grant)
		if err != nil {
			noStore(w)
			if errors.Is(err, auth.ErrMediaTokenExpired) {
				respondWithAPIError(w, http.StatusUnauthorized, openapi.ApiErrorCodeMediaAccessExpired,
					"el acceso al recurso expiró; volvé a autorizarlo", nil)
			} else {
				respondWithAPIError(w, http.StatusUnauthorized, openapi.ApiErrorCodeMediaAccessInvalid,
					"acceso al recurso inválido", nil)
			}
			return
		}
		// Exact-resource binding: a valid grant pointed at another asset is
		// indistinguishable from a missing one.
		if auth.HardwareAssetKeyFromResource(claims.Resource) != r.PathValue("key") {
			noStore(w)
			respondWithError(w, http.StatusNotFound, "not found")
			return
		}
		if claims.ExpectedSizeBytes == nil || claims.ExpectedSHA256 == "" {
			noStore(w)
			respondWithError(w, http.StatusNotFound, "not found")
			return
		}
		ctx := storage.WithOrgCtx(r.Context(), claims.OrgID)
		ctx = context.WithValue(ctx, hardwareAssetReadPinsKey{}, hardwareAssetReadPins{
			ownerOrgID:        claims.OrgID,
			expectedSizeBytes: *claims.ExpectedSizeBytes,
			expectedSHA256:    claims.ExpectedSHA256,
		})
		ctx = context.WithValue(ctx, mediaGrantRemainingKey{}, time.Until(claims.ExpiresAt.Time))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// HandleHardwareAssetFileGet: GET /api/hardware-assets/files/{key} — streams
// one asset revision from the caller's organization partition, re-verifying
// size + digest per read (fail closed on any mismatch).
func (s *Server) HandleHardwareAssetFileGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	key := r.PathValue("key")
	if auth.HardwareAssetResourceKey(key) == "" {
		respondWithError(w, http.StatusBadRequest, "clave de recurso inválida")
		return
	}
	if strings.TrimSpace(s.MediaDir) == "" {
		respondWithError(w, http.StatusNotFound, "not found")
		return
	}
	pins, ok := r.Context().Value(hardwareAssetReadPinsKey{}).(hardwareAssetReadPins)
	if !ok {
		respondWithError(w, http.StatusNotFound, "not found")
		return
	}
	path, ok := s.hardwareAssetStoragePath(pins.ownerOrgID, key)
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
	if err != nil || stat.IsDir() || stat.Size() != pins.expectedSizeBytes {
		respondWithError(w, http.StatusNotFound, "not found")
		return
	}
	hasher := sha256.New()
	readSize, err := io.Copy(hasher, f)
	actualSHA := "sha256-" + hex.EncodeToString(hasher.Sum(nil))
	if err != nil || readSize != pins.expectedSizeBytes || actualSHA != pins.expectedSHA256 {
		respondWithError(w, http.StatusNotFound, "not found")
		return
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		respondWithError(w, http.StatusNotFound, "not found")
		return
	}

	name := filepath.Base(key)
	switch strings.ToLower(filepath.Ext(name)) {
	case ".skp":
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", `attachment; filename="asset.skp"`)
	case ".glb":
		w.Header().Set("Content-Type", "model/gltf-binary")
		w.Header().Set("Content-Disposition", `attachment; filename="asset.glb"`)
	case ".png":
		w.Header().Set("Content-Type", "image/png")
	case ".jpg", ".webp":
		w.Header().Set("Content-Type", "image/"+strings.TrimPrefix(strings.ToLower(filepath.Ext(name)), "."))
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
	w.Header().Set("Cache-Control", "private, max-age="+fmt.Sprintf("%d", maxAge))
	w.Header().Add("Vary", "Authorization")
	http.ServeContent(w, r, name, stat.ModTime(), f)
}

// resolveHardwareVisualBindingForWrite validates a hardware payload's visual
// binding before persistence: the exact revision must exist in this
// organization, belong to the named asset, and the asset must be active.
// The resolved facts (representation/digest/validation) replace whatever the
// client echoed — the server is the only source for them.
func (s *Server) resolveHardwareVisualBindingForWrite(r *http.Request, w http.ResponseWriter, h *domain.Hardware) bool {
	if h.VisualAsset == nil {
		return true
	}
	binding, err := s.Store.ResolveHardwareVisualAssetBinding(r.Context(), h.VisualAsset.AssetID, h.VisualAsset.AssetRevisionID)
	if err != nil {
		respondWithHardwareAssetError(w, err)
		return false
	}
	h.VisualAsset = binding
	return true
}
