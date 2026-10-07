"""Linux regression tests using a real non-root identity, never production paths."""
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
CHECKER = REPO / 'deploy/aliyun/preflight-release.py'


def can_switch_user():
    return os.geteuid() == 0 and shutil.which('runuser') and subprocess.run(
        ['runuser', '-u', 'nobody', '--', 'true'], capture_output=True).returncode == 0


SWITCH_USER = can_switch_user()


@unittest.skipUnless(os.geteuid() != 0 or SWITCH_USER, 'run as a non-root Linux user or root with uid-switch capability')
class ReleasePreflight(unittest.TestCase):
    def setUp(self):
        self.account = pwd.getpwnam('nobody') if SWITCH_USER else pwd.getpwuid(os.geteuid())
        self.temp = Path(tempfile.mkdtemp(prefix='oa-preflight-'))
        self.temp.chmod(0o755)
        self.root = self.temp / 'release'
        self.next = self.root / '.next'
        self.make_file('aliyun/oa-server.mjs', '// synthetic server')
        self.make_file('.next/BUILD_ID', 'synthetic-build')
        for name in ('build-manifest.json', 'routes-manifest.json', 'required-server-files.json', 'server/app-paths-manifest.json'):
            self.make_file('.next/' + name, '{}')
        self.make_file('.next/static/chunks/app.js', '// synthetic js')
        self.make_file('.next/static/css/app.css', 'body {}')
        self.make_file('public/manifest.webmanifest', '{}')

    def tearDown(self):
        # Restore fixture access for non-root cleanup; never modify links' targets.
        for directory in (self.temp, self.root, self.next, self.next / 'static', self.next / 'static/chunks', self.next / 'standalone', self.next / 'standalone/.next', self.next / 'standalone/.next/static', self.next / 'standalone/.next/static/chunks'):
            if directory.exists() and not directory.is_symlink():
                directory.chmod(0o755)
        shutil.rmtree(self.temp)

    def make_file(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        path.chmod(0o644)
        for parent in path.parents:
            if parent == self.temp:
                break
            parent.chmod(0o755)
        return path

    def run_gate(self, candidate=None, layout='proxy'):
        prefix = ['runuser', '-u', 'nobody', '--'] if SWITCH_USER else []
        return subprocess.run(prefix + ['python3', '-', str(candidate or self.root), '--layout', layout],
                              input=CHECKER.read_text(), text=True, capture_output=True)

    def assert_rejected(self, candidate=None):
        result = self.run_gate(candidate)
        self.assertEqual(result.returncode, 65, result.stdout + result.stderr)
        self.assertIn('FAILED', result.stderr)

    def test_readable_release_is_valid_and_unchanged(self):
        before = [(str(p), p.stat().st_uid, p.stat().st_mode, p.stat().st_mtime_ns) for p in self.root.rglob('*')]
        result = self.run_gate()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f'uid={self.account.pw_uid}', result.stdout)
        self.assertEqual(before, [(str(p), p.stat().st_uid, p.stat().st_mode, p.stat().st_mtime_ns) for p in self.root.rglob('*')])

    def test_nontraversable_static_directory_reproduces_incident(self):
        (self.next / 'static/chunks').chmod(0o700 if SWITCH_USER else 0o600)
        self.assert_rejected()

    def test_service_owned_directory_still_needs_execute_permission(self):
        path = self.next / 'static/chunks'
        if SWITCH_USER:
            os.chown(path, self.account.pw_uid, self.account.pw_gid)
        path.chmod(0o600)
        self.assert_rejected()

    def test_untraversable_parent(self):
        self.temp.chmod(0o700 if SWITCH_USER else 0o600)
        self.assert_rejected()

    def test_unreadable_static_file(self):
        (self.next / 'static/chunks/app.js').chmod(0o600 if SWITCH_USER else 0o000)
        self.assert_rejected()

    def test_unreadable_required_manifest(self):
        (self.next / 'routes-manifest.json').chmod(0o600 if SWITCH_USER else 0o000)
        self.assert_rejected()

    def test_unreadable_pwa_manifest(self):
        (self.root / 'public/manifest.webmanifest').chmod(0o600 if SWITCH_USER else 0o000)
        self.assert_rejected()

    def test_missing_or_invalid_manifest(self):
        path = self.next / 'build-manifest.json'
        path.unlink()
        self.assert_rejected()
        path.write_text('invalid json')
        self.assert_rejected()

    def test_symlink_candidate_checks_target(self):
        link = self.temp / 'candidate'
        link.symlink_to(self.root)
        self.assertEqual(self.run_gate(link).returncode, 0)
        self.root.chmod(0o700 if SWITCH_USER else 0o600)
        self.assert_rejected(link)

    def test_broken_or_external_static_symlink(self):
        link = self.next / 'static/chunks/link.js'
        link.symlink_to('missing.js')
        self.assert_rejected()
        link.unlink()
        outside = self.temp / 'outside.js'
        outside.write_text('// outside')
        link.symlink_to(outside)
        self.assert_rejected()

    def test_internal_static_symlink_and_cycle(self):
        link = self.next / 'static/chunks/link.js'
        link.symlink_to('app.js')
        self.assertEqual(self.run_gate().returncode, 0)
        (self.next / 'static/chunks/cycle').symlink_to(self.next / 'static')
        self.assert_rejected()

    def test_world_writable_static_artifact(self):
        (self.next / 'static/chunks/app.js').chmod(0o666)
        self.assert_rejected()

    def test_standalone_packaged_paths(self):
        runtime = self.next / 'standalone'
        runtime.mkdir()
        runtime.chmod(0o755)
        shutil.copytree(self.next, runtime / '.next', ignore=shutil.ignore_patterns('standalone'))
        shutil.copytree(self.root / 'public', runtime / 'public')
        (runtime / 'server.js').write_text('// synthetic standalone')
        (runtime / 'server.js').chmod(0o644)
        result = self.run_gate(layout='standalone')
        self.assertEqual(result.returncode, 0, result.stderr)
        (runtime / '.next/static/chunks').chmod(0o700 if SWITCH_USER else 0o600)
        self.assertEqual(self.run_gate(layout='standalone').returncode, 65)

    @unittest.skipUnless(SWITCH_USER, 'root-only probe')
    def test_root_probe_is_refused(self):
        result = subprocess.run(['python3', str(CHECKER), str(self.root)], text=True, capture_output=True)
        self.assertEqual(result.returncode, 65)
        self.assertIn('Refusing a root access check', result.stderr)

    @unittest.skipUnless(SWITCH_USER, 'requires root for runuser/systemd wrapper')
    def test_effective_systemd_identity_wrapper(self):
        bin_dir = self.temp / 'bin'
        bin_dir.mkdir()
        command = bin_dir / 'systemctl'
        command.write_text('#!/bin/sh\ncase "$*" in *SupplementaryGroups*) echo;; *User*) echo nobody;; *Group*) id -gn nobody;; *) exit 1;; esac\n')
        command.chmod(0o755)
        result = subprocess.run(['bash', str(REPO / 'deploy/aliyun/preflight-release.sh'), str(self.root)],
                                env={**os.environ, 'PATH': f'{bin_dir}:' + os.environ['PATH']}, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        (self.next / 'static/chunks').chmod(0o700 if SWITCH_USER else 0o600)
        result = subprocess.run(['bash', str(REPO / 'deploy/aliyun/preflight-release.sh'), str(self.root)],
                                env={**os.environ, 'PATH': f'{bin_dir}:' + os.environ['PATH']}, text=True, capture_output=True)
        self.assertEqual(result.returncode, 65)


class Wiring(unittest.TestCase):
    def test_gate_precedes_switch_and_service_changes(self):
        for script, gate, switch in (
            ('deploy.sh', 'runuser -u originmind-oa -g originmind-oa -- python3', 'install -m 0644'),
            ('deploy-from-github.sh', '# Last gate', 'ln -sfn "$REL" "$LINK"'),
        ):
            source = (REPO / 'deploy/aliyun' / script).read_text()
            self.assertLess(source.index(gate), source.index(switch))
            self.assertLess(source.index(gate), source.index('systemctl restart'))
            self.assertIn('set -euo pipefail', source)


if __name__ == '__main__':
    unittest.main(verbosity=2)
