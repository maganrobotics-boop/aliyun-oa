#!/usr/bin/env python3
"""Read-only overlay inventory. Never applies patches or accesses production."""
import argparse
import base64
import hashlib
import json
from pathlib import Path

BUNDLE_ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def inventory(source):
    image = BUNDLE_ROOT / 'patches/oa-admin-image-save-20261003'
    pwa = BUNDLE_ROOT / 'patches/oa-pwa-safe-20261006'
    pending = BUNDLE_ROOT / 'patches/oa-unified-pending-20261007'
    image_manifest = json.loads((image / 'source-hashes.json').read_text())
    pwa_manifest = json.loads((pwa / 'patch.json').read_text())
    pending_manifest = json.loads((pending / 'source-hashes.json').read_text())
    overlays = [
        ('image', image_manifest['productionBase'], {
            p: (h['beforeSha256'], h['afterSha256'])
            for p, h in image_manifest['files'].items()}),
        ('pwa', pwa_manifest['base_release'], {
            h['path']: (h['before_sha256'], h['after_sha256'])
            for h in pwa_manifest['files']}),
        ('pending', 'oa-people-20261007-v6', {
            p: (h['before'], h['after']) for p, h in pending_manifest.items()}),
    ]
    for h in pwa_manifest['files']:
        data = base64.b64decode(h['content_base64'], validate=True)
        if hashlib.sha256(data).hexdigest() != h['after_sha256']:
            raise ValueError('Corrupt PWA payload: ' + h['path'])
    result = []
    for name, baseline, files in overlays:
        rows = []
        for path, (before, after) in files.items():
            target = (source / path).resolve()
            if not target.is_relative_to(source):
                raise ValueError('Path leaves source copy: ' + path)
            actual = digest(target)
            state = ('after' if actual == after else 'before' if actual == before
                     else 'missing' if actual is None else 'mismatch')
            rows.append(dict(path=path, before=before, after=after,
                             actual=actual, state=state))
        # Mixed before/after trees need a separate review: the legacy patch
        # appliers for image and pending require the entire before state.
        states = {row['state'] for row in rows}
        status = ('already-applied' if states == {'after'} else
                  'baseline-matches' if states == {'before'} else 'blocked')
        result.append(dict(overlay=name, baseline=baseline, status=status, files=rows))
    return dict(readOnly=True, source=str(source),
                scope='Only manifest paths; not full production equivalence.', overlays=result)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='local source copy to inspect')
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    if not source.is_dir():
        parser.error('source must be a directory')
    report = inventory(source)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    raise SystemExit(2 if any(o['status'] == 'blocked' for o in report['overlays']) else 0)
