# Identity / Team / Organization endpoint source review

No requests, DB, tests, or security probes executed. Function/router semantics reviewed; storage invariants not universally re-proven.

## HandleRefreshCredential
Renovar credencial móvil por body

Público rate-limited; autoridad es refresh credential mobile; rechaza mezcla cookie/body.

JSON generado transport=mobile; shared performRefreshRotation con family/registry; errores tipados de rotación.

Rota credencial y devuelve nuevo refresh en body más expiración absoluta; no contrato Web.

Evidence: `backend-go/internal/api/refresh_handlers.go:115-139`, `backend-go/internal/api/refresh_handlers.go:31-107`, `backend-go/internal/api/routes.go:122-232`

## HandleWebCookieRefresh
Renovar acceso Web usando cookie HttpOnly

Cookie+Origin exacto+header CSRF antes de DB.

Shared rotation espera clientWeb; estados públicos terminales limpian cookie; error interno conserva credencial para retry.

Set-Cookie nuevo solo tras rotación exitosa; respuesta no entrega refresh secret en JSON.

Evidence: `backend-go/internal/api/refresh_handlers.go:154-171`, `backend-go/internal/api/routes.go:122-232`

## HandleLogout
Cerrar familia/sesión según transporte presentado

Body mobile o cookie Web con CSRF; mezcla rechazada; sin credencial éxito idempotente sin mutación.

JSON generado; verifier de refresh; malformed/unknown/revoked son no-op enumeration-safe; storage error 5xx.

Revoca antes de borrar cookie; fallo conserva cookie; logged_out true no implica que una credencial omitida haya sido revocada.

Evidence: `backend-go/internal/api/refresh_handlers.go:173-215`, `backend-go/internal/api/refresh_handlers.go:222-227`, `backend-go/internal/api/routes.go:122-232`

## HandleRefresh
Bridge legacy bodyless para SketchUp/support

authMW live registry; rechaza Web/mobile en este handler.

POST; user activo; conserva scope/roles/client; ver4 sin sid crea registry acotado al origen; token issuing distingue support.

Puede registrar upgrade session; emite acceso con sid y metadata de expiración, no rota familia Web/mobile.

Evidence: `backend-go/internal/api/handlers.go:890-994`, `backend-go/internal/api/routes.go:122-232`

## HandleMe
Read model autoritativo de identidad y scope actual

GET authMW; claims user válido/exp requerido; memberships por user.

Carga user/memberships y org; support valida org/status explícitamente. SessionScope.AbsoluteExpiresAt se construye de claims.ExpiresAt aquí, no lectura explícita de absolute_expires_at registry.

Solo lectura; devuelve roles, memberships, transport y scope, nunca bearer nuevo. Límite: revisar semántica expiry con tokens cortos antes de tratar campo como 18h absoluto.

Evidence: `backend-go/internal/api/handlers.go:2551-2622`, `backend-go/internal/api/routes.go:122-232`

## HandleListMFAFactors
Listar factores propios sin secretos

Sesión autenticada self user; no-store y rechazo de session query token en router.

UserID claims obligatorio; convierte rows a MFAFactorView con status/label/timestamps.

Lectura; no ciphertext, provisioning URI ni recovery codes en directory.

Evidence: `backend-go/internal/api/mfa.go:224-245`, `backend-go/internal/api/routes.go:122-232`

## HandleBeginMFAEnrollment
Iniciar factor TOTP pendiente

Sesión autenticada self user; no-store y rechazo de session query token en router.

requireFactorEnrollmentAuthority exige sid; primer factor bootstrap; si ya hay enabled exige security_admin fresh. Label trimmed≤120; secrets requeridos; genera y cifra secreto con kid.

Crea enrollment pending con TTL;201 entrega provisioning URI una vez; no-store.

Evidence: `backend-go/internal/api/mfa.go:248-309`, `backend-go/internal/api/mfa.go:189-221`, `backend-go/internal/api/routes.go:122-232`

## HandleVerifyMFAEnrollment
Verificar y habilitar factor pendiente

Sesión autenticada self user; no-store y rechazo de session query token en router.

