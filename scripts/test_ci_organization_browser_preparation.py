"""Exercise the real browser launcher with non-connecting child-process doubles."""

import json
import os
from pathlib import Path
import re
import select
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
    def start_interactive(self, gate, env):
        command = ['bash', str(gate), 'prepare', 'tests/organization/prequote-design.spec.ts']
        process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True)
        readable, _, _ = select.select([process.stdout], [], [], 30)
        self.assertTrue(readable, 'interactive preparation did not publish a run ID')
        line = process.stdout.readline()
        match = re.search(r'run-id=([a-f0-9]{24})', line)
        if match is None:
            stdout, stderr = process.communicate(timeout=10)
            self.fail(f'interactive preparation returned no run ID: {line}{stdout}{stderr[-800:]}')
        return process, match.group(1)

    def run_gate_with_doubles(self, preflight_exit, *, real_preflight=False, poison=None,
                              fail_admin=False, cancel_after_server=False,
                              browser_lang="en_US.UTF-8", exercise=None,
                              slow_preflight=False, pause_recording=False):
        with tempfile.TemporaryDirectory(prefix="browser-preparation-double-") as tmp:
            tmpdir = Path(tmp)
            capture = tmpdir / "children.jsonl"
            server_pid = tmpdir / "server.pid"
            web_pid = tmpdir / "web.pid"
            browser_pid = tmpdir / "browser.pid"
            fail_cleanup = tmpdir / "fail-cleanup"
            recording_window = tmpdir / "recording-window"
            bindir = tmpdir / "bin"
            bindir.mkdir()
            shim = bindir / "shim"
            shim.write_text(
                "#!" + sys.executable + "\n"
                + "import json, os, pathlib, subprocess, sys, time, urllib.parse\n"
                + f"capture = pathlib.Path({str(capture)!r})\n"
                + f"server_pid = pathlib.Path({str(server_pid)!r})\n"
                + f"web_pid = pathlib.Path({str(web_pid)!r})\n"
                + f"browser_pid = pathlib.Path({str(browser_pid)!r})\n"
                + f"preflight_exit = {preflight_exit}\n"
                + f"fail_admin = {fail_admin!r}\n"
                + f"real_preflight = {real_preflight!r}\n"
                + f"real_go = {shutil.which('go')!r}\n"
                + f"poison = {poison or {}!r}\n"
                + f"slow_preflight = {slow_preflight!r}\n"
                + f"pause_recording = {pause_recording!r}\n"
                + f"fail_cleanup = pathlib.Path({str(fail_cleanup)!r})\n"
                + f"recording_window = pathlib.Path({str(recording_window)!r})\n"
                + f"real_ps = {shutil.which('ps')!r}\n"
                + "name = pathlib.Path(sys.argv[0]).name\n"
                + "args = sys.argv[1:]\n"
                + "if name == 'ps':\n"
                + f"    pending = list(pathlib.Path({str(tmpdir)!r}).glob('granete-organization-sessions-*/*/backend.pending'))\n"
                + "    if pause_recording and 'lstart=' in args and pending and not recording_window.exists():\n"
                + "        recording_window.write_text(str(os.getpid()))\n"
                + "        time.sleep(60)\n"
                + "    os.execv(real_ps, [real_ps] + args)\n"
                + "if name == 'docker':\n"
                + "    if args[0] == 'rm' and fail_cleanup.exists(): sys.exit(1)\n"
                + "    if args[0] == 'ps' and fail_cleanup.exists(): print('synthetic-container')\n"
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
                + "if name in ('go', 'pnpm', 'node', 'granete-server'):\n"
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
                + "        'bind_host': os.environ.get('ORGANIZATION_GATE_BIND_HOST'),\n"
                + "        'lang': os.environ.get('LANG'),\n"
                # Python may set LC_CTYPE itself while coercing the C locale;
                # its os.environ cannot attest the raw env passed to execve.
                + "        'other_locale_keys': sorted(key for key in ('LC_ALL', 'LANGUAGE') if key in os.environ),\n"
                + "        'pg_keys': sorted(key for key in os.environ if key.startswith('PG')),\n"
                + "        'ambient_secret_keys': sorted(key for key in ('AMBIENT_SECRET', 'AWS_SECRET_ACCESS_KEY') if key in os.environ)}\n"
                + "    with capture.open('a') as stream: stream.write(json.dumps(record) + '\\n')\n"
                + "    if name == 'go' and args[:2] == ['run', './cmd/testdb-preflight']:\n"
                + "        if slow_preflight: time.sleep(3)\n"
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
                + "    if name == 'node' and 'vite/bin/vite.js' in ' '.join(args):\n"
                + "        web_pid.write_text(str(os.getpid()))\n"
                + "        time.sleep(60)\n"
                + "    if name == 'node' and 'organization-interactive-browser' in ' '.join(args):\n"
                + "        browser_pid.write_text(str(os.getpid()))\n"
                + "        pathlib.Path(os.environ['ORGANIZATION_BROWSER_READY']).write_text('ready')\n"
                + "        time.sleep(60)\n"
                + "    if name == 'go' and args[:2] == ['run', './cmd/server']:\n"
                + "        child = subprocess.Popen([sys.executable, '-c',\n"
                + "            'import os,pathlib,time; pathlib.Path(' + repr(str(server_pid)) + ').write_text(str(os.getpid())); time.sleep(60)'])\n"
                + "        child.wait()\n"
                + "    if name == 'go' and args[:2] == ['run', './cmd/admin'] and fail_admin: sys.exit(1)\n"
                + "    if name == 'pnpm' and os.environ.get('ORGANIZATION_GATE_EXTERNAL_WEB') == '1': time.sleep(0.5)\n"
                + "    sys.exit(0)\n"
                + "sys.exit(1)\n",
                encoding="utf-8",
            )
            shim.chmod(0o755)
            for name in ("docker", "go", "curl", "pnpm", "node", "ps"):
                (bindir / name).symlink_to(shim)
            env = os.environ.copy()
            env.update({
                "PATH": str(bindir) + os.pathsep + env.get("PATH", ""),
                "TMPDIR": str(tmpdir),
                "DATABASE_URL": "postgres://ambient:secret@127.0.0.1:5445/muebles",
                "MIGRATION_DATABASE_URL": "postgres://ambient:secret@127.0.0.1:5445/muebles",
                "PGHOST": "persistent.example.invalid",
                "PGHOSTADDR": "203.0.113.1",
                "PGDATABASE": "muebles",
                "PGPORT": "5445",
                "PGSERVICE": "habitual",
                "PGSERVICEFILE": "/nonexistent/ambient-service-file",
                "PGOPTIONS": "-c search_path=public",
                "PGPASSWORD": "ambient-secret",
                "PGPASSFILE": "/nonexistent/ambient-passfile",
                "LC_ALL": "en_US.UTF-8",
                "LC_CTYPE": "en_US.UTF-8",
                "LANGUAGE": "en_US:en",
                "AMBIENT_SECRET": "must-not-reach-children",
                "AWS_SECRET_ACCESS_KEY": "must-not-reach-children",
                "MEDIA_DIR": "ambient-media-dir-must-not-reach-children",
            })
            if browser_lang is None:
                env.pop("LANG", None)
            else:
                env["LANG"] = browser_lang
            gate = Path(os.environ.get("ORGANIZATION_GATE_TEST_SCRIPT", DEFAULT_GATE))
            if exercise is not None:
                return exercise(gate, env, tmpdir, capture, server_pid, web_pid, browser_pid)
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
            self.assertEqual(record['other_locale_keys'], [], record['command'])
            self.assertEqual(record['ambient_secret_keys'], [], record['command'])
        browser = [r for r in records if r['command'].startswith('pnpm ')]
        self.assertEqual(browser[0]['fixture'], migration)
        self.assertRegex(browser[0]['identity_digest'], r'^[0-9a-f]{64}$')
        self.assertTrue(all(r['identity_digest'] is None for r in records if not r['command'].startswith('pnpm ')))
        server = next(r for r in records if r['command'].startswith('server '))
        self.assertEqual(server['bind_host'], '127.0.0.1')
        self.assertTrue(all(r['bind_host'] is None for r in records if r is not server))
        self.assertTrue(server['media_dir'].endswith('/media'))
        self.assertIn('/granete-organization-gate.', server['media_dir'])
        self.assertEqual(browser[0]['media_dir'], server['media_dir'])
        self.assertEqual(browser[0]['lang'], 'en_US.UTF-8')
        self.assertTrue(all(r['lang'] is None for r in records if not r['command'].startswith('pnpm ')))

    def test_browser_accepts_utf8_locale_spellings_without_forwarding_to_other_children(self):
        for value in ('en_US.utf8', 'C.UTF8', 'en_US.uTf-8'):
            with self.subTest(lang=value):
                result, records, _ = self.run_gate_with_doubles(0, browser_lang=value)
                self.assertEqual(result.returncode, 0, result.stderr[-800:])
                self.assertEqual(records[-1]['lang'], value)
                self.assertTrue(all(r['lang'] is None for r in records[:-1]))

    def test_missing_or_non_utf8_locale_stops_before_writable_children(self):
        for value in (None, '', 'C', 'en_US.ISO-8859-1', 'en_US.UTF-16', 'en_US.UTF-8\nPGHOST=muebles'):
            with self.subTest(lang=value):
                result, records, _ = self.run_gate_with_doubles(0, browser_lang=value)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(records, [], 'writable child launched with unsafe LANG')
                self.assertIn('LANG', result.stderr)

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

    def test_interactive_run_uses_one_preparation_and_cleans_owned_resources(self):
        def exercise(gate, env, tmpdir, capture, server_pid, web_pid, browser_pid):
            command = ["bash", str(gate)]
            launcher, run_id = self.start_interactive(gate, env)

            def control(action):
                return subprocess.run(command + [action, run_id], cwd=ROOT, env=env,
                                      capture_output=True, text=True, timeout=20)

            waiting = control("status")
            self.assertIn("WAITING_FOR_HUMAN", waiting.stdout)
            self.assertIn("host_result=NOT_RUN", waiting.stdout)
            self.assertIn("automated_result=PASS", waiting.stdout)
            for secret in ("ambient-secret", "synthetic", "Gate-"):
                self.assertNotIn(secret, waiting.stdout)
            self.assertTrue(all(path.exists() for path in (server_pid, web_pid, browser_pid)))
            continued = control("continue")
            self.assertEqual(continued.returncode, 0, continued.stderr)
            self.assertIn("HOST_CHECK_IN_PROGRESS", control("status").stdout)
            self.assertEqual(control("stop").returncode, 0)
            self.assertEqual(control("stop").returncode, 0)
            launcher.communicate(timeout=10)
            self.assertEqual(launcher.returncode, 0)
            stopped = control("status")
            self.assertIn("FINISHED", stopped.stdout)
            self.assertIn("host_result=NOT_RUN", stopped.stdout)
            records = [json.loads(line) for line in capture.read_text().splitlines()]
            self.assertEqual(len([r for r in records if './cmd/testdb-preflight' in r['command']]), 1)
            self.assertEqual(len([r for r in records if './cmd/admin' in r['command']]), 5)
            self.assertEqual(len([r for r in records if r['command'].startswith('pnpm exec')]), 1)
            for path in (server_pid, web_pid, browser_pid):
                pid = int(path.read_text())
                with self.assertRaises(ProcessLookupError):
                    os.kill(pid, 0)
            self.assertEqual(list(tmpdir.glob('granete-organization-gate.*')), [])
            self.assertEqual(list(tmpdir.glob('granete-organization-browser-profile.*')), [])

        self.run_gate_with_doubles(0, exercise=exercise)

    def test_interactive_invalid_id_and_failed_preparation_do_not_claim_readiness(self):
        def exercise(gate, env, tmpdir, capture, server_pid, web_pid, browser_pid):
            invalid = subprocess.run(['bash', str(gate), 'stop', '../bad'], cwd=ROOT, env=env,
                                     capture_output=True, text=True, timeout=10)
            self.assertNotEqual(invalid.returncode, 0)
            invalid_age = subprocess.run(['bash', str(gate), 'prepare', 'tests/organization/prequote-design.spec.ts'],
                                         cwd=ROOT, env=dict(env, ORGANIZATION_GATE_MAX_AGE_SECONDS='3601'),
                                         capture_output=True, text=True, timeout=10)
            self.assertNotEqual(invalid_age.returncode, 0)
            self.assertFalse(capture.exists(), 'invalid max age started a writable child')
            started = subprocess.run(['bash', str(gate), 'prepare', 'tests/organization/prequote-design.spec.ts'],
                                     cwd=ROOT, env=env, capture_output=True, text=True, timeout=20)
            self.assertNotEqual(started.returncode, 0)
            self.assertIn('environment_state=ABORTED', started.stderr)
            self.assertIn('cleanup=COMPLETE', started.stderr)
            self.assertFalse(web_pid.exists())
            self.assertFalse(browser_pid.exists())
            self.assertEqual(list(tmpdir.glob('granete-organization-gate.*')), [])

        self.run_gate_with_doubles(0, fail_admin=True, exercise=exercise)

    def test_interactive_expiry_and_forced_owner_loss_are_bounded(self):
        def exercise(gate, env, tmpdir, capture, server_pid, web_pid, browser_pid):
            command = ['bash', str(gate)]
            short_env = dict(env, ORGANIZATION_GATE_MAX_AGE_SECONDS='4')
            launcher, run_id = self.start_interactive(gate, short_env)
            run_dir = tmpdir / f'granete-organization-sessions-{os.getuid()}' / run_id
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                state = subprocess.run(command + ['status', run_id], cwd=ROOT, env=env,
                                       capture_output=True, text=True, timeout=10).stdout
                if 'environment_state=INCOMPLETE' in state: break
                time.sleep(0.1)
            self.assertIn('environment_state=INCOMPLETE', state)
            self.assertIn('cleanup=COMPLETE', state)
            launcher.communicate(timeout=10)

            second_launcher, second_id = self.start_interactive(gate, env)
            second_dir = tmpdir / f'granete-organization-sessions-{os.getuid()}' / second_id
            owner = int((second_dir / 'owner.pid').read_text())
            os.kill(owner, signal.SIGKILL)  # only this test-owned supervisor
            second_launcher.communicate(timeout=10)
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                observed = subprocess.run(command + ['status', second_id], cwd=ROOT, env=env,
                                          capture_output=True, text=True, timeout=10).stdout
                if 'environment_state=ORPHANED' in observed: break
                time.sleep(0.1)
            self.assertIn('environment_state=ORPHANED', observed)
            recovered = subprocess.run(command + ['stop', second_id], cwd=ROOT, env=env,
                                       capture_output=True, text=True, timeout=30)
            self.assertEqual(recovered.returncode, 0, recovered.stderr)
            self.assertIn('environment_state=INCOMPLETE', recovered.stdout)
            self.assertIn('cleanup=COMPLETE', recovered.stdout)
            self.assertEqual(list(tmpdir.glob('granete-organization-gate.*')), [])
            for path in (server_pid, web_pid, browser_pid):
                pid = int(path.read_text())
                with self.assertRaises(ProcessLookupError): os.kill(pid, 0)

        self.run_gate_with_doubles(0, exercise=exercise)

    def test_incomplete_cleanup_requires_exact_run_retry(self):
        def exercise(gate, env, tmpdir, capture, server_pid, web_pid, browser_pid):
            launcher, run_id = self.start_interactive(gate, env)
            fail_cleanup = tmpdir / 'fail-cleanup'
            fail_cleanup.touch()
            command = ['bash', str(gate), 'stop', run_id]
            first = subprocess.run(command, cwd=ROOT, env=env, capture_output=True,
                                   text=True, timeout=20)
            self.assertNotEqual(first.returncode, 0, first.stdout)
            self.assertIn('cleanup=INCOMPLETE', first.stdout)
            fail_cleanup.unlink()
            second = subprocess.run(command, cwd=ROOT, env=env, capture_output=True,
                                    text=True, timeout=20)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertIn('cleanup=COMPLETE', second.stdout)
            launcher.communicate(timeout=10)

        self.run_gate_with_doubles(0, exercise=exercise)

    def test_unrecorded_spawn_never_claims_complete_recovery(self):
        def exercise(gate, env, tmpdir, capture, server_pid, web_pid, browser_pid):
            launcher = subprocess.Popen(['bash', str(gate), 'prepare',
                                         'tests/organization/prequote-design.spec.ts'],
                                        cwd=ROOT, env=env, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, text=True)
            window = tmpdir / 'recording-window'
            deadline = time.monotonic() + 10
            while not window.exists() and time.monotonic() < deadline: time.sleep(0.01)
            self.assertTrue(window.exists(), 'backend spawn recording window was not reached')
            run_dir = next(tmpdir.glob('granete-organization-sessions-*/*'))
            run_id = run_dir.name
            root = Path((run_dir / 'tmp-root').read_text().strip())
            owner = int((run_dir / 'owner.pid').read_text())
            os.kill(owner, signal.SIGKILL)
            launcher.communicate(timeout=10)
            try:
                stopped = subprocess.run(['bash', str(gate), 'stop', run_id], cwd=ROOT,
                                         env=env, capture_output=True, text=True, timeout=10)
                self.assertNotEqual(stopped.returncode, 0, stopped.stdout)
                self.assertIn('cleanup=INCOMPLETE', stopped.stdout)
                self.assertTrue(root.exists(), 'unowned process evidence was deleted')
                self.assertTrue(server_pid.exists())
                os.kill(int(server_pid.read_text()), 0)
            finally:
                for path in (server_pid, window):
                    if path.exists():
                        try: os.kill(int(path.read_text()), signal.SIGTERM)
                        except ProcessLookupError: pass

        self.run_gate_with_doubles(0, exercise=exercise, pause_recording=True)

    def test_deadline_during_preparation_never_publishes_waiting(self):
        def exercise(gate, env, tmpdir, capture, server_pid, web_pid, browser_pid):
            short_env = dict(env, ORGANIZATION_GATE_MAX_AGE_SECONDS='1')
            launcher = subprocess.Popen(['bash', str(gate), 'prepare',
                                         'tests/organization/prequote-design.spec.ts'],
                                        cwd=ROOT, env=short_env, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, text=True)
            try:
                try:
                    stdout, stderr = launcher.communicate(timeout=8)
                except subprocess.TimeoutExpired:
                    run_dir = next(tmpdir.glob('granete-organization-sessions-*/*'))
                    subprocess.run(['bash', str(gate), 'stop', run_dir.name], cwd=ROOT,
                                   env=env, capture_output=True, text=True, timeout=20)
                    stdout, stderr = launcher.communicate(timeout=10)
                self.assertNotEqual(launcher.returncode, 0, stdout)
                self.assertNotIn('run-id=', stdout)
                self.assertNotIn('environment_state=WAITING_FOR_HUMAN', stdout + stderr)
                self.assertFalse(server_pid.exists(), 'server launched after expired preflight')
            finally:
                if launcher.poll() is None:
                    launcher.kill()
                    launcher.communicate(timeout=5)

        self.run_gate_with_doubles(0, exercise=exercise, slow_preflight=True)

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
