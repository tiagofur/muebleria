package mail

import (
	"fmt"
	"html"
	"strings"
	"time"
)

// PasswordResetMessage renders the Spanish reset email (plain text + simple
// HTML). link must be absolute; expiresAt is shown in the given zone.
func PasswordResetMessage(to, link string, expiresAt time.Time, loc *time.Location) Message {
	if loc == nil {
		loc = time.UTC
	}
	when := expiresAt.In(loc).Format("02/01/2006 15:04 MST")
	text := strings.Join([]string{
		"Hola,",
		"",
		"Recibimos un pedido para restablecer tu contraseña de Granete.",
		"Abrí este enlace para elegir una nueva (sirve una sola vez):",
		"",
		link,
		"",
		fmt.Sprintf("El enlace vence el %s.", when),
		"Si no pediste este cambio, ignorá este correo: tu contraseña sigue igual.",
		"",
		"— Granete",
	}, "\n")
	htmlBody := fmt.Sprintf(`<p>Hola,</p>
<p>Recibimos un pedido para restablecer tu contraseña de Granete.</p>
<p><a href="%s">Elegir una nueva contraseña</a> (el enlace sirve una sola vez).</p>
<p>El enlace vence el %s.</p>
<p>Si no pediste este cambio, ignorá este correo: tu contraseña sigue igual.</p>
<p>— Granete</p>`, html.EscapeString(link), html.EscapeString(when))
	return Message{To: to, Subject: "Restablecer tu contraseña de Granete", Text: text, HTML: htmlBody}
}

// InvitationMessage renders the Spanish team invitation email.
func InvitationMessage(to, organizationName, link string, expiresAt time.Time, loc *time.Location) Message {
	if loc == nil {
		loc = time.UTC
	}
	when := expiresAt.In(loc).Format("02/01/2006 15:04 MST")
	// Names are user data: fold any line break so the subject stays one
	// header line (Validate would otherwise refuse the whole message).
	org := strings.Join(strings.Fields(organizationName), " ")
	if org == "" {
		org = "tu taller"
	}
	text := strings.Join([]string{
		"Hola,",
		"",
		fmt.Sprintf("Te invitaron a sumarte a %s en Granete.", org),
		"Abrí este enlace para aceptar la invitación:",
		"",
		link,
		"",
		fmt.Sprintf("La invitación vence el %s.", when),
		"Si no esperabas esta invitación, podés ignorar este correo.",
		"",
		"— Granete",
	}, "\n")
	htmlBody := fmt.Sprintf(`<p>Hola,</p>
<p>Te invitaron a sumarte a <strong>%s</strong> en Granete.</p>
<p><a href="%s">Aceptar la invitación</a></p>
<p>La invitación vence el %s.</p>
<p>Si no esperabas esta invitación, podés ignorar este correo.</p>
<p>— Granete</p>`, html.EscapeString(org), html.EscapeString(link), html.EscapeString(when))
	return Message{To: to, Subject: fmt.Sprintf("Invitación a %s en Granete", org), Text: text, HTML: htmlBody}
}

// QuoteMessage renders the Spanish email that carries the exact quote PDF
// (#1650). note is the seller's optional free text (plain; escaped in HTML).
func QuoteMessage(to, customerName, organizationName, projectName string, revisionNumber int, note string, pdf Attachment) Message {
	fold := func(s string) string { return strings.Join(strings.Fields(s), " ") }
	org := fold(organizationName)
	if org == "" {
		org = "tu taller"
	}
	customer := fold(customerName)
	greeting := "Hola,"
	if customer != "" {
		greeting = fmt.Sprintf("Hola %s,", customer)
	}
	project := fold(projectName)
	what := fmt.Sprintf("la cotización Q%d", revisionNumber)
	if project != "" {
		what = fmt.Sprintf("la cotización Q%d de «%s»", revisionNumber, project)
	}
	note = strings.TrimSpace(note)
	lines := []string{greeting, "", fmt.Sprintf("Te enviamos %s. Encontrás el PDF adjunto.", what)}
	htmlNote := ""
	if note != "" {
		lines = append(lines, "", note)
		htmlNote = "<p>" + strings.ReplaceAll(html.EscapeString(note), "\n", "<br>") + "</p>\n"
	}
	lines = append(lines, "", "— "+org)
	htmlBody := fmt.Sprintf(`<p>%s</p>
<p>Te enviamos %s. Encontrás el PDF adjunto.</p>
%s<p>— %s</p>`, html.EscapeString(greeting), html.EscapeString(what), htmlNote, html.EscapeString(org))
	return Message{
		To:          to,
		Subject:     fmt.Sprintf("Cotización Q%d — %s", revisionNumber, org),
		Text:        strings.Join(lines, "\n"),
		HTML:        htmlBody,
		Attachments: []Attachment{pdf},
	}
}