Reejecuta authority tanto begin como verify; UUID factor/code normalizado; rate limiter por user; storage EnableMFAFactor recibe user+factor.

Habilita factor y responde recovery codes; errores typed no reflejan código.

Evidence: `backend-go/internal/api/mfa.go:318-366`, `backend-go/internal/api/mfa.go:189-221`, `backend-go/internal/api/routes.go:122-232`

## HandleRemoveMFAFactor
Revocar factor propio

Sesión autenticada self user; no-store y rechazo de session query token en router.

UUID factor; router exige security_admin step-up antes de idempotency; storage Revocation user-scoped.

Revoca factor y devuelve status; no DELETE físico afirmado.

Evidence: `backend-go/internal/api/mfa.go:370-392`, `backend-go/internal/api/routes.go:122-232`

## HandleRegenerateMFARecoveryCodes
Rotar recovery codes

Sesión autenticada self user; no-store y rechazo de session query token en router.

security_admin step-up router antes de idempotency; secrets requeridos y límite intentos user.

Regenera conjunto y devuelve nuevos codes solo en response.

Evidence: `backend-go/internal/api/mfa.go:396-426`, `backend-go/internal/api/routes.go:122-232`

## HandleMFAStepUp
Verificar segundo factor para scope exacto

Sesión autenticada self user; no-store y rechazo de session query token en router.

scope enum+method TOTP/recovery; sid obligatorio; normaliza según método; user rate limit; storage VerifyMFAStepUp ligado user+sid+scope.

Emite resultado scope/method/expires; grant es server-side, no claim nuevo de JWT.

Evidence: `backend-go/internal/api/mfa.go:429-497`, `backend-go/internal/api/routes.go:122-232`

## HandlePlatformUserCommand
Despachar cambio de account status global

PlatformAdminMiddleware + platform_admin step-up en router.

Solo suffix:set-account-status; fija userId; agrega idempotency específica. Handler destino requiere active|disabled y reason.

UpdateAccountStatus;404account missing; no cambio directo de roles/membership.

Evidence: `backend-go/internal/api/platform.go:263-271`, `backend-go/internal/api/platform.go:237-261`, `backend-go/internal/api/routes.go:122-232`

## HandlePlatformStartSupportSession
Abrir soporte auditado scoped a organización

platformMW + support_access step-up antes de idempotency; no-store.

Reason trimmed mínimo 4; application StartSupportSession exige status válido; missing/suspended404.

Crea support_session, registry support y token asociado con expiración. Atomicidad total depende transaction wrapper/service; no probar por secuencia de llamadas aislada.

Evidence: `backend-go/internal/api/platform.go:276-334`, `backend-go/internal/api/routes.go:122-232`

## HandlePlatformEndSupportSession
Finalizar soporte explícitamente

platformMW; actor user pasa a service con sessionId exacto.

ServiceEndSupportSession maneja target/actor; error interno 5xx; responde endedboolean.

Finalización mediante servicio/auditoría; no nueva credencial plataforma.

Evidence: `backend-go/internal/api/platform.go:337-354`, `backend-go/internal/api/routes.go:122-232`

## HandleAcceptInvitation
Onboarding Web por token de invitación

Público rate-limited; idempotency auth.accept-invitation; token+password son autoridad.

Body generado; token no vacío/password requerido; storage valida hash/password/estado exacto.404 invalid,410 expired/revoked/rotated,409 used/memberactive,401 credentials,400 password/name.

Acepta membership+identity; fresh Web registry/family; acceso capped y cookie HttpOnly; refresh no aparece en body. Mobile no contemplado.

Evidence: `backend-go/internal/api/platform.go:359-436`, `backend-go/internal/api/routes.go:122-232`

## HandleFactoryOrganizations
Listar organizaciones hijas conectadas legacy

requireFactoryAdmin valida factory+capability.

Solo GET; scope claims.OrgID en ListConnectedOrganizations.

Lectura DTO FactoryOrganization. No creación por este endpoint actual ni prueba Sales Network Gate B.

Evidence: `backend-go/internal/api/factory.go:87-106`, `backend-go/internal/api/factory.go:30-40`, `backend-go/internal/api/routes.go:122-232`

