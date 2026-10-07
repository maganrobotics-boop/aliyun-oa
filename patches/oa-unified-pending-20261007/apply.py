#!/usr/bin/env python3
import hashlib,json,pathlib,subprocess,sys
bundle=pathlib.Path(__file__).resolve().parent
if len(sys.argv)!=2:raise SystemExit("Usage: python3 apply.py /path/to/production-source-copy")
root=pathlib.Path(sys.argv[1]).resolve()
manifest=json.loads((bundle/"source-hashes.json").read_text())
for name,h in manifest.items():
 p=root/name
 actual=hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
 if actual!=h["before"]:raise SystemExit("Source differs from verified baseline: "+name)
subprocess.run(["git","apply","--check",str(bundle/"change.patch")],cwd=root,check=True)
subprocess.run(["git","apply",str(bundle/"change.patch")],cwd=root,check=True)
for name,h in manifest.items():
 assert hashlib.sha256((root/name).read_bytes()).hexdigest()==h["after"],name
print("Applied. Run verification before release. No services or business data were changed.")
