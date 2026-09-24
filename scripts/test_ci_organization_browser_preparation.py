"""Exercise the real browser launcher with non-connecting child-process doubles."""

import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_GATE = ROOT / "scripts/organization-browser-gate.sh"


class BrowserPreparationLauncherTest(unittest.TestCase):
    def run_gate_with_doubles(self, preflight_exit, *, real_preflight=False, poison=None,
                              fail_admin=False, cancel_after_server=False):
        with tempfile.TemporaryDirectory(prefix="browser-preparation-double-") as tmp:
            tmpdir = Path(tmp)
            capture = tmpdir / "children.jsonl"
            server_pid = tmpdir / "server.pid"
            bindir = tmpdir / "bin"
            bindir.mkdir()
            shim = bindir / "shim"
            shim.write_text(
                "#!" + sys.executable + "\n"
                + "import json, os, pathlib, subprocess, sys, time, urllib.parse\n"
                + f"capture = pathlib.Path({str(capture)!r})\n"
                + f"server_pid = pathlib.Path({str(server_pid)!r})\n"
                + f"preflight_exit = {preflight_exit}\n"
                + f"fail_admin = {fail_admin!r}\n"
                + f"real_preflight = {real_preflight!r}\n"
                + f"real_go = {shutil.which('go')!r}\n"
                + f"poison = {poison or {}!r}\n"
                + "name = pathlib.Path(sys.argv[0]).name\n"
                + "args = sys.argv[1:]\n"
                + "if name == 'docker':\n"
                + "    if args[0] == 'logs': print('PostgreSQL init process complete; ready for start up.')\n"
                + "    elif args[0] == 'inspect': print('127.0.0.1:56321' if 'HostIp' in ' '.join(args) else '56321')\n"
                + "    elif args[0] == 'port': print('127.0.0.1:56321')\n"
                + "    elif args[0] == 'exec' and 'rolcanlogin' in ' '.join(args): print('t|f|f')\n"
                + "    elif args[0] == 'exec' and 'current_database()' in ' '.join(args): print('granete_gate|2|2')\n"
                + "    elif args[0] == 'exec' and 'psql' in args: print('11111111-1111-4111-8111-111111111111')\n"
                + "    elif args[0] == 'run': print('synthetic-container')\n"
                + "    sys.exit(0)\n"
                + "if name == 'curl':\n"
                + "    for _ in range(100):\n"
                + "        if server_pid.exists(): break\n"
                + "        time.sleep(0.01)\n"
                + "    sys.exit(0)\n"
                + "if name == 'go' and args[:1] == ['build']:\n"
                + "    pathlib.Path(args[args.index('-o') + 1]).symlink_to(pathlib.Path(sys.argv[0]).resolve())\n"
                + "    sys.exit(0)\n"
                + "if name in ('go', 'pnpm', 'granete-server'):\n"
                + "    def target(key):\n"
                + "        raw = os.environ.get(key)\n"
                + "        if not raw: return None\n"
                + "        u = urllib.parse.urlparse(raw)\n"
                + "        return [u.hostname, u.port, u.path, u.username]\n"
                + "    command = 'server ./cmd/server' if name == 'granete-server' else name + ' ' + ' '.join(args[:3])\n"
                + "    record = {'command': command,\n"
                + "        'runtime': target('DATABASE_URL'), 'migration': target('MIGRATION_DATABASE_URL'),\n"
                + "        'fixture': target('ORGANIZATION_TEST_DATABASE_URL'),\n"
                + "        'identity_digest': os.environ.get('ORGANIZATION_GATE_DB_IDENTITY_SHA256'),\n"
                + "        'media_dir': os.environ.get('MEDIA_DIR'),\n"
                + "        'isolated': os.environ.get('ORGANIZATION_TEST_ISOLATED'),\n"
                + "        'testdb': os.environ.get('GRANETE_TEST_DATABASE'),\n"
                + "        'pg_keys': sorted(key for key in os.environ if key.startswith('PG'))}\n"
                + "    with capture.open('a') as stream: stream.write(json.dumps(record) + '\\n')\n"
                + "    if name == 'go' and args[:2] == ['run', './cmd/testdb-preflight']:\n"
                + "        if real_preflight:\n"
                + "            prepared = os.environ.copy()\n"
                + "            for key, value in poison.items():\n"
                + "                if value is None: prepared.pop(key, None)\n"
                + "                else: prepared[key] = value\n"
                + "            sys.exit(subprocess.run([real_go] + args, env=prepared, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode)\n"
                + "        sys.exit(preflight_exit)\n"
                + "    if name == 'granete-server':\n"
                + "        server_pid.write_text(str(os.getpid()))\n"
                + "        time.sleep(60)\n"
                + "    if name == 'go' and args[:2] == ['run', './cmd/server']:\n"
                + "        child = subprocess.Popen([sys.executable, '-c',\n"
                + "            'import os,pathlib,time; pathlib.Path(' + repr(str(server_pid)) + ').write_text(str(os.getpid())); time.sleep(60)'])\n"
                + "        child.wait()\n"
                + "    if name == 'go' and args[:2] == ['run', './cmd/admin'] and fail_admin: sys.exit(1)\n"
                + "    sys.exit(0)\n"
                + "sys.exit(1)\n",
                encoding="utf-8",
            )
            shim.chmod(0o755)
            for name in ("docker", "go", "curl", "pnpm"):
                (bindir / name).symlink_to(shim)
            env = os.environ.copy()
            env.update({
                "PATH": str(bindir) + os.pathsep + env.get("PATH", ""),
                "TMPDIR": str(tmpdir),
                "DATABASE_URL": "postgres://ambient:secret@127.0.0.1:5445/muebles",
                "MIGRATION_DATABASE_URL": "postgres://ambient:secret@127.0.0.1:5445/muebles",
                "PGHOST": "persistent.example.invalid",
                "PGDATABASE": "muebles",
                "PGPORT": "5445",
                "PGSERVICE": "habitual",
                "PGPASSWORD": "ambient-secret",
                "MEDIA_DIR": "ambient-media-dir-must-not-reach-children",
            })
            gate = Path(os.environ.get("ORGANIZATION_GATE_TEST_SCRIPT", DEFAULT_GATE))
            command = ["bash", str(gate), "tests/organization/prequote-design.spec.ts"]
            if cancel_after_server:
                process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=subprocess.PIPE,
                                           stderr=subprocess.PIPE, text=True)
                try:
                    deadline = time.monotonic() + 10
                    while not server_pid.exists() and process.poll() is None and time.monotonic() < deadline:
                        time.sleep(0.01)
                    if not server_pid.exists():
                        self.fail('fake server did not launch before cancellation')
                    process.send_signal(signal.SIGTERM)
                    stdout, stderr = process.communicate(timeout=20)
                    result = subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
                finally:
                    if process.poll() is None:
                        process.kill()
                        process.communicate(timeout=5)
            else:
                result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True,
                                        text=True, timeout=90)
            records = [json.loads(line) for line in capture.read_text().splitlines()] if capture.exists() else []
            survivor = False
            if server_pid.exists():
                pid = int(server_pid.read_text())
                try:
                    os.kill(pid, 0)
                    survivor = True
                except ProcessLookupError:
                    pass
                if survivor:
                    os.kill(pid, signal.SIGTERM)  # only this test-owned sleeper
            return result, records, survivor

    def test_rejected_preflight_stops_before_writable_children(self):
        result, records, _ = self.run_gate_with_doubles(preflight_exit=1)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual([r for r in records if './cmd/server' in r['command'] or './cmd/admin' in r['command'] or r['command'].startswith('pnpm ')], [])
        self.assertEqual(len([r for r in records if './cmd/testdb-preflight' in r['command']]), 1)

    def test_real_launcher_passes_only_prepared_targets_to_every_child(self):
        result, records, survivor = self.run_gate_with_doubles(preflight_exit=0)
        self.assertEqual(result.returncode, 0, result.stderr[-800:])
        self.assertFalse(survivor, 'backend process survived the successful launcher teardown')
        self.assertEqual(len(records), 8)  # preflight, server, five admin commands, Playwright
        self.assertEqual(len([r for r in records if './cmd/admin' in r['command']]), 5)
        runtime = ["127.0.0.1", 56321, "/granete_gate", "granete_app"]
        migration = ["127.0.0.1", 56321, "/granete_gate", "postgres"]
        for record in records:
            self.assertEqual(record['runtime'], runtime, record['command'])
            self.assertEqual(record['migration'], migration, record['command'])
            self.assertEqual(record['isolated'], '1', record['command'])
            self.assertEqual(record['testdb'], '1', record['command'])
            self.assertEqual(record['pg_keys'], [], record['command'])
        browser = [r for r in records if r['command'].startswith('pnpm ')]
        self.assertEqual(browser[0]['fixture'], migration)
        self.assertRegex(browser[0]['identity_digest'], r'^[0-9a-f]{64}$')
        self.assertTrue(all(r['identity_digest'] is None for r in records if not r['command'].startswith('pnpm ')))
        server = next(r for r in records if r['command'].startswith('server '))
        self.assertTrue(server['media_dir'].endswith('/media'))
        self.assertIn('/granete-organization-gate.', server['media_dir'])
        self.assertEqual(browser[0]['media_dir'], server['media_dir'])

    def test_admin_failure_reaps_only_the_gate_server(self):
        unrelated = subprocess.Popen(['sleep', '30'])
        try:
            result, records, survivor = self.run_gate_with_doubles(0, fail_admin=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(any('./cmd/server' in r['command'] for r in records))
            self.assertFalse(survivor, 'backend child survived failure cleanup')
            self.assertIsNone(unrelated.poll(), 'unrelated process was killed')
        finally:
            unrelated.terminate()
            unrelated.wait(timeout=5)

    def test_cancellation_reaps_the_server_without_running_admin(self):
        result, records, survivor = self.run_gate_with_doubles(0, cancel_after_server=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(survivor, 'backend child survived cancellation cleanup')
        self.assertFalse(any('./cmd/admin' in r['command'] for r in records),
                         'admin launched after the gate was cancelled')

    @unittest.skipUnless(os.environ.get('GRANETE_TEST_REAL_GO_PREFLIGHT') == '1',
                         'opt-in local real Go preflight; DB-free and no Docker')
    def test_each_rejected_target_stops_the_real_launcher_before_writers(self):
        if not shutil.which('go'):
            self.skipTest('Go unavailable')
        cases = {
            'organization marker absent': {'ORGANIZATION_TEST_ISOLATED': None},
            'database marker absent': {'GRANETE_TEST_DATABASE': None},
            'runtime missing': {'DATABASE_URL': None},
            'migration missing': {'MIGRATION_DATABASE_URL': None},
            'runtime persistent': {'DATABASE_URL': 'postgres://granete_app:synthetic@127.0.0.1:56321/muebles'},
            'migration persistent': {'MIGRATION_DATABASE_URL': 'postgres://postgres:synthetic@127.0.0.1:56321/muebles'},
            'different instance': {'MIGRATION_DATABASE_URL': 'postgres://postgres:synthetic@127.0.0.1:56322/granete_gate'},
            'different database': {'MIGRATION_DATABASE_URL': 'postgres://postgres:synthetic@127.0.0.1:56321/granete_test_other'},
            'runtime target override': {'DATABASE_URL': 'postgres://granete_app:synthetic@127.0.0.1:56321/granete_gate?dbname=muebles'},
            'migration target override': {'MIGRATION_DATABASE_URL': 'postgres://postgres:synthetic@127.0.0.1:56321/granete_gate?host=example.invalid'},
            'runtime session marker override': {'DATABASE_URL': 'postgres://granete_app:synthetic@127.0.0.1:56321/granete_gate?options=-c%20granete.browser_gate_identity%3Dforged'},
            'migration session marker override': {'MIGRATION_DATABASE_URL': 'postgres://postgres:synthetic@127.0.0.1:56321/granete_gate?options=-c%20granete.browser_gate_identity%3Dforged'},
        }
        for name, poison in cases.items():
            with self.subTest(name=name):
                result, records, _ = self.run_gate_with_doubles(0, real_preflight=True, poison=poison)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(len(records), 1, 'writable child launched after rejected target')
                self.assertIn('./cmd/testdb-preflight', records[0]['command'])


if __name__ == '__main__':
    unittest.main()
