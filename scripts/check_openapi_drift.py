#!/usr/bin/env python3
import filecmp, pathlib, subprocess, sys, tempfile
root=pathlib.Path(__file__).resolve().parents[1]
targets=["packages/storage/src/openapi/generated/types.ts","packages/storage/src/openapi/generated/client.ts","backend-go/internal/api/openapi/generated/types.gen.go"]
with tempfile.TemporaryDirectory() as tmp:
    subprocess.run([sys.executable,str(root/"scripts/generate_openapi.py"),"--out-root",tmp],check=True,cwd=root)
    drift=[p for p in targets if not filecmp.cmp(root/p,pathlib.Path(tmp)/p,shallow=False)]
if drift:
    print("OpenAPI generated files drifted:\n"+"\n".join(drift));sys.exit(1)
print("OpenAPI generated files are current")
