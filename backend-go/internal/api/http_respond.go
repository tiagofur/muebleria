package api

// Contrato: plomería HTTP compartida — escritura de respuestas JSON/errores,
// decodificación acotada de bodies y mapeo de errores de creación de proyecto.
// Consumida por todos los handlers del paquete.

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/tiagofur/muebles-backend/internal/storage"
)

// maxJSONBodyBytes caps request bodies to avoid OOM from huge payloads (issue #20).
const maxJSONBodyBytes = 1 << 20 // 1 MiB

func respondWithError(w http.ResponseWriter, code int, message string) {
	respondWithAPIError(w, code, defaultErrorCode(code), message, nil)
}

func respondWithJSON(w http.ResponseWriter, code int, payload interface{}) {
	response, err := json.Marshal(payload)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("internal server error"))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	w.Write(response)
}

// respondWithInternalError logs the real error server-side via structured slog
// but returns a generic message to the client. Internal error strings (DB driver text,
// constraint names, etc.) must never reach the client (#5).
func respondWithInternalError(w http.ResponseWriter, err error, op string) {
	if total, denied := storage.RecordRLSDenial(err); denied {
		slog.Warn("postgres authorization denied", "op", op, "sqlstate", "42501", "rls_denial_total", total, "request_id", requestIDFromWriter(w))
		respondWithError(w, http.StatusInternalServerError, "error interno del servidor")
		return
	}
	slog.Error("internal server error", "op", op, "error", err, "request_id", requestIDFromWriter(w))
	respondWithError(w, http.StatusInternalServerError, "error interno del servidor")
}

// decodeJSONBody limits the request body and decodes JSON into dst.
// On failure it writes an error response and returns false (issue #20).
func decodeJSONBody(w http.ResponseWriter, r *http.Request, dst any) bool {
	return decodeJSONBodyWithPolicy(w, r, dst, false)
}

// decodeGeneratedJSONBody is the request-side counterpart of the generated
// response validator. It is intentionally used only by migrated OpenAPI
// operations so legacy endpoints keep their published compatibility surface.
func decodeGeneratedJSONBody(w http.ResponseWriter, r *http.Request, dst any) bool {
	return decodeJSONBodyWithPolicy(w, r, dst, true)
}

func decodeJSONBodyWithPolicy(w http.ResponseWriter, r *http.Request, dst any, rejectUnknown bool) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)
	dec := json.NewDecoder(r.Body)
	if rejectUnknown {
		dec.DisallowUnknownFields()
	}
	if err := dec.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			respondWithError(w, http.StatusRequestEntityTooLarge, "request body too large")
			return false
		}
		// EOF / unexpected EOF also map to invalid body.
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			respondWithError(w, http.StatusBadRequest, "invalid request body")
			return false
		}
		respondWithError(w, http.StatusBadRequest, "invalid request body")
		return false
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		respondWithError(w, http.StatusBadRequest, "request body must contain exactly one JSON value")
		return false
	}
	return true
}

// respondWithProjectCreateError maps project creation failures: duplicate
// customer → the neutral 404 also used for missing rows (never a cross-org
// oracle, #712 §8), anything else → 500.
func respondWithProjectCreateError(w http.ResponseWriter, err error) {
	if isDuplicateKey(err) {
		respondWithError(w, http.StatusConflict, "El registro ya existe")
		return
	}
	if errors.Is(err, storage.ErrCustomerNotFound) {
		respondWithError(w, http.StatusNotFound, "El cliente indicado no existe")
		return
	}
	respondWithInternalError(w, err, "handler")
}
