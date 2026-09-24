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
                              fail_admin=False, cancel_after_server=False,
                              browser_variant='isolated', ambient_overrides=None):
        with tempfile.TemporaryDirectory(prefix="browser-preparation-double-") as tmp:
            tmpdir = Path(tmp)
            capture = tmpdir / "children.jsonl"
            docker_run_marker = tmpdir / "docker-run"
            server_pid = tmpdir / "server.pid"
            bindir = tmpdir / "bin"
            bindir.mkdir()
            shim = bindir / "shim"
            shim.write_text(
                "#!" + sys.executable + "\n"
                + "import json, os, pathlib, subprocess, sys, time, urllib.parse\n"
                + f"capture = pathlib.Path({str(capture)!r})\n"
                + f"docker_run_marker = pathlib.Path({str(docker_run_marker)!r})\n"
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
                + "    elif args[0] == 'run': docker_run_marker.touch(); print('synthetic-container')\n"
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
                + "        'pg_keys': sorted(key for key in os.environ if key.startswith('PG')),\n"
                + "        'ambient_inert': 'GRANETE_DIAGNOSTIC_INERT_MARKER' in os.environ,\n"
                + "        'ci_metadata': os.environ.get('CI') == 'true' and os.environ.get('GITHUB_ACTIONS') == 'true',\n"
                + "        'locale_metadata': os.environ.get('LANG') == 'C' and os.environ.get('LC_ALL') == 'C' and os.environ.get('LANGUAGE') == 'en',\n"
                + "        'linux_metadata': os.environ.get('USER') == 'synthetic-user' and os.environ.get('LOGNAME') == 'synthetic-user' and os.environ.get('SHELL') == '/bin/bash' and os.environ.get('XDG_SESSION_TYPE') == 'tty' and os.environ.get('XDG_CURRENT_DESKTOP') == 'headless',\n"
                + "        'safe_names': sorted(key for key in os.environ if key in\n"
                + "            ('CI', 'GITHUB_ACTIONS', 'RUNNER_OS', 'RUNNER_ARCH', 'LANG', 'LC_ALL',\n"
                + "             'LANGUAGE', 'USER', 'LOGNAME', 'SHELL',\n"
                + "             'XDG_SESSION_TYPE', 'XDG_CURRENT_DESKTOP')),\n"
                + "        'lc_ctype_explicit': os.environ.get('LC_CTYPE') == 'C',\n"
                + "        'dangerous_keys': sorted(key for key in os.environ if key in\n"
                + "            ('GITHUB_TOKEN', 'ACTIONS_RUNTIME_TOKEN', 'POSTGRES_PASSWORD',\n"
                + "             'OTHER_DATABASE_URL', 'OTHER_DB_URL', 'AWS_SECRET_ACCESS_KEY',\n"
                + "             'HTTP_PROXY'))}\n"
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
                "ORGANIZATION_TEST_DATABASE_URL": "postgres://ambient:secret@127.0.0.1:5445/muebles",
                "PGHOST": "persistent.example.invalid",
                "PGHOSTADDR": "127.0.0.1",
                "PGDATABASE": "muebles",
                "PGPORT": "5445",
                "PGSERVICE": "habitual",
                "PGSERVICEFILE": str(tmpdir / 'ambient-service-file'),
                "PGOPTIONS": "-c search_path=ambient",
                "PGPASSWORD": "ambient-secret",
                "PGPASSFILE": str(tmpdir / 'ambient-pass-file'),
                "MEDIA_DIR": "ambient-media-dir-must-not-reach-children",
                "GRANETE_DIAGNOSTIC_INERT_MARKER": "synthetic-inert",
                "CI": "true",
                "GITHUB_ACTIONS": "true",
                "RUNNER_OS": "Linux",
                "RUNNER_ARCH": "X64",
                "LANG": "C",
                "LC_ALL": "C",
                "LC_CTYPE": "C",
                "LANGUAGE": "en",
                "USER": "synthetic-user",
                "LOGNAME": "synthetic-user",
                "SHELL": "/bin/bash",
                "XDG_SESSION_TYPE": "tty",
                "XDG_CURRENT_DESKTOP": "headless",
                "GITHUB_TOKEN": "synthetic-secret",
                "ACTIONS_RUNTIME_TOKEN": "synthetic-secret",
                "POSTGRES_PASSWORD": "synthetic-secret",
                "OTHER_DATABASE_URL": "postgres://synthetic:secret@127.0.0.1:5445/muebles",
                "OTHER_DB_URL": "postgres://synthetic:secret@127.0.0.1:5445/muebles",
                "AWS_SECRET_ACCESS_KEY": "synthetic-secret",
                "HTTP_PROXY": "http://ambient.invalid",
                "PTX_DIAGNOSTIC_BROWSER_ENV": browser_variant,
                "PTX_DIAGNOSTIC_DIR": str(tmpdir / 'diagnostic'),
            })
            if ambient_overrides:
                env.update(ambient_overrides)
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
            safe_report = tmpdir / 'diagnostic' / 'browser-env-safe-names.txt'
            result.browser_safe_report = safe_report.read_text() if safe_report.exists() else None
            result.docker_run_started = docker_run_marker.exists()
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

    def test_browser_inherited_safe_variant_changes_only_browser_environment(self):
        for variant, browser_inherits in (('isolated', False), ('inherited-safe', True)):
            with self.subTest(variant=variant):
                result, records, survivor = self.run_gate_with_doubles(0, browser_variant=variant)
                self.assertEqual(result.returncode, 0, result.stderr[-800:])
                self.assertFalse(survivor)
                self.assertEqual(len(records), 8, (result.stderr[-800:], records))
                browser = next(r for r in records if r['command'].startswith('pnpm '))
                self.assertEqual(browser['ambient_inert'], browser_inherits)
                self.assertEqual(browser['ci_metadata'], browser_inherits)
                self.assertEqual(browser['pg_keys'], [])
                self.assertEqual(browser['dangerous_keys'], [])
                self.assertEqual(browser['runtime'], ['127.0.0.1', 56321, '/granete_gate', 'granete_app'])
                self.assertEqual(browser['migration'], ['127.0.0.1', 56321, '/granete_gate', 'postgres'])
                self.assertEqual(browser['fixture'], browser['migration'])
                self.assertRegex(browser['identity_digest'], r'^[0-9a-f]{64}$')
                for child in (r for r in records if r is not browser):
                    self.assertFalse(child['ambient_inert'], child['command'])
                    self.assertFalse(child['ci_metadata'], child['command'])
                    self.assertEqual(child['pg_keys'], [], child['command'])
                    self.assertEqual(child['dangerous_keys'], [], child['command'])

    def test_unknown_browser_variant_stops_before_writable_children(self):
        result, records, _ = self.run_gate_with_doubles(0, browser_variant='unknown')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(records, [])

    def test_safe_groups_affect_only_browser_child(self):
        ci = {'CI', 'GITHUB_ACTIONS', 'RUNNER_OS', 'RUNNER_ARCH'}
        locale = {'LANG', 'LC_ALL', 'LANGUAGE'}
        linux = {'USER', 'LOGNAME', 'SHELL', 'XDG_SESSION_TYPE', 'XDG_CURRENT_DESKTOP'}
        for variant, expected in (
            ('ci+locale', ci | locale), ('ci', ci),
            ('locale', locale), ('linux', linux),
        ):
            with self.subTest(variant=variant):
                result, records, survivor = self.run_gate_with_doubles(0, browser_variant=variant)
                self.assertEqual(result.returncode, 0, result.stderr[-800:])
                self.assertFalse(survivor)
                self.assertEqual(len(records), 8)
                browser = next(r for r in records if r['command'].startswith('pnpm '))
                self.assertEqual(set(browser['safe_names']), expected)
                self.assertEqual(browser['ci_metadata'], variant in ('ci+locale', 'ci'))
                self.assertEqual(browser['locale_metadata'], variant in ('ci+locale', 'locale'))
                self.assertEqual(browser['linux_metadata'], variant == 'linux')
                self.assertEqual(browser['lc_ctype_explicit'], variant in ('ci+locale', 'locale'))
                self.assertEqual(browser['pg_keys'], [])
                self.assertEqual(browser['dangerous_keys'], [])
                self.assertEqual(browser['runtime'], ['127.0.0.1', 56321, '/granete_gate', 'granete_app'])
                self.assertEqual(browser['migration'], ['127.0.0.1', 56321, '/granete_gate', 'postgres'])
                self.assertEqual(browser['fixture'], browser['migration'])
                self.assertRegex(browser['identity_digest'], r'^[0-9a-f]{64}$')
                for child in (r for r in records if r is not browser):
                    self.assertEqual(child['safe_names'], [], child['command'])
                    self.assertFalse(child['ci_metadata'], child['command'])
                    self.assertFalse(child['locale_metadata'], child['command'])
                    self.assertFalse(child['linux_metadata'], child['command'])
                    self.assertFalse(child['lc_ctype_explicit'], child['command'])
                    self.assertEqual(child['pg_keys'], [], child['command'])
                    self.assertEqual(child['dangerous_keys'], [], child['command'])
                self.assertIsNotNone(result.browser_safe_report)
                report = dict(line.split('=', 1) for line in result.browser_safe_report.splitlines())
                self.assertEqual(report['variant'], variant)
                forwarded = set(report['forwarded_safe_names'].split(','))
                if variant in ('ci+locale', 'locale'):
                    self.assertEqual(forwarded, expected | {'LC_CTYPE'})
                else:
                    self.assertEqual(forwarded, expected)
                self.assertGreater(int(report['ambient_db_pg_count']), 0)
                self.assertGreater(int(report['ambient_credential_count']), 0)
                self.assertGreater(int(report['ambient_proxy_count']), 0)
                self.assertGreater(int(report['ambient_unclassified_key_count']), 0)
                self.assertNotIn('synthetic-user', result.browser_safe_report)
                self.assertNotIn('ambient.invalid', result.browser_safe_report)

    def test_contaminated_safe_group_values_fail_before_disposable_writer(self):
        cases = (
            ('ci', 'CI', 'postgres://local/muebles'),
            ('ci', 'GITHUB_ACTIONS', 'synthetic-secret'),
            ('ci', 'RUNNER_OS', 'Windows'),
            ('ci', 'RUNNER_ARCH', 'ARM64'),
            ('locale', 'LANG', 'postgres://local/muebles'),
            ('locale', 'LC_ALL', 'synthetic-secret'),
            ('locale', 'LC_CTYPE', 'C.UTF-8\nTOKEN'),
            ('locale', 'LANGUAGE', 'en:postgres://local/muebles'),
            ('linux', 'USER', 'synthetic-secret'),
            ('linux', 'LOGNAME', 'postgres://local/muebles'),
            ('linux', 'SHELL', '/tmp/credential-shell'),
            ('linux', 'XDG_SESSION_TYPE', 'synthetic-secret'),
            ('linux', 'XDG_CURRENT_DESKTOP', 'postgres://local/muebles'),
        )
        for variant, key, value in cases:
            with self.subTest(variant=variant, key=key):
                result, records, _ = self.run_gate_with_doubles(
                    0, browser_variant=variant, ambient_overrides={key: value},
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(result.docker_run_started, key)
                self.assertEqual(records, [], key)
                self.assertIn('unsafe browser diagnostic value', result.stderr)
                self.assertNotIn(value, result.stderr)

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
