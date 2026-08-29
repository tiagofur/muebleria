package api

import (
	"net/http"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
)

func defaultErrorCode(status int) openapi.ApiErrorCode {
	switch status {
	case http.StatusBadRequest, http.StatusRequestEntityTooLarge:
		return openapi.ApiErrorCodeBadRequest
	case http.StatusUnauthorized:
		return openapi.ApiErrorCodeUnauthorized
	case http.StatusForbidden:
		return openapi.ApiErrorCodeForbidden
	case http.StatusNotFound:
		return openapi.ApiErrorCodeNotFound
	case http.StatusMethodNotAllowed:
		return openapi.ApiErrorCodeMethodNotAllowed
	case http.StatusConflict:
		return openapi.ApiErrorCodeConflict
	case http.StatusPreconditionFailed:
		return openapi.ApiErrorCodeVersionConflict
	case http.StatusPreconditionRequired:
		return openapi.ApiErrorCodePreconditionRequired
	default:
		return openapi.ApiErrorCodeInternalError
	}
}

func respondWithAPIError(w http.ResponseWriter, status int, code openapi.ApiErrorCode, message string, details map[string]any) {
	if details == nil {
		details = map[string]any{}
	}
	respondWithJSON(w, status, openapi.ApiError{
		Code: code, Message: message, FieldErrors: map[string]any{}, RequestId: requestIDFromWriter(w),
		Retryable: status >= 500, Details: details,
	})
}