## HandleProvisionOrganization
Provisionar organización completa

authMW+idempotency; branch plataforma permite bootstrap/entitlements/source; else requireFactoryAdmin.

Name 1..120/type/plan/slug/RFC3339; platform bootstrap obligatorio. Factory solo store/dealer, license none, sin overrides, bootstrap caller y clone source factory.

OrganizationService crea settings/entitlements/bootstrap/catalog/readiness/audit transaccionales;201 result;503 sin command store; conflictos tipados.

Evidence: `backend-go/internal/api/organization_lifecycle.go:23-124`, `backend-go/internal/api/routes.go:122-232`

## HandleOrganizationReadiness
Consultar readiness versionado

platformMW; platformOrganizationContext autoriza ID al actor.

ServiceGetReadiness; errores typed; ETag organización.

Lectura de readiness; no transición a active por consultarla.

Evidence: `backend-go/internal/api/organization_lifecycle.go:197-216`, `backend-go/internal/api/routes.go:122-232`

## HandleOrganizationOffboardingPreview
Previsualizar impacto de baja organización

platformMW+context exacto del target.

ServicePreviewOffboarding; blockers/warnings con counts+impact_version; ETag orgversion.

Consulta; no harddelete ni transición.

Evidence: `backend-go/internal/api/organization_lifecycle.go:285-313`, `backend-go/internal/api/routes.go:122-232`

## HandleOrganizationEntitlements
Consultar/actualizar entitlements

GET platformMW;PUT platformMW+platform_admin step-up+idempotency.

GET context target,ETag version. PUT If-Match y body límites/capabilities; service valida dominio; errores conflicto.

GET read;PUT UpdateEntitlements y version, no licencia por usuario.

Evidence: `backend-go/internal/api/organization_lifecycle.go:315-359`, `backend-go/internal/api/routes.go:122-232`

## HandleOrganizationLifecycleCommand
Ejecutar suspend/reactivate/begin-offboarding/terminate

Cada suffix se despacha platformMW+platform_admin step-up+idempotency.

RequireIfMatch;reason obligatorio; offboarding/terminate además impactVersion; service valida estado/readiness/blockers.

Transición,credentialepochs,audit en servicio; ETag new version. Fallo ListOrgTeam del response queda memberCount 0; no afirmar count actual si lookup falla.

Evidence: `backend-go/internal/api/organization_lifecycle.go:218-283`, `backend-go/internal/api/routes.go:122-232`

## HandleChangeMembershipRoles
Cambiar roles de membership

authMW con capability Team y target membership de organización; idempotency por comando. organization_admin step-up antes de receipt.

Roles generados; RequireIfMatch; RolesAllowedInOrg; teamMutationTarget; store versión/last admin.

UpdateRoles+auditRequired; ETag; no users.role global.

Evidence: `backend-go/internal/api/orgteam.go:258-264`, `backend-go/internal/api/orgteam.go:266-302`, `backend-go/internal/api/routes.go:122-232`

## HandleSuspendMembership
suspender membership

authMW con capability Team y target membership de organización; idempotency por comando. Sin step-up en estas acciones reversibles según router.

Estado fijado por ruta: suspend pide reason; reactivate sin body; RequireIfMatch; target scope; changeMembershipStatus no acepta offboard.

UpdateStatus+auditRequired+ETag; reason/actor antes/después auditados.

Evidence: `backend-go/internal/api/orgteam.go:314-320`, `backend-go/internal/api/orgteam.go:328-373`, `backend-go/internal/api/routes.go:122-232`

## HandleReactivateMembership
reactivar membership

authMW con capability Team y target membership de organización; idempotency por comando. Sin step-up en estas acciones reversibles según router.

Estado fijado por ruta: suspend pide reason; reactivate sin body; RequireIfMatch; target scope; changeMembershipStatus no acepta offboard.

UpdateStatus+auditRequired+ETag; reason/actor antes/después auditados.

Evidence: `backend-go/internal/api/orgteam.go:324-326`, `backend-go/internal/api/orgteam.go:328-373`, `backend-go/internal/api/routes.go:122-232`

