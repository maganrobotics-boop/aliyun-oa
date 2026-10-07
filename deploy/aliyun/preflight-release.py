#!/usr/bin/env python3
"""Read-only release gate. Run through preflight-release.sh as the service identity."""
import argparse
import json
import os
from pathlib import Path
import stat
import sys


def check_release(candidate, layout):
    if os.geteuid() == 0:
        raise ValueError('Refusing a root access check; use the actual service user')
    lexical = Path(os.path.abspath(candidate))
    root = lexical.resolve(strict=True)
    if not root.is_dir():
        raise ValueError('Candidate is not a directory')

    def describe(path):
        s = path.stat()
        return f'{path} (uid={s.st_uid}, gid={s.st_gid}, mode={stat.S_IMODE(s.st_mode):04o})'

    def ancestry(path):
        # Check both the link path and resolved target, including every parent.
        for p in reversed((path, *path.parents)):
            if p.is_dir() and not os.access(p, os.X_OK):
                raise ValueError('Cannot traverse ' + describe(p))

    ancestry(lexical)
    ancestry(root)

    def checked(path, directory=False):
        ancestry(path.parent)
        target = path.resolve(strict=True)
        if not target.is_relative_to(root):
            raise ValueError(f'Release symlink escapes candidate: {path} -> {target}')
        ancestry(target.parent)
        s = target.stat()
        if s.st_mode & stat.S_IWOTH:
            raise ValueError('World-writable release artifact: ' + describe(target))
        if directory:
            if not target.is_dir() or not os.access(path, os.R_OK | os.X_OK):
                raise ValueError('Cannot list/traverse ' + describe(target))
        else:
            if not stat.S_ISREG(s.st_mode):
                raise ValueError(f'Expected a regular file: {path}')
            # Open as the service identity; checking metadata as root is insufficient.
            with path.open('rb') as stream:
                stream.read(1)
        return target

    checked(root, True)
    runtime = root / '.next/standalone' if layout == 'standalone' else root
    checked(runtime, True)
    checked(runtime / ('server.js' if layout == 'standalone' else 'aliyun/oa-server.mjs'))
    next_dir = runtime / '.next'
    for name in ('BUILD_ID', 'build-manifest.json', 'routes-manifest.json', 'required-server-files.json'):
        path = next_dir / name
        checked(path)
        if name.endswith('.json'):
            json.loads(path.read_text())
    # App/server manifests differ between Next versions. Validate all present ones.
    for path in next_dir.glob('*manifest*.json'):
        checked(path)
        json.loads(path.read_text())
    server = next_dir / 'server'
    checked(server, True)
    for path in server.glob('*manifest*'):
        checked(path)
        if path.suffix == '.json':
            json.loads(path.read_text())
    assets = []
    visited = set()

    def walk(directory):
        resolved = checked(directory, True)
        if resolved in visited:
            raise ValueError(f'Duplicate/cyclic static directory link: {directory}')
        visited.add(resolved)
        for path in directory.iterdir():
            if path.is_dir():
                walk(path)
            else:
                checked(path)
                assets.append(path)

    walk(next_dir / 'static')
    for extension in ('.js', '.css'):
        if not any(p.suffix == extension for p in assets):
            raise ValueError(f'Candidate has no Next static {extension} assets')
    # Optional PWA manifest: older OA snapshots do not contain one.
    public = runtime / 'public'
    if public.exists() or public.is_symlink():
        checked(public, True)
        def public_manifests(directory):
            checked(directory, True)
            for path in directory.iterdir():
                # Do not recursively follow public directory links (including cycles).
                if path.is_symlink():
                    checked(path, path.is_dir())
                    if path.is_dir():
                        raise ValueError(f'Public directory symlink requires review: {path}')
                if path.is_dir():
                    public_manifests(path)
                elif path.name.endswith('.webmanifest') or path.name == 'manifest.json':
                    checked(path)
                    json.loads(path.read_text())
        public_manifests(public)
    return len(assets)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('candidate')
    parser.add_argument('--layout', choices=('proxy', 'standalone'), default='proxy')
    args = parser.parse_args()
    try:
        count = check_release(args.candidate, args.layout)
    except (OSError, ValueError, RuntimeError) as error:
        print(f'Release preflight FAILED (uid={os.geteuid()}, gid={os.getegid()}): {error}', file=sys.stderr)
        sys.exit(65)
    print(f'Release preflight passed as uid={os.geteuid()}, gid={os.getegid()}: {count} static assets readable')
