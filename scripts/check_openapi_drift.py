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
    def change_request(spec): spec["paths"]["/auth/login"]["post"]["requestBody"]["content"]["application/json"]["schema"]={"$ref":"#/components/schemas/RegisterRequest"}
    def change_response(spec): spec["paths"]["/auth/login"]["post"]["responses"]["200"]["content"]["application/json"]["schema"]={"$ref":"#/components/schemas/MeResponse"}
    for name,mutate in (
        ("operation-id",change_operation_id),("verb",change_verb),("path",change_path),
        ("request",change_request),("response",change_response),
    ): assert_operation_mutation_changes_client(tmp,name,mutate)

spec=json.loads(spec_path.read_text())
patch_headers=spec["paths"]["/platform/organizations/{id}"]["patch"]["responses"]["200"].get("headers",{})
revoke=spec["paths"]["/org/invitations/{id}"]["delete"]
revoke_headers=revoke["responses"]["200"].get("headers",{})
revoke_parameters=[p.get("$ref",p.get("name")) for p in revoke.get("parameters",[])]
if "ETag" not in patch_headers or "ETag" not in revoke_headers:
    raise RuntimeError("versioned organization and invitation mutations must declare response ETag")
if "#/components/parameters/IfMatch" not in revoke_parameters or "#/components/parameters/IdempotencyKey" not in revoke_parameters:
    raise RuntimeError("invitation revoke must declare If-Match and Idempotency-Key")
if "/factory/organizations" not in spec["paths"]:
    raise RuntimeError("current factory organizations boundary is missing from OpenAPI")

print("OpenAPI generated files are current; operation drift negative proofs passed")