## HandleRevokeMembershipSessions
Revocar sesiones de una membership

authMW con capability Team y target membership de organización; idempotency por comando. TeamCapabilityRevokeSessions+organization_admin step-up; support denied.

If-Match yreason obligatorio; target scope; storage RevokesMembershipSessions.

Invalida generación/sesiones sin cambiar roles/lifecycle; auditRequired+ETag.

Evidence: `backend-go/internal/api/orgteam.go:377-419`, `backend-go/internal/api/routes.go:122-232`

## HandleMembershipOffboardingPreview
Inventario de responsabilidades antes de baja

authMW con capability Team y target membership de organización; idempotency por comando. requireOrgTeamMutation.

If-Match antes/después de GetMembershipOffboardingImpact;503 si interfaz ausente;404 target;412 stale.

No reasigna/ni cambia lifecycle, PERO inserta audit membership_offboarding_previewed; devuelve impactVersion+inventory+ETag.

Evidence: `backend-go/internal/api/orgteam.go:424-471`, `backend-go/internal/api/routes.go:122-232`

## HandleTransferOrganizationAdmin
Transferir autoridad admin con versiones origen/destino

authMW con capability Team y target membership de organización; idempotency por comando. TransferAdmin yAssignAdmin; organization_admin step-up.

If-Match source;targetVersion ≥ 1,reason,target membership; command store requerido.

Service atomiza transferencia y demote source opcional; ETag source y ambas memberships.

Evidence: `backend-go/internal/api/orgteam.go:492-531`, `backend-go/internal/api/routes.go:122-232`

## HandleChangeMembershipSectors
Cambiar sectores de membership

authMW con capability Team y target membership de organización; idempotency por comando. ManageSectors;sin step-up específico en router.

If-Match;target scope; convierte enums; storage valida compatibilidad roles/sector y version.

Comando devuelve sectores+memberversion+ETag; no user_sectors global.

Evidence: `backend-go/internal/api/orgteam.go:533-573`, `backend-go/internal/api/routes.go:122-232`

## HandleOffboardMembership
Dar de baja membership con plan reasignación

authMW con capability Team y target membership de organización; idempotency por comando. requireOrgTeamMutation+organization_admin step-up.

If-Match,impactVersion,reason,targets de reasignación; commandStore; conflictos impacto/last admin reportados tipados.

OffboardMember con transferencias y conservación de historia; response inventory+member+ETag. Sin pruebas reales nuevas aquí.

Evidence: `backend-go/internal/api/orgteam.go:582-615`, `backend-go/internal/api/routes.go:122-232`

## HandleOrgListInvitations
Listar invitaciones visibles

TeamCapabilityView; claimsorg+user storage.

ListInvitations scoped, convertidoInvitationDTO.

Solo lectura; no emite token crudo.

Evidence: `backend-go/internal/api/orgteam.go:742-757`, `backend-go/internal/api/routes.go:122-232`

## HandleOrgCreateInvitation
Crear invitación 14d

TeamView inicial + role subset invitable; support solo bootstrap admin si ActiveMembers = 0.

Email normalized contains@ y RolesAllowedInOrg; random token hash persisted; duplicate 409.

Crea + auditRequired;201 DTO,token y acceptURL; no-store+idempotency router.

Evidence: `backend-go/internal/api/orgteam.go:759-809`, `backend-go/internal/api/routes.go:122-232`

## HandleOrgInvitationCommand
Dispatch resend/revoke de invitación

authMW; helper exige TeamMutation+target roles invitable.

Suffix resend|revoke; idempotency namespaced; helpers If-Match; revoke reason required; resend token rotado 14d.

Resend retorna nuevo token+URL y ETag;revoke status. Ambos auditan; comando desconocido 404.

Evidence: `backend-go/internal/api/orgteam.go:842-857`, `backend-go/internal/api/orgteam.go:811-838`, `backend-go/internal/api/orgteam.go:858-889`, `backend-go/internal/api/orgteam.go:891-909`, `backend-go/internal/api/routes.go:122-232`
