#!/usr/bin/env python3
"""Apply the reviewed PWA-only overlay to a copy of the recorded production source."""
import argparse, base64, hashlib, json, os
from pathlib import Path
parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("--apply", action="store_true", help="write only after all baseline checks pass")
args = parser.parse_args()
root = args.source.resolve(strict=True)
payload = json.loads(Path(__file__).with_name("patch.json").read_text())
updates = []
for entry in payload["files"]:
    path = (root / entry["path"]).resolve()
    if not path.is_relative_to(root):
        raise SystemExit("Unsafe path: " + entry["path"])
    data = base64.b64decode(entry["content_base64"], validate=True)
    if hashlib.sha256(data).hexdigest() != entry["after_sha256"]:
        raise SystemExit("Invalid payload: " + entry["path"])
    current = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
    if current == entry["after_sha256"]:
        continue
    if current != entry["before_sha256"]:
        raise SystemExit("Baseline mismatch; no files written: " + entry["path"])
    updates.append((path, data))
if args.apply:
    for path, data in updates:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(path.name + ".pwa-patch-tmp")
        with temp.open("xb") as stream:
            stream.write(data)
        if path.exists():
            stat = path.stat()
            os.chmod(temp, stat.st_mode & 0o777)
        os.replace(temp, path)
print(("Applied " if args.apply else "Verified ") + str(len(updates)) + " PWA-only files")
