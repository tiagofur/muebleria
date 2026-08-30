#!/usr/bin/env python3
import filecmp, json, pathlib, subprocess, sys, tempfile

root=pathlib.Path(__file__).resolve().parents[1]
spec_path=root/"contracts/openapi/granete-api.v1.yaml"
client_path=pathlib.Path("packages/storage/src/openapi/generated/client.ts")
targets=["packages/storage/src/openapi/generated/types.ts",str(client_path),"backend-go/internal/api/openapi/generated/types.gen.go"]

def generate(out_root, spec=spec_path):
    subprocess.run([
        sys.executable,str(root/"scripts/generate_openapi.py"),"--out-root",str(out_root),"--spec",str(spec),
    ],check=True,cwd=root)

def assert_operation_mutation_changes_client(tmp, name, mutate):
    spec=json.loads(spec_path.read_text()); mutate(spec)
    mutated_spec=pathlib.Path(tmp)/f"{name}.json"; mutated_spec.write_text(json.dumps(spec))
    output=pathlib.Path(tmp)/name; generate(output,mutated_spec)
    if filecmp.cmp(root/client_path,output/client_path,shallow=False):
        raise RuntimeError(f"OpenAPI operation {name} mutation did not change the generated client")

with tempfile.TemporaryDirectory() as tmp:
    generated=pathlib.Path(tmp)/"generated"; generate(generated)
    drift=[p for p in targets if not filecmp.cmp(root/p,generated/p,shallow=False)]
    if drift:
        print("OpenAPI generated files drifted:\n"+"\n".join(drift));sys.exit(1)

    def change_operation_id(spec): spec["paths"]["/auth/login"]["post"]["operationId"]="loginChanged"
    def change_verb(spec): spec["paths"]["/auth/login"]["put"]=spec["paths"]["/auth/login"].pop("post")
    def change_path(spec): spec["paths"]["/auth/session-login"]=spec["paths"].pop("/auth/login")
    def change_request(spec): spec["paths"]["/auth/login"]["post"]["requestBody"]["content"]["application/json"]["schema"]={"$ref":"#/components/schemas/AcceptInvitationRequest"}
    def change_response(spec): spec["paths"]["/auth/login"]["post"]["responses"]["200"]["content"]["application/json"]["schema"]={"$ref":"#/components/schemas/MeResponse"}
    for name,mutate in (
        ("operation-id",change_operation_id),("verb",change_verb),("path",change_path),
        ("request",change_request),("response",change_response),
    ): assert_operation_mutation_changes_client(tmp,name,mutate)

spec=json.loads(spec_path.read_text())
patch_headers=spec["paths"]["/platform/organizations/{id}"]["patch"]["responses"]["200"].get("headers",{})
for path in ("/org/invitations/{invitationId}:resend", "/org/invitations/{invitationId}:revoke"):
    operation=spec["paths"][path]["post"]
    headers=operation["responses"]["200"].get("headers",{})
    operation_parameters=[p.get("$ref",p.get("name")) for p in operation.get("parameters",[])]
    if "ETag" not in headers:
        raise RuntimeError(f"versioned invitation command {path} must declare response ETag")
    if "#/components/parameters/IfMatch" not in operation_parameters or "#/components/parameters/IdempotencyKey" not in operation_parameters:
        raise RuntimeError(f"invitation command {path} must declare If-Match and Idempotency-Key")
for path in ("/org/memberships/{membershipId}/roles", "/org/memberships/{membershipId}/status"):
    operation=spec["paths"][path]["put"]
    headers=operation["responses"]["200"].get("headers",{})
    operation_parameters=[p.get("$ref",p.get("name")) for p in operation.get("parameters",[])]
    if "ETag" not in headers:
        raise RuntimeError(f"versioned membership command {path} must declare response ETag")
    if "#/components/parameters/IfMatch" not in operation_parameters or "#/components/parameters/IdempotencyKey" not in operation_parameters:
        raise RuntimeError(f"membership command {path} must declare If-Match and Idempotency-Key")
if "ETag" not in patch_headers:
    raise RuntimeError("versioned organization mutations must declare response ETag")
directory_response=spec["paths"]["/org/memberships"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
if directory_response.get("$ref") != "#/components/schemas/TeamDirectory":
    raise RuntimeError("Team membership directory must expose the canonical TeamDirectory read model")
summary_response=spec["paths"]["/org/team/summary"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
if summary_response.get("$ref") != "#/components/schemas/TeamSummary":
    raise RuntimeError("Team summary must expose the canonical TeamSummary read model")

required_paths={
    "/org/memberships",
    "/org/team/summary",
    "/org/invitations",
    "/org/invitations/{invitationId}:resend",
    "/org/invitations/{invitationId}:revoke",
    "/auth/invitations:accept",
    "/platform/users/{userId}:set-account-status",
}
missing_paths=required_paths-set(spec["paths"])
if missing_paths:
    raise RuntimeError(f"canonical identity lifecycle paths are missing: {sorted(missing_paths)}")
legacy_paths={
    "/auth/register",
    "/auth/accept-invitation",
    "/org/team",
    "/org/members/{userId}/roles",
    "/org/members/{userId}/active",
    "/org/invitations/{id}",
}
published_legacy=legacy_paths & set(spec["paths"])
if published_legacy:
    raise RuntimeError(f"legacy identity lifecycle paths remain published: {sorted(published_legacy)}")

schemas=spec["components"]["schemas"]
expected_team_capabilities=["team:view","team:invite:sales","team:invite:production","team:manage:sales","team:manage:production","team:manage:all","team:assign:admin","team:transfer_admin","team:manage:sectors","team:revoke_sessions"]
if schemas.get("TeamCapability", {}).get("enum") != expected_team_capabilities:
    raise RuntimeError("TeamCapability must preserve the canonical Team capability vocabulary")

invitation_statuses=schemas["InvitationStatus"].get("enum",[])
expected_invitation_statuses=["pending","delivered","opened","accepted","expired","revoked"]
if invitation_statuses != expected_invitation_statuses:
    raise RuntimeError(f"InvitationStatus must preserve the canonical lifecycle: {expected_invitation_statuses}")
for schema_name,legacy_fields in (
    ("User", {"active"}),
    ("Membership", {"active"}),
    ("TeamMember", {"account_active", "membership_active", "member_since"}),
):
    published=legacy_fields & set(schemas[schema_name]["properties"])
    if published:
        raise RuntimeError(f"{schema_name} still publishes legacy lifecycle fields: {sorted(published)}")
serialized_spec=json.dumps(spec)
if "token_hash" in serialized_spec:
    raise RuntimeError("OpenAPI must never publish invitation token hashes")
account_command=spec["paths"]["/platform/users/{userId}:set-account-status"]["post"]
account_parameters=[p.get("$ref",p.get("name")) for p in account_command.get("parameters",[])]
if "#/components/parameters/IdempotencyKey" not in account_parameters:
    raise RuntimeError("Platform account lifecycle command must declare Idempotency-Key")
if account_command["requestBody"]["content"]["application/json"]["schema"].get("$ref") != "#/components/schemas/UpdateAccountStatusRequest":
    raise RuntimeError("Platform account lifecycle command must use the generated status request")
if "/factory/organizations" not in spec["paths"]:
    raise RuntimeError("current factory organizations boundary is missing from OpenAPI")

print("OpenAPI generated files are current; operation drift negative proofs passed")
