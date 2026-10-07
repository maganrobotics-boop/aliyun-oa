#!/usr/bin/env python3
"""Apply the verified OA production overlay to its recorded source snapshot."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

bundle = Path(__file__).resolve().parent
root = Path(sys.argv[1]).resolve() if len(sys.argv) == 2 else None
if root is None or not root.is_dir():
    raise SystemExit("Usage: python3 apply.py /path/to/production-source")
manifest = json.loads((bundle / "source-hashes.json").read_text())
for name, hashes in manifest["files"].items():
    target = root / name
    actual = hashlib.sha256(target.read_bytes()).hexdigest() if target.exists() else None
    if actual != hashes["beforeSha256"]:
        raise SystemExit(f"Source differs from verified production baseline: {name}")
patch = bundle / "fix.patch"
subprocess.run(["git", "apply", "--check", str(patch)], cwd=root, check=True)
subprocess.run(["git", "apply", str(patch)], cwd=root, check=True)
for name, hashes in manifest["files"].items():
    actual = hashlib.sha256((root / name).read_bytes()).hexdigest()
    if actual != hashes["afterSha256"]:
        raise SystemExit(f"Unexpected result: {name}")
print("Applied image-edit save fix. Run the recorded verification before releasing.")
