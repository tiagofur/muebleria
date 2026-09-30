package api

import (
	"net/http"

	"github.com/tiagofur/muebles-backend/internal/domain"
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
		Code: code, Message: message, FieldErrors: map[string]string{}, RequestId: requestIDFromWriter(w),
		Retryable: status >= 500, Details: details,
	})
}

// respondWithParameterDefinitionIssues answers every rejected typed-parameter
// write with the same 422 envelope the furniture read surface uses, so web and
// SketchUp clients share one error contract for PARAMETER_DEFINITION_INVALID.
func respondWithParameterDefinitionIssues(w http.ResponseWriter, issues []domain.FurnitureParameterDefinitionIssue) {
	respondWithJSON(w, http.StatusUnprocessableEntity, map[string]any{
		"code": "PARAMETER_DEFINITION_INVALID", "message": "furniture parameter definition is invalid", "issues": issues,
	})
}
