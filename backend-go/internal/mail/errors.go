package mail

import (
	"errors"
	"fmt"
	"net"
	"net/textproto"
)

// SendError marks the SMTP stage that failed. Its wrapped error may echo
// the recipient (server replies often do), so it is never persisted or
// logged as-is: use Classify.
type SendError struct {
	Stage string
	Err   error
}

func (e *SendError) Error() string { return "smtp: " + e.Stage + ": " + e.Err.Error() }
func (e *SendError) Unwrap() error { return e.Err }

func stageError(stage string, err error) error { return &SendError{Stage: stage, Err: err} }

// InvalidMessageError is a message the transport can never send.
type InvalidMessageError struct{ Err error }

func (e *InvalidMessageError) Error() string { return "mail: invalid message: " + e.Err.Error() }
func (e *InvalidMessageError) Unwrap() error { return e.Err }

// Classify reduces a send failure to a summary safe to store and log (stage
// plus SMTP reply code or failure class — never the server's reply text,
// the recipient or the body) and tells whether retrying is pointless.
//
// Only a 5xx at RCPT/DATA is permanent: it is about this message. A 5xx at
// AUTH or MAIL FROM is a configuration problem the operator can fix, so the
// message keeps retrying until its credential expires.
func Classify(err error) (summary string, permanent bool) {
	if err == nil {
		return "", false
	}
	var invalid *InvalidMessageError
	if errors.As(err, &invalid) {
		return "mensaje inválido", true
	}
	stage := "envío"
	var sendErr *SendError
	if errors.As(err, &sendErr) {
		stage = sendErr.Stage
	}
	var reply *textproto.Error
	if errors.As(err, &reply) {
		permanent = reply.Code >= 500 && reply.Code < 600 && (stage == "rcpt" || stage == "data" || stage == "close data")
		return fmt.Sprintf("smtp %s: respuesta %d", stage, reply.Code), permanent
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return fmt.Sprintf("smtp %s: tiempo de espera agotado", stage), false
	}
	return fmt.Sprintf("smtp %s: error de conexión o TLS", stage), false
}
