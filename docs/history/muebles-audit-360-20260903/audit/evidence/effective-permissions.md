# Permisos efectivos: composición, no listado de roles

41 familias cruzan acción, recurso, actor, tenant, ownership, contexto manufacturing, step-up y enforcement. PredicadosTS/Go coincidentes no prueban UI ni endpoint efectivo.

| Recurso | Regla efectiva | Scope |
|---|---|---|
|Catalog material/hardware/edge/option/category|GET any authenticated permitted credential; mutations AnyRole(admin,ingeniero)|Catalog storage scoped tenant; reads material/hardware/edge additionally cost-redacted|
|Furniture module/structure/component|GET authenticated; mutations AnyRole(admin,ingeniero) through RoleCanMutateModules|Tenant catalog; component domain validation separate from permission|
|Customers|AnyRole(admin,gerente_ventas,vendedor); individual operations additionally owned-resource rule|List filtered owner; individual owner-denial404; owner assignment rules server-side|
|Projects|GET accessProjects(admin,gerente_ventas,gerente_produccion,vendedor,ingeniero,produccion)+owner. DELETE admin/gerente_ventas+owner. PUT mutation/reopen/markProduced rules branch-specific.|Owner access then manufacturing redaction and costs redaction; underlying storage visibility includes sales/manufacturing org links|
|Purchase orders/suppliers|Read admin/gerente_produccion/almacen; mutations admin/almacen|Tenant procurement; receivedlines exact PO membership enforced in storage|
|Stock/picking|Read purchasingNav(admin,gerente_produccion,almacen); stockwrite/pickingwrite admin/almacen; writepicking/stockmovement in previous deep audit|Tenant stock; dispatch compensation across requests not atomic (BE002)|
|Legacy/physical floor|AnyRole(markProduced OR exportProduction OR claimProductionJob), then targetstation/sector for scoped operators|manufacturingOnly, exact item/unit, domain sequence/assembly/QC gates; legacy line rejects units tracked physically|
|Assembly/QC/rework|RoleCanSuperviseFloor=admin,gerente_ventas,gerente_produccion,ingeniero|manufacturingOnly; exact unit/part and reason; each override domain record differs|
|Quality|roleCanManageQuality=RoleCanAppendProjectEvent(quality_issue_reported):admin,gerente_produccion,produccion|manufacturingOnly; issue/part/unit target in mutation snapshot|
|MRP|eventmaterials_required:admin,gerente_produccion,almacen,ingeniero|manufacturingOnly; project requirements/release; reserve/consume controls distinct from stockledger|
|MRP release|normalmaterials_ready:admin,gerente_produccion,almacen,ingeniero; override additionally materials_release_overridden:admin,gerente_produccion,almacen|manufacturingOnly + readiness; missingchecks override requires reason and different permission|
|Costing|GET actorCanViewCosts. baseline/rate/void:admin,gerente_ventas,gerente_produccion. Time:eventcost_time_recorded includes operating roles. Other additionally almacen; exact event table cited.|manufacturingOnly; initialized costing,targetentry; no blanket permission for all costingactions|
|Survey|GET auth+mfgonly. Capture:admin,gerente_ventas,vendedor,ingeniero; verify removesvendedor; approve/freezeadmin,ingeniero.|manufacturingOnly; project/space and measurement lifecycle gates|
|Installation|Installation_started:admin,gerente_ventas,gerente_produccion,produccion. Punch/signoff/close use narrower per-event role set in dedicated previously reviewed commands.|manufacturingOnly; jobtransition; PUT cannot change closeout facts|
|Production activity|claim/finish/damage RoleCanClaimProductionJob; scoped roles sector membership; finish owneroperator oradmin. dashboard predicate separate; staff/damageResolveadmin,gerente_produccion.|Tenant activity; ownershipoperator does not equal projectportfolioowner|
|Project media/messages/warranty|No command-specific RoleCan* guard in reviewed handlers; authMW only (extension allowlist stillrestricts)|Tenant scoped storage; photos individual pathproject not compared in handler; owner/capability parity UNKNOWN, not proofcross-tenant|
|Technical workflow legacy|No handler command capability/owner guard beyondauth; EPS-F01 source-confirmed gap|UPDATE filters owning organization; force_release skips loading gate without requiredreason; not normalizedDesignRelease|
|FurnitureInstance/QuoteLine materialization|Read accessProjects; mutation mutateProjects(admin,gerente_ventas,vendedor)|Project-owning storage command; acceptedquote/history guards; instanceUUID exact; removeIfMatch|
|Design working copy/publication|Read/edit/reset accessProjects; publish mutateProjects. This deliberate source distinction is not blanket engineering-write permission.|Exact Design/project/instance association storage; publishedrevision vs draft separate|
|Artifacts/media|Catalogupload admin/ingeniero; mediaauthorize authenticated; artifactauthorizeaccessProjects; read dual session or exactresourcegrant|Org filesystem namespace; signed grant exact resource+absolutecap; mediaup validationissueBE001|
|Team|Capabilities union per orgtype: factoryadminall; gerente_ventas sales subset; gerente_produccion productionsubset. Store/dealeradmin lacks factorysectorcapabilities.|Activeorg; no supportmutations; currentANDdesired targetroles manageable; no selfchange via ordinarytargethelper|
|Sessions/devices|Own identity; membershiprequiresTeamRevokeSessions+exacttarget; platformflagforglobal; deviceownuser|No-store/querytokenrejection fordirectory; reason limits on delegatedrevoke; device has own credential class|
|Platform|PlatformAdminMiddleware requires liveplatform_admin flag (not organizationadmin role)|Global administration does not inherently authorize arbitrary businessdata; supportsession separate|
|Settings|GET authenticated; PUT admin,gerente_ventas,ingeniero|Tenant settings; no platformglobal inference|
|MFA self-service|Authenticated self user; no organization admin role required for own factors|Exact user/factor; step-up grant tied user+session+scope, not general JWT privilege|
|Organizations lifecycle/provisioning|Provisioning: platform bootstrap branch or factory admin restricted store/dealer; lifecycle platform admin; entitlement write platform admin. See per-method endpoint policy below.|Factory branch cannot supply platform entitlements/bootstrap overrides; lifecycle target/version/impact explicitly validated|
|Platform support/account commands|Platform middleware for account/start support; support end authenticated context per handler|Global account target differs from exact organization support scope; support grants do not imply unrestricted business command rights|
|Session transport|Refresh credential or web cookie transport; legacy bearer refresh refuses authenticated flow; /me auth; invitation acceptance bound pending identity/token|Cookie origin/CSRF and server family/session validation where applicable; /me absolute deadline mismatch AUTH-CONTRACT-01 separately scoped|
|Health|Per-method source-confirmed policy in methodPolicies; shared dispatch commands retain individual handler notes|N/A: no resource/tenant data|
|Device credential issuance|Per-method source-confirmed policy in methodPolicies; shared dispatch commands retain individual handler notes|Exact resource/user/tenant constraints in each cited handlerSemanticDetails; no additional owner/relationship guard inferred|
|Team membership commands|Per-method source-confirmed policy in methodPolicies; shared dispatch commands retain individual handler notes|Exact resource/user/tenant constraints in each cited handlerSemanticDetails; no additional owner/relationship guard inferred|
|Team invitations|Per-method source-confirmed policy in methodPolicies; shared dispatch commands retain individual handler notes|Exact resource/user/tenant constraints in each cited handlerSemanticDetails; no additional owner/relationship guard inferred|
|Stateless authoring resolve|Per-method source-confirmed policy in methodPolicies; shared dispatch commands retain individual handler notes|Exact resource/user/tenant constraints in each cited handlerSemanticDetails; no additional owner/relationship guard inferred|
|Supplemental catalog|Per-method source-confirmed policy in methodPolicies; shared dispatch commands retain individual handler notes|Exact resource/user/tenant constraints in each cited handlerSemanticDetails; no additional owner/relationship guard inferred|
|Design binding and artifact metadata|Per-method source-confirmed policy in methodPolicies; shared dispatch commands retain individual handler notes|Exact resource/user/tenant constraints in each cited handlerSemanticDetails; no additional owner/relationship guard inferred|
|Project events and physical read models|Per-method source-confirmed policy in methodPolicies; shared dispatch commands retain individual handler notes|Exact resource/user/tenant constraints in each cited handlerSemanticDetails; no additional owner/relationship guard inferred|
|Project templates|Per-method source-confirmed policy in methodPolicies; shared dispatch commands retain individual handler notes|Exact resource/user/tenant constraints in each cited handlerSemanticDetails; no additional owner/relationship guard inferred|
|Project calculation|Per-method source-confirmed policy in methodPolicies; shared dispatch commands retain individual handler notes|Exact resource/user/tenant constraints in each cited handlerSemanticDetails; no additional owner/relationship guard inferred|
|Owner assignment directory|Per-method source-confirmed policy in methodPolicies; shared dispatch commands retain individual handler notes|Exact resource/user/tenant constraints in each cited handlerSemanticDetails; no additional owner/relationship guard inferred|
|Explicit seed|Per-method source-confirmed policy in methodPolicies; shared dispatch commands retain individual handler notes|Exact resource/user/tenant constraints in each cited handlerSemanticDetails; no additional owner/relationship guard inferred|
|Future declarations|Per-method source-confirmed policy in methodPolicies; shared dispatch commands retain individual handler notes|N/A: future contract only|

## Diferencias
- Purchasing usa primer rol en UI vs unión en backend.
- EPS-F01: workflow técnico legacy carece del guard de comando y owner.
- API GET catálogo más amplia que navegación UI no implica vulnerabilidad sin política adicional.

## Límite
Fuente inspeccionada, sin nuevas pruebas ni certificación de todas las combinaciones de roles/estados. Ver JSON para evidencia exacta por familia.
